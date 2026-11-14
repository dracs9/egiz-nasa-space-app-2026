"""Candidate windows for the Earth-wide discovery index, benchmark sites and planetary targets.

Every window is a 22 km AOI processed by the unchanged geodata stages, so lattice
cells, benchmark sites and the geo-0.1.0 release share one feature definition.

Global lattice   Fibonacci points on the sphere (near-equal area); a point is kept
                 when its Copernicus GLO-30 1-degree tile exists (land) and its
                 latitude is inside the UTM domain (80 S - 84 N).
Regional lattice Hexagonal points at a finer spacing inside a Natural Earth country
                 polygon (Kazakhstan by default).
Benchmark        Published analog field sites with their citation and role. Roles are
                 labels for validation only; they never enter scoring.
Targets          Planetary reference windows. Mars landing sites added here use the same
                 HRSC/MOLA blend DEM as Jezero; coordinates are from the cited papers.
"""
from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass, field

from pipeline.discovery import RAW
from pipeline.geodata.aois import AOI, earth_group

GOLDEN = math.pi * (3 - math.sqrt(5))
EARTH_R_KM = 6371.0088
NATURAL_EARTH = RAW / "natural_earth" / "ne_50m_admin_0_countries.geojson"
NATURAL_EARTH_URL = ("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
                     "ne_50m_admin_0_countries.geojson")
MARS_BLEND = "https://planetarymaps.usgs.gov/mosaic/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif"


# ----------------------------------------------------------------------------- identifiers

def cell_id(prefix: str, lon: float, lat: float) -> str:
    return f"{prefix}_{'E' if lon >= 0 else 'W'}{abs(lon):07.3f}_{'N' if lat >= 0 else 'S'}{abs(lat):06.3f}"


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_R_KM * math.asin(min(1.0, math.sqrt(h)))


def tile_key(lon: float, lat: float) -> str:
    x, y = math.floor(lon), math.floor(lat)
    return f"Copernicus_DSM_COG_10_{'N' if y >= 0 else 'S'}{abs(y):02d}_00_{'E' if x >= 0 else 'W'}{abs(x):03d}_00_DEM"


# ----------------------------------------------------------------------------- lattices

def fibonacci_points(spacing_km: float) -> list[tuple[float, float]]:
    """Near-equal-area points whose mean nearest spacing is about ``spacing_km``."""
    n = max(10, round(4 * math.pi * EARTH_R_KM ** 2 / spacing_km ** 2))
    out = []
    for i in range(n):
        z = 1 - (2 * i + 1) / n
        lat = math.degrees(math.asin(z))
        lon = math.degrees((i * GOLDEN) % (2 * math.pi))
        lon = (lon + 180) % 360 - 180
        out.append((round(lon, 3), round(lat, 3)))
    return out


def global_lattice(tile_names: set[str], spacing_km: float = 220.0, lat_range=(-80.0, 84.0)) -> list[AOI]:
    aois = []
    for lon, lat in fibonacci_points(spacing_km):
        if not lat_range[0] <= lat <= lat_range[1] or tile_key(lon, lat) not in tile_names:
            continue
        aid = cell_id("GX", lon, lat)
        aois.append(AOI(aid, "SITE_" + aid, earth_group(lon, lat), "earth", f"Global lattice cell {aid[3:]}",
                        "global lattice", lon, lat, "global_lattice",
                        notes=[f"Fibonacci lattice, {spacing_km:g} km nominal spacing; land test = GLO-30 tile exists"]))
    return aois


def load_countries(path=NATURAL_EARTH) -> list[dict]:
    if not path.exists():
        from pipeline.geodata.cache import fetch
        fetch(NATURAL_EARTH_URL, path)
    data = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for f in data["features"]:
        geom = f["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        out.append({"name": f["properties"].get("NAME") or f["properties"].get("ADMIN"),
                    "iso": f["properties"].get("ISO_A3") or f["properties"].get("ADM0_A3"),
                    "polys": polys, "bbox": _bbox(polys)})
    return out


def _bbox(polys):
    xs = [p[0] for poly in polys for p in poly[0]]
    ys = [p[1] for poly in polys for p in poly[0]]
    return min(xs), min(ys), max(xs), max(ys)


