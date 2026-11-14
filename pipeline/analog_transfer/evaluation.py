"""Pre-declared hypothesis tests, ablations, negative controls and robustness checks.

Criteria are fixed in docs/research/ATLAS_PI_SCIENTIFIC_HYPOTHESES.md before results
are read. Each experiment returns its measured values and a verdict in
{supported, not_supported, inconclusive, not_run}. No experiment uses invented labels.
"""

from __future__ import annotations

import json
from itertools import combinations
from pathlib import Path

import numpy as np
from scipy.stats import kendalltau

from . import constellation
from . import features as F
from .transfer import STATUSES, assess, compute_tensor

BINNED = [0.5, 1.5, 3.5, 7.5, 12.5, 17.5, 25, 37.5, 52.5, 75]  # midpoints of terrain_evidence bins


def _rank_tau(a: dict, b: dict) -> tuple[float | None, bool]:
    keys = sorted(k for k in a if a[k] is not None and b.get(k) is not None)
    if len(keys) < 3:
        return None, False
    tau = kendalltau([a[k] for k in keys], [b[k] for k in keys]).statistic
    top_a = max(keys, key=lambda k: (a[k], k))
    top_b = max(keys, key=lambda k: (b[k], k))
    return (None if np.isnan(tau) else float(tau)), top_a != top_b


def h1_mission_conditioning(tensor: dict, sites: list[str], targets: list[str]) -> dict:
    rows = []
    for t in targets:
        general = {s: tensor["general_similarity"][f"{s}|{t}"] for s in sites}
        tasks = sorted({c["task"] for c in tensor["cells"] if c["target"] == t})
        for task in tasks:
            cells = {c["site"]: c for c in tensor["cells"] if c["target"] == t and c["task"] == task}
            # Only field-transferable tasks whose match uses >= 2 measured factors are assessable;
            # lab-only tasks and single-factor tasks would make the comparison trivial.
            if any("PHYSICS_PRIMARY" in c["reasons"] for c in cells.values()):
                continue
            usable = [c for c in cells.values() if not c["constraints"]["failed"]]
            if all(sum(f["match"] is not None for f in c["factors"]) < 2 for c in usable):
                continue
            match = {c["site"]: c["axes"]["task_match"] for c in usable}
            tau, top_diff = _rank_tau(match, {s: general[s] for s in match})
            if tau is None and not top_diff:
                continue
            rows.append({"target": t, "task": task, "kendall_tau": tau, "top_site_differs": top_diff})
    differing = sum(1 for r in rows if r["top_site_differs"] or (r["kendall_tau"] is not None and r["kendall_tau"] < 0.7))
    verdict = "supported" if rows and differing >= len(rows) / 2 else "not_supported" if rows else "inconclusive"
    return {"id": "H1", "criterion": ">= half of assessable tasks have a different top site or Kendall tau < 0.7 vs the general similarity ranking",
            "caveat": "Partly expected by construction (task factor sets differ from the general factor set); the measured content is how often the practical recommendation changes on real sites.",
            "rows": rows, "tasks_assessed": len(rows), "tasks_differing": differing, "verdict": verdict}


def h2_constellation(constellations: dict) -> dict:
    rows = []
    for mid, by_k in constellations.items():
        for k in ("2", "3"):
            c = by_k[k]
            Q = c["_Q"]
            rows.append({"mission": mid, "k": int(k), "optimizer_covered": c["covered"],
                         "topk_covered": c["baseline_topk_individual"]["covered"],
                         "general_covered": c["baseline_general_similarity"]["covered"],
                         "requirements": len(c["per_requirement"]),
                         "optimizer_J": c["objective"]["J"], "topk_J": c["baseline_topk_individual"]["objective"]["J"],
                         "general_J": c["baseline_general_similarity"]["objective"]["J"],
                         "greedy_equals_exact": sorted(c["greedy"]["selected"]) == sorted(c["selected"]),
                         "n_subsets": int(sum(1 for _ in combinations(range(Q.shape[0]), int(k))))})
    better = [r for r in rows if r["optimizer_covered"] > max(r["topk_covered"], r["general_covered"])]
    worse = [r for r in rows if r["optimizer_covered"] < max(r["topk_covered"], r["general_covered"])]
    verdict = "supported" if better and not worse else "not_supported" if worse or not better else "inconclusive"
    return {"id": "H2", "criterion": "Optimised portfolio covers more requirements (status + LCB rule, a metric it does not optimise) than both the top-K individual and top-K general-similarity portfolios in >= 1 mission/K and fewer in none",
            "rows": rows, "verdict": verdict,
            "caveat": "On its own objective J the exact optimiser cannot lose to any baseline; only the independent coverage count is evidence."}


