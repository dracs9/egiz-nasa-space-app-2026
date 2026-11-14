"""Analog Constellation Optimizer: complementary multi-site portfolios.

Requirements r are (task, factor) pairs of the mission's field-transferable tasks,
weighted by mission task weight x factor weight share. A site's contribution to r is

    q(s, r) = LCB_match(s, r) * g(status(s, task)),   g = 1 SUPPORTED, kappa CONDITIONAL, 0 otherwise,

where LCB is the 5th-percentile block-bootstrap match (a conservative, uncertainty-aware
value). The objective is facility-location coverage minus a redundancy penalty:

    J(A) = sum_r w_r max_{s in A} q(s,r)  -  lambda * sum_r w_r (sum_{s in A} q(s,r) - max_{s in A} q(s,r))

Coverage alone is monotone submodular (greedy is within 1-1/e of optimal; Nemhauser,
Wolsey & Fisher 1978); with lambda > 0 it is not monotone, so the pool is enumerated
exactly up to K sites (feasible for pools of tens of sites). This scalarisation is used
for optimisation only; the Pareto frontier keeps the separate objectives visible.
"""

from __future__ import annotations

from itertools import combinations

import numpy as np

STATUS_GAIN = {"SUPPORTED": 1.0, "CONDITIONAL": None, "WEAK": 0.0, "NON_TRANSFERABLE": 0.0, "UNKNOWN": 0.0}
COVER_LCB = 0.1353   # a requirement is covered if some selected site is SUPPORTED/CONDITIONAL for the task
STRONG_LCB = 0.6065  # and its factor lower bound is within two (covered) or one (strongly covered) tolerance


def requirements(cells: list[dict], mission: dict) -> tuple[list[dict], list[dict]]:
    """Return (field requirements, lab-only tasks) for one mission."""
    target = mission["target"]
    by_task = {}
    for c in cells:
        if c["target"] == target and c["task"] in mission["task_weights"]:
            by_task.setdefault(c["task"], []).append(c)
    reqs, lab = [], []
    for task_id, task_cells in sorted(by_task.items()):
        w_task = mission["task_weights"][task_id]
        if w_task <= 0:
            continue
        if any("PHYSICS_PRIMARY" in c["reasons"] for c in task_cells):  # physics is site-independent
            phys = [p for p in task_cells[0]["physics"] if p["role"] == "primary" and p["reproducible_in_field"] == "no"]
            lab.append({"task": task_id, "weight": w_task, "blocking": [p["name"] for p in phys],
                        "alternatives": sorted({a for p in phys for a in p["lab_alternatives"]})})
            continue
        factors = task_cells[0]["factors"]
        total = sum(f["weight"] for f in factors)
        for f in factors:
            reqs.append({"id": f"{task_id}:{f['factor']}", "task": task_id, "factor": f["factor"],
                         "name": f["name"], "weight": w_task * f["weight"] / total})
    return reqs, lab


def contribution_matrix(cells: list[dict], mission: dict, reqs: list[dict], sites: list[str],
                        kappa: float = 0.5, use_lcb: bool = True) -> np.ndarray:
    index = {(c["site"], c["task"]): c for c in cells if c["target"] == mission["target"]}
    Q = np.zeros((len(sites), len(reqs)))
    for i, s in enumerate(sites):
        for j, r in enumerate(reqs):
            c = index.get((s, r["task"]))
            if not c:
                continue
            gain = STATUS_GAIN[c["status"]]
            gain = kappa if gain is None else gain
            f = next(f for f in c["factors"] if f["factor"] == r["factor"])
            if f["match"] is None or gain == 0:
                continue
            Q[i, j] = gain * (f["ci"][0] if use_lcb else f["match"])
    return Q


