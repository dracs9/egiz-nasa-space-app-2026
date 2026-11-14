"""Stage 1 ML tests: loader validation, missingness, baseline compatibility, schema.

Written with AI assistance (Claude Code); human review pending.
"""

from __future__ import annotations

import copy
import json
import math
import shutil
from pathlib import Path

import jsonschema
import pytest

from pipeline.contracts.validate import ContractError, tiles_hash
from pipeline.ml.baseline import DEFAULT_CONFIG, engine_matches_committed, stability
from pipeline.ml.export import build_documents, validate_document
from pipeline.ml.loader import load_snapshot, summary

ROOT = Path(__file__).resolve().parents[1]
PILOT = ROOT / "data" / "pilot"
FIXED = "2026-11-07T00:00:00+00:00"
FAST = {"stability_draws": 20}


@pytest.fixture(scope="module")
def snapshot():
    return load_snapshot(PILOT)


@pytest.fixture(scope="module")
def docs(snapshot):
    return build_documents(load_snapshot(PILOT), FAST, created_at=FIXED)


def _copy_pilot(tmp_path: Path) -> Path:
    out = tmp_path / "snap"
    out.mkdir()
    for name in ("earth_candidates", "targets", "mission_templates", "sun_windows"):
        shutil.copy(PILOT / f"{name}.json", out / f"{name}.json")
    return out


def test_loader_reads_pilot_without_imputation(snapshot):
    assert len(snapshot.candidates) == 9 and snapshot.skipped == []
    assert not snapshot.synthetic
    report = summary(snapshot)
    assert report["missing_attribute_counts"] == {"precip_mm": 9, "t_max_c": 9, "t_min_c": 9}
    assert all(tile["attrs"]["t_min_c"] is None for tile in snapshot.candidates)
    assert all(len(meta["sha256"]) == 64 for meta in snapshot.files.values())


def test_loader_subsets_are_deterministic():
    a = load_snapshot(PILOT, limit=3)
    b = load_snapshot(PILOT, limit=3)
    assert [t["id"] for t in a.candidates] == [t["id"] for t in b.candidates]
    assert [t["id"] for t in a.candidates] == sorted(t["id"] for t in a.candidates)
    one = load_snapshot(PILOT, ids=["PILOT_ICELAND"])
    assert [t["id"] for t in one.candidates] == ["PILOT_ICELAND"]
    with pytest.raises(ContractError):
        load_snapshot(PILOT, ids=["NOT_A_SITE"])


def test_loader_requires_core_files(tmp_path):
    snap = _copy_pilot(tmp_path)
    (snap / "targets.json").unlink()
    with pytest.raises(ContractError):
        load_snapshot(snap)


def test_loader_skips_controls_with_reason(tmp_path):
    snap = _copy_pilot(tmp_path)
    data = json.loads((snap / "earth_candidates.json").read_text(encoding="utf-8"))
    data["tiles"][0]["pool"] = "control"
    data["tiles"][0]["id"] = "CT_" + data["tiles"][0]["id"]
    data["tiles_hash"] = tiles_hash([t["id"] for t in data["tiles"]])
    (snap / "earth_candidates.json").write_text(json.dumps(data), encoding="utf-8")
    loaded = load_snapshot(snap)
    assert len(loaded.candidates) == 8
    assert loaded.skipped[0]["id"].startswith("CT_") and "excluded" in loaded.skipped[0]["reason"]
    assert loaded.results_consistent is None  # no results.json copied


def test_recomputed_engine_matches_committed_results(snapshot):
    assert snapshot.results_consistent is True
    assert engine_matches_committed(snapshot) is True


def test_documents_validate_and_cover_every_profile(docs):
    assert len(docs) == 9  # MOON_BASE_OPS O1–O5 + MARS_SURFACE_OPS M1–M4
    for doc in docs:
        validate_document(doc)
        assert doc["status"] == "DRAFT"
        assert doc["mission_profile"]["id"].split("/")[0] in {"MOON_BASE_OPS", "MARS_SURFACE_OPS"}


def test_ranking_order_and_ineligible_last(docs):
    for doc in docs:
        ranks = [c["rank"] for c in doc["candidates"]]
        eligible = [r for r in ranks if r is not None]
        assert eligible == list(range(1, len(eligible) + 1))
        assert all(r is None for r in ranks[len(eligible):])
        scores = [c["components"]["deterministic_fidelity"]["value"] for c in doc["candidates"][:len(eligible)]]
        assert scores == sorted(scores, reverse=True)


def test_log_contributions_decompose_log_f(docs):
    for doc in docs:
        for c in doc["candidates"]:
            F = c["components"]["deterministic_fidelity"]["value"]
            if F is None or F <= 1e-6:
                continue
            total = sum(a["log_contribution"] for a in c["explanation"]["attributes"]
                        if a["log_contribution"] is not None)
            assert math.isclose(total, math.log(F), rel_tol=1e-9, abs_tol=1e-9)


def test_missing_climate_is_not_available_not_zero(docs):
    cold = next(d for d in docs if d["mission_profile"]["id"] == "MOON_BASE_OPS/O5")
    for c in cold["candidates"]:
        env = c["components"]["environmental_similarity"]
        assert env["status"] == "not_available" and env["value"] is None
        assert c["components"]["deterministic_fidelity"]["value"] is None
    for doc in docs:
        for c in doc["candidates"]:
            for name in ("learned_similarity", "geological_similarity", "novelty"):
                assert c["components"][name]["status"] == "not_available"


def test_water_dominated_window_is_ineligible_by_constraint(docs):
    landing = next(d for d in docs if d["mission_profile"]["id"] == "MARS_SURFACE_OPS/M1")
    kz = next(c for c in landing["candidates"] if c["aoi_id"] == "KZ_E051.200_N43.400")
    assert kz["eligible"] is False and kz["ineligible_reason"] == "constraint"
    assert kz["components"]["operational_suitability"]["value"] is False


def test_inference_is_deterministic():
    a = build_documents(load_snapshot(PILOT), FAST, created_at=FIXED)
    b = build_documents(load_snapshot(PILOT), FAST, created_at=FIXED)
    assert a == b


def test_stability_respects_seed(snapshot):
    target = snapshot.targets["MARS_JEZERO"]
    objective = snapshot.templates["MARS_SURFACE_OPS"]["objectives"][0]
    config = {**DEFAULT_CONFIG, "stability_draws": 30}
    one, two = stability(snapshot, target, objective, config), stability(snapshot, target, objective, config)
    assert one == two
    for value in one.values():
        if value:
            assert 0 <= value["top1_frequency"] <= value["topk_frequency"] <= 1


def test_schema_rejects_placeholder_values(docs):
    bad = copy.deepcopy(docs[0])
    bad["candidates"][0]["components"]["novelty"]["value"] = 0.5
    with pytest.raises(jsonschema.ValidationError):
        validate_document(bad)
