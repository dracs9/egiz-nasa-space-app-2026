# Written with AI assistance (Claude Code); reviewed by: pending (Geo lead).
"""Per-AOI acquisition and feature stages (resumable; one JSON record per AOI).

Terrain uses pipeline.common.terrain.terrain_attributes unchanged, on the same
grids as pipeline.earth.export.ingest_local (Earth: 200 m and 50 m local UTM)
and pipeline.planets.targets.measure_target_terrain (Moon/Mars, local AEQD).
Supplementary statistics (elevation distribution, slope histogram, aspect,
curvature) are documented in docs/GEOSPATIAL_DATA_INTERFACE.md section 5.

Missing values are None with a reason in ``missing``; nothing is filled with 0.
"""
from __future__ import annotations

import calendar
import json
import math
import traceback
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.warp import reproject

from pipeline.common.terrain import slope_at_offset, terrain_attributes
from pipeline.earth.gee_terrain import rename_attributes
from pipeline.earth.public_cover import CLASSES as WC_CLASSES
from pipeline.earth.public_cover import VALID_CLASSES as WC_VALID
from pipeline.geodata import DERIVED, RAW
from pipeline.geodata.aois import AOI, HALF_M
from pipeline.geodata.cache import fetch, fetch_json, sha256_file, utc_now
from pipeline.geodata.rasters import (
    dem_tile_urls,
    geographic_bounds,
    mosaic_window,
    read_native,
    worldcover_tile_urls,
    write_native,
)
from pipeline.planets.access import (
    RADII_M,
    AccessError,
    local_crs,
    local_origin,
    read_window,
    to_local_grid,
)
from pipeline.planets.targets import measure_target_terrain

POWER_URL = ("https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M_MAX,T2M_MIN,T2M,PRECTOTCORR"
             "&community=RE&longitude={lon:.4f}&latitude={lat:.4f}&format=JSON")
MACROSTRAT_URL = "https://macrostrat.org/api/v2/geologic_units/map?lat={lat:.5f}&lng={lon:.5f}"
MACROSTRAT_SOURCE_URL = "https://macrostrat.org/api/v2/defs/sources?source_id={sid}"
SCALE_RANK = {"large": 0, "medium": 1, "small": 2, "tiny": 3}
MONTHS = [m.upper() for m in calendar.month_abbr[1:]]

NOT_COMPARABLE = "not_comparable: Earth-atmosphere/land-cover variable has no measured counterpart on this body"


def record_path(aoi_id: str) -> Path:
    return DERIVED / "aoi" / f"{aoi_id}.json"


def load_record(aoi: AOI) -> dict:
    path = record_path(aoi.aoi_id)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"aoi": aoi.to_dict(), "stages": {}, "features": {}, "feature_meta": {}, "missing": {},
            "assets": [], "patches": []}


def save_record(record: dict) -> Path:
    path = record_path(record["aoi"]["aoi_id"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record, indent=1, allow_nan=False) + "\n", encoding="utf-8")
    return path


def _clean(value):
    if value is None:
        return None
    value = float(value)
    return value if math.isfinite(value) else None


def put(record, name, value, *, evidence, source, method):
    """Set one feature with its metadata; None goes to ``missing`` with the method as reason."""
    value = _clean(value) if not isinstance(value, str) else (value or None)
    record["features"][name] = value
    record["feature_meta"][name] = {"evidence": evidence, "source": source, "method": method}
    if value is None:
        record["missing"].setdefault(name, f"no valid value: {method}")
    else:
        record["missing"].pop(name, None)


def mark_missing(record, names, reason, source=None):
    for name in names:
        record["features"][name] = None
        record["feature_meta"][name] = {"evidence": None, "source": source, "method": None}
        record["missing"][name] = reason


# ----------------------------------------------------------------------------- grids

