# Written with AI assistance (Claude Code); reviewed by: pending (Geo lead).
"""Multi-tile source windows and their native-grid caches.

Fixes the single-tile limitation of pipeline.earth.public_dem: a 22 km window
near a 1-degree (DEM) or 3-degree (WorldCover) tile edge is mosaicked from all
intersecting public COG tiles in the SOURCE geographic grid (no resampling;
rasterio.merge with method 'first'). Projection to metric grids is left to
pipeline.planets.access.to_local_grid, which is reused unchanged.
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
import rasterio.enums
import rasterio.errors
from rasterio.crs import CRS
from rasterio.merge import merge

from pipeline.earth.public_cover import tile_url as worldcover_tile_url
from pipeline.earth.public_dem import public_tile_url
from pipeline.geodata.cache import fetch, write_meta
from pipeline.planets.access import AccessError, _source_bounds

GDAL_ENV: dict[str, Any] = dict(GDAL_HTTP_TIMEOUT="90", GDAL_HTTP_MAX_RETRY="3", GDAL_HTTP_RETRY_DELAY="2",
                GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
                VSI_CACHE="TRUE")
COP_TILE_LIST = "https://copernicus-dem-30m.s3.amazonaws.com/tileList.txt"
WGS84 = CRS.from_epsg(4326)


def geographic_bounds(lon: float, lat: float, half_m: float) -> tuple[float, float, float, float]:
    """Lon/lat bounds enclosing the local metric square (densified edges)."""
    return _source_bounds(WGS84, lon, lat, half_m, "earth")


def _cells(bounds, step):
    w, s, e, n = bounds
    xs = range(math.floor(w / step) * step, math.floor(e / step) * step + step, step)
    ys = range(math.floor(s / step) * step, math.floor(n / step) * step + step, step)
    return [(x, y) for y in ys for x in xs]


def copernicus_tiles(cache_dir: Path) -> set[str]:
    """Names of existing GLO-30 tiles (ocean cells have no tile and are legitimately nodata)."""
    path = cache_dir / "copernicus_glo30" / "tileList.txt"
    fetch(COP_TILE_LIST, path)
    return {line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()}


def dem_tile_urls(bounds, available: set[str] | None) -> tuple[list[str], list[str]]:
    """Return (existing tile URLs, absent tile keys) intersecting ``bounds``."""
    urls, absent = [], []
    for x, y in _cells(bounds, 1):
        url = public_tile_url(x + .5, y + .5)
        key = url.rsplit("/", 1)[-1][:-4]
        if available is None or key in available:
            urls.append(url)
        else:
            absent.append(key)
    return urls, absent


def worldcover_tile_urls(bounds) -> list[str]:
    return sorted({worldcover_tile_url(x + 1.5, y + 1.5) for x, y in _cells(bounds, 3)})


def mosaic_window(urls: list[str], bounds, *, dtype="float32", nodata=np.nan):
    """Mosaic the geographic window from several COGs without resampling.

    Returns (array, transform, crs, info). Pixels not covered by any tile stay nodata.
    """
    if not urls:
        raise AccessError("no source tiles intersect the window")
    with rasterio.Env(**GDAL_ENV):
        datasets = []
        try:
            for url in urls:
                try:
                    datasets.append(rasterio.open(url))
                except rasterio.errors.RasterioIOError as exc:
                    raise AccessError(f"cannot open {url}: {exc}") from exc
            crs = {str(d.crs) for d in datasets}
            if len(crs) != 1:
                raise AccessError(f"tiles disagree on CRS: {crs}")
            # Copernicus longitude spacing changes with latitude band; use the finest
            # spacing present and record it (nearest, i.e. no new values are created).
            res = (min(d.res[0] for d in datasets), min(d.res[1] for d in datasets))
            mixed = len({d.res for d in datasets}) > 1
            array, transform = merge(datasets, bounds=bounds, res=res, nodata=nodata, dtype=dtype,
                                     method="first", resampling=rasterio.enums.Resampling.nearest)
            info = {"tiles": urls, "source_res_deg": [float(r) for r in res], "mixed_tile_resolution": mixed,
                    "scales": [float(d.scales[0]) for d in datasets], "offsets": [float(d.offsets[0]) for d in datasets],
                    "source_nodata": [None if d.nodata is None else float(d.nodata) for d in datasets]}
            return array[0], transform, datasets[0].crs, info
        finally:
            for d in datasets:
                d.close()


def write_native(path: Path, array, transform, crs, *, tags: dict, nodata=np.nan) -> dict:
    """Store a source-grid window as deflate GeoTIFF with tags, plus checksum sidecar."""
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_name(path.name + ".part.tif")
    with rasterio.open(part, "w", driver="GTiff", height=array.shape[0], width=array.shape[1], count=1,
                       dtype=array.dtype, crs=crs, transform=transform, nodata=nodata, compress="deflate",
                       tiled=True) as dst:
        dst.write(array, 1)
        dst.update_tags(**{k: str(v) for k, v in tags.items()})
    part.replace(path)
    return write_meta(path, tags.get("source_urls", ""), **{k: v for k, v in tags.items() if k != "source_urls"})


def read_native(path: Path):
    with rasterio.open(path) as src:
        nodata = src.nodata
        array = src.read(1)
        if np.issubdtype(array.dtype, np.floating):
            array = array.astype("float32")
            if nodata is not None and not np.isnan(nodata):
                array[array == nodata] = np.nan
        return array, src.transform, src.crs, src.tags()
