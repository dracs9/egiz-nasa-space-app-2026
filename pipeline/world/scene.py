"""Build a measured multi-resolution world package (EGIZ ASTRAL Planetary World Core).

python -m pipeline.world.scene mars-jezero

Every height and image value is resampled from the fingerprinted source window.
No displacement noise, gap filling or super-resolution. Coarser levels are area
averages of the finest measured grid; missing source pixels stay missing.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import CRS, Transformer
from scipy.ndimage import map_coordinates, uniform_filter

from pipeline.world.remote_tiff import fetch, parse_directory, read_window

ROOT = Path(__file__).resolve().parents[2]
SCHEMA, VERSION = "egiz.world_scene", "1.0.0"
POSTS, IMAGE_PX, NODATA, HEIGHT_SCALE = 128, 512, -32768, 0.02
USGS = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/"
SITES = {
    "mars-jezero": {
        "id": "MARS_JEZERO", "name": "Jezero crater floor / Octavia E. Butler landing site", "body": "mars",
        "lat": 18.4446, "lon": 77.4509, "radius_m": 3396190.0, "half_m": 1024.0, "levels": 5,
        "frame": "IAU_MARS (spherical, planetocentric latitude, east-positive longitude)",
        "source_crs": "+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=0 +R=3396190 +units=m +no_defs",
        "dtm": {
            "product": "Mars 2020 Terrain Relative Navigation HiRISE DTM mosaic, 1 m/px",
            "url": USGS + "JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif",
            "landing_page": "https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_hirise_dtm_mosaic",
            "citation": "Fergason et al. 2020, USGS Astrogeology Science Center, doi:10.5066/P9REJ9JN",
            "pixel_m": 1.0, "nodata_below": -1e30,
            "vertical_datum": "Elevation above the Mars areoid (MOLA topography, DeltaGeoid product)",
            "kind": "stereo-derived reconstruction (HiRISE photogrammetry tied to CTX/HRSC/MOLA)",
        },
        "ortho": {
            "product": "Mars 2020 Terrain Relative Navigation HiRISE orthorectified image mosaic, 25 cm/px",
            "url": USGS + "JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first.tif",
            "landing_page": "https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_hirise_orthorectified_image_mosaic",
            "citation": "Fergason et al. 2020, USGS Astrogeology Science Center, doi:10.5066/P9QJDP48",
            "pixel_m": 0.25, "nodata": 0,
            "kind": "orbital panchromatic (HiRISE RED) orthoimage; 8-bit relative brightness, not calibrated albedo or color",
        },
    },
}


def local_proj(site: dict) -> str:
    return f"+proj=aeqd +lat_0={site['lat']} +lon_0={site['lon']} +R={site['radius_m']:.0f} +units=m +no_defs"


def local_crs(site: dict) -> CRS:
    return CRS.from_proj4(local_proj(site))


def source_window(site: dict, info: dict, pixel_m: float, margin_m: float) -> tuple[int, int, int, int]:
    """Source pixel window enclosing the local square plus margin."""
    to_source = Transformer.from_crs(local_crs(site), CRS.from_proj4(site["source_crs"]), always_xy=True)
    edge = np.linspace(-site["half_m"] - margin_m, site["half_m"] + margin_m, 33)
    east, north = np.meshgrid(edge, edge)
    x, y = to_source.transform(east.ravel(), north.ravel())
    x0, y0 = info["tiepoint"][3], info["tiepoint"][4]
    col0, col1 = math.floor((min(x) - x0) / pixel_m) - 2, math.ceil((max(x) - x0) / pixel_m) + 2
    row0, row1 = math.floor((y0 - max(y)) / pixel_m) - 2, math.ceil((y0 - min(y)) / pixel_m) + 2
    return col0, row0, col1 - col0, row1 - row0


def resample(site: dict, source: np.ndarray, origin: tuple[float, float], pixel_m: float,
             east: np.ndarray, north: np.ndarray) -> np.ndarray:
    """Bilinear resampling of a source window at local east/north vectors (north-up output)."""
    to_source = Transformer.from_crs(local_crs(site), CRS.from_proj4(site["source_crs"]), always_xy=True)
    out = np.empty((len(north), len(east)), np.float32)
    for start in range(0, len(north), 256):  # bounded memory for the 8192² image
        e, n = np.meshgrid(east, north[start:start + 256])
        x, y = to_source.transform(e, n)
        cols, rows = (x - origin[0]) / pixel_m - 0.5, (origin[1] - y) / pixel_m - 0.5
        out[start:start + 256] = map_coordinates(source, [rows, cols], order=1, mode="constant", cval=np.nan, prefilter=False)
    return out


def box_mean(values: np.ndarray, size: int) -> np.ndarray:
    """NaN-propagating centred box mean of odd width; identity for size 1."""
    if size <= 1:
        return values
    valid = np.isfinite(values)
    total = uniform_filter(np.where(valid, values, 0).astype(np.float64), size=size, mode="nearest")
    weight = uniform_filter(valid.astype(np.float64), size=size, mode="nearest")
    return np.where(weight > 1 - 1e-9, total, np.nan).astype(np.float32)


def quantize(heights: np.ndarray, offset: float, scale: float = HEIGHT_SCALE) -> np.ndarray:
    q = np.round((heights - offset) / scale)
    if np.nanmax(np.abs(q)) > 32767:
        raise ValueError("relief exceeds the int16 height encoding range")
    return np.where(np.isfinite(q), q, NODATA).astype("<i2")


def fetch_sources(site: dict, cache: Path) -> dict:
    """Fetch (or reuse fingerprinted cache of) the two source windows."""
    cache.mkdir(parents=True, exist_ok=True)
    out = {}
    for name, margin in (("dtm", 48.0), ("ortho", 8.0)):
        product = site[name]
        info = parse_directory(lambda start, length, url=product["url"]: fetch(url, start, length))
        window = source_window(site, info, product["pixel_m"], margin)
        path = cache / f"{name}_{'_'.join(map(str, window))}.npy"
        if not path.exists():
            print(f"fetching {name} window {window} from {product['url']}")
            np.save(path, read_window(product["url"], *window))
        data = np.load(path)
        origin = (info["tiepoint"][3] + window[0] * product["pixel_m"], info["tiepoint"][4] - window[1] * product["pixel_m"])
        out[name] = {"data": data, "origin": origin, "window": window,
                     "sha256": hashlib.sha256(np.ascontiguousarray(data).tobytes()).hexdigest()}
    return out


def build_package(site: dict, dtm: np.ndarray, dtm_origin, ortho: np.ndarray | None, ortho_origin, folder: Path) -> dict:
    """Write tiles for prepared source windows; returns the manifest body (no source hashes)."""
    half, levels = site["half_m"], site["levels"]
    coarse_post = 2 * half / POSTS  # level-0 posting, metres
    fine_post = coarse_post / 2 ** (levels - 1)
    apron = coarse_post * 2
    axis = np.arange(-half - apron, half + apron + fine_post / 2, fine_post)
    source = dtm.astype(np.float32)
    source[source < site["dtm"]["nodata_below"]] = np.nan
    fine = resample(site, source, dtm_origin, site["dtm"]["pixel_m"], axis, axis[::-1])
    core = fine[int(apron / fine_post):-int(apron / fine_post), int(apron / fine_post):-int(apron / fine_post)]
    if not np.isfinite(core).any():
        raise ValueError("source window contains no valid elevation")
    offset = float(round(float(np.nanmean(core)), 1))
    image = None
    if ortho is not None:
        fine_px = 2 * half / IMAGE_PX / 2 ** (levels - 1)
        centers = -half + (np.arange(round(2 * half / fine_px)) + 0.5) * fine_px
        raw = ortho.astype(np.float32)
        raw[raw == site["ortho"]["nodata"]] = np.nan
        image = resample(site, raw, ortho_origin, site["ortho"]["pixel_m"], centers, centers[::-1])
    (folder / "h").mkdir(parents=True, exist_ok=True)
    (folder / "img").mkdir(parents=True, exist_ok=True)
    tiles = []
    for level in range(levels):
        step = 2 ** (levels - 1 - level)  # fine posts per level post
        smooth = box_mean(fine, step + 1 if step > 1 else 1)
        size = 2 * half / 2 ** level
        if image is not None:
            n = image.shape[0] // step
            with np.errstate(invalid="ignore"):
                reduced = np.nanmean(image.reshape(n, step, n, step), axis=(1, 3)) if step > 1 else image
        for row in range(2 ** level):
            for col in range(2 ** level):
                west, north = -half + col * size, half - row * size
                r0 = round((half + apron - north) / fine_post) - step
                c0 = round((west + half + apron) / fine_post) - step
                block = smooth[r0:r0 + (POSTS + 2) * step + 1:step, c0:c0 + (POSTS + 2) * step + 1:step]
                payload = quantize(block, offset, site.get("height_scale", HEIGHT_SCALE)).tobytes()
                key = f"{level}-{col}-{row}"
                (folder / "h" / f"{key}.bin").write_bytes(payload)
                tile = {"key": key, "level": level, "col": col, "row": row, "west": west, "north": north, "size": size,
                        "posting_m": size / POSTS, "valid_fraction": round(float(np.isfinite(block[1:-1, 1:-1]).mean()), 4),
                        "min_m": None, "max_m": None,
                        "height_sha256": hashlib.sha256(payload).hexdigest(), "height_bytes": len(payload)}
                if np.isfinite(block).any():
                    tile["min_m"], tile["max_m"] = round(float(np.nanmin(block)), 2), round(float(np.nanmax(block)), 2)
                if image is not None:
                    px = reduced[row * IMAGE_PX:(row + 1) * IMAGE_PX, col * IMAGE_PX:(col + 1) * IMAGE_PX]
                    buffer = io.BytesIO()
                    Image.fromarray(np.nan_to_num(px, nan=0).round().clip(0, 255).astype(np.uint8), "L").save(buffer, "JPEG", quality=84)
                    (folder / "img" / f"{key}.jpg").write_bytes(buffer.getvalue())
                    tile.update(image_px_m=size / IMAGE_PX, image_sha256=hashlib.sha256(buffer.getvalue()).hexdigest(),
                                image_bytes=buffer.tell())
                tiles.append(tile)
    return {
        "schema": SCHEMA, "version": VERSION, "synthetic": False,
        "site": {"id": site["id"], "name": site["name"], "body": site["body"], "lat": site["lat"], "lon": site["lon"],
                 "radius_m": site["radius_m"], "frame": site["frame"]},
        "local_crs": local_proj(site),
        "local_axes": "x east, y north, metres from site origin; heights in metres above the source vertical datum",
        "extent": {"west": -half, "east": half, "south": -half, "north": half},
        "encoding": {"posts": POSTS, "apron": 1, "side": POSTS + 3, "dtype": "int16-le", "scale_m": site.get("height_scale", HEIGHT_SCALE),
                     "offset_m": offset, "nodata": NODATA, "image_px": IMAGE_PX if image is not None else None,
                     "row_order": "north to south",
                     "note": f"{site.get('height_scale', HEIGHT_SCALE)} m steps are serialization, not measurement precision"},
        "levels": [{"level": lv, "tiles_per_side": 2 ** lv, "tile_size_m": 2 * half / 2 ** lv,
                    "posting_m": 2 * half / 2 ** lv / POSTS,
                    "image_px_m": 2 * half / 2 ** lv / IMAGE_PX if image is not None else None,
                    "provenance": "measured" if lv == levels - 1 else "measured-area-average"} for lv in range(levels)],
        "tiles": tiles,
        "method": ("Source window read by exact byte range; bilinear resampling to a local azimuthal-equidistant grid at "
                   f"{fine_post:g} m posts; coarser levels are centred box means of that grid; imagery is block-averaged. "
                   "Tiles carry a one-post apron so normals are continuous across tile edges."),
        "limitations": [
            "Finest geometry equals the source DTM posting; features smaller than about 3-4 posts are not resolved.",
            "Stereo DTMs contain interpolation artifacts in low-texture or shadowed areas; no per-pixel error map is published.",
            "Imagery is single-band relative brightness under one illumination; it is not color and not calibrated albedo.",
            "No subsurface, mechanical soil property or mineralogy is contained in these products.",
        ],
    }


def build(name: str) -> Path:
    site = SITES[name]
    sources = fetch_sources(site, ROOT / "data/raw/world" / name)
    folder = ROOT / "data/world" / name
    manifest = build_package(site, sources["dtm"]["data"], sources["dtm"]["origin"],
                             sources["ortho"]["data"], sources["ortho"]["origin"], folder)
    manifest["sources"] = {key: {**{k: v for k, v in site[key].items() if k not in {"nodata", "nodata_below"}},
                                 "source_window_px": dict(zip(["col", "row", "width", "height"], sources[key]["window"])),
                                 "window_sha256": sources[key]["sha256"]} for key in ("dtm", "ortho")}
    manifest["illumination"] = {"engine": "NASA CSPICE via SpiceyPy (pipeline.science.spice)",
                                "record": "data/pilot/spice_geometry.json", "site_id": site["id"]}
    path = folder / "manifest.json"
    path.write_text(json.dumps(manifest, allow_nan=False, separators=(",", ":")) + "\n")
    total = sum(t["height_bytes"] + t.get("image_bytes", 0) for t in manifest["tiles"])
    print(f"{name}: {len(manifest['tiles'])} tiles, {total / 1e6:.1f} MB, offset {manifest['encoding']['offset_m']} m")
    return path


# ----------------------------------------------------------------------------- Earth analog worlds

EARTH_R = 6371008.8
GLO30_PIXEL_M = 30.0


def earth_site(window_id: str) -> dict:
    """World site for an Earth window of the discovery index (or geo-0.1.0), on Copernicus GLO-30."""
    from pipeline.discovery.fingerprint import load_windows
    w = next((x for x in load_windows() if x.id == window_id and x.body == "earth"), None)
    if w is None:
        raise KeyError(f"{window_id} is not an Earth window of the discovery index")
    return {
        "id": f"EARTH_{window_id}", "name": f"Earth analog {w.name}", "body": "earth", "lat": round(w.lat, 6),
        "lon": round(w.lon, 6), "radius_m": EARTH_R, "half_m": 8192.0, "levels": 3, "height_scale": 0.05,
        "frame": "WGS84 geodetic lat/lon; local azimuthal equidistant on a 6371008.8 m sphere",
        "dtm": {"product": "Copernicus DEM GLO-30 Public 2021 (digital surface model, 1 arcsec)",
                "url": "https://registry.opendata.aws/copernicus-dem/",
                "citation": "European Space Agency (2021) Copernicus Global Digital Elevation Model, doi:10.5270/ESA-c5d3d65",
                "pixel_m": GLO30_PIXEL_M, "nodata_below": -1e30, "vertical_datum": "EGM2008 geoid (metres)",
                "kind": "X-band InSAR surface model (includes vegetation and buildings)"},
    }


def build_earth(window_id: str) -> Path:
    """Reproject the GLO-30 window onto the local AEQD grid at native posting, then tile it like Jezero.

    No imagery is attached (no measured orthoimage is acquired for Earth windows).
    """
    from rasterio.warp import Resampling as WarpResampling
    from rasterio.warp import reproject

    from pipeline.geodata import RAW
    from pipeline.geodata.rasters import (
        copernicus_tiles,
        dem_tile_urls,
        geographic_bounds,
        mosaic_window,
    )
    site = earth_site(window_id)
    margin = 600.0
    half = site["half_m"] + margin
    bounds = geographic_bounds(site["lon"], site["lat"], half)
    urls, _ = dem_tile_urls(bounds, copernicus_tiles(RAW))
    z, transform, crs, info = mosaic_window(urls, bounds)
    n = int(round(2 * half / GLO30_PIXEL_M))
    local = np.full((n, n), np.nan, np.float32)
    from rasterio.transform import from_origin
    dst_t = from_origin(-half, half, GLO30_PIXEL_M, GLO30_PIXEL_M)
    reproject(z, local, src_transform=transform, src_crs=crs, src_nodata=np.nan, dst_transform=dst_t,
              dst_crs=local_proj(site), dst_nodata=np.nan, resampling=WarpResampling.bilinear)
    site["source_crs"] = local_proj(site)
    name = f"earth-{window_id.lower()}"
    folder = ROOT / "data/world" / name
    manifest = build_package(site, local, (-half, half), None, None, folder)
    manifest["sources"] = {"dtm": {**{k: v for k, v in site["dtm"].items() if k != "nodata_below"},
                                   "tiles": info["tiles"],
                                   "window_sha256": hashlib.sha256(np.ascontiguousarray(z).tobytes()).hexdigest(),
                                   "processing": "rasterio.merge of GLO-30 COG tiles, bilinear reprojection to the local "
                                                 "AEQD grid at 30 m; no gap filling"}}
    manifest["discovery_window"] = window_id
    manifest["limitations"] = manifest["limitations"][:1] + [
        "Copernicus GLO-30 is a surface model: canopy and buildings are part of the heights.",
        "30 m posting: rover-scale obstacles are not resolved; no orthoimage is attached.",
        "No mechanical soil property or mineralogy is contained in these products."]
    (folder / "manifest.json").write_text(json.dumps(manifest, allow_nan=False, separators=(",", ":")) + "\n")
    print(f"{name}: {len(manifest['tiles'])} tiles, offset {manifest['encoding']['offset_m']} m")
    return folder / "manifest.json"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("site", help=f"one of {sorted(SITES)} or earth:<discovery window id>")
    arg = parser.parse_args().site
    if arg.startswith("earth:"):
        build_earth(arg.split(":", 1)[1])
    else:
        build(arg)
