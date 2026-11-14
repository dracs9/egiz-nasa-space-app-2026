"""Analytical terrain checks. Written with AI assistance (Codex); review pending."""

import numpy as np
import pytest

from pipeline.common.terrain import slope_at_offset, terrain_attributes


@pytest.mark.parametrize("offset", [1, 20])
def test_slope_10_degree_plane_at_metric_baselines(offset):
    z = np.tile(np.arange(440) * 50 * np.tan(np.radians(10)), (440, 1))
    slopes = slope_at_offset(z, 50, offset)
    assert slopes.shape == (440 - 2 * offset, 440 - 2 * offset)
    np.testing.assert_allclose(slopes, 10, atol=1e-10)


def test_horizontal_plane_and_nan_stencil():
    z = np.zeros((11, 11))
    assert np.all(slope_at_offset(z, 50, 1) == 0)
    z[5, 5] = np.nan
    s = slope_at_offset(z, 50, 1)
    assert np.isnan(s).sum() == 5
    assert np.isfinite(s[0, 0])
    assert np.isnan(slope_at_offset(np.full((7, 7), np.nan), 50, 1)).all()


@pytest.mark.parametrize("p,o", [(0, 1), (-1, 1), (1, 0), (1, 1.5), (np.nan, 1), (1, True)])
def test_bad_slope_inputs(p, o):
    with pytest.raises(ValueError):
        slope_at_offset(np.zeros((10, 10)), p, o)


def test_terrain_core_extent_and_percentile_relief():
    p = 50
    z = np.tile(np.arange(440) * p * np.tan(np.radians(5)), (440, 1))
    a = terrain_attributes(z, p)
    assert a["slope_f_p50_deg"] == pytest.approx(5)
    assert a["slope_r_p50_deg"] == pytest.approx(5)
    assert a["frac_lt10_f"] == 1
    assert a["frac_lt20_r"] == 1
    core = z[20:420, 20:420]
    assert a["relief_m"] == pytest.approx(np.percentile(core, 95) - np.percentile(core, 5))
    assert a["elev_min_m"] == pytest.approx(core.min())
    assert a["tri_f_m"] == pytest.approx(0.75 * p * np.tan(np.radians(5)))


def test_known_fraction_fine_window_and_valid_denominator():
    z = np.tile(np.arange(440) * 50 * np.tan(np.radians(5)), (440, 1))
    # 100 m cliff affects two columns in the 200-column fine analysis window.
    z[:, 220:] += 100
    a = terrain_attributes(z, 50)
    assert a["frac_lt10_f"] == pytest.approx(198 / 200)
    z[150:155, 150:155] = np.nan
    # A nodata patch must not become artificial slope=0 observations.
    frac = terrain_attributes(z, 50)["frac_lt10_f"]
    assert frac is not None and frac < 1


def test_missingness_tristate_and_tri_scale():
    rng = np.random.default_rng(2026)
    z = rng.normal(size=(440, 440))
    tri = terrain_attributes(z, 50)["tri_f_m"]
    assert tri is not None
    assert terrain_attributes(2 * z, 50)["tri_f_m"] == pytest.approx(2 * tri)
    z[:300, :] = np.nan
    assert all(v is None for v in terrain_attributes(z, 50).values())
    with pytest.raises(ValueError, match="margin"):
        terrain_attributes(np.zeros((400, 400)), 50)
