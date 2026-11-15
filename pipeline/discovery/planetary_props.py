"""Physical surface properties at any Moon or Mars point, from global planetary maps.

Every value is the mean of the valid pixels of a real raster inside the same 22 km window
as the terrain (median and pixel count are kept). Rasters come from the USGS Astrogeology
mosaic archive; small ones are cached under data/raw/planetary_props, large ones are read
by HTTP range requests. Nothing is filled in where a product has no coverage.

Moon
  feo_wt_pct, plagioclase_pct, olivine_pct, cpx_pct, opx_pct, omat
                       SELENE/Kaguya Multiband Imager mineral maps, 4 ppd, 50 S-50 N (Lemelin et al. 2019);
                       mineral rasters store fractions 0-1 and are reported in vol %
  feo_wt_pct_clementine Clementine UVVIS FeO, 1 km, 70 S-70 N (Lucey et al. 2000) - fallback
  ice_favorability     LRO-based ice favorability index, polar stereographic 591 m (USGS Lunar Research)
Mars
  albedo_tes           MGS TES Lambert albedo, global 7.4 km (Christensen et al. 2001)

Geology classes for scoring are then INFERRED from these values with thresholds fixed a
priori (``infer_geology``); they are labelled as inferred, not as mapped units.
"""
from __future__ import annotations

import math

import numpy as np

from pipeline.discovery import ROOT

LOCAL = ROOT / "data" / "raw" / "planetary_props"
S3 = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/"
MI = "Lunar_MI_mineral_maps/4ppd/Lunar_Kaguya_MIMap_MineralDeconv_"


def _src(name: str, remote: str) -> str:
    p = LOCAL / name
    return str(p) if p.exists() else "/vsicurl/" + S3 + remote


# key: (body, file name, remote path, unit, label, citation, valid range, |lat| coverage or None, pole)
PRODUCTS = [
    ("feo_wt_pct", "moon", "Lunar_Kaguya_MIMap_MineralDeconv_FeOWeightPercent_50N50S.tif",
     MI + "FeOWeightPercent_50N50S.tif", "wt %", "FeO (Kaguya MI)", "Lemelin M. et al. (2019) PSS 165:230-243",
     (0.0, 40.0), 50.0, None),
    ("plagioclase_pct", "moon", "Lunar_Kaguya_MIMap_MineralDeconv_PlagioclasePercent_50N50S.tif",
     MI + "PlagioclasePercent_50N50S.tif", "vol %", "Plagioclase (Kaguya MI)", "Lemelin M. et al. (2019) PSS 165:230-243",
     (0.0, 1.0), 50.0, None),
    ("olivine_pct", "moon", "Lunar_Kaguya_MIMap_MineralDeconv_OlivinePercent_50N50S.tif",
     MI + "OlivinePercent_50N50S.tif", "vol %", "Olivine (Kaguya MI)", "Lemelin M. et al. (2019) PSS 165:230-243",
     (0.0, 1.0), 50.0, None),
    ("cpx_pct", "moon", "Lunar_Kaguya_MIMap_MineralDeconv_ClinopyroxenePercent_50N50S.tif",
     MI + "ClinopyroxenePercent_50N50S.tif", "vol %", "Clinopyroxene (Kaguya MI)",
     "Lemelin M. et al. (2019) PSS 165:230-243", (0.0, 1.0), 50.0, None),
    ("opx_pct", "moon", "Lunar_Kaguya_MIMap_MineralDeconv_OrthopyroxenePercent_50N50S.tif",
     MI + "OrthopyroxenePercent_50N50S.tif", "vol %", "Orthopyroxene (Kaguya MI)",
     "Lemelin M. et al. (2019) PSS 165:230-243", (0.0, 1.0), 50.0, None),
    ("omat", "moon", "Lunar_Kaguya_MIMap_MineralDeconv_OpticalMaturityIndex_50N50S.tif",
     MI + "OpticalMaturityIndex_50N50S.tif", "", "Optical maturity OMAT (Kaguya MI; low = mature regolith)",
     "Lemelin M. et al. (2019) PSS 165:230-243", (0.0, 1.0), 50.0, None),
    ("feo_wt_pct_clementine", "moon", "Lunar_Clementine_UVVIS_FeO_ClrBinned_70S70N_1km.tif",
     "Lunar_Clementine_UVVIS_FeO_ClrBinned_70S70N_1km.tif", "wt %", "FeO (Clementine UVVIS)",
     "Lucey P.G. et al. (2000) JGR 105:20297-20305", (0.0, 40.0), 70.0, None),
    ("ice_favorability", "moon", "Moon_IceFavorabilityIndex_90S000E_591mp.tif",
     "Lunar_Research/IceFavorabilityIndex/Moon_IceFavorabilityIndex_90S000E_591mp.tif", "index",
     "Ice favorability index (south polar)", "USGS Astrogeology Lunar Research, Ice Favorability Index",
     (-1e6, 1e6), None, "south"),
    ("ice_favorability", "moon", "Moon_IceFavorabilityIndex_90N000E_591mp.tif",
     "Lunar_Research/IceFavorabilityIndex/Moon_IceFavorabilityIndex_90N000E_591mp.tif", "index",
     "Ice favorability index (north polar)", "USGS Astrogeology Lunar Research, Ice Favorability Index",
     (-1e6, 1e6), None, "north"),
    ("albedo_tes", "mars", "Mars_MGS_TES_Albedo_mosaic_global_7410m.tif", "Mars_MGS_TES_Albedo_mosaic_global_7410m.tif",
     "", "Lambert albedo (MGS TES, bolometric)", "Christensen P.R. et al. (2001) JGR 106:23823-23871; USGS mosaic",
     (0.0, 1.0), None, None),
]
HALF_M = 11000
# Raster value -> reported unit (Kaguya MI mineral maps store fractions; reported as vol %).
SCALE = {"plagioclase_pct": 100.0, "olivine_pct": 100.0, "cpx_pct": 100.0, "opx_pct": 100.0}


