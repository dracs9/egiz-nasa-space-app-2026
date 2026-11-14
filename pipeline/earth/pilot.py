"""Reproduce a small, deliberately selected terrain pilot without credentials.

This is not a representative global sample or an externally validated analog list.
Acquisition preserves existing outputs on failure; no observations are invented.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path

import rasterio

from pipeline.earth.export import ingest_local
from pipeline.earth.public_dem import cache_public_window, public_tile_url


def acquire(manifest):
    manifest = Path(manifest)
    rows = list(csv.DictReader(manifest.open(encoding="utf-8", newline="")))
    report = []
    for row in rows:
        if row["source_url"] != public_tile_url(float(row["lon"]), float(row["lat"])):
            raise ValueError(f"{row['id']}: manifest URL does not match the public source tile")
        path = manifest.parent / row["dem"]
        cached = path.exists()
        if not cached:
            cache_public_window(float(row["lon"]), float(row["lat"]), path)
        with rasterio.open(path) as source:
            if source.tags().get("source_url") != row["source_url"]:
                raise ValueError(f"{row['id']}: cached raster source tag disagrees with manifest")
        report.append({"id": row["id"], "file": str(path), "source_url": row["source_url"],
                       "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "cached": cached})
        print(f"{row['id']}: {'cached' if cached else 'acquired'}", flush=True)
    output = manifest.with_name("earth_candidates.json")
    ingest_local(manifest, output)
    manifest.with_name("earth_acquisition_report.json").write_text(
        json.dumps({"synthetic": False, "sampling": "purposive regional windows; not global",
                    "rasters": report}, indent=2) + "\n", encoding="utf-8")
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", default="data/pilot/earth_manifest.csv")
    args = parser.parse_args()
    print(acquire(args.manifest))


if __name__ == "__main__":
    main()
