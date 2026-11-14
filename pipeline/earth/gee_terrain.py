# Written with AI assistance (Codex); human review pending.
"""Earth Engine DEM downloads measured by the shared Python terrain algorithm.

For larger pools use cached per-tile rasters; this adapter avoids subtly different
server-side slope definitions. It does not claim a completed global GEE export.
"""
import argparse
import io
import json
import urllib.request
import zipfile
from pathlib import Path

import rasterio
from rasterio.io import MemoryFile

from pipeline.common.terrain import terrain_attributes
from pipeline.earth.pool import initialize_ee, square_coordinates, utm_epsg
from pipeline.planets.access import to_local_grid


def rename_attributes(attrs, baseline):
    renamed = {}
    for key, value in attrs.items():
        name = key.replace("slope_f_", f"slope_f{baseline}_").replace("_f_m", f"_f{baseline}_m")
        if name.endswith("_f"):
            name += str(baseline)
        renamed[name] = value
    return renamed


def download_dem(lon, lat, *, p=200, half_m=11000, project=None, out=None):
    ee = initialize_ee(project)
    region = ee.Geometry.Polygon([square_coordinates(lon, lat, 2*half_m)], geodesic=False)
    crs = f"EPSG:{utm_epsg(lon, lat)}"
    image = ee.ImageCollection("COPERNICUS/DEM/GLO30").select("DEM").mosaic().setDefaultProjection("EPSG:4326", None, 30)
    # Explicit average aggregation, never ee.Terrain.slope on a different base.
    valid = image.mask().unmask(0).reduceResolution(ee.Reducer.min(), maxPixels=4096).reproject(crs, None, p)
    image = image.reduceResolution(ee.Reducer.mean(), maxPixels=4096).reproject(crs, None, p).updateMask(valid.eq(1))
    url = image.getDownloadURL({"region": region, "scale": p, "crs": crs, "format": "GEO_TIFF", "filePerBand": False})
    with urllib.request.urlopen(url, timeout=90) as response:
        content = response.read()
    if content[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            content = archive.read(next(n for n in archive.namelist() if n.endswith(".tif")))
    if out:
        out = Path(out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(content)
    with MemoryFile(content) as mem, mem.open() as src:
        z = src.read(1, masked=True, out_dtype="float32").filled(float("nan"))
        return to_local_grid(z, src.transform, src.crs, (lon, lat), "earth", p, half_m)


def _stage(fc, baseline, project=None):
    features = fc.getInfo()["features"] if hasattr(fc, "getInfo") else fc
    rows = []
    for feature in features:
        props = feature.get("properties", feature)
        z = download_dem(props["lon"], props["lat"], p=baseline/2, project=project)
        attrs = rename_attributes(terrain_attributes(z, baseline/2), baseline)
        if baseline == 100:
            attrs = {key: value for key, value in attrs.items() if "f100" in key}
        rows.append({"id": props["id"], "attrs": attrs})
    return rows


def stage_a(fc, zone=None, *, project=None):
    return _stage(fc, 400, project)


def stage_b(fc, zone=None, *, project=None):
    return _stage(fc, 100, project)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pool")
    parser.add_argument("--stage", choices=["a", "b"], default="a")
    parser.add_argument("--project")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    try:
        data = json.loads(Path(args.pool).read_text())
        result = (stage_a if args.stage == "a" else stage_b)(data["features"], project=args.project)
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, indent=2, allow_nan=False))
        print(out)
    except (RuntimeError, OSError, rasterio.errors.RasterioError) as exc:
        parser.exit(2, f"Earth DEM acquisition failed: {exc}\n")


if __name__ == "__main__":
    main()
