"""Coarse-to-fine refinement around Kazakhstan windows that rank well for Mars targets.

The challenge notes that a small area inside a large region can match better than the
region as a whole. Around every Kazakhstan window in the Earth-wide top 100 of any Mars
target, a ~20 km lattice (8 neighbours at +-20 km) is acquired with the SAME geodata stages
and scored with the SAME similarity code.

Kept strictly apart from the committed Earth-wide bundle so no existing number moves:

* records go to data/derived/<REFINE_VERSION>/ and data/discovery/regions/kz/index/
  (the Earth-wide index is untouched)
* refinement windows are scored in a separate run over (Earth-wide windows + refinement
  windows) with the population mask False for refinement windows, so percentiles and the
  normalisation are the Earth-wide lattice ones; discovery.json is not modified
* output: data/discovery/regions/kz.json

python -m pipeline.discovery refine-plan      # seeds from the committed bundle (no network)
python -m pipeline.discovery refine-acquire   # public COGs / APIs, same stages as the index
python -m pipeline.discovery refine-index
python -m pipeline.discovery refine-build
"""
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone

import numpy as np

from pipeline.discovery import OUT, ROOT
from pipeline.discovery import rank as R
from pipeline.geodata.aois import AOI, earth_group

REFINE_VERSION = "egiz-kz-refine-1.0.0"
REFINE_DERIVED = ROOT / "data" / "derived" / REFINE_VERSION
REGION_DIR = OUT / "regions" / "kz"
SEEDS = REGION_DIR / "seeds.json"
REGION_OUT = OUT / "regions" / "kz.json"
STEP_KM = 20.0
TOP_K = 100
POOL = "kz_refine"


def _arr(x) -> np.ndarray:
    return np.array([np.nan if v is None else v for v in x], float)


def plan_seeds(top_k: int = TOP_K) -> dict:
    """Kazakhstan windows in the Earth-wide top-k of any Mars target (general profile), from the committed bundle."""
    b = json.loads((OUT / "discovery.json").read_text(encoding="utf-8"))
    W = b["windows"]
    weights = R.PROFILES["general"]["weights"]
    seeds: dict[str, dict] = {}
    for t in b["targets"]:
        if t["body"] != "mars":
            continue
        sh = json.loads((OUT / t["shard"]).read_text(encoding="utf-8"))
        dims = {d: (_arr(sh["s50"][k]), _arr(sh["lo"][k]), _arr(sh["hi"][k]), np.array(sh["status"][k]))
                for k, d in enumerate(sh["dims"])}
        agg = R.aggregate(dims, weights)
        order = np.argsort(-agg["score"], kind="stable")
        for r, i in enumerate(order[:top_k], 1):
            if W["country"][i] != "KAZ":
                continue
            s = seeds.setdefault(W["id"][i], {"window": W["id"][i], "lon": W["lon"][i], "lat": W["lat"][i], "ranks": {}})
            s["ranks"][t["id"]] = {"rank": r, "score": round(float(agg["score"][i]), 4)}
    doc = {"schema": "egiz.kz_refine_seeds", "bundle_sha256": b["content_sha256"], "top_k": top_k, "profile": "general",
           "step_km": STEP_KM, "seeds": sorted(seeds.values(), key=lambda s: s["window"])}
    REGION_DIR.mkdir(parents=True, exist_ok=True)
    SEEDS.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8", newline="\n")
    return doc


def refine_aois(seeds: list[dict], step_km: float = STEP_KM) -> list[AOI]:
    """8 neighbours at +-step_km (east/north) around each seed; seeds themselves are already in the index."""
    from pipeline.discovery.sites import cell_id
    out, seen = [], set()
    for s in seeds:
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == dy == 0:
                    continue
                lat = s["lat"] + dy * step_km / 111.195
                lon = s["lon"] + dx * step_km / (111.195 * math.cos(math.radians(s["lat"])))
                lo, la = round(lon, 3), round(lat, 3)
                aid = cell_id("KZR", lo, la)
                if aid in seen:
                    continue
                seen.add(aid)
                out.append(AOI(aid, "SITE_" + aid, earth_group(lo, la), "earth", f"Kazakhstan refinement cell near {s['window']}",
                               "Kazakhstan refinement lattice", lo, la, POOL, "KAZ",
                               notes=[f"{step_km:g} km refinement around {s['window']} (offset {dx:+d},{dy:+d})",
                                      f"parent={s['window']}"]))
    return out


def acquire(workers: int = 6) -> dict:
    from pipeline.discovery.acquire import run
    seeds = json.loads(SEEDS.read_text(encoding="utf-8"))["seeds"]
    return run(refine_aois(seeds), workers=workers, derived=REFINE_DERIVED)


def compile_region_index() -> dict:
    from pipeline.discovery.index import compile_index
    return compile_index(REFINE_DERIVED, REGION_DIR / "index")


