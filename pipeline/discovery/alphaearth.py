"""AlphaEarth Foundations satellite embeddings on the Earth side of the analog search.

AlphaEarth (Google DeepMind) encodes every 10 m Earth pixel and year (2017-) as a 64-d unit
vector learned from optical, radar, LiDAR, climate and elevation data. It exists ONLY for
Earth: a Moon or Mars point has no embedding. EGIZ therefore never compares a planetary point
with an embedding directly. The bridge is physical (pipeline.discovery.point ranks Earth by
measured terrain and constraints); AlphaEarth is then used on Earth only:

  index      mean embedding of every 20 km index window (one batch job, cached)
  expand     windows whose embedding is closest to the best physical matches: places that
             look the same from orbit but were not top-ranked by the physical dimensions
  stability  year-to-year cosine of a window's mean embedding (2017-2024): flooding,
             vegetation or land-use change make a field site less reliable
  zones      unsupervised k-means on the 10 m embeddings inside one window: lava, dunes,
             salt flats, rock fields, dry channels ... without hand labels (map tiles)

python -m pipeline.discovery alphaearth-index [--year 2024]
Needs EE_PROJECT and Earth Engine credentials (EE_SERVICE_ACCOUNT_KEY or earthengine authenticate).
Dataset: GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL (CC-BY 4.0, Google Earth Engine catalog).
"""
from __future__ import annotations

import json
import math
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from pipeline.discovery import OUT

DATASET = "GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL"
BANDS = [f"A{i:02d}" for i in range(64)]
YEARS = tuple(range(2017, 2025))
DEFAULT_YEAR = 2024
HALF_KM = 10.0           # 20 km core, the same footprint as the terrain windows
INDEX_SCALE_M = 300      # mean over a 20 km square; 300 m sampling keeps ~4,400 pixels per window
AE_DIR = OUT / "alphaearth"
CITATION = ("Brown C.F. et al. (2025) AlphaEarth Foundations: An embedding field model for accurate and "
            "efficient global mapping from sparse label data. arXiv:2507.22291; dataset "
            "GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL, CC-BY 4.0")


def _ee():
    from pipeline.earth.pool import initialize_ee
    return initialize_ee()


def _square(ee, lon: float, lat: float, half_km: float = HALF_KM):
    return ee.Geometry.Point([lon, lat]).buffer(half_km * 1000).bounds()


def _year_image(ee, year: int):
    return ee.ImageCollection(DATASET).filterDate(f"{year}-01-01", f"{year + 1}-01-01").mosaic().select(BANDS)


def _unit(v) -> list[float] | None:
    if v is None or any(x is None for x in v):
        return None
    a = np.asarray(v, float)
    n = float(np.linalg.norm(a))
    return None if not math.isfinite(n) or n < 1e-6 else (a / n).round(5).tolist()


# ----------------------------------------------------------------------------- index (batch)

def index_path(year: int = DEFAULT_YEAR):
    return AE_DIR / f"embeddings_{year}.json"


