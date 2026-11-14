"""Transparent, non-neural baseline ranking with separate score components.

The primary ranking signal is the existing deterministic objective fidelity
(MATHEMATICAL_SPECIFICATION §§5–7), recomputed through ``pipeline.engine``.
This module adds, without changing the engine:

* an exact decomposition of log F into per-attribute contributions;
* explicit constraint checks (operational suitability);
* data completeness over the objective's attribute weights;
* ranking stability under bounded perturbation of method parameters
  (attribute weights and match widths), reported separately from data
  completeness and evidence strength;
* explicit ``not_available`` components (learned similarity, geology,
  novelty) with the reason, instead of placeholders.

Written with AI assistance (Claude Code); human review pending.
"""

from __future__ import annotations

import copy
import math
from typing import Any

import numpy as np

from pipeline.engine import ENGINE_VERSION
from pipeline.engine.fidelity import objective_fidelity
from pipeline.engine.run import _sun_for, compute_run

from . import ML_VERSION
from .loader import Snapshot

METHOD_NAME = "egiz-transparent-baseline"
CLIMATE_ATTRS = ("t_min_c", "t_max_c", "precip_mm")
SCALE_PARAMS = ("sigma", "tau", "hours_tau", "sweep_tau")
DEFAULT_CONFIG = {
    "stability_draws": 200,
    "stability_seed": 20261107,
    "weight_log_sd": 0.25,
    "scale_log_sd": 0.25,
    "top_k": 3,
    "match_threshold": 0.8,
    "mismatch_threshold": 0.5,
}
# Stage 3 gates from the ML brief §2.1 (counts of distinct sites / patches).
GATES = {"learned_similarity": 50, "novelty": 100}


def _extra(snapshot: Snapshot, target: dict, tile: dict) -> dict:
    """Same context the engine passes to objective_fidelity (shadows not used in Stage 1)."""
    return {
        "context": tile.get("context", {}),
        "snow_free_frac": tile.get("snow_free_frac"),
        "missing_weight_max": snapshot.params.get("missing_weight_max", 0.3),
        "light": _sun_for(snapshot.sun, target, tile),
    }


def _value(tile: dict, attr: str, extra: dict):
    if attr in tile.get("attrs", {}):
        return tile["attrs"][attr]
    if attr in extra:
        return extra[attr]
    return extra.get("context", {}).get(attr)


def _constraints(objective: dict, tile: dict, extra: dict) -> list[dict]:
    checks = []
    for c in objective.get("constraints", []):
        value = _value(tile, c["attr"], extra)
        if isinstance(value, (list, tuple)):
            known = [v for v in value if isinstance(v, (int, float)) and math.isfinite(v)]
            value = max(known) if known else None
        passed = None
        if isinstance(value, (int, float)) and math.isfinite(value):
            passed = value <= c["value"] if c["op"] == "<=" else value >= c["value"]
        checks.append({"attr": c["attr"], "op": c["op"], "threshold": float(c["value"]),
                       "value": None if value is None else float(value), "passed": passed})
    return checks


def _rank_order(scores: dict[str, float | None]) -> list[str]:
    """Descending score, missing last, ties broken by ID (deterministic)."""
    return sorted(scores, key=lambda i: (scores[i] is None, -(scores[i] or 0.0), i))


def _perturbed(objective: dict, rng: np.random.Generator, config: dict) -> dict:
    out = copy.deepcopy(objective)
    for spec in out["attributes"]:
        spec["weight"] = float(spec.get("weight", 1)) * float(np.exp(rng.normal(0, config["weight_log_sd"])))
        params = spec.get("params", {})
        for key in SCALE_PARAMS:
            if key in params:
                params[key] = float(params[key]) * float(np.exp(rng.normal(0, config["scale_log_sd"])))
    return out


