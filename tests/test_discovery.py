"""EGIZ Discovery Engine: dimensions, similarity, uncertainty, ranking, gaps, rover, validation, bundle."""
import json
import math
from pathlib import Path

import numpy as np
import pytest

from pipeline.discovery import dimensions as D
from pipeline.discovery import rank as R
from pipeline.discovery import sites as S
from pipeline.discovery.similarity import (
    cdf_points,
    decorrelated_d2,
    effective_dimension,
    eval_cdf,
    js_divergence,
    shrunk_correlation,
)
from pipeline.discovery.validation import auc

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / "data/discovery/discovery.json"


# ----------------------------------------------------------------------------- physics and units

def test_noon_elevation_ranges():
    assert D.noon_elevation_range(0, 23.44) == pytest.approx((66.56, 90.0))
    lo, hi = D.noon_elevation_range(70, 23.44)
    assert lo == pytest.approx(-3.44) and hi == pytest.approx(43.44)  # polar night in winter
    lo, hi = D.noon_elevation_range(-85.4, 1.54)                       # lunar south pole: Sun near horizon
    assert lo == pytest.approx(3.06, abs=1e-6) and hi == pytest.approx(6.14, abs=1e-6)


def test_gravity_and_pressure_units():
    assert D.somigliana_gravity(0) == pytest.approx(9.7803, abs=1e-4)
    assert D.somigliana_gravity(90) == pytest.approx(9.8322, abs=1e-4)
    assert D.isa_pressure_pa(0) == pytest.approx(101325)
    assert D.isa_pressure_pa(5000) == pytest.approx(54020, rel=0.01)
    assert D.BODY["mars"]["pressure_pa"] < 1000 < D.BODY["earth"]["pressure_pa"]


def test_thermal_reference_is_kelvin_and_moon_not_scored():
    assert D.THERMAL_REFERENCE["mars"]["min_k"] == 184.0
    assert "moon" in D.DIM_BY_ID["thermal"].bodies_not_applicable
    assert R.dimension_status(D.DIM_BY_ID["thermal"], "moon") == "not_applicable"
    assert R.dimension_status(D.DIM_BY_ID["aeolian_dust"], "moon") == "not_applicable"
    assert R.dimension_status(D.DIM_BY_ID["mineralogy"], "mars") == "not_assessed"


def test_lithology_vocabulary():
    assert D.lith_classes("basalt flows and tuff") == ["basaltic_mafic", "volcanic_intermediate_felsic"]
    assert "sulfate_evaporite" in D.lith_classes("gypsum, halite")
    assert D.lith_classes(None) == [] and D.lith_classes("Precambrian") == []
    for pair, v in D.CLASS_SIMILARITY.items():
        a, b = sorted(pair)
        assert D.class_similarity(a, b) == D.class_similarity(b, a) == v
    assert D.class_similarity("carbonate", "carbonate") == 1.0


# ----------------------------------------------------------------------------- similarity methods

def _stats(p50, p90, lt10, lt20, b0, b1, b2, b=100):
    return {f"slope_f{b}_p50_deg": p50, f"slope_f{b}_p90_deg": p90, f"frac_lt10_f{b}": lt10, f"frac_lt20_f{b}": lt20,
            f"slope_f{b}_bin_0_5_frac": b0, f"slope_f{b}_bin_5_15_frac": b1, f"slope_f{b}_bin_15_30_frac": b2}


def _cdf(stats):
    x, y = cdf_points(lambda n: np.array([stats.get(n, np.nan)], float), 100)
    return eval_cdf(x, y, np.zeros((1, 1)), np.ones((1, 1)))[0, 0]


def test_slope_cdf_monotone_and_w1_properties():
    flat = _cdf(_stats(2, 6, 0.97, 1.0, 0.8, 0.18, 0.02))
    rough = _cdf(_stats(12, 25, 0.4, 0.75, 0.15, 0.4, 0.35))
    for c in (flat, rough):
        assert np.all(np.diff(c) >= -1e-12) and c[0] == 0 and c[-1] == 1
    assert np.abs(flat - flat).sum() == 0
    w1 = np.abs(flat - rough).sum()
    assert w1 > 5  # degrees: rough terrain has a much heavier slope tail


def test_missing_knots_are_not_zero_filled():
    partial = _cdf({"slope_f100_p50_deg": 3.0, "slope_f100_p90_deg": 8.0})
    assert partial[3] == pytest.approx(0.5) and partial[8] == pytest.approx(0.9)


