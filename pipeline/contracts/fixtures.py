"""Deterministic invented data, never NASA observations.

Written with AI assistance (Codex); human review pending.
Fixtures belong only in data/fixtures, contracts/examples, or temporary test directories.
"""

from __future__ import annotations

import argparse
import json
import math
import random
from pathlib import Path
from typing import Any

from pipeline.contracts.validate import tiles_hash, validate_data

STAMP = "2026-10-15T00:00:00Z"
ROOT = Path(__file__).resolve().parents[2]
PROVENANCE = [{"dataset": "Deterministic invented test fixtures", "provider": "Egiz",
               "version": "seed-42-v1", "url": "https://example.invalid/egiz/fixtures",
               "role": "software testing only; not observations"}]


def envelope(name: str) -> dict[str, Any]:
    return {"schema": f"egiz.{name}", "version": "1.0.0", "generated_at": STAMP,
            "synthetic": True, "provenance": PROVENANCE}


def attribute(attr: str, fn: str = "match", weight: float = 2,
              **params: float) -> dict[str, Any]:
    return {"attr": attr, "fn": fn, "params": params, "weight": weight,
            "needs_target": fn in {"match", "logmatch", "colder"}, "priority": "P0"}


def objective(id_: str, name: str, description: str,
              attributes: list[dict[str, Any]]) -> dict[str, Any]:
    return {"id": id_, "name": name, "description": description, "weight_default": 1,
            "attributes": attributes, "constraints": [
                {"attr": "water_frac", "op": "<=", "value": 0.5},
                {"attr": "built_frac", "op": "<=", "value": 0.2}]}


def templates() -> dict[str, Any]:
    a = attribute
    moon = [
        objective("O1", "Landing hazards", "Rehearse terrain hazard assessment.", [
            a("frac_lt10_f100", weight=3, sigma=0.1),
            a("slope_f100_p90_deg", sigma=4), a("tri_f100_m", "logmatch", 1, sigma=0.15)]),
        objective("O2", "EVA & field geology", "Rehearse traverses across exposed terrain.", [
            a("frac_lt20_r", weight=3, sigma=0.1), a("relief_m", "logmatch", 2, sigma=0.15),
            a("bare_frac", "at_least", 2, a=0.7, tau=0.2)]),
        objective("O3", "Surface mobility", "Rehearse vehicle operations on slopes.", [
            a("slope_f100_p50_deg", sigma=2), a("slope_f100_p90_deg", sigma=4),
            a("frac_lt20_f100", sigma=0.1), a("bare_frac", "at_least", 1, a=0.7, tau=0.2)]),
        objective("O4", "Low-Sun operations", "Find a seasonal window of low sunlight.", [
            a("light", "light", 3, hours_a=6, hours_tau=3, sweep_a=270, sweep_tau=90)]),
        objective("O5", "Cold & dry regolith", "Rehearse exposure to cold, dry surface conditions.", [
            a("t_min_c", "colder", 2, tau=30), a("precip_mm", "at_most", 2, a=50, tau=100),
            a("bare_frac", "at_least", 2, a=0.8, tau=0.2)]),
    ]
    mars = [
        objective("M1", "Landing hazards", "Rehearse regional terrain hazard assessment.", [
            a("frac_lt10_f400", weight=3, sigma=0.1), a("slope_f400_p90_deg", sigma=4),
            a("tri_f400_m", "logmatch", 1, sigma=0.15)]),
        objective("M2", "Rover traverses", "Compare slopes and relief for rover traverses.", [
            a("slope_f400_p50_deg", sigma=2), a("slope_f400_p90_deg", sigma=4),
            a("frac_lt20_r", sigma=0.1), a("relief_m", "logmatch", 1, sigma=0.15)]),
        objective("M3", "Field geology", "Find open terrain with comparable regional relief.", [
            a("bare_frac", "at_least", 2, a=0.8, tau=0.2),
            a("relief_m", "logmatch", 1, sigma=0.15)]),
        objective("M4", "Cold, dry environment", "Rehearse surface environmental exposure.", [
            a("t_min_c", "colder", 2, tau=30), a("precip_mm", "at_most", 3, a=50, tau=100),
            a("bare_frac", "at_least", 1, a=0.8, tau=0.2)]),
    ]
    gaps = [
        ("Gravity", "Use partial-gravity suspension rigs and parabolic flight."),
        ("Atmosphere & vacuum", "Use a thermal-vacuum or reduced-pressure chamber."),
        ("Radiation", "Use controlled radiation test facilities."),
        ("Regolith properties", "Test with characterized soil simulants."),
        ("Permanent shadow temperatures", "Use a cryogenic test chamber."),
    ]
    return envelope("mission_templates") | {
        "params": {"shortlist_per_objective": 20, "missing_weight_max": 0.3,
                   "gap_threshold": 0.1, "k_max": 3},
        "templates": [{"id": "FAKE_MOON_BASE_OPS", "body": "moon", "name": "Moon base operations",
                       "objectives": moon},
                      {"id": "FAKE_MARS_SURFACE_OPS", "body": "mars",
                       "name": "Mars surface operations", "objectives": mars}],
        "gap_alternatives": [{"gap": gap, "body": "both", "alternative": alt,
                              "source": "Fixture text; see curated sources before use"}
                             for gap, alt in gaps]}


