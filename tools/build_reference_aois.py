"""Build reference AOIs for the Stage 2 evaluation with the geo release code.

Runs ``pipeline.geodata`` from branch ``geo/data-foundation`` (the code that
produced geo-0.1.0) unchanged, for every testable reference site that has a
sourced coordinate, and writes a small release in the same format as
geo-0.1.0 (``aoi_catalog.json``, ``aoi_features.csv``, columns, manifests).
It computes attributes only. Nothing here ranks or scores a reference AOI,
so it may run before the pre-registration is frozen.

Must be run from a checkout of geo/data-foundation, because its ``pipeline``
package is the one imported::

    cd <geo worktree>
    PYTHONPATH=. python <this repo>/tools/build_reference_aois.py \
        --sites <this repo>/data/ml/reference/reference_sites-0.1.0.csv \
        --out <this repo>/data/ml/reference/ref-aois-0.1.0

Written with AI assistance (Claude Code); human review pending.
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from pipeline.geodata import DATASET_VERSION, DERIVED, RAW, ROOT
from pipeline.geodata.aois import AOI, earth_group
from pipeline.geodata.catalog import build_release
from pipeline.geodata.features import process, save_record
from pipeline.geodata.rasters import copernicus_tiles

VERSION = "ref-0.1.0"


def reference_aois(sites_csv: Path) -> list[AOI]:
    seen, out = set(), []
    for row in csv.DictReader(sites_csv.open(encoding="utf-8")):
        if row["testable"] != "true" or not row["lat"] or row["site_id"] in seen:
            continue
        seen.add(row["site_id"])
        lon, lat = float(row["lon"]), float(row["lat"])
        out.append(AOI(aoi_id=f"RF_{row['site_id']}", site_id=f"SITE_REF_{row['site_id']}", group_id=earth_group(lon, lat),
                       body="earth", name=row["name"], region=row["name"], lon=lon, lat=lat, pool="reference",
                       notes=[f"reference site from {sites_csv.name}; coord_source_key={row['coord_source_key']}; "
                              f"coord_precision={row.get('coord_precision', '')}"]))
    return out


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sites", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args(argv)

    aois = reference_aois(Path(args.sites))
    tiles = copernicus_tiles(RAW)

    def one(aoi):
        record = process(aoi, tile_names=tiles)
        save_record(record)  # process() saves only when a stage runs; persist updated AOI metadata too
        status = {k: v["status"] for k, v in record["stages"].items()}
        print(f"{aoi.aoi_id}: {status}", flush=True)
        return status

    with ThreadPoolExecutor(args.workers) as pool:
        list(pool.map(one, aois))

    staging = DERIVED.parent / f"release-{VERSION}"
    if staging.exists():
        shutil.rmtree(staging)
    build_release(staging, {a.aoi_id for a in aois})
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    for path in staging.rglob("*"):
        if path.is_file() and path.suffix in {".json", ".csv", ".md"}:
            target = out / path.relative_to(staging)
            target.parent.mkdir(parents=True, exist_ok=True)
            # Files keep the builder's dataset_version (the geospatial schema only accepts geo-X.Y.Z);
            # this set is identified by its directory, pool="reference" and BUILD.json.
            target.write_text(path.read_text(encoding="utf-8"), encoding="utf-8", newline="\n")
    (out / "BUILD.json").write_text(json.dumps({
        "dataset_version": VERSION, "builder": "pipeline.geodata (geo/data-foundation)", "builder_commit": commit,
        "same_code_as": DATASET_VERSION,
        "dataset_version_in_files": f"{DATASET_VERSION} (builder constant; schema accepts only geo-X.Y.Z)",
        "sites_csv": Path(args.sites).name, "n_aois": len(aois),
        "note": "attributes only; no scores or ranks computed"}, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {out} ({len(aois)} reference AOIs, builder {commit[:7]})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