def test_js_divergence_bounds():
    assert js_divergence([1, 0, 0, 0], [1, 0, 0, 0]) == pytest.approx(0, abs=1e-9)
    assert 0.99 < js_divergence([1, 0, 0, 0], [0, 0, 0, 1]) <= 1.0


def test_correlated_features_are_not_counted_twice():
    rng = np.random.default_rng(0)
    base = rng.normal(size=(500, 1))
    z_corr = np.hstack([base, base + rng.normal(0, 0.01, (500, 1)), base + rng.normal(0, 0.01, (500, 1))])
    z_ind = rng.normal(size=(500, 3))
    r_corr, r_ind = shrunk_correlation(z_corr), shrunk_correlation(z_ind)
    assert effective_dimension(r_corr) < 1.6 < 2.6 < effective_dimension(r_ind)
    d_one = np.ones((1, 1, 3))  # same 1-sigma difference on every feature
    # three nearly identical features carry about one feature's worth of evidence
    assert decorrelated_d2(d_one, r_corr)[0, 0] == pytest.approx(1.0, rel=0.35)
    assert decorrelated_d2(d_one, r_ind)[0, 0] == pytest.approx(1.0, rel=0.35)


# ----------------------------------------------------------------------------- aggregation

def _dims(values, status):
    s = np.array(values, float)
    return (s, s * 0.9, np.minimum(1, s * 1.1), np.array(status, np.int8))


def test_missing_dimensions_lower_coverage_never_raise_score():
    w = {"a": 1, "b": 1, "c": 1}
    full = R.aggregate({"a": _dims([0.9], [0]), "b": _dims([0.9], [0]), "c": _dims([0.2], [0])}, w)
    miss = R.aggregate({"a": _dims([0.9], [0]), "b": _dims([0.9], [0]), "c": _dims([np.nan], [1])}, w)
    assert miss["fidelity"][0] > full["fidelity"][0]          # fidelity over measured dims only ...
    assert miss["coverage"][0] == pytest.approx(2 / 3)        # ... but coverage drops
    assert miss["score"][0] <= miss["fidelity"][0] * (2 / 3) + 1e-12


def test_perfect_measured_match_with_unassessed_dims_is_not_perfect():
    w = {"a": 1, "b": 1, "x": 1}
    agg = R.aggregate({"a": _dims([1.0], [0]), "b": _dims([1.0], [0]), "x": _dims([np.nan], [2])}, w)
    assert agg["fidelity"][0] == pytest.approx(1.0)
    assert agg["score"][0] == pytest.approx(2 / 3) and agg["bounded_lo"][0] < 1
    na = R.aggregate({"a": _dims([1.0], [0]), "x": _dims([np.nan], [3])}, {"a": 1, "x": 1})
    assert na["coverage"][0] == 1.0  # not-applicable physics is not counted as missing evidence


def test_evidence_categories():
    agg = R.aggregate({"a": _dims([0.8, 0.8], [0, 0]), "b": _dims([0.8, np.nan], [0, 1]), "c": _dims([0.8, np.nan], [0, 1])},
                      {"a": 1, "b": 1, "c": 1})
    assert list(agg["category"]) == ["strong", "missing_driven"]


def test_population_percentile():
    v = np.array([1, 2, 3, 4, 10.0])
    pop = np.array([True, True, True, True, False])
    pct = R.population_percentile(v, pop)
    assert pct[0] == 25 and pct[3] == 100 and pct[4] == 100


def test_diversity_enforces_geographic_spacing():
    lon = np.array([0, 0.5, 10, 10.3, 20.0])
    lat = np.zeros(5)
    score = np.array([0.9, 0.85, 0.8, 0.79, 0.5])
    picks = R.diversify(np.argsort(-score), score, lon, lat, np.zeros((5, 2)), k=5, min_km=150)
    assert picks == [0, 2, 4]


def test_novelty_labels():
    from pipeline.discovery.fingerprint import Window
    w = [Window("A", "earth", "x", "A", 0.0, 0.0, "L4", "pass", "t", {}), Window("B", "earth", "x", "B", 5.0, 0.0, "L4", "pass", "t", {})]
    km, label, near = R.novelty(w, [("E", 0.1, 0.0)])
    assert label == ["established", "unexplored"] and near == ["E", "E"] and km[0] < 30


# ----------------------------------------------------------------------------- sites

def test_fibonacci_lattice_spacing():
    pts = S.fibonacci_points(500)
    assert len(pts) == round(4 * math.pi * S.EARTH_R_KM ** 2 / 500 ** 2)
    nearest = [min(S.haversine_km(p, q) for q in pts[max(0, i - 60):i + 60] if q != p) for i, p in enumerate(pts[100:140], 100)]
    assert 300 < float(np.median(nearest)) < 700


