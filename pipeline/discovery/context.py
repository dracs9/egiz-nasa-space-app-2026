"""Point-inventory context for every Earth window: volcanoes, impact structures, country.

Sources (downloaded once into data/raw/geo, fingerprinted in the index manifest):

* Smithsonian Global Volcanism Program, Volcanoes of the World v5 (Holocene volcanoes, WFS)
* Wikidata: items that are an instance of (a subclass of) "impact crater" (Q55818) with
  coordinates on Earth. Community-curated; cross-check against the Earth Impact Database.
* Natural Earth 1:50m admin-0 countries (public domain)

Context values are distances to inventory points. They indicate geological setting
(volcanic field, impact structure) and never stand in for measured lithology.
"""
from __future__ import annotations

import json
import math
import urllib.parse

import numpy as np

from pipeline.discovery import RAW
from pipeline.discovery.sites import EARTH_R_KM, country_of, load_countries
from pipeline.geodata.cache import fetch, read_meta, sha256_file

GVP_URL = ("https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=2.0.0&request=GetFeature"
           "&typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes&outputFormat=application/json")
WIKIDATA_QUERY = ('SELECT DISTINCT ?item ?itemLabel ?coord ?diam WHERE { ?item wdt:P31/wdt:P279* wd:Q55818 ; '
                  'wdt:P625 ?coord . FILTER NOT EXISTS { ?item wdt:P376 ?body . FILTER(?body != wd:Q2) } '
                  'FILTER(!CONTAINS(STR(?coord), "globe")) OPTIONAL { ?item wdt:P2386 ?diam } '
                  'SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }')
WIKIDATA_URL = "https://query.wikidata.org/sparql?format=json&query=" + urllib.parse.quote(WIKIDATA_QUERY)
GVP_PATH = RAW / "gvp" / "holocene_volcanoes.geojson"
IMPACT_PATH = RAW / "wikidata" / "impact_structures.json"

CONTEXT_SOURCES = {
    "GVP_VOTW": {"provider": "Smithsonian Institution Global Volcanism Program",
                 "product": "Volcanoes of the World, Holocene volcano list (WFS)", "url": GVP_URL,
                 "citation": "Global Volcanism Program (2024) Volcanoes of the World v5.2.x. Smithsonian Institution. "
                             "doi:10.5479/si.GVP.VOTW5-2024.5.2", "licence": "Smithsonian terms of use (attribution)"},
    "WIKIDATA_IMPACTS": {"provider": "Wikidata (Wikimedia Foundation)",
                         "product": "Instances of impact crater (Q55818) on Earth with coordinates (SPARQL)",
                         "url": "https://query.wikidata.org/", "citation": "Wikidata contributors; CC0",
                         "licence": "CC0", "caveat": "community-curated; may include unconfirmed structures"},
    "NATURAL_EARTH": {"provider": "Natural Earth", "product": "Admin 0 countries 1:50m",
                      "url": "https://www.naturalearthdata.com/", "citation": "Natural Earth (public domain)",
                      "licence": "public domain"},
}


def _ensure(url: str, path, headers_note: str = "") -> dict:
    meta = read_meta(path)
    if meta and path.exists():
        return {**meta, "sha256": sha256_file(path)}
    fetch(url, path, timeout=120)
    return {**(read_meta(path) or {}), "sha256": sha256_file(path)}


def load_volcanoes() -> tuple[list[dict], dict]:
    meta = _ensure(GVP_URL, GVP_PATH)
    data = json.loads(GVP_PATH.read_text(encoding="utf-8"))
    out = []
    for f in data["features"]:
        lon, lat = f["geometry"]["coordinates"][:2]
        p = f["properties"]
        out.append({"lon": float(lon), "lat": float(lat), "name": p.get("Volcano_Name"),
                    "type": p.get("Primary_Volcano_Type"), "number": p.get("Volcano_Number")})
    return out, meta


def load_impacts() -> tuple[list[dict], dict]:
    meta = _ensure(WIKIDATA_URL, IMPACT_PATH)
    data = json.loads(IMPACT_PATH.read_text(encoding="utf-8"))
    seen, out = set(), []
    for b in data["results"]["bindings"]:
        qid = b["item"]["value"].rsplit("/", 1)[-1]
        if qid in seen:
            continue
        seen.add(qid)
        point = b["coord"]["value"]  # "Point(lon lat)"
        lon, lat = (float(v) for v in point[point.index("(") + 1:point.index(")")].split())
        out.append({"lon": lon, "lat": lat, "name": b.get("itemLabel", {}).get("value", qid), "qid": qid})
    return out, meta


def nearest(points: list[dict], lon: np.ndarray, lat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Great-circle distance (km) and index of the nearest inventory point for every window."""
    if not points:
        return np.full(len(lon), np.nan), np.full(len(lon), -1)
    plon = np.radians([p["lon"] for p in points])[None, :]
    plat = np.radians([p["lat"] for p in points])[None, :]
    wl, wp = np.radians(lon)[:, None], np.radians(lat)[:, None]
    h = np.sin((plat - wp) / 2) ** 2 + np.cos(wp) * np.cos(plat) * np.sin((plon - wl) / 2) ** 2
    d = 2 * EARTH_R_KM * np.arcsin(np.sqrt(np.clip(h, 0, 1)))
    i = np.argmin(d, axis=1)
    return d[np.arange(len(lon)), i], i


def window_context(windows: list[dict]) -> tuple[dict[str, dict], dict]:
    """Context per Earth window id; ``windows`` needs id, lon, lat."""
    lon = np.array([w["lon"] for w in windows], float)
    lat = np.array([w["lat"] for w in windows], float)
    volcanoes, vmeta = load_volcanoes()
    impacts, imeta = load_impacts()
    countries = load_countries()
    vd, vi = nearest(volcanoes, lon, lat)
    idist, ii = nearest(impacts, lon, lat)
    out = {}
    for k, w in enumerate(windows):
        out[w["id"]] = {
            "country_iso": country_of(w["lon"], w["lat"], countries),
            "volcano_km": round(float(vd[k]), 2), "volcano_name": volcanoes[vi[k]]["name"] if vi[k] >= 0 else None,
            "impact_km": round(float(idist[k]), 2), "impact_name": impacts[ii[k]]["name"] if ii[k] >= 0 else None,
        }
    provenance = {
        "GVP_VOTW": {**CONTEXT_SOURCES["GVP_VOTW"], "n": len(volcanoes), "sha256": vmeta.get("sha256"),
                     "accessed": vmeta.get("accessed")},
        "WIKIDATA_IMPACTS": {**CONTEXT_SOURCES["WIKIDATA_IMPACTS"], "n": len(impacts), "sha256": imeta.get("sha256"),
                             "accessed": imeta.get("accessed")},
        "NATURAL_EARTH": {**CONTEXT_SOURCES["NATURAL_EARTH"], "n": len(countries)},
    }
    return out, provenance


def build_context() -> str:
    volcanoes, _ = load_volcanoes()
    impacts, _ = load_impacts()
    return json.dumps({"volcanoes": len(volcanoes), "impact_structures": len(impacts),
                       "countries": len(load_countries())})


def km_to_deg(km: float) -> float:
    return km / (EARTH_R_KM * math.pi / 180)
