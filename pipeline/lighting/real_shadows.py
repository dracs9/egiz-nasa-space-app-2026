# Written with AI assistance (Claude Code); reviewed by: pending (Geo lead).
"""Terrain shadowing on REAL DEM grids, in two explicitly separated modes.

1. ``controlled_same_incidence``: identical solar elevations/azimuths applied to
   each body's measured local grid (50 m pixels, central 10 km analysis mask),
   using pipeline.common.shadows.shadow_fraction_curve unchanged. This isolates
   terrain geometry; it is NOT a claim that the illumination environments match.
2. ``actual_local_sun``: the Sun the site really gets. Earth: NOAA algorithm
   (pipeline.common.sun.sun_position) over a year at 10 min steps, plus shadow
   fraction at the real solstice-noon / low-sun geometry. Moon: only the
   geometric bound h_max = 90 - |lat| + 1.54 deg (pipeline.common.sun.h_max_moon);
   a full SPICE time series is not computed here (spiceypy not installed) and is
   reported as missing.

Shadows only see terrain inside the 22 km grid: distant horizons are ignored, so
at very low Sun shadow fractions are lower bounds (stated in the output).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import rasterio

from pipeline.common.shadows import cast_shadow, shadow_fraction_curve
from pipeline.common.sun import h_max_moon, sun_position
from pipeline.geodata import DATASET_VERSION, DERIVED, RELEASE, ROOT, SCHEMA_VERSION
from pipeline.geodata.cache import sha256_file

H_DEG = [1.5, 3, 5, 10, 20]
AZ_DEG = [0, 90, 180, 270]
P = 50


def _grid(aoi_id):
    path = DERIVED / "grids" / f"{aoi_id}_p{P}.tif"
    with rasterio.open(path) as src:
        return src.read(1).astype(float), path


def central_mask(shape, p=P, half=5000):
    rows, cols = np.indices(shape)
    return (np.abs(rows - (shape[0] - 1) / 2) * p < half) & (np.abs(cols - (shape[1] - 1) / 2) * p < half)


def earth_sun_stats(lat, lon, year=2025, step_min=10):
    times = np.arange(np.datetime64(f"{year}-01-01"), np.datetime64(f"{year + 1}-01-01"),
                      np.timedelta64(step_min, "m"))
    alt, az = sun_position(lat, lon, times)
    day = alt > 0
    noon_max = float(alt.max())
    return {"year": year, "step_min": step_min, "algorithm": "NOAA (pipeline.common.sun.sun_position), refraction on",
            "sun_up_frac": float(day.mean()),
            "daylight_low_sun_lt5deg_frac": float(((alt > 0) & (alt < 5)).sum() / max(day.sum(), 1)),
            "annual_max_elevation_deg": noon_max, "min_daily_max_elevation_deg": float(
                alt.reshape(-1, 1440 // step_min).max(axis=1).min())}


def build(aoi_ids_earth, moon_id="MOON_MONS_MOUTON", out=None):
    catalog = {a["aoi_id"]: a for a in json.loads((RELEASE / "aoi_catalog.json").read_text(encoding="utf-8"))["aois"]}
    items = []
    for aid in [moon_id, *aoi_ids_earth]:
        if aid not in catalog:
            continue
        a = catalog[aid]
        z, path = _grid(aid)
        mask = central_mask(z.shape)
        if np.isfinite(z[mask]).mean() < .99:
            items.append({"aoi_id": aid, "status": "skipped", "reason": "analysis mask not fully valid"})
            continue
        sf = shadow_fraction_curve(z, P, mask, H_DEG, AZ_DEG)
        item = {"aoi_id": aid, "body": a["body"], "grid": path.relative_to(ROOT).as_posix(),
                "grid_sha256": sha256_file(path),
                "controlled_same_incidence": {"h_deg": H_DEG, "az_deg": AZ_DEG,
                                              "shadow_frac": np.round(sf, 4).tolist(),
                                              "mean_over_az": np.round(sf.mean(axis=1), 4).tolist()}}
        lat, lon = a["centroid"]["lat"], a["centroid"]["lon"]
        if a["body"] == "earth":
            stats = earth_sun_stats(lat, lon)
            # Real low-Sun geometry: Sun at 5 deg toward the equator-side azimuth (illustrative actual case).
            az = 180.0 if lat >= 0 else 0.0
            stats["shadow_frac_at_5deg_equatorward"] = float(cast_shadow(z, P, 5, az)[mask].mean())
            item["actual_local_sun"] = stats
        else:
            item["actual_local_sun"] = {
                "h_max_deg_bound": h_max_moon(lat), "method": "geometric bound 90-|lat|+1.54 deg (lunar obliquity "
                "1.54 deg); Sun circles the horizon over a ~29.5 d synodic day",
                "missing": "SPICE time series not computed in this release (spiceypy not installed)"}
        items.append(item)
    data = {"schema_version": SCHEMA_VERSION, "dataset_version": DATASET_VERSION, "synthetic": False,
            "pixel_m": P, "analysis_mask": "central 10 km x 10 km", "horizon": "terrain inside 22 km window only; "
            "shadow fractions at h<=3 deg are lower bounds", "shadow_function": "pipeline.common.shadows.cast_shadow "
            "(cast shadow OR self-shadow, facing < 0)",
            "interpretation": "controlled_same_incidence compares terrain geometry under identical Sun angles. It is "
            "not an equivalent illumination environment: the Moon's 29.5 d synodic day, 1.54 deg obliquity and "
            "absence of atmosphere (no diffuse skylight, no refraction) differ fundamentally from Earth's 24 h day, "
            "23.44 deg obliquity and scattering atmosphere. Mars (24.6 h sol, 25.2 deg obliquity, dusty thin "
            "atmosphere) is not included in this release because its 200 m blended DEM is too coarse for 50 m "
            "shadow grids.", "items": items}
    out = Path(out or RELEASE / "illumination" / "real_dem_shadows.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(data, indent=1, allow_nan=False) + "\n")
    return out


def main():
    catalog = json.loads((RELEASE / "aoi_catalog.json").read_text(encoding="utf-8"))["aois"]
    earth = [a["aoi_id"] for a in catalog if a["body"] == "earth" and a["pool"] == "pilot"]
    print(build(earth))


if __name__ == "__main__":
    main()
