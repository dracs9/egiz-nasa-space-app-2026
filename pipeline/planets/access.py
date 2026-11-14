# Written with AI assistance (Codex); human review pending.
"""Windowed GeoTIFF/COG access, including planetary coordinate systems.

Local paths and HTTPS sources work through rasterio/GDAL. No global raster is
downloaded implicitly. The CLI can explicitly cache a remote product.
"""
import argparse
import json
import math
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
import rasterio.errors
from pyproj import CRS, Transformer
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.warp import reproject
from rasterio.windows import Window, from_bounds
from rasterio.windows import transform as window_transform

RADII_M = {"moon": 1737400, "mars": 3396190}
PRODUCTS = {
    "PGDA_SITE20": "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site20/Site20_final_adj_5mpp_surf.tif",
    "PGDA_SITE01": "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site01/Site01_final_adj_5mpp_surf.tif",
}


class AccessError(RuntimeError):
    """A required real raster could not be read; no replacement is generated."""


def local_crs(center, body):
    lon, lat = center
    if body not in {*RADII_M, "earth"} or not (-180 <= lon <= 180 and -90 <= lat <= 90):
        raise ValueError("invalid body or center (longitude, latitude)")
    if body == "earth":
        from pipeline.earth.pool import utm_epsg
        return CRS.from_epsg(utm_epsg(lon, lat))
    datum = f"+R={RADII_M[body]}"
    return CRS.from_proj4(f"+proj=aeqd +lat_0={lat} +lon_0={lon} {datum} +units=m +no_defs")


def local_origin(center, body):
    if body != "earth":
        return 0, 0
    crs = local_crs(center, body)
    return Transformer.from_crs(4326, crs, always_xy=True).transform(*center)


def _source_bounds(crs, lon, lat, half_m, body):
    local = local_crs((lon, lat), body)
    tr = Transformer.from_crs(local, CRS.from_user_input(crs), always_xy=True)
    a = np.linspace(-half_m, half_m, 21)
    x = np.r_[a, a, np.full_like(a, -half_m), np.full_like(a, half_m)]
    y = np.r_[np.full_like(a, -half_m), np.full_like(a, half_m), a, a]
    x0, y0 = local_origin((lon, lat), body)
    xx, yy = tr.transform(x + x0, y + y0)
    return min(xx), min(yy), max(xx), max(yy)


def read_window(product, lon, lat, half_m, body):
    """Read a metric square in a raster's native grid; return z, affine, CRS.

    Pixel values are assumed to be elevations in metres; scaled rasters must
    supply their correct GDAL scale/offset metadata. Missing pixels become NaN.
    """
    if not math.isfinite(half_m) or half_m <= 0:
        raise ValueError("half_m must be positive")
    source = PRODUCTS.get(str(product), str(product))
    try:
        with rasterio.Env(GDAL_HTTP_TIMEOUT="90", GDAL_HTTP_MAX_RETRY="2"):
            with rasterio.open(source) as src:
                if src.crs is None:
                    raise AccessError(f"DEM has no CRS: {source}")
                bounds = _source_bounds(src.crs, lon, lat, half_m, body)
                float_window = from_bounds(*bounds, transform=src.transform)
                c0, r0 = math.floor(float_window.col_off), math.floor(float_window.row_off)
                c1 = math.ceil(float_window.col_off + float_window.width)
                r1 = math.ceil(float_window.row_off + float_window.height)
                # rasterio's legacy attr.s class is opaque to static checkers.
                window = Window(c0, r0, c1-c0, r1-r0)  # pyright: ignore[reportCallIssue]
                if window.width*window.height > 100_000_000:
                    raise AccessError("requested source window exceeds 100 million pixels")
                z = src.read(1, window=window, boundless=True, masked=True, out_dtype="float32")
                z = z.filled(np.nan)*src.scales[0] + src.offsets[0]
                if not np.isfinite(z).any():
                    raise AccessError(f"requested window has no valid DEM pixels: {source}")
                return z, window_transform(window, src.transform), src.crs
    except AccessError:
        raise
    except (rasterio.errors.RasterioError, ValueError, OSError) as exc:
        raise AccessError(f"cannot read {source}: {exc}") from exc


def to_local_grid(z, transform, crs, center, body, p, half_m):
    """Average onto a north-up local grid (Earth UTM, planets AEQD)."""
    if not np.isfinite(p) or p <= 0 or half_m <= 0:
        raise ValueError("p and half_m must be positive")
    size = math.ceil(2*half_m/p)
    if size*size > 100_000_000:
        raise ValueError("requested grid exceeds 100 million pixels")
    destination = np.full((size, size), np.nan, dtype=np.float32)
    x0, y0 = local_origin(center, body)
    dst_transform = from_origin(x0-half_m, y0+half_m, p, p)
    dst_crs = local_crs(center, body)
    z = np.asarray(z, dtype=np.float32)
    kwargs: dict[str, Any] = dict(src_transform=transform, src_crs=crs,
                  dst_transform=dst_transform, dst_crs=dst_crs,
                  resampling=Resampling.average)
    reproject(z, destination, src_nodata=np.nan, dst_nodata=np.nan, **kwargs)
    # Average resampling normally ignores missing source pixels. Reproject a
    # separate validity grid to enforce the scientific all-valid footprint rule.
    coverage = np.zeros(destination.shape, dtype=np.float32)
    reproject(np.isfinite(z).astype(np.float32), coverage, dst_nodata=0, **kwargs)
    destination[coverage < 1 - 1e-6] = np.nan
    return destination


def download_product(product, out):
    """Explicitly cache a product with atomic replacement and bounded timeout."""
    source = PRODUCTS.get(str(product), str(product))
    if not source.startswith("https://"):
        raise AccessError("downloads require an HTTPS product URL")
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    temporary = out.with_suffix(out.suffix + ".part")
    try:
        with urllib.request.urlopen(source, timeout=90) as response, temporary.open("wb") as dst:
            while chunk := response.read(1024*1024):
                dst.write(chunk)
        temporary.replace(out)
    except (OSError, urllib.error.URLError) as exc:
        temporary.unlink(missing_ok=True)
        raise AccessError(f"download failed for {source}: {exc}") from exc
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    spike = sub.add_parser("spike", help="read and report a real raster window")
    spike.add_argument("product")
    spike.add_argument("--lon", type=float, required=True)
    spike.add_argument("--lat", type=float, required=True)
    spike.add_argument("--body", choices=["moon", "mars", "earth"], required=True)
    spike.add_argument("--half-m", type=float, default=11000)
    get = sub.add_parser("download")
    get.add_argument("product")
    get.add_argument("out")
    args = parser.parse_args()
    try:
        if args.command == "download":
            print(download_product(args.product, args.out))
        else:
            z, _, crs = read_window(args.product, args.lon, args.lat, args.half_m, args.body)
            print(json.dumps({"shape": list(z.shape), "valid_fraction": float(np.isfinite(z).mean()),
                              "min_m": float(np.nanmin(z)), "max_m": float(np.nanmax(z)), "crs": str(crs)}))
    except AccessError as exc:
        parser.exit(2, f"Real DEM unavailable: {exc}\n")


if __name__ == "__main__":
    main()