def stability(snapshot: Snapshot, target: dict, objective: dict, config: dict) -> dict[str, dict]:
    """Rank distribution of each candidate under method-parameter perturbation.

    This measures sensitivity of the ordering to the provisional weights and
    widths only. It is not measurement uncertainty and not evidence strength.
    """
    rng = np.random.default_rng(config["stability_seed"])
    ids = [tile["id"] for tile in snapshot.candidates]
    extras = {tile["id"]: _extra(snapshot, target, tile) for tile in snapshot.candidates}
    ranks = {i: [] for i in ids}
    for _ in range(config["stability_draws"]):
        obj = _perturbed(objective, rng, config)
        scores = {tile["id"]: objective_fidelity(obj, tile["attrs"], target["attrs"], extras[tile["id"]]).get("F")
                  for tile in snapshot.candidates}
        if all(score is None for score in scores.values()):
            continue
        for position, i in enumerate(_rank_order(scores), start=1):
            if scores[i] is not None:
                ranks[i].append(position)
    out = {}
    draws = config["stability_draws"]
    k = config["top_k"]
    for i, values in ranks.items():
        if not values:
            out[i] = None
            continue
        arr = np.asarray(values, dtype=float)
        out[i] = {
            "top1_frequency": round(float(np.sum(arr == 1)) / draws, 4),
            "topk_frequency": round(float(np.sum(arr <= k)) / draws, 4),
            "k": k,
            "median_rank": float(np.median(arr)),
            "rank_p05": float(np.percentile(arr, 5)),
            "rank_p95": float(np.percentile(arr, 95)),
            "draws": len(values),
        }
    return out


def _not_available(reason: str) -> dict:
    return {"status": "not_available", "value": None, "reason": reason}


def _reasons(snapshot: Snapshot) -> dict[str, str]:
    """Snapshot-specific reasons for unavailable components (shared by definitions and candidates)."""
    n_sites = len(snapshot.candidates)
    n_groups = len({t.get("group_id") for t in snapshot.candidates if t.get("group_id")}) or None
    groups = f" in {n_groups} spatial groups" if n_groups else ""
    if n_sites >= GATES["novelty"]:
        novelty = (f"Gate met ({n_sites} sites{groups}); novelty model is Stage 3 work and is not computed "
                   "until that stage is approved")
    else:
        novelty = f"Stage 3 gate: ≥{GATES['novelty']} sites required, {n_sites} present"
    learned = (f"Stage 3; gate requires ≥{GATES['learned_similarity']} distinct sites and ≥5000 patches; "
               f"snapshot has {n_sites} sites and no committed patch rasters")
    if snapshot.kind == "geo":
        geology = ("Earth geology in the release is a geologic-map category (proxy, shown in "
                   "explanation.context); no harmonised Moon/Mars geology to compare against")
    else:
        geology = "No geology or mineralogy layers in the snapshot"
    return {"novelty": novelty, "learned_similarity": learned, "geological_similarity": geology}


def _component_definitions(snapshot: Snapshot, n_sites: int) -> dict:
    prov = "synthetic" if snapshot.synthetic else "derived"
    reasons = _reasons(snapshot)
    return {
        "deterministic_fidelity": {
            "definition": "Objective fidelity F: weighted geometric mean of attribute fidelities after constraints "
                          "(MATHEMATICAL_SPECIFICATION §§5–7), recomputed by pipeline.engine.",
            "range": "[0,1]; null when a constraint fails or missing weight exceeds the limit",
            "status": "computed", "provenance_class": prov},
        "learned_similarity": {
            "definition": "Similarity in a learned terrain-embedding space.", "range": "n/a",
            "status": "not_available", "reason": reasons["learned_similarity"]},
        "environmental_similarity": {
            "definition": "Geometric mean of this objective's climate attribute fidelities (t_min_c, t_max_c, "
                          "precip_mm), when the objective uses them and values exist.",
            "range": "[0,1]", "status": "computed", "provenance_class": prov},
        "geological_similarity": {
            "definition": "Similarity on geology/mineralogy evidence.", "range": "n/a",
            "status": "not_available", "reason": reasons["geological_similarity"]},
        "operational_suitability": {
            "definition": "All mission constraints of the objective pass (true), any fails (false), or a "
                          "constraint value is missing (null).",
            "range": "boolean or null", "status": "computed", "provenance_class": prov},
        "novelty": {
            "definition": "Unusualness relative to the Earth candidate population. Not similarity to the target.",
            "range": "n/a", "status": "not_available", "reason": reasons["novelty"]},
        "data_completeness": {
            "definition": "Share of the objective's attribute weight whose Earth and target values are both known.",
            "range": "[0,1]", "status": "computed", "provenance_class": prov},
        "ranking_stability": {
            "definition": "Rank distribution under log-normal perturbation of attribute weights and match "
                          "widths. Method sensitivity only; not measurement uncertainty or evidence strength.",
            "range": "frequencies in [0,1], ranks ≥ 1", "status": "computed", "provenance_class": "simulated"},
    }


