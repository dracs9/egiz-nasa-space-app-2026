"""Candidate-conditioned rover experiment (connects discovery to Mission Lab physics).

For a selected Earth candidate and planetary target, the existing CF_TERRAMECHANICS
model (pipeline.analog_transfer.counterfactual; TS port web/src/atlas/physics.ts) gives
traction-limited slope, sinkage and compaction resistance under three cases: target
gravity, Earth load-matched test, Earth mass-matched test. These are applied to the
candidate's MEASURED slope distribution (Copernicus GLO-30, 100 m baseline):

  traversable fraction   CDF(slope limit) of the candidate terrain
  climbing energy        mean over traversable slopes of m g (rho cos t + sin t)  [J/m]

The deltas say how an Earth field test on this terrain would mis-state target-gravity
performance. Static Bekker model with assumed soil; not a hardware result.
"""
from __future__ import annotations

import math

import numpy as np

from pipeline.analog_transfer.counterfactual import terramechanics
from pipeline.discovery.fingerprint import Window
from pipeline.discovery.similarity import GRID, cdf_points, eval_cdf

ROVER_BASELINE_M = 100


def slope_cdf(w: Window, b: int = ROVER_BASELINE_M) -> np.ndarray | None:
    get = lambda n: np.array([w.f(n) if w.f(n) is not None else np.nan])  # noqa: E731
    if w.f(f"slope_f{b}_p50_deg") is None:
        return None
    x, y = cdf_points(get, b)
    return eval_cdf(x, y, np.zeros((1, 1)), np.ones((1, 1)))[0, 0]


def climbing_energy_j_per_m(cdf: np.ndarray, limit_deg: float, mass: float, g: float, rho: float) -> float | None:
    pdf = np.diff(cdf, prepend=0.0)
    theta = np.radians(np.clip(GRID - 0.5, 0, None))
    sel = GRID <= limit_deg
    p = pdf[sel]
    if p.sum() <= 0:
        return None
    e = mass * g * (rho * np.cos(theta[sel]) + np.sin(theta[sel]))
    return float((e * p).sum() / p.sum())


def rover_experiment(w: Window, body: str, rover: dict | None = None, soil: dict | None = None) -> dict | None:
    cdf = slope_cdf(w)
    if cdf is None:
        return None
    tm = terramechanics(body, rover, soil)
    cases = {}
    for key, c in tm["cases"].items():
        limit = c["slope_limit_deg"]
        trav = float(np.interp(limit, GRID, cdf))
        energy = climbing_energy_j_per_m(cdf, limit, c["test_mass_kg"], c["gravity"], c["resistance_to_load"])
        cases[key] = {"label": c["label"], "slope_limit_deg": round(limit, 3), "sinkage_mm": round(c["sinkage_m"] * 1000, 3),
                      "traversable_frac": round(trav, 4), "climbing_energy_j_per_m": None if energy is None else round(energy, 2)}
    t = cases["target"]
    deltas = {}
    for key in ("earth_load_matched", "earth_mass_matched"):
        e = cases[key]
        deltas[key] = {
            "d_slope_limit_deg": round(e["slope_limit_deg"] - t["slope_limit_deg"], 3),
            "d_traversable_frac": round(e["traversable_frac"] - t["traversable_frac"], 4),
            "sinkage_ratio": round(e["sinkage_mm"] / t["sinkage_mm"], 4) if t["sinkage_mm"] else None,
            "energy_ratio": (round(e["climbing_energy_j_per_m"] / t["climbing_energy_j_per_m"], 4)
                             if e["climbing_energy_j_per_m"] and t["climbing_energy_j_per_m"] else None),
        }
    return {"model": "CF_TERRAMECHANICS on candidate slope CDF", "status": "MODEL_ESTIMATE", "window": w.id,
            "body": body, "baseline_m": ROVER_BASELINE_M, "rover": tm["inputs"]["rover"], "soil": tm["inputs"]["soil"],
            "cases": cases, "deltas": deltas,
            "assumptions": ["Static Bekker rigid-wheel model, equal wheel loads, uphill traverse (conservative)",
                            "Soil parameters are Apollo-era lunar estimates applied to Earth and target alike",
                            f"Candidate terrain = measured slope distribution at {ROVER_BASELINE_M} m baseline; "
                            "rover-scale (< 10 m) roughness is not resolved",
                            "No gravity-dependent soil strength: the direction of the transfer error is contested"],
            "limitations": tm["limitations"], "references": tm["references"]}


def fmt_ratio(x: float | None) -> str:
    return "n/a" if x is None or not math.isfinite(x) else f"{x:.2f}x"
