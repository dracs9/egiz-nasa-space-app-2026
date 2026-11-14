"""Assemble the ATLAS-Pi bundle from the measured pilot data.

python -m pipeline.analog_transfer build      # writes data/pilot/atlas_pi.json
"""

from __future__ import annotations

import hashlib
import json
import resource
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import (
    ENGINE_VERSION,
    SCHEMA,
    SCHEMA_VERSION,
    constellation,
    counterfactual,
    evidence,
    planner,
    redteam,
)
from . import features as F
from .registry import config_hash, load
from .transfer import Context, certificate, compute_tensor, gather

ROOT = Path(__file__).resolve().parents[2]
PILOT = ROOT / "data/pilot"
INPUTS = ("mission_terrain.json", "earth_candidates.json", "targets.json", "results.json",
          "landcover_report.json", "atlas_solar.json", "atlas_discovery.json")


def discovery_summary(pilot: Path) -> dict | None:
    """Compact discovery section (Level-1 map + Level-2 candidates) if a discovery run exists."""
    path = pilot / "atlas_discovery.json"
    if not path.exists():
        return None
    d = json.loads(path.read_text())
    keep = ("id", "lon", "lat", "usable", "relief_m", "slope_p50", "slope_p90", "flat_fraction", "coarse_match",
            "flag", "unusual", "outlier_score", "terrain_family")
    return {k: d[k] for k in ("region", "screen_target", "method", "provenance", "failures", "screen_agreement",
                              "performance", "limitations", "generated_at")}  | {
        "level1_blocks": [{k: b.get(k) for k in keep} for b in d["level1_blocks"]],
        "candidates": [{k: c[k] for k in ("id", "lon", "lat", "recentred_deg", "terrain", "source", "nearest_catalog_site",
                                          "nearest_catalog_km", "category", "cells", "missing", "next_measurements")}
                       | {"coarse_match": c["level1"].get("coarse_match"), "unusual": c["level1"].get("unusual")}
                       for c in d["candidates"]]}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_context(pilot: Path = PILOT, n_boot: int = 200, solar_rebuild: bool = False) -> tuple[Context, dict]:
    reg = load()
    terrain = json.loads((pilot / "mission_terrain.json").read_text())
    cands = json.loads((pilot / "earth_candidates.json").read_text())
    targets = json.loads((pilot / "targets.json").read_text())
    results = json.loads((pilot / "results.json").read_text())
    if any(doc.get("synthetic") for doc in (terrain, cands, targets, results)):
        raise ValueError("ATLAS-Pi pilot build refuses synthetic inputs")
    entries = terrain["entries"]
    tiles = {t["id"]: t for t in cands["tiles"]}
    tmap = {t["id"]: t for t in targets["targets"]}
    descriptors = {e["id"]: F.describe(e, n_boot=n_boot) for e in entries}
    light = {}
    for run in results["runs"]:
        for oid, cells in run["fidelity"].items():
            for tid, cell in cells.items():
                if cell.get("parts") and "light" in cell["parts"]:
                    light[(run["target"], tid)] = cell["parts"]["light"]
    solar_doc = counterfactual.load_or_build_solar(pilot, [{k: e[k] for k in ("id", "body", "lat", "lon")} for e in entries], solar_rebuild)
    solar, solar_elev = {}, {}
    if solar_doc:
        for sid, s in solar_doc["sites"].items():
            solar[sid] = counterfactual.solar_profile(solar_doc, sid)
            elev = np.asarray(s["elevation_deg"], dtype=float)
            solar_elev[sid] = F.quantile_function(elev[elev > 0])
    ctx = Context(reg, descriptors, {k: v for k, v in tiles.items() if k in descriptors}, tmap, light, solar, solar_elev)
    meta = {"terrain": terrain, "candidates": cands, "targets": targets, "solar": solar_doc,
            "landcover": json.loads((pilot / "landcover_report.json").read_text())}
    return ctx, meta


def raw_cells(ctx: Context, sites: list[str], target: str) -> dict:
    cache, raw = {}, {}
    for task in ctx.registry.task_list(ctx.targets[target]["body"]):
        for s in sites:
            factors, physics, failed, unknown = gather(ctx, s, target, task, cache)
            raw[(s, task["id"])] = (task, factors, physics, failed, unknown)
    return raw


def tolerance_stability(ctx: Context, sites, targets, nominal_cells) -> dict:
    out = {}
    nominal = {(c["site"], c["target"], c["task"]): c["status"] for c in nominal_cells}
    variants = {}
    for scale in (0.5, 2.0):
        ctx.tolerance_scale = scale
        variants[scale] = {(c["site"], c["target"], c["task"]): c["status"] for c in compute_tensor(ctx, sites, targets)["cells"]}
    ctx.tolerance_scale = 1.0
    for key, status in nominal.items():
        out["|".join(key)] = {"nominal": status, "x0.5": variants[0.5][key], "x2": variants[2.0][key],
                              "stable": status == variants[0.5][key] == variants[2.0][key]}
    return out


def strip(obj):
    if isinstance(obj, dict):
        return {k: strip(v) for k, v in obj.items() if not k.startswith("_")}
    if isinstance(obj, list):
        return [strip(v) for v in obj]
    if isinstance(obj, (np.floating,)):
        return float(obj)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, float):
        return round(obj, 6)
    return obj


