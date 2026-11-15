"""On-demand analysis of any point on the Moon or Mars against the Earth-wide index.

python -m pipeline.discovery point --body mars --lon 77.45 --lat 18.44

The point goes through the same stages as the curated targets: a 22 km window is read
from a global DEM by HTTP range requests (no bulk download), terrain is measured on the
same local grids, and every dimension is scored against every Earth window with the same
Monte Carlo similarity, aggregation and diversification as ``pipeline.discovery build``.
Nothing is precomputed for the point and nothing is invented: dimensions without a
dataset at the point stay ``not_assessed`` / ``missing``.

DEMs
  Mars  USGS HRSC/MOLA blend, global, 200 m posting
  Moon  USGS LOLA global LDEM, 118 m posting (256 ppd)
"""
from __future__ import annotations

import json
import math
import threading
import time
from dataclasses import dataclass

import numpy as np

from pipeline.discovery import ROOT
from pipeline.discovery import bundle as B
from pipeline.discovery import dimensions as D
from pipeline.discovery import planetary_props as PP
from pipeline.discovery import rank as R
from pipeline.discovery.fingerprint import (
    INDEX_DIR,
    Target,
    Window,
    earth_windows,
    load_windows,
    target_fingerprint,
)
from pipeline.discovery.gaps import gap_ledger, ledger_summary
from pipeline.discovery.rover import body_rover_model, rover_experiment
from pipeline.discovery.similarity import EarthTable, earth_geology_classes
from pipeline.discovery.sites import BENCHMARK, MARS_BLEND, TargetSpec

MOON_LOLA = "https://planetarymaps.usgs.gov/mosaic/Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif"
PRODUCT = {"mars": MARS_BLEND, "moon": MOON_LOLA}
DEM_KEY = {"mars": "USGS_MARS_BLEND", "moon": "LOLA_LDEM_118M"}
DEM_LABEL = {"mars": "USGS HRSC/MOLA blend 200 m (global)", "moon": "USGS LOLA LDEM 118 m (global)"}
BASELINE_M = 400          # same fine baseline as the Mars targets; Earth windows carry f400 features
MAX_ABS_LAT = 88.0        # simple-cylindrical global rasters degenerate at the pole itself
POINT_DERIVED = ROOT / "data" / "derived" / "points"
DRAWS = 64
SHORTLIST = 15
DETAILED = 5

_lock = threading.Lock()
_ctx: "Context | None" = None


class PointError(ValueError):
    """The request cannot be analysed (bad input or no valid DEM at the point)."""


def point_id(body: str, lon: float, lat: float) -> str:
    return (f"PT_{body.upper()}_{'E' if lon >= 0 else 'W'}{abs(lon):07.3f}_"
            f"{'N' if lat >= 0 else 'S'}{abs(lat):06.3f}")


@dataclass
class Context:
    """Earth-side arrays shared by every point request (built once per process)."""
    E: list[Window]
    table: EarthTable
    pop: np.ndarray
    n_pop: int
    lon: np.ndarray
    lat: np.ndarray
    rar: dict
    nov: dict
    zdiv: np.ndarray
    geo_classes: list
    countries: dict
    built_s: float

    def display_name(self, w: Window) -> str:
        if w.pool not in ("global_lattice", "regional_lattice", "sampled"):
            return w.name
        place = self.countries.get(w.context.get("country_iso") or "", "Unassigned land")
        return f"{place} {abs(w.lat):.2f}°{'N' if w.lat >= 0 else 'S'} {abs(w.lon):.2f}°{'E' if w.lon >= 0 else 'W'}"


def context() -> Context:
    global _ctx
    if _ctx is None:
        t0 = time.time()
        E = earth_windows(load_windows())
        table = EarthTable(E)
        pop, _ = B.population_mask(E)
        t_dist, t_pct = R.rarity(table, pop, R.TERRAIN_FEATURES)
        e_dist, e_pct = R.rarity(table, pop, R.ENV_FEATURES)
        established = [(b.id, b.lon, b.lat) for b in BENCHMARK if b.role == "analog"]
        km, label, near = R.novelty(E, established)
        geo_classes, _ = earth_geology_classes(table)
        cpath = INDEX_DIR / "countries.json"
        countries = json.loads(cpath.read_text())["names"] if cpath.exists() else {}
        _ctx = Context(E, table, pop, int(pop.sum()), np.array([w.lon for w in E]), np.array([w.lat for w in E]),
                       {"terrain_dist": t_dist, "terrain_pct": t_pct, "env_dist": e_dist, "env_pct": e_pct},
                       {"km": km, "label": label, "nearest": near},
                       R.standardised(table, R.TERRAIN_FEATURES + R.ENV_FEATURES, pop), geo_classes, countries,
                       round(time.time() - t0, 1))
    return _ctx


