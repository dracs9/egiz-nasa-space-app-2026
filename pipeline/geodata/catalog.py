# Written with AI assistance (Claude Code); reviewed by: pending (Geo lead).
"""Assemble the versioned release in data/geo/<dataset_version>/ from per-AOI records.

Outputs (contract: docs/GEOSPATIAL_DATA_INTERFACE.md, contracts/geospatial/):
aoi_catalog.json, aoi_features.csv (+ .columns.json), patch_index.csv,
manifests/{sources,assets,coverage}.json, quality/<aoi_id>.json, quality/REPORT.md.
All text files are written with LF line endings so checksums are platform-stable.
"""
from __future__ import annotations

import csv
import io
import json
import re
from collections import Counter
from pathlib import Path

from pyproj import CRS, Transformer

from pipeline.geodata import COVERAGE_LEVELS, DATASET_VERSION, DERIVED, RELEASE, SCHEMA_VERSION
from pipeline.geodata.aois import HALF_M
from pipeline.geodata.cache import utc_now
from pipeline.geodata.qa import aoi_quality
from pipeline.geodata.sources import SOURCES, registry
from pipeline.planets.access import RADII_M, local_crs, local_origin

ID_COLUMNS = ["aoi_id", "site_id", "group_id", "body", "pool", "lon", "lat", "coverage_level", "quality_status"]
APPLICABLE = {"earth": ["dem", "landcover", "climate", "geology"], "moon": ["dem"], "mars": ["dem"]}

DESCRIPTIONS = [
    (r"^slope_f(\d+)_p(\d+)_deg$", "Fine slope percentile p{1}, difference baseline {0} m, central 10 km"),
    (r"^frac_lt(\d+)_f(\d+)$", None),
    (r"^slope_r_p(\d+)_deg$", "Regional slope percentile p{0}, 2 km baseline on 200 m grid, 20 km core"),
    (r"^frac_lt20_r$", None),
    (r"^tri_f(\d+)_m$", "Median terrain ruggedness index (mean |dz| to 8 neighbours) on fine grid, central 10 km"),
    (r"^relief_m$", "Elevation p95 - p5 on 200 m grid, 20 km core"),
    (r"^elev_min_m$", "Minimum elevation on 200 m grid, 20 km core (body vertical datum)"),
    (r"^dem_valid_frac$", "Fraction of valid DEM pixels in the analysed fine grid core"),
    (r"^elev_p(\d+)_m$", "Elevation percentile p{0}, fine grid, 20 km core"),
    (r"^elev_std_m$", "Elevation standard deviation, fine grid, 20 km core"),
    (r"^slope_f(\d+)_mean_deg$", "Mean fine slope (baseline {0} m), central 10 km"),
    (r"^slope_f(\d+)_std_deg$", "Std of fine slope (baseline {0} m), central 10 km"),
    (r"^slope_f(\d+)_bin_(\w+)_frac$", "Fraction of fine-slope pixels in bin {1} deg (baseline {0} m)"),
    (r"^aspect_northness_mean_unitless$", "Mean cos(downslope azimuth) over pixels steeper than 2 deg, central 10 km"),
    (r"^aspect_eastness_mean_unitless$", "Mean sin(downslope azimuth) over pixels steeper than 2 deg, central 10 km"),
    (r"^aspect_sloped_frac$", "Fraction of central 10 km pixels steeper than 2 deg (aspect support)"),
    (r"^curv_lap_f(\d+)_std_per_m$", "Std of 5-point Laplacian of elevation (1/m), fine grid, central 10 km"),
    (r"^(tree|crop|built|bare|snow|water|grass_shrub|moss_lichen)_frac$", "WorldCover 2021 class fraction: {0}"),
    (r"^landcover_classified_frac$", "Fraction of 20 km square with a valid WorldCover class"),
    (r"^t2m_max_warmest_month_c$", "Max over months of POWER T2M_MAX climatology (2 m AIR temperature, not LST)"),
    (r"^t2m_min_coldest_month_c$", "Min over months of POWER T2M_MIN climatology (2 m AIR temperature, not LST)"),
    (r"^t2m_mean_annual_c$", "Mean of monthly POWER T2M climatology (2 m air temperature)"),
    (r"^t2m_seasonal_range_c$", "Warmest minus coldest monthly mean POWER T2M"),
    (r"^precip_annual_mm$", "Annual precipitation from POWER PRECTOTCORR monthly climatology"),
    (r"^geo_unit_name_label$", "Geologic map unit name at AOI centre (Macrostrat)"),
    (r"^geo_lith_label$", "Map-unit lithology text (not spectral mineralogy)"),
    (r"^geo_age_interval_label$", "Best chronostratigraphic interval of the map unit"),
    (r"^geo_age_(top|bottom)_ma$", "Map-unit {0} age, Ma"),
    (r"^geo_map_scale_label$", "Scale class of the source map (large/medium/small/tiny)"),
]


