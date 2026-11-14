"""CSV diagnostics. Written with AI assistance (Codex); human review pending."""

import csv

import pytest

from pipeline.contracts.validate import validate_data
from pipeline.engine.templates import load_templates


def test_curated_templates_compile_and_match_contract(monkeypatch):
    monkeypatch.setenv("SOURCE_DATE_EPOCH", "1792022400")
    first = load_templates("data/curated/mission_templates.csv", "data/curated/gap_alternatives.csv")
    assert first == load_templates("data/curated/mission_templates.csv", "data/curated/gap_alternatives.csv")
    validate_data(first)
    assert {t["id"] for t in first["templates"]} == {"MOON_BASE_OPS", "MARS_SURFACE_OPS"}
    assert len(first["templates"][0]["objectives"]) >= 4


def test_csv_errors_include_line_and_reject_unregistered_attribute(tmp_path):
    path = tmp_path / "mission.csv"
    fields = ["template_id", "body", "objective_id", "objective_name", "description", "weight_default",
              "attr", "fn", "params", "weight", "needs_target", "priority"]
    with path.open("w", newline="") as source:
        writer = csv.DictWriter(source, fieldnames=fields)
        writer.writeheader()
        writer.writerow(dict(zip(fields, ["MOON", "moon", "O1", "Test", "Description", 1,
                                         "invented_attr", "match", "sigma=1", 1, "true", "P0"])))
    with pytest.raises(ValueError, match=r"line 2: Unknown attribute"):
        load_templates(path, "data/curated/gap_alternatives.csv")
