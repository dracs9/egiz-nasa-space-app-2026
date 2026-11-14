"""Build / verify the EGIZ ASTRAL world package for Mons Mouton (PGDA Site20v2).

python -m pipeline.world build    # writes data/world/moon-mons-mouton/
python -m pipeline.world verify   # rebuilds in memory and compares content hashes
"""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

import numpy as np

from pipeline.world import perception
from pipeline.world.codec import encode_classes, encode_elevation
from pipeline.world.geodesy import RADIUS_M, aeqd_to_lonlat
from pipeline.world.registry import PYTHON_MODELS
from pipeline.world.sun import series, summarize
from pipeline.world.terrain import (
    PyramidSpec,
    build_pyramid,
    check_spec,
    horizon_grid,
    native_grid,
    slope_deg,
)

ROOT = Path(__file__).resolve().parents[2]
SITE_ID = "MOON_MONS_MOUTON"
SOURCE = ROOT / "data/raw/targets/Site20v2_final_adj_5mpp_surf.tif"
OUT = ROOT / "data/world/moon-mons-mouton"
EPOCH = "2026-11-14T00:00:00Z"
SEED = 2026


def _site():
    entries = json.loads((ROOT / "data/pilot/mission_terrain.json").read_text())["entries"]
    site = next(s for s in entries if s["id"] == SITE_ID)
    return site


