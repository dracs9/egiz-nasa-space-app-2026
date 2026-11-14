"""Coarse-to-fine analog candidate discovery (Kazakhstan / Mangystau-Ustyurt pilot region).

Level 1  Copernicus GLO-90 public COGs read at reduced resolution (GDAL overviews, no full
         download); 0.25 deg blocks; coarse descriptors; screening against the target's
         400 m slope distribution; exploratory clustering and robust outlier scores.
Level 2  Shortlisted blocks re-read from Copernicus GLO-30 COGs as 22 km windows, averaged
         onto the same 200 m local grids as the measured pilot (pipeline.planets.access),
         then assessed with the full ATLAS-Pi tensor for terrain-driven tasks.

Discovery is not proof. Every Level-2 candidate is categorised as an existing catalog
site, an existing candidate with new characterisation, or a newly identified
computational candidate requiring field validation. Land cover and geology are NOT
acquired here, so site constraints and process compatibility remain unknown.

python -m pipeline.analog_transfer discover   # writes data/pilot/atlas_discovery.json
"""

from __future__ import annotations

import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import cast

import numpy as np

from . import features as F
from .transfer import Context, compute_tensor

REGION = {"name": "Mangystau and western Ustyurt, Kazakhstan", "lon": (51, 57), "lat": (42, 45)}
BLOCK_DEG = 0.25
L1_SIDE = 300  # pixels per 1-degree tile at Level 1 (~370 m north-south)
TERRAIN_TASKS = ("ROUTE_PLANNING", "HAZARD_MAPPING", "COMMS_VISIBILITY")


def glo90_url(lon: int, lat: int) -> str:
    key = f"Copernicus_DSM_COG_30_{'N' if lat >= 0 else 'S'}{abs(lat):02d}_00_{'E' if lon >= 0 else 'W'}{abs(lon):03d}_00_DEM"
    return f"https://copernicus-dem-90m.s3.amazonaws.com/{key}/{key}.tif"


