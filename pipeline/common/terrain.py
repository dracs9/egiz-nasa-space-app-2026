"""Common metric-baseline terrain measurements.

Written with AI assistance (Codex); human review pending.
Heights and grid spacing are metres, slope results are degrees. No interpolation
is performed here: the caller must provide a metric, square-pixel DEM.
"""

from __future__ import annotations

import math

import numpy as np

TERRAIN_KEYS = (
    "slope_f_p50_deg", "slope_f_p90_deg", "frac_lt10_f", "frac_lt20_f",
    "tri_f_m", "slope_r_p50_deg", "slope_r_p90_deg", "frac_lt20_r",
    "relief_m", "elev_min_m",
)


def _grid(z, p):
    z = np.asarray(z, dtype=float)
    if z.ndim != 2 or not math.isfinite(p) or p <= 0:
        raise ValueError("DEM must be 2-D and pixel spacing p must be positive and finite")
    # Infinite elevations are missing data, just like NaN.
    return np.where(np.isfinite(z), z, np.nan)


def slope_at_offset(z: np.ndarray, p: float, o: int) -> np.ndarray:
    """Central-difference slope with baseline ``2 * o * p``.

    Only the cross-shaped difference stencil (and its centre) propagates nodata;
    unrelated pixels inside its bounding square do not contaminate the result.
    """
    z = _grid(z, p)
    if isinstance(o, bool) or not isinstance(o, (int, np.integer)) or o < 1:
        raise ValueError("Offset o must be a positive integer")
    if min(z.shape) <= 2 * o:
        raise ValueError("DEM dimensions must exceed twice the offset")
    gx = (z[o:-o, 2 * o:] - z[o:-o, :-2 * o]) / (2 * o * p)
    gy = (z[2 * o:, o:-o] - z[:-2 * o, o:-o]) / (2 * o * p)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    slope[~np.isfinite(z[o:-o, o:-o])] = np.nan
    return slope


def _central(array: np.ndarray, side: int) -> np.ndarray:
    if side < 1 or min(array.shape) < side:
        raise ValueError("DEM does not cover the requested central analysis window")
    y = (array.shape[0] - side) // 2
    x = (array.shape[1] - side) // 2
    return array[y:y + side, x:x + side]


def _percentile(a, q):
    valid = a[np.isfinite(a)]
    return float(np.percentile(valid, q)) if valid.size else None


def _fraction(a, threshold):
    valid = a[np.isfinite(a)]
    return float(np.mean(valid < threshold)) if valid.size else None


def terrain_attributes(
    z: np.ndarray, p: float, fine_offset: int = 1,
    regional_baseline_m: float = 2000,
) -> dict[str, float | None]:
    """Measure fine terrain on 10 km and regional terrain on 20 km cores.

    A margin of half the regional baseline is required around the 20 km core.
    Fractions use only valid slope pixels, never counting nodata as flat terrain.
    TRI requires all eight neighbouring elevations to be present.
    """
    z = _grid(z, p)
    if not math.isfinite(regional_baseline_m) or regional_baseline_m <= 0:
        raise ValueError("Regional baseline must be positive and finite")
    regional_offset = max(1, int(round(regional_baseline_m / (2 * p))))
    core_side = int(round(20000 / p))
    fine_side = int(round(10000 / p))
    required_offset = max(regional_offset, fine_offset, 1)
    if min(z.shape) < core_side + 2 * required_offset:
        raise ValueError("DEM must cover 20 km plus the required terrain margin")
    core = _central(z, core_side)
    empty: dict[str, float | None] = dict.fromkeys(TERRAIN_KEYS)
    if np.isfinite(core).mean() < 0.5:
        return empty
    sf = _central(slope_at_offset(z, p, fine_offset), fine_side)
    sr = _central(slope_at_offset(z, p, regional_offset), core_side)
    centre = z[1:-1, 1:-1]
    differences = [np.abs(z[dy:dy + centre.shape[0], dx:dx + centre.shape[1]] - centre)
                   for dy in range(3) for dx in range(3) if (dy, dx) != (1, 1)]
    tri = _central(np.mean(differences, axis=0), fine_side)
    lo, hi = _percentile(core, 5), _percentile(core, 95)
    return {
        "slope_f_p50_deg": _percentile(sf, 50),
        "slope_f_p90_deg": _percentile(sf, 90),
        "frac_lt10_f": _fraction(sf, 10), "frac_lt20_f": _fraction(sf, 20),
        "tri_f_m": _percentile(tri, 50),
        "slope_r_p50_deg": _percentile(sr, 50),
        "slope_r_p90_deg": _percentile(sr, 90),
        "frac_lt20_r": _fraction(sr, 20),
        "relief_m": hi - lo if lo is not None and hi is not None else None,
        "elev_min_m": float(np.nanmin(core)),
    }
