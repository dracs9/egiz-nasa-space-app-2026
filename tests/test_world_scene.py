"""EGIZ ASTRAL world builder: byte-range TIFF access, tile pyramid geometry and provenance.

Analytic rasters are test inputs only; the packaged world is always built from the real products.
"""
import hashlib
import json
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from pipeline.world import remote_tiff
from pipeline.world import scene as world

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "data/world/mars-jezero"


def striped_tiff(path, data, big=False):
    with rasterio.open(path, "w", driver="GTiff", height=data.shape[0], width=data.shape[1], count=1, dtype=data.dtype,
                       transform=from_origin(1000, 2000, 1, 1), blockysize=1, compress="none",
                       BIGTIFF="YES" if big else "NO") as dst:
        dst.write(data, 1)
    return path.read_bytes()


@pytest.mark.parametrize("big", [False, True])
def test_byte_range_window_matches_gdal(tmp_path, monkeypatch, big):
    data = np.arange(40 * 60, dtype=np.float32).reshape(40, 60) * 0.5
    raw = striped_tiff(tmp_path / "strip.tif", data, big)
    requested = []

    def fake_fetch(url, start, length, retries=4):
        requested.append(length)
        return raw[start:start + length]

    monkeypatch.setattr(remote_tiff, "fetch", fake_fetch)
    info = remote_tiff.parse_directory(lambda start, length: fake_fetch("x", start, length))
    assert (info["width"], info["height"], info["rows_per_strip"]) == (60, 40, 1)
    assert info["tiepoint"][3:5] == (1000.0, 2000.0)
    before = len(requested)
    window = remote_tiff.read_window("x", 7, 5, 20, 11, workers=3)
    np.testing.assert_array_equal(window, data[5:16, 7:27])
    # Only the requested columns of each row are transferred, never whole strips.
    assert requested[before:].count(20 * 4) >= 11 and max(requested[before:]) < 60 * 4 * 3
    assert sum(requested[before:]) < len(raw) / 4
    with pytest.raises(remote_tiff.RemoteTiffError):
        remote_tiff.read_window("x", 50, 0, 20, 5)


def test_compressed_or_multiband_sources_are_refused(tmp_path):
    path = tmp_path / "lzw.tif"
    with rasterio.open(path, "w", driver="GTiff", height=8, width=8, count=1, dtype="float32", compress="lzw") as dst:
        dst.write(np.zeros((8, 8), np.float32), 1)
    raw = path.read_bytes()
    with pytest.raises(remote_tiff.RemoteTiffError, match="uncompressed"):
        remote_tiff.parse_directory(lambda start, length: raw[start:start + length])


SITE = {"id": "TEST", "name": "analytic plane", "body": "mars", "lat": 18.0, "lon": 77.0, "radius_m": 3396190.0,
        "half_m": 64.0, "levels": 3, "frame": "test", "source_crs": world.SITES["mars-jezero"]["source_crs"],
        "dtm": {"pixel_m": 1.0, "nodata_below": -1e30}, "ortho": {"pixel_m": 0.25, "nodata": 0}}


def analytic_sources(hole=False):
    """z = 0.05·east + 0.02·north + 100 expressed in the equirectangular source grid."""
    lat0, lon0, radius = np.deg2rad(SITE["lat"]), np.deg2rad(SITE["lon"]), SITE["radius_m"]
    x0, y0 = radius * lon0 - 140, radius * lat0 + 140
    cols, rows = np.meshgrid(np.arange(280) + 0.5, np.arange(280) + 0.5)
    east = (x0 + cols - radius * lon0) * np.cos(lat0)
    north = y0 - rows - radius * lat0
    dtm = (0.05 * east + 0.02 * north + 100).astype(np.float32)
    if hole:
        dtm[130:150, 130:150] = -3.4e38
    return dtm, (x0, y0)


def tile(folder, key):
    return np.frombuffer((folder / "h" / f"{key}.bin").read_bytes(), "<i2").reshape(world.POSTS + 3, world.POSTS + 3)


def test_pyramid_geometry_seams_scale_and_fingerprints(tmp_path):
    dtm, origin = analytic_sources()
    manifest = world.build_package(SITE, dtm, origin, None, None, tmp_path)
    enc = manifest["encoding"]
    assert manifest["schema"] == "egiz.world_scene" and manifest["synthetic"] is False
    assert [lv["posting_m"] for lv in manifest["levels"]] == [1.0, 0.5, 0.25]
    assert len(manifest["tiles"]) == 1 + 4 + 16 and enc["side"] == 131
    for entry in manifest["tiles"]:
        payload = (tmp_path / "h" / f"{entry['key']}.bin").read_bytes()
        assert hashlib.sha256(payload).hexdigest() == entry["height_sha256"] and len(payload) == entry["height_bytes"]
        assert entry["valid_fraction"] == 1.0
    # Heights reproduce the plane at true scale in the local frame (east/north metres), at every level.
    for key, size in (("0-0-0", 128.0), ("2-1-2", 32.0)):
        entry = next(t for t in manifest["tiles"] if t["key"] == key)
        post = size / world.POSTS
        k = np.arange(-1, world.POSTS + 2)
        east, north = np.meshgrid(entry["west"] + k * post, entry["north"] - k * post)
        expected = 0.05 * east + 0.02 * north + 100
        decoded = tile(tmp_path, key) * enc["scale_m"] + enc["offset_m"]
        assert np.abs(decoded - expected).max() < 0.02  # quantisation plus the local-projection error
    # Neighbouring tiles share edge posts exactly and carry each other's interior in the apron.
    a, b, south = tile(tmp_path, "2-1-1"), tile(tmp_path, "2-2-1"), tile(tmp_path, "2-1-2")
    np.testing.assert_array_equal(a[:, world.POSTS + 1], b[:, 1])
    np.testing.assert_array_equal(a[:, world.POSTS + 2], b[:, 2])
    np.testing.assert_array_equal(a[world.POSTS + 1, :], south[1, :])
    # A parent's posts coincide with every second child post (plane: averaging changes nothing).
    parent, child = tile(tmp_path, "1-0-0"), tile(tmp_path, "2-0-0")
    assert np.abs(parent[1:66, 1:66].astype(int) - child[1:130:2, 1:130:2].astype(int)).max() <= 1