def test_point_in_polygon_with_hole():
    country = {"polys": [[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]]], "bbox": (0, 0, 10, 10)}
    assert S.in_country(1, 1, country) and not S.in_country(5, 5, country) and not S.in_country(11, 5, country)


def test_benchmark_roles_and_targets():
    roles = {b.role for b in S.BENCHMARK}
    assert roles == {"analog", "hypothesis", "negative_control"}
    assert all(b.reference for b in S.BENCHMARK)
    assert {t.body for t in S.TARGETS} == {"moon", "mars"}
    assert all(t.geology and t.geology_reference for t in S.TARGETS)


def test_acquisition_failure_reasons_are_explicit():
    from pipeline.discovery.index import _failure_reason
    assert "Antarctica" in _failure_reason({"error": "AccessError: cannot open .../ESA_WorldCover_10m_2021_v200_S78E159_Map.tif: HTTP response code: 404"})
    assert _failure_reason({"error": "AccessError: no Copernicus GLO-30 tile intersects this window (ocean)"}).startswith("ocean")


# ----------------------------------------------------------------------------- gaps and rover

def _window(**f):
    from pipeline.discovery.fingerprint import Window
    return Window("W", "earth", "global_lattice", "W", 10.0, 30.0, "L4_validated", "pass", "index", f)


def test_gap_ledger_values_and_honesty():
    from pipeline.discovery.fingerprint import Target
    from pipeline.discovery.gaps import gap_ledger
    spec = next(t for t in S.TARGETS if t.id == "MOON_MONS_MOUTON")
    tw = _window()
    tw.lat = -85.4
    target = Target(spec, tw, 100)
    rows = {r["key"]: r for r in gap_ledger(target, _window(elev_p50_m=1000.0, t2m_min_coldest_month_c=-5.0,
                                                          t2m_max_warmest_month_c=30.0, tree_frac=0.1, crop_frac=0.0,
                                                          grass_shrub_frac=0.2))}
    assert rows["gravity"]["ratio_earth_to_target"] == pytest.approx(D.somigliana_gravity(30) / 1.62)
    assert rows["pressure"]["earth_value"] == pytest.approx(89875, rel=0.01)
    assert rows["thermal"]["measurable"] is False and "not comparable" in rows["thermal"]["note"]
    assert rows["dust"]["measurable"] is False
    assert rows["vegetation"]["earth_value"] == pytest.approx(0.3)
    missing = {r["key"]: r for r in gap_ledger(target, _window())}
    assert missing["pressure"]["measurable"] is False and missing["pressure"]["earth_value"] is None


def test_rover_experiment_on_candidate_terrain():
    from pipeline.discovery.rover import rover_experiment
    flat = rover_experiment(_window(**_stats(2, 6, 0.97, 1.0, 0.8, 0.18, 0.02)), "moon")
    rough = rover_experiment(_window(**_stats(12, 25, 0.4, 0.75, 0.15, 0.4, 0.35)), "moon")
    assert flat is not None and rough is not None
    assert flat["status"] == "MODEL_ESTIMATE" and flat["assumptions"]
    assert flat["cases"]["target"]["traversable_frac"] >= rough["cases"]["target"]["traversable_frac"]
    d = rough["deltas"]["earth_load_matched"]
    assert d["sinkage_ratio"] == pytest.approx(1.0, abs=1e-3)  # Bekker: load-matched test reproduces sinkage
    assert rover_experiment(_window(), "mars") is None