def write_grid(path: Path, z: np.ndarray, center, body, p, *, tags) -> dict:
    """Write an analysis-ready local metric grid (float32, NaN nodata) and return asset metadata."""
    x0, y0 = local_origin(center, body)
    transform = from_origin(x0 - HALF_M, y0 + HALF_M, p, p)
    crs = local_crs(center, body)
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(path, "w", driver="GTiff", height=z.shape[0], width=z.shape[1], count=1,
                       dtype="float32", crs=crs.to_wkt(), transform=transform, nodata=np.nan,
                       compress="deflate", predictor=3) as dst:
        dst.write(np.asarray(z, dtype="float32"), 1)
        dst.update_tags(**{k: str(v) for k, v in tags.items()})
    return {"path": path.relative_to(DERIVED.parents[2]).as_posix(), "sha256": sha256_file(path),
            "bytes": path.stat().st_size, "crs": crs.to_proj4() if body != "earth" else crs.to_string(),
            "transform": list(transform)[:6], "pixel_m": p, "shape": list(z.shape),
            "valid_frac": float(np.isfinite(z).mean())}


def extra_terrain(z50: np.ndarray, p: float, prefix: str) -> dict:
    """Supplementary distribution statistics on a fine grid (central 10 km for slope, 20 km for elevation)."""
    n = z50.shape[0]
    core = int(round(20000 / p))
    fine = int(round(10000 / p))
    c0, f0 = (n - core) // 2, (n - fine) // 2
    zc = z50[c0:c0 + core, c0:c0 + core]
    out = {}
    valid = zc[np.isfinite(zc)]
    if valid.size:
        out.update({"elev_p05_m": np.percentile(valid, 5), "elev_p50_m": np.percentile(valid, 50),
                    "elev_p95_m": np.percentile(valid, 95), "elev_std_m": valid.std()})
    s = slope_at_offset(z50, p, 1)  # same stencil as terrain_attributes fine slope
    s = s[f0 - 1:f0 - 1 + fine, f0 - 1:f0 - 1 + fine]
    sv = s[np.isfinite(s)]
    if sv.size:
        out[f"slope_{prefix}_mean_deg"] = sv.mean()
        out[f"slope_{prefix}_std_deg"] = sv.std()
        for lo, hi in [(0, 5), (5, 15), (15, 30), (30, 90.1)]:
            label = f"{lo}_{int(hi)}" if hi < 90 else f"gt{lo}"
            out[f"slope_{prefix}_bin_{label}_frac"] = np.mean((sv >= lo) & (sv < hi))
    # Aspect from central differences; rows increase southward, columns eastward.
    zf = z50[f0:f0 + fine, f0:f0 + fine]
    if np.isfinite(zf).mean() > .5:
        gy, gx = np.gradient(zf, p)
        north, east = gy, -gx  # downslope direction components
        mag = np.hypot(north, east)
        sel = np.isfinite(mag) & (np.degrees(np.arctan(mag)) > 2)
        if sel.sum() > 100:
            out["aspect_northness_mean_unitless"] = np.mean(north[sel] / mag[sel])
            out["aspect_eastness_mean_unitless"] = np.mean(east[sel] / mag[sel])
            out["aspect_sloped_frac"] = sel.sum() / np.isfinite(mag).sum()
        lap = (np.roll(zf, 1, 0) + np.roll(zf, -1, 0) + np.roll(zf, 1, 1) + np.roll(zf, -1, 1) - 4 * zf) / p**2
        lap = lap[1:-1, 1:-1]
        lv = lap[np.isfinite(lap)]
        if lv.size:
            out[f"curv_lap_{prefix}_std_per_m"] = lv.std()
    return {k: float(v) for k, v in out.items()}


# ----------------------------------------------------------------------------- stages