def describe(name):
    for pattern, text in DESCRIPTIONS:
        m = re.match(pattern, name)
        if m:
            if text is None:
                return f"Fraction of valid slope pixels below threshold ({name})"
            return text.format(*m.groups())
    return name


def unit(name):
    for suffix, label in [("_deg", "deg"), ("_per_m", "1/m"), ("_mm", "mm"), ("_ma", "Ma"), ("_c", "degC"),
                          ("_unitless", "1"), ("_label", "text"), ("_m", "m")]:
        if name.endswith(suffix):
            return label
    return "fraction"


def ring(lon, lat, body, half_m=HALF_M):
    """Closed lon/lat ring of the local metric window (body-specific geographic CRS)."""
    local = local_crs((lon, lat), body)
    geo = CRS.from_epsg(4326) if body == "earth" else CRS.from_proj4(f"+proj=longlat +R={RADII_M[body]} +no_defs")
    tr = Transformer.from_crs(local, geo, always_xy=True)
    x0, y0 = local_origin((lon, lat), body)
    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1), (-1, -1)]
    return [[round(v, 6) for v in tr.transform(x0 + sx * half_m, y0 + sy * half_m)] for sx, sy in corners]


def coverage_level(record, quality):
    """Highest consecutive level; stages that do not apply to the body are skipped (see APPLICABLE)."""
    st = {k: v.get("status") for k, v in record["stages"].items()}
    f = record["features"]
    earth = record["aoi"]["body"] == "earth"
    if st.get("dem") != "ok" or (f.get("dem_valid_frac") or 0) < .9:
        return COVERAGE_LEVELS[0]
    if earth:
        if not (st.get("landcover") == "ok" and f.get("bare_frac") is not None and st.get("climate") == "ok"):
            return COVERAGE_LEVELS[1]
        if st.get("geology") != "ok":
            return COVERAGE_LEVELS[2]
    if quality["status"] != "pass":
        return COVERAGE_LEVELS[3 if earth else 1]
    return COVERAGE_LEVELS[4]