def _validate(body: str, lon: float, lat: float) -> tuple[str, float, float]:
    body = str(body).lower()
    if body not in PRODUCT:
        raise PointError("body must be 'moon' or 'mars'")
    if not (math.isfinite(lon) and math.isfinite(lat)) or not -180 <= lon <= 180 or not -90 <= lat <= 90:
        raise PointError("lon must be in [-180, 180] and lat in [-90, 90] (planetocentric, east-positive)")
    if abs(lat) > MAX_ABS_LAT:
        raise PointError(f"|lat| > {MAX_ABS_LAT:g}: the global cylindrical DEM is not usable at the pole itself")
    return body, round(lon, 3), round(lat, 3)


def measure(body: str, lon: float, lat: float) -> Window:
    """Run the unchanged geodata DEM stage for the point and return its feature window."""
    from pipeline.geodata import features as F
    from pipeline.geodata.aois import AOI

    pid = point_id(body, lon, lat)
    aoi = AOI(pid, "SITE_" + pid, f"{body.upper()}_POINT", body, f"{body.title()} point {lat:.3f}, {lon:.3f}",
              "on-demand point", lon, lat, "point", product=PRODUCT[body], fine_baseline_m=BASELINE_M,
              notes=["on-demand point (pipeline.discovery.point)"])
    with _lock:  # F.DERIVED is module state shared with the batch pipeline
        previous, F.DERIVED = F.DERIVED, POINT_DERIVED
        try:
            record = F.process(aoi, stages=("dem", "landcover", "climate", "geology"))
        finally:
            F.DERIVED = previous
    st = record["stages"].get("dem", {})
    if st.get("status") != "ok":
        raise PointError(f"no usable DEM window at this point: {st.get('error', st.get('status'))}")
    feats = record["features"]
    if feats.get(f"slope_f{BASELINE_M}_p50_deg") is None:
        raise PointError("the DEM window has too many missing pixels to measure terrain")
    return Window(pid, body, "point", aoi.name, lon, lat, "L1_dem", "ok", "point", dict(feats), {})


def point_weights() -> dict[str, float]:
    return {**R.PROFILES["general"]["weights"], **{d.id: d.weight for d in D.POINT_DIMENSIONS}}


def score_albedo(ctx: Context, body: str, values: dict, draws: int) -> R.DimResult:
    """Point-only surface_albedo dimension (see dimensions.POINT_DIMENSIONS)."""
    from pipeline.discovery.earth_albedo import load as load_albedo
    W = len(ctx.E)
    tv = values.get("albedo_tes")
    if body != "mars" or tv is None:
        code = R.STATUS.index("not_assessed")
        return R.DimResult(np.full(W, np.nan), np.full(W, np.nan), np.full(W, np.nan), np.full(W, code, np.int8), {})
    alb = load_albedo()
    ae = np.array([alb.get(e.id, np.nan) for e in ctx.E], float)
    ok = np.isfinite(ae)
    rng = np.random.default_rng([B.SEED, 7331])
    st = float(np.hypot(tv.get("std") or 0.0, D.ALBEDO_TARGET_SIGMA))
    ed = ae[:, None] + rng.normal(0, D.ALBEDO_EARTH_SIGMA, (W, draws))
    td = tv["value"] + rng.normal(0, st, (1, draws))
    sims = np.exp(-np.abs(ed - td) / D.ALBEDO_TAU)
    from pipeline.discovery.similarity import summarise
    s50, lo, hi = summarise(sims)
    status = np.where(ok, 0, 1).astype(np.int8)
    return R.DimResult(np.where(ok, s50, np.nan), np.where(ok, lo, np.nan), np.where(ok, hi, np.nan), status,
                       {"earth_albedo": ae, "target_albedo": tv["value"]})