def test_rover_levels_body_vs_window():
    """Slope limit and sinkage are body-level (same for every window); traversability/energy are window-level."""
    from pipeline.discovery.rover import (
        BODY_LEVEL_KEYS,
        WINDOW_LEVEL_KEYS,
        body_rover_model,
        rover_experiment,
    )
    flat = _window(**_stats(2, 6, 0.97, 1.0, 0.8, 0.18, 0.02))
    rough = _window(**_stats(12, 25, 0.4, 0.75, 0.15, 0.4, 0.35))
    for body in ("moon", "mars"):
        a, b, m = rover_experiment(flat, body), rover_experiment(rough, body), body_rover_model(body)
        assert a["levels"]["body"] == list(BODY_LEVEL_KEYS) and a["levels"]["window"] == list(WINDOW_LEVEL_KEYS)
        assert not set(BODY_LEVEL_KEYS) & set(WINDOW_LEVEL_KEYS)
        for case in ("target", "earth_load_matched", "earth_mass_matched"):
            for k in ("slope_limit_deg", "sinkage_mm"):  # identical across windows and equal to the body model
                assert a["cases"][case][k] == b["cases"][case][k] == m["cases"][case][k]
            for k in ("traversable_frac", "climbing_energy_j_per_m"):
                assert k not in m["cases"][case]  # window-level quantities never in the body block
        for key in ("earth_load_matched", "earth_mass_matched"):
            for k in ("d_slope_limit_deg", "sinkage_ratio"):
                assert a["deltas"][key][k] == b["deltas"][key][k] == m["deltas"][key][k]
        assert a["cases"]["target"]["traversable_frac"] != b["cases"]["target"]["traversable_frac"]
        assert m["label"] == "body-level, model estimate"
    # Mars reuses the lunar soil, and every Mars output says so.
    mars, moon = body_rover_model("mars"), body_rover_model("moon")
    assert mars["soil"] == moon["soil"] and "lunar" in mars["soil"]["name"].lower()
    assert mars["soil_reused_from_moon"] is True and "LUNAR" in mars["soil_note"]
    assert moon["soil_reused_from_moon"] is False and moon["soil_note"] is None
    ex = rover_experiment(flat, "mars")
    assert ex["soil_reused_from_moon"] is True and any("REUSED" in s for s in ex["assumptions"])


def test_gap_ledger_rover_rows_are_body_level():
    from pipeline.discovery.fingerprint import Target
    from pipeline.discovery.gaps import gap_ledger
    from pipeline.discovery.rover import body_rover_model
    spec = next(t for t in S.TARGETS if t.body == "mars")
    tw = _window()
    target = Target(spec, tw, 200)
    r1 = {r["key"]: r for r in gap_ledger(target, _window(elev_p50_m=100.0))}
    r2 = {r["key"]: r for r in gap_ledger(target, _window(elev_p50_m=3000.0))}
    m = body_rover_model("mars")
    for key, field in (("rover_slope_limit", "slope_limit_deg"), ("rover_sinkage", "sinkage_mm")):
        assert r1[key]["target_value"] == r2[key]["target_value"] == round(m["cases"]["target"][field], 2)
        assert r1[key]["earth_value"] == r2[key]["earth_value"] == round(m["cases"]["earth_mass_matched"][field], 2)
        assert "body-level" in r1[key]["note"] and "LUNAR" in r1[key]["note"]


# ----------------------------------------------------------------------------- validation metric

def test_auc():
    assert auc(np.array([3.0, 4.0]), np.array([1.0, 2.0])) == 1.0
    assert auc(np.array([1.0]), np.array([1.0])) == 0.5
    assert auc(np.array([0.0]), np.array([1.0, 2.0])) == 0.0


def test_hard_negative_control_is_bare_arid_and_latitude_matched():
    from pipeline.discovery.fingerprint import Window
    from pipeline.discovery.validation import (
        HARD_NEG,
        evaluate_hard_negative,
        hard_negative_bands,
        matched_auc,
    )

    def w(lat, bare, prec):
        return Window(f"W{lat}_{bare}_{prec}", "earth", "global_lattice", "W", 0.0, lat, "L4_validated", "pass", "index",
                      {"bare_frac": bare, "precip_annual_mm": prec})
    E = [w(20, 0.9, 50), w(-25, 0.8, 100), w(60, 0.9, 50),   # bare+arid at |lat| 20, 25 (south) and 60
         w(22, 0.1, 50), w(21, 0.9, 900), w(23, None, 50),   # vegetated, wet, missing -> excluded
         w(24, 0.9, 50)]                                     # the positive itself (excluded even if bare/arid)
    pop = np.ones(len(E), bool)
    cand, bands = hard_negative_bands(E, [6], pop)
    assert set(cand) == {0, 1, 2}
    assert set(bands[0]) == {0, 1}  # |lat| within 10 deg of 24, either hemisphere; 60 N excluded
    assert HARD_NEG["bare_frac_min"] == 0.5 and HARD_NEG["precip_annual_mm_max"] == 250.0
    score = np.array([0.1, 0.9, 0.0, 0.0, 0.0, 0.0, 0.5])
    assert matched_auc(score, [6], bands) == pytest.approx(0.5)
    out = evaluate_hard_negative(score, E, [6], pop, np.random.default_rng(0))
    assert out["n_hard_negative"] == 3 and out["n_per_positive"] == [2] and out["auc"] == 0.5
    assert out["auc_90ci"] is None  # a single matched positive gives no interval rather than a fake one
    none = evaluate_hard_negative(score, [w(80, 0.1, 900)] + E[6:], [1], np.ones(2, bool), np.random.default_rng(0))
    assert none["auc"] is None and none["n_positive_matched"] == 0


