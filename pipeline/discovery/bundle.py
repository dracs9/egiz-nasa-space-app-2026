"""Build the versioned discovery bundle consumed by the web Discover workspace.

python -m pipeline.discovery build    # writes data/discovery/discovery.json + scores/<target>.json
python -m pipeline.discovery verify   # rebuilds in memory, compares content hashes

Two-level design: ``discovery.json`` holds the compact Earth-wide index (one row per
window), target fingerprints and diversified shortlists with explanations, gaps and
rover experiments; ``scores/<target>.json`` holds per-window, per-dimension similarity
summaries (median, 5 %, 95 %, status) so the browser can re-aggregate with any weights
without recomputing science. Rasters are never shipped to the browser.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict
from datetime import datetime, timezone

import numpy as np

from pipeline.discovery import BUNDLE_VERSION, GEO_RELEASE, OUT
from pipeline.discovery import dimensions as D
from pipeline.discovery import rank as R
from pipeline.discovery.fingerprint import (
    INDEX_DIR,
    Target,
    earth_windows,
    load_targets,
    load_windows,
    target_fingerprint,
)
from pipeline.discovery.gaps import gap_ledger, ledger_summary
from pipeline.discovery.rover import body_rover_model, rover_experiment
from pipeline.discovery.similarity import EarthTable, earth_geology_classes
from pipeline.discovery.sites import BENCHMARK, TARGETS, benchmark_window

SEED = 2026
SHORTLIST = 25
DETAILED = 8
WINDOW_COLUMNS = [  # compact per-window columns shipped to the browser (units in names)
    "slope_f100_p50_deg", "slope_f100_p90_deg", "frac_lt10_f100", "frac_lt20_f100", "slope_f100_bin_0_5_frac",
    "slope_f100_bin_5_15_frac", "slope_f100_bin_15_30_frac", "slope_f400_p50_deg", "slope_f400_p90_deg",
    "frac_lt10_f400", "frac_lt20_f400", "slope_r_p50_deg", "relief_m", "elev_p50_m",
    "tri_f100_m", "bare_frac", "moss_lichen_frac", "tree_frac", "crop_frac", "grass_shrub_frac", "built_frac",
    "snow_frac", "water_frac",
    "precip_annual_mm", "t2m_mean_annual_c", "t2m_min_coldest_month_c", "t2m_max_warmest_month_c",
]
TEXT_COLUMNS = ["geo_lith_label", "geo_unit_name_label", "geo_map_scale_label"]


def _r(x, nd=4):
    if x is None:
        return None
    if isinstance(x, (float, np.floating)):
        return None if not np.isfinite(x) else round(float(x), nd)
    return x


def _sha(path) -> str | None:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def _dims_tuple(res: dict[str, R.DimResult]):
    return {d: (r.s50, r.lo, r.hi, r.status) for d, r in res.items()}


def population_mask(windows) -> tuple[np.ndarray, str]:
    pop = np.array([w.pool in ("global_lattice",) for w in windows])
    if pop.sum() >= 200:
        return pop, f"{int(pop.sum())} global-lattice windows (near-equal-area land sample, 220 km spacing)"
    return np.ones(len(windows), bool), (f"all {len(windows)} Earth windows (global lattice incomplete: "
                                         f"{int(pop.sum())} cells) - percentiles are provisional")


def explain(i: int, w, target: Target, res: dict[str, R.DimResult], agg: dict, pct: dict, rar: dict, nov: dict,
            n_pop: int) -> list[dict]:
    """Evidence-linked statements; every number comes from the arrays computed above."""
    out = []
    measured = [(d, res[d].s50[i]) for d in res if res[d].status[i] == 0]
    measured.sort(key=lambda x: -x[1])
    for d, s in measured:
        dim = D.DIM_BY_ID[d]
        p = pct[d][i]
        stmt = (f"{dim.label}: similarity {s:.2f} [{res[d].lo[i]:.2f}-{res[d].hi[i]:.2f}]"
                + (f"; Earth-wide percentile {p:.0f} of {n_pop} lattice windows" if np.isfinite(p) else ""))
        if d == "terrain_fine" and "w1_deg" in res[d].detail:
            stmt += f"; slope-distribution distance W1 = {res[d].detail['w1_deg'][i]:.2f} deg"
        if d == "thermal":
            lo, hi = res[d].detail["earth_range_k"]
            stmt += f"; Earth monthly air range {lo[i]:.0f}-{hi[i]:.0f} K vs Mars 184-242 K"
        if d == "geology":
            cls = res[d].detail["classes"][i]
            stmt += f"; Earth classes {', '.join(cls) or 'none'} vs target {', '.join(res[d].detail['target_classes'])}"
        out.append({"kind": "dimension", "dimension": d, "text": stmt, "value": _r(s), "percentile": _r(p, 1)})
    missing = [D.DIM_BY_ID[d].label for d in res if res[d].status[i] == 1]
    unassessed = [D.DIM_BY_ID[d].label for d in res if res[d].status[i] == 2]
    if missing:
        out.append({"kind": "missing", "text": "No data for this window: " + ", ".join(missing)})
    if unassessed:
        out.append({"kind": "not_assessed", "text": "Not assessed for any window (no dataset acquired): " + ", ".join(unassessed)})
    if np.isfinite(rar["terrain_pct"][i]):
        out.append({"kind": "rarity", "text": f"Terrain fingerprint rarer than {rar['terrain_pct'][i]:.1f} % of global-lattice "
                                             f"windows (mean distance to 10 nearest = {rar['terrain_dist'][i]:.2f} robust units)"})
    out.append({"kind": "novelty", "text": f"{nov['km'][i]:.0f} km from the nearest established analog site "
                                          f"({nov['nearest'][i]}); class {nov['label'][i]}"})
    out.append({"kind": "aggregate", "text": f"Fidelity over measured dimensions {agg['fidelity'][i]:.2f} "
                                             f"[{agg['lo'][i]:.2f}-{agg['hi'][i]:.2f}], coverage {agg['coverage'][i]:.2f}, "
                                             f"score {agg['score'][i]:.3f} ({agg['category'][i]} evidence)"})
    return out


def build(draws: int = 64, write: bool = True) -> str:
    windows = load_windows()
    targets = load_targets(windows)
    E = earth_windows(windows)
    table = EarthTable(E)
    pop, pop_note = population_mask(E)
    n_pop = int(pop.sum())
    lon = np.array([w.lon for w in E])
    lat = np.array([w.lat for w in E])

    t_dist, t_pct = R.rarity(table, pop, R.TERRAIN_FEATURES)
    e_dist, e_pct = R.rarity(table, pop, R.ENV_FEATURES)
    rar = {"terrain_dist": t_dist, "terrain_pct": t_pct, "env_dist": e_dist, "env_pct": e_pct}
    established = [(b.id, b.lon, b.lat) for b in BENCHMARK if b.role == "analog"]
    nov_km, nov_label, nov_near = R.novelty(E, established)
    nov = {"km": nov_km, "label": nov_label, "nearest": nov_near}
    zdiv = R.standardised(table, R.TERRAIN_FEATURES + R.ENV_FEATURES, pop)
    geo_classes, _ = earth_geology_classes(table)
    idx = {w.id: i for i, w in enumerate(E)}

    weights = R.PROFILES["general"]["weights"]
    best_target = np.full(len(E), -1)
    best_score = np.zeros(len(E))
    target_out, shards = [], {}
    for ti, t in enumerate(targets):
        res = R.score_target(table, t, pop, draws, SEED)
        for r in res.values():  # publish and aggregate the same 4-decimal values the browser receives
            r.s50, r.lo, r.hi = (np.round(a, 4) for a in (r.s50, r.lo, r.hi))
        agg = R.aggregate(_dims_tuple(res), weights)
        pct = {d: R.population_percentile(res[d].s50, pop) for d in res}
        score_pct = R.population_percentile(agg["score"], pop)
        better = agg["score"] > best_score
        best_target[better], best_score[better] = ti, agg["score"][better]
        order = np.argsort(-agg["score"], kind="stable")
        rank_of = np.empty(len(E), int)
        rank_of[order] = np.arange(1, len(E) + 1)
        short = R.diversify(order, agg["score"], lon, lat, zdiv, k=SHORTLIST)
        shortlist = []
        for n, i in enumerate(short):
            w = E[i]
            detailed = n < DETAILED
            shortlist.append({
                "window": w.id, "rank": int(rank_of[i]), "score": _r(agg["score"][i]), "fidelity": _r(agg["fidelity"][i]),
                "lo": _r(agg["lo"][i]), "hi": _r(agg["hi"][i]), "coverage": _r(agg["coverage"][i]),
                "category": str(agg["category"][i]), "score_percentile": _r(score_pct[i], 2),
                "dims": {d: {"s50": _r(res[d].s50[i]), "lo": _r(res[d].lo[i]), "hi": _r(res[d].hi[i]),
                             "status": R.STATUS[res[d].status[i]], "percentile": _r(pct[d][i], 1)} for d in res},
                "explanation": explain(i, w, t, res, agg, pct, rar, nov, n_pop),
                # Precomputed reference results for the top entries; the browser computes the same
                # ledger and experiment for any other window (parity-tested against these).
                "gaps": gap_ledger(t, w, res["terrain_fine"].detail["w1_deg"][i]) if detailed else None,
                "rover": rover_experiment(w, t.body) if detailed else None,
                "geology_classes": geo_classes[i],
            })
        if shortlist:
            shortlist[0]["gap_summary"] = ledger_summary(shortlist[0]["gaps"])
        bench = []
        for b in BENCHMARK:
            j = idx.get(benchmark_window(b))
            if j is None:
                bench.append({"site": b.id, "role": b.role, "window": benchmark_window(b), "status": "not_acquired"})
                continue
            bench.append({"site": b.id, "role": b.role, "window": E[j].id, "rank": int(rank_of[j]),
                          "score": _r(agg["score"][j]), "score_percentile": _r(score_pct[j], 2),
                          "coverage": _r(agg["coverage"][j]), "category": str(agg["category"][j]),
                          "target_body_match": t.body in b.bodies})
        target_out.append({
            "id": t.id, "body": t.body, "name": t.spec.name, "kind": t.spec.kind, "lon": _r(t.window.lon, 5),
            "lat": _r(t.window.lat, 5), "significance": t.spec.significance,
            "coordinate_reference": t.spec.coordinate_reference, "fine_baseline_m": t.baseline,
            "dem": {"moon": "PGDA LOLA 5 m/px", "mars": "USGS HRSC/MOLA blend 200 m"}[t.body],
            "fingerprint": target_fingerprint(t),
            "dimension_status": {d: R.dimension_status(D.DIM_BY_ID[d], t.body) for d in res},
            "target_cdf_100": None,
            "target_slope_cdf": [_r(v, 4) for v in res["terrain_fine"].detail["target_cdf"]],
            "shortlist": shortlist, "benchmark": bench, "shard": f"scores/{t.id}.json",
            "n_scored": int(len(E)),
            "n_strong_evidence": int(np.sum(agg["category"] == "strong")),
        })
        shards[t.id] = {
            "schema": "egiz.discovery_scores", "version": BUNDLE_VERSION, "target": t.id,
            "dims": list(res), "status_codes": list(R.STATUS),
            "s50": [[_r(v, 4) for v in res[d].s50] for d in res], "lo": [[_r(v, 4) for v in res[d].lo] for d in res],
            "hi": [[_r(v, 4) for v in res[d].hi] for d in res], "status": [res[d].status.tolist() for d in res],
            "w1_deg": [_r(v, 3) for v in res["terrain_fine"].detail["w1_deg"]],
        }

    unavailable = [{"id": s.id, "reason": "target terrain window not acquired"} for s in TARGETS
                   if s.id not in {t.id for t in targets}]
    countries = {}
    if (INDEX_DIR / "countries.json").exists():
        countries = json.loads((INDEX_DIR / "countries.json").read_text())["names"]

    def display_name(w) -> str:
        if w.pool not in ("global_lattice", "regional_lattice", "sampled"):
            return w.name
        place = countries.get(w.context.get("country_iso") or "", "Unassigned land")
        return f"{place} {abs(w.lat):.2f}°{'N' if w.lat >= 0 else 'S'} {abs(w.lon):.2f}°{'E' if w.lon >= 0 else 'W'}"

    cols = {
        "id": [w.id for w in E], "name": [display_name(w) for w in E], "pool": [w.pool for w in E],
        "release": [w.release for w in E], "lon": [_r(w.lon, 4) for w in E], "lat": [_r(w.lat, 4) for w in E],
        "coverage_level": [w.coverage_level for w in E], "quality": [w.quality for w in E],
        "country": [w.context.get("country_iso") for w in E],
        "volcano_km": [_r(w.context.get("volcano_km"), 1) for w in E],
        "impact_km": [_r(w.context.get("impact_km"), 1) for w in E],
        "impact_name": [w.context.get("impact_name") if isinstance(km := w.context.get("impact_km"), float)
                        and km <= 60 else None for w in E],
        **{c: [_r(w.f(c), 4) for w in E] for c in WINDOW_COLUMNS},
        **{c: [v if isinstance(v := w.features.get(c), str) else None for w in E] for c in TEXT_COLUMNS},
        "geology_classes": geo_classes,
        "rarity_terrain_pct": [_r(v, 2) for v in t_pct], "rarity_env_pct": [_r(v, 2) for v in e_pct],
        "novelty_km": [_r(v, 1) for v in nov_km], "novelty_class": nov_label, "nearest_established": nov_near,
        "best_target": [targets[i].id if i >= 0 else None for i in best_target],
        "best_target_score": [_r(v) for v in best_score],
        "in_population": pop.tolist(),
    }
    index_manifest = json.loads((INDEX_DIR / "manifest.json").read_text()) if (INDEX_DIR / "manifest.json").exists() else {}
    bundle = {
        "schema": "egiz.discovery", "version": BUNDLE_VERSION, "synthetic": False,
        "inputs": {"geo_release": {"path": "data/geo/geo-0.1.0/aoi_features.csv",
                                   "sha256": _sha(GEO_RELEASE / "aoi_features.csv")},
                   "index": {"path": "data/discovery/index/windows.csv", "sha256": _sha(INDEX_DIR / "windows.csv"),
                             "n_windows": index_manifest.get("n_windows"), "failures": index_manifest.get("failures"),
                             "sources": index_manifest.get("sources", [])},
                   "draws": draws, "seed": SEED},
        "population": {"definition": pop_note, "n": n_pop},
        "dimensions": [d.to_dict() for d in D.DIMENSIONS],
        "profiles": R.PROFILES,
        "constants": {"body": D.BODY, "thermal_reference": D.THERMAL_REFERENCE, "radiation": D.RADIATION,
                      "tau": D.TAU, "dem_error": D.DEM_ERROR, "resolution_penalty": D.RESOLUTION_PENALTY,
                      "geology_classes": D.GEOLOGY_CLASSES,
                      "class_similarity": [{"a": sorted(k)[0], "b": sorted(k)[1], "s": v} for k, v in D.CLASS_SIMILARITY.items()]},
        "aggregation": R.__doc__,
        "windows": cols,
        "targets": target_out,
        # Window-independent rover terramechanics, once per body (see pipeline.discovery.rover).
        "rover_body_level": {body: body_rover_model(body) for body in sorted({t.body for t in targets})},
        "unavailable_targets": unavailable,
        "benchmark_sites": [b.to_dict() for b in BENCHMARK],
        "reproduce": ["python -m pipeline.discovery acquire --set global --set kz --set benchmark --set targets",
                      "python -m pipeline.discovery index", f"python -m pipeline.discovery build --draws {draws}",
                      "python -m pipeline.discovery validate"],
    }
    text = json.dumps(bundle, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    content_hash = hashlib.sha256(text.encode()).hexdigest()
    if not write:
        return content_hash
    bundle["content_sha256"] = content_hash
    bundle["generated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "discovery.json").write_text(json.dumps(bundle, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n",
                                        encoding="utf-8")
    (OUT / "scores").mkdir(exist_ok=True)
    for tid, shard in shards.items():
        (OUT / "scores" / f"{tid}.json").write_text(json.dumps(shard, allow_nan=False, separators=(",", ":")) + "\n",
                                                    encoding="utf-8")
    return json.dumps({"windows": len(E), "population": n_pop, "targets": [t.id for t in targets],
                       "unavailable": unavailable, "content_sha256": content_hash})


def verify() -> tuple[bool, str]:
    path = OUT / "discovery.json"
    if not path.exists():
        return False, "data/discovery/discovery.json missing: run python -m pipeline.discovery build"
    stored = json.loads(path.read_text())
    draws = stored["inputs"]["draws"]
    rebuilt = build(draws=draws, write=False)
    ok = rebuilt == stored.get("content_sha256")
    return ok, json.dumps({"reproducible": ok, "stored": stored.get("content_sha256"), "rebuilt": rebuilt})


__all__ = ["build", "verify", "asdict"]