def _in_ring(x: float, y: float, ring) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-300) + xi:
            inside = not inside
        j = i
    return inside


def in_country(lon: float, lat: float, country: dict) -> bool:
    x0, y0, x1, y1 = country["bbox"]
    if not (x0 <= lon <= x1 and y0 <= lat <= y1):
        return False
    for poly in country["polys"]:
        if _in_ring(lon, lat, poly[0]) and not any(_in_ring(lon, lat, hole) for hole in poly[1:]):
            return True
    return False


def country_of(lon: float, lat: float, countries: list[dict]) -> str | None:
    for c in countries:
        if in_country(lon, lat, c):
            return c["iso"]
    return None


def regional_lattice(iso: str = "KAZ", spacing_km: float = 75.0, prefix: str = "KZX",
                     countries: list[dict] | None = None) -> list[AOI]:
    countries = countries or load_countries()
    country = next(c for c in countries if c["iso"] == iso)
    x0, y0, x1, y1 = country["bbox"]
    dlat = spacing_km * math.sqrt(3) / 2 / 111.195
    aois, row, lat = [], 0, y0
    while lat <= y1:
        dlon = spacing_km / (111.195 * math.cos(math.radians(lat)))
        lon = x0 + (dlon / 2 if row % 2 else 0)
        while lon <= x1:
            if in_country(lon, lat, country):
                lo, la = round(lon, 3), round(lat, 3)
                aid = cell_id(prefix, lo, la)
                aois.append(AOI(aid, "SITE_" + aid, earth_group(lo, la), "earth", f"{country['name']} regional cell",
                                f"{country['name']} regional lattice", lo, la, "regional_lattice", iso,
                                notes=[f"hexagonal lattice, {spacing_km:g} km spacing inside Natural Earth 1:50m {iso}"]))
            lon += dlon
        lat += dlat
        row += 1
    return aois


# ----------------------------------------------------------------------------- benchmark

@dataclass(frozen=True)
class BenchmarkSite:
    id: str
    name: str
    lon: float
    lat: float
    role: str                 # analog | hypothesis | negative_control
    bodies: tuple[str, ...]   # bodies the literature uses the site as an analog for
    aspects: tuple[str, ...]  # what the literature says the analogy is about
    program: str
    reference: str
    pilot_aoi: str | None = None  # reuse an existing geo-0.1.0 window instead of a new one
    notes: tuple[str, ...] = field(default_factory=tuple)

    def to_dict(self):
        return asdict(self)


