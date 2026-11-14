"""Ranking: aggregation with uncertainty, Earth-wide percentiles, rarity, novelty, diversity.

Aggregation (identical in web/src/discover/engine.ts; parity-tested):

  per dimension      mu_d = ln s50_d,  sd_d = (ln hi_d - ln lo_d) / (2 * 1.645)
  fidelity           exp( sum_A w_d mu_d / sum_A w_d )   over measured dimensions A
  90 % interval      exp( mu +- 1.645 * sqrt(sum_A w_d^2 sd_d^2) / sum_A w_d )   (independence assumed)
  coverage           sum_A w_d / sum_{applicable} w_d     (not-assessed dimensions count as applicable)
  score              fidelity * coverage                  (default ranking; cannot reach 1 with gaps)
  bounded interval   [lo * coverage, hi * coverage + (1 - coverage)]  (unknown dimensions in [0, 1])

Evidence category
  strong          coverage >= 0.6 and interval width <= 0.35
  weak            otherwise, with coverage >= 0.5
  missing_driven  coverage < 0.5: apparent similarity rests on few measured dimensions
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from scipy.spatial import cKDTree

from pipeline.discovery import dimensions as D
from pipeline.discovery.fingerprint import Target, Window
from pipeline.discovery.similarity import (
    EarthTable,
    Scoring,
    log_moments,
    score_dimension,
    summarise,
)

Z90 = 1.6448536269514722
STATUS = ("measured", "missing", "not_assessed", "not_applicable")
ASSESSED = ("terrain_fine", "terrain_roughness", "terrain_regional", "surface_exposure", "geology", "aridity",
            "thermal", "illumination")

PROFILES = {
    "general": {"label": "General analog fidelity", "weights": {d.id: d.weight for d in D.DIMENSIONS}},
    "rover_mobility": {"label": "Rover mobility and route testing", "weights": {
        "terrain_fine": 3, "terrain_roughness": 2, "terrain_regional": 1.5, "surface_exposure": 1, "geology": 0.5,
        "aridity": 0.5, "thermal": 0.5, "illumination": 0.5, "mineralogy": 0.25, "aeolian_dust": 0.5,
        "ice_permafrost": 0.25, "subsurface_voids": 0.25}},
    "eva_geology": {"label": "EVA field geology and sampling", "weights": {
        "terrain_fine": 1, "terrain_roughness": 1, "terrain_regional": 0.5, "surface_exposure": 2, "geology": 3,
        "aridity": 1, "thermal": 0.5, "illumination": 0.5, "mineralogy": 2, "aeolian_dust": 0.5,
        "ice_permafrost": 0.5, "subsurface_voids": 0.5}},
    "power_illumination": {"label": "Solar power and low-Sun operations", "weights": {
        "terrain_fine": 1, "terrain_roughness": 0.5, "terrain_regional": 2, "surface_exposure": 0.5, "geology": 0.25,
        "aridity": 0.5, "thermal": 1, "illumination": 3, "mineralogy": 0.1, "aeolian_dust": 1,
        "ice_permafrost": 0.25, "subsurface_voids": 0.1}},
    "astrobiology": {"label": "Astrobiology and habitability research", "weights": {
        "terrain_fine": 0.5, "terrain_roughness": 0.25, "terrain_regional": 0.25, "surface_exposure": 1,
        "geology": 2, "aridity": 3, "thermal": 1.5, "illumination": 0.25, "mineralogy": 3, "aeolian_dust": 0.5,
        "ice_permafrost": 2, "subsurface_voids": 1}},
}


@dataclass
class DimResult:
    s50: np.ndarray
    lo: np.ndarray
    hi: np.ndarray
    status: np.ndarray   # int codes into STATUS
    detail: dict


def dimension_status(dim: D.Dimension, body: str) -> str:
    if body in dim.bodies_not_applicable:
        return "not_applicable"
    return "not_assessed" if dim.status_default == "not_assessed" else "measured"


def score_target(table: EarthTable, target: Target, population: np.ndarray, draws: int = 64,
                 seed: int = 2026) -> dict[str, DimResult]:
    W = len(table)
    s = Scoring(table, target, draws, seed)
    out = {}
    for dim in D.DIMENSIONS:
        st = dimension_status(dim, target.body)
        if st != "measured":
            code = STATUS.index(st)
            out[dim.id] = DimResult(np.full(W, np.nan), np.full(W, np.nan), np.full(W, np.nan),
                                    np.full(W, code, np.int8), {})
            continue
        sims, avail, detail = score_dimension(dim.id, s, population)
        s50, lo, hi = summarise(sims)
        status = np.where(avail, 0, 1).astype(np.int8)
        out[dim.id] = DimResult(np.where(avail, s50, np.nan), np.where(avail, lo, np.nan), np.where(avail, hi, np.nan),
                                status, detail)
    return out


def aggregate(dims: dict[str, tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]],
              weights: dict[str, float]) -> dict[str, np.ndarray]:
    """dims: id -> (s50, lo, hi, status codes). Pure function mirrored in TypeScript."""
    any_arr = next(iter(dims.values()))[0]
    W = len(any_arr)
    num = np.zeros(W)
    den = np.zeros(W)
    var = np.zeros(W)
    applicable = np.zeros(W)
    for d, (s50, lo, hi, status) in dims.items():
        w = float(weights.get(d, 0.0))
        if w <= 0:
            continue
        applicable += np.where(status != 3, w, 0.0)
        m = status == 0
        mu, sd = log_moments(np.nan_to_num(s50, nan=1.0), np.nan_to_num(lo, nan=1.0), np.nan_to_num(hi, nan=1.0))
        num += np.where(m, w * mu, 0.0)
        den += np.where(m, w, 0.0)
        var += np.where(m, (w * sd) ** 2, 0.0)
    safe = np.where(den > 0, den, 1.0)
    mu = num / safe
    sd = np.sqrt(var) / safe
    fid = np.where(den > 0, np.exp(mu), np.nan)
    lo = np.where(den > 0, np.exp(mu - Z90 * sd), np.nan)
    hi = np.where(den > 0, np.minimum(1.0, np.exp(mu + Z90 * sd)), np.nan)
    cov = np.where(applicable > 0, den / np.where(applicable > 0, applicable, 1.0), 0.0)
    score = np.nan_to_num(fid * cov)
    width = hi - lo
    category = np.where(cov < 0.5, "missing_driven", np.where((cov >= 0.6) & (width <= 0.35), "strong", "weak"))
    return {"fidelity": fid, "lo": lo, "hi": hi, "coverage": cov, "score": score,
            "bounded_lo": np.nan_to_num(lo * cov), "bounded_hi": np.nan_to_num(hi * cov + (1 - cov), nan=1.0),
            "category": category}


def population_percentile(values: np.ndarray, population: np.ndarray) -> np.ndarray:
    """Share (0-100) of the population windows whose value is <= each value (NaN stays NaN)."""
    ref = np.sort(values[population & np.isfinite(values)])
    if not len(ref):
        return np.full(len(values), np.nan)
    pct = np.searchsorted(ref, values, side="right") / len(ref) * 100
    return np.where(np.isfinite(values), pct, np.nan)


# ----------------------------------------------------------------------------- rarity

TERRAIN_FEATURES = [("slope_f100_p50_deg", "lin"), ("slope_f100_p90_deg", "lin"), ("slope_f400_p50_deg", "lin"),
                    ("slope_r_p50_deg", "lin"), ("relief_m", "log"), ("tri_f100_m", "log"),
                    ("curv_lap_f100_std_per_m", "log")]
ENV_FEATURES = [("bare_frac", "lin"), ("tree_frac", "lin"), ("snow_frac", "lin"), ("precip_annual_mm", "log1p"),
                ("t2m_mean_annual_c", "lin"), ("t2m_seasonal_range_c", "lin")]


def standardised(table: EarthTable, features, population: np.ndarray) -> np.ndarray:
    cols = []
    for name, tr in features:
        v = table.col(name)
        v = np.log(np.clip(v, 1e-6, None)) if tr == "log" else np.log1p(np.clip(v, 0, None)) if tr == "log1p" else v
        ref = v[population & np.isfinite(v)]
        med = np.median(ref) if len(ref) else 0.0
        mad = 1.4826 * np.median(np.abs(ref - med)) if len(ref) else 1.0
        cols.append((v - med) / (mad if mad > 1e-9 else (np.std(ref) or 1.0)))
    return np.stack(cols, axis=1)


def rarity(table: EarthTable, population: np.ndarray, features, k: int = 10) -> tuple[np.ndarray, np.ndarray]:
    """Mean distance to the k nearest population windows and its population percentile (100 = rarest)."""
    z = standardised(table, features, population)
    ok = np.all(np.isfinite(z), axis=1)
    ref = ok & population
    dist = np.full(len(table), np.nan)
    if ref.sum() > k + 1:
        tree = cKDTree(z[ref])
        d, _ = tree.query(z[ok], k=k + 1)
        own = population[ok]  # population members find themselves at distance 0: drop that neighbour
        dist[ok] = np.where(own, d[:, 1:].mean(axis=1), d[:, :k].mean(axis=1))
    return dist, population_percentile(dist, ref)


# ----------------------------------------------------------------------------- novelty

def haversine_km(lon1, lat1, lon2, lat2):
    lon1, lat1, lon2, lat2 = map(np.radians, (lon1, lat1, lon2, lat2))
    h = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371.0088 * np.arcsin(np.sqrt(np.clip(h, 0, 1)))


def novelty(windows: list[Window], established: list[tuple[str, float, float]]) -> tuple[np.ndarray, list, list]:
    """Distance to the nearest established analog site and a class label (never added to fidelity)."""
    lon = np.array([w.lon for w in windows])
    lat = np.array([w.lat for w in windows])
    if not established:
        return np.full(len(windows), np.nan), ["unknown"] * len(windows), [None] * len(windows)
    d = haversine_km(lon[:, None], lat[:, None], np.array([e[1] for e in established])[None, :],
                     np.array([e[2] for e in established])[None, :])
    i = d.argmin(axis=1)
    km = d[np.arange(len(windows)), i]
    label = ["established" if x < 30 else "near_established" if x < 200 else "unexplored" for x in km]
    return km, label, [established[j][0] for j in i]


# ----------------------------------------------------------------------------- diversity

def diversify(order: np.ndarray, score: np.ndarray, lon: np.ndarray, lat: np.ndarray, z: np.ndarray,
              k: int = 25, min_km: float = 150.0, lam: float = 0.3, pool: int = 400) -> list[int]:
    """Maximal-marginal-relevance shortlist with a hard geographic exclusion radius.

    value(c) = score(c) - lam * max_s feature_similarity(c, s), feature_similarity = exp(-|z_c - z_s|^2 / (2 k_z)).
    """
    cand = [int(i) for i in order[:pool] if score[i] > 0]
    chosen: list[int] = []
    zf = np.nan_to_num(z)
    kz = max(1, z.shape[1])
    while cand and len(chosen) < k:
        best, best_v = None, -math.inf
        for c in cand:
            if chosen:
                if haversine_km(lon[c], lat[c], lon[chosen], lat[chosen]).min() < min_km:
                    continue
                sim = np.exp(-((zf[chosen] - zf[c]) ** 2).sum(axis=1) / (2 * kz)).max()
            else:
                sim = 0.0
            v = score[c] - lam * sim
            if v > best_v:
                best, best_v = c, v
        if best is None:
            break
        chosen.append(best)
        cand.remove(best)
    return chosen