def objective(Q: np.ndarray, w: np.ndarray, subset: tuple[int, ...], lam: float) -> dict:
    if not subset:
        return {"J": 0.0, "coverage": 0.0, "redundancy": 0.0}
    sub = Q[list(subset)]
    best = sub.max(axis=0)
    coverage = float(best @ w)
    redundancy = float((sub.sum(axis=0) - best) @ w)
    return {"J": coverage - lam * redundancy, "coverage": coverage, "redundancy": redundancy}


def optimize(Q: np.ndarray, w: np.ndarray, k: int, lam: float = 0.1) -> tuple[tuple[int, ...], dict, int]:
    """Exact enumeration of all subsets of size 1..k; ties prefer fewer sites then lexical order."""
    n = Q.shape[0]
    best, best_val, count = (), {"J": -np.inf}, 0
    for size in range(1, min(k, n) + 1):
        for subset in combinations(range(n), size):
            count += 1
            val = objective(Q, w, subset, lam)
            if val["J"] > best_val["J"] + 1e-12:
                best, best_val = subset, val
    # A site with no positive marginal value is never kept (e.g. an excluded control window).
    pruned = tuple(i for i in best if objective(Q, w, best, lam)["J"] - objective(Q, w, tuple(x for x in best if x != i), lam)["J"] > 1e-12)
    if pruned != best and pruned:
        best, best_val = pruned, objective(Q, w, pruned, lam)
    return best, best_val, count


def greedy(Q: np.ndarray, w: np.ndarray, k: int, lam: float = 0.1) -> tuple[tuple[int, ...], dict]:
    chosen: list[int] = []
    for _ in range(min(k, Q.shape[0])):
        options = [(objective(Q, w, tuple(chosen + [i]), lam)["J"], i) for i in range(Q.shape[0]) if i not in chosen]
        val, i = max(options, key=lambda x: (x[0], -x[1]))
        if chosen and val <= objective(Q, w, tuple(chosen), lam)["J"] + 1e-12:
            break
        chosen.append(i)
    return tuple(chosen), objective(Q, w, tuple(chosen), lam)


def pareto(Q: np.ndarray, w: np.ndarray, k: int, quality: np.ndarray, width: np.ndarray,
           tags: list[set], lam: float) -> list[dict]:
    """Non-dominated subsets of <= k contributing sites over separate objectives.

    Sites with no contribution are excluded and every site in a subset must add coverage,
    so a portfolio cannot gain 'diversity' from a site that tests nothing.
    """
    rows = []
    active = [i for i in range(Q.shape[0]) if Q[i].max() > 0]
    for size in range(1, min(k, len(active)) + 1):
        for subset in combinations(active, size):
            cov = objective(Q, w, subset, 0.0)["coverage"]
            if any(cov - objective(Q, w, tuple(x for x in subset if x != i), 0.0)["coverage"] <= 1e-12 for i in subset):
                continue
            sub = Q[list(subset)]
            winner = sub.argmax(axis=0)
            covered = sub.max(axis=0) > 0
            site_idx = np.array(subset)[winner]
            q_mean = float((quality[site_idx, np.arange(Q.shape[1])] * w * covered).sum() / max(1e-9, (w * covered).sum()))
            u_mean = float((width[site_idx, np.arange(Q.shape[1])] * w * covered).sum() / max(1e-9, (w * covered).sum()))
            rows.append({"subset": subset, "coverage": objective(Q, w, subset, lam)["coverage"],
                         "evidence_quality": q_mean, "uncertainty": u_mean,
                         "process_diversity": len(set().union(*[tags[i] for i in subset]))})
    front = []
    for r in rows:
        dominated = any(
            o is not r and o["coverage"] >= r["coverage"] and o["evidence_quality"] >= r["evidence_quality"]
            and o["uncertainty"] <= r["uncertainty"] and o["process_diversity"] >= r["process_diversity"]
            and (o["coverage"] > r["coverage"] or o["evidence_quality"] > r["evidence_quality"]
                 or o["uncertainty"] < r["uncertainty"] or o["process_diversity"] > r["process_diversity"])
            for o in rows)
        if not dominated:
            front.append(r)
    return sorted(front, key=lambda r: -r["coverage"])


