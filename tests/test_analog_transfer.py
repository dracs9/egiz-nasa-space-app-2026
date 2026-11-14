"""ATLAS-Pi unit, scientific-fixture and integration tests.

Synthetic fixtures here are test inputs only; they are never presented as observations.
Written with AI assistance (Claude); human review pending.
"""

import copy
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import pytest
from jsonschema import Draft202012Validator

from pipeline.analog_transfer import constellation, counterfactual, features, planner, registry
from pipeline.analog_transfer.transfer import Context, assess, certificate, compute_tensor, gauss

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / "data/pilot/atlas_pi.json"


# ------------------------------------------------------------ helpers / fixtures

def plane(side=100, slope_deg=5.0, cell=200.0):
    x = np.arange(side) * cell
    return np.tile(np.tan(np.radians(slope_deg)) * x, (side, 1))


def entry(z, ident="FIX_A", body="earth", pixel=30):
    side = z.shape[0]
    return {"id": ident, "body": body, "source_pixel_m": pixel,
            "grid": {"side": side, "cell_m": 200, "elevation_m": [None if not np.isfinite(v) else float(v) for v in z.ravel()]}}


def rough(seed, amp=20.0, side=100):
    rng = np.random.default_rng(seed)
    return plane(side, 3.0) + rng.normal(0, amp, (side, side)).cumsum(axis=0) * 0.2


@pytest.fixture(scope="module")
def reg():
    return registry.load()


def factor(name, match, weight=1, role="primary", kind="derived", quality=0.9, res=200.0, n=20):
    return {"factor": name, "name": name, "match": match, "boot": None if match is None else [match] * n,
            "ci": None if match is None else [match, match], "weight": weight, "role": role, "kind": kind,
            "quality": quality if match is not None else 0.0, "effective_resolution_m": res, "detail": {},
            "earth": {"value": 1, "kind": kind, "source": "fixture"}, "target": {"value": 1, "kind": kind, "source": "fixture"},
            "tolerance": 1.0, "unit": None}


TASK = {"id": "FIX_TASK", "name": "Fixture task", "required_resolution_m": 200, "min_evidence": 0.7, "limitations": []}
NO_REPRO = {"factor": "gravity", "name": "Surface gravity", "role": "primary", "reproducible_in_field": "no", "corrections": [],
            "lab_alternatives": ["chamber"], "earth": {}, "target": {}}


# ------------------------------------------------------------ registry

def test_registry_loads_and_validates(reg):
    assert {t["id"] for t in reg.task_list("moon")} >= {"ROUTE_PLANNING", "LOW_SUN_OPS", "WHEEL_SOIL"}
    assert "LOW_SUN_OPS" not in {t["id"] for t in reg.task_list("mars")}
    assert len(registry.config_hash()) == 64


def test_registry_rejects_unknown_physics(reg):
    bad = copy.deepcopy(reg.tasks)
    bad["tasks"][0]["physics"] = {"antigravity": "primary"}
    with pytest.raises(registry.RegistryError):
        registry.validate(registry.Registry(bad, reg.physical, reg.measurements, reg.context))


def test_registry_rejects_threshold_inversion(reg):
    bad = copy.deepcopy(reg.tasks)
    bad["status_rules"]["conditional_point"] = 0.9
    with pytest.raises(registry.RegistryError):
        registry.validate(registry.Registry(bad, reg.physical, reg.measurements, reg.context))


# ------------------------------------------------------------ features

def test_status_thresholds_are_tolerance_units():
    assert gauss(1.0) == pytest.approx(0.6065, abs=1e-4)
    assert gauss(2.0) == pytest.approx(0.1353, abs=1e-4)


def test_plane_slope_is_recovered_at_every_scale():
    d = features.describe(entry(plane(slope_deg=7.0)), n_boot=5)
    for s in features.SCALES:
        q = d.point[f"q_slope_{s}"]
        assert np.allclose(q, 7.0, atol=1e-6)
    assert d.point["q_roughness"].max() == pytest.approx(-3.0)  # residual floor 1 mm on a perfect plane


