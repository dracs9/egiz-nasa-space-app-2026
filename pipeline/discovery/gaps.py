"""Computed gap ledger: where the Earth analogy breaks down, with values and units.

Each row compares a target value with the candidate's measured or derived Earth value.
Rows that cannot be quantified with the acquired evidence say so explicitly
(``measurable: false``) instead of being dropped. The static CSV
(data/curated/gap_alternatives.csv) remains the source of laboratory alternatives.
"""
from __future__ import annotations

import csv
import math

from pipeline.discovery import ROOT
from pipeline.discovery import dimensions as D
from pipeline.discovery.fingerprint import Target, Window

ALT_CSV = ROOT / "data" / "curated" / "gap_alternatives.csv"
CO2_EARTH_FRAC = 0.042  # % by volume, ~420 ppm global mean (NOAA GML 2024)


def alternatives() -> dict[str, str]:
    with open(ALT_CSV, newline="", encoding="utf-8") as f:
        return {r["gap"]: f"{r['alternative']} [{r['source_key']}]" for r in csv.DictReader(f)}


RELEVANCE = {  # which mission profiles each gap matters most for
    "gravity": ("rover_mobility", "eva_geology"), "pressure": ("eva_geology", "astrobiology", "power_illumination"),
    "atmosphere": ("astrobiology", "eva_geology"), "thermal": ("power_illumination", "astrobiology"),
    "radiation": ("astrobiology", "eva_geology"), "day_length": ("power_illumination",),
    "noon_elevation": ("power_illumination",), "solar_flux": ("power_illumination",),
    "vegetation": ("eva_geology", "rover_mobility"), "magnetic_field": ("astrobiology",),
    "dust": ("rover_mobility", "power_illumination"), "slope_distribution": ("rover_mobility",),
}


def _row(key, parameter, unit, target, earth, *, earth_evidence, target_evidence, source, uncertainty,
         alternative=None, measurable=True, note=""):
    diff = ratio = None
    if measurable and isinstance(target, (int, float)) and isinstance(earth, (int, float)):
        diff = earth - target
        ratio = earth / target if target else None
    return {"key": key, "parameter": parameter, "unit": unit, "target_value": target, "earth_value": earth,
            "difference": diff, "ratio_earth_to_target": ratio, "measurable": measurable,
            "earth_evidence": earth_evidence, "target_evidence": target_evidence, "source": source,
            "uncertainty": uncertainty, "relevance": list(RELEVANCE.get(key, ())), "alternative": alternative,
            "note": note}


