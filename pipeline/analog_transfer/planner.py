"""Active field-research planner: expected value of perfect information (EVPI).

Decision: which analog constellation A (|A| <= K) to field. Utility: the constellation
objective J(A; theta) from constellation.py, recomputed after the tensor statuses are
re-assessed under hypothetical measurement outcomes theta.

    EVPI(G) = E_theta[ max_A J(A; theta) ] - max_A E_theta[ J(A; theta) ]

for the uncertain quantities G resolved by a measurement (Raiffa & Schlaifer 1961).
Monte Carlo over declared priors; quantities not resolved by G stay in their current
state. EVPI is in units of the coverage objective; no monetary cost is claimed.

Priors (declared; see ATLAS_PI_SCIENTIFIC_HYPOTHESES.md):
- Missing factor match: Uniform(0, 1) (non-informative over the bounded match scale).
- Resolution-limited factor after a high-resolution survey: Uniform(0, 1) metre-scale
  match, and the factor no longer limits resolution.
- Curated process tags: current tags correct with grade-dependent probability
  (A 0.95, B 0.85, C 0.6, D 0.5); otherwise the shared/non-shared outcome flips.
- Lunar low-Sun windows: snow-free fraction in the best month ~ Uniform(0, 1).
"""

from __future__ import annotations

from itertools import combinations

import numpy as np

from .constellation import contribution_matrix, objective, requirements
from .transfer import assess

GRADE_P = {"A": 0.95, "B": 0.85, "C": 0.6, "D": 0.5}


def _sample_factor(f: dict, measurement: dict, rng, n_boot: int, reg) -> dict | None:
    """Return an updated factor record for one draw, or None if the measurement does not touch it."""
    if f["factor"] not in measurement["resolves"]:
        return None
    side = measurement["side"]
    g = dict(f)
    if f["factor"] == "process":
        if f["match"] is None:
            return None
        grade = f["target"]["grade"] if side == "target" else f["earth"]["grade"]
        comp = reg.context["compatibility"]
        correct = rng.random() < GRADE_P[grade]
        shared = bool(f["detail"].get("shared_tags"))
        if not correct:
            shared = not shared
        g["match"] = comp["shared_tag"] if shared else comp["no_shared_tag"]
        g["quality"] = 1.0
    elif f["factor"] in ("fine_slope", "roughness") and measurement["id"] == "M_HIRES_DEM":
        g["match"] = float(rng.random())
        g["effective_resolution_m"] = 5.0
        g["quality"] = 0.9
    elif f["factor"] == "illumination_geometry" and measurement["id"] == "M_SNOW":
        if f["match"] is None or f.get("target", {}).get("unit", "").startswith("deg (median"):
            return None  # Mars illumination does not use snow availability
        g["match"] = f["match"] * float(rng.random())
    elif f["match"] is None:
        # One side measured while the other is still unknown: the factor stays unknown.
        if side == "earth" and (f["target"] or {}).get("kind") == "unknown":
            return None
        if side == "target" and (f["earth"] or {}).get("kind") == "unknown":
            return None
        g["match"] = float(rng.random())
        g["quality"] = 0.9
    else:
        return None
    g["boot"] = [g["match"]] * n_boot
    g["ci"] = [g["match"], g["match"]]
    return g


def _paired(measurement: dict, measurements: list[dict]) -> dict:
    """Combined measurement used when one side alone cannot resolve a factor."""
    partner = next((m for m in measurements if m["id"] != measurement["id"]
                    and set(m["resolves"]) == set(measurement["resolves"]) and m["side"] != measurement["side"]), None)
    if partner is None:
        return None
    return {"id": f"{measurement['id']}+{partner['id']}", "name": f"{measurement['name']} + {partner['name']}",
            "resolves": measurement["resolves"], "side": "both", "pair": [measurement["id"], partner["id"]]}