def test_identical_inputs_give_zero_distance():
    a = features.describe(entry(rough(1)), n_boot=5)
    assert features.wasserstein1(a.point["q_slope_200"], a.point["q_slope_200"]) == 0


def test_coarsening_never_invents_cells():
    z = rough(2)
    z[10, 10] = np.nan
    c = features.coarsen(z, 4)
    assert np.isnan(c[2, 2]) and np.isfinite(c[0, 0])
    assert c.shape == (25, 25)


def test_bootstrap_is_deterministic_and_seeded():
    e = entry(rough(3))
    a, b = features.describe(e, n_boot=10), features.describe(e, n_boot=10)
    assert all(np.array_equal(x["q_slope_200"], y["q_slope_200"]) for x, y in zip(a.boot, b.boot))
    c = features.describe(e, n_boot=10, seed=1)
    assert not np.array_equal(a.boot[0]["q_slope_200"], c.boot[0]["q_slope_200"])


def test_sparse_grid_fails_loudly():
    z = rough(4)
    z[:, :60] = np.nan
    with pytest.raises(ValueError, match="valid"):
        features.grid_array(entry(z))


# ------------------------------------------------------------ status rules (scientific fixtures)

def test_identical_terrain_supported(reg):
    cell = assess(reg.rules, TASK, [factor("slope_dist", 1.0, 3), factor("relief", 0.98, 1)], [], [], [], "S", "T")
    assert cell["status"] == "SUPPORTED"


def test_physical_mismatch_not_hidden_by_terrain_similarity(reg):
    cell = assess(reg.rules, TASK, [factor("slope_dist", 1.0)], [NO_REPRO], [], [], "S", "T")
    assert cell["status"] == "NON_TRANSFERABLE" and "PHYSICS_PRIMARY" in cell["reasons"]
    assert cell["axes"]["task_match"] == 1.0  # similarity is still reported, separately


def test_missing_data_is_unknown_not_perfect(reg):
    cell = assess(reg.rules, TASK, [factor("thermal", None, 2), factor("slope_dist", 1.0, 1)], [], [], [], "S", "T")
    assert cell["status"] == "UNKNOWN"
    assert cell["axes"]["evidence_coverage"] == pytest.approx(1 / 3)
    all_missing = assess(reg.rules, TASK, [factor("thermal", None)], [], [], [], "S", "T")
    assert all_missing["status"] == "UNKNOWN" and all_missing["axes"]["task_match"] is None


def test_insufficient_resolution_prevents_supported(reg):
    cell = assess(reg.rules, dict(TASK, required_resolution_m=100), [factor("roughness", 1.0, res=600.0)], [], [], [], "S", "T")
    assert cell["status"] == "CONDITIONAL" and "RESOLUTION" in cell["reasons"]


def test_unverified_evidence_prevents_supported(reg):
    cell = assess(reg.rules, TASK, [factor("process", 1.0, kind="curated", quality=0.25)], [], [], [], "S", "T")
    assert cell["status"] == "CONDITIONAL" and "LOW_EVIDENCE_QUALITY" in cell["reasons"]


def test_wide_interval_prevents_supported(reg):
    f = factor("slope_dist", 0.8)
    f["boot"] = list(np.linspace(0.2, 1.0, 20))
    cell = assess(reg.rules, TASK, [f], [], [], [], "S", "T")
    assert cell["status"] == "CONDITIONAL" and "CI_BELOW_THRESHOLD" in cell["reasons"]


def test_site_constraint_overrides(reg):
    cell = assess(reg.rules, TASK, [factor("slope_dist", 1.0)], [], [{"attr": "water_frac", "op": "<=", "value": 0.5, "observed": 0.96}], [], "S", "T")
    assert cell["status"] == "NON_TRANSFERABLE" and cell["reasons"] == ["SITE_CONSTRAINT"]


def test_low_match_is_weak(reg):
    cell = assess(reg.rules, TASK, [factor("slope_dist", 0.01)], [], [], [], "S", "T")
    assert cell["status"] == "WEAK"


# ------------------------------------------------------------ tensor on synthetic fixtures