def _dump(obj) -> bytes:
    return (json.dumps(obj, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()


def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def build_world(write: bool = True) -> dict[str, bytes]:
    started = time.time()
    site = _site()
    files: dict[str, bytes] = {}
    fingerprint = _sha(SOURCE.read_bytes())
    if fingerprint != site["source"]["sha256"]:
        raise ValueError("LOLA source fingerprint differs from the scientific pilot record")
    spec = PyramidSpec()
    check_spec(spec)
    radius = RADIUS_M["moon"]
    lon0, lat0 = site["lon"], site["lat"]

    grid, origin = native_grid(SOURCE, lon0, lat0, spec)
    tiles = []
    for desc, blob in build_pyramid(grid, origin, spec):
        files[f"tiles/{desc['key']}.egt"] = blob
        tiles.append(desc)

    # Measured footprint crop (pixel centres -half .. half-5) shared by all analysis layers.
    m = spec.margin_px
    n = int(spec.footprint_m / spec.native_m)
    crop = grid[m:m + n, m:m + n]
    edge = -spec.half - spec.native_m / 2

    horizon, h_origin = horizon_grid(SOURCE, lon0, lat0)
    hblob, hoff, hscale = encode_elevation(horizon, finest=0.05)
    files["layers/horizon20.egt"] = hblob

    labels, units, unit_stats, feats = perception.terrain_units(crop, spec.native_m, 20.0, 6, SEED)
    files["layers/units20.egr"] = encode_classes(labels)

    craters = perception.detect_multires(crop, spec.native_m)
    regions, threshold = perception.anomaly_regions(feats, 20.0)

    def to_local(row, col, cell):
        return edge + (col + 0.5) * cell, -edge - (row + 0.5) * cell

    objects = []
    for i, c in enumerate(craters, 1):
        x, y = to_local(c["row"], c["col"], spec.native_m)
        lon, lat = aeqd_to_lonlat(x, y, lon0, lat0, radius)
        objects.append({
            "id": f"crater-{i:04d}", "type": "crater", "evidenceClass": "model-detected",
            "x": round(x, 2), "y": round(y, 2), "lon": round(float(lon), 7), "lat": round(float(lat), 7),
            "radius": round(c["diameter_m"] / 2, 2), "confidence": round(c["score"], 3),
            "properties": {"diameter_m": round(c["diameter_m"], 1), "depth_m": round(c["depth_m"], 2),
                           "depth_to_diameter": round(c["depth_to_diameter"], 4),
                           "rim_completeness": round(c["rim_completeness"], 3),
                           "rim_rise_m": round(c["rim_rise_m"], 2)},
            "provenance": {"modelId": "egiz.craters.dem-log", "input": "native LOLA 5 m (r <= 45 m) and its 10 m mean (r >= 65 m)",
                           "sourceSha256": fingerprint},
        })
    for i, r in enumerate(regions, 1):
        x, y = to_local(r["row"], r["col"], 20.0)
        lon, lat = aeqd_to_lonlat(x, y, lon0, lat0, radius)
        objects.append({
            "id": f"anomaly-{i:03d}", "type": "anomaly", "evidenceClass": "computational-hypothesis",
            "x": round(x, 2), "y": round(y, 2), "lon": round(float(lon), 7), "lat": round(float(lat), 7),
            "radius": round(float(np.sqrt(r["area_m2"] / np.pi)), 1),
            "confidence": None,
            "properties": {"area_m2": r["area_m2"], "meanMahalanobis": round(r["meanMahalanobis"], 2),
                           "drivers": r["drivers"]},
            "provenance": {"modelId": "egiz.anomaly.mahalanobis", "input": "20 m DEM features",
                           "sourceSha256": fingerprint},
        })
    objects.append({
        "id": "target-site-centre", "type": "reference", "evidenceClass": "reference",
        "x": 0.0, "y": 0.0, "lon": lon0, "lat": lat0, "radius": 0, "confidence": None,
        "properties": {"name": site["name"]},
        "provenance": {"modelId": None, "input": "EGIZ targets.json (PGDA Site20 extent centre)",
                       "sourceSha256": fingerprint},
    })

    illumination = series(site, EPOCH)
    files["illumination.json"] = _dump(illumination)
    slope20 = slope_deg(perception.block_mean(crop, 4), 20.0)
    perception_doc = {
        "schema": "egiz.world_perception", "version": "1.0.0", "seed": SEED,
        "units": {"modelId": "egiz.units.kmeans-geomorph", "layer": "layers/units20.egr",
                  "features": perception.FEATURES, "classes": units, **unit_stats},
        "craters": {"modelId": "egiz.craters.dem-log", "count": len(craters),
                    "radiiTestedM": [15, 22, 30, 45, 65, 95, 140, 200, 290, 420, 600], "minScore": 0.35,
                    "acceptance": perception.ACCEPT, "maxPeaksPerScale": 1500},
        "anomalies": {"modelId": "egiz.anomaly.mahalanobis", "count": len(regions),
                      "d2Threshold": round(threshold, 3), "quantile": 0.998},
        "slope20Percentiles": {str(p): round(float(np.percentile(slope20, p)), 3)
                               for p in (10, 50, 90, 99)},
    }
    files["perception.json"] = _dump(perception_doc)
    files["objects.json"] = _dump({"schema": "egiz.world_objects", "version": "1.0.0",
                                   "objects": objects})
    files["registry.json"] = _dump({"schema": "egiz.model_registry", "version": "1.0.0",
                                    "models": PYTHON_MODELS})

    layer_grid = {"west": edge, "north": -edge, "cell": 20.0, "width": labels.shape[1],
                  "height": labels.shape[0]}
    manifest = {
        "schema": "egiz.world_manifest", "version": "1.0.0", "synthetic": False,
        "id": "moon-mons-mouton", "siteId": SITE_ID, "name": "Mons Mouton plateau (PGDA Site20v2)",
        "body": "moon",
        "referenceFrame": {"body": "MOON_ME_DE421", "shape": "sphere", "radiusM": radius,
                           "verticalDatum": "Height above the 1 737 400 m reference sphere (PGDA LOLA)",
                           "mapProjection": f"+proj=aeqd +lat_0={lat0} +lon_0={lon0} +R={radius:.0f} +units=m",
                           "worldFrame": "Cartesian ENU tangent frame at the site centre (curvature applied)",
                           "originLonLat": [lon0, lat0]},
        "source": {"product": "PGDA LOLA 5 m/pixel Site20v2 surface", "url": site["source"]["url"],
                   "sha256": fingerprint, "citation": "Barker et al. 2021, Planet. Space Sci., "
                   "doi:10.1016/j.pss.2020.105119", "nativePostingM": 5.0,
                   "nativeCrs": "Polar stereographic (south), sphere R = 1 737 400 m"},
        "pyramid": {"footprintM": spec.footprint_m, "cells": spec.cells, "apron": 1,
                    "levels": spec.levels, "fullLevels": spec.full_levels,
                    "operationalBox": list(spec.operational),
                    "postingsM": [spec.posting(lv) for lv in range(spec.levels)],
                    "method": "Level 5 = native 5 m pixel values on the local AEQD grid (all-valid "
                              "area-average reprojection). Coarser levels = Gaussian prefilter "
                              "(sigma = posting/2) and decimation. Geometric error = max |bilinear tile "
                              "surface - native pixels| within the tile.",
                    "tiles": tiles},
        "layers": {
            "horizon": {"file": "layers/horizon20.egt", "cell": 20.0, "west": h_origin - 10.0,
                        "north": -h_origin + 10.0, "width": horizon.shape[1],
                        "height": horizon.shape[0], "quantization": {"offset": hoff, "scale": hscale},
                        "validFraction": round(float(np.isfinite(horizon).mean()), 4),
                        "purpose": "Shadow / horizon / line-of-sight ray marching (renderer and "
                                   "simulator use the same grid)"},
            "units": {"file": "layers/units20.egr", **layer_grid, "modelId": "egiz.units.kmeans-geomorph"},
        },
        "illumination": {"file": "illumination.json", **summarize(illumination)},
        "objects": {"file": "objects.json", "craters": len(craters), "anomalies": len(regions)},
        "perception": "perception.json", "registry": "registry.json",
        "evidenceClasses": {
            "measured": "Elevation posts from the native DEM (or filtered decimations of it).",
            "model-detected": "Output of a registered model on measured data; heuristic confidence.",
            "computational-hypothesis": "Statistical outlier; unverified candidate for inspection.",
            "illustrative": "Procedural visual detail; never used by analysis or physics.",
            "assumed": "Parameter value taken from literature or a scenario, not measured here.",
        },
        "missingData": [
            "No orthoimage (LROC NAC/WAC) is packaged; surface shading is computed from the DEM "
            "under SPICE illumination, not observed reflectance.",
            "No geologic, compositional, spectral or rock-abundance map is packaged for this footprint.",
            "No measured regolith mechanical properties at this site; terramechanics uses documented "
            "literature parameters (assumed).",
            "Terrain beyond the 26 km source raster is not modelled as an occluder.",
        ],
    }
    files["manifest.json"] = _dump(manifest)
    if write:
        for rel, blob in files.items():
            path = OUT / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(blob)
        total = sum(len(b) for b in files.values())
        print(f"World {manifest['id']}: {len(tiles)} tiles, {len(craters)} craters, "
              f"{len(regions)} anomaly regions, {total/1e6:.2f} MB in {time.time()-started:.1f}s")
    return files


def verify() -> bool:
    expected = {p.relative_to(OUT).as_posix(): _sha(p.read_bytes())
                for p in OUT.rglob("*") if p.is_file()}
    rebuilt = {k: _sha(v) for k, v in build_world(write=False).items()}
    diff = sorted(k for k in set(expected) | set(rebuilt) if expected.get(k) != rebuilt.get(k))
    print("World package reproduced exactly." if not diff else f"Mismatched files: {diff[:10]}")
    return not diff
