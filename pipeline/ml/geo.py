"""Adapter for a geospatial release (geo-0.1.0, docs/GEOSPATIAL_DATA_INTERFACE.md).

Earth rows of ``aoi_features.csv`` become engine candidate tiles; targets,
mission templates and Sun windows still come from a contract snapshot
(``data/pilot``). Only engine attributes with an identical definition are
copied. Climate and geology stay as labelled context, never as substitutes:

* the spec defines ``t_min_c``/``t_max_c`` as MODIS land-surface temperature and
  ``precip_mm`` as GPM IMERG; the release has modelled 2 m air temperature and
  NASA POWER precipitation, so these engine attributes stay ``None``;
* ``geo_*`` columns are geologic-map categories (proxy), not mineralogy.

Moon/Mars rows are reference targets in the release and are never candidates.

Written with AI assistance (Claude Code); human review pending.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import math
from pathlib import Path
from typing import Any

from pipeline.contracts.validate import ContractError

from .loader import Snapshot, load_snapshot

ROOT = Path(__file__).resolve().parents[2]
SUPPORTED_SCHEMA_MAJOR = "1."
ENGINE_ATTRS = (
    "slope_f400_p50_deg", "slope_f400_p90_deg", "frac_lt10_f400", "frac_lt20_f400", "tri_f400_m",
    "slope_f100_p50_deg", "slope_f100_p90_deg", "frac_lt10_f100", "frac_lt20_f100", "tri_f100_m",
    "slope_r_p50_deg", "slope_r_p90_deg", "frac_lt20_r", "relief_m", "elev_min_m", "bare_frac",
)
CONTEXT = ("tree_frac", "crop_frac", "built_frac", "water_frac", "snow_frac")
UNMAPPED = {
    "t_min_c": "not in release: spec defines MODIS night LST P5; release has modelled t2m air temperature",
    "t_max_c": "not in release: spec defines MODIS day LST; release has modelled t2m air temperature",
    "precip_mm": "not in release: spec defines GPM IMERG annual mean; release has NASA POWER climatology",
}
ENVIRONMENT = ("t2m_min_coldest_month_c", "t2m_max_warmest_month_c", "t2m_mean_annual_c",
               "t2m_seasonal_range_c", "precip_annual_mm")
GEOLOGY_TEXT = ("geo_unit_name_label", "geo_lith_label", "geo_age_interval_label", "geo_map_scale_label")
GEOLOGY_NUMERIC = ("geo_age_top_ma", "geo_age_bottom_ma")
RANKABLE_LEVELS = {"L1_dem", "L2_environment", "L3_geology", "L4_validated"}
EXPECTED_UNITS = {"_deg": {"deg"}, "_m": {"m"}, "_frac": {"frac", "fraction", "1", "unitless"}}


def _float_or_none(text: str | None) -> float | None:
    if text is None or text.strip() == "":
        return None
    value = float(text)
    if not math.isfinite(value):
        raise ContractError(f"non-finite value {text!r} (missing must be an empty cell)")
    return value


def _validate_schema(data: dict, schema_path: Path) -> None:
    import jsonschema

    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    try:
        jsonschema.Draft202012Validator(schema).validate(data)
    except jsonschema.ValidationError as error:
        raise ContractError(f"{schema_path.name}: {error.message}") from error


def _check_units(columns: dict[str, Any]) -> None:
    for attr in ENGINE_ATTRS + CONTEXT:
        unit = columns[attr].get("unit")
        if attr.startswith("frac_"):
            expected = EXPECTED_UNITS["_frac"]
        else:
            suffix = next(s for s in ("_deg", "_frac", "_m") if attr.endswith(s))
            expected = EXPECTED_UNITS[suffix]
        if unit not in expected:
            raise ContractError(f"{attr}: unit {unit!r} incompatible with engine unit {sorted(expected)}")


def load_geo_snapshot(geo_dir: str | Path, base_dir: str | Path = ROOT / "data" / "pilot", *,
                      ids: list[str] | None = None, limit: int | None = None) -> Snapshot:
    """Validated snapshot with Earth candidates from a geospatial release."""
    geo_dir, base_dir = Path(geo_dir), Path(base_dir)
    files: dict[str, dict[str, Any]] = {}

    def read(name: str) -> bytes:
        path = geo_dir / name
        if not path.exists():
            raise ContractError(f"Missing geospatial release file: {path}")
        raw = path.read_bytes()
        files[f"geo:{name}"] = {"sha256": hashlib.sha256(raw).hexdigest(), "schema": "egiz.geospatial",
                                "version": None}
        return raw

    catalog = json.loads(read("aoi_catalog.json"))
    columns_doc = json.loads(read("aoi_features.columns.json"))
    sources_doc = json.loads(read("manifests/sources.json"))
    rows = list(csv.DictReader(io.StringIO(read("aoi_features.csv").decode("utf-8"))))
    schemas = ROOT / "contracts" / "geospatial"
    _validate_schema(catalog, schemas / "aoi_catalog.schema.json")
    _validate_schema(columns_doc, schemas / "aoi_features_columns.schema.json")

    versions = {doc.get("dataset_version") for doc in (catalog, columns_doc, sources_doc)}
    schema_versions = {str(doc.get("schema_version", "")) for doc in (catalog, columns_doc, sources_doc)}
    if len(versions) != 1:
        raise ContractError(f"Mixed dataset versions in release: {sorted(map(str, versions))}")
    if not all(v.startswith(SUPPORTED_SCHEMA_MAJOR) for v in schema_versions):
        raise ContractError(f"Unsupported geospatial schema version(s): {sorted(schema_versions)}")
    if catalog.get("synthetic") is not False:
        raise ContractError("Geospatial release must be non-synthetic")
    dataset_version = versions.pop()
    for meta in files.values():
        meta["version"] = dataset_version

    columns = columns_doc["columns"]
    header = set(rows[0]) if rows else set()
    if header - set(columns):
        raise ContractError(f"Columns missing from the column dictionary: {sorted(header - set(columns))}")
    absent = [attr for attr in ENGINE_ATTRS + CONTEXT if attr not in header]
    if absent:
        raise ContractError(f"Release lacks required engine columns: {absent}")
    _check_units(columns)

    by_id = {aoi["aoi_id"]: aoi for aoi in catalog["aois"]}
    if {row["aoi_id"] for row in rows} != set(by_id):
        raise ContractError("aoi_features.csv and aoi_catalog.json list different AOIs")

    base = load_snapshot(base_dir)
    files.update({f"base:{k}": v for k, v in base.files.items() if k not in {"earth_candidates", "results"}})

    earth = sorted((row for row in rows if row["body"] == "earth"), key=lambda row: row["aoi_id"])
    if ids is not None:
        unknown = set(ids) - {row["aoi_id"] for row in earth}
        if unknown:
            raise ContractError(f"Unknown candidate IDs: {sorted(unknown)}")
        earth = [row for row in earth if row["aoi_id"] in set(ids)]
    if limit is not None:
        if limit < 1:
            raise ValueError("limit must be positive")
        earth = earth[:limit]

    candidates, skipped = [], []
    for row in earth:
        aoi = by_id[row["aoi_id"]]
        if row["quality_status"] != "pass":
            skipped.append({"id": row["aoi_id"], "reason": f"quality_status {row['quality_status']}"})
            continue
        if row["coverage_level"] not in RANKABLE_LEVELS:
            skipped.append({"id": row["aoi_id"], "reason": f"coverage_level {row['coverage_level']} has no terrain"})
            continue
        try:
            attrs = {attr: _float_or_none(row[attr]) for attr in ENGINE_ATTRS}
            context = {attr: _float_or_none(row[attr]) for attr in CONTEXT}
            environment = {attr: _float_or_none(row.get(attr)) for attr in ENVIRONMENT}
            geology: dict[str, Any] = {attr: (row.get(attr) or None) for attr in GEOLOGY_TEXT}
            geology.update({attr: _float_or_none(row.get(attr)) for attr in GEOLOGY_NUMERIC})
        except (ContractError, ValueError) as error:
            skipped.append({"id": row["aoi_id"], "reason": str(error)})
            continue
        attrs.update({attr: None for attr in UNMAPPED})
        reasons = {**aoi.get("missing", {}), **UNMAPPED}
        candidates.append({
            "id": row["aoi_id"], "name": aoi.get("name", row["aoi_id"]), "country": aoi.get("country"),
            "lon": float(row["lon"]), "lat": float(row["lat"]), "pool": row["pool"],
            "site_id": row["site_id"], "group_id": row["group_id"],
            "coverage_level": row["coverage_level"], "quality_status": row["quality_status"],
            "attrs": attrs, "context": context,
            "missing": sorted(attr for attr, value in attrs.items() if value is None),
            "missing_reasons": reasons, "environment": environment, "geology": geology,
        })

    sources = [{"id": s.get("source_id", f"geo:{i}"), "dataset": s.get("name", ""),
                "role": s.get("product_id", ""), "url": s.get("url", "")}
               for i, s in enumerate(sources_doc.get("sources", []), start=1)]
    sources += [s for s in base.sources if s["id"].startswith("targets:")]
    issues = list(base.issues) + [
        "Engine climate attributes (t_min_c, t_max_c, precip_mm) are not substituted from the release's "
        "modelled t2m / POWER columns; cold/dry objectives stay non-computable",
    ]
    return Snapshot(path=geo_dir.as_posix(), files=files, synthetic=False, candidates=candidates,
                    targets=base.targets, templates=base.templates, params=base.params,
                    gap_alternatives=base.gap_alternatives, sun=base.sun, results=None,
                    results_consistent=None, sources=sources, skipped=skipped, issues=issues,
                    kind="geo", dataset_version=dataset_version)