def _ctx(reg, target_z, site_zs):
    desc = {"T_FIX": features.describe(entry(target_z, "T_FIX", "mars", 200), n_boot=20)}
    tiles = {}
    for i, z in enumerate(site_zs):
        sid = f"S_FIX{i}"
        desc[sid] = features.describe(entry(z, sid), n_boot=20)
        tiles[sid] = {"id": sid, "pool": "global", "attrs": {"bare_frac": 0.95, "slope_f400_p90_deg": 4.0},
                      "context": {"water_frac": 0.0, "built_frac": 0.0}}
    target = {"id": "T_FIX", "body": "mars", "dem_product": "fixture", "attrs": {"slope_f400_p90_deg": 4.0}, "attr_sources": {}}
    return Context(reg, desc, tiles, {"T_FIX": target})


def test_tensor_ranks_identical_terrain_above_different(reg):
    z = rough(5)
    ctx = _ctx(reg, z, [z.copy(), rough(6, amp=200)])
    cells = compute_tensor(ctx, ["S_FIX0", "S_FIX1"], ["T_FIX"])["cells"]
    route = {c["site"]: c for c in cells if c["task"] == "ROUTE_PLANNING"}
    assert route["S_FIX0"]["axes"]["task_match"] > 0.95
    assert route["S_FIX0"]["axes"]["task_match"] > route["S_FIX1"]["axes"]["task_match"]
    wheel = {c["site"]: c for c in cells if c["task"] == "WHEEL_SOIL"}
    assert all(c["status"] == "NON_TRANSFERABLE" for c in wheel.values())


# ------------------------------------------------------------ constellation

def _cells_from_Q(Q, statuses=None):
    """Build minimal cells: one task per requirement column, one factor each."""
    cells = []
    for i in range(Q.shape[0]):
        for j in range(Q.shape[1]):
            f = factor(f"f{j}", float(Q[i, j]))
            status = statuses[i][j] if statuses else ("SUPPORTED" if Q[i, j] >= 0.6065 else "WEAK")
            cells.append({"site": f"S{i}", "target": "T", "task": f"K{j}", "status": status, "reasons": [],
                          "factors": [f], "physics": []})
    return cells


def test_portfolio_prefers_complementary_over_redundant():
    # S0 and S1 are near-identical strong sites on requirement 0; S2 is the only site for requirement 1.
    Q = np.array([[0.95, 0.0], [0.94, 0.0], [0.0, 0.7]])
    mission = {"id": "M", "target": "T", "task_weights": {"K0": 1, "K1": 1}}
    cells = _cells_from_Q(Q)
    out = constellation.design(cells, mission, ["S0", "S1", "S2"], {}, k=2)
    assert sorted(out["selected"]) == ["S0", "S2"]
    assert out["baseline_topk_individual"]["selected"] == ["S0", "S1"]
    assert out["covered"] == 2 and not out["uncovered"]


def test_zero_contribution_site_never_kept():
    Q = np.array([[0.9, 0.0], [0.0, 0.0]])
    mission = {"id": "M", "target": "T", "task_weights": {"K0": 1, "K1": 1}}
    out = constellation.design(_cells_from_Q(Q), mission, ["S0", "S1"], {}, k=2)
    assert out["selected"] == ["S0"]
    assert [u["task"] for u in out["uncovered"]] == ["K1"]


def test_lab_only_tasks_reported_not_scored():
    cells = [{"site": "S0", "target": "T", "task": "K0", "status": "NON_TRANSFERABLE", "reasons": ["PHYSICS_PRIMARY"],
              "factors": [factor("f0", 0.99)], "physics": [NO_REPRO]}]
    reqs, lab = constellation.requirements(cells, {"id": "M", "target": "T", "task_weights": {"K0": 1}})
    assert not reqs and lab[0]["task"] == "K0" and lab[0]["alternatives"] == ["chamber"]


