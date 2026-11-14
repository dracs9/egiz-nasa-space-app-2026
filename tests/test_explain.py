"""Source-grounded explanation checks. Written with AI assistance (Codex); review pending."""

import copy
import json

import pytest

from pipeline.contracts.fixtures import generate
from pipeline.contracts.validate import validate_file
from pipeline.engine.explain import explain_campaign, main
from pipeline.engine.run import main as run_engine


def example():
    candidates = {"synthetic": False, "tiles": [{"id": "SITE", "pool": "global", "attrs": {
        "slope_f100_p90_deg": 3.141592653589793, "bare_frac": 0.8123456789, "precip_mm": None,
        "t_min_c": -273.15}}], "provenance": [{"dataset": "Observed dataset", "provider": "Provider",
        "version": "v1", "url": "https://example.org/source", "role": "terrain"}]}
    template = {"objectives": [
        {"id": "O1", "name": "Landing", "attributes": [{"attr": "slope_f100_p90_deg", "fn": "match"},
            {"attr": "bare_frac", "fn": "at_least", "params": {"a": 0.7}}, {"attr": "precip_mm", "fn": "at_most", "params": {"a": 50}}]},
        {"id": "O4", "name": "Low Sun", "attributes": [{"attr": "light", "fn": "light"}]},
    ]}
    run = {"fidelity": {"O1": {"SITE": {"F": 0.987654321, "partial": True,
        "parts": {"slope_f100_p90_deg": 0.912345678, "bare_frac": 1, "precip_mm": None}}},
        "O4": {"SITE": {"F": 0.1, "partial": False, "parts": {"light": 0.1}, "best_month": 3}}}}
    campaign = {"sites": [{"id": "SITE", "roles": ["O1"], "best_month": None}]}
    return campaign, run, candidates, template


def test_explanation_preserves_stored_values_sources_and_assigned_roles_only():
    args = example()
    before = copy.deepcopy(args)
    value = explain_campaign(*args)
    joined = "\n".join(value["SITE"])
    assert "3.141592653589793 degrees" in joined
    assert "0.8123456789 fraction of area" in joined
    assert "0.987654321" in joined and "0.912345678" in joined
    assert "at least 0.7 fraction of area" in joined
    assert "https://example.org/source" in joined and "Provider" in joined
    assert "Campaign role: Landing (O1)" in joined
    assert "Minimum surface temperature" not in joined and "-273.15" not in joined
    assert "Low Sun" not in joined and "March" not in joined
    assert "safe" not in joined.lower() and "suitable" not in joined.lower()
    assert args == before and explain_campaign(*args) == value


def test_missing_components_and_partial_flags_never_become_zero_scores():
    args = example()
    joined = "\n".join(explain_campaign(*args)["SITE"])
    assert "Annual precipitation: not assessed (value missing)" in joined
    assert "Component fidelity not assessed" in joined
    assert "partial data" in joined
    assert "Annual precipitation: 0" not in joined
    del args[1]["fidelity"]["O1"]["SITE"]["parts"]
    joined = "\n".join(explain_campaign(*args)["SITE"])
    assert "3.141592653589793 degrees" in joined
    assert "Component fidelity not assessed" in joined


def test_unassessed_roles_and_missing_site_and_synthetic_state_are_explicit():
    args = example()
    args[1]["fidelity"]["O1"]["SITE"] = {"F": None, "reason": "constraint"}
    args[2]["synthetic"] = True
    joined = "\n".join(explain_campaign(*args)["SITE"])
    assert "Synthetic demonstration" in joined
    assert "Fidelity not assessed (constraint)" in joined
    assert "3.141592653589793" not in joined
    args[2]["tiles"] = []
    assert "absent" in explain_campaign(*args)["SITE"][1]


def test_month_requires_an_assigned_light_role_and_uses_stored_month():
    args = example()
    args[0]["sites"][0]["roles"] = ["O4"]
    assert "Best low-Sun month in this result: March (3)." in explain_campaign(*args)["SITE"]
    args[1]["fidelity"]["O4"]["SITE"]["best_month"] = 13
    with pytest.raises(ValueError, match="best_month"):
        explain_campaign(*args)


def test_unknown_role_and_control_cannot_gain_an_explanation():
    args = example()
    args[0]["sites"][0]["roles"] = ["UNKNOWN"]
    with pytest.raises(ValueError, match="Unknown campaign role"):
        explain_campaign(*args)
    args = example()
    args[2]["tiles"][0]["pool"] = "control"
    with pytest.raises(ValueError, match="Control tile"):
        explain_campaign(*args)


def test_cli_separate_copy_is_valid_and_default_preserves_input(tmp_path, capsys):
    generate(output=tmp_path)
    paths = {name: tmp_path / f"{name}.json" for name in
             ("earth_candidates", "targets", "mission_templates", "sun_windows")}
    paths["out"] = tmp_path / "results.json"
    run_engine(paths)
    original = paths["out"].read_bytes()
    main(["--data-dir", str(tmp_path)])
    assert json.loads(capsys.readouterr().out)["runs"][0]["campaigns"][0]["explain"]
    assert paths["out"].read_bytes() == original
    out = tmp_path / "explained_results.json"
    main(["--data-dir", str(tmp_path), "--out", str(out)])
    assert validate_file(out)["runs"][0]["campaigns"][0]["explain"]
    assert paths["out"].read_bytes() == original
    with pytest.raises(SystemExit):
        main(["--data-dir", str(tmp_path), "--out", str(paths["out"])])
