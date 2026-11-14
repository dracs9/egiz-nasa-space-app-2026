# Written with AI assistance (Codex); human review pending.
"""Credential-free Copernicus GLO-30 public COG subset acquisition.

This is the documented fallback for a small number of windows, not a substitute
for the preregistered global sampling or MODIS/GPM environment observations.
"""
import argparse
import math
from pathlib import Path

import numpy as np
import rasterio

from pipeline.planets.access import AccessError, read_window


def public_tile_url(lon, lat):
    x, y = math.floor(lon), math.floor(lat)
    key = f"Copernicus_DSM_COG_10_{'N' if y >= 0 else 'S'}{abs(y):02d}_00_{'E' if x >= 0 else 'W'}{abs(x):03d}_00_DEM"
    return f"https://copernicus-dem-30m.s3.amazonaws.com/{key}/{key}.tif"


def cache_public_window(lon, lat, out, half_m=11000):
    """Read a COG subset and retain original CRS; reject edge-truncated windows.

    A window crossing the one-degree tile boundary needs a local mosaic supplied
    through earth.export; it is not silently treated as complete.
    """
    source = public_tile_url(lon, lat)
    z, transform, crs = read_window(source, lon, lat, half_m, "earth")
    valid = float(np.isfinite(z).mean())
    if valid < .999:
        raise AccessError(f"public source window valid fraction {valid:.3f}; supply adjacent-tile mosaic")
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(out, "w", driver="GTiff", height=z.shape[0], width=z.shape[1], count=1,
                       dtype="float32", crs=crs, transform=transform, nodata=np.nan, compress="deflate") as dst:
        dst.write(z, 1)
        dst.update_tags(source_url=source, dataset="Copernicus DEM GLO-30 Public 2021", synthetic="false")
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lon", type=float, required=True)
    parser.add_argument("--lat", type=float, required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    try:
        print(cache_public_window(args.lon, args.lat, args.out))
    except (ValueError, AccessError, OSError) as exc:
        parser.exit(2, f"Public DEM acquisition blocked: {exc}\n")


if __name__ == "__main__":
    main()
