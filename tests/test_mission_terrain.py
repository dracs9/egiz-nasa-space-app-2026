"""Mission terrain serialization geometry and nodata regression tests."""
import json
from pathlib import Path

import numpy as np

from pipeline.common.mission_terrain import grid_document


def test_metric_grid_centers_and_nodata():
    z = np.full((110, 110), 50.0)
    z[55, 55] = np.nan
    grid = grid_document(z)
    assert grid["side"] == 100
    assert grid["west_m"] == -9900
    assert grid["north_m"] == 9900
    assert grid["cell_m"] == 200
    assert grid["elevation_m"].count(None) == 1
    assert grid["valid_fraction"] == 0.9999


def test_pilot_has_matching_sources_and_fingerprints():
    base = Path(__file__).resolve().parents[1] / "data/pilot"
    mission = json.loads((base / "mission_terrain.json").read_text())
    evidence = json.loads((base / "terrain_evidence.json").read_text())
    assert mission["inputs"] == evidence["inputs"]
    assert len(mission["entries"]) == 11
    for entry in mission["entries"]:
        original = next(e for e in evidence["entries"] if e["id"] == entry["id"])
        assert entry["source"] == original["source"]
        assert entry["lon"] == original["lon"]
        assert entry["lat"] == original["lat"]
        assert entry["grid"]["side"] == 100
        assert len(entry["grid"]["elevation_m"]) == 10000