def _sample(path: str, lon: float, lat: float, body: str, lo: float, hi: float) -> dict | None:
    from pipeline.planets.access import AccessError, read_window
    try:
        z, _, _ = read_window(path, lon, lat, HALF_M, body)
    except (AccessError, ValueError):
        return None
    v = z[np.isfinite(z) & (z >= lo) & (z <= hi)]
    if v.size == 0:
        return None
    return {"mean": float(v.mean()), "median": float(np.median(v)), "std": float(v.std()), "n_pixels": int(v.size)}


def properties(body: str, lon: float, lat: float) -> dict:
    """{key: {value, median, std, n_pixels, unit, label, source}} plus a list of products without coverage."""
    out, gaps = {}, []
    for key, b, name, remote, unit, label, cite, (lo, hi), max_lat, pole in PRODUCTS:
        if b != body or key in out:
            continue
        if max_lat is not None and abs(lat) > max_lat:
            gaps.append({"key": key, "label": label, "reason": f"product covers |lat| <= {max_lat:g} deg"})
            continue
        if pole and (lat < 0) != (pole == "south"):
            continue
        if pole and abs(lat) < 80:
            gaps.append({"key": key, "label": label, "reason": "polar product (|lat| >= 80 deg only)"})
            continue
        s = _sample(_src(name, remote), lon, lat, body, lo, hi)
        if s is None:
            gaps.append({"key": key, "label": label, "reason": "no valid pixels in the 22 km window"})
            continue
        k = SCALE.get(key, 1.0)
        out[key] = {"value": round(k * s["mean"], 4), "median": round(k * s["median"], 4), "std": round(k * s["std"], 4),
                    "n_pixels": s["n_pixels"], "unit": unit, "label": label, "source": cite,
                    "url": S3 + remote, "evidence": "observed (orbital remote sensing)"}
    if "feo_wt_pct" in out:
        out.pop("feo_wt_pct_clementine", None)
        gaps = [g for g in gaps if g["key"] != "feo_wt_pct_clementine"]
    return {"values": out, "gaps": gaps}


# ----------------------------------------------------------------------------- inferred geology

MARS_BASALT_REF = "McSween H.Y. et al. (2009) Science 324:736-739 (Mars crust is broadly basaltic)"
LUNAR_REGOLITH_REF = "McKay D.S. et al. (1991) Lunar Sourcebook ch. 7 (regolith covers the whole lunar surface)"


def infer_geology(body: str, values: dict) -> tuple[list[str], list[str]]:
    """Common-vocabulary classes from measured composition, with the rule that fired for each.

    Thresholds (a priori): lunar mare basalts FeO >= 13 wt %, feldspathic highlands FeO <= 8 wt % or
    plagioclase >= 70 vol % (Lucey et al. 2000; Lemelin et al. 2019); olivine-rich >= 20 vol %.
    Mars: dust-mantled surfaces have TES albedo >= 0.22, dark basaltic surfaces < 0.18
    (Christensen et al. 2001; Ruff & Christensen 2002).
    """
    def v(k):
        x = values.get(k, {}).get("value")
        return x if isinstance(x, (int, float)) and math.isfinite(x) else None
    classes, why = [], []
    if body == "moon":
        classes.append("impact_regolith")
        why.append(f"lunar surface is impact regolith ({LUNAR_REGOLITH_REF})")
        feo = v("feo_wt_pct") if v("feo_wt_pct") is not None else v("feo_wt_pct_clementine")
        plag, ol = v("plagioclase_pct"), v("olivine_pct")
        if feo is not None and feo >= 13:
            classes.append("basaltic_mafic")
            why.append(f"FeO {feo:.1f} wt % >= 13 (mare basalt)")
        if (feo is not None and feo <= 8) or (plag is not None and plag >= 70):
            classes.append("anorthositic_highlands")
            why.append(f"FeO {feo if feo is not None else float('nan'):.1f} wt % <= 8 or plagioclase "
                       f"{plag if plag is not None else float('nan'):.0f} % >= 70 (feldspathic highlands)")
        if ol is not None and ol >= 20:
            classes.append("olivine_cumulate")
            why.append(f"olivine {ol:.0f} vol % >= 20")
    elif body == "mars":
        classes.append("basaltic_mafic")
        why.append(MARS_BASALT_REF)
        alb = v("albedo_tes")
        if alb is not None and alb >= 0.22:
            classes.append("unconsolidated_surficial")
            why.append(f"TES albedo {alb:.3f} >= 0.22 (dust-mantled surface)")
    return sorted(set(classes)), why
