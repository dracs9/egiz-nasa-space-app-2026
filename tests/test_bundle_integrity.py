"""Campaign explanations must agree with measured scores. AI assistance: Codex; review pending."""

import json
import shutil
from pathlib import Path

import pytest

from pipeline.contracts.validate import ContractError
from tools.check_bundle import NAMES, check_bundle


@pytest.mark.parametrize("corruption", ["score", "winner", "roles", "pool", "ceiling"])
def test_rejects_self_consistent_but_false_campaign_summary(tmp_path, corruption):
    source = Path(__file__).resolve().parents[1] / "data/fixtures"
    for name in NAMES:
        shutil.copyfile(source / f"{name}.json", tmp_path / f"{name}.json")
    path = tmp_path / "results.json"
    data = json.loads(path.read_text())
    run = data["runs"][0]
    campaign = run["campaigns"][0]
    if corruption == "score":
        campaign["per_objective"][0]["F"] += 0.001
        campaign["coverage"] += 0.001 / len(campaign["per_objective"])
    elif corruption == "winner":
        used = {site["id"] for site in campaign["sites"]}
        campaign["per_objective"][0]["site"] = next(id_ for id_ in
                    run["fidelity"][campaign["per_objective"][0]["objective"]]
                    if id_ not in used and "_CT_" not in id_)
    elif corruption == "roles":
        campaign["sites"][0]["roles"] = []
    elif corruption == "ceiling":
        run["gaps"]["objective_ceiling"][next(iter(run["fidelity"]))] = None
    else:
        campaign["method"]["pool_size"] += 1
    path.write_text(json.dumps(data))
    with pytest.raises(ContractError):
        check_bundle(tmp_path)
