"""Batch reproducibility and admission. Written with AI assistance (Codex); review pending."""

import copy
import hashlib
import importlib
import json

import pytest

from pipeline.contracts.fixtures import generate
from pipeline.contracts.validate import validate_file
from pipeline.engine.campaign import design
from pipeline.engine.run import compute_run, main


def test_fixture_engine_e10_byte_identical_and_no_controls(tmp_path):
    generate(output=tmp_path)
    paths = {name: tmp_path / f"{name}.json" for name in
             ("earth_candidates", "targets", "mission_templates", "sun_windows")}
    paths["out"] = tmp_path / "results.json"
    result = main(paths)
    first = result.read_bytes()
    main(paths)
    assert result.read_bytes() == first
    value = validate_file(result)
    assert value["synthetic"] and len(value["runs"]) == 2
    for run in value["runs"]:
        assert any("CT_" in id_ for cells in run["fidelity"].values() for id_ in cells)
        for campaign in run["campaigns"]:
            assert len(campaign["sites"]) <= campaign["k"]
            assert all("CT_" not in site["id"] for site in campaign["sites"])
            assert campaign["coverage"] + 1e-9 >= campaign["method"]["greedy_coverage"]
    assert all(len(value) == 64 for value in value["inputs"].values())


def test_synthetic_engine_refuses_processed_destination(tmp_path):
    generate(output=tmp_path)
    paths = {name: tmp_path / f"{name}.json" for name in
             ("earth_candidates", "targets", "mission_templates", "sun_windows")}
    paths["out"] = tmp_path / "processed" / "results.json"
    with pytest.raises(ValueError, match="Synthetic"):
        main(paths)
    assert not paths["out"].exists()


def test_missing_target_temperature_keeps_measured_gaps_unknown():
    data = generate()
    target = copy.deepcopy(data["targets"]["targets"][0])
    template = next(t for t in data["mission_templates"]["templates"] if t["id"] in target["templates"])
    target["attrs"]["t_min_c"] = None
    value = compute_run(data["earth_candidates"], target, template, data["sun_windows"], data["mission_templates"]["params"])
    assert all(gap["attr"] != "t_min_c" for gap in value["gaps"]["attribute"])


def test_all_null_and_small_pool_budget_behavior():
    for result in (design([[None, None]], [1, 1]), design([[0, 0]], [1, 1])):
        assert [c["k"] for c in result] == [1, 2, 3]
        assert all(c["sites"] == [] and c["coverage"] == 0 for c in result)
    result = design([[1, 0]], [1, 1])
    assert [c["k"] for c in result] == [1, 2, 3]
    assert all(len(c["sites"]) == 1 for c in result)
    assert len(design([[1], [0.5], [0.3]], [1], per_objective=1)) == 3


def test_hashes_change_when_input_snapshot_changes(tmp_path):
    generate(output=tmp_path)
    paths = {name: tmp_path / f"{name}.json" for name in
             ("earth_candidates", "targets", "mission_templates", "sun_windows")}
    paths["out"] = tmp_path / "results.json"
    before = json.loads(main(paths).read_text())["inputs"]["earth_candidates_sha256"]
    candidates = json.loads(paths["earth_candidates"].read_text())
    candidates["tiles"][0]["attrs"]["bare_frac"] = 0.5
    paths["earth_candidates"].write_text(json.dumps(candidates))
    after = json.loads(main(paths).read_text())["inputs"]["earth_candidates_sha256"]
    assert before != after


def test_input_hashes_identify_the_bytes_scored_during_concurrent_ingestion(tmp_path, monkeypatch):
    generate(output=tmp_path)
    paths = {name: tmp_path / f"{name}.json" for name in
             ("earth_candidates", "targets", "mission_templates", "sun_windows")}
    paths["out"] = tmp_path / "baseline.json"
    baseline = json.loads(main(paths).read_text())
    original_hash = hashlib.sha256(paths["earth_candidates"].read_bytes()).hexdigest()
    engine = importlib.import_module("pipeline.engine.run")
    original_read = engine._read

    def read_then_update_source(path):
        snapshot = original_read(path)
        if path == paths["earth_candidates"]:
            data = json.loads(path.read_bytes())
            data["tiles"][0]["attrs"]["bare_frac"] = 0.01
            path.write_text(json.dumps(data))
        return snapshot

    monkeypatch.setattr(engine, "_read", read_then_update_source)
    paths["out"] = tmp_path / "concurrent.json"
    result = json.loads(main(paths).read_text())
    assert result["runs"] == baseline["runs"]
    assert result["inputs"]["earth_candidates_sha256"] == original_hash
    assert hashlib.sha256(paths["earth_candidates"].read_bytes()).hexdigest() != original_hash


def test_production_output_rejects_fake_identifiers_despite_false_metadata_flag(tmp_path):
    generate(output=tmp_path)
    paths = {name: tmp_path / f"{name}.json" for name in
             ("earth_candidates", "targets", "mission_templates", "sun_windows")}
    for path in paths.values():
        data = json.loads(path.read_text())
        data["synthetic"] = False
        path.write_text(json.dumps(data))
    paths["out"] = tmp_path / "processed" / "results.json"
    paths["out"].parent.mkdir()
    previous_bytes = b"previous output must stay unchanged\n"
    paths["out"].write_bytes(previous_bytes)
    with pytest.raises(ValueError, match="FAKE_"):
        main(paths)
    assert paths["out"].read_bytes() == previous_bytes
    assert not paths["out"].with_suffix(".json.tmp").exists()
