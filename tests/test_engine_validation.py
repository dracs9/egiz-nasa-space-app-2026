"""Validation harness checks. Written with AI assistance (Codex); review pending."""

import csv

from pipeline.contracts.fixtures import generate
from pipeline.contracts.validate import validate_data
from pipeline.engine.ablation import run as ablation
from pipeline.engine.controls import run as controls
from pipeline.engine.robustness import run as robustness
from pipeline.engine.run import compute_run
from pipeline.engine.validate_practice import run as practice


def tiny():
    data = generate()
    data["earth_candidates"]["tiles"] = data["earth_candidates"]["tiles"][:10]
    data["targets"]["targets"] = data["targets"]["targets"][:1]
    return data


def test_practice_known_best_rank_controls_excluded_and_all_pairs_reported(tmp_path):
    tiles = [{"id": "PR_SITE", "pool": "practice", "attrs": {"precip_mm": 0, "bare_frac": 1}},
             {"id": "GL_SITE", "pool": "global", "attrs": {"precip_mm": 1000, "bare_frac": 0.5}},
             {"id": "CT_SITE", "pool": "control", "attrs": {"precip_mm": 0, "bare_frac": 1}}]
    result = {"synthetic": True, "runs": [{"target": "MOON_TARGET", "fidelity": {"O2": {
        "PR_SITE": {"F": 1}, "GL_SITE": {"F": 0.2}, "CT_SITE": {"F": 1}}}}]}
    path = tmp_path / "practice.csv"
    with path.open("w", newline="") as source:
        writer = csv.DictWriter(source, fieldnames=["site_id", "objective_id", "target_context", "source_key", "testable", "exclusion_reason"])
        writer.writeheader()
        writer.writerow({"site_id": "SITE", "objective_id": "O2", "target_context": "moon",
                         "source_key": "NASA", "testable": "true", "exclusion_reason": ""})
        writer.writerow({"site_id": "OTHER", "objective_id": "O2", "target_context": "moon",
                         "source_key": "NASA", "testable": "false", "exclusion_reason": "chemistry"})
    report = practice(result, {"tiles": tiles, "synthetic": True}, path, bootstrap_runs=20)
    first, second = report["practice_pairs"]
    assert (first["rank"], first["n"], first["pct"]) == (1, 2, 50)
    assert second["exclusion_reason"] == "chemistry" and second["pct"] is None
    assert report["experiment"]["status"] == "inconclusive"
    assert practice(result, {"tiles": tiles, "synthetic": True}, path, bootstrap_runs=20) == report


def test_controls_low_rank_and_deterministic_random_sanity():
    candidates = {"synthetic": True, "tiles": [
        *[{"id": f"GL_{i:02}", "pool": "global", "context": {"water_frac": 0}} for i in range(30)],
        {"id": "CT_FOREST", "pool": "control", "context": {"water_frac": 0}},
        {"id": "CT_WATER", "pool": "control", "context": {"water_frac": 0.9}}]}
    cells = {tile["id"]: {"F": 0.7} for tile in candidates["tiles"]}
    cells["CT_FOREST"] = {"F": 0.01}
    cells["CT_WATER"] = {"F": None, "reason": "constraint"}
    results = {"synthetic": True, "runs": [{"target": "MOON_TARGET", "fidelity": {"O1": cells},
               "campaigns": [{"k": 2, "method": {"exact_coverage": 0.7, "greedy_coverage": 0.7}}]}]}
    a = controls(results, candidates, random_campaigns=20)
    assert a == controls(results, candidates, random_campaigns=20)
    assert a["controls"] == [{"name": "top_5_percent_fraction", "value": 0}, {"name": "constraint_violations", "value": 0}]
    assert a["sanity"][0]["exact_ge_greedy"]


def test_secondary_practice_recomputes_only_target_independent_attributes(tmp_path):
    data = tiny()
    target = data["targets"]["targets"][0]
    template = next(t for t in data["mission_templates"]["templates"] if t["id"] in target["templates"])
    value = compute_run(data["earth_candidates"], target, template, data["sun_windows"])
    # Pick the objective with bare-surface threshold, rather than forcing a
    # target-comparison objective to produce a fake secondary score.
    objective = next(o for o in template["objectives"] if any(not a["needs_target"] for a in o["attributes"]))
    tile = data["earth_candidates"]["tiles"][0]
    path = tmp_path / "practice.csv"
    with path.open("w", newline="") as source:
        writer = csv.DictWriter(source, fieldnames=["site_id", "objective_id", "target_context", "source_key", "testable"])
        writer.writeheader()
        writer.writerow({"site_id": tile["id"], "objective_id": objective["id"],
                         "target_context": target["id"], "source_key": "fixture", "testable": "true"})
    report = practice({"synthetic": True, "runs": [value]}, data["earth_candidates"], path,
                      templates=data["mission_templates"], targets=data["targets"], sun=data["sun_windows"],
                      bootstrap_runs=10)
    assert len(report["secondary_pairs"]) == 1
    assert report["secondary_pairs"][0]["pct"] is not None


def test_robustness_recomputes_scores_and_is_seeded():
    data = tiny()
    args = [data[name] for name in ("earth_candidates", "targets", "mission_templates", "sun_windows")]
    report, details = robustness(*args, runs=3, mask_runs=2)
    assert (report, details) == robustness(*args, runs=3, mask_runs=2)
    validate_data(report)
    assert report["synthetic"] and details
    assert all(0 <= value <= 1 for values in report["selection_freq"].values() for value in values.values())


def test_ablation_removes_each_family_and_evaluates_strict_minimum():
    data = tiny()
    report = ablation(*[data[name] for name in ("earth_candidates", "targets", "mission_templates", "sun_windows")])
    assert {variant["variant"] for variant in report["variants"]} == {
        "terrain_fine", "terrain_regional", "environment", "light", "minimum"}
    assert all(len(variant["campaigns"]) == 3 for variant in report["variants"])


def test_missing_constraints_enforced_by_actual_engine():
    data = tiny()
    target = data["targets"]["targets"][0]
    template = next(t for t in data["mission_templates"]["templates"] if t["id"] in target["templates"])
    data["earth_candidates"]["tiles"][0]["context"]["built_frac"] = 0.21
    value = compute_run(data["earth_candidates"], target, template, data["sun_windows"])
    id_ = data["earth_candidates"]["tiles"][0]["id"]
    assert all(cells[id_] == {"F": None, "reason": "constraint"} for cells in value["fidelity"].values())