def gap_ledger(target: Target, w: Window, terrain_w1_deg: float | None = None) -> list[dict]:
    body = D.BODY[target.body]
    alt = alternatives()
    rows = []
    g_e = D.somigliana_gravity(w.lat)
    rows.append(_row("gravity", "Surface gravity", "m/s^2", body["g_m_s2"], round(g_e, 5),
                     earth_evidence="derived (WGS84 normal gravity at window latitude)", target_evidence="documented",
                     source=body["source"], uncertainty="< 0.1 % (Earth); fact-sheet precision (target)",
                     alternative=alt.get("Reduced gravity")))
    elev = w.f("elev_p50_m")
    p_e = D.isa_pressure_pa(elev) if elev is not None else None
    rows.append(_row("pressure", "Surface atmospheric pressure", "Pa", body["pressure_pa"],
                     None if p_e is None else round(p_e, 1),
                     earth_evidence="derived (ICAO standard atmosphere at window median elevation)",
                     target_evidence="documented", source=body["source"],
                     uncertainty="+-3 % (weather) on Earth; Mars seasonal +-30 % (CO2 cycle)",
                     alternative=alt.get("Vacuum or thin atmosphere"), measurable=p_e is not None))
    rows.append(_row("atmosphere", "Atmosphere composition", "text", body["atmosphere"],
                     f"N2 78.08 %, O2 20.95 %, CO2 ~{CO2_EARTH_FRAC} %", earth_evidence="documented",
                     target_evidence="documented", source=f"{body['source']}; {D.NSSDC_EARTH}",
                     uncertainty="n/a", alternative=alt.get("Vacuum or thin atmosphere"), measurable=False,
                     note="qualitative: chemistry-dependent tests (oxidation, combustion, biology) do not transfer"))
    tmin, tmax = w.f("t2m_min_coldest_month_c"), w.f("t2m_max_warmest_month_c")
    th = D.THERMAL_REFERENCE[target.body]
    earth_range = None if tmin is None or tmax is None else [round(tmin + 273.15, 1), round(tmax + 273.15, 1)]
    if earth_range:
        gap_k = max(0.0, earth_range[0] - th["max_k"], th["min_k"] - earth_range[1])
        coldest_gap = earth_range[0] - th["min_k"]
    rows.append(_row("thermal", f"Temperature range ({th['quantity']})", "K", [th["min_k"], th["max_k"]], earth_range,
                     earth_evidence="modelled (NASA POWER 2 m air temperature, monthly means of daily min/max)",
                     target_evidence="documented", source=f"{th['source']}; {th['scope']}",
                     uncertainty="+-2 K (Earth climatology); site-specific target values not available",
                     alternative=alt.get("Extreme thermal environment"), measurable=False,
                     note=("not comparable in kind: lunar SURFACE vs Earth AIR temperature" if target.body == "moon" else
                           "comparable quantity (near-surface air) but body-level reference")
                     + ("" if not earth_range else f"; interval separation {gap_k:.0f} K, Earth coldest month exceeds the "
                        f"target minimum by {coldest_gap:.0f} K")))
    r_e, r_t = D.RADIATION["earth"], D.RADIATION[target.body]
    rows.append(_row("radiation", "Ionising radiation dose rate at the surface", "mSv/day", r_t["msv_per_day"],
                     round(r_e["msv_per_day"], 5), earth_evidence=f"documented ({r_e['scope']})",
                     target_evidence=f"measured ({r_t['scope']})", source=f"{r_t['source']}; {r_e['source']}",
                     uncertainty="Mars +-0.12 mSv/day (RAD); Earth value excludes altitude/latitude dependence",
                     alternative=alt.get("Space radiation")))
    rows.append(_row("day_length", "Solar day length", "h", body["day_h"], 24.0, earth_evidence="documented",
                     target_evidence="documented", source=body["source"], uncertainty="n/a",
                     note="thermal cycling and power/night-survival tests do not transfer when day lengths differ"))
    tlo, thi = D.noon_elevation_range(target.window.lat, body["obliquity_deg"])
    elo, ehi = D.noon_elevation_range(w.lat, D.BODY["earth"]["obliquity_deg"])
    rows.append(_row("noon_elevation", "Noon solar elevation over a year", "deg", [round(tlo, 2), round(thi, 2)],
                     [round(elo, 2), round(ehi, 2)], earth_evidence="derived (latitude, obliquity 23.44 deg)",
                     target_evidence="derived (latitude, obliquity)", source="spherical astronomy", uncertainty="< 0.1 deg",
                     measurable=False, note="same Sun angle does not mean same illumination: Earth's sky scatters light "
                                            "and fills shadows; the Moon has none"))
    rows.append(_row("solar_flux", "Top-of-atmosphere solar flux", "W/m^2", body["solar_constant_w_m2"], 1361.0,
                     earth_evidence="documented", target_evidence="documented",
                     source=f"{body['source']}; {D.NSSDC_EARTH}", uncertainty="+-3 % orbital eccentricity (Mars +-20 %)"))
    veg = [w.f(k) for k in ("tree_frac", "crop_frac", "grass_shrub_frac")]
    veg_frac = None if any(v is None for v in veg) else round(sum(veg), 4)
    rows.append(_row("vegetation", "Vegetated fraction of the window", "fraction", 0.0, veg_frac,
                     earth_evidence="proxy (ESA WorldCover 2021 classes)", target_evidence="physical constraint",
                     source="ESA WorldCover v200", uncertainty="+-0.08 (class accuracy)", measurable=veg_frac is not None))
    rows.append(_row("magnetic_field", "Global magnetic field / magnetospheric shielding", "text",
                     "none (crustal remanent fields only)" if target.body == "mars" else "none",
                     "global dipole field", earth_evidence="documented", target_evidence="documented",
                     source=body["source"], uncertainty="n/a", measurable=False))
    rows.append(_row("dust", "Dust and fine-particle physics", "text",
                     "electrostatically charged, angular regolith fines; no wind" if target.body == "moon" else
                     "wind-lifted dust, global dust storms, dust devils",
                     "terrestrial weathered dust, moisture-cohesive", earth_evidence="not measured",
                     target_evidence="literature", source="no dust dataset acquired (see dimension aeolian_dust)",
                     uncertainty="not quantified", measurable=False,
                     note="not measurable with the evidence acquired; needs MERRA-2/MAIAC (Earth) and TES/MCS (Mars)"))
    if terrain_w1_deg is not None:
        rows.append(_row("slope_distribution", "Slope-distribution mismatch (1-Wasserstein)", "deg", 0.0,
                         round(float(terrain_w1_deg), 3), earth_evidence="derived (Copernicus GLO-30)",
                         target_evidence="derived", source="terrain_fine dimension",
                         uncertainty="see terrain_fine interval; Mars blend DEM is smoother than its posting"))
    return rows


def ledger_summary(rows: list[dict]) -> dict:
    return {"n": len(rows), "measurable": sum(r["measurable"] for r in rows),
            "not_measurable": [r["key"] for r in rows if not r["measurable"]]}


def _ratio_text(r: float) -> str:
    return f"{r:.3g}x" if r and math.isfinite(r) else "n/a"
