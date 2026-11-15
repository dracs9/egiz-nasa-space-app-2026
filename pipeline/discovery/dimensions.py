"""Scientific dimension registry, physical constants and error models.

Each dimension is scored independently; nothing is hidden inside one number.
Statuses per (window, target, dimension):

  measured        Earth and target sides both have data for this dimension
  not_assessed    no dataset was acquired for it (reason + integration path given)
  not_applicable  the physics does not apply to the target (e.g. wind on the Moon)
  missing         the dimension is assessed in general but this window lacks the data

All tolerances below were fixed a priori (before any benchmark result) and are
documented in docs/discovery/METHODOLOGY.md. They are not tuned on the benchmark.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

# ----------------------------------------------------------------------------- constants with citations

NSSDC_MOON = "NASA NSSDCA Moon Fact Sheet (nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html)"
NSSDC_MARS = "NASA NSSDCA Mars Fact Sheet (nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html)"
NSSDC_EARTH = "NASA NSSDCA Earth Fact Sheet (nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html)"

BODY = {
    "earth": {"g_m_s2": 9.80665, "obliquity_deg": 23.44, "day_h": 24.0, "solar_constant_w_m2": 1361.0,
              "pressure_pa": 101325.0, "atmosphere": "N2 78.08 %, O2 20.95 %, Ar 0.93 %", "magnetic_field": True,
              "source": NSSDC_EARTH},
    "moon": {"g_m_s2": 1.62, "obliquity_deg": 1.54, "day_h": 708.7, "solar_constant_w_m2": 1361.0,
             "pressure_pa": 3e-10, "atmosphere": "surface-bounded exosphere (He, Ar, Ne); effectively vacuum",
             "magnetic_field": False, "source": NSSDC_MOON},
    "mars": {"g_m_s2": 3.73, "obliquity_deg": 25.19, "day_h": 24.66, "solar_constant_w_m2": 586.2,
             "pressure_pa": 636.0, "atmosphere": "CO2 95.1 %, N2 2.59 %, Ar 1.94 %", "magnetic_field": False,
             "source": NSSDC_MARS},
}

THERMAL_REFERENCE = {
    # Near-surface AIR temperature (comparable in kind to Earth 2 m air temperature).
    "mars": {"min_k": 184.0, "max_k": 242.0, "quantity": "near-surface air temperature, diurnal range",
             "scope": "Viking Lander 1 site (body-level reference, not site-specific)", "source": NSSDC_MARS},
    # The Moon has no air: surface temperature only, never compared with Earth air temperature.
    "moon": {"min_k": 95.0, "max_k": 390.0, "quantity": "equatorial surface temperature, diurnal range",
             "scope": "equatorial; polar cold traps reach ~25 K (Paige D.A. et al. 2010, Science 330:479)",
             "source": NSSDC_MOON},
}

RADIATION = {
    "earth": {"msv_per_day": 0.39 / 365.25, "scope": "sea-level cosmic-ray component only (UNSCEAR 2008)",
              "source": "UNSCEAR 2008 Report, Annex B"},
    "mars": {"msv_per_day": 0.64, "scope": "Gale crater surface, MSL/RAD", "source":
             "Hassler D.M. et al. (2014) Science 343:1244797"},
    "moon": {"msv_per_day": 1.369, "scope": "lunar far side surface, Chang'e-4 LND",
             "source": "Zhang S. et al. (2020) Science Advances 6:eaaz1334"},
}

# ----------------------------------------------------------------------------- error models

DEM_ERROR = {
    # relative vertical error used to propagate slope / roughness uncertainty
    "COP_GLO30": {"sigma_z_m": 2.0, "evidence": "documented",
                  "basis": "Copernicus DEM relative vertical accuracy < 2 m (LE90) for slopes <= 20 %; "
                           "Copernicus DEM Product Handbook (AIRBUS, 2020)"},
    "PGDA_LOLA_5MPP": {"sigma_z_m": 1.0, "evidence": "assumed",
                       "basis": "order of LOLA-adjusted 5 m DEM height residuals; Barker M.K. et al. (2021) PSS 197:105119"},
    "USGS_MARS_BLEND": {"sigma_z_m": 10.0, "evidence": "assumed",
                        "basis": "HRSC/MOLA blend of mixed effective resolution; Fergason R.L. et al. (2018) USGS"},
}
# Effective-resolution penalty: the Mars blend DEM is posted at 200 m but parts carry MOLA
# (~460 m) resolution, so slopes at a 400 m baseline are smoothed. Relative 1-sigma on
# fine-baseline slope statistics (assumed, documented; applied to the target side only).
RESOLUTION_PENALTY = {"USGS_MARS_BLEND": 0.25, "PGDA_LOLA_5MPP": 0.0, "COP_GLO30": 0.0}

# Error models used only by on-demand points (pipeline.discovery.point). Kept apart so the
# published bundle constants, and therefore its content hash, are unchanged.
POINT_DEM_ERROR = {
    "LOLA_LDEM_118M": {"sigma_z_m": 5.0, "evidence": "assumed",
                       "basis": "LOLA global gridded DEM 118 m/px (256 ppd), interpolated between altimeter tracks "
                                "away from the poles; Smith D.E. et al. (2010) GRL 37:L18204; USGS Astrogeology mosaic"},
}
POINT_RESOLUTION_PENALTY = {"LOLA_LDEM_118M": 0.15}


def dem_error(src: str) -> dict:
    return DEM_ERROR[src] if src in DEM_ERROR else POINT_DEM_ERROR[src]


def resolution_penalty(src: str) -> float:
    return RESOLUTION_PENALTY[src] if src in RESOLUTION_PENALTY else POINT_RESOLUTION_PENALTY[src]


WORLDCOVER_SIGMA = 0.08   # absolute 1-sigma on class fractions (WorldCover v200 overall accuracy 76.7 %)
POWER_T_SIGMA_K = 2.0     # 1-sigma on monthly 2 m air temperature climatology (0.5 deg cell vs window)
POWER_P_REL_SIGMA = 0.25  # relative 1-sigma on annual precipitation (MERRA-2 based climatology)
MAP_SCALE_SIGMA = {"large": 0.10, "medium": 0.15, "small": 0.25, "tiny": 0.30}

# ----------------------------------------------------------------------------- tolerances (a priori)

TAU = {
    "slope_w1_deg": 3.0,     # W1 between slope distributions; 3 deg mean shift -> similarity 1/e
    "log_factor": math.log(2.0),  # roughness / relief compared as log ratios; a factor 2 is one unit
    "slope_deg": 3.0, "slope_p90_deg": 5.0, "frac": 0.15,
    "precip_mm": 150.0,      # annual precipitation e-folding for the aridity proxy
    "thermal_gap_k": 25.0,   # distance between temperature intervals
}
CORRELATION_SHRINKAGE = 0.3
CONTEXT_RADIUS_KM = 30.0


# ----------------------------------------------------------------------------- registry

@dataclass(frozen=True)
class Dimension:
    id: str
    label: str
    group: str
    method: str
    weight: float
    applies_to: tuple[str, ...] = ("moon", "mars")
    status_default: str = "measured"      # or not_assessed
    reason: str = ""
    integration_path: str = ""
    bodies_not_applicable: dict = field(default_factory=dict)

    def to_dict(self):
        return {k: getattr(self, k) for k in self.__dataclass_fields__}


DIMENSIONS: tuple[Dimension, ...] = (
    Dimension("terrain_fine", "Fine-scale slope distribution", "terrain",
              "1-Wasserstein distance between slope CDFs at the target's fine baseline (100 m Moon, 400 m Mars), "
              "built from p50/p90 and slope-class fractions; similarity exp(-W1/3 deg)", 2.0),
    Dimension("terrain_roughness", "Roughness and curvature", "terrain",
              "TRI, slope spread and Laplacian-curvature spread at the fine baseline as log ratios (features "
              "measured on both sides only: TRI alone at the 400 m Mars baseline); "
              "Mahalanobis distance with shrunk Earth-population correlation, normalised by effective dimension", 1.0),
    Dimension("terrain_regional", "Regional relief (2 km baseline)", "terrain",
              "2 km-baseline slope p50/p90, fraction < 20 deg, relief and elevation spread; decorrelated distance", 1.0),
    Dimension("surface_exposure", "Exposed, unvegetated ground", "surface",
              "WorldCover bare + 0.5 x moss/lichen fraction vs. a target surface with no vegetation", 1.0),
    Dimension("geology", "Lithology class", "geology",
              "Macrostrat map unit at window centre (+ volcano / impact-structure context within 30 km) mapped to a "
              "common vocabulary; 0.5 x best class match + 0.5 x mean coverage of the target's literature classes", 1.0),
    Dimension("aridity", "Aridity and surface water", "water",
              "exp(-P/150 mm) x (1 - open-water fraction) vs. targets without liquid precipitation or standing water", 1.0),
    Dimension("thermal", "Thermal regime (near-surface air)", "thermal",
              "Overlap / distance between Earth monthly 2 m air-temperature range and Mars near-surface air "
              "temperature range; the Moon has no air and is handled in the gap ledger", 1.0,
              bodies_not_applicable={"moon": "no atmosphere: lunar surface temperature is not comparable with Earth "
                                             "air temperature; see the gap ledger"}),
    Dimension("illumination", "Solar geometry", "illumination",
              "Fraction of the target's noon solar-elevation range (latitude, obliquity) that the Earth site "
              "reproduces during its year; day length and sky scattering are gap-ledger items", 1.0),
    Dimension("mineralogy", "Mineralogy / spectral composition", "composition", "", 1.0,
              status_default="not_assessed",
              reason="No spectral product was acquired (EMIT L2B, ASTER, Sentinel-2 for Earth; M3, CRISM, OMEGA for "
                     "targets). Lithology classes are map/literature categories, not mineral identifications.",
              integration_path="EMIT L2B mineral identification via NASA Earthdata (login) or Earth Engine; "
                               "add columns min_* with evidence 'observed (spectral proxy)'."),
    Dimension("aeolian_dust", "Wind, dust and aeolian processes", "dust", "", 0.5,
              status_default="not_assessed",
              reason="No wind, aerosol or dune dataset acquired (ERA5, MERRA-2, MAIAC AOD; Mars TES dust).",
              integration_path="ERA5-Land wind statistics via Copernicus CDS key; MAIAC AOD via Earth Engine.",
              bodies_not_applicable={"moon": "no wind on the Moon; lunar dust transport is electrostatic/impact-driven"}),
    Dimension("ice_permafrost", "Ice, permafrost and subsurface water", "water", "", 0.5,
              status_default="not_assessed",
              reason="No permafrost or ice product acquired (ESA CCI Permafrost; LEND/Mini-RF; SWIM/SHARAD).",
              integration_path="ESA CCI Permafrost (CEDA, open) as fraction of window with permafrost probability."),
    Dimension("subsurface_voids", "Caves, lava tubes and pits", "subsurface", "", 0.5,
              status_default="not_assessed",
              reason="No cave or lava-tube inventory acquired for Earth, Moon or Mars.",
              integration_path="Mars Global Cave Candidate Catalog (USGS) and lunar pit catalogues; Earth karst maps."),
)
DIM_BY_ID = {d.id: d for d in DIMENSIONS}

# ----------------------------------------------------------------------------- geology vocabulary

GEOLOGY_CLASSES = {
    "basaltic_mafic": "basaltic / mafic igneous",
    "olivine_cumulate": "ultramafic / olivine-rich igneous",
    "volcanic_intermediate_felsic": "intermediate-felsic volcanic",
    "plutonic_felsic": "felsic-intermediate plutonic",
    "anorthositic_highlands": "anorthositic (plagioclase-rich) crust",
    "impact_regolith": "impact-generated regolith / breccia",
    "impact_structure": "impact structure (crater setting)",
    "sedimentary_clastic": "clastic sedimentary",
    "clay_bearing": "clay-bearing / fine-grained sedimentary",
    "carbonate": "carbonate",
    "sulfate_evaporite": "evaporite / sulfate",
    "metamorphic": "metamorphic",
    "unconsolidated_surficial": "unconsolidated surficial deposits",
    "volcanic_field": "active/Holocene volcanic field (context)",
}
LITH_KEYWORDS = [  # checked in order; a label can map to several classes
    ("olivine_cumulate", ("peridotite", "dunite", "ultramafic", "komatiite", "serpentinite")),
    ("basaltic_mafic", ("basalt", "mafic", "gabbro", "diabase", "dolerite", "basanite", "picrite")),
    ("volcanic_intermediate_felsic", ("andesite", "rhyolite", "dacite", "tuff", "ignimbrite", "trachyte",
                                      "volcanic", "pyroclastic")),
    ("anorthositic_highlands", ("anorthosite",)),
    ("plutonic_felsic", ("granite", "granodiorite", "tonalite", "diorite", "syenite", "plutonic", "monzonite")),
    ("sulfate_evaporite", ("evaporite", "gypsum", "halite", "anhydrite", "salt")),
    ("carbonate", ("limestone", "dolomite", "dolostone", "carbonate", "marl", "chalk")),
    ("clay_bearing", ("clay", "claystone", "mudstone", "shale", "argillite")),
    ("sedimentary_clastic", ("sandstone", "siltstone", "conglomerate", "clastic", "sedimentary", "mudstone",
                             "shale", "breccia", "arkose", "greywacke", "graywacke")),
    ("metamorphic", ("gneiss", "schist", "metamorphic", "quartzite", "marble", "slate", "phyllite", "amphibolite",
                     "granulite", "migmatite")),
    ("unconsolidated_surficial", ("alluvium", "alluvial", "gravel", "unconsolidated", "eolian", "aeolian", "dune",
                                  "loess", "till", "glacial", "surficial", "colluvium", "sand", "fluvial", "lacustrine",
                                  "playa", "moraine")),
]
CLASS_SIMILARITY = {  # symmetric partial credit; identical classes score 1
    frozenset({"basaltic_mafic", "olivine_cumulate"}): 0.5,
    frozenset({"basaltic_mafic", "volcanic_intermediate_felsic"}): 0.3,
    frozenset({"basaltic_mafic", "volcanic_field"}): 0.6,
    frozenset({"olivine_cumulate", "volcanic_field"}): 0.3,
    frozenset({"plutonic_felsic", "anorthositic_highlands"}): 0.3,
    frozenset({"impact_structure", "impact_regolith"}): 0.6,
    frozenset({"unconsolidated_surficial", "impact_regolith"}): 0.3,
    frozenset({"sedimentary_clastic", "clay_bearing"}): 0.5,
    frozenset({"carbonate", "sulfate_evaporite"}): 0.3,
    frozenset({"sedimentary_clastic", "unconsolidated_surficial"}): 0.3,
}


_LITH_RE = {c: re.compile(r"\b(?:" + "|".join(map(re.escape, words)) + r")(?:s|es)?\b") for c, words in LITH_KEYWORDS}


def lith_classes(label: str | None) -> list[str]:
    """Whole-word keyword match ("salt" must not match inside "basalt")."""
    if not label:
        return []
    text = label.lower()
    return [c for c, _ in LITH_KEYWORDS if _LITH_RE[c].search(text)]


def class_similarity(a: str, b: str) -> float:
    return 1.0 if a == b else CLASS_SIMILARITY.get(frozenset({a, b}), 0.0)


# ----------------------------------------------------------------------------- solar geometry

def noon_elevation_range(lat_deg: float, obliquity_deg: float) -> tuple[float, float]:
    """Range of local-noon solar elevation over one orbit (degrees, may be negative = polar night).

    Noon elevation = 90 - |lat - declination|, declination in [-obliquity, +obliquity].
    """
    lo = 90.0 - max(abs(lat_deg - obliquity_deg), abs(lat_deg + obliquity_deg))
    hi = 90.0 - min(abs(lat_deg - d) for d in (-obliquity_deg, obliquity_deg, max(-obliquity_deg, min(obliquity_deg, lat_deg))))
    return lo, hi


def somigliana_gravity(lat_deg: float) -> float:
    """WGS84 normal gravity on the ellipsoid (m/s^2), Somigliana closed form."""
    s2 = math.sin(math.radians(lat_deg)) ** 2
    return 9.7803253359 * (1 + 0.00193185265241 * s2) / math.sqrt(1 - 0.00669437999013 * s2)


def isa_pressure_pa(elevation_m: float) -> float:
    """ICAO standard-atmosphere pressure at geopotential height (troposphere formula)."""
    h = max(-500.0, min(11000.0, elevation_m))
    return 101325.0 * (1 - 2.25577e-5 * h) ** 5.25588


# ----------------------------------------------------------------------------- point-only dimensions

# Scored only for on-demand points (pipeline.discovery.point); kept out of DIMENSIONS so the published
# bundle, its profiles and its content hash are unchanged.
ALBEDO_TAU = 0.05            # |albedo difference| e-folding (assumed, a priori)
ALBEDO_EARTH_SIGMA = 0.03    # CERES 1 deg cell vs 20 km window (assumed)
ALBEDO_TARGET_SIGMA = 0.02   # TES Lambert albedo calibration (assumed) added to the in-window spread
POINT_DIMENSIONS = [
    Dimension("surface_albedo", "Surface albedo (broadband)", "surface",
              "exp(-|A_earth - A_target| / 0.05); Earth: NASA POWER ALLSKY_SRF_ALB (CERES SYN1deg, 2001-2025 "
              "annual climatology, 1 deg); Mars: MGS TES bolometric Lambert albedo (7.4 km), window mean",
              0.75, applies_to=("mars",),
              reason="Moon: no broadband albedo product acquired (the LOLA 10 ppd mosaic in the USGS archive is "
                     "an 8-bit rendering, not calibrated albedo)."),
]
POINT_DIM_BY_ID = {d.id: d for d in POINT_DIMENSIONS}


def any_dim(dim_id: str) -> Dimension:
    return DIM_BY_ID[dim_id] if dim_id in DIM_BY_ID else POINT_DIM_BY_ID[dim_id]