def build_index(year: int = DEFAULT_YEAR, batch: int = 250, workers: int = 4) -> dict:
    """Mean embedding of every ranked Earth window (same order as the discovery bundle)."""
    from pipeline.discovery.fingerprint import earth_windows, load_windows
    ee = _ee()
    E = earth_windows(load_windows())
    img = _year_image(ee, year)
    chunks = [E[i:i + batch] for i in range(0, len(E), batch)]

    def run(chunk):
        fc = ee.FeatureCollection([ee.Feature(_square(ee, w.lon, w.lat), {"id": w.id}) for w in chunk])
        for attempt in range(3):
            try:
                got = img.reduceRegions(collection=fc, reducer=ee.Reducer.mean(), scale=INDEX_SCALE_M,
                                        tileScale=4).getInfo()
                return {f["properties"]["id"]: _unit([f["properties"].get(b) for b in BANDS]) for f in got["features"]}
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(5 * (attempt + 1))
        return {}

    t0, vecs = time.time(), {}
    with ThreadPoolExecutor(workers) as pool:
        for n, part in enumerate(pool.map(run, chunks), 1):
            vecs.update(part)
            print(f"[alphaearth] {n}/{len(chunks)} batches, {time.time() - t0:.0f}s", flush=True)
    doc = {"schema": "egiz.alphaearth_index", "version": "1.0.0", "synthetic": False, "dataset": DATASET,
           "citation": CITATION, "year": year, "footprint": "20 km square centred on the window",
           "reducer": f"mean of 10 m embeddings sampled at {INDEX_SCALE_M} m, renormalised to unit length",
           "ids": [w.id for w in E], "vectors": [vecs.get(w.id) for w in E]}
    AE_DIR.mkdir(parents=True, exist_ok=True)
    index_path(year).write_text(json.dumps(doc, separators=(",", ":")) + "\n", encoding="utf-8")
    return {"year": year, "windows": len(E), "with_embedding": sum(v is not None for v in doc["vectors"]),
            "seconds": round(time.time() - t0, 1), "path": str(index_path(year))}


_index_cache: dict[int, tuple[list[str], np.ndarray, np.ndarray]] = {}


def load_index(year: int = DEFAULT_YEAR):
    """(ids, unit vectors [W, 64] with NaN rows where missing, valid mask) or None if not built."""
    if year in _index_cache:
        return _index_cache[year]
    p = index_path(year)
    if not p.exists():
        return None
    doc = json.loads(p.read_text(encoding="utf-8"))
    V = np.array([v if v is not None else [np.nan] * 64 for v in doc["vectors"]], float)
    _index_cache[year] = (doc["ids"], V, np.isfinite(V).all(axis=1))
    return _index_cache[year]


# ----------------------------------------------------------------------------- expansion

def expand(seeds: list[tuple[str, float]], *, exclude_km: float = 150.0, k: int = 15,
           win_lon=None, win_lat=None, year: int = DEFAULT_YEAR) -> dict | None:
    """Rank all windows by cosine similarity to the score-weighted mean embedding of the seeds.

    seeds: (window id, weight). Windows within exclude_km of a seed are flagged, not dropped,
    so the list shows new places that resemble the physical matches from orbit.
    """
    idx = load_index(year)
    if idx is None:
        return None
    ids, V, ok = idx
    pos = {w: i for i, w in enumerate(ids)}
    used = [(pos[w], wt) for w, wt in seeds if w in pos and ok[pos[w]] and wt > 0]
    if not used:
        return {"status": "no_seed_embedding", "year": year}
    seed = sum(wt * V[i] for i, wt in used)
    seed = seed / np.linalg.norm(seed)
    cos = np.where(ok, np.nan_to_num(V) @ seed, np.nan)
    near = np.zeros(len(ids), bool)
    if win_lon is not None and win_lat is not None:
        from pipeline.discovery.rank import haversine_km
        for i, _ in used:
            near |= haversine_km(win_lon, win_lat, win_lon[i], win_lat[i]) <= exclude_km
    order = [int(i) for i in np.argsort(-np.nan_to_num(cos, nan=-2.0)) if ok[i]]
    fresh = [i for i in order if not near[i]][:k]
    return {"status": "ok", "year": year, "dataset": DATASET, "citation": CITATION,
            "seeds": [{"window": ids[i], "weight": round(float(wt), 4)} for i, wt in used],
            "cosine": [None if not np.isfinite(c) else round(float(c), 4) for c in cos],
            "top": [{"window": ids[i], "cosine": round(float(cos[i]), 4)} for i in fresh],
            "method": (f"cosine similarity of 20 km mean AlphaEarth embeddings ({year}) to the score-weighted mean "
                       f"of the {len(used)} best physical matches; windows within {exclude_km:g} km of a seed omitted "
                       "from 'top'")}