def _binned_w1(h_a: list[float], h_b: list[float]) -> float:
    ca, cb = np.cumsum(h_a), np.cumsum(h_b)
    edges = [0, 1, 2, 5, 10, 15, 20, 30, 45, 60, 90]
    widths = np.diff(edges)
    return float(np.sum(np.abs(ca - cb) * widths))  # W1 = integral |F_a - F_b| over binned support


def h3_resolution(terrain_evidence: dict) -> dict:
    hist = {}
    for e in terrain_evidence["entries"]:
        for base, g in e["grids"].items():
            c = np.asarray(g["slope_histogram"]["counts"], dtype=float)
            hist[(e["id"], base)] = (c / c.sum()).tolist()
    earth = sorted({k[0] for k in hist if not k[0].startswith(("MOON", "MARS"))})
    rows = []
    for target, tbase, mismatch_base in (("MARS_JEZERO", "400", "100"), ("MOON_MONS_MOUTON", "100", "400")):
        matched = {s: _binned_w1(hist[(s, tbase)], hist[(target, tbase)]) for s in earth}
        mism = {s: _binned_w1(hist[(s, mismatch_base)], hist[(target, tbase)]) for s in earth}
        tau = kendalltau([matched[s] for s in earth], [mism[s] for s in earth]).statistic
        false_similar = [s for s in earth if mism[s] < 2.0 <= matched[s]]
        false_dissimilar = [s for s in earth if matched[s] < 2.0 <= mism[s]]
        top_matched = sorted(earth, key=lambda s: matched[s])[:3]
        top_mism = sorted(earth, key=lambda s: mism[s])[:3]
        rows.append({"target": target, "target_baseline_m": int(tbase), "earth_mismatched_baseline_m": int(mismatch_base),
                     "w1_matched": matched, "w1_mismatched": mism,
                     "mean_abs_shift_deg": float(np.mean([abs(mism[s] - matched[s]) for s in earth])),
                     "between_site_sd_matched_deg": float(np.std(list(matched.values()))),
                     "kendall_tau": float(tau), "top3_matched": top_matched, "top3_mismatched": top_mism,
                     "false_similar_within_2deg": false_similar, "false_dissimilar": false_dissimilar})
    changed = any(set(r["top3_matched"]) != set(r["top3_mismatched"]) or r["false_similar_within_2deg"] or r["false_dissimilar"]
                  or r["mean_abs_shift_deg"] >= 0.25 * r["between_site_sd_matched_deg"] for r in rows)
    return {"id": "H3", "criterion": "Comparing an Earth slope distribution at a different baseline than the target changes the top-3 set, flips a site across the 2 deg tolerance, or shifts W1 by >= 25% of the between-site SD",
            "rows": rows, "verdict": "supported" if changed else "not_supported",
            "data": "terrain_evidence.json slope histograms (100 m and 400 m baselines; binned W1)"}


def h4_physics(raw_by_target: dict, rules: dict) -> dict:
    changed, hidden, total = [], [], 0
    for target, raw in raw_by_target.items():
        for (site, task_id), (task, factors, physics, failed, unknown) in raw.items():
            with_p = assess(rules, task, factors, physics, failed, unknown, site, target)
            no_p = assess(rules, task, factors, [], failed, unknown, site, target)
            total += 1
            if with_p["status"] != no_p["status"]:
                changed.append({"target": target, "site": site, "task": task_id, "with_physics": with_p["status"], "without": no_p["status"]})
            m = with_p["axes"]["task_match"]
            if with_p["status"] == "NON_TRANSFERABLE" and "PHYSICS_PRIMARY" in with_p["reasons"] and m is not None and m >= rules["supported_lower_bound"]:
                hidden.append({"target": target, "site": site, "task": task_id, "task_match": m})
    return {"id": "H4", "criterion": "Explicit physical-mismatch modelling changes the status of >= 1 cell and exposes >= 1 cell whose terrain match alone would look strong",
            "cells": total, "status_changed": len(changed), "examples": changed[:12],
            "high_match_but_non_transferable": hidden,
            "caveat": "Status changes follow from the declared physics rules by design; the empirical content is that real sites with strong terrain matches (e.g. WHEEL_SOIL) would be recommended by a similarity-only system.",
            "verdict": "supported" if changed and hidden else "not_supported"}


def h5_planner(plans: dict) -> dict:
    rows = []
    for mid, plan in plans.items():
        for m in plan["measurements"]:
            rows.append({"mission": mid, "measurement": m["id"], "evpi": m["evpi"], "evpi_relative": m["evpi_relative"],
                         "decision_change_probability": m["decision_change_probability"]})
    material = [r for r in rows if (r["evpi_relative"] or 0) >= 0.05 and r["decision_change_probability"] >= 0.2]
    controls = [r for r in rows if r["measurement"] == "M_BEVAMETER"]
    control_ok = all(r["evpi"] == 0 for r in controls)
    return {"id": "H5", "criterion": ">= 1 measurement with EVPI >= 5% of current expected value and decision-change probability >= 20%; negative control (bevameter cannot change field statuses) must have EVPI = 0",
            "rows": rows, "material": material, "negative_control_ok": control_ok,
            "verdict": "supported" if material and control_ok else "not_supported"}


