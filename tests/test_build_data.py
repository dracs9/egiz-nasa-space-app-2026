"""Build safety and real-data report isolation. AI assistance: Codex; review pending."""

import json
import shutil
from pathlib import Path

import pytest

from pipeline.contracts.validate import ContractError, validate_file
from tools import build_data


def test_partial_observational_bundle_does_not_silently_fall_back(tmp_path, monkeypatch):
    processed = tmp_path / "data/processed"
    processed.mkdir(parents=True)
    (processed / "targets.json").write_text("{}")
    monkeypatch.setattr(build_data, "ROOT", tmp_path)
    with pytest.raises(ContractError, match="Incomplete real-data"):
        build_data.build()
    assert not (tmp_path / "data/fixtures").exists()


def test_real_pilot_build_creates_empty_honest_validation(tmp_path, monkeypatch):
    source = Path(__file__).resolve().parents[1] / "data/pilot"
    processed = tmp_path / "data/processed"
    processed.mkdir(parents=True)
    for name in build_data.INPUTS:
        shutil.copyfile(source / f"{name}.json", processed / f"{name}.json")
    monkeypatch.setattr(build_data, "ROOT", tmp_path)
    assert build_data.build() == processed
    report = validate_file(processed / "validation.json", production=True)
    assert report["synthetic"] is False
    assert all(experiment["status"] == "not_run" and experiment["value"] is None
               for experiment in report["experiments"])
    assert not report["practice_pairs"]
    assert not report["baselines"]
    assert not report["controls"]
    assert not report["figures"]
    before = (processed / "results.json").read_bytes()
    build_data.build()
    assert before == (processed / "results.json").read_bytes()


def test_existing_synthetic_validation_rejected_with_real_inputs(tmp_path, monkeypatch):
    source = Path(__file__).resolve().parents[1] / "data/pilot"
    processed = tmp_path / "data/processed"
    processed.mkdir(parents=True)
    for name in build_data.INPUTS:
        shutil.copyfile(source / f"{name}.json", processed / f"{name}.json")
    fixture = json.loads((source.parent / "fixtures/validation.json").read_text())
    (processed / "validation.json").write_text(json.dumps(fixture))
    monkeypatch.setattr(build_data, "ROOT", tmp_path)
    with pytest.raises(ContractError, match="synthetic=false"):
        build_data.build()
