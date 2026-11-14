import numpy as np
import pytest

from pipeline.common.shadows import cast_shadow, shadow_fraction_curve


def test_plane_has_no_shadow():
    for az in [0, 45, 90, 270]:
        assert not cast_shadow(np.zeros((51, 51)), 30, 5, az).any()


def test_step_shadow_analytic_length_and_mirror():
    z = np.zeros((31, 151))
    z[:, :50] = 100
    shadow = cast_shadow(z, 30, 5, 270)
    expected = 100/np.tan(np.deg2rad(5))/30
    assert shadow[15, 50:].sum() == pytest.approx(expected, abs=1)
    mirrored = cast_shadow(np.fliplr(z), 30, 5, 90)
    np.testing.assert_array_equal(shadow, np.fliplr(mirrored))
    curve = shadow_fraction_curve(z, 30, np.ones_like(z, dtype=bool), [2, 5, 7], [270])
    assert np.all(np.diff(curve[:, 0]) <= 0)


def test_invalid_input():
    with pytest.raises(ValueError):
        cast_shadow(np.zeros((10, 10)), 30, 0, 90)


def test_cardinal_directions_point_away_from_sun():
    z = np.zeros((151, 151))
    z[75, 75] = 100
    for az, destination, opposite in [(0, (90, 75), (60, 75)),
                                      (90, (75, 60), (75, 90)),
                                      (180, (60, 75), (90, 75)),
                                      (270, (75, 90), (75, 60))]:
        mask = cast_shadow(z, 30, 5, az)
        assert mask[destination]
        assert not mask[opposite]
    z[75, 75] = np.nan
    assert not cast_shadow(z, 30, 5, 270).any()
