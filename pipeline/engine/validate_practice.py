"""Transparent practice-site ranks, baselines and clustered uncertainty.

Written with AI assistance (Codex); human review pending.
Unregistered or synthetic runs are software demonstrations, not scientific E3 evidence.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path

import numpy as np

from .fidelity import attribute_fidelity


def rank(scores, site):
    """One-based rank with lexical ID tie breaking; nulls are ineligible."""
    eligible = sorted(((id_, value) for id_, value in scores.items() if value is not None),
                      key=lambda item: (-item[1], item[0]))
    ids = [item[0] for item in eligible]
    return (ids.index(site) + 1, len(ids)) if site in ids else (None, len(ids))


def _binomial_tail(k, n, probability=0.1):
    return min(1.0, sum(math.comb(n, i) * probability ** i * (1 - probability) ** (n - i)
                        for i in range(k, n + 1)))


def run(results, candidates, practice_csv, *, preregistration_commit="", seed=2026,
        bootstrap_runs=2000, templates=None, targets=None, sun=None) -> dict:
    """Report every source pair, even exclusions and unavailable measurements.

    A secondary analysis cannot be reconstructed from an F score. When the
    original templates and targets are supplied, it is recomputed using only
    attributes whose preregistered needs_target flag is false.
    """
    if isinstance(results, (str, Path)):
        results = json.loads(Path(results).read_text())
    if isinstance(candidates, (str, Path)):
        candidates = json.loads(Path(candidates).read_text())
    tiles = {tile["id"]: tile for tile in candidates["tiles"] if tile["pool"] != "control"}
    pairs = []
    secondary_pairs = []
    dry_percentiles = []
    secondary_runs = {}
    if templates is not None and targets is not None:
        import copy

        from .run import compute_run
        for target in targets["targets"]:
            for template in templates["templates"]:
                if template["id"] not in target["templates"] or template["body"] != target["body"]:
                    continue
                reduced = copy.deepcopy(template)
                for objective in reduced["objectives"]:
                    objective["attributes"] = [part for part in objective["attributes"] if not part["needs_target"]]
                reduced["objectives"] = [o for o in reduced["objectives"] if o["attributes"]]
                if reduced["objectives"]:
                    value = compute_run(candidates, target, reduced, sun, templates["params"])
                    secondary_runs[(target["id"], template["id"])] = value
    with Path(practice_csv).open(newline="", encoding="utf-8-sig") as source:
        for row in csv.DictReader(source):
            site = row["site_id"]
            tile_id = next((id_ for id_ in (site, f"PR_{site}", f"FAKE_PR_{site}") if id_ in tiles), f"PR_{site}")
            objective = row["objective_id"]
            context = row.get("target_context", "")
            matching = [item for item in results["runs"] if objective in item["fidelity"] and
                        (not context or context in item["target"] or context.lower() in item["target"].lower())]
            # Contexts such as "moon" identify the body's run. A pair is not
            # duplicated over unrelated targets when an exact target is supplied.
            if not matching:
                matching = [None]
            for item in matching:
                testable = row.get("testable", "false").lower() == "true"
                excluded = row.get("exclusion_reason") or None
                if testable and excluded:
                    raise ValueError(f"Practice pair {site}/{objective}: testable with an exclusion reason")
                r = n = pct = None
                if testable and item is None:
                    excluded = "No matching target/objective run"
                elif testable and tile_id not in tiles:
                    excluded = "Practice tile is absent from candidate snapshot"
                elif testable:
                    assert item is not None  # guaranteed by the first branch
                    scores = {id_: cell["F"] for id_, cell in item["fidelity"][objective].items() if id_ in tiles}
                    r, n = rank(scores, tile_id)
                    if r is None:
                        excluded = "Practice tile is ineligible for this objective"
                    else:
                        pct = 100 * r / n
                        dry_scores = {}
                        for id_, tile in tiles.items():
                            if scores.get(id_) is None:
                                continue
                            dry = attribute_fidelity({"fn": "at_most", "params": {"a": 50, "tau": 100}}, tile["attrs"].get("precip_mm"))
                            bare = attribute_fidelity({"fn": "at_least", "params": {"a": 0.8, "tau": 0.2}}, tile["attrs"].get("bare_frac"))
                            dry_scores[id_] = dry * bare if dry is not None and bare is not None else None
                        dry_rank, dry_n = rank(dry_scores, tile_id)
                        if dry_rank is not None:
                            dry_percentiles.append(100 * dry_rank / dry_n)
                pairs.append({"site": site, "tile": tile_id, "objective": objective,
                              "target": item["target"] if item else context,
                              "source": row.get("source", row.get("source_key", "")),
                              "testable": testable, "exclusion_reason": excluded,
                              "rank": r, "n": n, "pct": pct})
                if item is not None and testable:
                    secondary = secondary_runs.get((item["target"], item.get("template")))
                    cells = secondary["fidelity"].get(objective) if secondary else None
                    if cells is not None:
                        sr, sn = rank({id_: cell["F"] for id_, cell in cells.items() if id_ in tiles}, tile_id)
                        secondary_pairs.append({"site": site, "tile": tile_id, "target": item["target"],
                                                "objective": objective, "rank": sr, "n": sn,
                                                "pct": 100 * sr / sn if sr is not None else None})
    observed = [pair for pair in pairs if pair["pct"] is not None]
    values = [pair["pct"] for pair in observed]
    median = float(np.median(values)) if values else None
    dry_median = float(np.median(dry_percentiles)) if dry_percentiles else None
    hits = sum(value <= 10 for value in values)
    groups = {}
    for objective in sorted({pair["objective"] for pair in observed}):
        group = [pair["pct"] for pair in observed if pair["objective"] == objective]
        hit = sum(value <= 10 for value in group)
        groups[objective] = {"median_pct": float(np.median(group)), "hit_at_10": hit / len(group),
                             "n": len(group), "binomial_p": _binomial_tail(hit, len(group))}
    clusters = sorted({pair["site"] for pair in observed})
    interval = None
    if clusters and bootstrap_runs > 0:
        rng = np.random.default_rng(seed)
        boot = []
        for _ in range(bootstrap_runs):
            sample = rng.choice(clusters, size=len(clusters), replace=True)
            boot.append(float(np.median([pair["pct"] for site in sample for pair in observed if pair["site"] == site])))
        interval = np.percentile(boot, [2.5, 97.5]).tolist()
    synthetic = results.get("synthetic", False) or candidates.get("synthetic", False)
    status = "inconclusive"
    if len(values) >= 8 and median is not None and dry_median is not None and preregistration_commit and not synthetic:
        status = "confirmed" if median <= 20 and median < dry_median and median < 50 else "not_confirmed"
    notes = [f"{len(values)} evaluable source pairs; lexical ID tie breaking; controls excluded.",
             "v1 baseline unavailable: the archived model's <15-degree fraction is absent from v2 inputs."]
    if not secondary_runs:
        notes.append("Secondary target-independent analysis unavailable without original templates/targets.")
    else:
        notes.append("Secondary target-independent scores recomputed from needs_target=false attributes.")
    if synthetic:
        notes.append("Synthetic data: software verification only, not scientific validation.")
    if not preregistration_commit:
        notes.append("No preregistration commit supplied; no preregistered finding is claimed.")
    return {"practice_pairs": pairs,
            "baselines": [{"name": "aridity_only", "median_pct": dry_median},
                          {"name": "random", "median_pct": 50.0 if values else None},
                          {"name": "v1_similarity", "median_pct": None}],
            "experiment": {"id": "E3", "hypothesis": "Practice-site median rank <=20% and better than aridity/random",
                           "metric": "median_pct", "value": median, "status": status, "notes": " ".join(notes)},
            "secondary_pairs": secondary_pairs,
            "summary": {"median_pct": median, "hit_at_10": hits / len(values) if values else None,
                        "binomial_p": _binomial_tail(hits, len(values)) if values else None,
                        "cluster_bootstrap_95": interval, "groups": groups}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default="data/fixtures")
    parser.add_argument("--practice", default="data/curated/practice_sites.csv")
    parser.add_argument("--preregistration-commit", default="")
    parser.add_argument("--out")
    args = parser.parse_args()
    base = Path(args.data_dir)
    report = run(base / "results.json", base / "earth_candidates.json", args.practice,
                 preregistration_commit=args.preregistration_commit,
                 templates=json.loads((base / "mission_templates.json").read_text()),
                 targets=json.loads((base / "targets.json").read_text()),
                 sun=json.loads((base / "sun_windows.json").read_text()))
    text = json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if args.out:
        Path(args.out).write_text(text)
    else:
        print(text, end="")


if __name__ == "__main__":
    main()