def test_missing_source_pixels_stay_missing(tmp_path):
    dtm, origin = analytic_sources(hole=True)
    manifest = world.build_package(SITE, dtm, origin, None, None, tmp_path)
    finest = tile(tmp_path, "2-1-1")
    assert (finest == world.NODATA).any(), "no-data must not be filled"
    assert min(t["valid_fraction"] for t in manifest["tiles"]) < 1
    with pytest.raises(ValueError, match="no valid elevation"):
        world.build_package(SITE, np.full_like(dtm, -3.4e38), origin, None, None, tmp_path / "empty")


def test_box_mean_propagates_gaps_and_quantisation_guards_range():
    values = np.arange(49, dtype=np.float32).reshape(7, 7)
    values[3, 3] = np.nan
    out = world.box_mean(values, 3)
    assert np.isnan(out[2:5, 2:5]).all() and np.isfinite(out[0, 0])
    assert world.box_mean(values, 1) is values
    with pytest.raises(ValueError, match="int16"):
        world.quantize(np.array([[0.0, 2000.0]]), 0.0)
    assert world.quantize(np.array([[np.nan, 1.0]]), 0.0).tolist() == [[world.NODATA, 50]]


def test_imagery_tiles_are_block_averages(tmp_path):
    dtm, origin = analytic_sources()
    ortho = np.full((4 * 280, 4 * 280), 100, np.uint8)
    ortho[:, 560:] = 200  # east half brighter
    manifest = world.build_package(SITE, dtm, origin, ortho, origin, tmp_path)
    from PIL import Image
    image = np.asarray(Image.open(tmp_path / "img" / "0-0-0.jpg"))
    assert image.shape == (512, 512) and manifest["levels"][0]["image_px_m"] == 0.25
    assert abs(float(image[:, :200].mean()) - 100) < 3 and abs(float(image[:, 312:].mean()) - 200) < 3
    assert all("image_sha256" in t for t in manifest["tiles"])


@pytest.mark.skipif(not (PACKAGE / "manifest.json").exists(), reason="measured Jezero world package not built")
def test_packaged_world_matches_its_manifest():
    manifest = json.loads((PACKAGE / "manifest.json").read_text())
    assert manifest["site"]["id"] == "MARS_JEZERO" and manifest["synthetic"] is False
    assert manifest["sources"]["dtm"]["url"].startswith("https://") and len(manifest["sources"]["dtm"]["window_sha256"]) == 64
    assert manifest["levels"][-1]["posting_m"] == manifest["sources"]["dtm"]["pixel_m"] == 1.0
    assert manifest["levels"][-1]["image_px_m"] == manifest["sources"]["ortho"]["pixel_m"] == 0.25
    for entry in manifest["tiles"]:
        assert hashlib.sha256((PACKAGE / "h" / f"{entry['key']}.bin").read_bytes()).hexdigest() == entry["height_sha256"]
        assert hashlib.sha256((PACKAGE / "img" / f"{entry['key']}.jpg").read_bytes()).hexdigest() == entry["image_sha256"]
    # Jezero floor near the landing site lies about 2.57 km below the areoid.
    assert -2700 < manifest["encoding"]["offset_m"] < -2450


@pytest.mark.skipif(not (PACKAGE / "illumination.json").exists(), reason="world illumination record not built")
def test_world_illumination_is_concatenated_cspice():
    record = json.loads((PACKAGE / "illumination.json").read_text())
    samples = record["samples"]
    assert record["schema"] == "egiz.world_illumination" and "CSPICE" in record["engine"] and record["siteId"] == "MARS_JEZERO"
    assert samples[0]["t"] == 0 and samples[-1]["t"] == record["duration"] == record["segments"] * 86400
    assert all(b["t"] > a["t"] for a, b in zip(samples, samples[1:]))
    assert all(abs(np.linalg.norm(s["sunEnu"]) - 1) < 1e-9 for s in samples)
    packaged = next(e for e in json.loads((ROOT / "data/pilot/spice_geometry.json").read_text())["entries"] if e["siteId"] == "MARS_JEZERO")
    if packaged["epochUtc"] == record["epochUtc"]:  # same epoch: first day must agree with the existing scientific record
        assert max(abs(a["sunEnu"][i] - b["sunEnu"][i]) for a, b in zip(packaged["samples"], samples) for i in range(3)) < 1e-9