def coverage_report(cells, mission, reqs, selected, Q, sites) -> list[dict]:
    """Per requirement: best selected site and coverage level, defined from status + factor LCB."""
    index = {(c["site"], c["task"]): c for c in cells if c["target"] == mission["target"]}
    rows = []
    for j, r in enumerate(reqs):
        best = None
        for s in selected:
            c = index.get((s, r["task"]))
            f = next((f for f in c["factors"] if f["factor"] == r["factor"]), None) if c else None
            if not c or not f or f["match"] is None or c["status"] not in ("SUPPORTED", "CONDITIONAL"):
                continue
            level = "strong" if c["status"] == "SUPPORTED" and f["ci"][0] >= STRONG_LCB else "covered" if f["ci"][0] >= COVER_LCB else None
            if level and (best is None or f["ci"][0] > best["lcb"]):
                best = {"site": s, "lcb": f["ci"][0], "status": c["status"], "level": level}
        rows.append({"id": r["id"], "task": r["task"], "factor": r["factor"], "name": r["name"], "weight": r.get("weight"),
                     "best_site": best["site"] if best else None, "lcb": best["lcb"] if best else None,
                     "status": best["status"] if best else None, "level": best["level"] if best else "uncovered",
                     "q": float(Q[[sites.index(s) for s in selected], j].max()) if selected else 0.0})
    return rows


def factor_matrix(cells, mission, reqs, sites, key):
    index = {(c["site"], c["task"]): c for c in cells if c["target"] == mission["target"]}
    M = np.zeros((len(sites), len(reqs)))
    for i, s in enumerate(sites):
        for j, r in enumerate(reqs):
            c = index.get((s, r["task"]))
            f = next((f for f in c["factors"] if f["factor"] == r["factor"]), None) if c else None
            if f and f["match"] is not None:
                M[i, j] = f["quality"] if key == "quality" else (f["ci"][1] - f["ci"][0])
    return M


