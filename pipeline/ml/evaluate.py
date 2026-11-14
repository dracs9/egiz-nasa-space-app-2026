"""Stage 2 evaluation on the pre-registered reference set (docs/ML_PREREGISTRATION.md).

Implements experiment E3 of docs/science/VALIDATION_PROTOCOL.md for the ML
layer: each reference AOI is scored for its objective and placed among the
eligible Earth candidates; ``pct`` is its rank percentile. The analysis refuses
to run on real data unless ``FREEZE.json`` records SHA-256 values equal to the
current reference files and pre-registration, so no reference rank can be seen
before the freeze.

Definitions fixed in the pre-registration:

- pct = 100 * (n_better + 0.5 * n_tied) / n_eligible_pool. A reference AOI
  whose F is null (constraint or missingness) gets pct = 100 and is flagged.
- Pool AOIs whose centre lies within ``OVERLAP_KM`` of the reference centre are
  removed for that pair (their 22 km windows overlap the reference window).
- hit@10% means pct <= 10; hit@K means n_better < K.

Written with AI assistance (Claude Code); human review pending.
"""

from __future__ import annotations

import csv
import hashlib
import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from pipeline.engine.fidelity import objective_fidelity

from .baseline import DEFAULT_CONFIG, _extra, _perturbed
from .loader import Snapshot

OVERLAP_KM = 31.2  # half-diagonal sum of two 22 km windows: 22 * sqrt(2)
SEED = 2026
BOOTSTRAP = 10_000
PCT_SUCCESS = 20.0
MIN_PAIRS = 8
K_VALUES = (10, 30)
FROZEN_FILES = ("data/ml/reference/reference_sites-0.1.0.csv", "data/ml/reference/sources-0.1.0.csv",
                "docs/ML_PREREGISTRATION.md")
DRYNESS = [  # E3 baseline 1, parameters as in objective O5 of mission_templates
    {"attr": "precip_mm", "fn": "at_most", "params": {"a": 50.0, "tau": 100.0}, "weight": 1.0, "needs_target": False},
    {"attr": "bare_frac", "fn": "at_least", "params": {"a": 0.8, "tau": 0.2}, "weight": 1.0, "needs_target": False},
]


class NotFrozen(RuntimeError):
    """Raised when the evaluation is attempted before a valid freeze record exists."""


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check_freeze(root: Path, freeze_path: Path) -> dict:
    """Return the freeze record if every frozen file still has its recorded SHA-256."""
    if not freeze_path.exists():
        raise NotFrozen(f"{freeze_path} does not exist: the pre-registration is not frozen")
    record = json.loads(freeze_path.read_text(encoding="utf-8"))
    for name in FROZEN_FILES:
        expected = record.get("sha256", {}).get(name)
        if not expected:
            raise NotFrozen(f"freeze record has no SHA-256 for {name}")
        actual = sha256_file(root / name)
        if actual != expected:
            raise NotFrozen(f"{name} changed after the freeze ({actual[:12]} != {expected[:12]})")
    if not record.get("reviewed_by"):
        raise NotFrozen("freeze record has no reviewer")
    return record


# ----------------------------------------------------------------------------- pairs

@dataclass(frozen=True)
class Pair:
    site_id: str
    objective_id: str
    target_context: str
    grade: str
    precision: str
    apollo: bool

    @property
    def aoi_id(self) -> str:
        return f"RF_{self.site_id}"


def load_pairs(sites_csv: Path) -> list[Pair]:
    pairs = []
    for row in csv.DictReader(sites_csv.open(encoding="utf-8")):
        if row["testable"] != "true" or not row["lat"]:
            continue
        pairs.append(Pair(row["site_id"], row["objective_id"], row["target_context"], row["evidence_grade"],
                          row.get("coord_precision", ""), row["source_key"] == "PHINNEY2015"))
    return pairs


def analysis_members(pairs: list[Pair]) -> dict[str, list[Pair]]:
    """Pair sets for P1 and S1/S2/S4 exactly as defined in the pre-registration."""
    p1 = [p for p in pairs if p.grade in ("A", "B") and p.precision in ("feature", "point")]
    return {"P1": p1, "S1": list(pairs), "S2": p1, "S4": [p for p in p1 if not p.apollo]}


# ----------------------------------------------------------------------------- scoring

