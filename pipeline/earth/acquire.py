# Written with AI assistance (Codex); human review pending.
"""Run real Earth acquisition end to end; credentials and quotas are external.

This command never creates synthetic replacements. The dependency-injection
boundary exists for local orchestration tests, not for production fake data.
"""
import argparse
import json
import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pipeline.earth.export import export_candidates
from pipeline.earth.gee_env import environment
from pipeline.earth.gee_snow import snow_free_frac
from pipeline.earth.gee_terrain import stage_a, stage_b
from pipeline.earth.kz import build_kazakhstan_pool
from pipeline.earth.pool import build_pool


@dataclass(frozen=True)
class AcquisitionAdapters:
    pool: Callable[..., Any] = build_pool
    terrain_a: Callable[..., Any] = stage_a
    terrain_b: Callable[..., Any] = stage_b
    environment: Callable[..., Any] = environment
    snow: Callable[..., Any] = snow_free_frac
    kazakhstan: Callable[..., Any] = build_kazakhstan_pool


PROVENANCE = [
    {"dataset": "COPERNICUS/DEM/GLO30", "provider": "Copernicus Programme / ESA / Airbus",
     "version": "GLO-30", "url": "https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_DEM_GLO30", "role": "terrain; 100m/400m fine and 2km regional baselines"},
    {"dataset": "MODIS/061/MOD11A2 + MODIS/061/MYD11A2", "provider": "NASA LP DAAC",
     "version": "061", "url": "https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MOD11A2", "role": "P5 night/P95 day surface temperature", "period": "2015-2024"},
    {"dataset": "NASA/GPM_L3/IMERG_MONTHLY_V07", "provider": "NASA / JAXA",
     "version": "V07", "url": "https://developers.google.com/earth-engine/datasets/catalog/NASA_GPM_L3_IMERG_MONTHLY_V07", "role": "mean annual precipitation", "period": "2001-2024"},
    {"dataset": "ESA/WorldCover/v200", "provider": "ESA",
     "version": "v200", "url": "https://developers.google.com/earth-engine/datasets/catalog/ESA_WorldCover_v200", "role": "barren and constraint cover fractions", "period": "2021"},
    {"dataset": "MODIS/061/MCD12Q1", "provider": "NASA LP DAAC",
     "version": "061", "url": "https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MCD12Q1", "role": "barren fallback outside WorldCover observations", "period": "2021"},
    {"dataset": "USDOS/LSIB_SIMPLE/2017", "provider": "US Department of State",
     "version": "2017", "url": "https://developers.google.com/earth-engine/datasets/catalog/USDOS_LSIB_SIMPLE_2017", "role": "land sampling and national boundary"},
]


def _features(collection):
    if hasattr(collection, "getInfo"):
        collection = collection.getInfo()
    return collection["features"] if isinstance(collection, dict) else list(collection)


def _validate_rows(stage, rows, expected):
    rows = list(rows)
    ids = [row["id"] for row in rows]
    if len(set(ids)) != len(ids):
        raise ValueError(f"{stage}: duplicate tile IDs")
    if set(ids) != expected:
        missing = sorted(expected-set(ids))
        unknown = sorted(set(ids)-expected)
        raise ValueError(f"{stage}: tile IDs do not match pool (missing={missing[:3]}, unknown={unknown[:3]})")
    return rows


def acquire(*, project=None, count_per_stratum=1000, out_dir="data/processed",
            practice_csv="data/curated/practice_sites.csv", include_snow=False,
            controls_per_class=20, kazakhstan_count=0, adapters=None):
    """Acquire and merge observations, validating exact stage-to-pool ID matches.

    Adapters can be supplied by unit tests. Normal CLI uses only real adapters.
    Output directory is created only after every service stage returns, so an
    auth/network error cannot overwrite a previous candidate artifact.
    """
    project = project or os.environ.get("EE_PROJECT")
    if not project:
        raise RuntimeError("EE_PROJECT is required; pass --project or set EE_PROJECT after earthengine authenticate")
    if count_per_stratum < 1 or controls_per_class < 0 or kazakhstan_count < 0:
        raise ValueError("count_per_stratum must be >=1 and optional counts >=0")
    adapters = adapters or AcquisitionAdapters()
    counts = {key: count_per_stratum for key in ["hot_desert", "cold_polar", "other_open"]}
    features = _features(adapters.pool(n_per_stratum=counts, project=project,
                                      practice_csv=practice_csv, controls_per_class=controls_per_class))
    if kazakhstan_count:
        features.extend(_features(adapters.kazakhstan(count=kazakhstan_count, project=project)))
    metadata = [feature.get("properties", feature) for feature in features]
    expected = {row["id"] for row in metadata}
    if not expected or len(expected) != len(metadata):
        raise ValueError("pool must contain nonempty, unique tile IDs")
    if any(id_.startswith("FAKE_") for id_ in expected):
        raise ValueError("production acquisition cannot accept FAKE_ tile IDs")
    parts = [metadata]
    for name, adapter in [("terrain_a", adapters.terrain_a), ("terrain_b", adapters.terrain_b),
                          ("environment", adapters.environment)]:
        parts.append(_validate_rows(name, adapter(features, project=project), expected))
    provenance = list(PROVENANCE)
    if include_snow:
        parts.append(_validate_rows("snow", adapters.snow(features, project=project), expected))
        provenance.append({"dataset": "MODIS/061/MOD10A1", "provider": "NASA LP DAAC", "version": "061",
                           "url": "https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MOD10A1",
                           "role": "monthly observed snow-free fraction", "period": "2001-2024"})
    out_dir = Path(out_dir)
    path = export_candidates(parts, out_dir/"earth_candidates.json", provenance=provenance)
    # This report describes execution scope, rather than asserting validation.
    status = {"artifact": str(path), "synthetic": False, "stage_tile_counts": [len(part) for part in parts],
              "requested_per_geographic_stratum": count_per_stratum,
              "controls_per_class": controls_per_class, "kazakhstan_count": kazakhstan_count,
              "snow_observations_requested": include_snow,
              "limitations": ["Initial latitude-band strata are provisional; no verified volcano inventory",
                              "GEE transport/Python terrain is not independent E2b validation",
                              "Surface observations do not establish field-test suitability"]}
    (out_dir/"earth_acquisition_status.json").write_text(json.dumps(status, indent=2) + "\n")
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project")
    parser.add_argument("--count-per-stratum", type=int, default=1000)
    parser.add_argument("--out-dir", default="data/processed")
    parser.add_argument("--practice-csv", default="data/curated/practice_sites.csv")
    parser.add_argument("--controls-per-class", type=int, default=20)
    parser.add_argument("--kazakhstan-count", type=int, default=0)
    parser.add_argument("--snow", action="store_true")
    args = parser.parse_args()
    try:
        print(acquire(project=args.project, count_per_stratum=args.count_per_stratum,
                      out_dir=args.out_dir, practice_csv=args.practice_csv, include_snow=args.snow,
                      controls_per_class=args.controls_per_class, kazakhstan_count=args.kazakhstan_count))
    except Exception as exc:
        # Service exceptions vary across ee/GDAL/urllib versions. Preserve the
        # specific stage exception, fail nonzero, and never generate fallback data.
        parser.exit(2, f"Earth acquisition failed: {type(exc).__name__}: {exc}\n")


if __name__ == "__main__":
    main()