def test_greedy_never_beats_exact():
    rng = np.random.default_rng(0)
    for _ in range(20):
        Q = rng.random((7, 5)) * (rng.random((7, 5)) > 0.5)
        w = rng.random(5)
        w /= w.sum()
        exact = constellation.optimize(Q, w, 3)[1]["J"]
        greedy = constellation.greedy(Q, w, 3)[1]["J"]
        assert exact >= greedy - 1e-12


# ------------------------------------------------------------ counterfactual physics

def test_bekker_load_matched_is_identity_and_mass_matched_scales():
    r = counterfactual.terramechanics("moon")
    assert r["cases"]["earth_load_matched"]["sinkage_ratio_vs_target"] == pytest.approx(1.0)
    expected = (9.80665 / 1.62) ** (2 / 3)  # n = 1: z0 proportional to W^(2/(2n+1))
    assert r["cases"]["earth_mass_matched"]["sinkage_ratio_vs_target"] == pytest.approx(expected, rel=1e-9)
    assert r["status"] == "MODEL_ESTIMATE_CONTESTED"


def test_bekker_rejects_invalid_inputs():
    with pytest.raises(ValueError):
        counterfactual.bekker_wheel(-1, 0.8, 0.3, 1400, 820000, 1)
    with pytest.raises(ValueError):
        counterfactual.terramechanics("moon", rover={"mass_kg": float("nan")})
    with pytest.raises(ValueError):
        counterfactual.terramechanics("venus")


def test_cohesion_increases_slope_limit():
    base = counterfactual.slope_limit_deg(900, 1.62, counterfactual.DEFAULT_ROVER, counterfactual.LUNAR_SOIL)
    sticky = counterfactual.slope_limit_deg(900, 1.62, counterfactual.DEFAULT_ROVER, dict(counterfactual.LUNAR_SOIL, c_pa=500))
    assert sticky > base > 0


def test_solar_models_respect_horizon_and_atmosphere():
    elev = np.array([-5.0, 0.0, 10.0, 60.0])
    flux = np.full(4, 590.0)
    assert counterfactual.direct_normal("moon", elev, flux)[0] == 0
    mars_clear = counterfactual.direct_normal("mars", elev, flux, tau=0.0)
    mars_dusty = counterfactual.direct_normal("mars", elev, flux, tau=1.0)
    assert np.all(mars_dusty <= mars_clear) and mars_clear[3] == pytest.approx(590.0)
    earth = counterfactual.direct_normal("earth", elev, flux)
    assert earth[0] == 0 and 800 < earth[3] < 1100
    with pytest.raises(ValueError):
        counterfactual.direct_normal("mars", elev, flux, tau=-1)


# ------------------------------------------------------------ planner and certificates

def test_measurement_that_resolves_nothing_has_zero_value(reg):
    Q = np.array([[0.9, 0.0], [0.0, 0.8]])
    cells = _cells_from_Q(Q)
    raw = {(c["site"], c["task"]): (dict(TASK, id=c["task"]), [dict(c["factors"][0], role="primary")], [], [], []) for c in cells}
    mission = {"id": "M", "target": "T", "task_weights": {"K0": 1, "K1": 1}}
    m = {"id": "M_NONE", "name": "none", "resolves": ["thermal"], "side": "earth"}
    out = planner.evpi(raw, mission, ["S0", "S1"], m, reg, k=2, draws=10)
    assert out["evpi"] == 0 and not out["touched"]


def test_missing_factor_measurement_has_positive_value(reg):
    raw = {}
    for s in ("S0", "S1"):
        f_known = factor("f0", 0.9 if s == "S0" else 0.7)
        f_missing = factor("thermal", None)
        f_missing["target"] = {"value": 1, "kind": "derived", "source": "fixture"}
        raw[(s, "K0")] = (dict(TASK, id="K0", min_evidence=0.9), [f_known, f_missing], [], [], [])
    mission = {"id": "M", "target": "T", "task_weights": {"K0": 1}}
    m = {"id": "M_T", "name": "thermal", "resolves": ["thermal"], "side": "earth"}
    out = planner.evpi(raw, mission, ["S0", "S1"], m, reg, k=1, draws=200)
    assert out["touched"] and out["evpi"] > 0


