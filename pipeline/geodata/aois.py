# Written with AI assistance (Claude Code); reviewed by: pending (Geo lead).
"""AOI definitions with distinct site, AOI and leakage-group identifiers.

* ``site_id``  - a named place or sampled grid cell (one per physical location).
* ``aoi_id``   - one measured 22 km window around a site centre (one per site here).
* ``group_id`` - spatial block for train/test splitting: 2x2 degree cell on Earth,
                 named region on the Moon/Mars. Sites in one block must share a split.
Tile IDs (source rasters) and patch IDs (derived grids) are defined in features/catalog.
"""
from __future__ import annotations

import csv
import math
from dataclasses import asdict, dataclass, field

from pipeline.geodata import ROOT

HALF_M = 11000  # 20 km core + 1 km margin, as in pipeline.earth.export.ingest_local

PILOT_SITES = {  # pilot aoi_id -> (site_id, region label)
    "PR_JETT_SP_CRATER": ("SITE_SP_CRATER_AZ", "San Francisco volcanic field, Arizona"),
    "GL_W116.820_N36.240": ("SITE_DEATH_VALLEY_CA", "Death Valley, California"),
    "KZ_E051.200_N43.400": ("SITE_MANGYSTAU_CASPIAN_KZ", "Caspian coast, Mangystau, Kazakhstan"),
    "PILOT_ATACAMA": ("SITE_ATACAMA_CL", "Atacama Desert, Chile"),
    "PILOT_UTAH": ("SITE_UTAH_DESERT_US", "Colorado Plateau desert, Utah"),
    "PILOT_ICELAND": ("SITE_ICELAND_HIGHLANDS_IS", "Icelandic volcanic highlands"),
    "PILOT_WADI_RUM": ("SITE_WADI_RUM_JO", "Wadi Rum, Jordan"),
    "PILOT_RIO_TINTO": ("SITE_RIO_TINTO_ES", "Rio Tinto, Andalusia, Spain"),
    "PILOT_BOSZHIRA": ("SITE_BOZJYRA_KZ", "Bozjyra (Boszhira), Ustyurt plateau, Kazakhstan"),
}

# PGDA product 78 site names as listed in docs/science/DATASET_SPECIFICATION.md section 1.
# Centres are NOT typed in: they are taken from each raster's extent centre at acquisition.
MOON_PGDA_SITES = {
    "Site01": "Connecting ridge", "Site04": "Shackleton rim", "Site07": "Peak near Shackleton",
    "Site11": "de Gerlache rim", "Site23": "Malapert massif",
}


@dataclass
class AOI:
    aoi_id: str
    site_id: str
    group_id: str
    body: str
    name: str
    region: str
    lon: float | None   # planetocentric, east-positive, [-180, 180]
    lat: float | None
    pool: str           # pilot | target | target_extra | sampled
    country: str | None = None
    product: str | None = None        # planetary DEM product URL/key
    fine_baseline_m: int | None = None
    notes: list[str] = field(default_factory=list)

    def to_dict(self):
        return asdict(self)


def earth_group(lon: float, lat: float) -> str:
    gx, gy = math.floor(lon / 2) * 2, math.floor(lat / 2) * 2
    return f"EARTH_G{'N' if gy >= 0 else 'S'}{abs(gy):02d}{'E' if gx >= 0 else 'W'}{abs(gx):03d}"


def pilot_aois(manifest=ROOT / "data/pilot/earth_manifest.csv") -> list[AOI]:
    out = []
    with open(manifest, newline="", encoding="utf-8") as file:
        for row in csv.DictReader(file):
            site_id, region = PILOT_SITES[row["id"]]
            lon, lat = float(row["lon"]), float(row["lat"])
            notes = ["pilot window from data/pilot/earth_manifest.csv"]
            if row["id"] == "KZ_E051.200_N43.400":
                notes.append("water-dominated coastal window; excluded from analog ranking in the pilot")
            out.append(AOI(row["id"], site_id, earth_group(lon, lat), "earth", row["name"], region, lon, lat,
                           "pilot", row.get("country") or None, notes=notes))
    return out


def planetary_aois(curated=ROOT / "data/curated/targets.csv") -> list[AOI]:
    out = []
    with open(curated, newline="", encoding="utf-8") as file:
        for row in csv.DictReader(file):
            body = row["body"]
            if body == "moon":
                product = "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site20v2/Site20v2_final_adj_5mpp_surf.tif"
                group = "MOON_SOUTH_POLE"
            else:
                product = ("https://planetarymaps.usgs.gov/mosaic/Mars/HRSC_MOLA_Blend/"
                           "Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif")
                group = "MARS_" + row["id"].split("_", 1)[1]
            out.append(AOI(row["id"], "SITE_" + row["id"], group, body, row["name"], row["kind"],
                           float(row["lon"]), float(row["lat"]), "target", product=product,
                           fine_baseline_m=int(row["fine_baseline_m"]),
                           notes=[f"curated target (data/curated/targets.csv), sources {row['source_keys']}"]))
    for site, name in MOON_PGDA_SITES.items():
        aoi_id = f"MOON_PGDA_{site.upper()}"
        out.append(AOI(aoi_id, "SITE_" + aoi_id, "MOON_SOUTH_POLE", "moon", f"{name} (PGDA {site})",
                       "lunar south pole", None, None, "target_extra",
                       product=f"https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/{site}/{site}_final_adj_5mpp_surf.tif",
                       fine_baseline_m=100,
                       notes=["centre = native raster extent centre (computed at acquisition)",
                              "PGDA site tiles are ~20 km; the 1 km margin may be partly nodata"]))
    return out
