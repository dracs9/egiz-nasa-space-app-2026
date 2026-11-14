"""Strict CSV compiler for mission parameters and physical-gap alternatives.

Written with AI assistance (Codex); human review pending.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path

from .fidelity import FUNCTIONS

ATTR_KEYS = {
    "slope_f100_p50_deg", "slope_f100_p90_deg", "frac_lt10_f100", "frac_lt20_f100", "tri_f100_m",
    "slope_f400_p50_deg", "slope_f400_p90_deg", "frac_lt10_f400", "frac_lt20_f400", "tri_f400_m",
    "slope_r_p50_deg", "slope_r_p90_deg", "frac_lt20_r", "relief_m", "elev_min_m",
    "precip_mm", "bare_frac", "t_min_c", "t_max_c", "light", "shadow", "geology",
}


def _positive(text, name, allow_zero=False):
    value = float(text)
    if not math.isfinite(value) or (value < 0 if allow_zero else value <= 0):
        raise ValueError(f"{name} must be {'nonnegative' if allow_zero else 'positive'} and finite")
    return value


def _boolean(value):
    if value.strip().lower() not in {"true", "false"}:
        raise ValueError("needs_target must be true or false")
    return value.strip().lower() == "true"


def _params(text):
    if not text.strip():
        return {}
    if text.lstrip().startswith("{"):
        value = json.loads(text)
    else:
        value = {}
        for item in text.split(";"):
            key, number = item.split("=", 1)
            key = key.strip()
            if key in value:
                raise ValueError(f"Duplicate parameter {key}")
            value[key] = float(number)
    if not isinstance(value, dict) or any(not isinstance(v, (float, int)) or not math.isfinite(v) for v in value.values()):
        raise ValueError("params must map names to finite numbers")
    return value


def load_templates(csv_path, gaps_csv) -> dict:
    """Compile one CSV row per attribute; errors include path and CSV line."""
    templates = {}
    with Path(csv_path).open(newline="", encoding="utf-8-sig") as source:
        reader = csv.DictReader(source)
        for line, row in enumerate(reader, 2):
            try:
                tid, oid = row["template_id"].strip(), row["objective_id"].strip()
                body = row["body"].strip()
                if not tid or not oid or body not in {"moon", "mars"}:
                    raise ValueError("template_id/objective_id required; body must be moon or mars")
                attr, fn = row["attr"].strip(), row["fn"].strip()
                if attr not in ATTR_KEYS or fn not in FUNCTIONS - {"impossible"}:
                    raise ValueError(f"Unknown attribute or function: {attr}, {fn}")
                params = _params(row["params"])
                if fn in {"match", "logmatch"}:
                    _positive(params.get("sigma", "nan"), "sigma")
                if fn in {"at_least", "at_most", "colder"}:
                    _positive(params.get("tau", "nan"), "tau")
                if fn in {"at_least", "at_most"} and "a" not in params:
                    raise ValueError("Threshold function requires parameter a")
                priority = row["priority"].strip()
                if priority not in {"P0", "P1"}:
                    raise ValueError("priority must be P0 or P1")
                template = templates.setdefault(tid, {"id": tid, "body": body,
                    "name": row.get("template_name") or tid.replace("_", " "), "objectives": {}})
                if template["body"] != body:
                    raise ValueError("Inconsistent body for template")
                objective = template["objectives"].setdefault(oid, {
                    "id": oid, "name": row["objective_name"], "description": row["description"],
                    "weight_default": _positive(row["weight_default"], "weight_default", True),
                    "attributes": [], "constraints": [
                        {"attr": "water_frac", "op": "<=", "value": 0.5},
                        {"attr": "built_frac", "op": "<=", "value": 0.2},
                    ],
                })
                if any(part["attr"] == attr for part in objective["attributes"]):
                    raise ValueError(f"Duplicate attribute {attr} in {oid}")
                if objective["weight_default"] != float(row["weight_default"]):
                    raise ValueError("Inconsistent objective weight_default")
                objective["attributes"].append({"attr": attr, "fn": fn, "params": params,
                    "weight": _positive(row["weight"], "weight"),
                    "needs_target": _boolean(row["needs_target"]), "priority": priority})
                if attr == "light":
                    objective["constraints"].append({"attr": "snow_free_frac", "op": ">=", "value": 0.5})
            except (KeyError, ValueError, TypeError) as error:
                raise ValueError(f"{csv_path}: line {line}: {error}") from error
    if not templates:
        raise ValueError(f"{csv_path}: no objective rows")
    gaps = []
    with Path(gaps_csv).open(newline="", encoding="utf-8-sig") as source:
        for line, row in enumerate(csv.DictReader(source), 2):
            try:
                source_key = row.get("source") or row["source_key"]
                if row["body"] not in {"moon", "mars", "both"} or not source_key.strip():
                    raise ValueError("Gap body or source is invalid")
                gaps.append({"gap": row["gap"], "body": row["body"],
                             "alternative": row["alternative"], "source": source_key})
            except (KeyError, ValueError) as error:
                raise ValueError(f"{gaps_csv}: line {line}: {error}") from error
    epoch = os.environ.get("SOURCE_DATE_EPOCH")
    generated = datetime.fromtimestamp(int(epoch), timezone.utc) if epoch else datetime.now(timezone.utc)
    return {
        "schema": "egiz.mission_templates", "version": "1.0.0",
        "generated_at": generated.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "synthetic": False,
        "provenance": [{"dataset": "Egiz mathematical specification", "provider": "Egiz team",
                        "version": "1.0.0", "url": "docs/science/MATHEMATICAL_SPECIFICATION.md",
                        "role": "provisional_method_parameters"}],
        "params": {"shortlist_per_objective": 20, "missing_weight_max": 0.3, "gap_threshold": 0.1, "k_max": 3},
        "templates": [dict(t, objectives=list(t["objectives"].values())) for t in templates.values()],
        "gap_alternatives": gaps,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", default="data/curated/mission_templates.csv")
    parser.add_argument("--gaps", default="data/curated/gap_alternatives.csv")
    parser.add_argument("--out", default="data/processed/mission_templates.json")
    args = parser.parse_args()
    from pipeline.contracts.validate import validate_data
    data = load_templates(args.csv, args.gaps)
    validate_data(data)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(out)


if __name__ == "__main__":
    main()
