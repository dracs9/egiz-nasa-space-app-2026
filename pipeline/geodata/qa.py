# Written with AI assistance (Claude Code); reviewed by: pending (Geo lead).
"""Data-quality checks for per-AOI records and a published release.

Range limits are plausibility bounds (catch unit/scale/nodata errors), not
scientific thresholds.
"""
from __future__ import annotations

import math
import re
from pathlib import Path

import rasterio

from pipeline.geodata import EVIDENCE_CLASSES, ROOT
from pipeline.geodata.cache import sha256_file

UNIT_SUFFIXES = ("_deg", "_m", "_c", "_mm", "_frac", "_ma", "_unitless", "_per_m", "_label")
ELEV_RANGE = {"earth": (-500, 9000), "moon": (-10000, 11000), "mars": (-9000, 22000)}
LEGACY_FRACTION = re.compile(r"^frac_lt\d+_(f\d+|r)$")
RANGES = [
    (LEGACY_FRACTION, (0, 1)),
    (re.compile(r".*_frac$"), (0, 1)),
    (re.compile(r"^slope_.*_deg$"), (0, 90)),
    (re.compile(r".*_unitless$"), (-1, 1)),
    (re.compile(r"^tri_.*_m$"), (0, 2000)),
    (re.compile(r"^relief_m$"), (0, 12000)),
    (re.compile(r"^elev_std_m$"), (0, 5000)),
    (re.compile(r"^t2m_seasonal_range_c$"), (0, 80)),
    (re.compile(r"^t2m_.*_c$"), (-90, 60)),
    (re.compile(r"^precip_annual_mm$"), (0, 15000)),
    (re.compile(r"^geo_age_.*_ma$"), (0, 4600)),
    (re.compile(r"^curv_.*_per_m$"), (0, 1)),
]


def check(name, ok, detail=""):
    return {"check": name, "status": "pass" if ok else "fail", "detail": detail}


def feature_checks(record: dict) -> list[dict]:
    body = record["aoi"]["body"]
    out, bad_units, bad_range, bad_meta = [], [], [], []
    for name, value in record["features"].items():
        # Legacy shared-terrain names (pipeline/common/terrain.py) carry the unit as a prefix: frac_lt10_f400.
        if not name.endswith(UNIT_SUFFIXES) and not LEGACY_FRACTION.match(name):
            bad_units.append(name)
        meta = record["feature_meta"].get(name, {})
        if value is None:
            if name not in record["missing"]:
                bad_meta.append(f"{name}: null without missing reason")
            continue
        if meta.get("evidence") not in EVIDENCE_CLASSES or not meta.get("source"):
            bad_meta.append(f"{name}: evidence/source missing")
        if isinstance(value, str):
            continue
        if not math.isfinite(value):
            bad_range.append(f"{name}={value}")
            continue
        limits = ELEV_RANGE[body] if name.startswith("elev_") and name != "elev_std_m" else next(
            (r for pattern, r in RANGES if pattern.match(name)), None)
        if limits and not limits[0] <= value <= limits[1]:
            bad_range.append(f"{name}={value:.4g} outside {limits}")
    out.append(check("units_suffix", not bad_units, ", ".join(bad_units)))
    out.append(check("plausible_ranges", not bad_range, "; ".join(bad_range)))
    out.append(check("evidence_and_missing_metadata", not bad_meta, "; ".join(bad_meta)))
    f = record["features"]
    order = [f.get(k) for k in ("elev_p05_m", "elev_p50_m", "elev_p95_m")]
    if None not in order:
        out.append(check("elevation_percentiles_ordered", order[0] <= order[1] <= order[2]))
    bins = [v for k, v in f.items() if "_bin_" in k and v is not None]
    if bins:
        out.append(check("slope_histogram_sums_to_one", abs(sum(bins) - 1) < 1e-6, f"sum={sum(bins):.6f}"))
    if f.get("t2m_max_warmest_month_c") is not None and f.get("t2m_min_coldest_month_c") is not None:
        out.append(check("t2m_max_ge_min", f["t2m_max_warmest_month_c"] >= f["t2m_min_coldest_month_c"]))
    water = f.get("water_frac")
    if water is not None and water > .5:
        # Copernicus DSM sets water bodies to a flat surface: terrain stats then describe water, not ground.
        out.append({"check": "water_dominated_window", "status": "warn",
                    "detail": f"water_frac={water:.2f}; terrain statistics describe a water-flattened DSM surface"})
    if record["aoi"]["aoi_id"].startswith("FAKE_") or record.get("synthetic"):
        out.append(check("no_synthetic_in_release", False, "synthetic record"))
    return out


