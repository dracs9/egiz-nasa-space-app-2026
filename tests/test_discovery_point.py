"""On-demand point analysis (pipeline.discovery.point)."""
import pytest

from pipeline.discovery import point as P
from pipeline.geodata import RAW


def test_point_id_and_validation():
    assert P.point_id("mars", -72.5, -7.0) == "PT_MARS_W072.500_S07.000"
    assert P._validate("Mars", 10.12345, 5.0) == ("mars", 10.123, 5.0)
    for bad in [("venus", 0, 0), ("mars", 181, 0), ("moon", 0, 89.5), ("mars", float("nan"), 0)]:
        with pytest.raises(P.PointError):
            P._validate(*bad)


@pytest.mark.skipif(not (RAW / "usgs_mars_blend" / "windows" / "PT_MARS_W072.500_S07.000.tif").exists(),
                    reason="needs the cached Mars window (python -m pipeline.discovery point --body mars --lon -72.5 --lat -7)")
def test_point_result_matches_bundle_contract():
    r = P.analyze("mars", -72.5, -7.0, draws=16)
    t, s = r["target"], r["shard"]
    assert r["synthetic"] is False and t["body"] == "mars" and t["dimension_status"]["geology"] == "measured"
    assert t["dimension_status"]["surface_albedo"] == "measured" and "albedo_tes" in r["properties"]["values"]
    assert len(r["window_ids"]) == len(s["s50"][0]) == t["n_scored"]
    assert s["dims"] == list(t["dimension_status"])
    scores = [e["score"] for e in t["shortlist"]]
    assert scores and all(0 <= v <= 1 for v in scores)
    assert t["fingerprint"]["terrain"]["slope_f400_p50_deg"]["source"] == "USGS_MARS_BLEND"


def test_alphaearth_expand_ranks_by_cosine_and_skips_seed_surroundings(monkeypatch):
    import numpy as np

    from pipeline.discovery import alphaearth as AE
    V = np.zeros((4, 64))
    V[0, 0] = V[1, 0] = 1.0                  # seed and its 10 km neighbour: identical surface
    V[2, :2] = [0.8, 0.6]                     # far away, similar
    V[3, 1] = 1.0                             # far away, different
    monkeypatch.setitem(AE._index_cache, 1999, (["a", "b", "c", "d"], V, np.ones(4, bool)))
    out = AE.expand([("a", 1.0)], win_lon=np.array([0, 0.1, 50, 100.0]), win_lat=np.zeros(4), year=1999)
    assert out["status"] == "ok"
    assert [r["window"] for r in out["top"]] == ["c", "d"]      # a, b excluded (within 150 km of the seed)
    assert out["cosine"][:3] == [1.0, 1.0, 0.8]
    assert AE.expand([("zz", 1.0)], year=1999)["status"] == "no_seed_embedding"


def test_bridge_learns_a_linear_map_and_flags_extrapolation():
    import numpy as np

    from pipeline.discovery import bridge as BR
    rng = np.random.default_rng(0)
    n, p = 600, len(BR.FEATURES)
    X = rng.normal(size=(n, p))
    A = rng.normal(size=(p, 64))
    Y = X @ A + 0.05 * rng.normal(size=(n, 64))
    lon, lat = rng.uniform(-180, 180, n), rng.uniform(-60, 60, n)
    m = BR.fit(X, Y, lon, lat)
    assert m["cv_selected"]["cv_cosine_mean"] > 0.95 and m["cv_selected"]["skill"] > 0.5
    y, d2, _ = BR.predict(m, X[0])
    assert abs(np.linalg.norm(y) - 1) < 1e-6 and d2 < m["d2_p99"]
    _, d2_far, _ = BR.predict(m, X[0] + 25)
    assert d2_far > m["d2_p99"]


def test_inferred_geology_thresholds():
    from pipeline.discovery.planetary_props import infer_geology
    mare = infer_geology("moon", {"feo_wt_pct": {"value": 18.0}, "plagioclase_pct": {"value": 36.0}})[0]
    high = infer_geology("moon", {"feo_wt_pct": {"value": 5.0}, "plagioclase_pct": {"value": 80.0}})[0]
    dusty = infer_geology("mars", {"albedo_tes": {"value": 0.30}})[0]
    assert mare == ["basaltic_mafic", "impact_regolith"]
    assert high == ["anorthositic_highlands", "impact_regolith"]
    assert dusty == ["basaltic_mafic", "unconsolidated_surficial"]