def design(cells: list[dict], mission: dict, sites: list[str], tags: dict, k: int = 3,
           lam: float = 0.1, kappa: float = 0.5, general: dict | None = None) -> dict:
    reqs, lab = requirements(cells, mission)
    w = np.array([r["weight"] for r in reqs])
    w = w / w.sum() if w.sum() > 0 else w
    Q = contribution_matrix(cells, mission, reqs, sites, kappa)
    chosen, val, count = optimize(Q, w, k, lam)
    g_chosen, g_val = greedy(Q, w, k, lam)
    singles = sorted(range(len(sites)), key=lambda i: (-objective(Q, w, (i,), lam)["J"], sites[i]))
    topk = tuple(sorted(singles[:k]))
    out = {
        "mission": mission["id"], "target": mission["target"], "k": k,
        "parameters": {"lambda_redundancy": lam, "kappa_conditional": kappa, "uncertainty": "LCB (5th percentile)",
                       "covered_rule": "status SUPPORTED/CONDITIONAL and factor LCB >= 0.1353 (strong: SUPPORTED and LCB >= 0.6065)", "algorithm": "exact enumeration", "subsets_evaluated": count},
        "requirements": [{**r, "weight": float(w[j])} for j, r in enumerate(reqs)],
        "lab_only_tasks": lab,
        "selected": [sites[i] for i in chosen], "objective": val,
        "greedy": {"selected": [sites[i] for i in g_chosen], "objective": g_val},
        "baseline_topk_individual": {"selected": [sites[i] for i in topk], "objective": objective(Q, w, topk, lam)},
    }
    if general:
        gen_rank = sorted(sites, key=lambda s: (-(general.get(f"{s}|{mission['target']}") or 0), s))
        gidx = tuple(sorted(sites.index(s) for s in gen_rank[:k]))
        out["baseline_general_similarity"] = {"selected": [sites[i] for i in gidx], "objective": objective(Q, w, gidx, lam)}
    contrib = []
    for i in chosen:
        rest = tuple(x for x in chosen if x != i)
        wins = [reqs[j]["id"] for j in range(len(reqs)) if Q[i, j] > 0 and Q[i, j] >= Q[list(chosen), j].max() - 1e-12]
        contrib.append({"site": sites[i], "marginal_J": val["J"] - objective(Q, w, rest, lam)["J"],
                        "requirements_won": wins})
    out["contributions"] = contrib
    for key in ("baseline_topk_individual", "baseline_general_similarity"):
        if key in out:
            rep = coverage_report(cells, mission, reqs, out[key]["selected"], Q, sites)
            out[key]["covered"] = sum(1 for p in rep if p["level"] != "uncovered")
            out[key]["strong"] = sum(1 for p in rep if p["level"] == "strong")
    out["per_requirement"] = coverage_report(cells, mission, reqs, [sites[i] for i in chosen], Q, sites)
    out["uncovered"] = [p for p in out["per_requirement"] if p["level"] == "uncovered"]
    out["covered"] = sum(1 for p in out["per_requirement"] if p["level"] != "uncovered")
    out["strong"] = sum(1 for p in out["per_requirement"] if p["level"] == "strong")
    quality = factor_matrix(cells, mission, reqs, sites, "quality")
    width = factor_matrix(cells, mission, reqs, sites, "width")
    tag_sets = [set(tags.get(s, [])) for s in sites]
    front = pareto(Q, w, k, quality, width, tag_sets, lam)
    out["pareto"] = [{"selected": [sites[i] for i in r["subset"]],
                      **{key: r[key] for key in ("coverage", "evidence_quality", "uncertainty", "process_diversity")}}
                     for r in front]
    out["_Q"], out["_w"] = Q, w
    return out


def sensitivity(cells, mission, sites, k=3, lam=0.1, kappa=0.5, draws=200, seed=7) -> dict:
    """Selection stability under (a) single-task emphasis, (b) Dirichlet task-weight draws, (c) lambda/kappa."""
    nominal = set(design(cells, mission, sites, {}, k, lam, kappa)["selected"])
    emphasis = []
    for task in mission["task_weights"]:
        m2 = {**mission, "task_weights": {t: (w * 3 if t == task else w) for t, w in mission["task_weights"].items()}}
        sel = set(design(cells, m2, sites, {}, k, lam, kappa)["selected"])
        emphasis.append({"task": task, "selected": sorted(sel), "jaccard_vs_nominal": len(sel & nominal) / len(sel | nominal)})
    rng = np.random.default_rng(seed)
    freq = {s: 0 for s in sites}
    jacc = []
    tasks = list(mission["task_weights"])
    for _ in range(draws):
        wts = rng.dirichlet(np.ones(len(tasks))) * len(tasks)
        m2 = {**mission, "task_weights": dict(zip(tasks, wts.tolist()))}
        sel = set(design(cells, m2, sites, {}, k, lam, kappa)["selected"])
        for s in sel:
            freq[s] += 1
        jacc.append(len(sel & nominal) / len(sel | nominal))
    params = []
    for lam2 in (0.0, 0.1, 0.3):
        for kappa2 in (0.25, 0.5, 0.75):
            sel = set(design(cells, mission, sites, {}, k, lam2, kappa2)["selected"])
            params.append({"lambda": lam2, "kappa": kappa2, "selected": sorted(sel),
                           "jaccard_vs_nominal": len(sel & nominal) / len(sel | nominal)})
    return {"nominal": sorted(nominal), "task_emphasis_x3": emphasis,
            "dirichlet": {"draws": draws, "seed": seed, "selection_frequency": {s: f / draws for s, f in freq.items()},
                          "median_jaccard": float(np.median(jacc))},
            "parameters": params}