def evpi(raw: dict, mission: dict, sites: list[str], measurement: dict, reg, k: int = 3,
         lam: float = 0.1, kappa: float = 0.5, draws: int = 150, seed: int = 11,
         site_filter: str | None = None) -> dict:
    """raw: {(site, task): (task, factors_with_boot, physics, failed, unknown)} for the mission target."""
    rng = np.random.default_rng(seed)
    base_cells = [assess(reg.rules, *raw[key][:5], key[0], mission["target"]) for key in raw]
    reqs, _ = requirements(base_cells, mission)
    w = np.array([r["weight"] for r in reqs])
    w = w / w.sum()
    n_boot = len(next(iter(raw.values()))[1][0]["boot"])
    J_all = []
    flips = {}
    touched_any = False
    subsets = [c for size in range(1, k + 1) for c in combinations(range(len(sites)), size)]
    base = {(c["site"], c["task"]): c for c in base_cells}
    candidates = [key for key, (task, factors, *_rest) in raw.items()
                  if (site_filter is None or key[0] == site_filter)
                  and any(f["factor"] in measurement["resolves"] for f in factors)]
    for _ in range(draws):
        cells = dict(base)
        for key in candidates:
            task, factors, physics, failed, unknown = raw[key]
            updated, changed = [], False
            for f in factors:
                g = _sample_factor(f, measurement, rng, n_boot, reg)
                changed = changed or g is not None
                updated.append(g if g is not None else f)
            if not changed:
                continue
            touched_any = True
            cell = assess(reg.rules, task, updated, physics, failed, unknown, key[0], mission["target"])
            cells[key] = cell
            if cell["status"] != base[key]["status"]:
                flips[key] = flips.get(key, 0) + 1
        Q = contribution_matrix(list(cells.values()), mission, reqs, sites, kappa)
        J_all.append([objective(Q, w, s, lam)["J"] for s in subsets])
    J = np.array(J_all)
    # Information value below arithmetic roundoff is reported as exactly zero.
    prior_best = int(J.mean(axis=0).argmax())
    value_now = float(J.mean(axis=0).max())
    value_info = float(J.max(axis=1).mean())
    # A decision change counts only if the informed choice beats the prior choice by >= 1% of current value.
    gain = J.max(axis=1) - J[:, prior_best]
    change = float(np.mean(gain >= 0.01 * max(value_now, 1e-9)))
    evpi_value = value_info - value_now
    evpi_value = 0.0 if evpi_value < 1e-12 else float(evpi_value)
    return {
        "measurement": measurement["id"], "site": site_filter, "touched": touched_any,
        "evpi": evpi_value, "expected_value_now": value_now,
        "evpi_relative": evpi_value / value_now if value_now > 0 else None,
        "expected_value_with_information": value_info,
        "decision_change_probability": change,
        "prior_best": [sites[i] for i in subsets[prior_best]],
        "status_flip_probability": {f"{s}|{t}": n / draws for (s, t), n in sorted(flips.items())},
        "draws": draws, "seed": seed,
    }


def plan(raw: dict, mission: dict, sites: list[str], reg, k: int = 3, draws: int = 150) -> dict:
    """Rank measurements (and site-specific measurement placements) by EVPI."""
    measurements = reg.measurements["measurements"]
    rows = []
    candidates = list(measurements)
    for m in measurements:
        pair = _paired(m, measurements)
        if pair and m["side"] == "earth":
            candidates.append(pair)
    for m in candidates:
        whole = evpi(raw, mission, sites, m, reg, k=k, draws=draws)
        per_site = []
        if m["side"] in ("earth", "both"):
            for s in sites:
                r = evpi(raw, mission, sites, m, reg, k=k, draws=draws, site_filter=s)
                if r["touched"]:
                    per_site.append({"site": s, "evpi": r["evpi"],
                                     "decision_change_probability": r["decision_change_probability"],
                                     "status_flip_probability": r["status_flip_probability"]})
        per_site.sort(key=lambda r: -r["evpi"])
        meta = next((x for x in measurements if x["id"] == m["id"]), m)
        rows.append({**{k2: meta.get(k2) for k2 in ("id", "name", "instrument", "scale", "sampling", "effort",
                                                     "expected_evidence", "limitations", "resolves", "side")},
                     "id": m["id"], "name": m["name"], "pair": m.get("pair"),
                     "evpi": whole["evpi"], "evpi_relative": whole["evpi_relative"],
                     "decision_change_probability": whole["decision_change_probability"],
                     "touched": whole["touched"], "status_flip_probability": whole["status_flip_probability"],
                     "per_site": per_site[:5]})
    rows.sort(key=lambda r: (-r["evpi"], r["id"]))
    return {"mission": mission["id"], "method": "Monte Carlo EVPI over constellation choice (exact enumeration of subsets)",
            "draws": draws, "measurements": rows}