def build(draws: int | None = None) -> str:
    from pipeline.discovery import dimensions as D
    from pipeline.discovery.bundle import _dims_tuple, population_mask
    from pipeline.discovery.fingerprint import earth_windows, load_targets, load_windows
    from pipeline.discovery.gaps import gap_ledger
    from pipeline.discovery.rover import rover_experiment
    from pipeline.discovery.similarity import EarthTable

    bundle = json.loads((OUT / "discovery.json").read_text(encoding="utf-8"))
    draws = draws or bundle["inputs"]["draws"]
    seed = bundle["inputs"]["seed"]
    seeds = json.loads(SEEDS.read_text(encoding="utf-8"))
    parent_of = {}
    for a in refine_aois(seeds["seeds"]):
        parent_of[a.aoi_id] = next(n.split("=", 1)[1] for n in a.notes if n.startswith("parent="))
    windows = load_windows()
    targets = [t for t in load_targets(windows) if t.body == "mars"]
    E = earth_windows(windows)
    pop_main, pop_note = population_mask(E)
    region_windows = [w for w in load_windows(index_dir=REGION_DIR / "index") if w.pool == POOL]
    Rw = [w for w in earth_windows(region_windows)]
    excluded = sorted({w.id for w in region_windows} - {w.id for w in Rw})
    combined = E + Rw
    pop = np.r_[pop_main, np.zeros(len(Rw), bool)]
    n_main = len(E)
    idx = {w.id: i for i, w in enumerate(combined)}
    table = EarthTable(combined)
    weights = R.PROFILES["general"]["weights"]
    out_targets = []
    for t in targets:
        res = R.score_target(table, t, pop, draws, seed)
        for r in res.values():
            r.s50, r.lo, r.hi = (np.round(a, 4) for a in (r.s50, r.lo, r.hi))
        agg = R.aggregate(_dims_tuple(res), weights)
        score_pct = R.population_percentile(agg["score"], pop)
        pct = {d: R.population_percentile(res[d].s50, pop) for d in res}
        main_scores = agg["score"][:n_main]

        def would_be_rank(i: int) -> int:  # 1 + Earth-wide windows (same run) scoring strictly higher
            return int(np.sum(main_scores > agg["score"][i])) + 1

        def entry(i: int) -> dict:
            w = combined[i]
            return {"window": w.id, "lon": round(w.lon, 4), "lat": round(w.lat, 4), "score": round(float(agg["score"][i]), 4),
                    "fidelity": round(float(agg["fidelity"][i]), 4), "lo": round(float(agg["lo"][i]), 4),
                    "hi": round(float(agg["hi"][i]), 4), "coverage": round(float(agg["coverage"][i]), 4),
                    "category": str(agg["category"][i]), "score_percentile": round(float(score_pct[i]), 2),
                    "rank_among_earth_windows": would_be_rank(i),
                    "dims": {d: {"s50": None if not np.isfinite(res[d].s50[i]) else float(res[d].s50[i]),
                                 "lo": None if not np.isfinite(res[d].lo[i]) else float(res[d].lo[i]),
                                 "hi": None if not np.isfinite(res[d].hi[i]) else float(res[d].hi[i]),
                                 "status": R.STATUS[res[d].status[i]],
                                 "percentile": None if not np.isfinite(pct[d][i]) else round(float(pct[d][i]), 1),
                                 "label": D.DIM_BY_ID[d].label} for d in res}}
        seeds_out = []
        for s in seeds["seeds"]:
            if s["window"] not in idx:
                continue
            si = idx[s["window"]]
            kids = [idx[a] for a, p in parent_of.items() if p == s["window"] and a in idx]
            best = max(kids, key=lambda i: agg["score"][i]) if kids else None
            seeds_out.append({"seed": entry(si), "n_refined": len(kids),
                              "refined": sorted((entry(i) for i in kids), key=lambda e: -e["score"]),
                              "best_refined_beats_seed": bool(best is not None and agg["score"][best] > agg["score"][si])})
        region_idx = list(range(n_main, len(combined)))
        top = sorted(region_idx + [idx[s["window"]] for s in seeds["seeds"] if s["window"] in idx],
                     key=lambda i: -agg["score"][i])[:10]
        top_entries = []
        for i in top:
            e = entry(i)
            w = combined[i]
            e["pool"] = w.pool
            e["parent"] = parent_of.get(w.id)
            e["gaps"] = gap_ledger(t, w, res["terrain_fine"].detail["w1_deg"][i])
            e["rover"] = rover_experiment(w, t.body)
            e["context"] = {k: w.context.get(k) for k in ("country_iso", "volcano_km", "volcano_name", "impact_km", "impact_name")}
            e["features"] = {k: w.f(k) for k in ("elev_p50_m", "bare_frac", "precip_annual_mm", "t2m_min_coldest_month_c",
                                                 "t2m_max_warmest_month_c", "slope_f100_p50_deg", "slope_f100_p90_deg")}
            e["text"] = {k: w.features.get(k) for k in ("geo_lith_label", "geo_map_scale_label") if isinstance(w.features.get(k), str)}
            top_entries.append(e)
        out_targets.append({"target": t.id, "name": t.spec.name, "seeds": seeds_out, "top": top_entries,
                            "n_better_than_parent": sum(s["best_refined_beats_seed"] for s in seeds_out)})
    doc = {
        "schema": "egiz.discovery_region", "region": "kz", "version": REFINE_VERSION, "synthetic": False,
        "method": __doc__, "population": pop_note, "draws": draws, "seed": seed, "step_km": STEP_KM,
        "bundle_sha256": bundle["content_sha256"], "seeds_sha256": hashlib.sha256(SEEDS.read_bytes()).hexdigest(),
        "n_refinement_windows": len(Rw), "excluded_low_coverage": excluded,
        "notes": ["Refinement windows are scored in a separate Monte Carlo run with the Earth-wide windows; ranks are "
                  "'would-be' ranks among Earth-wide windows of the same run and differ slightly from discovery.json ranks.",
                  "Nearest town and season are not in the data: shown as 'to be confirmed'.",
                  "Selection effect: the best of many neighbouring windows is expected to score higher partly by chance "
                  "(measurement and Monte Carlo noise); a refined window beating its seed is a lead for field checks, "
                  "not proof of a better analog."],
        "targets": out_targets,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    REGION_OUT.write_text(json.dumps(doc, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n",
                          encoding="utf-8", newline="\n")
    return json.dumps({"n_refinement_windows": len(Rw), "excluded": len(excluded),
                       "better_than_parent": {t["target"]: t["n_better_than_parent"] for t in out_targets}})
