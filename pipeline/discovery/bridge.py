"""Physics -> AlphaEarth bridge: an Earth-trained model that maps shared physical features to an embedding.

python -m pipeline.discovery alphaearth-bridge      # needs the AlphaEarth index (alphaearth-index)

AlphaEarth only describes Earth. The bridge learns, on Earth windows, a ridge regression from
features that can ALSO be measured on the Moon and Mars (terrain statistics, surface albedo,
exposed ground, absence of liquid water, solar geometry) to the 64-d AlphaEarth embedding. Applied
to a planetary point, it predicts the embedding an Earth place with the same physics would have,
which is then searched by cosine similarity among all Earth windows.

Honesty rules
* validation is spatially blocked (10 x 10 deg blocks never split between train and test);
  reported as mean cosine(predicted, true) and the skill over predicting the mean embedding;
* a planetary feature vector is almost always outside the Earth training range in some
  features (no vegetation, no water). The squared Mahalanobis distance to the training data is
  reported against the 99th percentile of the training distances; beyond it the result is
  labelled ``extrapolation`` and must not be read as a match.
"""
from __future__ import annotations

import json
import math

import numpy as np

from pipeline.discovery import alphaearth as AE
from pipeline.discovery import dimensions as D

MODEL = AE.AE_DIR / "bridge_model.json"
B = 400
FEATURES = [  # (name, Earth window column, transform)
    ("slope_p50", f"slope_f{B}_p50_deg", "log1p"), ("slope_p90", f"slope_f{B}_p90_deg", "log1p"),
    ("frac_lt10", f"frac_lt10_f{B}", "id"), ("frac_lt20", f"frac_lt20_f{B}", "id"),
    ("tri", f"tri_f{B}_m", "log1p"), ("slope_r_p50", "slope_r_p50_deg", "log1p"),
    ("relief", "relief_m", "log1p"), ("albedo", None, "id"), ("bare", "bare_frac", "id"),
    ("precip", "precip_annual_mm", "log1p"), ("noon_lo", None, "id"), ("noon_hi", None, "id"),
]
LAMBDAS = (0.1, 1.0, 10.0, 100.0)


def _tf(v, kind):
    if v is None or not math.isfinite(v):
        return np.nan
    return math.log1p(max(v, 0.0)) if kind == "log1p" else float(v)


def earth_matrix(windows, albedo: dict[str, float]) -> np.ndarray:
    rows = []
    for w in windows:
        lo, hi = D.noon_elevation_range(w.lat, D.BODY["earth"]["obliquity_deg"])
        extra = {"albedo": albedo.get(w.id), "noon_lo": lo, "noon_hi": hi}
        rows.append([_tf(extra[n] if col is None else w.f(col), k) for n, col, k in FEATURES])
    return np.array(rows, float)


def target_vector(window, body: str, props: dict) -> np.ndarray:
    lo, hi = D.noon_elevation_range(window.lat, D.BODY[body]["obliquity_deg"])
    alb = (props.get("albedo_tes") or {}).get("value")
    extra = {"albedo": alb, "noon_lo": lo, "noon_hi": hi}
    vals = {f"slope_f{B}_p50_deg": window.f(f"slope_f{B}_p50_deg"), f"slope_f{B}_p90_deg": window.f(f"slope_f{B}_p90_deg"),
            f"frac_lt10_f{B}": window.f(f"frac_lt10_f{B}"), f"frac_lt20_f{B}": window.f(f"frac_lt20_f{B}"),
            f"tri_f{B}_m": window.f(f"tri_f{B}_m"), "slope_r_p50_deg": window.f("slope_r_p50_deg"),
            "relief_m": window.f("relief_m"), "bare_frac": 1.0, "precip_annual_mm": 0.0}
    return np.array([_tf(extra[n] if col is None else vals[col], k) for n, col, k in FEATURES], float)


def _ridge(X, Y, lam):
    p = X.shape[1]
    return np.linalg.solve(X.T @ X + lam * np.eye(p), X.T @ Y)


def _unit_rows(Y):
    return Y / np.clip(np.linalg.norm(Y, axis=1, keepdims=True), 1e-9, None)


