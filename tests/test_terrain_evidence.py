"""Numerical sanity checks, not external analog validation."""
import json
from pathlib import Path

import numpy as np
import pytest

from pipeline.common.evidence import summarize


@pytest.mark.parametrize("p", [50, 200])
def test_plane_evidence_preserves_scale_slope_and_profile(p):
    y, x = np.mgrid[:int(22000 / p), :int(22000 / p)]
    z = x * p * .1 + y * 0
    result = summarize(z, p)
    assert result["baseline_m"] == 2 * p
    assert result["core20_valid_fraction"] == 1
    assert len(result["surface"]["elevation_m"]) == 625
    profile = result["profile"]
    assert len(profile["elevation_m"]) == 10000 / p
    assert np.diff(profile["elevation_m"]) == pytest.approx(p * .1)
    hist = result["slope_histogram"]
    assert sum(hist["counts"]) == hist["valid_count"] == (10000 / p)**2
    # atan(.1) = 5.71 degrees, in [5, 10).
    assert hist["counts"][3] == hist["valid_count"]


def test_evidence_retains_missing_data_instead_of_drawing_flat_ground():
    z = np.zeros((440, 440))
    z[200:240, 200:240] = np.nan
    result = summarize(z, 50)
    assert None in result["surface"]["elevation_m"]
    assert None in result["profile"]["elevation_m"]
    assert result["slope_histogram"]["missing_count"] > 0
    assert sum(result["slope_histogram"]["counts"]) == result["slope_histogram"]["valid_count"]


def test_measured_evidence_histograms_agree_with_actual_scoring_attributes():
    base = Path(__file__).resolve().parents[1] / "data" / "pilot"
    evidence = json.loads((base / "terrain_evidence.json").read_text())
    candidates = json.loads((base / "earth_candidates.json").read_text())
    targets = json.loads((base / "targets.json").read_text())
    records = {r["id"]: r for r in candidates["tiles"] + targets["targets"]}
    for entry in evidence["entries"]:
        for baseline, grid in entry["grids"].items():
            histogram = grid["slope_histogram"]
            valid = histogram["valid_count"]
            for limit in (10, 20):
                key = f"frac_lt{limit}_f{baseline}"
                expected = records[entry["id"]]["attrs"].get(key)
                if expected is None:
                    continue
                edge = histogram["edges_deg"].index(limit)
                assert sum(histogram["counts"][:edge]) / valid == pytest.approx(expected, abs=1e-12)