def h6_learned() -> dict:
    return {"id": "H6", "verdict": "not_run",
            "reason": "No defensible labels exist (11 windows, no independent analog-validity ground truth), no deep-learning framework is installed, and a learned embedding trained on 11 regional grids would be evaluated on spatially autocorrelated patches of the same windows. The deterministic descriptors are retained; see ATLAS_PI_MODEL_CARD.md."}


# ------------------------------------------------------------ controls and ablations

def nc_water(tensor: dict, sens: dict, constellations: dict, site="KZ_E051.200_N43.400") -> dict:
    cells = [c for c in tensor["cells"] if c["site"] == site]
    all_nt = all(c["status"] == "NON_TRANSFERABLE" and "SITE_CONSTRAINT" in c["reasons"] for c in cells)
    selected = any(site in by_k[k]["selected"] for by_k in constellations.values() for k in by_k)
    freq = max(s["dirichlet"]["selection_frequency"].get(site, 0) for s in sens.values())
    ok = all_nt and not selected and freq == 0
    return {"id": "NC1", "description": "Water-dominated Kazakhstan window (WorldCover water 0.96) must be excluded everywhere",
            "all_cells_non_transferable": all_nt, "ever_selected": selected, "max_dirichlet_frequency": freq,
            "verdict": "passed" if ok else "failed"}


def _scramble(entry: dict, seed: int) -> dict:
    rng = np.random.default_rng(seed)
    z = np.asarray([np.nan if v is None else v for v in entry["grid"]["elevation_m"]], dtype=float)
    valid = np.flatnonzero(np.isfinite(z))
    z[valid] = z[rng.permutation(valid)]
    return {**entry, "id": entry["id"] + "_SCRAMBLED", "grid": {**entry["grid"], "elevation_m": [None if not np.isfinite(v) else float(v) for v in z]}}


def nc_scrambled(ctx, terrain_entries: list[dict], sites: list[str]) -> dict:
    rows = []
    for e in terrain_entries:
        if e["body"] == "earth":
            continue
        scr = _scramble(e, 99)
        ctx.descriptors[scr["id"]] = F.describe(scr)
        ctx.targets[scr["id"]] = {**ctx.targets[e["id"]], "id": scr["id"]}
        real = compute_tensor(ctx, sites, [e["id"]])["cells"]
        fake = compute_tensor(ctx, sites, [scr["id"]])["cells"]
        terrain_tasks = {"ROUTE_PLANNING", "HAZARD_MAPPING", "COMMS_VISIBILITY"}
        rm = [c["axes"]["task_match"] for c in real if c["task"] in terrain_tasks and c["axes"]["task_match"] is not None]
        fm = [c["axes"]["task_match"] for c in fake if c["task"] in terrain_tasks and c["axes"]["task_match"] is not None]
        supported = [c for c in fake if c["status"] == "SUPPORTED"]
        rows.append({"target": e["id"], "median_task_match_real": float(np.median(rm)), "median_task_match_scrambled": float(np.median(fm)),
                     "supported_against_scrambled": len(supported),
                     "scrambled_slope_p50_deg": F.summary(ctx.descriptors[scr["id"]])["slope"]["200"]["p50"]})
        del ctx.descriptors[scr["id"]], ctx.targets[scr["id"]]
    ok = all(r["supported_against_scrambled"] == 0 and r["median_task_match_scrambled"] <= r["median_task_match_real"] for r in rows)
    return {"id": "NC2", "description": "Spatially scrambled target grids (elevation histogram kept, terrain structure destroyed) must not yield SUPPORTED terrain transfers",
            "rows": rows, "verdict": "passed" if ok else "failed"}


def pc_self(ctx, terrain_entries: list[dict], site="PR_JETT_SP_CRATER") -> dict:
    entry = next(e for e in terrain_entries if e["id"] == site)
    ctrl_id = "CONTROL_SELF"
    ctx.descriptors[ctrl_id] = F.describe({**entry, "id": ctrl_id}, seed=1)
    tile = ctx.tiles[site]
    mars = next(t for t in ctx.targets.values() if t["body"] == "mars")
    ctx.targets[ctrl_id] = {**mars, "id": ctrl_id, "attrs": dict(tile["attrs"]),
                            "attr_sources": {k: "control" for k in tile["attrs"]}}
    cells = compute_tensor(ctx, [site], [ctrl_id])["cells"]
    route = next(c for c in cells if c["task"] == "ROUTE_PLANNING")
    del ctx.descriptors[ctrl_id], ctx.targets[ctrl_id]
    ok = route["status"] == "SUPPORTED" and route["axes"]["task_match"] > 0.95
    return {"id": "PC1", "description": "Positive control: a site compared with itself (independent bootstrap seed, Mars physics) must give near-perfect terrain match and SUPPORTED route planning",
            "task_match": route["axes"]["task_match"], "ci90": route["axes"]["task_match_ci90"], "status": route["status"],
            "verdict": "passed" if ok else "failed"}