def rank_profile(snapshot: Snapshot, target: dict, template: dict, objective: dict,
                 engine_run: dict, config: dict) -> dict:
    """Ranked candidates with separate components for one target × objective."""
    config = {**DEFAULT_CONFIG, **(config or {})}
    prov = "synthetic" if snapshot.synthetic else "derived"
    stab = stability(snapshot, target, objective, config)
    cells = engine_run["fidelity"][objective["id"]]
    scores = {tile["id"]: cells[tile["id"]].get("F") for tile in snapshot.candidates}
    order = _rank_order(scores)
    tiles = {tile["id"]: tile for tile in snapshot.candidates}
    n_sites = len(snapshot.candidates)
    reasons = _reasons(snapshot)
    target_sources = target.get("attr_sources", {})
    candidates = []
    rank = 0
    for aoi in order:
        tile = tiles[aoi]
        cell = cells[aoi]
        extra = _extra(snapshot, target, tile)
        checks = _constraints(objective, tile, extra)
        F = cell.get("F")
        eligible = F is not None
        if eligible:
            rank += 1
        parts = cell.get("parts")
        if parts is None:  # constraint failed / too much missing: probe parts for the explanation only
            parts = {}
            for spec in objective["attributes"]:
                probe = objective_fidelity({"attributes": [spec], "constraints": []},
                                           tile["attrs"], target["attrs"], extra)
                parts[spec["attr"]] = probe.get("parts", {}).get(spec["attr"])
        total_w = sum(float(spec.get("weight", 1)) for spec in objective["attributes"])
        known_w = sum(float(spec.get("weight", 1)) for spec in objective["attributes"]
                      if parts.get(spec["attr"]) is not None)
        attributes, missing, matching, mismatches = [], [], [], []
        climate = []
        for spec in objective["attributes"]:
            attr = spec["attr"]
            part = parts.get(attr)
            weight = float(spec.get("weight", 1))
            earth_value = None if attr == "light" else _value(tile, attr, extra)
            target_value = target["attrs"].get(attr) if spec.get("needs_target", False) else None
            contribution = (weight * math.log(max(part, 1e-6)) / known_w) if (part is not None and known_w) else None
            attributes.append({
                "attr": attr,
                "earth_value": earth_value if isinstance(earth_value, (int, float)) else None,
                "target_value": target_value if isinstance(target_value, (int, float)) else None,
                "fidelity": part, "weight": weight,
                "log_contribution": None if contribution is None else min(0.0, contribution),
                "target_source": target_sources.get(attr),
            })
            if part is None:
                side = []
                if earth_value is None:
                    side.append("Earth")
                if spec.get("needs_target", False) and target_value is None:
                    side.append("target")
                why = tile.get("missing_reasons", {}).get(attr)
                missing.append(f"{attr} ({' and '.join(side) or 'not computable'} value missing"
                               + (f"; {why}" if why else "") + ")")
            elif part >= config["match_threshold"]:
                matching.append(attr)
            elif part < config["mismatch_threshold"]:
                mismatches.append(attr)
            if attr in CLIMATE_ATTRS:
                climate.append(part)
        for check in checks:
            if check["passed"] is False:
                mismatches.append(f"constraint {check['attr']} {check['op']} {check['threshold']} failed "
                                  f"(value {check['value']:.3g})")
            elif check["passed"] is None:
                missing.append(f"{check['attr']} (constraint value missing)")

        if not climate:
            env = {"status": "not_applicable", "value": None,
                   "reason": "This objective uses no climate attributes"}
        elif any(value is None for value in climate):
            used = [a for a in CLIMATE_ATTRS if any(s["attr"] == a for s in objective["attributes"])]
            detail = "; ".join(tile["missing_reasons"][a] for a in used if a in tile.get("missing_reasons", {}))
            env = _not_available("Climate values missing (" + ", ".join(used) + ")"
                                 + (f": {detail}" if detail else ""))
        else:
            env = {"status": "computed", "provenance_class": prov,
                   "value": float(np.exp(np.mean(np.log(np.maximum(climate, 1e-6)))))}

        passed = [c["passed"] for c in checks]
        op_value = False if False in passed else (None if None in passed else True)
        stab_value = stab.get(aoi)
        explanation: dict[str, Any] = {"matching": matching, "mismatches": mismatches,
                       "attributes": attributes, "missing_fields": missing}
        if tile.get("environment") or tile.get("geology"):
            explanation["context"] = {
                "environment": {"evidence": "modelled", "values": tile.get("environment", {}),
                                "note": "2 m air temperature and POWER precipitation climatology; "
                                        "context only, not used in F"},
                "geology": {"evidence": "proxy", "values": tile.get("geology", {}),
                            "note": "geologic-map category at AOI centre; not mineralogy; context only"},
            }
        candidates.append({
            "rank": rank if eligible else None,
            "aoi_id": aoi,
            "name": tile.get("name", aoi),
            "country": tile.get("country"),
            "lon": tile["lon"], "lat": tile["lat"],
            "pool": tile.get("pool", ""),
            "site_id": tile.get("site_id"),
            "group_id": tile.get("group_id"),
            "coverage_level": tile.get("coverage_level"),
            "eligible": eligible,
            "ineligible_reason": None if eligible else cell.get("reason"),
            "components": {
                "deterministic_fidelity": {"status": "computed", "value": F, "provenance_class": prov,
                                           "reason": None if eligible else cell.get("reason"),
                                           "partial": bool(cell.get("partial", False))},
                "learned_similarity": _not_available(reasons["learned_similarity"]),
                "environmental_similarity": env,
                "geological_similarity": _not_available(reasons["geological_similarity"]),
                "operational_suitability": {"status": "computed", "value": op_value, "provenance_class": prov,
                                            "constraints": checks},
                "novelty": _not_available(reasons["novelty"]),
                "data_completeness": {"status": "computed", "provenance_class": prov,
                                      "value": round(known_w / total_w, 4) if total_w else None,
                                      "missing_fields": [m.split(" ")[0] for m in missing]},
                "ranking_stability": ({"status": "computed", "value": stab_value, "provenance_class": "simulated"}
                                      if stab_value else
                                      _not_available("Candidate never receives a score under perturbation")),
            },
            "explanation": explanation,
        })
    return {"candidates": candidates, "definitions": _component_definitions(snapshot, n_sites),
            "config": config}


