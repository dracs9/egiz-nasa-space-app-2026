"""Contracts reject broken or misrepresented datasets. AI assistance: Codex; review pending."""

import copy
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from pipeline.contracts.fixtures import ROOT, generate
from pipeline.contracts.validate import ContractError, validate_data, validate_file


@pytest.fixture(scope="module")
def bundle():
    return generate()


def test_schemas_are_valid():
    for path in (ROOT / "contracts").glob("*.schema.json"):
        Draft202012Validator.check_schema(json.loads(path.read_text()))


def test_all_fixtures_validate(bundle):
    for data in bundle.values():
        assert validate_data(data) is data


@pytest.mark.parametrize("mutation", ["major", "duplicate", "fraction", "missing", "nan"])
def test_rejects_corrupt_inputs(bundle, mutation):
    data = copy.deepcopy(bundle["earth_candidates"])
    if mutation == "major":
        data["version"] = "2.0.0"
    elif mutation == "duplicate":
        data["tiles"].append(data["tiles"][0])
    elif mutation == "fraction":
        data["tiles"][0]["attrs"]["bare_frac"] = 1.1
    elif mutation == "missing":
        data["tiles"][0]["attrs"]["t_min_c"] = None
    elif mutation == "nan":
        data["tiles"][0]["attrs"]["t_min_c"] = float("nan")
    with pytest.raises(ContractError):
        validate_data(data)


def test_processed_rejects_synthetic_even_without_cli_flag(tmp_path, bundle):
    path = tmp_path / "processed" / "targets.json"
    path.parent.mkdir()
    path.write_text(json.dumps(bundle["targets"]))
    with pytest.raises(ContractError, match="synthetic=false"):
        validate_file(path)


def test_false_flag_does_not_hide_fake_ids(bundle):
    data = copy.deepcopy(bundle["targets"])
    data["synthetic"] = False
    with pytest.raises(ContractError, match="FAKE_"):
        validate_data(data, production=True)


def test_fixtures_cannot_be_generated_into_processed(tmp_path):
    with pytest.raises(ValueError, match="processed"):
        generate(output=tmp_path / "processed")


def test_unknown_schema_cannot_escape_schema_directory():
    with pytest.raises(ContractError):
        validate_data({"schema": "egiz.../../pyproject"})


def test_sun_rows_align_to_latitude_bins(bundle):
    data = copy.deepcopy(bundle["sun_windows"])
    data["targets"][0]["hours_low"].pop()
    with pytest.raises(ContractError, match="row count"):
        validate_data(data)


def test_sun_bins_must_match_lookup_grid(bundle):
    data = copy.deepcopy(bundle["sun_windows"])
    data["lat_bins"][20] += 0.01
    with pytest.raises(ContractError, match="band centres"):
        validate_data(data)


def test_template_requires_positive_objective_weight(bundle):
    data = copy.deepcopy(bundle["mission_templates"])
    for objective in data["templates"][0]["objectives"]:
        objective["weight_default"] = 0
    with pytest.raises(ContractError, match="weight"):
        validate_data(data)


def test_fixture_generation_is_deterministic(tmp_path, bundle):
    first, second = tmp_path / "a", tmp_path / "b"
    generate(output=first)
    generate(output=second)
    for path in first.glob("*.json"):
        assert path.read_bytes() == (second / path.name).read_bytes()
    assert generate(seed=43)["earth_candidates"] != bundle["earth_candidates"]


def test_committed_bundle_integrity():
    from tools.check_bundle import check_bundle

    check_bundle(Path(ROOT) / "data/fixtures")


def test_power_observations_contract_units_and_provenance():
    schema = json.loads((ROOT / "contracts/power_observations.schema.json").read_text())
    data = json.loads((ROOT / "contracts/examples/power_observations.json").read_text())
    validator = Draft202012Validator(schema)
    validator.validate(data)
    data["units"]["bus_current_a"] = "mA"
    assert list(validator.iter_errors(data))
