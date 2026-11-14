"""Numerical verification of the actual CSPICE adapter, not mock geometry."""
import json

import numpy as np
import pytest

from pipeline.science.spice import KERNELS, ROOT, geometry, kernel_manifest

spice = pytest.importorskip("spiceypy")
pytestmark = pytest.mark.skipif(not (KERNELS / "de440s.bsp").exists(), reason="Optional official SPICE kernels not installed")


def site(body="mars", lat=18.4446, lon=77.4509):
    return {"id": "MARS_JEZERO", "body": body, "lat": lat, "lon": lon}


def test_real_cspice_vectors_match_independent_frame_projection():
    record = geometry(site(), "2026-11-14T00:00:00Z", 3600)
    assert "CSPICE_N0067" in record["engine"]
    sample = record["samples"][0]
    assert sample["elevationDeg"] == pytest.approx(2.911147423408694, abs=1e-10)
    for kernel in kernel_manifest():
        spice.furnsh(str(KERNELS / kernel["name"]))
    try:
        et = spice.str2et(record["epochUtc"])
        xyz, _ = spice.spkpos("SUN", et, "IAU_MARS", "NONE", "MARS BARYCENTER")
        surface = spice.latrec(3396.190, np.deg2rad(77.4509), np.deg2rad(18.4446))
        vector = np.asarray(xyz) - surface
        # The zenith angle definition is independent of adapter ENU basis implementation.
        altitude = 90 - np.rad2deg(spice.vsep(vector, surface))
        assert sample["elevationDeg"] == pytest.approx(altitude, abs=1e-11)
        assert np.linalg.norm(sample["sunEnu"]) == pytest.approx(1, abs=1e-14)
        assert sample["solarFluxWm2"] == pytest.approx(1361 / (np.linalg.norm(vector) / 149597870.7) ** 2)
        assert 500 < sample["solarFluxWm2"] < 600
        assert sample["earthRangeKm"] > 100_000_000
    finally:
        spice.kclear()


def test_catalog_reexecutes_to_same_numbers_and_covers_all_measured_sites():
    catalog = json.loads((ROOT / "data/pilot/spice_geometry.json").read_text())
    terrain = json.loads((ROOT / "data/pilot/mission_terrain.json").read_text())["entries"]
    assert {s["siteId"] for s in catalog["entries"]} == {s["id"] for s in terrain}
    for body in ["mars", "earth", "moon"]:
        original = next(g for g in catalog["entries"] if g["body"] == body)
        place = next(t for t in terrain if t["id"] == original["siteId"])
        computed = geometry(place, original["epochUtc"])
        assert computed == original
        assert len(computed["samples"]) == 145


def test_day_night_and_input_validation():
    g = geometry(site(), "2026-11-14T00:00:00Z")
    elevations = [s["elevationDeg"] for s in g["samples"]]
    assert min(elevations) < -40 and max(elevations) > 40
    for epoch in ["2026-11-14", "1990-01-01T00:00:00Z", "bad"]:
        with pytest.raises(ValueError):
            geometry(site(), epoch)
    with pytest.raises(ValueError):
        geometry(site(lat=100), "2026-11-14T00:00:00Z")
    assert spice.ktotal("ALL") == 0
