"""Acquire spec-defined surface temperature and precipitation for a geospatial release.

Runs the existing ``pipeline.earth.gee_env.environment`` (MODIS MOD11A2+MYD11A2
LST P5 night / P95 day 2015–2024, GPM IMERG V07 annual mean 2001–2024) over the
22 km footprints of the Earth AOIs in ``aoi_catalog.json`` and writes a
separate, versioned supplement. Land cover from Earth Engine is discarded: the
release already carries ESA WorldCover and the two are not mixed.

Usage (needs ``earthengine authenticate`` and a registered project)::

    python tools/acquire_env_supplement.py --project <EE project id> \
        --geo data/geo/geo-0.1.0 --out data/env/env-0.1.0

Written with AI assistance (Claude Code); human review pending.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline.earth.gee_env import environment  # noqa: E402
from pipeline.earth.pool import initialize_ee  # noqa: E402

KEEP = ("t_min_c", "t_max_c", "precip_mm")
PROVENANCE = [
    {"variable": "t_min_c", "dataset": "MODIS/061/MOD11A2 + MODIS/061/MYD11A2 LST_Night_1km",
     "provider": "NASA LP DAAC via Google Earth Engine", "version": "061",
     "method": "QA bits 0-1 == 0; per-pixel 5th percentile over 2015-2024; mean over AOI footprint at 1 km",
     "evidence": "observed", "url": "https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MOD11A2"},
    {"variable": "t_max_c", "dataset": "MODIS/061/MOD11A2 + MODIS/061/MYD11A2 LST_Day_1km",
     "provider": "NASA LP DAAC via Google Earth Engine", "version": "061",
     "method": "QA bits 0-1 == 0; per-pixel 95th percentile over 2015-2024; mean over AOI footprint at 1 km",
     "evidence": "observed", "url": "https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MOD11A2"},
    {"variable": "precip_mm", "dataset": "NASA/GPM_L3/IMERG_MONTHLY_V07 precipitation",
     "provider": "NASA GES DISC via Google Earth Engine", "version": "V07",
     "method": "monthly rate x hours, annual sums 2001-2024, mean of years; mean over AOI footprint at 11 km",
     "evidence": "derived", "url": "https://developers.google.com/earth-engine/datasets/catalog/NASA_GPM_L3_IMERG_MONTHLY_V07"},
]


def _features(ee, aois):
    return ee.FeatureCollection([
        ee.Feature(ee.Geometry.Polygon([aoi["footprint"]["ring_lonlat"]], None, False), {"id": aoi["aoi_id"]})
        for aoi in aois
    ])


def _clean(value):
    if isinstance(value, (int, float)) and math.isfinite(value):
        return round(float(value), 4)
    return None


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True)
    parser.add_argument("--geo", default="data/geo/geo-0.1.0")
    parser.add_argument("--out", default="data/env/env-0.1.0")
    parser.add_argument("--batch", type=int, default=40)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--workers", type=int, default=4, help="concurrent Earth Engine requests")
    parser.add_argument("--deadline", type=int, default=300, help="seconds per Earth Engine request")
    args = parser.parse_args(argv)

    catalog_path = Path(args.geo) / "aoi_catalog.json"
    raw = catalog_path.read_bytes()
    catalog = json.loads(raw)
    aois = sorted((a for a in catalog["aois"] if a["body"] == "earth"), key=lambda a: a["aoi_id"])
    if args.limit:
        aois = aois[:args.limit]
    ee = initialize_ee(args.project)
    ee.data.setDeadline(args.deadline * 1000)  # a stalled request fails instead of hanging forever

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    partial = out / "partial.json"  # checkpoint: resume after a crash or hang, deleted on success
    rows = json.loads(partial.read_text(encoding="utf-8")) if partial.exists() else {}
    todo = [a for a in aois if a["aoi_id"] not in rows]
    print(f"{len(rows)} AOIs from checkpoint, {len(todo)} to acquire", flush=True)
    def acquire(chunk):
        for attempt in range(3):
            try:
                return environment(_features(ee, chunk), project=args.project)
            except Exception as error:  # Earth Engine transient errors, deadline
                if attempt == 2:
                    raise
                print(f"retry batch {chunk[0]['aoi_id']}: {error}", file=sys.stderr, flush=True)
                time.sleep(10 * (attempt + 1))

    chunks = [todo[i:i + args.batch] for i in range(0, len(todo), args.batch)]
    lock = threading.Lock()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for result in pool.map(acquire, chunks):
            with lock:
                for row in result:
                    rows[row["id"]] = {key: _clean(row["attrs"].get(key)) for key in KEEP}
                partial.write_text(json.dumps(rows), encoding="utf-8")
                print(f"{len(rows)}/{len(aois)}", flush=True)

    records = []
    for aoi in aois:
        values = rows.get(aoi["aoi_id"], {})
        record = {"aoi_id": aoi["aoi_id"], **{key: values.get(key) for key in KEEP}}
        record["missing"] = {key: "no valid observation over footprint after QA"
                             for key in KEEP if record[key] is None}
        records.append(record)

    doc = {
        "schema": "egiz.env_supplement", "schema_version": "0.1.0",
        "dataset_version": out.name, "synthetic": False,
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "base_release": {"dataset_version": catalog["dataset_version"],
                         "aoi_catalog_sha256": hashlib.sha256(raw).hexdigest()},
        "geometry": "AOI footprint.ring_lonlat (22 km window), geodesic=false",
        "code": "tools/acquire_env_supplement.py -> pipeline.earth.gee_env.environment",
        "provenance": PROVENANCE,
        "records": records,
    }
    (out / "environment.json").write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8", newline="\n")
    partial.unlink(missing_ok=True)
    missing = sum(1 for r in records for k in KEEP if r[k] is None)
    print(f"wrote {out / 'environment.json'}: {len(records)} AOIs, {missing} missing values")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
