"""Credential-free ESA WorldCover 2021 v200 context for the measured pilot.

Categorical nearest-neighbor reprojection on a 20 km UTM square, 10 m pixels.
Fractions are area proxies from a classified map, not ground-truth percentages.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.warp import reproject

from pipeline.planets.access import AccessError, local_crs, local_origin, read_window

CLASSES = {"tree_frac": 10, "crop_frac": 40, "built_frac": 50,
           "bare_frac": 60, "snow_frac": 70, "water_frac": 80}
VALID_CLASSES = {10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100}


def tile_url(lon, lat):
    if not math.isfinite(lon) or not math.isfinite(lat) or not -180 <= lon < 180 or not -80 <= lat <= 84:
        raise ValueError("WorldCover pilot requires valid longitude and UTM latitude")
    x, y = math.floor(lon / 3) * 3, math.floor(lat / 3) * 3
    tile = f"{'N' if y >= 0 else 'S'}{abs(y):02d}{'E' if x >= 0 else 'W'}{abs(x):03d}"
    return f"https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{tile}_Map.tif"


def fractions(classes):
    classes = np.asarray(classes)
    valid = np.isin(classes, list(VALID_CLASSES))
    if valid.mean() < .99:
        raise AccessError("WorldCover classified coverage below 99%; supply a complete tile mosaic")
    return {name: float(np.mean(classes[valid] == value)) for name, value in CLASSES.items()}


def acquire_window(lon, lat, out):
    url = tile_url(lon, lat)
    out = Path(out)
    x0, y0 = local_origin((lon, lat), "earth")
    transform = from_origin(x0 - 10000, y0 + 10000, 10, 10)
    target_crs = local_crs((lon, lat), "earth")
    if out.exists():
        with rasterio.open(out) as src:
            if src.tags().get("source_url") != url:
                raise AccessError("WorldCover cached source does not match coordinates")
            if (src.shape != (2000, 2000)
                    or src.crs != rasterio.crs.CRS.from_wkt(target_crs.to_wkt())
                    or not src.transform.almost_equals(transform, precision=1e-6)):
                raise AccessError("WorldCover cached footprint does not match the requested metric square")
            return fractions(src.read(1)), url
    source, affine, crs = read_window(url, lon, lat, 11000, "earth")
    dest = np.zeros((2000, 2000), dtype=np.uint8)
    reproject(source, dest, src_transform=affine, src_crs=crs, src_nodata=np.nan,
              dst_transform=transform, dst_crs=target_crs, dst_nodata=0,
              resampling=Resampling.nearest)
    result = fractions(dest)
    out.parent.mkdir(parents=True, exist_ok=True)
    temporary = out.with_suffix(".part.tif")
    with rasterio.open(temporary, "w", driver="GTiff", width=2000, height=2000, count=1,
                       dtype="uint8", crs=target_crs, transform=transform, nodata=0, compress="deflate") as dst:
        dst.write(dest, 1)
        dst.update_tags(source_url=url, dataset="ESA WorldCover 2021 v200", synthetic="false")
    temporary.replace(out)
    return result, url


def acquire(manifest):
    manifest = Path(manifest)
    with manifest.open(newline="", encoding="utf-8") as file:
        reader = csv.DictReader(file)
        fields, rows = list(reader.fieldnames), list(reader)
    report = []
    for row in rows:
        out = manifest.parent.parent / "raw" / "worldcover" / f"{row['id']}.tif"
        values, url = acquire_window(float(row["lon"]), float(row["lat"]), out)
        row.update(values, env_source_url=url, env_dataset="ESA WorldCover 2021 v200",
                   env_provider="ESA / WorldCover consortium", env_version="2021 v200")
        report.append({"id": row["id"], "url": url, "sha256": hashlib.sha256(out.read_bytes()).hexdigest(),
                       "fractions": values, "pixel_m": 10, "side_m": 20000,
                       "method": "Nearest-neighbor categorical reprojection to metric UTM; fractions of classified pixels"})
        print(row["id"], json.dumps(values), flush=True)
    fields.extend(key for key in [*CLASSES, "env_source_url", "env_dataset", "env_provider", "env_version"] if key not in fields)
    temporary = manifest.with_suffix(".part.csv")
    with temporary.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    temporary.replace(manifest)
    manifest.with_name("landcover_report.json").write_text(json.dumps({"synthetic": False,
        "dataset": "ESA WorldCover 2021 v200", "license": "CC BY 4.0",
        "citation": "Zanaga et al. 2022, ESA WorldCover 10 m 2021 v200, https://doi.org/10.5281/zenodo.7254221",
        "limitations": "Classification and resampling errors; 2021 snapshot, not present-day access or seasonal snow availability.",
        "windows": report}, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", default="data/pilot/earth_manifest.csv")
    acquire(parser.parse_args().manifest)


if __name__ == "__main__":
    main()
