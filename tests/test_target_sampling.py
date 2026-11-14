import numpy as np
import pytest
from rasterio.transform import from_origin

from pipeline.common.terrain import terrain_attributes
from pipeline.planets.access import local_crs, to_local_grid
from pipeline.planets.targets import REGIONAL_KEYS, measure_target_terrain


def test_lunar_regional_metrics_use_same_200m_sampling_as_earth():
    center = (10, -85)
    crs = local_crs(center, "moon")
    affine = from_origin(-11000, 11000, 50, 50)
    y, x = np.mgrid[:440, :440]
    z = (200 * np.sin(x / 2) + .15 * y * 50).astype(np.float32)
    result = measure_target_terrain(z, affine, crs, center, "moon", 100)
    regional_grid = to_local_grid(z, affine, crs, center, "moon", 200, 11000)
    expected = terrain_attributes(regional_grid, 200)
    old = terrain_attributes(z, 50)
    for key in REGIONAL_KEYS:
        assert result[key] == pytest.approx(expected[key], abs=1e-5)
    assert result["slope_f100_p50_deg"] == pytest.approx(old["slope_f_p50_deg"], abs=1e-4)
    assert abs(result["relief_m"] - old["relief_m"]) > 1
