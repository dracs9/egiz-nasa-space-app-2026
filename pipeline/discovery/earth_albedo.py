"""Earth-side surface albedo for every ranked window (NASA POWER climatology, CERES SYN1deg).

python -m pipeline.discovery earth-albedo [--workers 6]

ALLSKY_SRF_ALB is the broadband all-sky surface albedo, annual mean of the 2001-2025 monthly
climatology at a 1 degree cell. Responses are cached per window under data/raw/nasa_power_albedo
(resumable); the compiled table goes to data/discovery/index/earth_albedo.csv. The published
discovery bundle does not use it: only on-demand points score the surface_albedo dimension.
"""
from __future__ import annotations

import csv
import json
import math
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from pipeline.discovery import ROOT
from pipeline.discovery.fingerprint import INDEX_DIR, earth_windows, load_windows

URL = ("https://power.larc.nasa.gov/api/temporal/climatology/regional?parameters=ALLSKY_SRF_ALB&community=RE"
       "&latitude-min={s}&latitude-max={n}&longitude-min={w}&longitude-max={e}&format=JSON")
TILE_DEG = 10
CACHE = ROOT / "data" / "raw" / "nasa_power_albedo"
TABLE = INDEX_DIR / "earth_albedo.csv"
SOURCE = ("NASA POWER climatology API v2 (regional), ALLSKY_SRF_ALB (CERES SYN1deg all-sky surface albedo), "
          "annual mean of monthly climatology 2001-2025, 1 deg cell containing the window centre")


def _tile(key: tuple[int, int]) -> tuple[tuple[int, int], dict[tuple[float, float], float], str]:
    """One 10 x 10 deg regional request -> {(cell lon centre, cell lat centre): annual albedo}."""
    w, south = key
    path = CACHE / f"tile_{w:+04d}_{south:+03d}.json"
    if not path.exists():
        last = None
        url = URL.format(s=south, n=min(south + TILE_DEG, 90), w=w, e=min(w + TILE_DEG, 180))
        for attempt in range(4):
            try:
                with urllib.request.urlopen(url, timeout=120) as r:
                    data = r.read()
                json.loads(data)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
                break
            except Exception as exc:  # throttling / transient: retry, then record
                last = exc
                time.sleep(3 * (attempt + 1))
        else:
            return key, {}, f"failed: {type(last).__name__}: {last}"
    doc = json.loads(path.read_text())
    fill = doc.get("header", {}).get("fill_value", -999.0)
    cells = {}
    for f in doc.get("features", []):
        lon, lat = f["geometry"]["coordinates"][:2]
        v = f["properties"]["parameter"]["ALLSKY_SRF_ALB"].get("ANN")
        if v is not None and v != fill:
            cells[(round(lon, 2), round(lat, 2))] = float(v)
    return key, cells, "ok"


def _cell(lon: float, lat: float) -> tuple[float, float]:
    return (round(math.floor(lon) + 0.5, 2), round(min(math.floor(lat), 89) + 0.5, 2))


def _tile_key(lon: float, lat: float) -> tuple[int, int]:
    return (int(math.floor(lon / TILE_DEG) * TILE_DEG), int(math.floor(min(lat, 89.9) / TILE_DEG) * TILE_DEG))


def acquire(workers: int = 4) -> dict:
    E = earth_windows(load_windows())
    keys = sorted({_tile_key(w.lon, w.lat) for w in E})
    cells, fails, t0 = {}, [], time.time()
    with ThreadPoolExecutor(workers) as pool:
        futs = [pool.submit(_tile, k) for k in keys]
        for n, f in enumerate(as_completed(futs), 1):
            key, got, st = f.result()
            cells.update(got)
            if st != "ok":
                fails.append({"tile": key, "status": st})
            if n % 25 == 0 or n == len(keys):
                print(f"[earth-albedo] tiles {n}/{len(keys)} {time.time() - t0:.0f}s failures={len(fails)}", flush=True)
    TABLE.parent.mkdir(parents=True, exist_ok=True)
    with TABLE.open("w", newline="", encoding="utf-8") as fh:
        wr = csv.writer(fh)
        wr.writerow(["aoi_id", "albedo_annual", "status"])
        for w in E:
            v = cells.get(_cell(w.lon, w.lat))
            wr.writerow([w.id, "" if v is None else f"{v:.3f}", "ok" if v is not None else "no_value"])
    n_val = sum(cells.get(_cell(w.lon, w.lat)) is not None for w in E)
    return {"windows": len(E), "tiles": len(keys), "with_value": n_val, "tile_failures": fails,
            "seconds": round(time.time() - t0, 1), "path": str(TABLE)}


def load() -> dict[str, float]:
    if not TABLE.exists():
        return {}
    with TABLE.open(newline="", encoding="utf-8") as fh:
        return {r["aoi_id"]: float(r["albedo_annual"]) for r in csv.DictReader(fh) if r["albedo_annual"]}
