"""Compile the committed Earth-wide discovery index from per-window acquisition records.

python -m pipeline.discovery index   # reads data/derived/<INDEX_VERSION>/aoi, writes data/discovery/index/

Outputs (all small, LF line endings, committed):
  windows.csv        one row per window: identifiers, coverage level, QA, every feature, context
  columns.json       unit, description, evidence class and source of every column
  manifest.json      counts, stage outcomes with failure reasons, sources with checksums, record digest

The column definitions are the geo-0.1.0 ones (pipeline.geodata.catalog), so the index
and the geo release can be pooled without conversion. Native source windows are not
committed; analysis grids stay in data/derived for the evidence tier.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
from collections import Counter
from pathlib import Path
from typing import Any

from pipeline.discovery import INDEX_DERIVED, INDEX_VERSION, OUT
from pipeline.discovery.context import window_context
from pipeline.geodata.cache import utc_now
from pipeline.geodata.catalog import coverage_level, describe, unit
from pipeline.geodata.qa import aoi_quality
from pipeline.geodata.sources import registry

INDEX_DIR = OUT / "index"
ID_COLUMNS = ["aoi_id", "body", "pool", "name", "lon", "lat", "coverage_level", "quality_status"]
CONTEXT_COLUMNS = {
    "country_iso": ("label", "Natural Earth 1:50m country containing the window centre", "NATURAL_EARTH"),
    "volcano_km": ("km", "great-circle distance from window centre to the nearest Holocene volcano", "GVP_VOTW"),
    "volcano_name": ("label", "nearest Holocene volcano", "GVP_VOTW"),
    "impact_km": ("km", "great-circle distance to the nearest catalogued terrestrial impact structure", "WIKIDATA_IMPACTS"),
    "impact_name": ("label", "nearest catalogued impact structure", "WIKIDATA_IMPACTS"),
}


def _records(derived: Path = INDEX_DERIVED) -> list[dict]:
    out = []
    for path in sorted((derived / "aoi").glob("*.json")):
        r = json.loads(path.read_text(encoding="utf-8"))
        if r["aoi"].get("lon") is not None:
            out.append(r)
    return out


def _failure_reason(stage: dict) -> str:
    err = stage.get("error", "")
    if "404" in err and "WorldCover" in err:
        return "outside product coverage (no WorldCover tile; e.g. Antarctica)"
    if "no Copernicus" in err:
        return "ocean (no Copernicus tile)"
    return err[:160]


def compile_index(derived: Path = INDEX_DERIVED, out: Path = INDEX_DIR) -> dict:
    records = _records(derived)
    earth = [r for r in records if r["aoi"]["body"] == "earth"]
    context, ctx_sources = window_context([{"id": r["aoi"]["aoi_id"], "lon": r["aoi"]["lon"], "lat": r["aoi"]["lat"]}
                                           for r in earth])
    names: list[str] = []
    for r in records:
        names += [k for k in r["features"] if k not in names]
    rows, levels, failures, digest = [], Counter(), Counter(), hashlib.sha256()
    stage_status = {s: Counter() for s in ("dem", "landcover", "climate", "geology")}
    for r in records:
        a, f = r["aoi"], r["features"]
        q = aoi_quality(r, verify_files=False)
        level = coverage_level(r, q)
        levels[level] += 1
        for s, v in r["stages"].items():
            stage_status.setdefault(s, Counter())[v["status"]] += 1
            if v["status"] == "failed":
                failures[f"{s}: {_failure_reason(v)}"] += 1
        row = {"aoi_id": a["aoi_id"], "body": a["body"], "pool": a["pool"], "name": a.get("name") or "",
               "lon": f"{a['lon']:.6f}", "lat": f"{a['lat']:.6f}", "coverage_level": level,
               "quality_status": q["status"]}
        for k in names:
            v = f.get(k)
            row[k] = "" if v is None else (v if isinstance(v, str) else repr(round(float(v), 8)))
        ctx = context.get(a["aoi_id"], {})
        for k in CONTEXT_COLUMNS:
            v = ctx.get(k)
            row[k] = "" if v is None else str(v)
        rows.append(row)
        digest.update(json.dumps({"id": a["aoi_id"], "features": f}, sort_keys=True).encode())

    header = ID_COLUMNS + names + list(CONTEXT_COLUMNS)
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=header, lineterminator="\n")
    w.writeheader()
    w.writerows(rows)
    out.mkdir(parents=True, exist_ok=True)
    (out / "windows.csv").write_text(buf.getvalue(), encoding="utf-8", newline="\n")

    meta_by_col: dict[str, dict] = {}
    for r in records:
        for k, m in r["feature_meta"].items():
            if m.get("evidence"):
                e = meta_by_col.setdefault(k, {"evidence": m["evidence"], "sources_by_body": {}, "method": m["method"]})
                e["sources_by_body"][r["aoi"]["body"]] = m["source"]
    columns: dict[str, dict[str, Any]] = {c: {"unit": "id", "description": "identifier / bookkeeping"} for c in ID_COLUMNS}
    for k in names:
        columns[k] = {"unit": unit(k), "description": describe(k), "missing_encoding": "empty cell",
                      **meta_by_col.get(k, {"evidence": None, "sources_by_body": {}, "method": None})}
    for k, (u, d, src) in CONTEXT_COLUMNS.items():
        columns[k] = {"unit": u, "description": d, "evidence": "derived" if u == "km" else "proxy",
                      "sources_by_body": {"earth": src}, "method": "nearest inventory point (haversine)"}
    _dump(out / "columns.json", {"index_version": INDEX_VERSION, "columns": columns})

    used = {m["source"] for r in records for m in r["feature_meta"].values() if m.get("source")}
    manifest = {
        "index_version": INDEX_VERSION, "generated_at": utc_now(), "synthetic": False,
        "n_windows": len(records), "by_body": dict(Counter(r["aoi"]["body"] for r in records)),
        "by_pool": dict(Counter(r["aoi"]["pool"] for r in records)),
        "by_coverage_level": dict(sorted(levels.items())),
        "stage_status": {k: dict(v) for k, v in stage_status.items()},
        "failures": dict(failures.most_common()),
        "sources": [s for s in registry() if s["source_id"] in used] + [{"source_id": k, **v} for k, v in ctx_sources.items()],
        "record_digest_sha256": digest.hexdigest(),
        "windows_csv_sha256": hashlib.sha256((out / "windows.csv").read_bytes()).hexdigest(),
        "reproduce": ["python -m pipeline.discovery acquire --set global --set kz --set benchmark --set targets",
                      "python -m pipeline.discovery index"],
        "notes": ["Native source windows were deleted after feature extraction; their SHA-256 are in the per-window "
                  "records under data/derived (not committed). Re-running acquire restores them from the public COGs.",
                  "Windows on the same 22 km footprint are never duplicated; geo-0.1.0 windows are pooled at build time."],
    }
    _dump(out / "manifest.json", manifest)
    write_geo_context(out)
    from pipeline.discovery.sites import load_countries
    _dump(out / "countries.json", {"source": "Natural Earth 1:50m admin-0 (public domain)",
                                   "names": {c["iso"]: c["name"] for c in load_countries() if c["iso"] and c["iso"] != "-99"}})
    return {k: manifest[k] for k in ("n_windows", "by_pool", "by_coverage_level", "failures")}


def _dump(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, indent=1, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8", newline="\n")


def write_geo_context(out: Path = INDEX_DIR) -> Path:
    """Same context columns for the Earth windows of the geo-0.1.0 release (pooled at build time)."""
    from pipeline.discovery import GEO_RELEASE
    with open(GEO_RELEASE / "aoi_features.csv", newline="", encoding="utf-8") as f:
        geo = [r for r in csv.DictReader(f) if r["body"] == "earth"]
    ctx, _ = window_context([{"id": r["aoi_id"], "lon": float(r["lon"]), "lat": float(r["lat"])} for r in geo])
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=["aoi_id", *CONTEXT_COLUMNS], lineterminator="\n")
    w.writeheader()
    for r in geo:
        c = ctx[r["aoi_id"]]
        w.writerow({"aoi_id": r["aoi_id"], **{k: "" if c.get(k) is None else str(c[k]) for k in CONTEXT_COLUMNS}})
    path = out / "context_geo-0.1.0.csv"
    path.write_text(buf.getvalue(), encoding="utf-8", newline="\n")
    return path
