import numpy as np
import pytest

from pipeline.common.sun import (
    circular_range,
    h_max_moon,
    lowsun_windows,
    refraction_deg,
    sun_position,
)


def test_equinox_and_solstice_geometry():
    times = np.array(["2025-03-20T12:00", "2025-06-21T12:00", "2025-06-21T00:00"], dtype="datetime64[m]")
    h, az = sun_position(0, 0, times)
    assert 88 < h[0] < 90
    assert h[1] == pytest.approx(90-23.44, abs=.05)
    assert h[2] < -65
    assert np.all((az >= 0) & (az < 360))
    assert h_max_moon(-85) == pytest.approx(6.54)


def test_timezone_and_longitude_change_solar_time():
    times = np.array(["2025-03-20T06:00", "2025-03-20T12:00"], dtype="datetime64[m]")
    h0, _ = sun_position(0, 90, times[:1])
    h1, _ = sun_position(0, 0, times[1:])
    assert h0[0] == pytest.approx(h1[0], abs=.05)


def test_windows_polar_night_and_high_latitude_duration():
    equator, _ = lowsun_windows(0, 7)
    mid, _ = lowsun_windows(45, 7)
    polar, _ = lowsun_windows(77.5, 7)
    assert .8 < equator[2] < 1.15  # NOAA apparent altitude and 10 min discretization
    assert polar[2] > mid[2] > equator[2]
    assert polar[0] == 0
    assert len(polar) == 12
    assert circular_range([355, 0, 5]) == 10
    with pytest.raises(ValueError):
        lowsun_windows(0, 0)
    with pytest.raises(ValueError):
        sun_position(91, 0, times := np.array(["2025-01-01"], dtype="datetime64[D]"))
    assert len(times) == 1


def test_against_astropy_above_five_degrees():
    u = pytest.importorskip("astropy.units")
    from astropy.coordinates import AltAz, EarthLocation, get_sun
    from astropy.time import Time
    from astropy.utils import iers
    iers.conf.auto_download = False
    times = np.arange(np.datetime64("2025-01-01"), np.datetime64("2026-01-01"), np.timedelta64(31, "h")).astype("datetime64[s]")
    for lat in [-77.5, 0, 45, 77.5]:
        h, _ = sun_position(lat, 0, times)
        frame = AltAz(obstime=Time(times), location=EarthLocation(lat=lat*u.deg, lon=0*u.deg),
                      pressure=1013.25*u.hPa, temperature=15*u.deg_C)
        reference = get_sun(Time(times)).transform_to(frame).alt.deg
        assert np.max(np.abs(h[h > 5]-reference[h > 5])) < .1


def test_reference_full_preregistered_e1_grid():
    u = pytest.importorskip("astropy.units")
    from astropy.coordinates import AltAz, EarthLocation, get_sun
    from astropy.time import Time
    from astropy.utils import iers
    iers.conf.auto_download = False
    days = ["2025-03-20", "2025-06-21", "2025-09-22", "2025-12-21"]
    times = np.concatenate([np.arange(np.datetime64(day), np.datetime64(day)+np.timedelta64(1, "D"),
                                     np.timedelta64(30, "m")) for day in days]).astype("datetime64[s]")
    for lat in [-80, -77.5, -45, 0, 45, 70, 80]:
        h, az = sun_position(lat, 0, times, refraction=False)
        frame = AltAz(obstime=Time(times), location=EarthLocation(lat=lat*u.deg, lon=0*u.deg), pressure=0*u.hPa)
        reference = get_sun(Time(times)).transform_to(frame)
        mask = h > 1
        assert np.max(np.abs(h[mask]-reference.alt.deg[mask])) < .1
        delta_az = np.abs((az-reference.az.deg+180) % 360-180)
        assert np.max(delta_az[mask]) < .1


def test_reference_noaa_refraction_five_control_altitudes():
    # NOAA polynomial and tangent branches, evaluated independently as constants.
    correction = refraction_deg(np.array([-1., 0., 1., 5., 90.]))
    np.testing.assert_allclose(correction, [.020772/np.tan(np.deg2rad(1)), 1735/3600,
                                          1308.121/3600, 574.625/3600, 0], atol=1e-8)
