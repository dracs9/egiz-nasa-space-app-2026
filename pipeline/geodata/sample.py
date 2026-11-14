# Written with AI assistance (Claude Code); reviewed by: pending (Geo lead).
"""Deterministic, credential-free expansion of the Earth candidate set.

1. Candidates: one jittered point per existing Copernicus GLO-30 land tile
   between 60 S and 80 N (seeded), excluding points within 50 km of a pilot site.
2. Climate stratum from data (NASA POWER climatology, cached):
   cold  : mean annual 2 m air temperature < -2 degC
   arid  : annual precipitation < 250 mm
   semiarid : 250-500 mm
   humid : otherwise
3. Seeded selection per stratum with quotas, enforcing >= MIN_SPACING_KM between
   any two selected sites so one location is never counted as several AOIs.

Strata are labels for sampling only; the landscape class is never hand-assigned.
"""
from __future__ import annotations

import json
import math
import random
from concurrent.futures import ThreadPoolExecutor

from pipeline.earth.pool import tile_id
from pipeline.geodata import DERIVED, RAW
from pipeline.geodata.aois import AOI, earth_group, pilot_aois
from pipeline.geodata.cache import fetch_json
from pipeline.geodata.features import POWER_URL
from pipeline.geodata.rasters import copernicus_tiles

SEED = 2026
MIN_SPACING_KM = 150
QUOTAS = {"arid": .40, "semiarid": .25, "cold": .20, "humid": .15}


def haversine_km(a, b):
    lon1, lat1, lon2, lat2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371.0088 * math.asin(math.sqrt(h))


def tile_origin(name: str):
    # Copernicus_DSM_COG_10_N35_00_W112_00_DEM
    parts = name.split("_")
    lat = int(parts[4][1:]) * (1 if parts[4][0] == "N" else -1)
    lon = int(parts[6][1:]) * (1 if parts[6][0] == "E" else -1)
    return lon, lat


def candidates(n_candidates: int, seed=SEED):
    rng = random.Random(seed)
    tiles = sorted(copernicus_tiles(RAW))
    pilots = [(a.lon, a.lat) for a in pilot_aois()]
    pts = []
    for name in tiles:
        lon0, lat0 = tile_origin(name)
        if not -60 <= lat0 < 80:
            continue
        lon = round(lon0 + .2 + .6 * rng.random(), 3)
        lat = round(lat0 + .2 + .6 * rng.random(), 3)
        if all(haversine_km((lon, lat), p) > 50 for p in pilots):
            pts.append((lon, lat))
    rng.shuffle(pts)
    return pts[:n_candidates]


def stratum(lon, lat):
    payload, _ = fetch_json(POWER_URL.format(lon=lon, lat=lat), RAW / "nasa_power" / "sampling" / f"{lon:.3f}_{lat:.3f}.json")
    p = payload["properties"]["parameter"]
    fill = payload["header"].get("fill_value", -999)
    t, pr = p["T2M"].get("ANN"), p["PRECTOTCORR"].get("ANN")
    if t in (None, fill) or pr in (None, fill):
        return None
    if t < -2:
        return "cold"
    mm = pr * 365.25
    return "arid" if mm < 250 else "semiarid" if mm < 500 else "humid"


def select(n_total=320, n_candidates=1400, seed=SEED, workers=6):
    pts = candidates(n_candidates, seed)
    with ThreadPoolExecutor(workers) as pool:
        labels = list(pool.map(lambda pt: _safe_stratum(*pt), pts))
    by = {k: [pt for pt, lab in zip(pts, labels) if lab == k] for k in QUOTAS}
    rng = random.Random(seed + 1)
    chosen = [(a.lon, a.lat) for a in pilot_aois()]
    picked = []
    for name, share in QUOTAS.items():
        pool_pts = by[name][:]
        rng.shuffle(pool_pts)
        want = round(n_total * share)
        got = 0
        for pt in pool_pts:
            if got >= want:
                break
            if all(haversine_km(pt, c) >= MIN_SPACING_KM for c in chosen):
                chosen.append(pt)
                picked.append((pt, name))
                got += 1
    summary = {"seed": seed, "n_candidates": len(pts), "candidates_by_stratum": {k: len(v) for k, v in by.items()},
               "unlabelled": labels.count(None), "selected_by_stratum": {k: sum(s == k for _, s in picked) for k in QUOTAS},
               "min_spacing_km": MIN_SPACING_KM, "quotas": QUOTAS}
    aois = []
    for (lon, lat), name in picked:
        aid = tile_id(lon, lat, "SM")
        aois.append(AOI(aid, "SITE_" + aid, earth_group(lon, lat), "earth", f"Sampled land cell ({name} stratum)",
                        f"sampling stratum: {name}", lon, lat, "sampled",
                        notes=[f"deterministic sample seed={seed}; stratum from NASA POWER climatology: {name}"]))
    path = DERIVED / "sample_selection.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"summary": summary, "aois": [a.to_dict() for a in aois]}, indent=1) + "\n",
                    encoding="utf-8")
    return aois, summary


def _safe_stratum(lon, lat):
    try:
        return stratum(lon, lat)
    except Exception:
        return None


def load_selection():
    path = DERIVED / "sample_selection.json"
    if not path.exists():
        return []
    return [AOI(**a) for a in json.loads(path.read_text(encoding="utf-8"))["aois"]]
