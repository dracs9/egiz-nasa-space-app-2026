"""EGIZ ASTRAL world package: codecs, geodesy, perception models, SPICE parity, package integrity."""
import gzip
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import pytest

from pipeline.world import perception
from pipeline.world.codec import decode_classes, decode_elevation, encode_classes, encode_elevation
from pipeline.world.geodesy import aeqd_to_enu, aeqd_to_lonlat, enu_to_aeqd
from pipeline.world.terrain import PyramidSpec, check_spec, slope_deg, tile_keys

ROOT = Path(__file__).resolve().parents[1]
WORLD = ROOT / "data/world/moon-mons-mouton"
R = 1737400.0


def test_elevation_codec_round_trip_and_nodata():
    rng = np.random.default_rng(1)
    z = 4000 + np.cumsum(rng.normal(0, 0.5, (40, 37)), axis=1)
    z[3, 5] = np.nan
    blob, offset, scale = encode_elevation(z, finest=0.01)
    back = decode_elevation(blob)
    assert np.isnan(back[3, 5])
    ok = np.isfinite(z)
    assert np.abs(back[ok] - z[ok]).max() <= scale / 2 + 1e-9
    assert gzip.decompress(blob)[:4] == b"EGT1"
    # Offsets are snapped to the step, so equal heights decode identically in any tile.
    assert abs(offset / scale - round(offset / scale)) < 1e-6


def test_class_codec_round_trip():
    c = np.arange(30).reshape(5, 6) % 7
    assert (decode_classes(encode_classes(c)) == c).all()


def test_geodesy_round_trip_and_pyproj_parity():
    pyproj = pytest.importorskip("pyproj")
    x, y, h = np.array([1000.0, -7000, 7600]), np.array([2000.0, 6500, -7600]), np.array([5000.0, 4200.5, 6000])
    e, n, u = aeqd_to_enu(x, y, h, R)
    bx, by, bh = enu_to_aeqd(e, n, u, R)
    assert np.allclose([bx, by, bh], [x, y, h], atol=1e-6)
    assert math.isclose(aeqd_to_enu(7680.0, 0.0, 0.0, R)[2], -(7680 ** 2) / (2 * R), rel_tol=1e-4)
    lon0, lat0 = 31.7427611534, -85.4265772804
    t = pyproj.Transformer.from_crs(
        pyproj.CRS.from_proj4(f"+proj=aeqd +lat_0={lat0} +lon_0={lon0} +R={R} +units=m +no_defs"),
        pyproj.CRS.from_proj4(f"+proj=longlat +R={R} +no_defs"), always_xy=True)
    lon, lat = aeqd_to_lonlat(x, y, lon0, lat0, R)
    plon, plat = t.transform(x, y)
    assert np.allclose(lon, plon, atol=1e-9) and np.allclose(lat, plat, atol=1e-9)


def test_pyramid_spec_reaches_native_posting_and_aligns():
    spec = PyramidSpec()
    check_spec(spec)
    assert [spec.posting(lv) for lv in range(spec.levels)] == [160, 80, 40, 20, 10, 5]
    keys = list(tile_keys(spec))
    assert len(keys) == 1 + 4 + 16 + 64 + 36 + 144


def test_slope_matches_analytic_plane():
    yy, xx = np.mgrid[0:20, 0:20] * 5.0
    z = 0.1 * xx + 0.2 * yy
    s = slope_deg(z, 5.0)
    assert np.allclose(s, math.degrees(math.atan(math.hypot(0.1, 0.2))))


def test_log_filter_has_no_elevation_bias():
    z = np.full((60, 60), 5000.0)
    assert np.abs(perception.log_filter(z, 3)).max() < 1e-9


def _synthetic_crater(size=240, cell=5.0, cx=121.0, cy=117.0, d=150.0, depth=15.0):
    yy, xx = np.mgrid[0:size, 0:size].astype(float)
    r = np.hypot(xx - cx, yy - cy) * cell / (d / 2)
    bowl = np.where(r < 1, depth * (r ** 2 - 1), 0.0)
    rim = 0.12 * depth * np.exp(-((r - 1) / 0.25) ** 2)
    tilt = 0.02 * xx * cell
    return 4000 + bowl + rim + tilt