def stage_dem_earth(record, aoi: AOI, tile_names: set[str] | None):
    lon, lat = aoi.lon, aoi.lat
    if lon is None or lat is None:
        raise ValueError(f"{aoi.aoi_id}: Earth AOI needs lon/lat")
    bounds = geographic_bounds(lon, lat, HALF_M)
    native = RAW / "copernicus_glo30" / "windows" / f"{aoi.aoi_id}.tif"
    if not native.exists():
        urls, absent = dem_tile_urls(bounds, tile_names)
        if not urls:
            raise AccessError("no Copernicus GLO-30 tile intersects this window (ocean)")
        z, transform, crs, info = mosaic_window(urls, bounds)
        if any(s != 1 for s in info["scales"]) or any(o != 0 for o in info["offsets"]):
            raise AccessError("unexpected scale/offset in Copernicus tiles")
        write_native(native, z, transform, crs, tags={
            "source_urls": " ".join(urls), "absent_tiles_ocean": " ".join(absent),
            "dataset": "Copernicus DEM GLO-30 Public 2021", "vertical": "EGM2008 m", "synthetic": "false",
            "mosaic": "rasterio.merge method=first, nearest, finest source spacing; no value interpolation",
            "mixed_tile_resolution": str(info["mixed_tile_resolution"])})
    z, transform, crs, tags = read_native(native)
    asset = {"role": "native_window", "source_id": "COP_GLO30", "path": native.relative_to(RAW.parents[2]).as_posix(),
             "sha256": sha256_file(native), "bytes": native.stat().st_size, "crs": "EPSG:4326",
             "vertical_datum": "EGM2008 geoid, metres", "nodata": "NaN (ocean / no tile)",
             "native_res": "1 arcsec (~30 m)", "transform": list(transform)[:6], "shape": list(z.shape),
             "tiles": tags.get("source_urls", "").split(), "absent_tiles": tags.get("absent_tiles_ocean", "").split(),
             "processing": tags.get("mosaic"), "committed": False}
    attrs, patches = {}, []
    for baseline, p in [(400, 200), (100, 50)]:
        grid = to_local_grid(z, transform, crs, (lon, lat), "earth", p, HALF_M)
        computed = rename_attributes(terrain_attributes(grid, p), baseline)
        attrs.update({k: v for k, v in computed.items() if baseline == 400 or "f100" in k})
        meta = write_grid(DERIVED / "grids" / f"{aoi.aoi_id}_p{p}.tif", grid, (lon, lat), "earth", p, tags={
            "aoi_id": aoi.aoi_id, "source": "COP_GLO30", "resampling": "all-valid average to local UTM",
            "units": "m (EGM2008)", "synthetic": "false"})
        patches.append({**meta, "patch_id": f"{aoi.aoi_id}__DEM_P{p}", "variable": "elevation_m",
                        "resampling": "average (all source pixels valid), pipeline.planets.access.to_local_grid",
                        "native_res_m": 30})
        if p == 50:
            extra = extra_terrain(grid, p, "f100")
            core = grid[20:-20, 20:-20]
            attrs["dem_valid_frac"] = float(np.isfinite(core).mean())
    return attrs, extra, asset, patches


def stage_dem_planet(record, aoi: AOI):
    body = aoi.body
    is_moon = body == "moon"
    if aoi.product is None or aoi.fine_baseline_m is None:
        raise ValueError(f"{aoi.aoi_id}: planetary AOI needs a DEM product and fine baseline")
    pgda = is_moon and "pgda.gsfc.nasa.gov" in aoi.product
    if pgda:
        native = RAW / "pgda_lola_5mpp" / aoi.product.rsplit("/", 1)[-1]
        fetch(aoi.product, native, timeout=600)
        source = str(native)
        if aoi.lon is None:
            with rasterio.open(native) as src:
                from pyproj import Transformer
                cx, cy = (src.bounds.left + src.bounds.right) / 2, (src.bounds.bottom + src.bounds.top) / 2
                geo = Transformer.from_crs(src.crs.to_wkt(), f"+proj=longlat +R={RADII_M['moon']} +no_defs", always_xy=True)
                aoi.lon, aoi.lat = (float(v) for v in geo.transform(cx, cy))
                record["aoi"].update(lon=aoi.lon, lat=aoi.lat)
    else:
        # Global products: HTTP range read of the window only (the full rasters are 8-11 GB).
        folder = "lola_ldem_118m" if is_moon else "usgs_mars_blend"
        native = RAW / folder / "windows" / f"{aoi.aoi_id}.tif"
        if not native.exists():
            z, transform, crs = read_window(f"/vsicurl/{aoi.product}", aoi.lon, aoi.lat, HALF_M + 2000, body)
            write_native(native, z, transform, crs, tags={
                "source_urls": aoi.product,
                "dataset": "Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014" if is_moon else "Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2",
                "vertical": f"m relative to {RADII_M[body]} m sphere", "synthetic": "false",
                "note": ("LOLA gridded altimetry, interpolated between tracks" if is_moon
                         else "blend of HRSC and MOLA; not a single native resolution")})
        source = str(native)
    z, transform, crs = read_window(source, aoi.lon, aoi.lat, HALF_M, body)
    source_id = "PGDA_LOLA_5MPP" if pgda else ("LOLA_LDEM_118M" if is_moon else "USGS_MARS_BLEND")
    asset = {"role": "native_product" if pgda else "native_window",
             "source_id": source_id,
             "path": native.relative_to(RAW.parents[2]).as_posix(), "sha256": sha256_file(native),
             "bytes": native.stat().st_size, "crs": crs_str(crs), "vertical_datum":
             f"metres above {RADII_M[body]} m reference sphere", "nodata": "NaN",
             "native_res": "5 m" if pgda else ("118 m posting (LOLA 256 ppd)" if is_moon else "200 m posting (HRSC/MOLA blend)"),
             "tiles": [aoi.product], "committed": False}
    baseline = aoi.fine_baseline_m
    attrs = measure_target_terrain(z, transform, crs, (aoi.lon, aoi.lat), body, baseline)
    patches, extra = [], {}
    for p in sorted({baseline / 2, 200}):
        grid = to_local_grid(z, transform, crs, (aoi.lon, aoi.lat), body, p, HALF_M)
        meta = write_grid(DERIVED / "grids" / f"{aoi.aoi_id}_p{int(p)}.tif", grid, (aoi.lon, aoi.lat), body, p,
                          tags={"aoi_id": aoi.aoi_id, "resampling": "all-valid average to local AEQD",
                                "synthetic": "false"})
        patches.append({**meta, "patch_id": f"{aoi.aoi_id}__DEM_P{int(p)}", "variable": "elevation_m",
                        "resampling": "average (all source pixels valid), pipeline.planets.access.to_local_grid",
                        "native_res_m": 5 if pgda else (118 if is_moon else 200)})
        if p == baseline / 2:
            extra = extra_terrain(grid, p, f"f{baseline}")
            attrs["dem_valid_frac"] = float(np.isfinite(grid[20:-20, 20:-20]).mean())
    return attrs, extra, asset, patches