def _attrs(rng: random.Random, kind: int) -> dict[str, float | None]:
    slope = rng.uniform(1.5, 12)
    p90 = min(40, slope * rng.uniform(1.5, 2.4))
    bare = rng.uniform(0.68, 0.98)
    temperature = rng.uniform(-65, -5) if kind == 1 else rng.uniform(-25, 12)
    return {"slope_f100_p50_deg": round(slope, 3), "slope_f100_p90_deg": round(p90, 3),
            "frac_lt10_f100": round(max(0.1, 1 - slope / 24), 4),
            "frac_lt20_f100": round(max(0.2, 1 - slope / 50), 4),
            "tri_f100_m": round(rng.uniform(2, 25), 3),
            "slope_f400_p50_deg": round(slope * 0.7, 3),
            "slope_f400_p90_deg": round(p90 * 0.7, 3),
            "frac_lt10_f400": round(max(0.2, 1 - slope / 32), 4),
            "frac_lt20_f400": round(max(0.3, 1 - slope / 60), 4),
            "tri_f400_m": round(rng.uniform(4, 35), 3),
            "slope_r_p50_deg": round(slope * 0.4, 3),
            "slope_r_p90_deg": round(p90 * 0.4, 3),
            "frac_lt20_r": round(rng.uniform(0.85, 0.999), 4),
            "relief_m": round(rng.uniform(150, 1600), 2), "elev_min_m": 100,
            "precip_mm": round(rng.uniform(4, 180), 2), "bare_frac": round(bare, 4),
            "t_min_c": round(temperature, 2), "t_max_c": round(temperature + 50, 2)}