def haversine_km(lon1, lat1, lon2, lat2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * 6371.0088 * math.asin(math.sqrt(h))


def objective_variant(objective: dict, mode: str) -> dict:
    """``full`` (P1), ``target_free`` (S2: attributes without a target) or ``dryness`` (baseline 1)."""
    if mode == "full":
        return objective
    out = {**objective}
    if mode == "target_free":
        out["attributes"] = [a for a in objective["attributes"] if not a.get("needs_target")]
    elif mode == "dryness":
        out["attributes"] = [dict(a) for a in DRYNESS]
    else:
        raise ValueError(mode)
    return out


def percentile_rank(ref_score: float | None, pool_scores: list[float | None]) -> dict:
    eligible = [s for s in pool_scores if s is not None]
    n = len(eligible)
    if n == 0:
        return {"pct": None, "n_eligible": 0, "n_better": None, "ref_eligible": ref_score is not None}
    if ref_score is None:
        return {"pct": 100.0, "n_eligible": n, "n_better": n, "ref_eligible": False}
    better = sum(1 for s in eligible if s > ref_score)
    tied = sum(1 for s in eligible if s == ref_score)
    return {"pct": 100.0 * (better + 0.5 * tied) / n, "n_eligible": n, "n_better": better, "ref_eligible": True}


def score_pair(pool: Snapshot, ref_tile: dict, target: dict, objective: dict, mode: str) -> dict:
    obj = objective_variant(objective, mode)
    if not obj["attributes"]:
        return {"pct": None, "n_eligible": 0, "n_better": None, "ref_eligible": None, "note": "no attributes"}
    lon, lat = ref_tile["lon"], ref_tile["lat"]
    kept = [t for t in pool.candidates if haversine_km(lon, lat, t["lon"], t["lat"]) >= OVERLAP_KM]
    scores = [objective_fidelity(obj, t["attrs"], target["attrs"], _extra(pool, target, t)).get("F") for t in kept]
    ref = objective_fidelity(obj, ref_tile["attrs"], target["attrs"], _extra(pool, target, ref_tile)).get("F")
    out = percentile_rank(ref, scores)
    out.update({"F_ref": ref, "pool_removed_overlap": len(pool.candidates) - len(kept)})
    return out


def stability_top10(pool: Snapshot, ref_tile: dict, target: dict, objective: dict, draws: int, seed: int) -> float | None:
    """S3: share of perturbation draws (baseline config) in which the reference is in the top 10 %."""
    config = {**DEFAULT_CONFIG, "stability_seed": seed}
    rng = np.random.default_rng(seed)
    lon, lat = ref_tile["lon"], ref_tile["lat"]
    kept = [t for t in pool.candidates if haversine_km(lon, lat, t["lon"], t["lat"]) >= OVERLAP_KM]
    hits = 0
    for _ in range(draws):
        obj = _perturbed(objective, rng, config)
        scores = [objective_fidelity(obj, t["attrs"], target["attrs"], _extra(pool, target, t)).get("F") for t in kept]
        ref = objective_fidelity(obj, ref_tile["attrs"], target["attrs"], _extra(pool, target, ref_tile)).get("F")
        pct = percentile_rank(ref, scores)["pct"]
        hits += pct is not None and pct <= 10
    return hits / draws if draws else None


# ----------------------------------------------------------------------------- statistics

def binomial_tail(k: int, n: int, p0: float) -> float:
    """P(X >= k) for X ~ Binomial(n, p0)."""
    return float(sum(math.comb(n, i) * p0 ** i * (1 - p0) ** (n - i) for i in range(k, n + 1)))


def clustered_bootstrap_median(pcts: list[float], sites: list[str], n_boot: int = BOOTSTRAP, seed: int = SEED):
    """95 % interval of the median pct, resampling sites (all pairs of a site together)."""
    by_site: dict[str, list[float]] = {}
    for pct, site in zip(pcts, sites):
        by_site.setdefault(site, []).append(pct)
    keys = sorted(by_site)
    rng = np.random.default_rng(seed)
    medians = []
    for _ in range(n_boot):
        chosen = rng.integers(0, len(keys), len(keys))
        sample = [v for i in chosen for v in by_site[keys[i]]]
        medians.append(float(np.median(sample)))
    return float(np.percentile(medians, 2.5)), float(np.percentile(medians, 97.5))


def random_baseline_p(observed_median: float, n: int, n_sim: int = BOOTSTRAP, seed: int = SEED) -> float:
    """P(median of n uniform pct <= observed) under a random ordering."""
    rng = np.random.default_rng(seed)
    sims = np.median(rng.uniform(0, 100, size=(n_sim, n)), axis=1)
    return float(np.mean(sims <= observed_median))


def summarise(rows: list[dict], key: str = "pct") -> dict:
    valid = [r for r in rows if r.get(key) is not None]
    n = len(valid)
    if n == 0:
        return {"n_pairs": 0}
    pcts = [r[key] for r in valid]
    median = float(np.median(pcts))
    hits = sum(1 for v in pcts if v <= 10)
    lo, hi = clustered_bootstrap_median(pcts, [r["site_id"] for r in valid])
    return {"n_pairs": n, "n_sites": len({r["site_id"] for r in valid}), "median_pct": round(median, 2),
            "ci95_median_pct": [round(lo, 2), round(hi, 2)], "hit10pct": hits,
            "hit10pct_binomial_p": round(binomial_tail(hits, n, 0.10), 4),
            "random_baseline_p": round(random_baseline_p(median, n), 4)}


def verdict(primary: dict, dryness: dict) -> str:
    """Decision rule of pre-registration section 5 (E3)."""
    n = primary.get("n_pairs", 0)
    if n < MIN_PAIRS:
        return "inconclusive"
    lo, hi = primary["ci95_median_pct"]
    if lo <= PCT_SUCCESS < hi:
        return "inconclusive"
    better_than_dryness = dryness.get("median_pct") is not None and primary["median_pct"] < dryness["median_pct"]
    better_than_random = primary["median_pct"] < 50.0
    if primary["median_pct"] <= PCT_SUCCESS and better_than_dryness and better_than_random:
        return "confirmed"
    return "not_confirmed"


# ----------------------------------------------------------------------------- run

def run_evaluation(pool: Snapshot, refs: Snapshot, pairs: list[Pair], *, stability_draws: int = 200,
                   seed: int = SEED) -> dict:
    ref_tiles = {t["id"]: t for t in refs.candidates}
    objectives = {}
    for template in pool.templates.values():
        for objective in template["objectives"]:
            objectives[objective["id"]] = (template, objective)
    targets = {t["body"]: t for t in pool.targets.values()}
    rows = []
    for pair in pairs:
        row = {"site_id": pair.site_id, "objective_id": pair.objective_id, "grade": pair.grade,
               "precision": pair.precision, "apollo": pair.apollo}
        tile = ref_tiles.get(pair.aoi_id)
        target = targets.get(pair.target_context)
        if tile is None or pair.objective_id not in objectives or target is None:
            row["status"] = "not_scored: " + ("reference AOI missing or skipped" if tile is None else "objective/target")
            rows.append(row)
            continue
        _, objective = objectives[pair.objective_id]
        full = score_pair(pool, tile, target, objective, "full")
        row.update({"status": "scored", "pct": full["pct"], "F_ref": full["F_ref"], "n_eligible": full["n_eligible"],
                    "n_better": full["n_better"], "ref_eligible": full["ref_eligible"],
                    "pool_removed_overlap": full["pool_removed_overlap"],
                    "pct_target_free": score_pair(pool, tile, target, objective, "target_free")["pct"],
                    "pct_dryness": score_pair(pool, tile, target, objective, "dryness")["pct"],
                    "stability_top10_share": stability_top10(pool, tile, target, objective, stability_draws, seed)})
        for k in K_VALUES:
            row[f"hit_at_{k}"] = full["n_better"] is not None and full["n_better"] < k
        rows.append(row)
    members = analysis_members(pairs)
    keyed = {(r["site_id"], r["objective_id"]): r for r in rows}
    analyses = {}
    for name, subset in members.items():
        subset_rows = [keyed[(p.site_id, p.objective_id)] for p in subset]
        metric = "pct_target_free" if name == "S2" else "pct"
        analyses[name] = summarise(subset_rows, metric)
        analyses[name]["dryness_baseline"] = summarise(subset_rows, "pct_dryness")
    analyses["P1"]["verdict"] = verdict(analyses["P1"], analyses["P1"]["dryness_baseline"])
    for name in ("S1", "S2", "S4"):
        analyses[name]["verdict"] = verdict(analyses[name], analyses[name]["dryness_baseline"])
    return {"pairs": rows, "analyses": analyses,
            "definitions": {"overlap_km": OVERLAP_KM, "pct_success": PCT_SUCCESS, "min_pairs": MIN_PAIRS,
                            "bootstrap": BOOTSTRAP, "seed": seed, "k_values": list(K_VALUES),
                            "stability_draws": stability_draws}}
