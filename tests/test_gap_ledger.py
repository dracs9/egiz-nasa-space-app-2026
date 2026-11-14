"""Unknown ceilings differ from measured zero. AI assistance: Codex; review pending."""

import json

import numpy as np
import pytest

from pipeline.contracts.fixtures import envelope, generate
from pipeline.contracts.validate import ContractError, validate_data
from pipeline.engine.campaign import gap_ledger
from pipeline.engine.run import compute_run


@pytest.mark.parametrize("representation", ["cells", "values", "matrix"])
def test_objective_ceilings_preserve_unknown_zero_and_mixed_values(representation):
    values = {"UNKNOWN": [None, None], "ZERO": [None, 0], "MIXED": [None, 0.35]}
    if representation == "matrix":
        F = np.array(list(values.values()), dtype=float).T
    elif representation == "cells":
        F = {o: {str(i): {"F": value} for i, value in enumerate(column)} for o, column in values.items()}
    else:
        F = {o: dict(enumerate(column)) for o, column in values.items()}
    result = gap_ledger({}, F, [], objective_ids=list(values))
    assert result["objective_ceiling"] == {"UNKNOWN": None, "ZERO": 0, "MIXED": 0.35}
    assert result["attribute"] == []
    # JSON encoding must preserve the distinction for downstream clients.
    assert json.loads(json.dumps(result))["objective_ceiling"]["UNKNOWN"] is None
    assert json.loads(json.dumps(result))["objective_ceiling"]["ZERO"] == 0


@pytest.mark.parametrize("matrix", [False, True])
def test_empty_pool_has_unknown_objective_ceiling(matrix):
    F = np.empty((0, 2)) if matrix else {"O1": {}, "O2": {}}
    assert gap_ledger({}, F, [], objective_ids=["O1", "O2"])["objective_ceiling"] == {"O1": None, "O2": None}


def test_nonfinite_values_cannot_turn_unknown_into_a_measured_ceiling():
    F = np.array([[np.nan, np.nan], [np.inf, 0]])
    assert gap_ledger({}, F, [], objective_ids=["UNKNOWN", "ZERO"])["objective_ceiling"] == {"UNKNOWN": None, "ZERO": 0}


def _unassessed_result():
    bundle = generate()
    target = bundle["targets"]["targets"][0]
    template = next(t for t in bundle["mission_templates"]["templates"] if t["id"] in target["templates"])
    for tile in bundle["earth_candidates"]["tiles"]:
        tile["attrs"] = {}
        tile["missing"] = []
    run = compute_run(bundle["earth_candidates"], target, template)
    result = envelope("results") | {
        "engine_version": "1.0.0", "inputs": {name + "_sha256": "0" * 64 for name in
            ("earth_candidates", "targets", "templates", "sun_windows")}, "runs": [run],
    }
    return result


def test_unassessed_run_emits_valid_nullable_ceiling_contract():
    result = _unassessed_result()
    assert all(value is None for value in result["runs"][0]["gaps"]["objective_ceiling"].values())
    assert all(cell["F"] is None for cells in result["runs"][0]["fidelity"].values() for cell in cells.values())
    assert validate_data(result) is result
    ceiling = result["runs"][0]["gaps"]["objective_ceiling"]
    ceiling[next(iter(ceiling))] = 0.0
    assert validate_data(result) is result


@pytest.mark.parametrize("invalid", [-0.01, 1.01, "unknown"])
def test_nullable_ceiling_contract_still_rejects_invalid_scores(invalid):
    result = _unassessed_result()
    ceiling = result["runs"][0]["gaps"]["objective_ceiling"]
    ceiling[next(iter(ceiling))] = invalid
    with pytest.raises(ContractError, match="objective_ceiling"):
        validate_data(result)
