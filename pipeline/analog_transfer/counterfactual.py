"""Counterfactual planetary environment engine (explicit, named physical models).

Two models are implemented. Each returns its equations, inputs (with the kind of
every value), outputs and limitations. Neither is a validated planetary predictor.

CF_TERRAMECHANICS
    Bekker pressure-sinkage for a rigid wheel (Bekker 1969; Wong, Theory of Ground
    Vehicles) with Coulomb maximum thrust. Compares a target-gravity prediction with
    Earth tests under two declared protocols: load-matched (reduced test mass) and
    mass-matched (Wong 2012). The model has no gravity-dependent soil strength, which
    reduced-gravity experiments report (Daca et al. 2022; Niksirat et al. 2020), so
    any conclusion about the direction of the gravity effect is flagged as contested.

CF_SOLAR
    Decomposes "Same Sun" into geometry, daylight duration and irradiance using NASA
    SPICE solar vectors (pipeline.science.spice): Moon vacuum direct irradiance; Mars
    Beer-Lambert direct beam with a declared optical depth; Earth clear-sky direct
    normal irradiance I = 1353 * 0.7**(AM**0.678) W/m^2 (PVEducation, after the 1976
    Applied Solar Energy relation), AM = 1/sin(elevation). Diffuse light, terrain
    horizon, panel temperature and dust deposition are not modelled.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

G = {"earth": 9.80665, "moon": 1.62, "mars": 3.73}  # NSSDCA fact sheets (Mars sheet updated 2025-05-19)

DEFAULT_ROVER = {
    "name": "EGIZ demonstration rover (declared assumption, matches web DEFAULT_DESIGN)",
    "mass_kg": 900.0, "wheels": 6, "wheel_diameter_m": 0.82, "wheel_width_m": 0.33,
}
LUNAR_SOIL = {
    "name": "Apollo-era lunar soil design estimate (rough; NASA Lunar Surface Data Book)",
    "kc": 1400.0, "kphi": 820000.0, "n": 1.0,
    # Friction angle range 30-50 deg is reported for Apollo-era estimates; 35 is a declared
    # point inside it. Cohesion is set to 0 (cohesionless, conservative) and is editable.
    "phi_deg": 35.0, "c_pa": 0.0,
}
KINDS = {"mass_kg": "assumed", "wheels": "assumed", "wheel_diameter_m": "assumed",
         "wheel_width_m": "assumed", "kc": "assumed", "kphi": "assumed", "n": "assumed",
         "phi_deg": "assumed", "c_pa": "assumed"}


def _check_positive(**values):
    for key, value in values.items():
        if not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
            raise ValueError(f"{key} must be positive and finite")


def bekker_wheel(load_n: float, d: float, b: float, kc: float, kphi: float, n: float) -> dict:
    """Rigid-wheel static sinkage z0 and compaction resistance Rc (per wheel)."""
    _check_positive(load_n=load_n, d=d, b=b, kc=kc, kphi=kphi, n=n)
    if n >= 3:
        raise ValueError("sinkage exponent n must be < 3")
    z0 = (3 * load_n / ((3 - n) * (kc + b * kphi) * math.sqrt(d))) ** (2 / (2 * n + 1))
    rc = b * (kc / b + kphi) * z0 ** (n + 1) / (n + 1)
    contact = math.sqrt(d * z0)
    return {"sinkage_m": z0, "compaction_resistance_n": rc, "contact_length_m": contact}


def slope_limit_deg(mass: float, g: float, rover: dict, soil: dict) -> float:
    """Largest slope where Coulomb maximum thrust exceeds compaction + grade resistance."""
    n_w, d, b = rover["wheels"], rover["wheel_diameter_m"], rover["wheel_width_m"]
    phi, c = math.radians(soil["phi_deg"]), soil["c_pa"]

    def margin(theta: float) -> float:
        w = mass * g * math.cos(theta) / n_w
        wheel = bekker_wheel(w, d, b, soil["kc"], soil["kphi"], soil["n"])
        thrust = b * wheel["contact_length_m"] * c + w * math.tan(phi)
        return thrust - wheel["compaction_resistance_n"] - mass * g * math.sin(theta) / n_w

    lo, hi = 0.0, math.radians(60)
    if margin(lo) <= 0:
        return 0.0
    if margin(hi) > 0:
        return 60.0
    for _ in range(80):
        mid = 0.5 * (lo + hi)
        lo, hi = (mid, hi) if margin(mid) > 0 else (lo, mid)
    return math.degrees(lo)


def terramechanics(target_body: str, rover: dict | None = None, soil: dict | None = None) -> dict:
    """Compare target-gravity predictions with Earth tests under two protocols."""
    if target_body not in ("moon", "mars"):
        raise ValueError("target_body must be moon or mars")
    rover = {**DEFAULT_ROVER, **(rover or {})}
    soil = {**LUNAR_SOIL, **(soil or {})}
    _check_positive(mass_kg=rover["mass_kg"], wheel_diameter_m=rover["wheel_diameter_m"],
                    wheel_width_m=rover["wheel_width_m"], wheels=rover["wheels"])
    if not 0 < soil["phi_deg"] < 60 or soil["c_pa"] < 0:
        raise ValueError("phi must be in (0,60) deg and cohesion nonnegative")
    m, n_w = rover["mass_kg"], rover["wheels"]
    d, b = rover["wheel_diameter_m"], rover["wheel_width_m"]
    gt, ge = G[target_body], G["earth"]
    cases = {
        "target": {"label": f"{target_body.title()} gravity, same soil model", "mass": m, "g": gt},
        "earth_load_matched": {"label": "Earth test, load-matched (test mass m*g_t/g_E)", "mass": m * gt / ge, "g": ge},
        "earth_mass_matched": {"label": "Earth test, mass-matched (Wong 2012)", "mass": m, "g": ge},
    }
    out = {}
    for key, case in cases.items():
        load = case["mass"] * case["g"] / n_w
        wheel = bekker_wheel(load, d, b, soil["kc"], soil["kphi"], soil["n"])
        out[key] = {
            "label": case["label"], "test_mass_kg": case["mass"], "gravity": case["g"],
            "wheel_load_n": load, **wheel,
            "resistance_to_load": wheel["compaction_resistance_n"] / load,
            "slope_limit_deg": slope_limit_deg(case["mass"], case["g"], rover, soil),
        }
    t = out["target"]
    for key in ("earth_load_matched", "earth_mass_matched"):
        e = out[key]
        e["sinkage_ratio_vs_target"] = e["sinkage_m"] / t["sinkage_m"]
        e["slope_limit_error_deg"] = e["slope_limit_deg"] - t["slope_limit_deg"]
    model_direction = "higher" if t["slope_limit_deg"] > out["earth_mass_matched"]["slope_limit_deg"] else "lower"
    return {
        "model": "CF_TERRAMECHANICS", "version": "1.0.0", "target_body": target_body,
        "inputs": {"rover": rover, "soil": soil,
                   "kinds": KINDS, "gravity": {"earth": ge, target_body: gt}},
        "equations": [
            "W = m g cos(theta) / N_wheels",
            "z0 = [3 W / ((3 - n)(k_c + b k_phi) sqrt(D))]^(2/(2n+1))",
            "R_c = b (k_c/b + k_phi) z0^(n+1) / (n+1)",
            "l = sqrt(D z0);  H = b l c + W tan(phi)",
            "slope limit: H - R_c - W tan(theta)... solved by bisection on N(H - R_c) = m g sin(theta)",
        ],
        "cases": out,
        "findings": [
            f"Within the Bekker model, a load-matched Earth test reproduces the target sinkage exactly (ratio {out['earth_load_matched']['sinkage_ratio_vs_target']:.3f}) because soil self-weight does not appear in the model.",
            f"A mass-matched Earth test sinks {out['earth_mass_matched']['sinkage_ratio_vs_target']:.2f}x deeper than the target-gravity prediction and its slope limit differs by {out['earth_mass_matched']['slope_limit_error_deg']:+.1f} deg.",
            f"The model predicts a {model_direction} traction-limited slope at target gravity than in a mass-matched Earth test. Reduced-gravity experiments report lower soil strength and traction at reduced gravity, which this model cannot represent: the direction of the transfer error is CONTESTED.",
        ],
        "status": "MODEL_ESTIMATE_CONTESTED",
        "limitations": [
            "Soil parameters are rough Apollo-era lunar estimates applied to both cases; Jezero and all Earth field soils are unmeasured.",
            "No gravity-dependent soil strength, slip-sinkage, grousers, dynamic loading or multi-pass effects.",
            "Static, quasi-steady, equal wheel loads on a uniform slope; not a mission performance prediction.",
        ],
        "references": ["WONG_2012", "WONG_KOBAYASHI_2012", "NIKSIRAT_2020", "DACA_2022", "NASA_LSDB", "NASA_TM_2025_TIRE"],
    }


# ---------------------------------------------------------------- solar

def earth_clear_sky_dni(elev_deg: np.ndarray) -> np.ndarray:
    s = np.sin(np.radians(elev_deg))
    out = np.zeros_like(s)
    up = s > 0
    am = 1.0 / s[up]
    out[up] = 1353.0 * 0.7 ** (am ** 0.678)
    return out


def direct_normal(body: str, elev_deg: np.ndarray, flux: np.ndarray, tau: float = 0.5) -> np.ndarray:
    """Direct-beam irradiance on a Sun-tracking surface (W/m^2); zero below the horizon."""
    s = np.sin(np.radians(elev_deg))
    up = s > 0
    if body == "earth":
        return earth_clear_sky_dni(elev_deg)
    if body == "moon":
        return np.where(up, flux, 0.0)
    if body == "mars":
        if tau < 0 or not math.isfinite(tau):
            raise ValueError("optical depth must be finite and nonnegative")
        out = np.zeros_like(s)
        out[up] = flux[up] * np.exp(-tau / s[up])
        return out
    raise ValueError(body)


SOLAR_CACHE = "atlas_solar.json"


def _epochs(body: str, start: datetime) -> list[tuple[str, float, float]]:
    if body == "earth":
        return [(datetime(2026, month, 15, tzinfo=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), 86400, 1200)
                for month in range(1, 13)]
    if body == "moon":
        return [((start + timedelta(days=i)).strftime("%Y-%m-%dT%H:%M:%SZ"), 86400, 3600) for i in range(30)]
    return [((start + timedelta(days=round(i * 686.98 / 12))).strftime("%Y-%m-%dT%H:%M:%SZ"), 86400, 1200)
            for i in range(12)]


def solar_series(entries: list[dict], start: str = "2026-11-14T00:00:00Z") -> dict:
    """Sample NASA SPICE solar geometry; requires spiceypy and the packaged kernels."""
    from pipeline.science import spice

    t0 = datetime.fromisoformat(start.replace("Z", "+00:00"))
    sites = {}
    for entry in entries:
        site = {"id": entry["id"], "body": entry["body"], "lat": entry["lat"], "lon": entry["lon"]}
        elev, flux = [], []
        for epoch, duration, step in _epochs(entry["body"], t0):
            g = spice.geometry(site, epoch, duration, step)
            elev += [round(s["elevationDeg"], 4) for s in g["samples"]]
            flux += [round(s["solarFluxWm2"], 3) for s in g["samples"]]
        sites[entry["id"]] = {"body": entry["body"], "lat": entry["lat"], "lon": entry["lon"],
                              "epochs": [e for e, _, _ in _epochs(entry["body"], t0)],
                              "elevation_deg": elev, "flux_wm2": flux}
    return {"schema": "egiz.atlas_solar", "version": "1.0.0", "engine": g["engine"],
            "kernels": spice.kernel_manifest(), "start": start,
            "sampling": {"earth": "15th of each month 2026, 20 min", "moon": "30 consecutive days, 60 min",
                         "mars": "12 epochs across one Mars year (686.98 d), 20 min over 86400 s"},
            "sites": sites}


def load_or_build_solar(pilot_dir: Path, entries: list[dict], rebuild: bool = False) -> dict | None:
    path = pilot_dir / SOLAR_CACHE
    ids = sorted(e["id"] for e in entries)
    if path.exists() and not rebuild:
        doc = json.loads(path.read_text())
        if sorted(doc["sites"]) == ids:
            return doc
    try:
        doc = solar_series(entries)
    except ImportError:
        return None
    path.write_text(json.dumps(doc, separators=(",", ":")) + "\n")
    return doc


def solar_profile(series: dict, site_id: str, tau: float = 0.5) -> dict:
    s = series["sites"][site_id]
    elev = np.asarray(s["elevation_deg"], dtype=float)
    flux = np.asarray(s["flux_wm2"], dtype=float)
    body = s["body"]
    dni = direct_normal(body, elev, flux, tau)
    horiz = dni * np.clip(np.sin(np.radians(elev)), 0, None)
    day = elev > 0
    out = {
        "body": body, "samples": int(elev.size),
        "daylight_fraction": float(day.mean()),
        "elevation_daylight_quantiles": [float(v) for v in np.quantile(elev[day], [0.1, 0.5, 0.9])] if day.any() else None,
        "max_elevation_deg": float(elev.max()),
        "mean_tracking_irradiance_wm2": float(dni.mean()),
        "mean_horizontal_irradiance_wm2": float(horiz.mean()),
        "toa_flux_mean_wm2": float(flux.mean()),
        "atmosphere": {"earth": "clear-sky direct normal approximation (no cloud, no diffuse)",
                       "moon": "vacuum", "mars": f"Beer-Lambert direct beam, declared optical depth tau={tau}"}[body],
    }
    if body == "mars":
        out["tau"] = tau
        out["tau_kind"] = "assumed"
    return out


def solar_counterfactual(series: dict, earth_id: str, target_id: str, tau: float = 0.5) -> dict:
    """Same-Sun decomposition between one Earth site and one target."""
    e, t = solar_profile(series, earth_id, tau), solar_profile(series, target_id, tau)
    ratio = e["mean_tracking_irradiance_wm2"] / t["mean_tracking_irradiance_wm2"] if t["mean_tracking_irradiance_wm2"] > 0 else None
    return {
        "model": "CF_SOLAR", "version": "1.0.0", "earth": e, "target": t,
        "components": {
            "geometry_daylight_median_elev_diff_deg": (e["elevation_daylight_quantiles"][1] - t["elevation_daylight_quantiles"][1])
            if e["elevation_daylight_quantiles"] and t["elevation_daylight_quantiles"] else None,
            "duration_daylight_fraction_diff": e["daylight_fraction"] - t["daylight_fraction"],
            "irradiance_tracking_ratio": ratio,
            "irradiance_log10_ratio": math.log10(ratio) if ratio else None,
        },
        "limitations": [
            "Zero-height spherical horizon: terrain shadowing is not applied at either site.",
            "Earth values are clear-sky upper estimates; cloud climatology was not acquired.",
            "Mars optical depth is a declared scenario value, not a retrieval at Jezero.",
            "Irradiance is not power: panel efficiency, temperature, dust and orientation are not modelled.",
        ],
    }
