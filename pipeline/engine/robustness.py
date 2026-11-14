"""Seeded sensitivity experiments that recompute scientific scores from inputs.

Written with AI assistance (Codex); human review pending.
"""

from __future__ import annotations

import argparse
import copy
import json
import math
from pathlib import Path

import numpy as np

from .run import compute_run


def _sites(run, k):
    campaign = next((item for item in run["campaigns"] if item["k"] == k), None)
    return {item["id"] for item in campaign["sites"]} if campaign else set()


def jaccard(left, right):
    return len(left & right) / len(left | right) if left | right else 1.0


def run(candidates, targets, templates, sun=None, *, runs=200, seed=2026, mask_runs=50):
    """Perturb weights, tolerance, and pool; separately measure 10% missingness.

    Returns (contract robustness document, detailed diagnostics). The contract
    stores k=3 results; diagnostics retain both k=2 and k=3 and masking trials.
    No score is perturbed directly: every fidelity is recomputed from attributes.
    """
    if runs < 1 or mask_runs < 0:
        raise ValueError("runs must be positive and mask_runs nonnegative")
    rng = np.random.default_rng(seed)
    report = {"schema": "egiz.robustness", "version": "1.0.0",
              "generated_at": max(candidates["generated_at"], targets["generated_at"], templates["generated_at"]),
              "synthetic": any(value["synthetic"] for value in (candidates, targets, templates)) or bool(sun and sun["synthetic"]),
              "provenance": candidates["provenance"] + targets["provenance"] + templates["provenance"],
              "runs": runs, "seed": seed, "selection_freq": {}, "jaccard_median": {}}
    details = {}
    params = dict(templates["params"], gap_alternatives=templates.get("gap_alternatives", []))
    pool = [tile for tile in candidates["tiles"] if tile["pool"] != "control"]
    if not pool:
        raise ValueError("Robustness needs at least one non-control candidate")
    for target in targets["targets"]:
        for template in templates["templates"]:
            if template["id"] not in target["templates"] or template["body"] != target["body"]:
                continue
            base = compute_run(candidates, target, template, sun, params)
            key = target["id"]
            if key in details:
                key = f"{key}__{template['id']}"
            counters = {k: {tile["id"]: 0 for tile in pool} for k in (2, 3)}
            overlaps = {k: [] for k in (2, 3)}
            mask_overlaps = {k: [] for k in (2, 3)}
            close_coverage = {k: [] for k in (2, 3)}
            for _ in range(runs):
                perturbed = copy.deepcopy(template)
                for objective in perturbed["objectives"]:
                    objective["weight_default"] *= rng.uniform(0.8, 1.2)
                    for part in objective["attributes"]:
                        part["weight"] *= rng.uniform(0.8, 1.2)
                        for name in part["params"]:
                            if name in {"sigma", "tau", "hours_tau", "sweep_tau"}:
                                part["params"][name] *= rng.uniform(0.7, 1.3)
                indices = rng.choice(len(pool), size=max(1, math.ceil(0.8 * len(pool))), replace=False)
                sampled = dict(candidates, tiles=[pool[i] for i in sorted(indices)])
                value = compute_run(sampled, target, perturbed, sun, params)
                for k in (2, 3):
                    selected = _sites(value, k)
                    for id_ in selected:
                        counters[k][id_] += 1
                    overlaps[k].append(jaccard(selected, _sites(base, k)))
                    a = next(c["coverage"] for c in value["campaigns"] if c["k"] == k)
                    b = next(c["coverage"] for c in base["campaigns"] if c["k"] == k)
                    close_coverage[k].append(abs(a - b) <= 0.05)
            for _ in range(mask_runs):
                masked = copy.deepcopy(candidates)
                for tile in masked["tiles"]:
                    for attr in tile["attrs"]:
                        if rng.random() < 0.1:
                            tile["attrs"][attr] = None
                value = compute_run(masked, target, template, sun, params)
                for k in (2, 3):
                    mask_overlaps[k].append(jaccard(_sites(value, k), _sites(base, k)))
            report["selection_freq"][key] = {id_: count / runs for id_, count in counters[3].items()}
            report["jaccard_median"][key] = float(np.median(overlaps[3]))
            details[key] = {str(k): {"selection_freq": {id_: count / runs for id_, count in counters[k].items()},
                                    "jaccard_median": float(np.median(overlaps[k])),
                                    "coverage_within_0_05": float(np.mean(close_coverage[k])),
                                    "mask_jaccard_median": float(np.median(mask_overlaps[k])) if mask_runs else None}
                            for k in (2, 3)}
    return report, details


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default="data/fixtures")
    parser.add_argument("--runs", type=int, default=200)
    parser.add_argument("--mask-runs", type=int, default=50)
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--out")
    args = parser.parse_args()
    base = Path(args.data_dir)
    from pipeline.contracts.validate import validate_data, validate_file
    data = {name: validate_file(base / f"{name}.json") for name in
            ("earth_candidates", "targets", "mission_templates", "sun_windows")}
    report, details = run(data["earth_candidates"], data["targets"], data["mission_templates"], data["sun_windows"],
                          runs=args.runs, seed=args.seed, mask_runs=args.mask_runs)
    validate_data(report)
    out = Path(args.out) if args.out else base / "robustness.json"
    if report["synthetic"] and "processed" in out.parts:
        raise ValueError("Synthetic robustness cannot be written into data/processed")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n")
    diagnostic = out.with_name(out.stem + "_diagnostics.json")
    diagnostic.write_text(json.dumps(details, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n")
    print(out)


if __name__ == "__main__":
    main()