def build(pilot: Path = PILOT, out: Path | None = None, n_boot: int = 200, planner_draws: int = 150,
          with_evaluation: bool = True) -> dict:
    timings = {}
    t0 = time.perf_counter()
    ctx, meta = load_context(pilot, n_boot)
    timings["features_s"] = time.perf_counter() - t0
    reg = ctx.registry
    sites = sorted(ctx.tiles)
    targets = sorted(ctx.targets)
    t1 = time.perf_counter()
    tensor = compute_tensor(ctx, sites, targets)
    timings["tensor_s"] = time.perf_counter() - t1
    inputs = {name: sha256(pilot / name) for name in INPUTS if (pilot / name).exists()}
    inputs["config_sha256"] = config_hash()
    graph = evidence.build_graph(meta["terrain"]["entries"], meta["landcover"], meta["solar"], reg, tensor["cells"])
    certs = {}
    for c in tensor["cells"]:
        cert = certificate(c, reg.task(c["task"]), inputs, evidence.evidence_for(graph, c))
        c["certificate"] = cert["id"]
        certs[cert["id"]] = {k: cert[k] for k in ("id", "claim", "assumptions", "uncertainty", "evidence", "reproducibility")}
    t2 = time.perf_counter()
    stability = tolerance_stability(ctx, sites, targets, tensor["cells"])
    tags = {**{s: v["tags"] for s, v in reg.context["sites"].items()}}
    constellations, sens, plans = {}, {}, {}
    for mission in reg.tasks["missions"]:
        constellations[mission["id"]] = {
            str(k): constellation.design(tensor["cells"], mission, sites, tags, k=k, general=tensor["general_similarity"])
            for k in (1, 2, 3)}
        sens[mission["id"]] = constellation.sensitivity(tensor["cells"], mission, sites)
    timings["constellation_s"] = time.perf_counter() - t2
    t3 = time.perf_counter()
    for mission in reg.tasks["missions"]:
        plans[mission["id"]] = planner.plan(raw_cells(ctx, sites, mission["target"]), mission, sites, reg, draws=planner_draws)
    timings["planner_s"] = time.perf_counter() - t3
    cf = {"terramechanics": {b: counterfactual.terramechanics(b) for b in ("moon", "mars")}, "solar": {}}
    if meta["solar"]:
        for t in targets:
            for s in sites:
                cf["solar"][f"{s}|{t}"] = counterfactual.solar_counterfactual(meta["solar"], s, t)
        cf["solar_profiles"] = ctx.solar
    reviews = {}
    names = {t["id"]: t.get("name") or t["id"] for t in meta["candidates"]["tiles"]}
    for mission in reg.tasks["missions"]:
        cand = list(dict.fromkeys(constellations[mission["id"]]["3"]["selected"]
                                  + constellations[mission["id"]]["3"]["baseline_general_similarity"]["selected"]))
        reviews[mission["id"]] = [redteam.review(s, mission["target"], tensor["cells"], stability, plans[mission["id"]],
                                                 sens[mission["id"]], names.get(s, s)) for s in cand]
    evaluation = None
    if with_evaluation:
        from . import evaluation as ev
        t4 = time.perf_counter()
        evaluation = ev.run_all(ctx, tensor, constellations, sens, plans, stability, meta)
        timings["evaluation_s"] = time.perf_counter() - t4
    timings["total_s"] = time.perf_counter() - t0
    timings["peak_rss_mb"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 * 1024)
    site_rows = []
    for s in sites:
        tile = ctx.tiles[s]
        site_rows.append({"id": s, "name": tile.get("name"), "country": tile.get("country"), "pool": tile["pool"],
                          "lon": tile["lon"], "lat": tile["lat"], "context": tile.get("context"),
                          "process": reg.context["sites"].get(s), "terrain": F.summary(ctx.descriptors[s])})
    target_rows = [{"id": t, "name": ctx.targets[t]["name"], "body": ctx.targets[t]["body"], "lon": ctx.targets[t]["lon"],
                    "lat": ctx.targets[t]["lat"], "dem_product": ctx.targets[t]["dem_product"],
                    "process": reg.context["targets"].get(t), "terrain": F.summary(ctx.descriptors[t])} for t in targets]
    doc = {
        "schema": SCHEMA, "version": SCHEMA_VERSION, "synthetic": False,
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "engine": ENGINE_VERSION, "inputs": inputs,
        "parameters": {"bootstrap_replicates": n_boot, "block_m": F.BLOCK_M, "scales_m": list(F.SCALES),
                       "planner_draws": planner_draws, "seed": 20261113},
        "registry": {"tasks": reg.tasks, "physical": reg.physical, "measurements": reg.measurements, "context": reg.context},
        "sites": site_rows, "targets": target_rows,
        "tensor": tensor, "certificates": certs, "stability": stability,
        "constellations": constellations, "sensitivity": sens, "counterfactual": cf, "planner": plans,
        "redteam": reviews, "evidence_graph": graph.to_json(), "evaluation": evaluation,
        "discovery": discovery_summary(pilot),
        "performance": timings,
        "limitations": [
            "Nine purposive 20 km Earth windows and two planetary targets; not a global sample.",
            "Bootstrap intervals quantify spatial sampling within each window, not DEM vertical error.",
            "Tolerances, status thresholds, process compatibility and planner priors are declared assumptions, varied in sensitivity analysis.",
            "Temperature and precipitation were not acquired; tasks that need them are UNKNOWN.",
            "Counterfactual models are simplified, named scenario models; they are not validated planetary predictions.",
            "No field validation of any recommendation has been performed.",
        ],
    }
    doc = strip(doc)
    content = {k: v for k, v in doc.items() if k not in ("generated_at", "performance")}
    doc["content_sha256"] = hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    # Rendered dossiers cite the content hash, so they are derived after it and excluded from it.
    from .dossier import render
    doc["dossiers"] = {f"{s}|{t}": render(doc, s, t) for t in targets for s in sites}
    if out is not False:
        path = out or pilot / "atlas_pi.json"
        path.write_text(json.dumps(doc, separators=(",", ":")) + "\n")
    return doc
