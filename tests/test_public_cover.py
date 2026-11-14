import numpy as np
import pytest

from pipeline.earth.public_cover import acquire_window, fractions, tile_url
from pipeline.planets.access import AccessError


def test_worldcover_classes_are_not_averaged_as_numbers():
    result = fractions(np.array([[10, 40, 50, 60], [70, 80, 95, 100]]))
    assert all(value == .125 for value in result.values())
    assert fractions(np.full((20, 20), 80))["water_frac"] == 1
    with pytest.raises(AccessError, match="coverage"):
        fractions(np.zeros((20, 20)))


def test_worldcover_tile_convention_uses_floor_for_negative_coordinates():
    assert "N42E051" in tile_url(51.2, 43.4)
    assert "S27W072" in tile_url(-69.5, -24.5)
    assert "N63W018" in tile_url(-16.5, 65.5)
    with pytest.raises(ValueError):
        tile_url(float("nan"), 0)


def test_measured_water_window_is_excluded_from_every_mission_objective():
    import json
    from pathlib import Path

    base = Path(__file__).resolve().parents[1] / "data" / "pilot"
    candidates = json.loads((base / "earth_candidates.json").read_text())
    wet_id = "KZ_E051.200_N43.400"
    wet = next(t for t in candidates["tiles"] if t["id"] == wet_id)
    assert wet["context"]["water_frac"] == pytest.approx(.958658)
    assert any(p["dataset"] == "ESA WorldCover 2021 v200" for p in candidates["provenance"])
    for run in json.loads((base / "results.json").read_text())["runs"]:
        for cells in run["fidelity"].values():
            assert cells[wet_id] == {"F": None, "reason": "constraint"}
        assert all(s["id"] != wet_id for c in run["campaigns"] for s in c["sites"])


def test_cached_landcover_refuses_a_wrong_footprint_even_with_same_source_tile(tmp_path):
    import rasterio
    from rasterio.transform import from_origin

    path = tmp_path / "wrong_window.tif"
    with rasterio.open(path, "w", driver="GTiff", width=1, height=1, count=1,
                       crs="EPSG:4326", dtype="uint8", transform=from_origin(51, 44, .001, .001)) as dst:
        dst.write(np.array([[80]], dtype=np.uint8), 1)
        dst.update_tags(source_url=tile_url(51.2, 43.4))
    with pytest.raises(AccessError, match="footprint"):
        acquire_window(51.2, 43.4, path)