def crs_str(crs):
    try:
        return crs.to_string() if crs.to_epsg() else crs.to_proj4()
    except Exception:
        return crs.to_wkt()


def stage_landcover(record, aoi: AOI):
    lon, lat = aoi.lon, aoi.lat
    if lon is None or lat is None:
        raise ValueError(f"{aoi.aoi_id}: Earth AOI needs lon/lat")
    bounds = geographic_bounds(lon, lat, HALF_M)
    native = RAW / "esa_worldcover_v200" / "windows" / f"{aoi.aoi_id}.tif"
    urls = worldcover_tile_urls(bounds)
    if not native.exists():
        z, transform, crs, info = mosaic_window(urls, bounds, dtype="uint8", nodata=0)
        write_native(native, z, transform, crs, nodata=0, tags={
            "source_urls": " ".join(urls), "dataset": "ESA WorldCover 2021 v200", "synthetic": "false",
            "mosaic": "rasterio.merge method=first, nearest (categorical)"})
    z, transform, crs, tags = read_native(native)
    x0, y0 = local_origin((lon, lat), "earth")
    dst_t = from_origin(x0 - 10000, y0 + 10000, 10, 10)
    dest = np.zeros((2000, 2000), dtype=np.uint8)
    reproject(z, dest, src_transform=transform, src_crs=crs, src_nodata=0, dst_transform=dst_t,
              dst_crs=local_crs((lon, lat), "earth"), dst_nodata=0, resampling=Resampling.nearest)
    classified = np.isin(dest, list(WC_VALID))
    asset = {"role": "native_window", "source_id": "ESA_WC_V200", "path": native.relative_to(RAW.parents[2]).as_posix(),
             "sha256": sha256_file(native), "bytes": native.stat().st_size, "crs": "EPSG:4326",
             "nodata": "0 (unclassified / outside tiles)", "native_res": "10 m", "tiles": urls, "committed": False}
    cover = {"landcover_classified_frac": float(classified.mean())}
    if classified.mean() >= .99:
        values = dest[classified]
        cover.update({name: float(np.mean(values == code)) for name, code in WC_CLASSES.items()})
        cover["grass_shrub_frac"] = float(np.mean(np.isin(values, [20, 30])))
        cover["moss_lichen_frac"] = float(np.mean(values == 100))
    return cover, asset