def ablations(raw_by_target: dict, rules: dict, cells: list[dict], missions: list[dict], sites: list[str], tags: dict) -> dict:
    out = {}
    variants = {
        "no_resolution_rule": lambda t, f, p: (dict(t, required_resolution_m=1e9), f, p, rules),
        "no_evidence_quality_rule": lambda t, f, p: (t, f, p, dict(rules, supported_min_quality=0.0)),
        "no_physics": lambda t, f, p: (t, f, [], rules),
    }
    for name, fn in variants.items():
        new_cells, changed = [], 0
        for target, raw in raw_by_target.items():
            for (site, _), (task, factors, physics, failed, unknown) in raw.items():
                t2, f2, p2, r2 = fn(task, factors, physics)
                c = assess(r2, t2, f2, p2, failed, unknown, site, target)
                base = assess(rules, task, factors, physics, failed, unknown, site, target)
                changed += c["status"] != base["status"]
                new_cells.append(c)
        sel = {m["id"]: constellation.design(new_cells, m, sites, tags, k=3)["selected"] for m in missions}
        out[name] = {"status_changes": changed, "selected_k3": sel}
    for name, kwargs in {"no_uncertainty_point_estimates": None, "no_redundancy_penalty": {"lam": 0.0}}.items():
        sel = {}
        for m in missions:
            if kwargs is None:
                reqs, _ = constellation.requirements(cells, m)
                w = np.array([r["weight"] for r in reqs])
                w = w / w.sum()
                Q = constellation.contribution_matrix(cells, m, reqs, sites, use_lcb=False)
                chosen, _, _ = constellation.optimize(Q, w, 3)
                sel[m["id"]] = [sites[i] for i in chosen]
            else:
                sel[m["id"]] = constellation.design(cells, m, sites, tags, k=3, **kwargs)["selected"]
        out[name] = {"selected_k3": sel}
    nominal = {m["id"]: constellation.design(cells, m, sites, tags, k=3)["selected"] for m in missions}
    for v in out.values():
        v["selection_differs_from_nominal"] = {mid: sorted(s) != sorted(nominal[mid]) for mid, s in v["selected_k3"].items()}
    return {"nominal_selected_k3": nominal, "variants": out}


def robustness(stability: dict, sens: dict) -> dict:
    stable = sum(1 for v in stability.values() if v["stable"])
    by_status = {s: {"n": 0, "stable": 0} for s in STATUSES}
    for v in stability.values():
        by_status[v["nominal"]]["n"] += 1
        by_status[v["nominal"]]["stable"] += v["stable"]
    return {"tolerance_x0.5_x2": {"cells": len(stability), "stable": stable, "fraction_stable": stable / len(stability),
                                  "by_status": by_status},
            "mission_priorities": {mid: {"dirichlet_median_jaccard": s["dirichlet"]["median_jaccard"],
                                         "selection_frequency": s["dirichlet"]["selection_frequency"],
                                         "parameter_grid": s["parameters"]} for mid, s in sens.items()}}


def run_all(ctx, tensor, constellations, sens, plans, stability, meta) -> dict:
    from .build import PILOT, raw_cells
    sites = sorted(ctx.tiles)
    targets = sorted(t for t in ctx.targets if t in ctx.descriptors)
    raw_by_target = {t: raw_cells(ctx, sites, t) for t in targets}
    te = json.loads((Path(PILOT) / "terrain_evidence.json").read_text())
    tags = {s: v["tags"] for s, v in ctx.registry.context["sites"].items()}
    return {
        "protocol": "Deterministic; all experiments on the measured pilot bundle. Criteria pre-declared in ATLAS_PI_SCIENTIFIC_HYPOTHESES.md.",
        "hypotheses": [h1_mission_conditioning(tensor, sites, targets), h2_constellation(constellations),
                       h3_resolution(te), h4_physics(raw_by_target, ctx.registry.rules), h5_planner(plans), h6_learned()],
        "controls": [nc_water(tensor, sens, constellations), nc_scrambled(ctx, meta["terrain"]["entries"], sites),
                     pc_self(ctx, meta["terrain"]["entries"])],
        "ablations": ablations(raw_by_target, ctx.registry.rules, tensor["cells"], ctx.registry.tasks["missions"], sites, tags),
        "robustness": robustness(stability, sens),
    }
