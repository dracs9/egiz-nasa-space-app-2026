"""Dimension-specific similarity with Monte Carlo uncertainty propagation (vectorised).

Every scorer returns, for all Earth windows at once, an array of shape (W, N) with
N Monte Carlo draws of the dimension similarity in [0, 1], plus a (W,) availability
mask. Draws perturb both the Earth features and the target features with their
documented 1-sigma error models (dimensions.py). Seeds are fixed: results are
bit-reproducible.

Methods
  terrain_fine       1-Wasserstein distance between piecewise-linear slope CDFs
  terrain_roughness  log-ratio distance, Mahalanobis with shrunk correlation / effective dimension
  terrain_regional   standardised differences, same decorrelation
  surface_exposure   exposed fraction (target = fully exposed)
  aridity            exp(-P / tau) x (1 - open water)
  thermal            interval distance and overlap of air-temperature ranges (Mars only)
  illumination       fraction of target noon-elevation range reproduced on Earth
  geology            partial-credit class matching
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from numpy.typing import ArrayLike

from pipeline.discovery import dimensions as D
from pipeline.discovery.fingerprint import Target, Window, dem_source, slope_sigma_deg

GRID = np.arange(0.0, 60.0 + 1e-9, 1.0)   # slope grid for CDF integration (deg)
EPS = 1e-3


@dataclass
class EarthTable:
    windows: list[Window]

    def __post_init__(self):
        self._cache: dict[str, np.ndarray] = {}

    def col(self, name: str) -> np.ndarray:
        if name not in self._cache:
            self._cache[name] = np.array([w.f(name) if w.f(name) is not None else np.nan for w in self.windows], float)
        return self._cache[name]

    def ctx(self, name: str) -> np.ndarray:
        return np.array([w.context.get(name) if isinstance(w.context.get(name), float) else np.nan
                         for w in self.windows], float)

    def text(self, name: str) -> list[str | None]:
        return [v if isinstance(v := w.features.get(name), str) else None for w in self.windows]

    @property
    def lat(self) -> np.ndarray:
        return np.array([w.lat for w in self.windows], float)

    def __len__(self):
        return len(self.windows)


# ----------------------------------------------------------------------------- slope CDF

def cdf_points(get, b: int) -> tuple[np.ndarray, np.ndarray]:
    """(x, y) CDF knots from slope statistics at baseline ``b``; ``get(name)`` returns (W,) arrays."""
    n = len(get(f"slope_f{b}_p50_deg"))
    b0, b1, b2 = (get(f"slope_f{b}_bin_{k}_frac") for k in ("0_5", "5_15", "15_30"))
    knots = [
        (get(f"slope_f{b}_p50_deg"), np.full(n, 0.5)),
        (get(f"slope_f{b}_p90_deg"), np.full(n, 0.9)),
        (np.full(n, 10.0), get(f"frac_lt10_f{b}")),
        (np.full(n, 20.0), get(f"frac_lt20_f{b}")),
        (np.full(n, 5.0), b0),
        (np.full(n, 15.0), b0 + b1),
        (np.full(n, 30.0), b0 + b1 + b2),
    ]
    x = np.stack([k[0] for k in knots], axis=1)
    y = np.stack([k[1] for k in knots], axis=1)
    bad = ~(np.isfinite(x) & np.isfinite(y))
    x = np.where(bad, 60.0, x)   # unknown knots collapse onto the upper anchor
    y = np.where(bad, 1.0, y)
    x = np.concatenate([np.zeros((n, 1)), x, np.full((n, 1), 60.0)], axis=1)
    y = np.concatenate([np.zeros((n, 1)), y, np.ones((n, 1))], axis=1)
    order = np.argsort(x, axis=1, kind="stable")
    x = np.take_along_axis(x, order, 1)
    y = np.maximum.accumulate(np.clip(np.take_along_axis(y, order, 1), 0, 1), axis=1)
    return x, y


def eval_cdf(x: np.ndarray, y: np.ndarray, shift: np.ndarray, scale: np.ndarray) -> np.ndarray:
    """CDF on GRID for knots (W,K) under per-draw shift/scale (W,N) -> (W,N,G).

    Interior knots move as x' = clip(x * scale + shift, 0, 60); anchors at 0 and 60 stay fixed.
    """
    W, K = x.shape
    xi = x[:, None, :] * scale[:, :, None] + shift[:, :, None]
    xi[:, :, 0], xi[:, :, -1] = 0.0, 60.0
    xi = np.clip(xi, 0.0, 60.0)
    xi = np.maximum.accumulate(xi, axis=2)
    yi = np.broadcast_to(y[:, None, :], xi.shape)
    g = GRID[None, None, :]
    out = np.zeros(xi.shape[:2] + (len(GRID),))
    for k in range(K - 1):
        x0, x1 = xi[:, :, k:k + 1], xi[:, :, k + 1:k + 2]
        y0, y1 = yi[:, :, k:k + 1], yi[:, :, k + 1:k + 2]
        span = np.where(x1 - x0 > 1e-9, x1 - x0, 1.0)
        inside = (g >= x0) & (g < x1)
        out = np.where(inside, y0 + (g - x0) * (y1 - y0) / span, out)
    out = np.where(g >= xi[:, :, -1:], 1.0, out)
    return out


def js_divergence(p: ArrayLike, q: ArrayLike) -> float:
    pa, qa = np.clip(np.asarray(p, float), 1e-12, None), np.clip(np.asarray(q, float), 1e-12, None)
    pa, qa = pa / pa.sum(), qa / qa.sum()
    m = (pa + qa) / 2
    return float(0.5 * np.sum(pa * np.log2(pa / m)) + 0.5 * np.sum(qa * np.log2(qa / m)))


# ----------------------------------------------------------------------------- decorrelation

def shrunk_correlation(z: np.ndarray, lam: float = D.CORRELATION_SHRINKAGE) -> np.ndarray:
    if z.shape[1] == 1:
        return np.eye(1)
    ok = np.all(np.isfinite(z), axis=1)
    r = np.corrcoef(z[ok].T) if ok.sum() > z.shape[1] + 2 else np.eye(z.shape[1])
    r = np.nan_to_num(r, nan=0.0)
    np.fill_diagonal(r, 1.0)
    return (1 - lam) * r + lam * np.eye(z.shape[1])


def effective_dimension(r: np.ndarray) -> float:
    ev = np.linalg.eigvalsh(r)
    return float(ev.sum() ** 2 / (ev ** 2).sum())


def decorrelated_d2(d: np.ndarray, r: np.ndarray) -> np.ndarray:
    """d: (W,N,k) standardised differences -> (W,N) = d^T R^-1 d / k_eff."""
    rinv = np.linalg.inv(r)
    return np.einsum("wnk,kl,wnl->wn", d, rinv, d) / effective_dimension(r)


# ----------------------------------------------------------------------------- scorer context

@dataclass
class Scoring:
    table: EarthTable
    target: Target
    draws: int
    seed: int

    def rng(self, salt: str) -> np.random.Generator:
        return np.random.default_rng([self.seed, sum(ord(c) * (i + 1) for i, c in enumerate(self.target.id + salt))])

    def tf(self, name: str) -> float | None:
        return self.target.window.f(name)


def score_terrain_fine(s: Scoring) -> tuple[np.ndarray, np.ndarray, dict]:
    b, T = s.target.baseline, s.table
    W, N = len(T), s.draws
    xe, ye = cdf_points(T.col, b)
    xt, yt = cdf_points(lambda n: np.array([s.tf(n) if s.tf(n) is not None else np.nan]), b)
    avail = np.isfinite(T.col(f"slope_f{b}_p50_deg")) & np.isfinite(T.col(f"slope_f{b}_p90_deg"))
    rng = s.rng("fine")
    se = slope_sigma_deg(b, "earth")
    st = slope_sigma_deg(b, s.target.body)
    pen = D.RESOLUTION_PENALTY[dem_source(s.target.body)]
    shift_e = rng.normal(0, se, (W, N))
    shift_t = rng.normal(0, st, (1, N))
    scale_t = 1 + rng.normal(0, pen, (1, N)) if pen else np.ones((1, N))
    ft = eval_cdf(xt, yt, shift_t, np.clip(scale_t, 0.3, 3))
    w1 = np.zeros((W, N))
    for i in range(0, W, 600):
        fe = eval_cdf(xe[i:i + 600], ye[i:i + 600], shift_e[i:i + 600], np.ones((min(600, W - i), N)))
        w1[i:i + 600] = np.abs(fe - ft).sum(axis=2) * (GRID[1] - GRID[0])
    nominal_e = eval_cdf(xe, ye, np.zeros((W, 1)), np.ones((W, 1)))[:, 0, :]
    nominal_t = eval_cdf(xt, yt, np.zeros((1, 1)), np.ones((1, 1)))[0, 0, :]
    w1_nom = np.abs(nominal_e - nominal_t).sum(axis=1)
    detail = {"w1_deg": w1_nom, "target_cdf": nominal_t}
    return np.exp(-w1 / D.TAU["slope_w1_deg"]), avail, detail


def _decorrelated(s: Scoring, specs: list[tuple[str, str, float, float, float]], salt: str, population: np.ndarray):
    """specs: (feature, transform 'log'|'lin', tau, earth_sigma_abs_or_rel, target_sigma) -> similarity draws."""
    T, W, N = s.table, len(s.table), s.draws
    rng = s.rng(salt)
    cols, tvals, d_list = [], [], []
    for name, transform, tau, se, st in specs:
        e = T.col(name)
        t = s.tf(name)
        t = np.nan if t is None else t
        if transform == "log":
            e_draw = np.log(np.clip(e[:, None] * (1 + rng.normal(0, se, (W, N))), 1e-9, None))
            t_draw = np.log(max(t, 1e-9) * np.clip(1 + rng.normal(0, st, (1, N)), 0.05, None)) if np.isfinite(t) else np.full((1, N), np.nan)
            cols.append(np.log(np.clip(e, 1e-9, None)))
        else:
            e_draw = e[:, None] + rng.normal(0, se, (W, N))
            t_draw = t + rng.normal(0, st, (1, N))
            cols.append(e)
        d_list.append((e_draw - t_draw) / tau)
        tvals.append(t)
    d = np.stack(d_list, axis=2)
    z = np.stack(cols, axis=1)
    r = shrunk_correlation(z[population])
    avail = np.all(np.isfinite(z), axis=1) & bool(np.all(np.isfinite(tvals)))
    d2 = decorrelated_d2(np.nan_to_num(d), r)
    nominal = np.stack([(cols[i] - (np.log(max(tvals[i], 1e-9)) if specs[i][1] == "log" else tvals[i])) / specs[i][2]
                        for i in range(len(specs))], axis=1)
    return np.exp(-d2 / 2), avail, {"k_eff": effective_dimension(r), "correlation": r, "nominal_std_diff": nominal,
                                    "features": [sp[0] for sp in specs]}


def score_terrain_roughness(s: Scoring, population: np.ndarray):
    b = s.target.baseline
    src = dem_source(s.target.body)
    pen = D.RESOLUTION_PENALTY[src]
    sz_e, sz_t = D.DEM_ERROR["COP_GLO30"]["sigma_z_m"], D.DEM_ERROR[src]["sigma_z_m"]
    tri_t = s.tf(f"tri_f{b}_m") or 1.0
    tri_e = np.nanmedian(s.table.col(f"tri_f{b}_m"))
    specs = [
        (f"tri_f{b}_m", "log", D.TAU["log_factor"], sz_e / 2 / max(tri_e, 0.5), sz_t / 2 / max(tri_t, 0.5) + pen),
        (f"slope_f{b}_std_deg", "log", D.TAU["log_factor"], 0.05, 0.05 + pen),
        (f"curv_lap_f{b}_std_per_m", "log", D.TAU["log_factor"], 0.10, 0.10 + pen),
    ]
    # Only features measured on both sides: geodata computes slope spread and curvature at the
    # 100 m baseline for Earth, so the Mars (400 m) comparison falls back to TRI alone.
    specs = [sp for sp in specs if s.tf(sp[0]) is not None and np.isfinite(s.table.col(sp[0])).mean() > 0.5]
    return _decorrelated(s, specs, "rough", population)


def score_terrain_regional(s: Scoring, population: np.ndarray):
    src = dem_source(s.target.body)
    sz_t = D.DEM_ERROR[src]["sigma_z_m"]
    pen = D.RESOLUTION_PENALTY[src]
    rel_t = s.tf("relief_m") or 100.0
    specs = [
        ("slope_r_p50_deg", "lin", D.TAU["slope_deg"], slope_sigma_deg(2000, "earth"),
         slope_sigma_deg(2000, s.target.body) + pen * (s.tf("slope_r_p50_deg") or 0)),
        ("slope_r_p90_deg", "lin", D.TAU["slope_p90_deg"], slope_sigma_deg(2000, "earth"),
         slope_sigma_deg(2000, s.target.body) + pen * (s.tf("slope_r_p90_deg") or 0)),
        ("frac_lt20_r", "lin", D.TAU["frac"], 0.01, 0.01 + pen * 0.1),
        ("relief_m", "log", D.TAU["log_factor"], 0.02, 2 * sz_t / max(rel_t, 1.0)),
        ("elev_std_m", "log", D.TAU["log_factor"], 0.02, 2 * sz_t / max(rel_t, 1.0)),
    ]
    return _decorrelated(s, specs, "regional", population)


def score_exposure(s: Scoring):
    T, W, N = s.table, len(s.table), s.draws
    bare, moss = T.col("bare_frac"), T.col("moss_lichen_frac")
    e = bare + 0.5 * np.nan_to_num(moss)
    rng = s.rng("exposure")
    draws = np.clip(e[:, None] + rng.normal(0, D.WORLDCOVER_SIGMA, (W, N)), 0, 1)
    return draws, np.isfinite(bare), {"exposed_frac": e}


def score_aridity(s: Scoring):
    T, W, N = s.table, len(s.table), s.draws
    p, water = T.col("precip_annual_mm"), T.col("water_frac")
    rng = s.rng("aridity")
    pd = np.clip(p[:, None] * (1 + rng.normal(0, D.POWER_P_REL_SIGMA, (W, N))), 0, None)
    wd = np.clip(np.nan_to_num(water)[:, None] + rng.normal(0, 0.02, (W, N)), 0, 1)
    return np.exp(-pd / D.TAU["precip_mm"]) * (1 - wd), np.isfinite(p), {"precip_mm": p, "water_frac": water}


def score_thermal(s: Scoring):
    T, W, N = s.table, len(s.table), s.draws
    ref = D.THERMAL_REFERENCE["mars"]
    lo_e = T.col("t2m_min_coldest_month_c") + 273.15
    hi_e = T.col("t2m_max_warmest_month_c") + 273.15
    rng = s.rng("thermal")
    lo = lo_e[:, None] + rng.normal(0, D.POWER_T_SIGMA_K, (W, N))
    hi = hi_e[:, None] + rng.normal(0, D.POWER_T_SIGMA_K, (W, N))
    overlap = np.clip(np.minimum(hi, ref["max_k"]) - np.maximum(lo, ref["min_k"]), 0, None)
    frac = overlap / (ref["max_k"] - ref["min_k"])
    gap = np.clip(np.maximum(lo, ref["min_k"]) - np.minimum(hi, ref["max_k"]), 0, None)
    sim = np.exp(-gap / D.TAU["thermal_gap_k"]) * (0.5 + 0.5 * frac)
    gap_nom = np.clip(np.maximum(lo_e, ref["min_k"]) - np.minimum(hi_e, ref["max_k"]), 0, None)
    return sim, np.isfinite(lo_e) & np.isfinite(hi_e), {"earth_range_k": (lo_e, hi_e), "gap_k": gap_nom}


def score_illumination(s: Scoring):
    T, W, N = s.table, len(s.table), s.draws
    tlo, thi = D.noon_elevation_range(s.target.window.lat, D.BODY[s.target.body]["obliquity_deg"])
    eps = D.BODY["earth"]["obliquity_deg"]
    lat = T.lat
    elo = 90 - (np.abs(lat) + eps)
    ehi = 90 - np.clip(np.abs(lat) - eps, 0, None)
    width = max(thi - tlo, 1e-6)
    cov = np.clip(np.minimum(ehi, thi) - np.maximum(elo, tlo), 0, None) / width
    return np.repeat(cov[:, None], N, axis=1), np.ones(W, bool), {"earth_range_deg": (elo, ehi),
                                                                   "target_range_deg": (tlo, thi)}


def earth_geology_classes(T: EarthTable) -> tuple[list[list[str]], list[str | None]]:
    lith, unit = T.text("geo_lith_label"), T.text("geo_unit_name_label")
    scale = T.text("geo_map_scale_label")
    vk, ik = T.ctx("volcano_km"), T.ctx("impact_km")
    classes = []
    for i in range(len(T)):
        c = D.lith_classes(lith[i]) or D.lith_classes(unit[i])
        if np.isfinite(vk[i]) and vk[i] <= D.CONTEXT_RADIUS_KM:
            c = c + ["volcanic_field"]
        if np.isfinite(ik[i]) and ik[i] <= D.CONTEXT_RADIUS_KM:
            c = c + ["impact_structure"]
        classes.append(sorted(set(c)))
    return classes, scale


def score_geology(s: Scoring):
    T, W, N = s.table, len(s.table), s.draws
    classes, scale = earth_geology_classes(T)
    target = list(s.target.spec.geology)
    if s.target.id in {"MARS_JEZERO", "MARS_GALE"}:
        target = target + ["impact_structure"]  # both sites lie inside impact craters
    nominal = np.full(W, np.nan)
    sigma = np.full(W, 0.25)
    for i, c in enumerate(classes):
        if not c:
            continue
        best = max(D.class_similarity(e, t) for e in c for t in target)
        cover = np.mean([max(D.class_similarity(e, t) for e in c) for t in target])
        nominal[i] = 0.5 * best + 0.5 * cover
        sigma[i] = D.MAP_SCALE_SIGMA.get(scale[i] or "", 0.25)
    rng = s.rng("geology")
    draws = np.clip(nominal[:, None] + rng.normal(0, 1, (W, N)) * sigma[:, None], 0, 1)
    return draws, np.isfinite(nominal), {"classes": classes, "target_classes": target}


def score_dimension(dim: str, s: Scoring, population: np.ndarray):
    if dim == "terrain_fine":
        return score_terrain_fine(s)
    if dim == "terrain_roughness":
        return score_terrain_roughness(s, population)
    if dim == "terrain_regional":
        return score_terrain_regional(s, population)
    if dim == "surface_exposure":
        return score_exposure(s)
    if dim == "aridity":
        return score_aridity(s)
    if dim == "thermal":
        return score_thermal(s)
    if dim == "illumination":
        return score_illumination(s)
    if dim == "geology":
        return score_geology(s)
    raise KeyError(dim)


def summarise(draws: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Median and 5-95 % interval of the similarity draws per window."""
    q = np.quantile(draws, [0.05, 0.5, 0.95], axis=1)
    return q[1], q[0], q[2]


def log_moments(s50: np.ndarray, lo: np.ndarray, hi: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Log-normal approximation used identically in Python and TypeScript for aggregation."""
    mu = np.log(np.clip(s50, EPS, 1))
    sd = (np.log(np.clip(hi, EPS, 1)) - np.log(np.clip(lo, EPS, 1))) / (2 * 1.6448536269514722)
    return mu, np.clip(sd, 0, None)


__all__ = ["EarthTable", "Scoring", "score_dimension", "summarise", "log_moments", "js_divergence",
           "cdf_points", "eval_cdf", "earth_geology_classes", "GRID", "math"]
