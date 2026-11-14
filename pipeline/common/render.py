# Written with AI assistance (Codex); human review pending.
"""Comparable grayscale hillshade plus cast shadows for the same Sun geometry."""
from pathlib import Path

import numpy as np
from PIL import Image

from pipeline.common.shadows import cast_shadow


def render_same_sun(z, p, h, az, out):
    z = np.asarray(z, dtype=float)
    shadow = cast_shadow(z, p, h, az)
    gy, gx = np.gradient(z, p)
    altitude, azimuth = np.deg2rad([h, az])
    cosine = (np.sin(altitude) - gx*np.cos(altitude)*np.sin(azimuth)
              + gy*np.cos(altitude)*np.cos(azimuth))/np.sqrt(1 + gx*gx + gy*gy)
    brightness = np.where(shadow, .035, .08 + .92*np.clip(cosine, 0, 1))
    brightness = np.nan_to_num(brightness, nan=0)
    path = Path(out)
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray((255*np.clip(brightness, 0, 1)).astype(np.uint8)).save(path)
    return path
