"""Exact shortlist campaign search checked against global greedy coverage.

Written with AI assistance (Codex); human review pending.
This is not a claim of global optimality over the full candidate pool.
"""

from __future__ import annotations

import math
from itertools import combinations, islice

import numpy as np


def _inputs(F, W):
    F = np.asarray(F, dtype=float)
    W = np.asarray(W, dtype=float)
    if F.ndim != 2 or W.ndim != 1 or F.shape[1] != W.size:
        raise ValueError("F must have shape [sites, objectives] and W shape [objectives]")
    if np.any(~np.isfinite(W)) or np.any(W < 0) or W.sum() <= 0:
        raise ValueError("Objective weights must be finite, nonnegative, and have positive sum")
    if np.any(np.isinf(F)) or np.any(np.isfinite(F) & ((F < 0) | (F > 1))):
        raise ValueError("Fidelity entries must be null/NaN or in [0,1]")
    return np.nan_to_num(F, nan=0.0), W / W.sum()


def _k(k, n):
    if isinstance(k, bool) or not isinstance(k, (int, np.integer)) or not 1 <= k <= 3 or k > n:
        raise ValueError("k must be 1, 2, or 3 and not exceed the pool size")


def coverage(F, W, sites) -> float:
    F, weights = _inputs(F, W)
    return float(np.max(F[list(sites)], axis=0) @ weights) if len(sites) else 0.0


def shortlist(F, W, per_objective: int = 20) -> np.ndarray:
    F, weights = _inputs(F, W)
    if isinstance(per_objective, bool) or not isinstance(per_objective, int) or per_objective < 1:
        raise ValueError("per_objective must be a positive integer")
    chosen = set()
    # Stable sort selects smaller indices on ties (callers supply lexical IDs).
    for column in (*F.T, F @ weights):
        chosen.update(np.argsort(-column, kind="stable")[:per_objective].tolist())
    return np.array(sorted(chosen), dtype=int)


def exact_best(F, W, U, k: int) -> tuple[tuple[int, ...], float]:
    """Enumerate exactly k distinct shortlist sites in bounded NumPy batches."""
    F, weights = _inputs(F, W)
    raw = np.asarray(U)
    if raw.ndim != 1 or not np.issubdtype(raw.dtype, np.integer):
        raise ValueError("U must be a one-dimensional integer index array")
    U = np.unique(raw)
    _k(k, len(U))
    if np.any(U < 0) or np.any(U >= F.shape[0]):
        raise ValueError("Shortlist indices are outside the candidate pool")
    iterator = combinations(U.tolist(), k)
    best_sites, best_score = (), -math.inf
    while batch := list(islice(iterator, 50000)):
        indices = np.asarray(batch, dtype=int)
        scores = np.max(F[indices], axis=1) @ weights
        max_score = float(np.max(scores))
        # combinations are lexically sorted; np.argmax returns the first tie.
        at = int(np.flatnonzero(scores >= max_score - 1e-12)[0])
        sites = batch[at]
        score = float(scores[at])
        if score > best_score + 1e-12 or (abs(score - best_score) <= 1e-12 and sites < best_sites):
            best_sites, best_score = sites, score
    return tuple(best_sites), best_score


def greedy(F, W, k: int) -> tuple[list[int], float]:
    F, weights = _inputs(F, W)
    _k(k, F.shape[0])
    current = np.zeros(F.shape[1])
    selected = []
    for _ in range(k):
        scores = np.maximum(F, current) @ weights
        scores[selected] = -np.inf
        best_score = np.max(scores)
        chosen = int(np.flatnonzero(scores >= best_score - 1e-12)[0])
        selected.append(chosen)
        current = np.maximum(current, F[chosen])
    return selected, float(current @ weights)