BENCHMARK: tuple[BenchmarkSite, ...] = (
    BenchmarkSite("BM_HAUGHTON", "Haughton impact structure, Devon Island", -89.68, 75.38, "analog", ("mars",),
                  ("impact", "polar_desert", "terrain", "operations"), "Haughton-Mars Project (NASA/SETI)",
                  "Lee P., Osinski G.R. (2005) Meteoritics & Planetary Science 40(12):1755-1758; Osinski et al. (2005)"),
    BenchmarkSite("BM_SAN_FRANCISCO_VF", "SP Crater / Black Point lava flow, San Francisco volcanic field", -111.6286, 35.5733,
                  "analog", ("moon", "mars"), ("volcanic", "terrain", "eva_operations"), "NASA Desert RATS",
                  "Ross A. et al. (2013) Acta Astronautica 90:182-202 (Desert RATS 2010)", pilot_aoi="PR_JETT_SP_CRATER"),
    BenchmarkSite("BM_CRATERS_OF_THE_MOON", "Craters of the Moon lava field, Idaho", -113.52, 43.42, "analog", ("mars",),
                  ("basaltic_volcanism", "eva_operations"), "NASA BASALT",
                  "Lim D.S.S. et al. (2019) Astrobiology 19(3):245-259"),
    BenchmarkSite("BM_HAWAII_KILAUEA", "Kilauea East Rift / Mauna Ulu, Hawaii", -155.21, 19.36, "analog", ("mars",),
                  ("basaltic_volcanism", "eva_operations"), "NASA BASALT",
                  "Lim D.S.S. et al. (2019) Astrobiology 19(3):245-259"),
    BenchmarkSite("BM_MAUNA_KEA", "Mauna Kea flank (PISCES/ISRU field tests), Hawaii", -155.46, 19.76, "analog", ("moon",),
                  ("regolith", "isru", "volcanic"), "PISCES / NASA ISRU field demonstrations",
                  "Sanders G.B., Larson W.E. (2011) Journal of Aerospace Engineering 26(1):5-17"),
    BenchmarkSite("BM_LANZAROTE", "Timanfaya / Lanzarote volcanic terrain", -13.75, 29.0, "analog", ("moon", "mars"),
                  ("basaltic_volcanism", "lava_tubes", "training"), "ESA PANGAEA",
                  "Sauro F. et al. (2018) Lanzarote and Chinijo Islands Geopark, analogue for planetary geology; "
                  "Mateo Martin et al. (2016) PANGAEA training"),
    BenchmarkSite("BM_MDRS_UTAH", "Mars Desert Research Station, Hanksville, Utah", -110.75, 38.4, "analog", ("mars",),
                  ("sedimentary", "terrain", "operations"), "Mars Society MDRS",
                  "Clarke J.D.A., Stoker C.R. (2011) International Journal of Astrobiology 10(3):161-175",
                  pilot_aoi="PILOT_UTAH"),
    BenchmarkSite("BM_SVALBARD_BOCKFJORD", "Bockfjord volcanic complex, Svalbard", 13.33, 79.44, "analog", ("mars",),
                  ("volcanic", "carbonates", "cold"), "AMASE",
                  "Steele A. et al. (2007) Meteoritics & Planetary Science Supplement 42; Amundsen H.E.F. et al. (AMASE)"),
    BenchmarkSite("BM_DRY_VALLEYS", "Wright Valley, McMurdo Dry Valleys, Antarctica", 161.8, -77.52, "analog", ("mars",),
                  ("cold_desert", "permafrost", "aeolian"), "Antarctic Mars analog research",
                  "Marchant D.R., Head J.W. (2007) Icarus 192(1):187-222"),
    BenchmarkSite("BM_ATACAMA", "Atacama Desert hyperarid core, Chile", -69.5, -24.5, "analog", ("mars",),
                  ("hyperarid", "astrobiology", "terrain"), "NASA ARADS / Atacama rover tests",
                  "Navarro-Gonzalez R. et al. (2003) Science 302:1018-1021", pilot_aoi="PILOT_ATACAMA"),
    BenchmarkSite("BM_RIO_TINTO", "Rio Tinto acidic drainage, Andalusia", -6.6, 37.7, "analog", ("mars",),
                  ("acidic_aqueous", "jarosite", "astrobiology"), "MARTE",
                  "Fernandez-Remolar D.C. et al. (2005) Earth and Planetary Science Letters 240:149-167",
                  pilot_aoi="PILOT_RIO_TINTO",
                  notes=("geochemical analog: terrain similarity is not what the literature claims",)),
    BenchmarkSite("BM_METEOR_CRATER", "Meteor Crater (Barringer), Arizona", -111.02, 35.03, "analog", ("moon",),
                  ("impact", "training"), "Apollo geology training",
                  "Phinney W.C. (2015) Science Training History of the Apollo Astronauts, NASA SP-2015-626"),
    BenchmarkSite("BM_ASKJA", "Askja caldera, Iceland highlands", -16.75, 65.05, "analog", ("moon",),
                  ("volcanic", "training"), "Apollo geology training",
                  "Phinney W.C. (2015) Science Training History of the Apollo Astronauts, NASA SP-2015-626"),
    # Kazakhstan hypotheses: candidates of interest, never forced into rankings.
    BenchmarkSite("KZ_ARALKUM", "Aralkum (exposed Aral Sea bed)", 60.5, 45.2, "hypothesis", ("mars",),
                  ("evaporite", "aeolian"), "EGIZ hypothesis", "hypothesis; no published analog campaign used"),
    BenchmarkSite("KZ_ZHAMANSHIN", "Zhamanshin impact structure", 60.93, 48.36, "hypothesis", ("moon", "mars"),
                  ("impact",), "EGIZ hypothesis", "Confirmed impact structure (Earth Impact Database); analog use is a hypothesis"),
    BenchmarkSite("KZ_USTYURT", "Ustyurt plateau escarpment (chink)", 56.5, 44.0, "hypothesis", ("mars",),
                  ("sedimentary", "escarpment"), "EGIZ hypothesis", "hypothesis"),
    BenchmarkSite("KZ_BOSZHIRA", "Boszhira canyon, Ustyurt", 54.2, 43.4, "hypothesis", ("mars",),
                  ("sedimentary", "badlands"), "EGIZ hypothesis", "hypothesis", pilot_aoi="PILOT_BOSZHIRA"),
    # Designated negative controls: land windows dominated by vegetation, cropland or wetland.
    BenchmarkSite("NC_AMAZON", "Central Amazon rainforest", -60.0, -3.0, "negative_control", ("moon", "mars"),
                  ("dense_vegetation",), "control", "chosen a priori as an implausible analog (closed forest)"),
    BenchmarkSite("NC_CONGO", "Congo basin rainforest", 23.0, 0.5, "negative_control", ("moon", "mars"),
                  ("dense_vegetation",), "control", "chosen a priori as an implausible analog (closed forest)"),
    BenchmarkSite("NC_NETHERLANDS", "Flevoland polder, Netherlands", 5.5, 52.45, "negative_control", ("moon", "mars"),
                  ("cropland", "flat_wet"), "control", "chosen a priori as an implausible analog (reclaimed farmland)"),
    BenchmarkSite("NC_GANGES_DELTA", "Ganges-Brahmaputra delta, Bangladesh", 90.3, 23.5, "negative_control",
                  ("moon", "mars"), ("cropland", "wetland"), "control",
                  "chosen a priori as an implausible analog (irrigated delta)"),
)