def test_certificate_is_content_addressed(reg):
    cell = assess(reg.rules, TASK, [factor("slope_dist", 1.0)], [], [], [], "S", "T")
    a = certificate(cell, TASK, {"x": "0" * 64}, ["DS:1"])
    b = certificate(cell, TASK, {"x": "0" * 64}, ["DS:1"])
    c = certificate(cell, TASK, {"x": "1" * 64}, ["DS:1"])
    assert a["id"] == b["id"] != c["id"]


# ------------------------------------------------------------ integration with the measured bundle

@pytest.fixture(scope="module")
def bundle():
    if not BUNDLE.exists():
        pytest.skip("atlas_pi.json not built; run python -m pipeline.analog_transfer build")
    return json.loads(BUNDLE.read_text())


def test_bundle_matches_contract(bundle):
    schema = json.loads((ROOT / "contracts/atlas_pi.schema.json").read_text())
    errors = list(Draft202012Validator(schema).iter_errors(bundle))
    assert not errors, errors[0].message


def test_bundle_content_hash(bundle):
    content = {k: v for k, v in bundle.items() if k not in ("generated_at", "performance", "content_sha256", "dossiers")}
    digest = hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    assert digest == bundle["content_sha256"]


def test_bundle_inputs_are_current(bundle):
    for name, digest in bundle["inputs"].items():
        if name.endswith(".json"):
            assert hashlib.sha256((ROOT / "data/pilot" / name).read_bytes()).hexdigest() == digest, name


def test_every_claim_is_certified_and_traceable(bundle):
    nodes = {n["id"] for n in bundle["evidence_graph"]["nodes"]}
    for cell in bundle["tensor"]["cells"]:
        cert = bundle["certificates"][cell["certificate"]]
        assert cert["evidence"] and set(cert["evidence"]) <= nodes
        if any(f["match"] is not None and f["factor"] == "slope_dist" for f in cell["factors"]):
            assert any(e.startswith("DS:") for e in cert["evidence"])  # traced to a hashed source file


def test_bundle_has_no_nonfinite_values(bundle):
    text = BUNDLE.read_text()
    assert "NaN" not in text and "Infinity" not in text


def test_bundle_keeps_axes_separate(bundle):
    for c in bundle["tensor"]["cells"]:
        assert set(c["axes"]) >= {"task_match", "evidence_coverage", "evidence_quality", "resolution_sufficient"}
        if c["status"] == "SUPPORTED":
            assert c["axes"]["task_match_ci90"][0] >= 0.6065 and c["axes"]["evidence_quality"] >= 0.6


def test_water_control_never_selected(bundle):
    control = next(c for c in bundle["evaluation"]["controls"] if c["id"] == "NC1")
    assert control["verdict"] == "passed"
    for by_k in bundle["constellations"].values():
        for c in by_k.values():
            assert "KZ_E051.200_N43.400" not in c["selected"]


def test_unknown_inputs_stay_unknown(bundle):
    habitat = [c for c in bundle["tensor"]["cells"] if c["task"] == "HABITAT_LAYOUT" and not c["constraints"]["failed"]]
    assert habitat and all(c["status"] == "UNKNOWN" for c in habitat)
    thermal = [f for c in habitat for f in c["factors"] if f["factor"] == "thermal"]
    assert all(f["match"] is None and f["kind"] == "unknown" for f in thermal)


def test_dossiers_cover_every_pair(bundle):
    pairs = {f"{s['id']}|{t['id']}" for s in bundle["sites"] for t in bundle["targets"]}
    assert set(bundle["dossiers"]) == pairs
    text = bundle["dossiers"]["PR_JETT_SP_CRATER|MARS_JEZERO"]
    assert bundle["content_sha256"][:16] in text and "## Physical mismatch" in text and "## Reproducibility" in text


def test_counterfactual_marked_contested(bundle):
    for r in bundle["counterfactual"]["terramechanics"].values():
        assert r["status"] == "MODEL_ESTIMATE_CONTESTED"
        assert math.isclose(r["cases"]["earth_load_matched"]["sinkage_ratio_vs_target"], 1.0, rel_tol=1e-6)