def test_weak_match_wording_rule():
    from pipeline.discovery.report import weak_match
    assert weak_match(0.39, 0.20)       # Mons Mouton-like: fidelity above 0.3 but lower bound below
    assert weak_match(0.22, 0.12)
    assert weak_match(None, None)
    assert not weak_match(0.63, 0.42)


# ----------------------------------------------------------------------------- committed bundle

@pytest.mark.skipif(not BUNDLE.exists(), reason="discovery bundle not built")
def test_committed_bundle_contract():
    b = json.loads(BUNDLE.read_text())
    assert b["schema"] == "egiz.discovery" and b["synthetic"] is False
    n = len(b["windows"]["id"])
    assert n == len(set(b["windows"]["id"])) and all(len(v) == n for v in b["windows"].values())
    assert b["population"]["n"] == sum(b["windows"]["in_population"])
    for t in b["targets"]:
        shard = json.loads((BUNDLE.parent / t["shard"]).read_text())
        assert shard["target"] == t["id"] and all(len(row) == n for row in shard["s50"])
        for k, d in enumerate(shard["dims"]):
            st = t["dimension_status"][d]
            assert (st == "measured") == any(s == 0 for s in shard["status"][k])
            assert all(v is None or 0 <= v <= 1 for v in shard["s50"][k])
        scores = [e["score"] for e in t["shortlist"]]
        assert all(0 <= s < 1 for s in scores), "no candidate may reach a perfect score"
        assert all(e["explanation"] for e in t["shortlist"])
        assert all(e["coverage"] < 1 for e in t["shortlist"])  # not-assessed dimensions always apply
        windows_named = {e["window"] for e in t["shortlist"]}
        assert windows_named <= set(b["windows"]["id"])


@pytest.mark.skipif(not BUNDLE.exists(), reason="discovery bundle not built")
def test_bundle_is_reproducible():
    from pipeline.discovery.bundle import verify
    ok, detail = verify()
    assert ok, detail


# ----------------------------------------------------------------------------- ASTRAL Earth worlds

def test_earth_world_site_and_tiling(tmp_path):
    from pipeline.world import scene
    site = scene.earth_site("PILOT_BOSZHIRA")
    assert site["body"] == "earth" and site["half_m"] == 8192.0 and site["height_scale"] == 0.05
    site["source_crs"] = scene.local_proj(site)
    half = site["half_m"] + 600.0
    n = int(round(2 * half / scene.GLO30_PIXEL_M))
    x = np.linspace(-half, half, n)
    dtm = (200 + 900 * np.exp(-(x[None, :] ** 2 + x[:, None] ** 2) / 4e7)).astype(np.float32)  # 900 m analytic hill
    manifest = scene.build_package(site, dtm, (-half, half), None, None, tmp_path)
    assert manifest["encoding"]["scale_m"] == 0.05 and manifest["encoding"]["image_px"] is None
    assert len(manifest["tiles"]) == 1 + 4 + 16 and manifest["site"]["body"] == "earth"
    assert max(t["max_m"] for t in manifest["tiles"]) == pytest.approx(1100, abs=15)


def test_kz_refinement_lattice_is_separate_from_the_bundle():
    from pipeline.discovery import refine as RF
    from pipeline.discovery.sites import haversine_km
    seeds = [{"window": "KZX_A", "lon": 54.5, "lat": 43.5}, {"window": "KZX_B", "lon": 65.0, "lat": 45.0}]
    aois = RF.refine_aois(seeds)
    assert len(aois) == 16 and len({a.aoi_id for a in aois}) == 16
    assert all(a.pool == RF.POOL == "kz_refine" for a in aois)
    for a in aois:
        s = next(x for x in seeds if f"parent={x['window']}" in a.notes)
        d = haversine_km((s["lon"], s["lat"]), (a.lon, a.lat))
        assert 18 < d < 30  # 20 km edge or ~28 km diagonal neighbour
    # refinement windows never enter the Earth-wide reference population
    from pipeline.discovery.bundle import population_mask
    from pipeline.discovery.fingerprint import Window
    ws = [Window(a.aoi_id, "earth", a.pool, a.name, a.lon, a.lat, "L4_validated", "pass", "x", {}) for a in aois]
    pop, _ = population_mask(ws + [Window("G", "earth", "global_lattice", "G", 0, 0, "L4_validated", "pass", "x", {})] * 200)
    assert not pop[: len(ws)].any()