def read_tile_coarse(lon: int, lat: int) -> tuple[np.ndarray | None, str]:
    import rasterio
    from rasterio.enums import Resampling
    url = glo90_url(lon, lat)
    try:
        with rasterio.Env(GDAL_HTTP_TIMEOUT="60", GDAL_HTTP_MAX_RETRY="2", GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
            with rasterio.open(url) as src:
                z = src.read(1, out_shape=(L1_SIDE, L1_SIDE), resampling=Resampling.average, masked=True).astype("float32")
                return z.filled(np.nan), url
    except Exception as exc:  # missing ocean tiles are expected; record the failure
        return None, f"{url} unavailable: {type(exc).__name__}"


def block_stats(z: np.ndarray, lat_c: float) -> dict:
    dy = 111_320.0 / L1_SIDE
    dx = dy * math.cos(math.radians(lat_c))
    gy, gx = np.gradient(z, dy, dx)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    valid = np.isfinite(z)
    s = slope[np.isfinite(slope)]
    e = z[valid]
    if valid.mean() < 0.99 or s.size < 50:
        return {"valid_fraction": float(valid.mean()), "usable": False}
    return {"valid_fraction": float(valid.mean()), "usable": True,
            "relief_m": float(np.quantile(e, 0.95) - np.quantile(e, 0.05)),
            "elev_median_m": float(np.median(e)),
            "slope_p50": float(np.quantile(s, 0.5)), "slope_p90": float(np.quantile(s, 0.9)),
            "flat_fraction": float(np.mean(s < 0.3)), "q_slope": F.quantile_function(s)}


def level1(region: dict = REGION) -> tuple[list[dict], list[str]]:
    blocks, sources = [], []
    n = int(round(1 / BLOCK_DEG))
    step = L1_SIDE // n
    for lat in range(region["lat"][0], region["lat"][1]):
        for lon in range(region["lon"][0], region["lon"][1]):
            z, src = read_tile_coarse(lon, lat)
            sources.append(src)
            if z is None:
                continue
            for i in range(n):          # rows from north
                for j in range(n):
                    sub = z[i * step:(i + 1) * step, j * step:(j + 1) * step]
                    lat_c = lat + 1 - (i + 0.5) * BLOCK_DEG
                    lon_c = lon + (j + 0.5) * BLOCK_DEG
                    st = block_stats(sub, lat_c)
                    blocks.append({"id": f"KZD_E{lon_c:07.3f}_N{lat_c:06.3f}", "lon": round(lon_c, 4), "lat": round(lat_c, 4), **st})
    return blocks, sources


def robust_outliers(blocks: list[dict]) -> dict:
    """Median/MAD-standardised descriptor distance; exploratory, not a classification."""
    keys = ("relief_m", "slope_p50", "slope_p90", "flat_fraction")
    usable = [b for b in blocks if b.get("usable")]
    X = np.array([[math.log10(max(b["relief_m"], 1)), b["slope_p50"], b["slope_p90"], b["flat_fraction"]] for b in usable])
    med = np.median(X, axis=0)
    mad = np.median(np.abs(X - med), axis=0) * 1.4826
    Z = (X - med) / np.where(mad > 0, mad, 1)
    score = np.sqrt((Z ** 2).sum(axis=1))
    cut = float(np.quantile(score, 0.95))
    from scipy.cluster.hierarchy import fcluster, linkage
    labels = fcluster(linkage(Z, "ward"), t=5, criterion="maxclust")
    for b, s, lab in zip(usable, score, labels):
        b["outlier_score"] = float(s)
        b["unusual"] = bool(s >= cut)
        b["terrain_family"] = int(lab)
    return {"descriptors": list(keys), "outlier_cut_p95": cut, "families": 5}


def screen(blocks: list[dict], target_q400: np.ndarray, tol: float = 2.0) -> None:
    for b in blocks:
        if not b.get("usable"):
            continue
        w = F.wasserstein1(b["q_slope"], target_q400)
        b["coarse_slope_w1_deg"] = w
        b["coarse_match"] = math.exp(-0.5 * (w / tol) ** 2)
        # Very flat blocks are likely water, salt flats or sand sheets: flagged, not excluded silently.
        b["flag"] = "probable water/playa/flat sheet (unverified)" if b["flat_fraction"] > 0.6 else None


def shortlist(blocks: list[dict], n: int = 10, min_sep_deg: float = 0.5) -> list[dict]:
    """Top coarse matches with a separation rule, plus the most unusual blocks (diversity)."""
    usable = sorted([b for b in blocks if b.get("usable") and not b.get("flag")], key=lambda b: (-b["coarse_match"], b["id"]))
    chosen: list[dict] = []
    for b in usable + sorted([b for b in blocks if b.get("unusual") and not b.get("flag")], key=lambda b: -b["outlier_score"]):
        if len(chosen) >= n:
            break
        if all(abs(b["lon"] - c["lon"]) >= min_sep_deg or abs(b["lat"] - c["lat"]) >= min_sep_deg for c in chosen):
            chosen.append(b)
    return chosen


def level2_entry(b: dict) -> dict:
    from pipeline.common.mission_terrain import grid_document
    from pipeline.earth.public_dem import public_tile_url
    from pipeline.planets.access import read_window, to_local_grid
    # A 22 km window must lie inside one GLO-30 tile (no mosaicking here): recentre by <= 0.11 deg.
    lon = min(max(b["lon"], math.floor(b["lon"]) + 0.15), math.floor(b["lon"]) + 0.85)
    lat = min(max(b["lat"], math.floor(b["lat"]) + 0.11), math.floor(b["lat"]) + 0.89)
    url = public_tile_url(lon, lat)
    z, affine, crs = read_window(url, lon, lat, 11000, "earth")
    local = to_local_grid(z, affine, crs, (lon, lat), "earth", 200, 11000)
    grid = grid_document(local)
    return {"id": b["id"], "body": "earth", "lon": round(lon, 4), "lat": round(lat, 4), "source_pixel_m": 30,
            "recentred_deg": round(math.hypot(lon - b["lon"], lat - b["lat"]), 3),
            "source": {"url": url, "product": "Copernicus DEM GLO-30 Public (remote COG window)"}, "grid": grid}


def catalog_distance_km(b: dict, catalog: list[dict]) -> tuple[float, str]:
    best = (math.inf, "")
    for c in catalog:
        dlat = math.radians(c["lat"] - b["lat"])
        dlon = math.radians(c["lon"] - b["lon"])
        a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(b["lat"])) * math.cos(math.radians(c["lat"])) * math.sin(dlon / 2) ** 2
        d = 2 * 6371.0 * math.asin(math.sqrt(a))
        if d < best[0]:
            best = (d, c["id"])
    return best


