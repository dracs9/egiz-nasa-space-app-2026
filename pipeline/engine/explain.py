"""Deterministic, measurement-grounded campaign explanations (ENG-04).

Written with AI assistance (Codex); human review pending.
No model, network call, or new scientific calculation is involved. A task role
comes only from Campaign.sites[].roles, scores only from Run.fidelity, and raw
values only from the selected candidate. A missing target comparison value is
never reconstructed from a fidelity score.

Example::

    campaign["explain"] = explain_campaign(campaign, run, candidates, template)

The optional CLI prints a copy of results with these explanations. To save it,
choose a separate file: ``python -m pipeline.engine.explain --data-dir
data/fixtures --out /tmp/egiz_explained_results.json``. Inputs stay unchanged.
"""

from __future__ import annotations

import argparse
import copy
import json
import math
from numbers import Real
from pathlib import Path

LABELS = {
    "slope_f100_p50_deg": "Median slope on the 100 m baseline",
    "slope_f100_p90_deg": "90th-percentile slope on the 100 m baseline",
    "frac_lt10_f100": "Area below 10 degrees on the 100 m baseline",
    "frac_lt20_f100": "Area below 20 degrees on the 100 m baseline",
    "tri_f100_m": "Terrain ruggedness on the fine grid for the 100 m baseline",
    "slope_f400_p50_deg": "Median slope on the 400 m baseline",
    "slope_f400_p90_deg": "90th-percentile slope on the 400 m baseline",
    "frac_lt10_f400": "Area below 10 degrees on the 400 m baseline",
    "frac_lt20_f400": "Area below 20 degrees on the 400 m baseline",
    "tri_f400_m": "Terrain ruggedness on the fine grid for the 400 m baseline",
    "slope_r_p50_deg": "Median slope on the 2 km baseline",
    "slope_r_p90_deg": "90th-percentile slope on the 2 km baseline",
    "frac_lt20_r": "Area below 20 degrees on the 2 km baseline",
    "relief_m": "Elevation range (95th minus 5th percentile)",
    "elev_min_m": "Minimum elevation", "precip_mm": "Annual precipitation",
    "bare_frac": "Bare ground", "t_min_c": "Minimum surface temperature",
    "t_max_c": "Maximum surface temperature", "light": "Low-Sun opportunity",
    "shadow": "Shadow similarity", "geology": "Geological context",
}
MONTHS = ("January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December")


def _literal(value):
    """Keep the stored numeric value; do not silently round or convert units."""
    if isinstance(value, Real) and not isinstance(value, bool):
        return json.dumps(float(value) if not isinstance(value, int) else value, allow_nan=False)
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


def _known(value):
    return value is not None and not (isinstance(value, Real) and not math.isfinite(value))


def _measurement(attr, value):
    if not _known(value):
        return "not assessed (value missing)"
    unit = (" fraction of area" if "frac" in attr else " degrees" if attr.endswith("_deg")
            else " degrees C" if attr.endswith("_c") else " mm/year" if attr.endswith("_mm")
            else " m" if attr.endswith("_m") else "")
    return f"{_literal(value)}{unit}"


