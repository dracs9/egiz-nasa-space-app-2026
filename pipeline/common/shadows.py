# Written with AI assistance (Codex); human review pending.
"""Local DEM shadows; terrain outside the raster cannot occlude the Sun."""
import numpy as np


def cast_shadow(z, p, h_deg, az_deg):
    from scipy.ndimage import rotate

    z = np.asarray(z, dtype=float)
    if z.ndim != 2 or min(z.shape) < 2 or not np.isfinite(p) or p <= 0:
        raise ValueError("z must be a 2D DEM with positive pixel size")
    if not np.isfinite(h_deg) or not 0 < h_deg <= 30 or not 0 <= az_deg < 360:
        raise ValueError("require 0 < h <= 30 and 0 <= az < 360 degrees")
    angle = az_deg - 270
    valid = np.isfinite(z)
    # Rotate numerator and mask separately so nodata never becomes terrain.
    weight = rotate(valid.astype(float), angle, reshape=True, order=1, cval=0, prefilter=False)
    numerator = rotate(np.where(valid, z, 0), angle, reshape=True, order=1, cval=0, prefilter=False)
    rotated = np.full(weight.shape, -np.inf)
    np.divide(numerator, weight, out=rotated, where=weight > .999)
    w = rotated + np.arange(rotated.shape[-1])*p*np.tan(np.deg2rad(h_deg))
    skyline = np.maximum.accumulate(w, axis=1)
    previous = np.full(w.shape, -np.inf)
    previous[:, 1:] = skyline[:, :-1]
    mask = (previous > w + 1e-8) & np.isfinite(rotated)
    back = rotate(mask.astype(np.uint8), -angle, reshape=True, order=0, cval=0, prefilter=False)
    r = (back.shape[0] - z.shape[0])//2
    c = (back.shape[-1] - z.shape[1])//2
    shadow = back[r:r+z.shape[0], c:c+z.shape[1]].astype(bool)
    gy, gx = np.gradient(z, p)
    h, az = np.deg2rad([h_deg, az_deg])
    # Coordinates: columns east; rows south, so north is -y.
    facing = np.sin(h) - gx*np.cos(h)*np.sin(az) + gy*np.cos(h)*np.cos(az)
    return (shadow | (facing < 0)) & valid


def shadow_fraction_curve(z, p, analysis_mask, h_list, az_list):
    mask = np.asarray(analysis_mask, dtype=bool) & np.isfinite(z)
    if mask.shape != np.shape(z) or not mask.any():
        raise ValueError("analysis_mask must select finite pixels in z")
    return np.array([[cast_shadow(z, p, h, az)[mask].mean() for az in az_list] for h in h_list])
