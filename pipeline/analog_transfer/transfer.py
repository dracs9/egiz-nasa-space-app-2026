"""Operational Transferability Tensor T[site, target, task, factor].

Similarity, evidence coverage, evidence quality, resolution sufficiency and
physical transferability are computed and reported as separate axes. A status
(SUPPORTED / CONDITIONAL / WEAK / NON_TRANSFERABLE / UNKNOWN) is assigned by the
documented rules in config/tasks.json; it is never a weighted blend of the axes.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass, field

import numpy as np

from . import ENGINE_VERSION
from .features import SCALES, Descriptors, wasserstein1
from .registry import Registry

STATUSES = ("SUPPORTED", "CONDITIONAL", "WEAK", "NON_TRANSFERABLE", "UNKNOWN")
QUALITY = {"observed": 1.0, "retrieved": 1.0, "derived": 0.9, "model": 0.7, "assumed": 0.5, "unknown": 0.0}
KIND_ORDER = ["unknown", "assumed", "curated", "model", "derived", "retrieved", "observed"]
FINE_ATTR = {"moon": ("slope_f100_p90_deg", 50), "mars": ("slope_f400_p90_deg", 200)}


def gauss(z: float) -> float:
    return math.exp(-0.5 * z * z)


def weakest(*kinds: str) -> str:
    return min(kinds, key=KIND_ORDER.index)


@dataclass
class Context:
    """Everything the tensor needs; built from the pilot bundle or from test fixtures."""
    registry: Registry
    descriptors: dict          # id -> Descriptors (Earth sites and targets)
    tiles: dict                # Earth id -> earth_candidates tile
    targets: dict              # target id -> targets.json target
    light: dict = field(default_factory=dict)        # (target, site) -> light fidelity or None
    solar: dict = field(default_factory=dict)        # id -> solar_profile dict
    solar_elev: dict = field(default_factory=dict)   # id -> daylight elevation quantile fn
    tolerance_scale: float = 1.0
    process_mismatch: float | None = None


# ------------------------------------------------------------ factor values

def _boot_match(d_e: Descriptors, d_t: Descriptors, fn) -> list[float]:
    return [fn(be, bt) for be, bt in zip(d_e.boot, d_t.boot)]


def _ci(values: list[float]) -> list[float]:
    arr = np.asarray(values, dtype=float)
    return [float(np.quantile(arr, 0.05)), float(np.quantile(arr, 0.95))]


def factor_value(ctx: Context, site_id: str, target_id: str, factor: str) -> dict:
    """Return a factor record: match (or None), bootstrap replicates, evidence kinds."""
    reg = ctx.registry
    spec = reg.factors[factor]
    tol = (spec["tolerance"] or 1.0) * ctx.tolerance_scale
    target = ctx.targets[target_id]
    tile = ctx.tiles[site_id]
    body = target["body"]
    d_e, d_t = ctx.descriptors.get(site_id), ctx.descriptors.get(target_id)
    rec = {"factor": factor, "name": spec["name"], "metric": spec["metric"], "tolerance": tol,
           "unit": spec["unit"], "match": None, "boot": None, "earth": None, "target": None,
           "kind": "unknown", "effective_resolution_m": None, "detail": {}}

    def grid_side(value_e, value_t, unit):
        assert d_e is not None and d_t is not None  # only called once both are measured
        src_e = f"computed:{site_id} Copernicus DEM GLO-30 -> 200 m cells"
        src_t = f"computed:{target_id} {target['dem_product']} -> 200 m cells"
        rec["earth"] = {"value": value_e, "unit": unit, "kind": "derived", "source": src_e}
        rec["target"] = {"value": value_t, "unit": unit, "kind": "derived", "source": src_t}
        rec["kind"] = "derived"
        rec["effective_resolution_m"] = max(200.0, d_e.source_pixel_m, d_t.source_pixel_m)

    if factor == "slope_dist" and d_e and d_t:
        per_scale = {}
        for s in SCALES:
            w = wasserstein1(d_e.point[f"q_slope_{s}"], d_t.point[f"q_slope_{s}"])
            per_scale[str(s)] = {"w1_deg": w, "match": gauss(w / tol)}
        rec["match"] = float(np.exp(np.mean([math.log(max(v["match"], 1e-9)) for v in per_scale.values()])))

        def fn(be, bt):
            ms = [gauss(wasserstein1(be[f"q_slope_{s}"], bt[f"q_slope_{s}"]) / tol) for s in SCALES]
            return float(np.exp(np.mean(np.log(np.maximum(ms, 1e-9)))))
        rec["boot"] = _boot_match(d_e, d_t, fn)
        rec["detail"] = {"per_scale": per_scale,
                         "scale_spread": max(v["match"] for v in per_scale.values()) - min(v["match"] for v in per_scale.values())}
        grid_side(float(d_e.point["q_slope_200"][256]), float(d_t.point["q_slope_200"][256]), "deg (median, 200 m)")
    elif factor == "traversable" and d_e and d_t:
        rec["match"] = gauss(abs(d_e.point["traversable"] - d_t.point["traversable"]) / tol)
        rec["boot"] = _boot_match(d_e, d_t, lambda be, bt: gauss(abs(be["traversable"] - bt["traversable"]) / tol))
        grid_side(d_e.point["traversable"], d_t.point["traversable"], "fraction")
    elif factor == "roughness" and d_e and d_t:
        rec["match"] = gauss(wasserstein1(d_e.point["q_roughness"], d_t.point["q_roughness"]) / tol)
        rec["boot"] = _boot_match(d_e, d_t, lambda be, bt: gauss(wasserstein1(be["q_roughness"], bt["q_roughness"]) / tol))
        grid_side(float(d_e.point["q_roughness"][256]), float(d_t.point["q_roughness"][256]), "log10 m (median)")
        rec["effective_resolution_m"] = 600.0  # 3x3 windows of 200 m cells
    elif factor == "relief" and d_e and d_t:
        def lr(a, b):
            return abs(math.log10(max(a, 1.0) / max(b, 1.0)))
        rec["match"] = gauss(lr(d_e.point["relief_m"], d_t.point["relief_m"]) / tol)
        rec["boot"] = _boot_match(d_e, d_t, lambda be, bt: gauss(lr(be["relief_m"], bt["relief_m"]) / tol))
        grid_side(d_e.point["relief_m"], d_t.point["relief_m"], "m (P95-P5)")
    elif factor == "fine_slope":
        attr, pixel = FINE_ATTR[body]
        ve, vt = tile["attrs"].get(attr), target["attrs"].get(attr)
        rec["earth"] = {"value": ve, "unit": "deg", "kind": "derived" if ve is not None else "unknown",
                        "source": f"earth_candidates.json attrs.{attr}"}
        rec["target"] = {"value": vt, "unit": "deg", "kind": "derived" if vt is not None else "unknown",
                         "source": target["attr_sources"].get(attr, "missing")}
        if ve is not None and vt is not None:
            rec["match"] = gauss(abs(ve - vt) / tol)
            rec["kind"] = "derived"
            rec["effective_resolution_m"] = float(pixel)
            rec["detail"] = {"note": "No sampling-uncertainty estimate; bootstrap interval collapses to the point value."}
    elif factor == "surface_cover":
        ve = tile["attrs"].get("bare_frac")
        rec["earth"] = {"value": ve, "unit": "fraction", "kind": "observed" if ve is not None else "unknown",
                        "source": "ESA WorldCover 2021 v200 (landcover_report.json)"}
        rec["target"] = {"value": 1.0, "unit": "fraction", "kind": "assumed",
                         "source": target["attr_sources"].get("bare_frac", "definition:EGIZ_METHOD")}
        if ve is not None:
            rec["match"] = gauss(max(0.0, 0.8 - ve) / tol)
            rec["kind"] = "assumed"
            rec["effective_resolution_m"] = 10.0
    elif factor == "process":
        ctx_sites, ctx_targets = reg.context["sites"], reg.context["targets"]
        se, st = ctx_sites.get(site_id), ctx_targets.get(target_id)
        if se and st:
            shared = sorted(set(se["tags"]) & set(st["tags"]))
            comp = reg.context["compatibility"]
            low = ctx.process_mismatch if ctx.process_mismatch is not None else comp["no_shared_tag"]
            rec["match"] = comp["shared_tag"] if shared else low
            rec["kind"] = "curated"
            grade_q = reg.context["grade_quality"]
            rec["earth"] = {"value": se["tags"], "unit": "tags", "kind": "curated", "grade": se["grade"],
                            "quality": grade_q[se["grade"]], "source": se["source"]}
            rec["target"] = {"value": st["tags"], "unit": "tags", "kind": "curated", "grade": st["grade"],
                             "quality": grade_q[st["grade"]], "source": st["source"]}
            rec["detail"] = {"shared_tags": shared}
    elif factor == "illumination_geometry":
        if body == "moon":
            light = ctx.light.get((target_id, site_id))
            rec["target"] = {"value": target.get("h_max_deg"), "unit": "deg (max solar elevation)", "kind": "derived",
                             "source": "sun_windows.json (NOAA solar geometry)"}
            rec["earth"] = {"value": light, "unit": "light fidelity", "kind": "derived" if light is not None else "unknown",
                            "source": "results.json O4 parts.light (existing EGIZ low-Sun model, NOAA)"}
            if light is not None:
                rec["match"] = float(light)
                rec["kind"] = "derived"
                rec["detail"] = {"note": "Existing EGIZ monthly low-Sun window fidelity; snow availability not modelled."}
        else:
            qe, qt = ctx.solar_elev.get(site_id), ctx.solar_elev.get(target_id)
            if qe is not None and qt is not None:
                w = wasserstein1(qe, qt)
                rec["match"] = gauss(w / tol)
                rec["kind"] = "derived"
                rec["earth"] = {"value": float(np.median(qe)), "unit": "deg (median daylight elevation)", "kind": "derived",
                                "source": "atlas_solar.json (NASA SPICE, 12 monthly days)"}
                rec["target"] = {"value": float(np.median(qt)), "unit": "deg (median daylight elevation)", "kind": "derived",
                                 "source": "atlas_solar.json (NASA SPICE, 12 epochs over a Mars year)"}
                rec["detail"] = {"w1_deg": w}
    elif factor == "irradiance":
        pe, pt = ctx.solar.get(site_id), ctx.solar.get(target_id)
        if pe and pt and pe["mean_tracking_irradiance_wm2"] > 0 and pt["mean_tracking_irradiance_wm2"] > 0:
            ratio = pe["mean_tracking_irradiance_wm2"] / pt["mean_tracking_irradiance_wm2"]
            rec["match"] = gauss(abs(math.log10(ratio)) / tol)
            rec["kind"] = "model"
            rec["earth"] = {"value": pe["mean_tracking_irradiance_wm2"], "unit": "W/m^2 (mean, Sun-tracking, clear sky)",
                            "kind": "model", "source": "CF_SOLAR Earth clear-sky DNI on SPICE geometry"}
            rec["target"] = {"value": pt["mean_tracking_irradiance_wm2"], "unit": "W/m^2 (mean, Sun-tracking)",
                             "kind": "model" if body == "mars" else "derived",
                             "source": "CF_SOLAR " + ("Beer-Lambert, assumed tau" if body == "mars" else "vacuum") + " on SPICE geometry"}
            rec["detail"] = {"ratio_earth_to_target": ratio}
    elif factor == "thermal":
        ve, vt = tile["attrs"].get("t_min_c"), target["attrs"].get("t_min_c")
        rec["earth"] = {"value": ve, "unit": "degC", "kind": "observed" if ve is not None else "unknown",
                        "source": "earth_candidates.json attrs.t_min_c" + ("" if ve is not None else " (not acquired)")}
        rec["target"] = {"value": vt, "unit": "degC", "kind": "retrieved" if vt is not None else "unknown",
                         "source": "targets.json attrs.t_min_c" + ("" if vt is not None else " (intentionally blank)")}
        if ve is not None and vt is not None:
            rec["match"] = gauss(max(0.0, ve - vt) / tol)
            rec["kind"] = "observed"
    elif factor == "aridity":
        ve = tile["attrs"].get("precip_mm")
        rec["earth"] = {"value": ve, "unit": "mm/yr", "kind": "observed" if ve is not None else "unknown",
                        "source": "earth_candidates.json attrs.precip_mm" + ("" if ve is not None else " (not acquired)")}
        rec["target"] = {"value": 0, "unit": "mm/yr", "kind": "assumed", "source": "definition:EGIZ_METHOD"}
        if ve is not None:
            rec["match"] = gauss(max(0.0, ve - 50.0) / tol)
            rec["kind"] = "assumed"
    if rec["match"] is not None and rec["boot"] is None:
        rec["boot"] = [rec["match"]] * len(next(iter(ctx.descriptors.values())).boot)
    if rec["match"] is not None:
        rec["ci"] = _ci(rec["boot"])
        if factor == "process":
            rec["quality"] = min(rec["earth"]["quality"], rec["target"]["quality"])
        else:
            rec["quality"] = min(QUALITY[rec["earth"]["kind"]], QUALITY[rec["target"]["kind"]])
    else:
        rec["ci"] = None
        rec["quality"] = 0.0
    return rec


# ------------------------------------------------------------ task cells

def _constraints(reg: Registry, tile: dict) -> tuple[list[dict], list[str]]:
    failed, unknown = [], []
    for c in reg.tasks["constraints"]:
        value = tile.get("context", {}).get(c["attr"])
        if value is None:
            unknown.append(c["attr"])
            continue
        if (c["op"] == "<=" and value > c["value"]) or (c["op"] == ">=" and value < c["value"]):
            failed.append({**c, "observed": value})
    return failed, unknown


def _physics(reg: Registry, task: dict, body: str) -> list[dict]:
    out = []
    for dep, role in task["physics"].items():
        f = reg.physical_factor(dep)
        earth_v, target_v = f["values"]["earth"], f["values"][body]
        out.append({"factor": dep, "name": f["name"], "role": role,
                    "reproducible_in_field": f["reproducible_in_field"],
                    "corrections": f["corrections"], "correction_scope": f.get("correction_scope"),
                    "lab_alternatives": f["lab_alternatives"],
                    "earth": earth_v, "target": target_v})
    return out


def gather(ctx: Context, site_id: str, target_id: str, task: dict, cache: dict) -> tuple[list[dict], list[dict], list[dict], list[str]]:
    """Collect factor records (with bootstrap replicates), physics and constraint results."""
    body = ctx.targets[target_id]["body"]
    factors = []
    for spec in task["factors"]:
        key = (site_id, target_id, spec["factor"])
        if key not in cache:
            cache[key] = factor_value(ctx, site_id, target_id, spec["factor"])
        factors.append({**cache[key], "role": spec["role"], "weight": spec["weight"]})
    failed, unknown_ctx = _constraints(ctx.registry, ctx.tiles[site_id])
    return factors, _physics(ctx.registry, task, body), failed, unknown_ctx


def task_cell(ctx: Context, site_id: str, target_id: str, task: dict, cache: dict | None = None) -> dict:
    cache = cache if cache is not None else {}
    factors, physics, failed, unknown_ctx = gather(ctx, site_id, target_id, task, cache)
    return assess(ctx.registry.rules, task, factors, physics, failed, unknown_ctx, site_id, target_id)


def assess(rules: dict, task: dict, factors: list[dict], physics: list[dict], failed: list[dict],
           unknown_ctx: list[str], site_id: str, target_id: str) -> dict:
    """Pure status assessment from factor records; used by the tensor and the planner."""
    total = sum(f["weight"] for f in factors)
    known = [f for f in factors if f["match"] is not None]
    coverage = sum(f["weight"] for f in known) / total
    quality = (sum(f["weight"] * f["quality"] for f in known) / sum(f["weight"] for f in known)) if known else 0.0
    if known:
        wk = np.array([f["weight"] for f in known], dtype=float)
        logs = np.log(np.maximum([f["match"] for f in known], 1e-9))
        point = float(np.exp((wk * logs).sum() / wk.sum()))
        boots = np.log(np.maximum(np.array([f["boot"] for f in known]), 1e-9))
        reps = np.exp((wk[:, None] * boots).sum(axis=0) / wk.sum())
        ci = [float(np.quantile(reps, 0.05)), float(np.quantile(reps, 0.95))]
    else:
        point, ci = None, None
    primary_blocking = [p for p in physics if p["role"] == "primary"
                        and p["reproducible_in_field"] == "no" and not p["corrections"]]
    primary_caveat = [p for p in physics if p["role"] == "primary" and p not in primary_blocking]
    secondary = [p for p in physics if p["role"] == "secondary"]
    res_limited = [f["factor"] for f in factors if f["role"] == "primary" and f["effective_resolution_m"]
                   and f["effective_resolution_m"] > task["required_resolution_m"]]
    relevance = sum(f["weight"] for f in known if f["role"] == "primary" and f["match"] >= rules["supported_lower_bound"]) \
        / max(1e-9, sum(f["weight"] for f in factors if f["role"] == "primary"))

    reasons = []
    if failed:
        status = "NON_TRANSFERABLE"
        reasons.append("SITE_CONSTRAINT")
    elif primary_blocking:
        status = "NON_TRANSFERABLE"
        reasons.append("PHYSICS_PRIMARY")
    elif coverage + 1e-12 < task["min_evidence"] or point is None or ci is None:
        status = "UNKNOWN"
        reasons.append("EVIDENCE")
    elif (ci[0] >= rules["supported_lower_bound"] and quality >= rules["supported_min_quality"]
          and not res_limited and not primary_caveat):
        status = "SUPPORTED"
    elif point >= rules["conditional_point"]:
        status = "CONDITIONAL"
        if ci[0] < rules["supported_lower_bound"]:
            reasons.append("CI_BELOW_THRESHOLD")
        if quality < rules["supported_min_quality"]:
            reasons.append("LOW_EVIDENCE_QUALITY")
        if res_limited:
            reasons.append("RESOLUTION")
        if primary_caveat:
            reasons.append("PHYSICS_CORRECTION")
    else:
        status = "WEAK"
        reasons.append("LOW_MATCH")
    cell = {
        "site": site_id, "target": target_id, "task": task["id"], "status": status, "reasons": reasons,
        "axes": {
            "task_match": point, "task_match_ci90": ci,
            "evidence_coverage": coverage, "evidence_quality": quality,
            "resolution_sufficient": not res_limited, "resolution_limited_factors": res_limited,
            "operational_relevance": relevance,
            "physical_mismatch": [p["factor"] for p in physics if p["reproducible_in_field"] != "yes"],
        },
        "factors": [{k: v for k, v in f.items() if k != "boot"} for f in factors],
        "physics": physics, "constraints": {"failed": failed, "unknown": unknown_ctx},
        "limitations": list(task.get("limitations", [])) + [
            f"Secondary physical dependency not reproduced: {p['name']}." for p in secondary
            if p["reproducible_in_field"] != "yes"],
    }
    cell["explanation"] = explain(cell, task)
    cell["counter_evidence"] = counter_evidence(cell)
    return cell


def explain(cell: dict, task: dict) -> list[str]:
    axes = cell["axes"]
    lines = []
    s = cell["status"]
    if "SITE_CONSTRAINT" in cell["reasons"]:
        f = cell["constraints"]["failed"][0]
        lines.append(f"Site constraint fails: {f['attr']} = {f['observed']:.3f} (limit {f['op']} {f['value']}).")
    if "PHYSICS_PRIMARY" in cell["reasons"]:
        names = [p["name"] for p in cell["physics"] if p["role"] == "primary" and p["reproducible_in_field"] == "no" and not p["corrections"]]
        lines.append(f"{task['name']} depends primarily on {', '.join(names)}, which no open-air Earth site reproduces and no correction model covers.")
    if axes["task_match"] is not None:
        lo, hi = axes["task_match_ci90"]
        lines.append(f"Task-weighted factor match {axes['task_match']:.2f} (90% block-bootstrap interval {lo:.2f}-{hi:.2f}); evidence coverage {axes['evidence_coverage']:.0%}, evidence quality {axes['evidence_quality']:.2f}.")
    known = [f for f in cell["factors"] if f["match"] is not None]
    if known:
        best = max(known, key=lambda f: f["match"] * f["weight"])
        worst = min(known, key=lambda f: f["match"])
        lines.append(f"Strongest factor: {best['name']} ({best['match']:.2f}); weakest: {worst['name']} ({worst['match']:.2f}).")
    missing = [f["name"] for f in cell["factors"] if f["match"] is None]
    if missing:
        lines.append(f"Missing evidence: {', '.join(missing)}.")
    if "RESOLUTION" in cell["reasons"]:
        lines.append(f"Primary factors {', '.join(axes['resolution_limited_factors'])} are coarser than the {task['required_resolution_m']} m the task requires.")
    if "LOW_EVIDENCE_QUALITY" in cell["reasons"]:
        lines.append(f"Evidence quality {axes['evidence_quality']:.2f} is below the level required for SUPPORTED (unverified or assumed inputs).")
    if "PHYSICS_CORRECTION" in cell["reasons"]:
        names = [p["name"] for p in cell["physics"] if p["role"] == "primary"]
        lines.append(f"Transfer requires correction for {', '.join(names)} (partial reproduction or named counterfactual model only).")
    if s == "SUPPORTED":
        lines.append("The lower bound of the task match lies within one declared tolerance and no primary physical caveat applies.")
    return lines


def counter_evidence(cell: dict) -> list[str]:
    out = []
    for f in cell["factors"]:
        if f["match"] is not None and f["match"] < 0.1353:
            out.append(f"{f['name']} differs by more than two tolerances (match {f['match']:.3f}).")
        if f["match"] is not None and f.get("kind") == "assumed":
            out.append(f"{f['name']} relies on an assumed/definitional value on at least one side.")
        if f["factor"] == "process" and f["match"] is not None and not f["detail"].get("shared_tags"):
            out.append("No shared geological process: morphometric similarity may be convergent rather than genetic.")
        if f.get("detail", {}).get("scale_spread", 0) > 0.3:
            out.append(f"{f['name']} match changes strongly across 200-800 m scales (spread {f['detail']['scale_spread']:.2f}).")
    for p in cell["physics"]:
        if p["reproducible_in_field"] != "yes":
            out.append(f"{p['name']} ({p['role']}) is {'not' if p['reproducible_in_field'] == 'no' else 'only partially'} reproduced in the field.")
    return out


# ------------------------------------------------------------ tensor + certificates

def general_similarity(cell_factors: dict) -> float | None:
    """Unconditioned baseline: equal-weight geometric mean of all terrain factor matches."""
    vals = [v["match"] for k, v in cell_factors.items()
            if k in ("slope_dist", "traversable", "roughness", "relief", "fine_slope") and v["match"] is not None]
    if not vals:
        return None
    return float(np.exp(np.mean(np.log(np.maximum(vals, 1e-9)))))


def compute_tensor(ctx: Context, site_ids: list[str], target_ids: list[str]) -> dict:
    cells, cache = [], {}
    for t in target_ids:
        body = ctx.targets[t]["body"]
        for s in site_ids:
            for task in ctx.registry.task_list(body):
                cells.append(task_cell(ctx, s, t, task, cache))
    baseline = {}
    for t in target_ids:
        for s in site_ids:
            fs = {f: cache[(s, t, f)] for (s2, t2, f) in cache if s2 == s and t2 == t}
            for f in ("slope_dist", "traversable", "roughness", "relief", "fine_slope"):
                if f not in fs:
                    fs[f] = cache.setdefault((s, t, f), factor_value(ctx, s, t, f))
            baseline[f"{s}|{t}"] = general_similarity(fs)
    return {"cells": cells, "general_similarity": baseline}


def canonical(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=float)


def certificate(cell: dict, task: dict, inputs: dict, evidence_ids: list[str]) -> dict:
    claim = {
        "SUPPORTED": "can support", "CONDITIONAL": "can conditionally support",
        "WEAK": "provides weak support for", "NON_TRANSFERABLE": "cannot directly support",
        "UNKNOWN": "has insufficient evidence to assess",
    }[cell["status"]]
    body = {
        "claim": f"{cell['site']} {claim} '{task['name']}' for {cell['target']}.",
        "status": cell["status"], "reasons": cell["reasons"],
        "site": cell["site"], "target": cell["target"], "task": task["id"],
        "axes": cell["axes"],
        "supporting_observations": [
            {"factor": f["factor"], "earth": f["earth"], "target": f["target"], "match": f["match"], "ci90": f["ci"], "kind": f["kind"]}
            for f in cell["factors"] if f["match"] is not None],
        "assumptions": sorted({f"{f['name']}: {side['source']}" for f in cell["factors"]
                               for side in (f["earth"], f["target"]) if side and side.get("kind") == "assumed"})
                       + [f"Tolerance for {f['name']}: {f['tolerance']} {f['unit'] or ''} (declared)" for f in cell["factors"] if f["tolerance"]],
        "uncertainty": "90% spatial block-bootstrap interval of the task match (4 km blocks, 200 replicates); excludes DEM vertical error.",
        "known_limitations": cell["limitations"],
        "counter_evidence": cell["counter_evidence"],
        "evidence": evidence_ids,
        "reproducibility": {"engine": ENGINE_VERSION, "inputs": inputs,
                            "command": "python -m pipeline.analog_transfer build"},
    }
    body["id"] = "CERT-" + hashlib.sha256(canonical(body).encode()).hexdigest()[:16]
    return body
