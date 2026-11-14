# Written with AI assistance (Claude Code); reviewed by: pending (Geo lead).
"""Unit tests on synthetic fixtures (tmp dirs only) plus release checks when a release exists."""
import json
import math

import numpy as np
import pytest
import rasterio
from pyproj import Transformer
from rasterio.transform import from_origin

from pipeline.geodata import RELEASE
from pipeline.geodata.aois import AOI, earth_group
from pipeline.geodata.cache import fetch, sha256_file
from pipeline.geodata.catalog import coverage_level, ring
from pipeline.geodata.features import extra_terrain, load_record, mark_missing, put
from pipeline.geodata.qa import feature_checks, validate_release
from pipeline.geodata.rasters import mosaic_window
from pipeline.geodata.sample import haversine_km, tile_origin
from pipeline.planets.access import local_crs, local_origin


def _tile(path, west, north, values, res=0.01):
    with rasterio.open(path, "w", driver="GTiff", width=values.shape[1], height=values.shape[0], count=1,
                       dtype="float32", crs="EPSG:4326", transform=from_origin(west, north, res, res)) as dst:
        dst.write(values.astype("float32"), 1)


def test_mosaic_straddles_tile_edge_without_gaps(tmp_path):
    a, b = tmp_path / "synthetic_a.tif", tmp_path / "synthetic_b.tif"
    _tile(a, 0, 1, np.full((100, 100), 10))
    _tile(b, 1, 1, np.full((100, 100), 20))
    z, transform, crs, info = mosaic_window([str(a), str(b)], (0.9, 0.4, 1.1, 0.6))
    assert np.isfinite(z).all()
    assert set(np.unique(z)) == {10, 20}
    assert z[:, 0].tolist() == [10] * z.shape[0] and z[:, -1].tolist() == [20] * z.shape[0]


def test_mosaic_keeps_ocean_as_nodata(tmp_path):
    a = tmp_path / "synthetic_a.tif"
    _tile(a, 0, 1, np.full((100, 100), 10))
    z, *_ = mosaic_window([str(a)], (0.9, 0.4, 1.1, 0.6))
    assert np.isnan(z).any() and not (z == 0).any()


def test_extra_terrain_on_tilted_plane():
    p = 50
    n = 440
    cols = np.arange(n)[None, :].repeat(n, 0)
    z = -0.1 * cols * p  # descends eastward, 0.1 gradient -> 5.71 deg
    out = extra_terrain(z, p, "f100")
    assert out["slope_f100_mean_deg"] == pytest.approx(math.degrees(math.atan(0.1)), abs=1e-6)
    assert out["aspect_eastness_mean_unitless"] == pytest.approx(1, abs=1e-6)
    assert abs(out["aspect_northness_mean_unitless"]) < 1e-6
    bins = [v for k, v in out.items() if "_bin_" in k]
    assert sum(bins) == pytest.approx(1)
    assert out["slope_f100_bin_5_15_frac"] == 1


def _record():
    return load_record(AOI("FAKE_TEST", "SITE_FAKE_TEST", "EARTH_GN00E000", "earth", "t", "t", 0, 0, "pilot"))


def test_missing_values_are_null_with_reason_not_zero():
    r = _record()
    put(r, "relief_m", float("nan"), evidence="derived", source="COP_GLO30", method="m")
    assert r["features"]["relief_m"] is None and "relief_m" in r["missing"]
    mark_missing(r, ["bare_frac"], "reason")
    assert r["features"]["bare_frac"] is None and r["missing"]["bare_frac"] == "reason"


def test_quality_flags_units_ranges_and_synthetic():
    r = _record()
    put(r, "relief_m", 50000, evidence="derived", source="COP_GLO30", method="m")
    put(r, "badname", 1.0, evidence="derived", source="X", method="m")
    r["features"]["bare_frac"] = None  # null without reason
    status = {c["check"]: c["status"] for c in feature_checks(r)}
    assert status["units_suffix"] == "fail"
    assert status["plausible_ranges"] == "fail"
    assert status["evidence_and_missing_metadata"] == "fail"
    assert status["no_synthetic_in_release"] == "fail"


def test_coverage_levels_require_consecutive_stages():
    r = {"aoi": {"body": "earth"}, "features": {"dem_valid_frac": 1.0, "bare_frac": .5},
         "stages": {"dem": {"status": "ok"}, "landcover": {"status": "ok"}, "climate": {"status": "failed"},
                    "geology": {"status": "ok"}}}
    assert coverage_level(r, {"status": "pass"}) == "L1_dem"
    r["stages"]["climate"]["status"] = "ok"
    assert coverage_level(r, {"status": "pass"}) == "L4_validated"
    assert coverage_level(r, {"status": "fail"}) == "L3_geology"
    moon = {"aoi": {"body": "moon"}, "features": {"dem_valid_frac": .95}, "stages": {"dem": {"status": "ok"}}}
    assert coverage_level(moon, {"status": "pass"}) == "L4_validated"
    moon["features"]["dem_valid_frac"] = .5
    assert coverage_level(moon, {"status": "pass"}) == "L0_sampled"


@pytest.mark.parametrize("lon,lat,body", [(-111.6, 35.6, "earth"), (31.7, -85.4, "moon"), (77.45, 18.44, "mars")])
def test_window_ring_is_centred_and_closed(lon, lat, body):
    pts = ring(lon, lat, body)
    assert pts[0] == pts[-1]
    assert np.mean([p[1] for p in pts[:4]]) == pytest.approx(lat, abs=0.05)


def test_utm_round_trip_below_one_metre():
    crs = local_crs((54.2, 43.4), "earth")
    fwd = Transformer.from_crs(4326, crs, always_xy=True)
    back = Transformer.from_crs(crs, 4326, always_xy=True)
    x, y = local_origin((54.2, 43.4), "earth")
    lon, lat = back.transform(x + 10000, y + 10000)
    x2, y2 = fwd.transform(lon, lat)
    assert math.hypot(x2 - x - 10000, y2 - y - 10000) < 1


def test_groups_ids_and_spacing_helpers():
    assert earth_group(-111.6, 35.6) == "EARTH_GN34W112"
    assert earth_group(51.2, 43.4) != earth_group(54.2, 43.4)
    assert tile_origin("Copernicus_DSM_COG_10_S25_00_W070_00_DEM") == (-70, -25)
    assert haversine_km((0, 0), (1, 0)) == pytest.approx(111.19, abs=0.1)


def test_cache_is_resumable_and_checksummed(tmp_path):
    src = tmp_path / "src.bin"
    src.write_bytes(b"x" * 5000)
    dest = tmp_path / "cache" / "out.bin"
    first = fetch(src.as_uri(), dest)
    assert not first["cache_hit"] and first["sha256"] == sha256_file(src)
    assert fetch(src.as_uri(), dest)["cache_hit"]


@pytest.mark.skipif(not (RELEASE / "aoi_catalog.json").exists(), reason="no release built")
def test_published_release_is_valid_and_real():
    assert validate_release(RELEASE) == []
    catalog = json.loads((RELEASE / "aoi_catalog.json").read_text(encoding="utf-8"))
    assert catalog["synthetic"] is False
    assert not any(a["aoi_id"].startswith("FAKE_") for a in catalog["aois"])
    raw = (RELEASE / "aoi_features.csv").read_bytes()
    assert b"\r\n" not in raw