def benchmark_aois() -> list[AOI]:
    out = []
    for b in BENCHMARK:
        if b.pilot_aoi:
            continue
        out.append(AOI(b.id, "SITE_" + b.id, earth_group(b.lon, b.lat), "earth", b.name, b.program, b.lon, b.lat,
                       "benchmark", notes=[f"{b.role}: {b.reference}"]))
    return out


def benchmark_window(b: BenchmarkSite) -> str:
    return b.pilot_aoi or b.id


# ----------------------------------------------------------------------------- planetary targets

@dataclass(frozen=True)
class TargetSpec:
    id: str
    body: str
    name: str
    lon: float | None
    lat: float | None
    kind: str
    significance: str
    coordinate_reference: str
    geology: tuple[str, ...]              # common-vocabulary classes, literature-derived
    geology_reference: str
    window: str                           # aoi_id holding its measured terrain
    fine_baseline_m: int


TARGETS: tuple[TargetSpec, ...] = (
    TargetSpec("MOON_MONS_MOUTON", "moon", "Mons Mouton (Artemis candidate region)", None, None, "base_region",
               "South-polar massif in an Artemis III candidate region; persistent low-Sun illumination.",
               "PGDA LOLA 5 m/px Site20v2 extent centre (data/curated/targets.csv)",
               ("anorthositic_highlands", "impact_regolith"),
               "Lunar south-polar highlands are feldspathic (anorthositic) crust mantled by impact regolith; "
               "Jolliff B.L. et al. (2000) JGR 105(E2):4197; Spudis P.D. et al. (2008) GRL 35:L14201",
               "MOON_MONS_MOUTON", 100),
    TargetSpec("MOON_SHACKLETON_RIM", "moon", "Shackleton crater rim (PGDA Site04)", None, None, "base_region",
               "Near-permanently illuminated rim segments next to a permanently shadowed crater interior.",
               "PGDA LOLA 5 m/px Site04 extent centre", ("anorthositic_highlands", "impact_regolith"),
               "Zuber M.T. et al. (2012) Nature 486:378-381; Spudis et al. (2008)", "MOON_PGDA_SITE04", 100),
    TargetSpec("MOON_CONNECTING_RIDGE", "moon", "Shackleton-de Gerlache connecting ridge (PGDA Site01)", None, None,
               "base_region", "High-illumination ridge studied for lunar south-pole base siting.",
               "PGDA LOLA 5 m/px Site01 extent centre", ("anorthositic_highlands", "impact_regolith"),
               "Mazarico E. et al. (2011) Icarus 211:1066-1081", "MOON_PGDA_SITE01", 100),
    TargetSpec("MOON_SHACKLETON_PEAK", "moon", "Peak near Shackleton (PGDA Site07)", None, None, "base_region",
               "Elevated south-polar peak with long illumination periods.", "PGDA LOLA 5 m/px Site07 extent centre",
               ("anorthositic_highlands", "impact_regolith"), "Mazarico E. et al. (2011) Icarus 211:1066-1081",
               "MOON_PGDA_SITE07", 100),
    TargetSpec("MOON_DE_GERLACHE_RIM", "moon", "de Gerlache crater rim (PGDA Site11)", None, None, "base_region",
               "Rim of a polar crater adjacent to permanently shadowed regions.", "PGDA LOLA 5 m/px Site11 extent centre",
               ("anorthositic_highlands", "impact_regolith"), "Mazarico E. et al. (2011) Icarus 211:1066-1081",
               "MOON_PGDA_SITE11", 100),
    TargetSpec("MOON_MALAPERT", "moon", "Malapert massif (PGDA Site23)", None, None, "base_region",
               "Massif with Earth visibility and favourable illumination; Artemis candidate region.",
               "PGDA LOLA 5 m/px Site23 extent centre", ("anorthositic_highlands", "impact_regolith"),
               "Mazarico E. et al. (2011); NASA Artemis III candidate regions (2022)", "MOON_PGDA_SITE23", 100),
    TargetSpec("MARS_JEZERO", "mars", "Jezero crater (Perseverance landing site)", 77.4509, 18.4446, "landing_site",
               "Ancient lake delta; crater-floor igneous units and fluvio-deltaic sediments with carbonates.",
               "Farley K.A. et al. (2020) Space Science Reviews 216:142",
               ("basaltic_mafic", "olivine_cumulate", "sedimentary_clastic", "carbonate"),
               "Farley K.A. et al. (2022) Science 377:eabo2196; Horgan B.H.N. et al. (2020) Icarus 339:113526",
               "MARS_JEZERO", 400),
    TargetSpec("MARS_GALE", "mars", "Gale crater (Curiosity, Bradbury landing)", 137.4417, -4.5895, "landing_site",
               "Layered sedimentary mound (Aeolis Mons) recording lacustrine and aeolian deposition.",
               "Grotzinger J.P. et al. (2012) Space Science Reviews 170:5-56",
               ("sedimentary_clastic", "basaltic_mafic", "clay_bearing", "sulfate_evaporite"),
               "Grotzinger J.P. et al. (2014) Science 343:1242777; Rampe E.B. et al. (2020) Geochemistry 80:125605",
               "MARS_GALE", 400),
    TargetSpec("MARS_OXIA_PLANUM", "mars", "Oxia Planum (Rosalind Franklin landing site)", -24.632, 18.275, "landing_site",
               "Extensive Fe/Mg clay-bearing layered unit; ExoMars astrobiology target.",
               "Quantin-Nataf C. et al. (2021) Astrobiology 21(3):345-366",
               ("clay_bearing", "sedimentary_clastic", "basaltic_mafic"),
               "Quantin-Nataf C. et al. (2021) Astrobiology 21(3):345-366", "MARS_OXIA_PLANUM", 400),
    TargetSpec("MARS_UTOPIA_ZHURONG", "mars", "Southern Utopia Planitia (Zhurong landing site)", 109.925, 25.066,
               "landing_site", "Northern-lowland plains with possible ancient ocean / mud-volcano features.",
               "Ding L. et al. (2022) Nature Astronomy 6:1022-1029 (landing site localisation)",
               ("basaltic_mafic", "sedimentary_clastic"),
               "Zhao J. et al. (2021) Geophysical Research Letters 48:e2021GL094903", "MARS_UTOPIA_ZHURONG", 400),
)


def new_target_aois() -> list[AOI]:
    """Mars targets that geo-0.1.0 does not contain (same DEM product and grids as Jezero)."""
    existing = {"MARS_JEZERO", "MOON_MONS_MOUTON"} | {t.window for t in TARGETS if t.window.startswith("MOON_PGDA")}
    out = []
    for t in TARGETS:
        if t.window in existing:
            continue
        out.append(AOI(t.window, "SITE_" + t.window, "MARS_" + t.window.split("_", 1)[1], t.body, t.name, t.kind,
                       t.lon, t.lat, "target", product=MARS_BLEND, fine_baseline_m=t.fine_baseline_m,
                       notes=[f"coordinates: {t.coordinate_reference}"]))
    return out