# ----------------------------------------------------------------------------- per-window (live)

def stability(lon: float, lat: float, years=YEARS) -> dict:
    """Year-to-year cosine of the window's mean embedding (1 = unchanged surface)."""
    ee = _ee()
    geom = _square(ee, lon, lat)
    stack = ee.Image.cat([_year_image(ee, y).rename([f"y{y}_{b}" for b in BANDS]) for y in years])
    got = stack.reduceRegion(ee.Reducer.mean(), geom, scale=INDEX_SCALE_M, tileScale=4, maxPixels=1e9).getInfo()
    vecs = {y: _unit([got.get(f"y{y}_{b}") for b in BANDS]) for y in years}
    pairs = []
    for a, b in zip(years, years[1:]):
        va, vb = vecs[a], vecs[b]
        pairs.append({"from": a, "to": b, "cosine": None if va is None or vb is None
                      else round(float(np.dot(va, vb)), 4)})
    vals = [p["cosine"] for p in pairs if p["cosine"] is not None]
    base = vecs[years[0]]
    drift = None if base is None or vecs[years[-1]] is None else round(float(np.dot(base, vecs[years[-1]])), 4)
    return {"status": "ok" if vals else "no_data", "lon": lon, "lat": lat, "years": list(years), "pairs": pairs,
            "min_year_to_year": min(vals) if vals else None, "first_to_last": drift, "dataset": DATASET,
            "method": f"mean embedding over the 20 km window at {INDEX_SCALE_M} m, per year; cosine between years",
            "reading": "≥ 0.98 stable surface; 0.9-0.98 seasonal/minor change; < 0.9 marked change (flooding, "
                       "vegetation, construction) - check imagery before planning a field campaign"}


def zones(lon: float, lat: float, k: int = 6, year: int = DEFAULT_YEAR, scale: int = 30) -> dict:
    """Unsupervised k-means zoning of one window from its 10 m embeddings; returns map tiles."""
    if not 2 <= k <= 12:
        raise ValueError("k must be between 2 and 12")
    ee = _ee()
    geom = _square(ee, lon, lat)
    img = _year_image(ee, year).clip(geom)
    sample = img.sample(region=geom, scale=scale * 2, numPixels=4000, seed=2026, geometries=False)
    clusterer = ee.Clusterer.wekaKMeans(nClusters=k, seed=2026).train(sample)
    classes = img.cluster(clusterer).rename("zone").clip(geom)
    hist = classes.reduceRegion(ee.Reducer.frequencyHistogram(), geom, scale=scale, maxPixels=1e9).getInfo()
    counts = {int(float(z)): n for z, n in (hist.get("zone") or {}).items()}
    total = sum(counts.values()) or 1
    palette = ["e41a1c", "377eb8", "4daf4a", "984ea3", "ff7f00", "ffff33", "a65628", "f781bf", "999999",
               "66c2a5", "fc8d62", "8da0cb"][:k]
    mid = classes.getMapId({"min": 0, "max": k - 1, "palette": palette})
    b = geom.bounds().coordinates().getInfo()[0]
    xs, ys = [p[0] for p in b], [p[1] for p in b]
    return {"status": "ok", "lon": lon, "lat": lat, "k": k, "year": year, "scale_m": scale,
            "tiles": mid["tile_fetcher"].url_format, "bounds": [min(xs), min(ys), max(xs), max(ys)],
            "zones": [{"zone": z, "color": "#" + palette[z], "fraction": round(counts.get(z, 0) / total, 4)}
                      for z in range(k)],
            "dataset": DATASET, "citation": CITATION,
            "method": (f"k-means (k={k}) on 64-d AlphaEarth embeddings, {year}, trained on 4,000 pixels of this "
                       f"20 km window; classes are unlabeled - interpret with imagery"),
            "note": "tile URL is temporary (Earth Engine map id)"}
