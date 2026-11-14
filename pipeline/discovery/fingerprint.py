"""Multidimensional fingerprints for Earth windows and planetary targets.

One loader pools the geo-0.1.0 release and the Earth-wide index (same column
definitions). A fingerprint holds, per dimension, the feature values with a 1-sigma
uncertainty, the evidence class and the source. Missing values stay missing.
"""
from __future__ import annotations

import csv
import json
from dataclasses import dataclass, field

from pipeline.discovery import GEO_RELEASE, OUT
from pipeline.discovery import dimensions as D
from pipeline.discovery.sites import TARGETS, TargetSpec

INDEX_DIR = OUT / "index"
EARTH_POOLS_POPULATION = ("global_lattice",)   # unbiased near-equal-area sample used for percentiles


@dataclass
class Window:
    id: str
    body: str
    pool: str
    name: str
    lon: float
    lat: float
    coverage_level: str
    quality: str
    release: str
    features: dict[str, float | str | None]
    context: dict[str, float | str | None] = field(default_factory=dict)

    def f(self, name: str) -> float | None:
        v = self.features.get(name)
        return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _num(v: str):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except ValueError:
        return v


def _read_csv(path) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


BOOK = {"aoi_id", "site_id", "group_id", "body", "pool", "lon", "lat", "coverage_level", "quality_status", "name",
        "country_iso", "volcano_km", "volcano_name", "impact_km", "impact_name"}
CONTEXT = ("country_iso", "volcano_km", "volcano_name", "impact_km", "impact_name")


def load_windows(geo_release=GEO_RELEASE, index_dir=INDEX_DIR) -> list[Window]:
    """All windows (Earth + planetary), geo-0.1.0 first, then the Earth-wide index."""
    out: dict[str, Window] = {}
    catalog = json.loads((geo_release / "aoi_catalog.json").read_text(encoding="utf-8"))
    names = {a["aoi_id"]: a.get("name") or a["aoi_id"] for a in catalog["aois"]}
    geo_ctx = {}
    if (index_dir / "context_geo-0.1.0.csv").exists():
        geo_ctx = {r["aoi_id"]: {k: _num(r[k]) for k in CONTEXT} for r in _read_csv(index_dir / "context_geo-0.1.0.csv")}
    for r in _read_csv(geo_release / "aoi_features.csv"):
        out[r["aoi_id"]] = Window(r["aoi_id"], r["body"], r["pool"], names.get(r["aoi_id"], r["aoi_id"]),
                                  float(r["lon"]), float(r["lat"]), r["coverage_level"], r["quality_status"], "geo-0.1.0",
                                  {k: _num(v) for k, v in r.items() if k not in BOOK}, geo_ctx.get(r["aoi_id"], {}))
    path = index_dir / "windows.csv"
    if path.exists():
        for r in _read_csv(path):
            if r["aoi_id"] in out:
                continue
            out[r["aoi_id"]] = Window(r["aoi_id"], r["body"], r["pool"], r.get("name") or r["aoi_id"],
                                      float(r["lon"]), float(r["lat"]), r["coverage_level"], r["quality_status"],
                                      "index", {k: _num(v) for k, v in r.items() if k not in BOOK},
                                      {k: _num(r.get(k, "")) for k in CONTEXT})
    return list(out.values())


def earth_windows(windows: list[Window]) -> list[Window]:
    """Earth windows usable for ranking: terrain computed on >= 90 % valid DEM (L1 or better)."""
    return [w for w in windows if w.body == "earth" and w.coverage_level != "L0_sampled"]


# ----------------------------------------------------------------------------- feature uncertainty

def dem_source(body: str) -> str:
    return {"earth": "COP_GLO30", "moon": "PGDA_LOLA_5MPP", "mars": "USGS_MARS_BLEND"}[body]


def slope_sigma_deg(baseline_m: float, body: str) -> float:
    """1-sigma on a slope statistic from relative vertical error over the baseline (two-post difference)."""
    import math
    sz = D.DEM_ERROR[dem_source(body)]["sigma_z_m"]
    return math.degrees(math.sqrt(2) * sz / baseline_m)


# ----------------------------------------------------------------------------- targets

@dataclass
class Target:
    spec: TargetSpec
    window: Window
    baseline: int

    @property
    def id(self) -> str:
        return self.spec.id

    @property
    def body(self) -> str:
        return self.spec.body


def load_targets(windows: list[Window]) -> list[Target]:
    by_id = {w.id: w for w in windows}
    out = []
    for spec in TARGETS:
        w = by_id.get(spec.window)
        if w is None or w.f(f"slope_f{spec.fine_baseline_m}_p50_deg") is None:
            continue  # target terrain not acquired yet: reported by the bundle as unavailable
        out.append(Target(spec, w, spec.fine_baseline_m))
    return out


def target_fingerprint(t: Target) -> dict:
    """Human-readable fingerprint (values, sigma, evidence) for one planetary target."""
    w, b = t.window, t.baseline
    src = dem_source(t.body)
    pen = D.RESOLUTION_PENALTY[src]
    ss = slope_sigma_deg(b, t.body)

    def feat(name, unit, sigma, evidence="derived", source=src):
        v = w.f(name)
        return {"value": v, "unit": unit, "sigma": None if v is None else sigma(v), "evidence": evidence, "source": source}

    terrain = {
        f"slope_f{b}_p50_deg": feat(f"slope_f{b}_p50_deg", "deg", lambda v: ss + pen * v),
        f"slope_f{b}_p90_deg": feat(f"slope_f{b}_p90_deg", "deg", lambda v: ss + pen * v),
        f"tri_f{b}_m": feat(f"tri_f{b}_m", "m", lambda v: D.DEM_ERROR[src]["sigma_z_m"] / 2 + pen * v),
        "slope_r_p50_deg": feat("slope_r_p50_deg", "deg", lambda v: slope_sigma_deg(2000, t.body) + pen * v),
        "relief_m": feat("relief_m", "m", lambda v: 2 * D.DEM_ERROR[src]["sigma_z_m"]),
    }
    lo, hi = D.noon_elevation_range(w.lat, D.BODY[t.body]["obliquity_deg"])
    fp = {
        "terrain": terrain,
        "surface": {"vegetation_frac": {"value": 0.0, "unit": "fraction", "sigma": 0.0, "evidence": "physical_constraint",
                                        "source": "no vegetation on the Moon or Mars"}},
        "water": {"liquid_precip_mm": {"value": 0.0, "unit": "mm/yr", "sigma": 0.0, "evidence": "physical_constraint",
                                       "source": "no liquid precipitation at present-day surface conditions"}},
        "illumination": {"noon_elevation_min_deg": {"value": round(lo, 3), "unit": "deg", "sigma": 0.0, "evidence": "derived",
                                                    "source": f"latitude {w.lat:.4f}, obliquity {D.BODY[t.body]['obliquity_deg']} deg"},
                         "noon_elevation_max_deg": {"value": round(hi, 3), "unit": "deg", "sigma": 0.0, "evidence": "derived",
                                                    "source": f"latitude {w.lat:.4f}, obliquity {D.BODY[t.body]['obliquity_deg']} deg"}},
        "geology": {"classes": {"value": list(t.spec.geology), "unit": "class", "sigma": None,
                                "evidence": "literature", "source": t.spec.geology_reference}},
    }
    th = D.THERMAL_REFERENCE[t.body]
    fp["thermal"] = {"air_or_surface_range_k": {"value": [th["min_k"], th["max_k"]], "unit": "K", "sigma": None,
                                                "evidence": "literature", "source": f"{th['quantity']}; {th['scope']}; {th['source']}"}}
    return fp