def explain_campaign(campaign: dict, run: dict, candidates: dict, template: dict) -> dict[str, list[str]]:
    """Return deterministic phrases suitable for the optional Campaign.explain.

    The function does not invent suitability, target values, source attribution
    for a particular attribute, or task roles absent from the supplied campaign.
    Scores can be retained while component parts are omitted in compact results;
    in that case, component fidelity is explicitly unavailable.
    """
    tiles = {tile["id"]: tile for tile in candidates["tiles"]}
    objectives = {objective["id"]: objective for objective in template["objectives"]}
    explanation = {}
    for site in campaign["sites"]:
        id_ = site["id"]
        tile = tiles.get(id_)
        phrases = []
        if candidates.get("synthetic"):
            phrases.append("Synthetic demonstration: candidate measurements are invented test data.")
        if tile is None:
            phrases.append(f"Candidate {id_} is absent from the supplied candidate data.")
            explanation[id_] = phrases
            continue
        if tile.get("pool") == "control":
            raise ValueError(f"Control tile {id_} cannot be explained as a campaign site")
        seen = set()
        for objective_id in site["roles"]:
            if objective_id in seen:
                continue
            seen.add(objective_id)
            objective = objectives.get(objective_id)
            if objective is None:
                raise ValueError(f"Unknown campaign role {objective_id} for site {id_}")
            cell = run.get("fidelity", {}).get(objective_id, {}).get(id_)
            role = f"Campaign role: {objective['name']} ({objective_id})"
            if not cell or cell.get("F") is None:
                reason = cell.get("reason", "missing") if cell else "missing"
                phrases.append(f"{role}. Fidelity not assessed ({reason}).")
                continue
            phrases.append(f"{role}. Fidelity: {_literal(cell['F'])}.")
            parts = cell.get("parts", {})
            for spec in objective["attributes"]:
                attr = spec["attr"]
                label = LABELS.get(attr, attr)
                component = parts.get(attr)
                if attr in {"light", "shadow"}:
                    detail = f"{label}: component fidelity {_literal(component)}" if _known(component) else f"{label}: component fidelity not assessed"
                else:
                    detail = f"{label}: {_measurement(attr, tile.get('attrs', {}).get(attr))}"
                    detail += f". Component fidelity: {_literal(component)}" if _known(component) else ". Component fidelity not assessed"
                # A threshold is a supplied model parameter, not an assertion
                # that an unknown target or an operational requirement matches.
                if spec.get("fn") in {"at_least", "at_most"} and "a" in spec.get("params", {}):
                    relation = "at least" if spec["fn"] == "at_least" else "at most"
                    detail += f". Model threshold: {relation} {_measurement(attr, spec['params']['a'])}"
                phrases.append(detail + ".")
            if cell.get("partial"):
                phrases.append("The result flags partial data for this task.")
            month = cell.get("best_month")
            if any(spec["attr"] == "light" for spec in objective["attributes"]) and month is not None:
                if isinstance(month, bool) or not isinstance(month, int) or not 1 <= month <= 12:
                    raise ValueError(f"Invalid best_month for {id_}/{objective_id}")
                phrases.append(f"Best low-Sun month in this result: {MONTHS[month - 1]} ({month}).")
        if not seen:
            phrases.append("This site has no assigned task role in the supplied campaign.")
        sources = candidates.get("provenance", [])
        if sources:
            for source in sources:
                phrases.append("Candidate dataset provenance: " + "; ".join(
                    f"{key}={source[key]}" for key in ("dataset", "provider", "version", "url", "role") if key in source
                ) + ".")
        else:
            phrases.append("Candidate dataset provenance is not provided.")
        explanation[id_] = phrases
    return explanation


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path("data/fixtures"))
    parser.add_argument("--out", type=Path, help="Separate results copy with optional explanations; inputs stay unchanged")
    args = parser.parse_args(argv)
    from pipeline.contracts.validate import validate_data, validate_file

    source = args.data_dir / "results.json"
    if args.out and args.out.resolve() == source.resolve():
        parser.error("--out must be a separate file, preserving the input results snapshot")
    result = copy.deepcopy(validate_file(source))
    candidates = validate_file(args.data_dir / "earth_candidates.json")
    templates = validate_file(args.data_dir / "mission_templates.json")
    indexed = {template["id"]: template for template in templates["templates"]}
    for run in result["runs"]:
        for campaign in run["campaigns"]:
            campaign["explain"] = explain_campaign(campaign, run, candidates, indexed[run["template"]])
    validate_data(result)
    serialized = json.dumps(result, sort_keys=True, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if args.out:
        if result["synthetic"] and "processed" in args.out.resolve().parts:
            parser.error("Synthetic explanations cannot be written into data/processed")
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(serialized, encoding="utf-8")
        print(args.out)
    else:
        print(serialized, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
