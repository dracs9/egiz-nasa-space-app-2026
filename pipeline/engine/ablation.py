"""Attribute-family ablation and strict-minimum alternative aggregation.

Written with AI assistance (Codex); human review pending.
"""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path

import numpy as np

from .campaign import design
from .robustness import jaccard
from .run import compute_run


def family(attr):
    if "f100" in attr or "f400" in attr:
        return "terrain_fine"
    if attr in {"light", "shadow"}:
        return "light"
    if attr in {"relief_m", "elev_min_m", "frac_lt20_r", "slope_r_p50_deg", "slope_r_p90_deg"}:
        return "terrain_regional"
    return "environment"


def run(candidates, targets, templates, sun=None):
    params = dict(templates["params"], gap_alternatives=templates.get("gap_alternatives", []))
    results = []
    for target in targets["targets"]:
        for template in templates["templates"]:
            if template["id"] not in target["templates"] or template["body"] != target["body"]:
                continue
            baseline = compute_run(candidates, target, template, sun, params)
            for drop in ("terrain_fine", "terrain_regional", "environment", "light", "minimum"):
                modified = copy.deepcopy(template)
                removed = []
                if drop != "minimum":
                    for objective in modified["objectives"]:
                        objective["attributes"] = [part for part in objective["attributes"] if family(part["attr"]) != drop]
                        if not objective["attributes"]:
                            removed.append(objective["id"])
                    modified["objectives"] = [o for o in modified["objectives"] if o["id"] not in removed]
                if not modified["objectives"]:
                    results.append({"target": target["id"], "template": template["id"], "variant": drop,
                                    "removed_objectives": removed, "campaigns": [], "notes": "All objectives removed"})
                    continue
                value = compute_run(candidates, target, modified, sun, params)
                if drop == "minimum":
                    ids = sorted(tile["id"] for tile in candidates["tiles"] if tile["pool"] != "control")
                    objectives = modified["objectives"]
                    F = []
                    for id_ in ids:
                        row = []
                        for objective in objectives:
                            cell = value["fidelity"][objective["id"]][id_]
                            known = [p for p in cell.get("parts", {}).values() if p is not None]
                            row.append(min(known) if cell["F"] is not None and known else None)
                        F.append(row)
                    value["campaigns"] = design(np.array(F, dtype=float), [o["weight_default"] for o in objectives],
                                                site_ids=ids, objective_ids=[o["id"] for o in objectives])
                comparisons = []
                for after in value["campaigns"]:
                    before = next(c for c in baseline["campaigns"] if c["k"] == after["k"])
                    left = {site["id"] for site in before["sites"]}
                    right = {site["id"] for site in after["sites"]}
                    comparisons.append({"k": after["k"], "coverage": after["coverage"],
                                        "coverage_delta": after["coverage"] - before["coverage"],
                                        "selection_jaccard": jaccard(left, right), "sites": after["sites"]})
                results.append({"target": target["id"], "template": template["id"], "variant": drop,
                                "removed_objectives": removed, "campaigns": comparisons,
                                "notes": "Coverage denominators differ when entire objectives are removed; delta is descriptive."})
    return {"synthetic": candidates["synthetic"] or targets["synthetic"] or templates["synthetic"],
            "variants": results}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default="data/fixtures")
    parser.add_argument("--out")
    args = parser.parse_args()
    base = Path(args.data_dir)
    from pipeline.contracts.validate import validate_file
    data = {name: validate_file(base / f"{name}.json") for name in
            ("earth_candidates", "targets", "mission_templates", "sun_windows")}
    report = run(data["earth_candidates"], data["targets"], data["mission_templates"], data["sun_windows"])
    out = Path(args.out) if args.out else base / "ablation_report.json"
    if report["synthetic"] and "processed" in out.parts:
        raise ValueError("Synthetic ablation cannot be written into data/processed")
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
    print(out)


if __name__ == "__main__":
    main()
