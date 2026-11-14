"""Terrain patch dataset for the Stage 3 encoder (no model here).

Cuts the geo release's 50 m local DEM grids (``<aoi>_p50.tif``, 440 x 440) into
square tiles and writes a manifest plus one array file. Every grid is checked
against ``patch_index.csv`` by SHA-256 before use, so the dataset is provably the
released data. Splits are assigned per ``group_id`` (never per patch or per AOI)
because neighbouring tiles share terrain and would leak across splits.

Elevation is stored as metres relative to the tile's own median (absolute
height is not terrain shape and is a known shortcut). NaN marks missing pixels;
tiles with valid fraction below ``min_valid`` are skipped and counted. Copernicus
GLO-30 stores sea surface as exactly 0 m, so a tile whose share of exact-zero
pixels exceeds ``max_sea_zero`` is skipped as water (flat sea teaches no terrain
shape and would otherwise be ~9 % of geo-0.1.0 tiles).

Written with AI assistance (Claude Code); human review pending.
"""

from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path

import numpy as np

PATCH_GATE = {"sites": 50, "patches": 5000}
SPLITS = (("train", 0.70), ("val", 0.15), ("test", 0.15))


def split_for(group_id: str, seed: int = 20261107) -> str:
    """Deterministic group-level split from a hash of ``group_id`` and the seed."""
    digest = hashlib.sha256(f"{seed}:{group_id}".encode()).digest()
    u = int.from_bytes(digest[:8], "big") / 2**64
    edge = 0.0
    for name, share in SPLITS:
        edge += share
        if u < edge:
            return name
    return SPLITS[-1][0]


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_patches(geo_dir: str | Path, grids_dir: str | Path, out_dir: str | Path, *,
                  size: int = 64, stride: int = 64, pixel_m: int = 50, min_valid: float = 0.95,
                  max_sea_zero: float = 0.05, seed: int = 20261107) -> dict:
    """Cut verified grids into tiles; write ``patches.npy``, ``patches.csv`` and ``summary.json``."""
    import rasterio

    geo_dir, grids_dir, out_dir = Path(geo_dir), Path(grids_dir), Path(out_dir)
    catalog = {a["aoi_id"]: a for a in json.loads((geo_dir / "aoi_catalog.json").read_text(encoding="utf-8"))["aois"]}
    index = [r for r in csv.DictReader((geo_dir / "patch_index.csv").open(encoding="utf-8"))
             if r["body"] == "earth" and int(r["pixel_m"]) == pixel_m]
    tiles, rows, skipped = [], [], []
    dropped = {"low_valid_frac": 0, "sea_surface_zero": 0}
    for ref in sorted(index, key=lambda r: r["aoi_id"]):
        aoi_id = ref["aoi_id"]
        path = grids_dir / Path(ref["asset_path"]).name
        if not path.exists():
            skipped.append({"aoi_id": aoi_id, "reason": "grid file absent"})
            continue
        if _sha256(path) != ref["sha256"]:
            skipped.append({"aoi_id": aoi_id, "reason": "sha256 differs from patch_index"})
            continue
        with rasterio.open(path) as src:
            z = src.read(1).astype("float32")
        group = ref["group_id"]
        split = split_for(group, seed)
        for r0 in range(0, z.shape[0] - size + 1, stride):
            for c0 in range(0, z.shape[1] - size + 1, stride):
                tile = z[r0:r0 + size, c0:c0 + size]
                valid = float(np.isfinite(tile).mean())
                if valid < min_valid:
                    dropped["low_valid_frac"] += 1
                    continue
                if float((tile == 0).mean()) > max_sea_zero:
                    dropped["sea_surface_zero"] += 1
                    continue
                median = float(np.nanmedian(tile))
                tiles.append(tile - median)
                rows.append({"patch_n": len(rows), "aoi_id": aoi_id, "site_id": ref["site_id"], "group_id": group,
                             "split": split, "row0": r0, "col0": c0, "valid_frac": round(valid, 4),
                             "median_elev_m": round(median, 2),
                             "relief_m": round(float(np.nanmax(tile) - np.nanmin(tile)), 2),
                             "coverage_level": catalog.get(aoi_id, {}).get("coverage_level"),
                             "source_sha256": ref["sha256"]})
    out_dir.mkdir(parents=True, exist_ok=True)
    array = np.stack(tiles) if tiles else np.empty((0, size, size), dtype="float32")
    np.save(out_dir / "patches.npy", array)
    if rows:
        with (out_dir / "patches.csv").open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
    sites = {r["site_id"] for r in rows}
    groups = {r["group_id"] for r in rows}
    by_split = {name: sum(1 for r in rows if r["split"] == name) for name, _ in SPLITS}
    groups_by_split = {name: len({r["group_id"] for r in rows if r["split"] == name}) for name, _ in SPLITS}
    summary = {
        "schema": "egiz.ml_patches", "schema_version": "0.1.0",
        "source": {"dataset_version": json.loads((geo_dir / "aoi_catalog.json").read_text(encoding="utf-8"))
                   .get("dataset_version"), "grid": f"{pixel_m} m local UTM DEM (patch_index.csv)",
                   "verified": "every grid SHA-256 equals patch_index.csv"},
        "tile": {"size_px": size, "stride_px": stride, "size_m": size * pixel_m, "min_valid_frac": min_valid,
                 "max_sea_zero_frac": max_sea_zero,
                 "values": "elevation minus tile median, metres; NaN = missing"},
        "split": {"unit": "group_id", "seed": seed, "shares": dict(SPLITS), "patches": by_split,
                  "groups": groups_by_split},
        "counts": {"patches": len(rows), "sites": len(sites), "groups": len(groups), "aois": len({r["aoi_id"] for r in rows})},
        "gate": {**PATCH_GATE, "met": len(sites) >= PATCH_GATE["sites"] and len(rows) >= PATCH_GATE["patches"]},
        "tiles_dropped": dropped,
        "skipped": skipped,
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=1) + "\n", encoding="utf-8")
    return summary