def fit(X: np.ndarray, Y: np.ndarray, lon: np.ndarray, lat: np.ndarray, *, block_deg: float = 10.0,
        folds: int = 5, seed: int = 2026) -> dict:
    """Standardise, impute training medians, spatially blocked CV over ridge lambda, refit on all rows."""
    ok = np.isfinite(Y).all(axis=1)
    X, Y, lon, lat = X[ok], Y[ok], lon[ok], lat[ok]
    med = np.nanmedian(X, axis=0)
    med = np.where(np.isfinite(med), med, 0.0)
    Xi = np.where(np.isfinite(X), X, med)
    mu, sd = Xi.mean(axis=0), Xi.std(axis=0)
    sd = np.where(sd > 1e-9, sd, 1.0)
    Z = np.c_[np.ones(len(Xi)), (Xi - mu) / sd]
    blocks = (np.floor(lon / block_deg).astype(int) * 1000 + np.floor(lat / block_deg).astype(int))
    ub = np.unique(blocks)
    rng = np.random.default_rng(seed)
    fold_of = dict(zip(ub, rng.integers(0, folds, len(ub))))
    f = np.array([fold_of[b] for b in blocks])
    ymean = _unit_rows(Y.mean(axis=0, keepdims=True))[0]
    scores = {}
    for lam in LAMBDAS:
        cos_m, cos_b = [], []
        for k in range(folds):
            tr, te = f != k, f == k
            if te.sum() == 0 or tr.sum() < Z.shape[1] + 2:
                continue
            Wt = _ridge(Z[tr], Y[tr], lam)
            P = _unit_rows(Z[te] @ Wt)
            T = _unit_rows(Y[te])
            cos_m.append((P * T).sum(axis=1))
            cos_b.append(T @ _unit_rows(Y[tr].mean(axis=0, keepdims=True))[0])
        cm, cb = np.concatenate(cos_m), np.concatenate(cos_b)
        scores[lam] = {"cv_cosine_mean": float(cm.mean()), "baseline_cosine_mean": float(cb.mean()),
                       "skill": float((cm.mean() - cb.mean()) / max(1e-9, 1 - cb.mean()))}
    lam = max(scores, key=lambda k: scores[k]["cv_cosine_mean"])
    Wt = _ridge(Z, Y, lam)
    Zs = Z[:, 1:]
    cov = np.cov(Zs, rowvar=False) + 1e-6 * np.eye(Zs.shape[1])
    icov = np.linalg.inv(cov)
    d2 = np.einsum("ij,jk,ik->i", Zs, icov, Zs)
    return {"schema": "egiz.alphaearth_bridge", "version": "1.0.0", "features": [n for n, _, _ in FEATURES],
            "median": med.tolist(), "mu": mu.tolist(), "sd": sd.tolist(), "W": Wt.tolist(), "lambda": lam,
            "icov": icov.tolist(), "d2_p99": float(np.quantile(d2, 0.99)), "n_train": int(len(Y)),
            "cv": {str(k): v for k, v in scores.items()}, "cv_selected": scores[lam], "baseline_mean": ymean.tolist(),
            "validation": f"{folds}-fold CV over {len(ub)} spatial blocks of {block_deg:g} deg"}


def predict(model: dict, x: np.ndarray) -> tuple[np.ndarray, float, list[str]]:
    med, mu, sd = (np.asarray(model[k]) for k in ("median", "mu", "sd"))
    imputed = [n for n, v in zip(model["features"], x) if not np.isfinite(v)]
    xi = np.where(np.isfinite(x), x, med)
    z = (xi - mu) / sd
    y = np.r_[1.0, z] @ np.asarray(model["W"])
    d2 = float(z @ np.asarray(model["icov"]) @ z)
    return y / max(np.linalg.norm(y), 1e-9), d2, imputed


def train() -> dict:
    from pipeline.discovery.earth_albedo import load as load_albedo
    from pipeline.discovery.fingerprint import earth_windows, load_windows
    idx = AE.load_index()
    if idx is None:
        raise RuntimeError("AlphaEarth index missing: run python -m pipeline.discovery alphaearth-index first")
    ids, V, ok = idx
    E = earth_windows(load_windows())
    if [w.id for w in E] != ids:
        raise RuntimeError("AlphaEarth index window order differs from the Earth windows; rebuild the index")
    X = earth_matrix(E, load_albedo())
    model = fit(X, np.where(ok[:, None], V, np.nan), np.array([w.lon for w in E]), np.array([w.lat for w in E]))
    MODEL.parent.mkdir(parents=True, exist_ok=True)
    MODEL.write_text(json.dumps(model, separators=(",", ":")) + "\n", encoding="utf-8")
    return {"n_train": model["n_train"], "lambda": model["lambda"], "cv": model["cv_selected"], "path": str(MODEL)}


def load_model() -> dict | None:
    return json.loads(MODEL.read_text(encoding="utf-8")) if MODEL.exists() else None


def search(window, body: str, props: dict, k: int = 15) -> dict:
    """Predicted-embedding search for a planetary point; None-safe when the model or index is missing."""
    model, idx = load_model(), AE.load_index()
    if model is None or idx is None:
        return {"status": "not_built", "note": "needs alphaearth-index then alphaearth-bridge (Earth Engine)"}
    ids, V, ok = idx
    y, d2, imputed = predict(model, target_vector(window, body, props))
    cos = np.where(ok, np.nan_to_num(V) @ y, np.nan)
    order = [int(i) for i in np.argsort(-np.nan_to_num(cos, nan=-2)) if ok[i]][:k]
    extrap = d2 > model["d2_p99"]
    return {"status": "ok", "domain": "extrapolation" if extrap else "within_training_range",
            "mahalanobis_d2": round(d2, 2), "training_d2_p99": round(model["d2_p99"], 2), "imputed": imputed,
            "cv": model["cv_selected"], "validation": model["validation"],
            "top": [{"window": ids[i], "cosine": round(float(cos[i]), 4)} for i in order],
            "method": "ridge regression from shared physical features to the AlphaEarth embedding, trained on Earth",
            "warning": ("The point lies outside the physical range of Earth training data (Mahalanobis d² above the "
                        "99th percentile): this ranking is an extrapolation, not a match.") if extrap else None}