def stage_climate(record, aoi: AOI):
    url = POWER_URL.format(lon=aoi.lon, lat=aoi.lat)
    payload, meta = fetch_json(url, RAW / "nasa_power" / f"{aoi.aoi_id}.json")
    params = payload["properties"]["parameter"]
    fill = payload["header"].get("fill_value", -999.0)

    def series(name):
        values = [params[name].get(m) for m in MONTHS]
        return [None if v is None or v == fill else float(v) for v in values]

    def complete(values: list[float | None]) -> list[float] | None:
        known = [v for v in values if v is not None]
        return known if len(known) == len(values) else None

    tmax, tmin, tmean, prate = (series(n) for n in ["T2M_MAX", "T2M_MIN", "T2M", "PRECTOTCORR"])
    days = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    out = {}
    if (full := complete(tmax)) is not None:
        out["t2m_max_warmest_month_c"] = max(full)
    if (full := complete(tmin)) is not None:
        out["t2m_min_coldest_month_c"] = min(full)
    if (full := complete(tmean)) is not None:
        out["t2m_mean_annual_c"] = sum(full) / 12
        out["t2m_seasonal_range_c"] = max(full) - min(full)
    if (full := complete(prate)) is not None:
        out["precip_annual_mm"] = sum(r * d for r, d in zip(full, days))
    period = payload["header"].get("range", "")
    version = payload["header"].get("api", {}).get("version")
    return out, {"monthly": {"t2m_max_c": tmax, "t2m_min_c": tmin, "t2m_c": tmean, "precip_rate_mm_per_day": prate},
                 "period": period, "api_version": version, "url": url, "accessed": meta.get("accessed"),
                 "sha256": meta.get("sha256")}


def stage_geology(record, aoi: AOI):
    url = MACROSTRAT_URL.format(lat=aoi.lat, lon=aoi.lon)
    payload, meta = fetch_json(url, RAW / "macrostrat" / f"{aoi.aoi_id}.json")
    units = payload.get("success", {}).get("data", [])
    if not units:
        return None, {"url": url, "reason": "no mapped geologic unit at AOI centre (Macrostrat coverage gap)"}
    best = sorted(units, key=lambda u: SCALE_RANK.get(u.get("scale"), 9))[0]
    src, _ = fetch_json(MACROSTRAT_SOURCE_URL.format(sid=best["source_id"]),
                        RAW / "macrostrat" / "sources" / f"{best['source_id']}.json")
    ref = (src.get("success", {}).get("data") or [{}])[0]
    out = {"geo_unit_name_label": best.get("name") or None, "geo_lith_label": best.get("lith") or None,
           "geo_age_interval_label": best.get("best_int_name") or None,
           "geo_age_top_ma": best.get("t_age"), "geo_age_bottom_ma": best.get("b_age"),
           "geo_map_scale_label": best.get("scale") or None}
    return out, {"url": url, "map_id": best.get("map_id"), "source_id": best.get("source_id"),
                 "source_ref": f"{ref.get('authors', '')} ({ref.get('ref_year', '')}). {ref.get('ref_title', '')}. "
                               f"{ref.get('ref_source', '')} {ref.get('isbn_doi', '')}".strip(),
                 "n_units_at_point": len(units), "accessed": meta.get("accessed")}


# ----------------------------------------------------------------------------- driver

TERRAIN_METHOD = "pipeline.common.terrain.terrain_attributes on local metric grid ({grid})"
EARTH_ENV_NAMES = ["tree_frac", "crop_frac", "built_frac", "bare_frac", "snow_frac", "water_frac",
                   "grass_shrub_frac", "moss_lichen_frac", "landcover_classified_frac",
                   "t2m_max_warmest_month_c", "t2m_min_coldest_month_c", "t2m_mean_annual_c",
                   "t2m_seasonal_range_c", "precip_annual_mm"]
GEO_NAMES = ["geo_unit_name_label", "geo_lith_label", "geo_age_interval_label", "geo_age_top_ma",
             "geo_age_bottom_ma", "geo_map_scale_label"]