def analyze(body: str, lon: float, lat: float, *, draws: int = DRAWS) -> dict:
    t0 = time.time()
    body, lon, lat = _validate(body, float(lon), float(lat))
    w = measure(body, lon, lat)
    props = PP.properties(body, lon, lat)
    classes, why = PP.infer_geology(body, props["values"])
    t_measure = time.time() - t0
    ctx = context()
    spec = TargetSpec(w.id, body, w.name, lon, lat, "point", "User-selected point (not a curated target).",
                      f"planetocentric lon {lon:.3f}, lat {lat:.3f}", tuple(classes),
                      "inferred from orbital composition at the point: " + "; ".join(why), w.id, BASELINE_M)
    t = Target(spec, w, BASELINE_M, dem=DEM_KEY[body])
    res = R.score_target(ctx.table, t, ctx.pop, draws, B.SEED)
    if not classes:
        res["geology"].status[:] = R.STATUS.index("not_assessed")
    res["surface_albedo"] = score_albedo(ctx, body, props["values"], draws)
    for r in res.values():
        r.s50, r.lo, r.hi = (np.round(a, 4) for a in (r.s50, r.lo, r.hi))
    weights = point_weights()
    agg = R.aggregate(B._dims_tuple(res), weights)
    pct = {d: R.population_percentile(res[d].s50, ctx.pop) for d in res}
    score_pct = R.population_percentile(agg["score"], ctx.pop)
    order = np.argsort(-agg["score"], kind="stable")
    rank_of = np.empty(len(ctx.E), int)
    rank_of[order] = np.arange(1, len(ctx.E) + 1)
    short = R.diversify(order, agg["score"], ctx.lon, ctx.lat, ctx.zdiv, k=SHORTLIST)
    shortlist = []
    for n, i in enumerate(short):
        e = ctx.E[i]
        detailed = n < DETAILED
        shortlist.append({
            "window": e.id, "name": ctx.display_name(e), "lon": B._r(e.lon, 4), "lat": B._r(e.lat, 4),
            "country": e.context.get("country_iso"), "rank": int(rank_of[i]), "score": B._r(agg["score"][i]),
            "fidelity": B._r(agg["fidelity"][i]), "lo": B._r(agg["lo"][i]), "hi": B._r(agg["hi"][i]),
            "coverage": B._r(agg["coverage"][i]), "category": str(agg["category"][i]),
            "score_percentile": B._r(score_pct[i], 2),
            "dims": {d: {"s50": B._r(res[d].s50[i]), "lo": B._r(res[d].lo[i]), "hi": B._r(res[d].hi[i]),
                         "status": R.STATUS[res[d].status[i]], "percentile": B._r(pct[d][i], 1)} for d in res},
            "explanation": B.explain(i, e, t, res, agg, pct, ctx.rar, ctx.nov, ctx.n_pop),
            "gaps": gap_ledger(t, e, res["terrain_fine"].detail["w1_deg"][i]) if detailed else None,
            "rover": rover_experiment(e, body) if detailed else None,
            "novelty_km": B._r(ctx.nov["km"][i], 1), "novelty_class": ctx.nov["label"][i],
            "geology_classes": ctx.geo_classes[i],
        })
    if shortlist and shortlist[0]["gaps"]:
        shortlist[0]["gap_summary"] = ledger_summary(shortlist[0]["gaps"])
    top = shortlist[0] if shortlist else None
    verdict = None
    if top:
        weak = (top["fidelity"] or 0) < 0.3 or (top["lo"] or 0) < 0.3
        verdict = ("weak match: closest window found, not a demonstrated analog" if weak
                   else "candidate analog: fidelity and its lower 90 % bound are at least 0.3")
    terrain = {k: B._r(w.f(k), 3) for k in (f"slope_f{BASELINE_M}_p50_deg", f"slope_f{BASELINE_M}_p90_deg",
                                             f"frac_lt10_f{BASELINE_M}", f"frac_lt20_f{BASELINE_M}",
                                             f"tri_f{BASELINE_M}_m", "slope_r_p50_deg", "relief_m", "elev_p50_m",
                                             "dem_valid_frac")}
    dim_status = {d: "measured" if (res[d].status == 0).any() else R.STATUS[int(res[d].status[0])] for d in res}
    target_entry = {  # same shape as a bundle target (web/src/discover/types.ts TargetEntry)
        "id": w.id, "body": body, "name": w.name, "kind": "point", "lon": lon, "lat": lat,
        "significance": "User-selected point, analysed on demand against the same Earth-wide index.",
        "coordinate_reference": f"planetocentric lon {lon:.3f}°E, lat {lat:.3f}° (picked on the map)",
        "fine_baseline_m": BASELINE_M, "dem": DEM_LABEL[body], "fingerprint": target_fingerprint(t),
        "dimension_status": dim_status,
        "target_slope_cdf": [B._r(v, 4) for v in res["terrain_fine"].detail["target_cdf"]],
        "shortlist": shortlist, "benchmark": [], "shard": "", "n_scored": len(ctx.E),
        "n_strong_evidence": int(np.sum(agg["category"] == "strong")),
    }
    shard = {  # same shape as scores/<target>.json, aligned to window_ids
        "schema": "egiz.discovery_scores", "version": "point-1.0.0", "target": w.id,
        "dims": list(res), "status_codes": list(R.STATUS),
        "s50": [[B._r(v, 4) for v in res[d].s50] for d in res], "lo": [[B._r(v, 4) for v in res[d].lo] for d in res],
        "hi": [[B._r(v, 4) for v in res[d].hi] for d in res], "status": [res[d].status.tolist() for d in res],
        "w1_deg": [B._r(v, 3) for v in res["terrain_fine"].detail["w1_deg"]],
    }
    from pipeline.discovery import alphaearth as AE
    from pipeline.discovery import bridge as BR
    bridge = BR.search(w, body, props["values"])
    if bridge.get("status") == "ok":
        pos = {e.id: n for n, e in enumerate(ctx.E)}
        for row in bridge["top"]:
            j = pos[row["window"]]
            row.update(name=ctx.display_name(ctx.E[j]), physical_rank=int(rank_of[j]),
                       physical_score=B._r(agg["score"][j]))
    ae = None
    idx = AE.load_index()
    if idx is not None and idx[0] == [e.id for e in ctx.E]:
        seeds = [(e["window"], float(e["score"] or 0)) for e in shortlist[:5]]
        ae = AE.expand(seeds, win_lon=ctx.lon, win_lat=ctx.lat)
        if ae and ae.get("status") == "ok":
            for row in ae["top"]:
                j = next(n for n, e in enumerate(ctx.E) if e.id == row["window"])
                row.update(name=ctx.display_name(ctx.E[j]), lon=B._r(ctx.E[j].lon, 4), lat=B._r(ctx.E[j].lat, 4),
                           physical_rank=int(rank_of[j]), physical_score=B._r(agg["score"][j]))
    elif idx is not None:
        ae = {"status": "index_stale", "note": "AlphaEarth index window order differs; rerun alphaearth-index"}
    else:
        ae = {"status": "not_built", "note": "run: python -m pipeline.discovery alphaearth-index (needs Earth Engine)"}
    return {
        "schema": "egiz.point_analysis", "version": "1.0.0", "synthetic": False,
        "point": {"id": w.id, "body": body, "lon": lon, "lat": lat, "window_km": 22, "fine_baseline_m": BASELINE_M,
                  "dem": DEM_LABEL[body], "dem_url": PRODUCT[body]},
        "terrain": terrain, "verdict": verdict,
        "target": target_entry, "shard": shard, "window_ids": [e.id for e in ctx.E],
        "rover_body_level": body_rover_model(body),
        "alphaearth": ae,
        "bridge": bridge,
        "properties": props,
        "geology_inferred": {"classes": classes, "rules": why},
        "extra_dimensions": [d.to_dict() for d in D.POINT_DIMENSIONS],
        "weights": weights,
        "not_assessed_note": ("Measured at the point: terrain (fine, roughness, regional), solar geometry and orbital "
                              "composition/albedo where a global map covers it; geology classes are inferred from that "
                              "composition. Thermal is a body-level reference. Mineralogy, dust, ice and subsurface "
                              "values are reported but not scored: the Earth index has no comparable layer."),
        "timing_s": {"measure": round(t_measure, 1), "score": round(time.time() - t0 - t_measure, 1),
                     "earth_context_build": ctx.built_s},
    }