def test_crater_detector_recovers_a_synthetic_analytic_crater():
    """Synthetic analytic fixture (clearly not data): parabolic bowl + Gaussian rim on a tilted plane."""
    z = _synthetic_crater()
    found = perception.detect_multires(z, 5.0)
    assert found, "crater not detected"
    best = min(found, key=lambda c: math.hypot(c["col"] - 121, c["row"] - 117))
    assert math.hypot(best["col"] - 121, best["row"] - 117) * 5 < 12
    assert abs(best["diameter_m"] - 150) / 150 < 0.2
    assert best["depth_to_diameter"] > 0.04


def test_crater_detector_rejects_flat_and_sloped_ground():
    yy, xx = np.mgrid[0:200, 0:200].astype(float)
    assert perception.detect_multires(3000 + 0.1 * xx * 5, 5.0) == []


def test_kmeans_is_deterministic_and_separates_clusters():
    rng = np.random.default_rng(0)
    x = np.vstack([rng.normal(0, 0.1, (200, 2)), rng.normal(3, 0.1, (200, 2))])
    c1, l1, _ = perception.kmeans(x, 2, seed=5)
    c2, l2, _ = perception.kmeans(x, 2, seed=5)
    assert np.array_equal(l1, l2) and np.allclose(c1, c2)
    assert len(set(l1[:200])) == 1 and l1[0] != l1[-1]


def test_spice_series_matches_existing_geometry_engine():
    pytest.importorskip("spiceypy")
    from pipeline.science.spice import geometry
    from pipeline.world.sun import series
    site = {"id": "MOON_MONS_MOUTON", "body": "moon", "lat": -85.4265772804, "lon": 31.7427611534}
    try:
        ours = series(site, "2026-11-14T00:00:00Z", days=0.25, step=3600)
        ref = geometry(site, "2026-11-14T00:00:00Z", duration=21600, step=3600)
    except (OSError, ValueError) as exc:  # kernels missing on a fresh clone
        pytest.skip(f"SPICE kernels unavailable: {exc}")
    for a, b in zip(ours["samples"], ref["samples"]):
        assert np.allclose(a[1:4], b["sunEnu"], atol=1e-8)


@pytest.mark.skipif(not (WORLD / "manifest.json").exists(), reason="world package not built")
def test_world_package_integrity():
    m = json.loads((WORLD / "manifest.json").read_text())
    assert m["schema"] == "egiz.world_manifest" and m["synthetic"] is False
    for t in m["pyramid"]["tiles"]:
        blob = (WORLD / f"tiles/{t['key']}.egt").read_bytes()
        assert hashlib.sha256(blob).hexdigest() == t["sha256"]
    a = decode_elevation((WORLD / "tiles/5/9_9.egt").read_bytes())
    b = decode_elevation((WORLD / "tiles/5/10_9.egt").read_bytes())
    assert a.shape == (99, 99) and np.isfinite(a).all()
    assert np.abs(a[1:-1, -2] - b[1:-1, 1]).max() < 1e-6
    objects = json.loads((WORLD / "objects.json").read_text())["objects"]
    assert all(o["evidenceClass"] in {"model-detected", "computational-hypothesis", "reference"} for o in objects)
    registry = json.loads((WORLD / "registry.json").read_text())["models"]
    assert {"egiz.units.kmeans-geomorph", "egiz.craters.dem-log"} <= {r["id"] for r in registry}
    assert all("incompatible" in r["status"] for r in registry if r["id"].startswith("ibm-"))


@pytest.mark.skipif(not (ROOT / "data/raw/targets/Site20v2_final_adj_5mpp_surf.tif").exists(),
                    reason="source raster not present")
def test_level5_posts_are_native_pixels():
    from pipeline.world.build import SITE_ID, SOURCE, _site  # noqa: F401
    from pipeline.world.terrain import native_grid
    site, spec = _site(), PyramidSpec()
    grid, origin = native_grid(SOURCE, site["lon"], site["lat"], spec)
    t = decode_elevation((WORLD / "tiles/5/9_9.egt").read_bytes())
    m = json.loads((WORLD / "manifest.json").read_text())
    d = next(x for x in m["pyramid"]["tiles"] if x["key"] == "5/9_9")
    c0, r0 = round((d["west"] - origin) / 5), round((-origin - d["north"]) / 5)
    native = grid[r0:r0 + 97, c0:c0 + 97]
    assert np.abs(t[1:-1, 1:-1] - native).max() <= 0.006
