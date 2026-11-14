# Written with AI assistance (Codex); human review pending.
import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from pipeline.planets.access import AccessError, local_crs, local_origin, read_window, to_local_grid


def test_local_planetary_window_center_and_pixel_size(tmp_path):
    path = tmp_path/"synthetic_unit_test.tif"
    crs = local_crs((10, -85), "moon")
    z = np.arange(10000, dtype=np.float32).reshape(100, 100)
    transform = from_origin(-5000, 5000, 100, 100)
    with rasterio.open(path, "w", driver="GTiff", width=100, height=100, count=1,
                       dtype="float32", transform=transform, crs=crs, nodata=np.nan) as dst:
        dst.write(z, 1)
    window, tr, source_crs = read_window(str(path), 10, -85, 2000, "moon")
    assert window.shape == (40, 40)
    assert tr.a == 100 and tr.e == -100
    local = to_local_grid(window, tr, source_crs, (10, -85), "moon", 200, 2000)
    assert local.shape == (20, 20)
    assert np.isfinite(local).all()
    assert local[0, 0] == pytest.approx(np.mean(z[30:32, 30:32]), abs=.01)


def test_nodata_is_not_averaged_away():
    crs = local_crs((0, 0), "earth")
    x0, y0 = local_origin((0, 0), "earth")
    z = np.ones((10, 10), dtype=np.float32)
    z[4, 4] = np.nan
    local = to_local_grid(z, from_origin(x0-500, y0+500, 100, 100), crs, (0, 0), "earth", 200, 500)
    assert np.isnan(local[2, 2])


def test_missing_source_fails_without_fake_fallback(tmp_path):
    with pytest.raises(AccessError, match="cannot read"):
        read_window(str(tmp_path/"missing.tif"), 0, 0, 1000, "mars")


def test_partially_missing_source_stays_invalid_after_projection():
    crs = local_crs((0, 0), "earth")
    x0, y0 = local_origin((0, 0), "earth")
    z = np.ones((10, 10), dtype=np.float32)
    z[:, :4] = np.nan
    out = to_local_grid(z, from_origin(x0-500, y0+500, 100, 100), crs, (0, 0), "earth", 200, 500)
    assert np.isnan(out[:, :2]).all()
    assert np.isfinite(out[:, 2:]).all()
