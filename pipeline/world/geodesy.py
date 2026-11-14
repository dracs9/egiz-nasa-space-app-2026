"""Spherical body geodesy shared with web/src/world/core/coordinates.ts.

Local frame: azimuthal equidistant (AEQD) map coordinates x (east), y (north)
in metres about the site centre, on the body's reference sphere. Heights are
relative to that sphere (PGDA LOLA products: 1 737 400 m).

World frame: a true Cartesian East-North-Up tangent frame at the site centre.
Converting map+height to ENU applies the body curvature exactly for a sphere,
so the rendered surface, shadows and Sun vector share one Euclidean frame.
"""
from __future__ import annotations

import math

import numpy as np

RADIUS_M = {"moon": 1737400.0, "mars": 3396190.0}


def aeqd_to_enu(x, y, h, radius):
    x, y, h = (np.asarray(v, dtype=np.float64) for v in (x, y, h))
    r = np.hypot(x, y)
    theta = r / radius
    rho = radius + h
    with np.errstate(invalid="ignore", divide="ignore"):
        k = np.where(r > 0, np.sin(theta) / np.where(r > 0, r, 1.0), 1.0 / radius)
    return x * rho * k, y * rho * k, rho * np.cos(theta) - radius


def enu_to_aeqd(e, n, u, radius):
    e, n, u = (np.asarray(v, dtype=np.float64) for v in (e, n, u))
    horizontal = np.hypot(e, n)
    vertical = radius + u
    theta = np.arctan2(horizontal, vertical)
    h = np.hypot(horizontal, vertical) - radius
    with np.errstate(invalid="ignore", divide="ignore"):
        k = np.where(horizontal > 0, radius * theta / np.where(horizontal > 0, horizontal, 1.0),
                     radius / vertical)
    return e * k, n * k, h


def aeqd_to_lonlat(x, y, lon0, lat0, radius):
    """Inverse spherical AEQD (Snyder 1987, eqs. 20-14, 25-15, 25-16)."""
    x, y = np.asarray(x, dtype=np.float64), np.asarray(y, dtype=np.float64)
    phi1, lam0 = math.radians(lat0), math.radians(lon0)
    rho = np.hypot(x, y)
    c = rho / radius
    with np.errstate(invalid="ignore", divide="ignore"):
        lat = np.arcsin(np.cos(c) * math.sin(phi1)
                        + np.where(rho > 0, y * np.sin(c) * math.cos(phi1) / np.where(rho > 0, rho, 1), 0))
        lon = lam0 + np.arctan2(x * np.sin(c),
                                rho * math.cos(phi1) * np.cos(c) - y * math.sin(phi1) * np.sin(c))
    lon = np.where(rho > 0, lon, lam0)
    lat = np.where(rho > 0, lat, phi1)
    return (np.degrees(lon) + 180) % 360 - 180, np.degrees(lat)