def _write(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as file:
        file.write(text)


def _json(path, data):
    _write(path, json.dumps(data, indent=1, ensure_ascii=False, allow_nan=False) + "\n")


def load_records(ids=None):
    records = []
    for path in sorted((DERIVED / "aoi").glob("*.json")):
        record = json.loads(path.read_text(encoding="utf-8"))
        if ids is None or record["aoi"]["aoi_id"] in ids:
            records.append(record)
    order = {"pilot": 0, "target": 1, "target_extra": 2, "sampled": 3}
    return sorted(records, key=lambda r: (order.get(r["aoi"]["pool"], 9), r["aoi"]["body"], r["aoi"]["aoi_id"]))


def build_release(out: Path = RELEASE, ids=None, *, verify_files=True) -> Path:
    records = [r for r in load_records(ids) if r["aoi"].get("lon") is not None]
    feature_names = []
    for r in records:
        feature_names += [k for k in r["features"] if k not in feature_names]
    catalog, rows, patches, assets, qualities = [], [], [], [], []
    for r in records:
        a = r["aoi"]
        q = aoi_quality(r, verify_files=verify_files)
        level = coverage_level(r, q)
        qualities.append((r, q, level))
        f = r["features"]
        catalog.append({
            "aoi_id": a["aoi_id"], "site_id": a["site_id"], "group_id": a["group_id"], "body": a["body"],
            "name": a["name"], "region": a["region"], "country": a.get("country"), "pool": a["pool"],
            "centroid": {"lon": round(a["lon"], 6), "lat": round(a["lat"], 6)},
            "footprint": {"window_m": 2 * HALF_M, "core_m": 20000, "ring_lonlat": ring(a["lon"], a["lat"], a["body"])},
            "analysis_crs": local_crs((a["lon"], a["lat"]), a["body"]).to_string(),
            "coverage_level": level,
            "stages": {k: v["status"] for k, v in r["stages"].items()},
            "quality_status": q["status"],
            "warnings": [c["detail"] for c in q["checks"] if c["status"] == "warn"],
            "summary": {k: (round(f[k], 4) if isinstance(f.get(k), float) else f.get(k)) for k in
                        ["relief_m", "slope_r_p50_deg", "elev_p50_m", "bare_frac", "t2m_mean_annual_c",
                         "precip_annual_mm", "geo_lith_label"] if k in f},
            "missing": dict(sorted(r["missing"].items())),
            "notes": a.get("notes", []),
        })
        row = {"aoi_id": a["aoi_id"], "site_id": a["site_id"], "group_id": a["group_id"], "body": a["body"],
               "pool": a["pool"], "lon": f"{a['lon']:.6f}", "lat": f"{a['lat']:.6f}",
               "coverage_level": level, "quality_status": q["status"]}
        for k in feature_names:
            v = f.get(k)
            row[k] = "" if v is None else (v if isinstance(v, str) else repr(round(float(v), 8)))
        rows.append(row)
        tiles = ";".join(next((x.get("tiles", []) for x in r["assets"] if x["role"].startswith("native")), []))
        for p in r["patches"]:
            patches.append({"patch_id": p["patch_id"], "aoi_id": a["aoi_id"], "site_id": a["site_id"],
                            "group_id": a["group_id"], "body": a["body"], "variable": p["variable"],
                            "source_tiles": tiles, "asset_path": p["path"], "sha256": p["sha256"], "bytes": p["bytes"],
                            "crs": p["crs"], "pixel_m": p["pixel_m"], "native_res_m": p["native_res_m"],
                            "rows": p["shape"][0], "cols": p["shape"][1], "resampling": p["resampling"],
                            "valid_frac": round(p["valid_frac"], 6), "committed": "false"})
        for x in r["assets"]:
            assets.append({"aoi_id": a["aoi_id"], **x})
        for p in r["patches"]:
            assets.append({"aoi_id": a["aoi_id"], "role": "analysis_grid", "source_id": None, **{
                k: p[k] for k in ["path", "sha256", "bytes", "crs", "pixel_m", "shape", "transform", "valid_frac"]},
                "committed": False, "processing": p["resampling"]})

    # Feature table + column dictionary
    header = ID_COLUMNS + feature_names
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=header, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    _write(out / "aoi_features.csv", buffer.getvalue())
    meta_by_col = {}
    for r in records:
        for k, m in r["feature_meta"].items():
            if m.get("evidence"):
                entry = meta_by_col.setdefault(k, {"evidence": m["evidence"], "sources_by_body": {}, "method": m["method"]})
                entry["sources_by_body"][r["aoi"]["body"]] = m["source"]
    columns = {c: {"unit": "id", "description": "identifier / bookkeeping column"} for c in ID_COLUMNS}
    columns["lon"] = {"unit": "deg", "description": "AOI centre longitude, planetocentric, east-positive, -180..180"}
    columns["lat"] = {"unit": "deg", "description": "AOI centre latitude, planetocentric"}
    for k in feature_names:
        columns[k] = {"unit": unit(k), "description": describe(k), "missing_encoding": "empty cell",
                      **meta_by_col.get(k, {"evidence": None, "sources_by_body": {}, "method": None})}
    _json(out / "aoi_features.columns.json", {"schema_version": SCHEMA_VERSION, "dataset_version": DATASET_VERSION,
                                               "columns": columns})

    buffer = io.StringIO()
    if patches:
        writer = csv.DictWriter(buffer, fieldnames=list(patches[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(patches)
    _write(out / "patch_index.csv", buffer.getvalue())

    _json(out / "aoi_catalog.json", {"schema_version": SCHEMA_VERSION, "dataset_version": DATASET_VERSION,
                                     "synthetic": False, "coordinate_convention":
                                     "planetocentric lon/lat in degrees, east-positive, -180..180; Earth WGS84",
                                     "aois": catalog})
    _json(out / "manifests" / "assets.json", {"schema_version": SCHEMA_VERSION, "dataset_version": DATASET_VERSION,
                                              "assets": assets})
    used = {x.get("source_id") for x in assets} | {m["source"] for r in records for m in r["feature_meta"].values()
                                                   if m.get("source")}
    _json(out / "manifests" / "sources.json", {"schema_version": SCHEMA_VERSION, "dataset_version": DATASET_VERSION,
                                               "sources": [s for s in registry() if s["source_id"] in used]})

    levels = Counter(level for _, _, level in qualities)
    by_var = {k: {"non_null": sum(r["features"].get(k) is not None for r in records), "of": len(records)}
              for k in feature_names}
    by_source = Counter(m["source"] for r in records for k, m in r["feature_meta"].items()
                        if m.get("source") and r["features"].get(k) is not None)
    stage_status = {s: dict(Counter(r["stages"].get(s, {}).get("status", "not_run") for r in records))
                    for s in ["dem", "landcover", "climate", "geology"]}
    _json(out / "manifests" / "coverage.json", {
        "schema_version": SCHEMA_VERSION, "dataset_version": DATASET_VERSION, "generated_at": utc_now(),
        "n_aois": len(records), "n_distinct_sites": len({r["aoi"]["site_id"] for r in records}),
        "by_body": dict(Counter(r["aoi"]["body"] for r in records)),
        "by_pool": dict(Counter(r["aoi"]["pool"] for r in records)),
        "by_coverage_level": {lvl: levels.get(lvl, 0) for lvl in COVERAGE_LEVELS},
        "stage_status": stage_status, "by_variable": by_var, "values_by_source": dict(by_source),
        "n_groups": len({r["aoi"]["group_id"] for r in records})})

    qdir = out / "quality"
    for old in qdir.glob("*.json") if qdir.exists() else []:
        old.unlink()
    lines = [f"# Quality report — {DATASET_VERSION}", "",
             "Generated by `python -m pipeline.geodata manifest`. One line per AOI; details in `quality/<aoi_id>.json`.",
             "", f"AOIs: {len(records)} · distinct sites: {len({r['aoi']['site_id'] for r in records})} · "
             + " · ".join(f"{k}: {v}" for k, v in sorted(levels.items())), "",
             "| AOI | body | level | QA | stages | missing (count) | failed checks |", "|---|---|---|---|---|---|---|"]
    for r, q, level in qualities:
        _json(qdir / f"{r['aoi']['aoi_id']}.json", {**q, "coverage_level": level, "stages": r["stages"],
                                                    "missing": r["missing"], "climate_meta": r.get("climate_meta"),
                                                    "geology_meta": r.get("geology_meta")})
        failed = "; ".join(f"{c['check']}: {c['detail'][:120]}" for c in q["checks"] if c["status"] == "fail")
        stages = ", ".join(f"{k}={v['status']}" for k, v in r["stages"].items())
        lines.append(f"| {r['aoi']['aoi_id']} | {r['aoi']['body']} | {level} | {q['status']} | {stages} | "
                     f"{len(r['missing'])} | {failed or '—'} |")
    _write(qdir / "REPORT.md", "\n".join(lines) + "\n")
    _write(out / ".gitattributes", "* -text\n")
    return out


__all__ = ["build_release", "SOURCES"]