def asset_checks(record: dict, *, verify_files=True) -> list[dict]:
    out = []
    problems = []
    for item in record.get("assets", []) + record.get("patches", []):
        path = ROOT / item["path"]
        if not path.exists():
            # Raw caches may be absent on another machine; checksum is still recorded.
            if verify_files:
                problems.append(f"missing file {item['path']}")
            continue
        if sha256_file(path) != item["sha256"]:
            problems.append(f"checksum mismatch {item['path']}")
        if path.suffix == ".tif":
            with rasterio.open(path) as src:
                if src.crs is None:
                    problems.append(f"no CRS {item['path']}")
                if "pixel_m" in item and not (abs(src.res[0] - item["pixel_m"]) < 1e-9 and abs(src.res[1] - item["pixel_m"]) < 1e-9):
                    problems.append(f"non-square or wrong pixel {item['path']} {src.res}")
                if src.transform.b != 0 or src.transform.d != 0:
                    problems.append(f"rotated grid {item['path']}")
    out.append(check("assets_present_checksums_crs_pixels", not problems, "; ".join(problems)))
    return out


def stage_checks(record: dict) -> list[dict]:
    failed = {k: v.get("error", "") for k, v in record["stages"].items() if v.get("status") == "failed"}
    return [check("stages_without_errors", not failed, "; ".join(f"{k}: {v}" for k, v in failed.items()))]


def aoi_quality(record: dict, *, verify_files=True) -> dict:
    checks = stage_checks(record) + feature_checks(record) + asset_checks(record, verify_files=verify_files)
    failed = [c for c in checks if c["status"] == "fail"]
    return {"aoi_id": record["aoi"]["aoi_id"], "status": "pass" if not failed else "fail", "checks": checks}


def validate_release(release_dir: Path) -> list[str]:
    """Cross-file checks on a built release; returns a list of error strings (empty = valid)."""
    import csv
    import json

    import jsonschema

    errors = []
    schemas = ROOT / "contracts" / "geospatial"
    catalog = json.loads((release_dir / "aoi_catalog.json").read_text(encoding="utf-8"))
    for name, data in [("aoi_catalog", catalog),
                       ("asset_manifest", json.loads((release_dir / "manifests/assets.json").read_text(encoding="utf-8"))),
                       ("aoi_features_columns", json.loads((release_dir / "aoi_features.columns.json").read_text(encoding="utf-8")))]:
        schema = json.loads((schemas / f"{name}.schema.json").read_text(encoding="utf-8"))
        for err in jsonschema.Draft202012Validator(schema).iter_errors(data):
            errors.append(f"{name}: {err.json_path}: {err.message}")
    ids = [a["aoi_id"] for a in catalog["aois"]]
    if len(ids) != len(set(ids)):
        errors.append("duplicate aoi_id in catalog")
    sites = [a["site_id"] for a in catalog["aois"]]
    if len(sites) != len(set(sites)):
        errors.append("one site counted as several AOIs")
    columns = json.loads((release_dir / "aoi_features.columns.json").read_text(encoding="utf-8"))["columns"]
    with (release_dir / "aoi_features.csv").open(newline="", encoding="utf-8") as file:
        reader = csv.DictReader(file)
        header = reader.fieldnames or []
        rows = list(reader)
    if set(header) != set(columns):
        errors.append(f"csv header and column dictionary differ: {sorted(set(header) ^ set(columns))}")
    if [r["aoi_id"] for r in rows] != ids:
        errors.append("aoi_features.csv rows do not match catalog order")
    for row in rows:
        for key, value in row.items():
            if value in {"nan", "NaN", "inf", "-inf"}:
                errors.append(f"{row['aoi_id']}.{key}: non-finite literal")
    with (release_dir / "patch_index.csv").open(newline="", encoding="utf-8") as file:
        patches = list(csv.DictReader(file))
    pids = [p["patch_id"] for p in patches]
    if len(pids) != len(set(pids)):
        errors.append("duplicate patch_id")
    if not {p["aoi_id"] for p in patches} <= set(ids):
        errors.append("patch_index references unknown aoi_id")
    groups = {a["aoi_id"]: a["group_id"] for a in catalog["aois"]}
    if any(groups.get(p["aoi_id"]) != p["group_id"] for p in patches):
        errors.append("patch group_id differs from its AOI group_id")
    return errors