def design(F, W, k_max: int = 3, *, site_ids=None, objective_ids=None, best_months=None,
           per_objective: int = 20) -> list[dict]:
    """Return contract Campaign objects for each site budget.

    Equal coverage prefers fewer sites and then lexical IDs. All comparisons use
    double precision; the only tolerance (1e-12) handles arithmetic roundoff.
    """
    # Coverage treats null as zero, but reporting must retain whether a zero
    # was measured at a selected site or merely substituted for missing data.
    known = np.isfinite(np.asarray(F, dtype=float))
    F, weights = _inputs(F, W)
    if not 1 <= k_max <= 3:
        raise ValueError("k_max must be between 1 and 3")
    n, m = F.shape
    site_ids = list(site_ids) if site_ids is not None else [str(i).zfill(len(str(n))) for i in range(n)]
    objective_ids = list(objective_ids) if objective_ids is not None else [str(i) for i in range(m)]
    if len(site_ids) != n or len(set(site_ids)) != n or len(objective_ids) != m:
        raise ValueError("Site and objective IDs must match the matrix and site IDs must be unique")
    order = np.array(sorted(range(n), key=site_ids.__getitem__), dtype=int)
    F = F[order]
    known = known[order]
    site_ids = [site_ids[i] for i in order]
    U = shortlist(F, weights, per_objective)
    campaigns = []
    previous_sites, previous_score = (), -1.0
    if not n or not np.any(F[:, weights > 0] > 0):
        return [{"k": k, "coverage": 0.0, "sites": [],
                 "per_objective": [{"objective": o, "site": None, "F": None} for o in objective_ids],
                 "method": {"shortlist_size": int(U.size), "pool_size": n,
                            "exact_coverage": 0.0, "greedy_coverage": 0.0, "merged_greedy": False}}
                for k in range(1, k_max + 1)]
    for k in range(1, k_max + 1):
        search_k = min(k, n)
        greedy_sites, greedy_score = greedy(F, weights, search_k)
        if len(U) < search_k:
            U = np.union1d(U, greedy_sites)
        best_sites, exact_score = exact_best(F, weights, U, search_k)
        merged = greedy_score > exact_score + 1e-9
        if merged:
            U = np.union1d(U, greedy_sites)
            best_sites, exact_score = exact_best(F, weights, U, search_k)
        chosen = best_sites
        score = exact_score
        if abs(score - previous_score) <= 1e-12:
            chosen, score = previous_sites, previous_score
        # Exact-k ties can contain a redundant site even when k-1's shortlist
        # differed. Remove any zero-gain site before declaring its role.
        for size in range(1, len(chosen)):
            smaller = [(subset, coverage(F, weights, subset)) for subset in combinations(chosen, size)]
            equal = [subset for subset, value in smaller if abs(value - score) <= 1e-12]
            if equal:
                chosen = min(equal)
                break
        maxima = np.max(F[list(chosen)], axis=0)
        per_obj = []
        roles = {index: [] for index in chosen}
        for j, objective_id in enumerate(objective_ids):
            if weights[j] == 0 or maxima[j] <= 0:
                measured = float(maxima[j]) if np.any(known[list(chosen), j]) else None
                per_obj.append({"objective": objective_id, "site": None, "F": measured})
                continue
            winner = next(index for index in chosen if abs(F[index, j] - maxima[j]) <= 1e-12)
            roles[winner].append(objective_id)
            per_obj.append({"objective": objective_id, "site": site_ids[winner], "F": float(maxima[j])})
        sites = []
        for index in chosen:
            month = None
            if best_months:
                # O4 is normally the only objective with a seasonal optimum.
                values = best_months.get(site_ids[index], {})
                month = next((values[o] for o in roles[index] if values.get(o) is not None), None)
            sites.append({"id": site_ids[index], "roles": roles[index], "best_month": month})
        campaigns.append({
            "k": k, "coverage": score, "sites": sites, "per_objective": per_obj,
            "method": {"shortlist_size": int(U.size), "pool_size": n,
                       "exact_coverage": exact_score, "greedy_coverage": greedy_score,
                       "merged_greedy": bool(merged)},
        })
        previous_sites, previous_score = chosen, score
    return campaigns


def gap_ledger(parts_by_objective, F, physical, *, objective_ids=None, threshold=0.1) -> dict:
    """Compute observed ceilings from eligible candidate parts; retain physical gaps.

    Unknown attribute ceilings are omitted. Unknown objective ceilings are null,
    retaining each objective key without claiming an observed ceiling of zero.
    ``parts_by_objective`` is {objective: {tile: {attribute: fidelity|null}}}.
    """
    attributes = []
    ceilings = {}

    def observed_max(values):
        known = [value for value in values if value is not None and math.isfinite(value)]
        return float(max(known)) if known else None

    if isinstance(F, dict):
        for objective, cells in F.items():
            values = [cell.get("F") if isinstance(cell, dict) else cell for cell in cells.values()]
            ceilings[objective] = observed_max(values)
    else:
        matrix = np.asarray(F, dtype=float)
        ids = list(parts_by_objective) if objective_ids is None else list(objective_ids)
        if matrix.ndim != 2 or matrix.shape[1] != len(ids):
            raise ValueError("F must have one column per objective ID")
        ceilings = {o: observed_max(matrix[:, j]) for j, o in enumerate(ids)}
    for objective, tiles in parts_by_objective.items():
        attr_names = sorted({attr for parts in tiles.values() for attr in parts})
        for attr in attr_names:
            known = [parts[attr] for parts in tiles.values() if parts.get(attr) is not None]
            if known and max(known) < threshold:
                attributes.append({"objective": objective, "attr": attr, "ceiling": max(known)})
    return {"attribute": attributes, "objective_ceiling": ceilings, "physical": physical}
