"""Acquire the Earth-wide discovery index with the unchanged geodata per-AOI stages.

python -m pipeline.discovery acquire --set global --set kz --set benchmark --set targets --workers 8

* Terrain: Copernicus GLO-30 public COGs (HTTP range reads of 22 km windows, no bulk download)
* Land cover: ESA WorldCover 2021 v200 COGs
* Climate: NASA POWER climatology API (2 m air temperature, precipitation; modelled)
* Geology: Macrostrat map units at the window centre (proxy)

Records go to data/derived/<INDEX_VERSION>/aoi/<aoi_id>.json (resumable; failures are
recorded per stage, never hidden). Native source windows are deleted after feature
extraction to bound disk use; their SHA-256, URLs and processing are kept in the
record, and the local 50 m / 200 m analysis grids are kept for the evidence tier.
"""
from __future__ import annotations

import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from pipeline.discovery import INDEX_DERIVED, ROOT
from pipeline.discovery import sites as S
from pipeline.geodata import features as F
from pipeline.geodata.aois import AOI

SETS = ("global", "kz", "benchmark", "targets")


def select(sets: list[str], *, global_spacing_km: float = 220.0, kz_spacing_km: float = 75.0,
           limit: int | None = None) -> list[AOI]:
    from pipeline.geodata import RAW
    from pipeline.geodata.rasters import copernicus_tiles
    aois: list[AOI] = []
    if "targets" in sets:
        aois += S.new_target_aois()
    if "benchmark" in sets:
        aois += S.benchmark_aois()
    if "kz" in sets:
        aois += S.regional_lattice("KAZ", kz_spacing_km, "KZX")
    if "global" in sets:
        aois += S.global_lattice(copernicus_tiles(RAW), global_spacing_km)
    seen, out = set(), []
    for a in aois:
        if a.aoi_id not in seen:
            seen.add(a.aoi_id)
            out.append(a)
    return out[:limit] if limit else out


def _purge_native(record: dict) -> None:
    for asset in record.get("assets", []):
        if asset.get("role") != "native_window" or asset.get("purged"):
            continue
        path = ROOT / asset["path"]
        if path.exists():
            path.unlink()
            for side in (path.with_name(path.name + ".meta.json"),):
                side.unlink(missing_ok=True)
        asset["purged"] = True
        asset["purge_note"] = "native window deleted after feature extraction; sha256 kept; rerun acquire to restore"


def process_one(aoi: AOI, tile_names: set[str], *, purge: bool = True) -> dict:
    record = F.process(aoi, tile_names=tile_names)
    if purge and aoi.body == "earth":
        _purge_native(record)
        F.save_record(record)
    return record


def run(aois: list[AOI], *, workers: int = 8, purge: bool = True, log: Path | None = None,
        derived: Path = INDEX_DERIVED) -> dict:
    from pipeline.geodata import RAW
    from pipeline.geodata.rasters import copernicus_tiles
    F.DERIVED = derived  # redirect per-AOI records and grids to the index (or refinement) release
    tiles = copernicus_tiles(RAW)
    log = log or derived / "acquire_log.jsonl"
    log.parent.mkdir(parents=True, exist_ok=True)
    started, counts = time.time(), {"ok": 0, "with_failures": 0}
    planets = [a for a in aois if a.body != "earth"]
    earth = [a for a in aois if a.body == "earth"]
    for a in planets:
        process_one(a, tiles, purge=False)
    with ThreadPoolExecutor(workers) as pool, log.open("a", encoding="utf-8") as out:
        futures = {pool.submit(process_one, a, tiles, purge=purge): a for a in earth}
        for i, fut in enumerate(as_completed(futures), 1):
            a = futures[fut]
            try:
                rec = fut.result()
                stages = {k: v["status"] for k, v in rec["stages"].items()}
            except Exception as exc:  # recorded, never swallowed
                stages = {"driver": f"failed: {type(exc).__name__}: {exc}"}
            failed = any(str(v).startswith("failed") for v in stages.values())
            counts["with_failures" if failed else "ok"] += 1
            out.write(json.dumps({"aoi_id": a.aoi_id, "stages": stages, "t": round(time.time() - started, 1)}) + "\n")
            out.flush()
            if i % 25 == 0 or i == len(earth):
                print(f"[{i}/{len(earth)}] {time.time() - started:.0f}s ok={counts['ok']} "
                      f"failures={counts['with_failures']}", flush=True)
    return {**counts, "n": len(aois), "seconds": round(time.time() - started, 1)}