def process(aoi: AOI, *, tile_names: set[str] | None = None, stages=("dem", "landcover", "climate", "geology"),
            force=False) -> dict:
    record = load_record(aoi)
    record["aoi"].update({k: v for k, v in aoi.to_dict().items() if v is not None})
    if aoi.lon is None and record["aoi"].get("lon") is not None:
        aoi.lon, aoi.lat = record["aoi"]["lon"], record["aoi"]["lat"]
    st = record["stages"]

    def run(name, fn):
        if not force and st.get(name, {}).get("status") in {"ok", "not_applicable", "no_data"}:
            return
        try:
            status = fn() or "ok"
            st[name] = {"status": status, "at": utc_now()}
        except Exception as exc:  # recorded, never silently swallowed
            st[name] = {"status": "failed", "error": f"{type(exc).__name__}: {exc}", "at": utc_now(),
                        "trace": traceback.format_exc(limit=3)[-600:]}
        save_record(record)

    def dem():
        if aoi.body == "earth":
            attrs, extra, asset, patches = stage_dem_earth(record, aoi, tile_names)
            grids = {"f400": "200 m UTM", "r": "200 m UTM", "f100": "50 m UTM"}
            src = "COP_GLO30"
        else:
            attrs, extra, asset, patches = stage_dem_planet(record, aoi)
            fb = aoi.fine_baseline_m
            assert fb is not None  # checked in stage_dem_planet
            grids = {f"f{fb}": f"{fb // 2} m local AEQD", "r": "200 m local AEQD"}
            src = asset["source_id"]
        record["assets"] = [a for a in record["assets"] if a["role"] not in {"native_window", "native_product"}] + [asset]
        record["patches"] = patches
        for k, v in attrs.items():
            grid = next((g for key, g in grids.items() if f"_{key}" in k or k.endswith(f"_{key}")), "200 m regional grid")
            method = ("valid fraction of 20 km core on fine grid" if k == "dem_valid_frac"
                      else TERRAIN_METHOD.format(grid=grid))
            put(record, k, v, evidence="derived", source=src, method=method)
        for k, v in extra.items():
            put(record, k, v, evidence="derived", source=src,
                method="pipeline.geodata.features.extra_terrain on fine local grid")

    def landcover():
        if aoi.body != "earth":
            mark_missing(record, EARTH_ENV_NAMES[:9], NOT_COMPARABLE)
            return "not_applicable"
        cover, asset = stage_landcover(record, aoi)
        record["assets"] = [a for a in record["assets"] if a["source_id"] != "ESA_WC_V200"] + [asset]
        for k in EARTH_ENV_NAMES[:9]:
            if k in cover:
                put(record, k, cover[k], evidence="proxy", source="ESA_WC_V200",
                    method="fraction of classified 10 m pixels in 20 km UTM square (nearest reprojection)")
            else:
                mark_missing(record, [k], "WorldCover classified coverage < 99% (ocean or tile gap)", "ESA_WC_V200")

    def climate():
        if aoi.body != "earth":
            mark_missing(record, EARTH_ENV_NAMES[9:], NOT_COMPARABLE)
            return "not_applicable"
        values, meta = stage_climate(record, aoi)
        record["climate_meta"] = meta
        for k in EARTH_ENV_NAMES[9:]:
            if k in values:
                put(record, k, values[k], evidence="modelled", source="NASA_POWER_CLIM",
                    method=f"POWER climatology {meta['period']}; 2 m AIR temperature (not LST) at AOI centre, "
                           "0.5 deg cell; precip = sum(monthly mean rate x days)")
            else:
                mark_missing(record, [k], "POWER returned fill value", "NASA_POWER_CLIM")

    def geology():
        if aoi.body != "earth":
            mark_missing(record, GEO_NAMES, "not acquired: no harmonised planetary geologic map unit layer in this release")
            return "not_applicable"
        values, meta = stage_geology(record, aoi)
        record["geology_meta"] = meta
        if values is None:
            mark_missing(record, GEO_NAMES, meta["reason"], "MACROSTRAT")
            return "no_data"
        for k, v in values.items():
            put(record, k, v, evidence="proxy", source="MACROSTRAT",
                method=f"Macrostrat map unit at AOI centre, most detailed scale ({values['geo_map_scale_label']})")

    for name, fn in [("dem", dem), ("landcover", landcover), ("climate", climate), ("geology", geology)]:
        if name in stages:
            run(name, fn)
    return record