def generate(seed: int = 42, output: str | Path | None = None) -> dict[str, dict[str, Any]]:
    rng = random.Random(seed)
    regions = [("Chile", -24.5, -69.2), ("United States", 35.4, -111.5),
               ("Iceland", 64.8, -17.2), ("Canada", 75.2, -89.5),
               ("Namibia", -24.8, 15.3), ("Australia", -24.3, 133.7),
               ("Norway", 78.2, 16.0), ("Argentina", -25.5, -67.5),
               ("Kazakhstan", 43.4, 51.2), ("Jordan", 29.5, 35.4),
               ("Mongolia", 43.7, 103.8), ("Morocco", 30.2, -6.5)]
    tiles = []
    for index in range(72):
        country, lat, lon = regions[index % len(regions)]
        kind = index % 4
        is_kz = country == "Kazakhstan"
        is_practice = index < 4
        pool = "practice" if is_practice else "kazakhstan" if is_kz else "global"
        prefix = "PR" if is_practice else "KZ" if is_kz else "GL"
        tile = {"id": f"FAKE_{prefix}_{index:03d}", "pool": pool,
                "stratum": ["hot_desert", "cold_polar", "volcanic", "other_open"][kind],
                "name": f"Demo field site {index + 1}" if is_practice else None,
                "country": country, "lat": round(lat + rng.uniform(-1, 1), 3),
                "lon": round(lon + rng.uniform(-1.5, 1.5), 3), "attrs": _attrs(rng, kind),
                "context": {"tree_frac": 0.02, "crop_frac": 0.01, "built_frac": 0.01,
                            "water_frac": 0.02, "snow_frac": 0.12 if kind == 1 else 0},
                "missing": []}
        if index in (6, 15):
            tile["attrs"]["tri_f100_m"] = None
            tile["missing"] = ["tri_f100_m"]
        if index == 20:
            tile["context"]["water_frac"] = 0.7
        tiles.append(tile)
    for index in range(60):
        group = ["forest", "crop", "snow"][index // 20]
        attrs = _attrs(rng, 0)
        attrs["bare_frac"] = 0.05
        tiles.append({"id": f"FAKE_CT_{group.upper()}_{index:03d}", "pool": "control",
                      "stratum": None, "name": None, "country": "Synthetic control",
                      "lat": rng.uniform(-65, 75), "lon": rng.uniform(-170, 170), "attrs": attrs,
                      "context": {"tree_frac": 0.8 if group == "forest" else 0,
                                  "crop_frac": 0.8 if group == "crop" else 0,
                                  "built_frac": 0, "water_frac": 0,
                                  "snow_frac": 0.8 if group == "snow" else 0}, "missing": []})
    candidates = envelope("earth_candidates") | {"tiles": tiles,
                     "tiles_hash": tiles_hash([tile["id"] for tile in tiles])}
    moon_attrs = _attrs(random.Random(3), 1)
    moon_attrs.update({"t_min_c": -173, "t_max_c": -20, "precip_mm": 0, "bare_frac": 1,
                       "frac_lt10_f100": 0.72, "slope_f100_p90_deg": 19, "tri_f100_m": 12,
                       "relief_m": 850})
    mars_attrs = _attrs(random.Random(6), 0)
    mars_attrs.update({"t_min_c": -90, "t_max_c": 0, "precip_mm": 0, "bare_frac": 1,
                       "frac_lt10_f400": 0.9, "slope_f400_p50_deg": 3,
                       "slope_f400_p90_deg": 8, "tri_f400_m": 15, "relief_m": 500})
    targets_list = []
    for body, name, lat, lon, baseline, attributes in [
        ("moon", "Mons Mouton", -85.4, 32.7, 100, moon_attrs),
        ("mars", "Jezero crater", 18.44, 77.45, 400, mars_attrs)]:
        targets_list.append({"id": f"FAKE_{'MOON_MONS_MOUTON' if body == 'moon' else 'MARS_JEZERO'}",
                             "body": body, "name": name, "kind": "base_region" if body == "moon"
                             else "landing_site", "lon": lon, "lat": lat,
                             "dem_product": "Synthetic fixture terrain — no DEM loaded",
                             "fine_baseline_m": baseline, "attrs": attributes,
                             "attr_sources": {key: "synthetic:seed-42" for key in attributes},
                             "h_max_deg": 6.14 if body == "moon" else None,
                             "templates": [f"FAKE_{body.upper()}_{'BASE' if body == 'moon' else 'SURFACE'}_OPS"]})
    bins = [round(-89.95 + i * 0.1, 2) for i in range(1800)]
    hours, sweeps = [], []
    for latitude in bins:
        month_hours, month_sweeps = [], []
        for month in range(12):
            seasonal = 0.55 + 0.45 * math.cos((month - (2 if latitude >= 0 else 8)) * math.pi / 6)
            h = min(12, (0.7 + 4.4 * (abs(latitude) / 90) ** 4) * seasonal)
            month_hours.append(round(h, 3))
            month_sweeps.append(round(min(360, 90 + abs(latitude) * 2.5) * seasonal, 2))
        hours.append(month_hours)
        sweeps.append(month_sweeps)
    sun = envelope("sun_windows") | {
        "model": {"algorithm": "NOAA", "refraction": True, "step_min": 10,
                  "year": 2025, "lat_step_deg": 0.1}, "lat_bins": bins,
        "targets": [{"target": "FAKE_MOON_MONS_MOUTON", "h_max_deg": 6.14,
                     "hours_low": hours, "sweep_deg": sweeps}]}
    hypotheses = ["Solar-position accuracy", "Terrain attributes and cross-check",
                  "Recovery of documented practice sites", "Optimizer exactness",
                  "Campaign stability", "Attribute-group ablation", "Negative controls",
                  "DEM shadow accuracy", "Sensitivity to measurement baseline",
                  "Byte-identical reproduction"]
    validation = envelope("validation") | {
        "preregistration_commit": "not-preregistered-software-fixtures",
        "experiments": [{"id": f"E{i+1}", "hypothesis": h, "metric": "pending real-data experiment",
                         "value": None, "status": "not_run",
                         "notes": "Synthetic software demo. See implementation report for actual unit-test evidence; scientific validation has not run."}
                        for i, h in enumerate(hypotheses)],
        "practice_pairs": [], "baselines": [{"name": name, "median_pct": None}
                    for name in ["aridity_only", "random", "v1_similarity"]],
        "controls": [], "figures": []}
    bundle = {"earth_candidates": candidates, "targets": envelope("targets") |
              {"targets": targets_list}, "mission_templates": templates(),
              "sun_windows": sun, "validation": validation}
    for data in bundle.values():
        validate_data(data)
    if output is not None:
        directory = Path(output)
        if "processed" in directory.resolve().parts:
            raise ValueError("Synthetic fixtures must never be written into data/processed")
        directory.mkdir(parents=True, exist_ok=True)
        for name, data in bundle.items():
            (directory / f"{name}.json").write_text(
                json.dumps(data, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n")
    return bundle


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "data/fixtures")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    generate(args.seed, args.output)
    print(f"Wrote synthetic input fixtures to {args.output}")


if __name__ == "__main__":
    main()
