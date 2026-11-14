# Written with AI assistance (Codex); human review pending.
import numpy as np
import pytest
from pyproj import Transformer

from pipeline.earth.gee_env import lst_c, monthly_precip_mm
from pipeline.earth.gee_terrain import rename_attributes
from pipeline.earth.pool import initialize_ee, square_coordinates, tile_id, utm_epsg


def test_utm_square_and_ids():
    for lon, lat in [(51.2, 43.4), (-111.6, 35.5), (161.5, -77.5)]:
        ring = square_coordinates(lon, lat)
        tr = Transformer.from_crs(4326, utm_epsg(lon, lat), always_xy=True)
        xy = np.array([tr.transform(*p) for p in ring])
        np.testing.assert_allclose(np.linalg.norm(np.diff(xy, axis=0), axis=1), 20000, atol=.01)
        assert tile_id(lon, lat) == tile_id(lon, lat)
    assert utm_epsg(180, 0) == 32660
    assert utm_epsg(10, 78) == 32633


def test_source_unit_conversions():
    assert lst_c(15000) == pytest.approx(26.85)
    assert monthly_precip_mm(1, 2024, 2) == 696
    assert lst_c(None) is None
    assert monthly_precip_mm(None, 2025, 2) is None
    assert rename_attributes({"slope_f_p50_deg": 5, "tri_f_m": 2, "frac_lt10_f": .8}, 100) == {
        "slope_f100_p50_deg": 5, "tri_f100_m": 2, "frac_lt10_f100": .8}


def test_missing_gee_project_gives_actionable_blocker(monkeypatch):
    monkeypatch.delenv("EE_PROJECT", raising=False)
    with pytest.raises(RuntimeError, match="EE_PROJECT"):
        initialize_ee()
