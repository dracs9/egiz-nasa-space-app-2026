"""Negative controls and deterministic optimization sanity diagnostics.

Written with AI assistance (Codex); human review pending.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from .validate_practice import rank


def run(results, candidates, seed=2026, *, random_campaigns=1000, weights=None) -> dict:
    if isinstance(results, (str, Path)):
        results = json.loads(Path(results).read_text())
    if isinstance(candidates, (str, Path)):
        candidates = json.loads(Path(candidates).read_text())
    eligible_ids = {tile["id"] for tile in candidates["tiles"] if tile["pool"] != "control"}
    controls = [tile for tile in candidates["tiles"] if tile["pool"] == "control"]
    rng = np.random.default_rng(seed)
    details, sanity = [], []
    violations = 0
    for item in results["runs"]:
        for objective, cells in item["fidelity"].items():
            for tile in candidates["tiles"]:
                context = tile.get("context", {})
                constrained = any(context.get(attr) is not None and context[attr] > threshold
                                  for attr, threshold in (("water_frac", 0.5), ("built_frac", 0.2)))
                if constrained and cells.get(tile["id"], {}).get("reason") != "constraint":
                    violations += 1
            scores = {id_: cell["F"] for id_, cell in cells.items() if id_ in eligible_ids}
            for tile in controls:
                cell = cells.get(tile["id"], {"F": None, "reason": "missing"})
                comparison = dict(scores, **{tile["id"]: cell["F"]})
                r, n = rank(comparison, tile["id"])
                details.append({"target": item["target"], "objective": objective, "tile": tile["id"],
                                "rank": r, "n": n, "pct": 100 * r / n if r is not None else None,
                                "reason": cell.get("reason")})
        ids = sorted(eligible_ids)
        objective_ids = list(item["fidelity"])
        F = np.array([[item["fidelity"][o].get(id_, {}).get("F") or 0.0 for o in objective_ids] for id_ in ids])
        W = np.array([weights.get(o, 1) if weights else 1 for o in objective_ids], dtype=float)
        W /= W.sum()
        for campaign in item["campaigns"]:
            k = min(campaign["k"], len(ids))
            random_scores = [float(np.max(F[rng.choice(len(ids), size=k, replace=False)], axis=0) @ W)
                             for _ in range(random_campaigns)] if ids else []
            median = float(np.median(random_scores)) if random_scores else None
            method = campaign["method"]
            sanity.append({"target": item["target"], "k": campaign["k"], "random_median": median,
                           "exact_ge_greedy": method["exact_coverage"] + 1e-9 >= method["greedy_coverage"],
                           "greedy_ge_random_median": median is None or method["greedy_coverage"] + 1e-9 >= median})
    evaluable = [item for item in details if item["pct"] is not None]
    top = sum(item["pct"] <= 5 for item in evaluable)
    synthetic = results.get("synthetic", False) or candidates.get("synthetic", False)
    status = ("inconclusive" if synthetic or not controls or not evaluable else
              "confirmed" if top == 0 and violations == 0 else "not_confirmed")
    return {"controls": [{"name": "top_5_percent_fraction", "value": top / len(evaluable) if evaluable else None},
                         {"name": "constraint_violations", "value": violations}],
            "experiment": {"id": "E7", "hypothesis": "No controls in top5%; water/built constraints exclude sites",
                           "metric": "top_5_percent_fraction", "value": top / len(evaluable) if evaluable else None,
                           "status": status,
                           "notes": "Synthetic software check only. " if synthetic else ""},
            "details": details, "sanity": sanity, "seed": seed}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default="data/fixtures")
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--out")
    args = parser.parse_args()
    base = Path(args.data_dir)
    report = run(base / "results.json", base / "earth_candidates.json", args.seed)
    text = json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if args.out:
        Path(args.out).write_text(text)
    else:
        print(text, end="")


if __name__ == "__main__":
    main()
