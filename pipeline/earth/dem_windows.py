# Written with AI assistance (Codex); human review pending.
"""Explicit short-list Copernicus DEM window caching for local shadow analysis."""
from pathlib import Path

from pipeline.earth.gee_terrain import download_dem


def cache_windows(tiles, out_dir="data/raw/earth_dem30", *, project=None):
    out = Path(out_dir)
    return [download_dem(t["lon"], t["lat"], p=30, half_m=15000,
                         project=project, out=out/f"{t['id']}.tif") for t in tiles]