def run(ctx: Context, target_id: str = "MARS_JEZERO", n_short: int = 10, out: Path | None = None) -> dict:
    t0 = time.perf_counter()
    blocks, sources = level1()
    t1 = time.perf_counter()
    target_q = ctx.descriptors[target_id].point["q_slope_400"]
    screen(blocks, target_q)
    clustering = robust_outliers(blocks)
    short = shortlist(blocks, n_short)
    catalog = [{"id": k, "lon": v["lon"], "lat": v["lat"]} for k, v in ctx.tiles.items()]
    candidates, failures = [], []
    for b in short:
        try:
            entry = level2_entry(b)
            if entry["grid"]["valid_fraction"] < 0.99:
                raise ValueError(f"valid fraction {entry['grid']['valid_fraction']:.3f} (edge or void)")
            d = F.describe(entry)
        except Exception as exc:
            failures.append({"id": b["id"], "reason": f"{type(exc).__name__}: {exc}"})
            continue
        slope400 = d.point["q_slope_200"]  # 200 m cells, central difference = 400 m baseline
        tile = {"id": b["id"], "pool": "kazakhstan", "lon": b["lon"], "lat": b["lat"], "name": None, "country": "Kazakhstan",
                "attrs": {"slope_f400_p90_deg": float(np.quantile(slope400, 0.9))}, "context": {}}
        ctx.descriptors[b["id"]] = d
        ctx.tiles[b["id"]] = tile
        dist, nearest = catalog_distance_km(b, catalog)
        cells = {}
        for t in sorted(ctx.targets):
            tensor = compute_tensor(ctx, [b["id"]], [t])
            cells[t] = [{k: c[k] for k in ("task", "status", "reasons", "axes")} for c in tensor["cells"] if c["task"] in TERRAIN_TASKS]
        category = ("existing catalog site" if dist < 15 else
                    "existing candidate with new characterisation" if dist < 40 else
                    "newly identified computational candidate (unverified; field validation required)")
        candidates.append({"id": b["id"], "lon": entry["lon"], "lat": entry["lat"], "recentred_deg": entry["recentred_deg"], "level1": {k: v for k, v in b.items() if k != "q_slope"},
                           "terrain": F.summary(d), "source": entry["source"], "nearest_catalog_site": nearest,
                           "nearest_catalog_km": round(dist, 1), "category": category, "cells": cells,
                           "missing": ["land cover / water / built fraction (WorldCover not acquired)", "geological process context",
                                       "temperature", "precipitation"],
                           "next_measurements": ["ESA WorldCover land-cover fractions (site constraints)",
                                                 "Geological map review / field verification (M_GEOLOGY)",
                                                 "High-resolution terrain survey of the best transect (M_HIRES_DEM)"]})
        del ctx.descriptors[b["id"]], ctx.tiles[b["id"]]
    t2 = time.perf_counter()
    agreement = None
    route = [(c["level1"]["coarse_match"], next(x["axes"]["task_match"] for x in c["cells"][target_id] if x["task"] == "ROUTE_PLANNING"))
             for c in candidates]
    if len(route) >= 4:
        from scipy.stats import spearmanr
        rho = cast(float, spearmanr([a for a, _ in route], [b for _, b in route])[0])
        agreement = {"spearman_coarse_vs_level2_route_match": float(rho), "n": len(route),
                     "mean_coarse_match": float(np.mean([a for a, _ in route])),
                     "mean_level2_route_match": float(np.mean([b for _, b in route])),
                     "note": "Level-1 coarse match uses one ~370 m slope distribution; Level 2 uses multi-scale slope, traversability, roughness and relief with bootstrap. Disagreement is expected and is why Level 1 is only a screen."}
    doc = {
        "schema": "egiz.atlas_discovery", "version": "1.0.0", "synthetic": False,
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "region": REGION, "screen_target": target_id,
        "method": {"level1": f"GLO-90 tiles read at {L1_SIDE}x{L1_SIDE} (average, COG overviews); {BLOCK_DEG} deg blocks; "
                             "coarse slope W1 vs target 400 m slope distribution (tolerance 2 deg); blocks with >60% slopes < 0.3 deg flagged",
                   "level2": "GLO-30 22 km windows -> 200 m local UTM grids (same functions as mission_terrain) -> ATLAS-Pi tensor",
                   "clustering": {**clustering, "note": "Exploratory Ward clustering and median/MAD outlier scores; not a validated classification."},
                   "novelty": "Great-circle distance to EGIZ catalog windows; <15 km existing, <40 km new characterisation, else new computational candidate. Published-literature novelty was not checked for every block."},
        "sources": sources, "provenance": {"level1": "Copernicus DEM GLO-90 Public (copernicus-dem-90m AWS registry)",
                                           "level2": "Copernicus DEM GLO-30 Public (copernicus-dem-30m AWS registry)",
                                           "access_date": datetime.now(timezone.utc).date().isoformat()},
        "level1_blocks": [{k: (round(v, 4) if isinstance(v, float) else v) for k, v in b.items() if k != "q_slope"} for b in blocks],
        "candidates": candidates, "failures": failures, "screen_agreement": agreement,
        "performance": {"level1_s": round(t1 - t0, 2), "level2_s": round(t2 - t1, 2),
                        "level1_tiles": len(sources), "level1_blocks": len(blocks), "level2_windows": len(short)},
        "limitations": ["Regional pilot, not a global search.", "Level 1 uses GLO-90 at ~370 m and is a screen only.",
                        "Land cover, water and built fractions were not acquired: site constraints are unknown, not passed.",
                        "Discovery categories are computational; no candidate is a confirmed analog."],
    }
    if out is not False:
        path = out or Path(__file__).resolve().parents[2] / "data/pilot/atlas_discovery.json"
        path.write_text(json.dumps(doc, allow_nan=False, separators=(",", ":")) + "\n")
    return doc
