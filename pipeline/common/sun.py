# Written with AI assistance (Codex); human review pending.
"""Vectorized NOAA/Meeus solar geometry. UTC inputs; azimuth clockwise from north.

Atmospheric refraction uses NOAA's standard atmosphere approximation. The lunar
height bound is geometric, not a site illumination model or an ephemeris.
"""
from functools import lru_cache

import numpy as np


def _validate_coords(lat_deg, lon_deg=0):
    if not np.isfinite(lat_deg) or not -90 <= lat_deg <= 90:
        raise ValueError("latitude must be between -90 and 90 degrees")
    if not np.isfinite(lon_deg) or not -180 <= lon_deg <= 180:
        raise ValueError("longitude must be between -180 and 180 degrees")


def _solar_terms(times):
    t = np.asarray(times, dtype="datetime64[ms]")
    if np.any(np.isnat(t)):
        raise ValueError("timestamps must be finite UTC datetimes")
    jd = t.astype(np.int64) / 86400000 + 2440587.5
    c = (jd - 2451545) / 36525
    r = np.deg2rad
    l0 = np.mod(280.46646 + c * (36000.76983 + c * .0003032), 360)
    m = 357.52911 + c * (35999.05029 - .0001537 * c)
    e = .016708634 - c * (.000042037 + .0000001267 * c)
    center = (np.sin(r(m)) * (1.914602 - c * (.004817 + .000014 * c))
              + np.sin(r(2*m)) * (.019993 - .000101*c) + np.sin(r(3*m)) * .000289)
    omega = 125.04 - 1934.136*c
    lam = l0 + center - .00569 - .00478*np.sin(r(omega))
    eps0 = 23 + (26 + (21.448 - c*(46.815 + c*(.00059 - c*.001813)))/60)/60
    eps = eps0 + .00256*np.cos(r(omega))
    decl = np.arcsin(np.sin(r(eps))*np.sin(r(lam)))
    y = np.tan(r(eps)/2)**2
    eot = 4*np.rad2deg(y*np.sin(2*r(l0)) - 2*e*np.sin(r(m))
                      + 4*e*y*np.sin(r(m))*np.cos(2*r(l0))
                      - .5*y*y*np.sin(4*r(l0)) - 1.25*e*e*np.sin(2*r(m)))
    minutes = np.mod(t.astype(np.int64), 86400000) / 60000
    return decl, eot, minutes


def refraction_deg(geometric_altitude_deg):
    """NOAA standard-atmosphere piecewise apparent-height correction."""
    altitude = np.asarray(geometric_altitude_deg, dtype=float)
    correction = np.zeros_like(altitude)
    high = (altitude > 5) & (altitude <= 85)
    tan_h = np.tan(np.deg2rad(altitude[high]))
    correction[high] = 58.1/tan_h - .07/tan_h**3 + .000086/tan_h**5
    near = (altitude > -.575) & (altitude <= 5)
    h = altitude[near]
    correction[near] = 1735 + h*(-518.2 + h*(103.4 + h*(-12.79 + h*.711)))
    below = altitude <= -.575
    correction[below] = -.020772 / np.tan(np.deg2rad(altitude[below])) * 3600
    return correction/3600


def _position(lat_deg, lon_deg, decl, eot, minutes, refraction=True):
    lat = np.deg2rad(lat_deg)
    hour = np.deg2rad(np.mod(minutes + eot + 4*lon_deg, 1440)/4 - 180)
    altitude = np.rad2deg(np.arcsin(np.clip(np.sin(lat)*np.sin(decl)
                        + np.cos(lat)*np.cos(decl)*np.cos(hour), -1, 1)))
    az = np.mod(np.rad2deg(np.arctan2(np.sin(hour), np.cos(hour)*np.sin(lat)
                                     - np.tan(decl)*np.cos(lat))) + 180, 360)
    if refraction:
        altitude = np.clip(altitude + refraction_deg(altitude), -90, 90)
    return altitude, az


def sun_position(lat_deg, lon_deg, t_utc, *, refraction=True):
    """Return apparent altitude and north-clockwise azimuth in degrees."""
    _validate_coords(lat_deg, lon_deg)
    return _position(lat_deg, lon_deg, *_solar_terms(t_utc), refraction=refraction)


def h_max_moon(lat_deg):
    _validate_coords(lat_deg)
    return 90 - abs(lat_deg) + 1.54


def circular_range(azimuths):
    """Smallest enclosing arc; zero for fewer than two observed directions."""
    values = np.sort(np.asarray(azimuths, dtype=float))
    if values.size < 2:
        return 0.0
    return float(360 - np.max(np.diff(np.r_[values, values[0] + 360])))


@lru_cache(maxsize=8)
def _year_terms(year, step_min):
    if not isinstance(step_min, int) or step_min < 1 or 1440 % step_min:
        raise ValueError("step_min must be a positive integer divisor of 1440")
    if not 1900 <= year <= 2100:
        raise ValueError("reference year must be between 1900 and 2100")
    start, end = np.datetime64(f"{year}-01-01"), np.datetime64(f"{year+1}-01-01")
    times = np.arange(start, end, np.timedelta64(step_min, "m"))
    months = (times.astype("datetime64[M]").astype(int) % 12 + 1).reshape(-1, 1440//step_min)[:, 0]
    return _solar_terms(times), months


def lowsun_windows(lat_deg, h_max_deg, year=2025, step_min=10):
    """Daily hours and median daily circular azimuth span, grouped by month.

    All days are sampled at the stated step. No snow or terrain horizon is
    assumed. Longitude zero fixes UTC day boundaries consistently for all bins.
    """
    _validate_coords(lat_deg)
    if not np.isfinite(h_max_deg) or not 0 < h_max_deg <= 90:
        raise ValueError("h_max_deg must be in (0, 90]")
    terms, months = _year_terms(year, step_min)
    h, az = _position(lat_deg, 0, *terms)
    n = 1440//step_min
    low = ((h > 0) & (h <= h_max_deg)).reshape(-1, n)
    daily_hours = low.sum(axis=1) * step_min/60
    # Sort once per daily row, with unused samples at +inf.
    ordered = np.sort(np.where(low, az.reshape(-1, n), np.inf), axis=1)
    count = low.sum(axis=1)
    # All gaps in each enclosing circular arc, vectorized across days. Zero-fill
    # unselected values before differencing to avoid inf-minus-inf warnings.
    selected = np.arange(n)[None, :] < count[:, None]
    ordered = np.where(selected, ordered, 0)
    differences = np.diff(ordered, axis=1)
    differences = np.where(np.arange(n-1)[None, :] < (count-1)[:, None], differences, 0)
    last = ordered[np.arange(len(count)), np.maximum(count-1, 0)]
    wrap_gap = ordered[:, 0] + 360 - last
    daily_sweep = np.where(count > 1, 360 - np.maximum(differences.max(axis=1), wrap_gap), 0)
    return ([round(float(daily_hours[months == m].mean()), 4) for m in range(1, 13)],
            [round(float(np.median(daily_sweep[months == m])), 4) for m in range(1, 13)])
