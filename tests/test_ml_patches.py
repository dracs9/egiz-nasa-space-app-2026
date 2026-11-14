"""Tests for the encoder patch dataset (synthetic grids, FAKE_ ids).

Written with AI assistance (Claude Code); human review pending.
"""

from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path

import numpy as np
import pytest

rasterio = pytest.importorskip("rasterio")

from pipeline.ml.patches import build_patches, split_for  # noqa: E402

COLUMNS = ["patch_id", "aoi_id", "site_id", "group_id", "body", "variable", "source_tiles", "asset_path", "sha256",
           "bytes", "crs", "pixel_m", "native_res_m", "rows", "cols", "resampling", "valid_frac", "committed"]


def _grid(path: Path, z: np.ndarray) -> str:
    from rasterio.transform import from_origin

    with rasterio.open(path, "w", driver="GTiff", height=z.shape[0], width=z.shape[1], count=1, dtype="float32",
                       crs="EPSG:32611", transform=from_origin(0, 0, 50, 50), nodata=np.nan) as dst:
        dst.write(z.astype("float32"), 1)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _release(tmp_path: Path, tamper: bool = False) -> tuple[Path, Path]:
    geo, grids = tmp_path / "geo", tmp_path / "grids"
    geo.mkdir()
    grids.mkdir()
    rng = np.random.default_rng(0)
    rows, aois = [], []
    for i, group in enumerate(["EARTH_G1", "EARTH_G1", "EARTH_G2"]):
        aoi = f"FAKE_{i}"
        z = rng.normal(1000 * i, 50, (128, 128))
        if i == 2:
            z[:64, :64] = np.nan  # one tile fully missing
            z[64:, :64] = 0.0  # one tile of Copernicus sea surface
        sha = _grid(grids / f"{aoi}_p50.tif", z)
        if tamper and i == 0:
            sha = "0" * 64
        rows.append({c: "" for c in COLUMNS} | {"patch_id": f"{aoi}__DEM_P50", "aoi_id": aoi, "site_id": f"SITE_{i}",
                                               "group_id": group, "body": "earth", "asset_path": f"x/{aoi}_p50.tif",
                                               "sha256": sha, "pixel_m": "50"})
        aois.append({"aoi_id": aoi, "coverage_level": "L1_dem"})
    with (geo / "patch_index.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    (geo / "aoi_catalog.json").write_text(json.dumps({"dataset_version": "geo-test", "aois": aois}), encoding="utf-8")
    return geo, grids


def test_tiles_are_cut_verified_and_centred(tmp_path):
    geo, grids = _release(tmp_path)
    summary = build_patches(geo, grids, tmp_path / "out", size=64, stride=64)
    array = np.load(tmp_path / "out" / "patches.npy")
    assert summary["counts"] == {"patches": 10, "sites": 3, "groups": 2, "aois": 3}
    assert summary["tiles_dropped"] == {"low_valid_frac": 1, "sea_surface_zero": 1}
    assert array.shape == (10, 64, 64)
    assert np.allclose(np.nanmedian(array.reshape(10, -1), axis=1), 0, atol=1e-3)
    assert summary["gate"]["met"] is False


def test_split_is_per_group(tmp_path):
    geo, grids = _release(tmp_path)
    build_patches(geo, grids, tmp_path / "out")
    rows = list(csv.DictReader((tmp_path / "out" / "patches.csv").open(encoding="utf-8")))
    by_group = {}
    for row in rows:
        by_group.setdefault(row["group_id"], set()).add(row["split"])
    assert all(len(splits) == 1 for splits in by_group.values())
    assert split_for("EARTH_G1") == split_for("EARTH_G1")


def test_checksum_mismatch_is_skipped(tmp_path):
    geo, grids = _release(tmp_path, tamper=True)
    summary = build_patches(geo, grids, tmp_path / "out")
    assert {"aoi_id": "FAKE_0", "reason": "sha256 differs from patch_index"} in summary["skipped"]
    assert summary["counts"]["aois"] == 2
