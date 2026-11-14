"""Validation: published analog sites vs. the Earth-wide population, with ablation and sensitivity.

python -m pipeline.discovery validate   # writes data/discovery/validation.json

Design (fixed before results were seen; nothing below is tuned to improve the metrics):

* Positives: benchmark sites with role "analog" whose literature names the target's body.
  Labels are imperfect: many analogs were chosen for geology training or logistics,
  not for terrain/illumination similarity to a specific target region.
* Background: the unbiased global-lattice population (near-equal-area land sample).
* Designated negative controls: four a-priori implausible windows (forest, farmland, delta).
  These are easy controls; AUC against them says little.
* Hard negative control (added 2026-11-14, thresholds fixed before it was first run):
  global-lattice windows that are mostly bare (WorldCover bare_frac >= 0.5) and arid
  (NASA POWER precip_annual_mm <= 250), latitude-matched to each positive (| |lat_neg| -
  |lat_pos| | <= 10 deg). AUC is averaged per positive over its own matched band, with a
  bootstrap 90 % interval (positives and band members resampled). It uses its own random
  stream, so every other number in this file is unchanged by its addition.
* Metrics: ROC AUC (positives vs. background) with a bootstrap 90 % interval; recall@k and
  precision@k against the chance rate; per-positive percentiles; AUC vs. designated controls.
* Ablation: AUC with each measured dimension's weight set to zero.
* Sensitivity: 200 Dirichlet weight perturbations (concentration 20) -> AUC spread and
  top-10 stability (Jaccard with the default ranking).
* Reproducibility: Spearman rank correlation of scores between two Monte Carlo seeds.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import cast

import numpy as np
from scipy.stats import spearmanr

from pipeline.discovery import OUT
from pipeline.discovery import rank as R
from pipeline.discovery.bundle import _dims_tuple, population_mask
from pipeline.discovery.fingerprint import earth_windows, load_targets, load_windows
from pipeline.discovery.similarity import EarthTable
from pipeline.discovery.sites import BENCHMARK, benchmark_window

BOOT = 1000
KS = (10, 25, 50, 100)
HARD_NEG = {"bare_frac_min": 0.5, "precip_annual_mm_max": 250.0, "abs_lat_window_deg": 10.0, "seed": [2026, 1]}


def auc(pos: np.ndarray, neg: np.ndarray) -> float:
    if not len(pos) or not len(neg):
        return float("nan")
    neg = np.sort(neg)
    lt = np.searchsorted(neg, pos, side="left")
    le = np.searchsorted(neg, pos, side="right")
    return float(np.mean((lt + 0.5 * (le - lt)) / len(neg)))


def bootstrap_auc(pos, neg, rng, n=BOOT):
    vals = [auc(rng.choice(pos, len(pos)), rng.choice(neg, len(neg))) for _ in range(n)]
    return [round(float(np.quantile(vals, q)), 4) for q in (0.05, 0.95)]


def evaluate(score: np.ndarray, pos_idx: list[int], pop: np.ndarray, neg_idx: list[int], rng) -> dict:
    bg = np.where(pop)[0]
    bg = np.setdiff1d(bg, pos_idx)
    pos_s, bg_s = score[pos_idx], score[bg]
    pool = np.concatenate([pos_s, bg_s])
    labels = np.r_[np.ones(len(pos_s)), np.zeros(len(bg_s))]
    order = np.argsort(-pool, kind="stable")
    out = {"n_positive": len(pos_idx), "n_background": int(len(bg)),
           "auc": round(auc(pos_s, bg_s), 4), "auc_90ci": bootstrap_auc(pos_s, bg_s, rng) if len(pos_s) > 1 else None,
           "auc_vs_designated_controls": round(auc(pos_s, score[neg_idx]), 4) if neg_idx else None,
           "chance_precision": round(len(pos_s) / len(pool), 4)}
    for k in KS:
        hits = labels[order[:k]].sum()
        out[f"precision@{k}"] = round(float(hits / k), 4)
        out[f"recall@{k}"] = round(float(hits / max(1, len(pos_s))), 4)
    return out


def hard_negative_bands(E, pos_idx: list[int], pop: np.ndarray) -> tuple[np.ndarray, list[np.ndarray]]:
    """Bare, arid population windows; one latitude-matched band per positive (indices into E)."""
    bare = np.array([np.nan if w.f("bare_frac") is None else w.f("bare_frac") for w in E], float)
    prec = np.array([np.nan if w.f("precip_annual_mm") is None else w.f("precip_annual_mm") for w in E], float)
    alat = np.abs(np.array([w.lat for w in E], float))
    with np.errstate(invalid="ignore"):
        pool = pop & (bare >= HARD_NEG["bare_frac_min"]) & (prec <= HARD_NEG["precip_annual_mm_max"])
    pool[pos_idx] = False
    cand = np.where(pool)[0]
    bands = [cand[np.abs(alat[cand] - alat[i]) <= HARD_NEG["abs_lat_window_deg"]] for i in pos_idx]
    return cand, bands


def matched_auc(score: np.ndarray, pos_idx: list[int], bands: list[np.ndarray]) -> float:
    vals = [auc(score[[i]], score[b]) for i, b in zip(pos_idx, bands) if len(b)]
    return float(np.mean(vals)) if vals else float("nan")


def evaluate_hard_negative(score: np.ndarray, E, pos_idx: list[int], pop: np.ndarray, rng) -> dict:
    cand, bands = hard_negative_bands(E, pos_idx, pop)
    usable = [k for k, b in enumerate(bands) if len(b)]
    out = {"definition": (f"population windows with bare_frac >= {HARD_NEG['bare_frac_min']} and precip_annual_mm <= "
                          f"{HARD_NEG['precip_annual_mm_max']:.0f}, |latitude| within +-{HARD_NEG['abs_lat_window_deg']:.0f} deg "
                          "of each positive; AUC averaged per positive over its own band"),
           "n_hard_negative": int(len(cand)), "n_per_positive": [int(len(b)) for b in bands],
           "n_positive_matched": len(usable), "auc": None, "auc_90ci": None}
    if not usable:
        return out
    out["auc"] = round(matched_auc(score, pos_idx, bands), 4)
    if len(usable) > 1:
        vals = []
        for _ in range(BOOT):
            ks = rng.choice(usable, len(usable))
            vals.append(np.mean([auc(score[[pos_idx[k]]], score[rng.choice(bands[k], len(bands[k]))]) for k in ks]))
        out["auc_90ci"] = [round(float(np.quantile(vals, q)), 4) for q in (0.05, 0.95)]
    return out


def run_validation(draws: int = 64, write: bool = True) -> str:
    rng = np.random.default_rng(2026)
    rng_hard = np.random.default_rng(HARD_NEG["seed"])  # separate stream: existing metrics stay identical
    windows = load_windows()
    targets = load_targets(windows)
    E = earth_windows(windows)
    table = EarthTable(E)
    pop, pop_note = population_mask(E)
    idx = {w.id: i for i, w in enumerate(E)}
    neg_idx = [idx[benchmark_window(b)] for b in BENCHMARK if b.role == "negative_control" and benchmark_window(b) in idx]
    default = R.PROFILES["general"]["weights"]
    results = []
    for t in targets:
        positives = [b for b in BENCHMARK if b.role == "analog" and t.body in b.bodies and benchmark_window(b) in idx]
        pos_idx = [idx[benchmark_window(b)] for b in positives]
        res = R.score_target(table, t, pop, draws, 2026)
        dims = _dims_tuple(res)
        base = R.aggregate(dims, default)["score"]
        entry = {"target": t.id, "body": t.body, "positives": [b.id for b in positives],
                 "metrics": evaluate(base, pos_idx, pop, neg_idx, rng)}
        entry["metrics"]["hard_negative"] = evaluate_hard_negative(base, E, pos_idx, pop, rng_hard)
        pct = R.population_percentile(base, pop)
        entry["per_positive"] = [{"site": b.id, "window": E[i].id, "aspects": list(b.aspects), "score": round(float(base[i]), 4),
                                  "percentile": round(float(pct[i]), 2)} for b, i in zip(positives, pos_idx)]
        terrain_pos = [i for b, i in zip(positives, pos_idx) if "terrain" in b.aspects]
        if len(terrain_pos) >= 2:
            entry["terrain_claimed_subset"] = evaluate(base, terrain_pos, pop, neg_idx, rng)
        ablation = {}
        for d in R.ASSESSED:
            if res[d].status[0] == 3 or not np.any(res[d].status == 0):
                continue
            w = {**default, d: 0.0}
            ablation[d] = round(auc(R.aggregate(dims, w)["score"][pos_idx],
                                    R.aggregate(dims, w)["score"][np.setdiff1d(np.where(pop)[0], pos_idx)]), 4)
        entry["ablation_auc_without"] = ablation
        keys = [d for d in default if default[d] > 0]
        top_default = set(np.argsort(-base)[:10])
        aucs, jac = [], []
        for _ in range(200):
            v = rng.dirichlet(np.array([default[k] for k in keys]) * 20) * sum(default[k] for k in keys)
            s = R.aggregate(dims, dict(zip(keys, v)))["score"]
            aucs.append(auc(s[pos_idx], s[np.setdiff1d(np.where(pop)[0], pos_idx)]))
            top = set(np.argsort(-s)[:10])
            jac.append(len(top & top_default) / len(top | top_default))
        entry["sensitivity"] = {"auc_p05_p50_p95": [round(float(np.nanquantile(aucs, q)), 4) for q in (0.05, 0.5, 0.95)],
                                "top10_jaccard_p05_p50_p95": [round(float(np.quantile(jac, q)), 4) for q in (0.05, 0.5, 0.95)]}
        alt = R.aggregate(_dims_tuple(R.score_target(table, t, pop, draws, 7)), default)["score"]
        rho = cast(float, spearmanr(base, alt)[0])
        entry["reproducibility"] = {"spearman_seed_2026_vs_7": round(float(rho), 5),
                                    "top10_identical": bool(set(np.argsort(-base)[:10]) == set(np.argsort(-alt)[:10]))}
        results.append(entry)
    summary = {
        "schema": "egiz.discovery_validation", "population": pop_note, "draws": draws,
        "design": __doc__, "targets": results,
        "caveats": [
            "Positive labels come from where analog campaigns were run, which reflects logistics, geology training and "
            "history as much as similarity to a specific target region. Low AUC is therefore not proof of a wrong model, "
            "and high AUC is not proof of a right one.",
            "n_positive is 5 (Moon) or 10 (Mars); confidence intervals are wide. No weights or tolerances were tuned on "
            "these results.",
            "Lunar positives are mostly low-latitude Apollo-era geology training sites, while the lunar targets are "
            "south-polar; the illumination dimension deliberately favours high-latitude Earth windows.",
            "AUC against the designated controls (forest, farmland, delta) is an easy test. The hard negative control "
            "(bare, arid, latitude-matched windows) is the more informative comparison.",
            "recall@50 and precision@50 are low or zero for most targets: known analog sites rarely appear in the Earth-wide "
            "top 50, so a high AUC means 'ranked above typical land', not 'found the known analogs first'.",
        ],
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    if write:
        (OUT / "validation.json").write_text(json.dumps(summary, indent=1, allow_nan=False) + "\n", encoding="utf-8")
    return json.dumps([{"target": r["target"], "auc": r["metrics"]["auc"], "ci": r["metrics"]["auc_90ci"],
                        "vs_controls": r["metrics"]["auc_vs_designated_controls"],
                        "vs_hard": r["metrics"]["hard_negative"]["auc"], "vs_hard_ci": r["metrics"]["hard_negative"]["auc_90ci"],
                        "recall@50": r["metrics"]["recall@50"], "rho": r["reproducibility"]["spearman_seed_2026_vs_7"]}
                       for r in results], indent=0)