def run_all(snapshot: Snapshot, config: dict | None = None) -> list[dict]:
    """All target × objective profiles for every template a target lists."""
    config = {**DEFAULT_CONFIG, **(config or {})}
    candidates_doc = {"tiles": snapshot.candidates}
    out = []
    for target_id in sorted(snapshot.targets):
        target = snapshot.targets[target_id]
        for template_id in target.get("templates", []):
            template = snapshot.templates.get(template_id)
            if template is None:
                snapshot.issues.append(f"{target_id}: unknown template {template_id}")
                continue
            engine_run = compute_run(candidates_doc, target, template, snapshot.sun, snapshot.params)
            for objective in template["objectives"]:
                ranked = rank_profile(snapshot, target, template, objective, engine_run, config)
                out.append({"target": target, "template": template, "objective": objective, **ranked})
    return out


def engine_matches_committed(snapshot: Snapshot, tol: float = 1e-9) -> bool | None:
    """True when recomputed F equals committed results.json F for every candidate."""
    if not snapshot.results:
        return None
    candidates_doc = {"tiles": snapshot.candidates}
    for run in snapshot.results["runs"]:
        target = snapshot.targets.get(run["target"])
        template = snapshot.templates.get(run["template"])
        if target is None or template is None:
            return False
        fresh = compute_run(candidates_doc, target, template, snapshot.sun, snapshot.params)
        for objective_id, cells in fresh["fidelity"].items():
            for aoi, cell in cells.items():
                committed = run["fidelity"].get(objective_id, {}).get(aoi, {}).get("F")
                if (cell.get("F") is None) != (committed is None):
                    return False
                if committed is not None and abs(cell["F"] - committed) > tol:
                    return False
    return True


__all__ = ["METHOD_NAME", "ML_VERSION", "ENGINE_VERSION", "DEFAULT_CONFIG", "run_all", "rank_profile",
           "stability", "engine_matches_committed"]
