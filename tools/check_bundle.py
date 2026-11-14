"""Check schema and cross-file integrity. Written with AI assistance (Codex); review pending."""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline.contracts.validate import ContractError, validate_file  # noqa: E402

NAMES = ["earth_candidates", "targets", "mission_templates", "sun_windows", "results", "validation"]


def check_bundle(directory: Path) -> None:
    bundle = {name: validate_file(directory / f"{name}.json") for name in NAMES}
    flags = {data["synthetic"] for data in bundle.values()}
    if len(flags) != 1:
        raise ContractError("Mixed observed/synthetic envelopes in one bundle")
    inputs = bundle["results"]["inputs"]
    for name, key in [("earth_candidates", "earth_candidates_sha256"),
                      ("targets", "targets_sha256"), ("mission_templates", "templates_sha256"),
                      ("sun_windows", "sun_windows_sha256")]:
        actual = hashlib.sha256((directory / f"{name}.json").read_bytes()).hexdigest()
        if inputs[key] != actual:
            raise ContractError(f"{key} is stale; rebuild results")
    tile_ids = {tile["id"] for tile in bundle["earth_candidates"]["tiles"]}
    eligible_ids = {tile["id"] for tile in bundle["earth_candidates"]["tiles"]
                    if tile["pool"] != "control"}
    pool_size = sum(tile["pool"] != "control" for tile in bundle["earth_candidates"]["tiles"])
    target_ids = {target["id"] for target in bundle["targets"]["targets"]}
    templates = {template["id"]: template for template in bundle["mission_templates"]["templates"]}
    for run in bundle["results"]["runs"]:
        if run["target"] not in target_ids or run["template"] not in templates:
            raise ContractError("Results reference an unknown target/template")
        objectives = {o["id"] for o in templates[run["template"]]["objectives"]}
        if set(run["fidelity"]) != objectives:
            raise ContractError("Results do not match template objectives")
        if set(run["gaps"]["objective_ceiling"]) != objectives:
            raise ContractError("Objective ceilings do not match template objectives")
        for table in run["fidelity"].values():
            if set(table) != tile_ids:
                raise ContractError("Fidelity table does not cover the input tile IDs")
        for objective in objectives:
            known = [run["fidelity"][objective][id_]["F"] for id_ in eligible_ids
                     if run["fidelity"][objective][id_]["F"] is not None]
            expected = max(known) if known else None
            actual = run["gaps"]["objective_ceiling"][objective]
            if (expected is None) != (actual is None) or (
                    expected is not None and abs(expected - actual) > 1e-8):
                raise ContractError("Objective ceiling does not match eligible observed fidelity")
        for campaign in run["campaigns"]:
            selected = {site["id"] for site in campaign["sites"]}
            if not selected.issubset(tile_ids):
                raise ContractError("Campaign references an unknown tile")
            rows = campaign["per_objective"]
            if len(rows) != len(objectives) or {row["objective"] for row in rows} != objectives:
                raise ContractError("Campaign objective rows are missing or duplicated")
            coverage = 0.0
            weights = sum(o["weight_default"] for o in templates[run["template"]]["objectives"])
            roles = {id_: set() for id_ in selected}
            for objective in templates[run["template"]]["objectives"]:
                oid = objective["id"]
                row = next(row for row in rows if row["objective"] == oid)
                maximum = max((run["fidelity"][oid][id_]["F"] or 0 for id_ in selected),
                              default=0.0)
                if abs((row["F"] or 0) - maximum) > 1e-8:
                    raise ContractError("Campaign objective does not equal selected-site fidelity maxima")
                if row["site"] is not None:
                    if row["site"] not in selected:
                        raise ContractError("Objective winner is not selected in the campaign")
                    if abs((run["fidelity"][oid][row["site"]]["F"] or 0) - maximum) > 1e-8:
                        raise ContractError("Objective winner is not a maximizing selected site")
                    roles[row["site"]].add(oid)
                elif maximum > 0 and objective["weight_default"] > 0:
                    raise ContractError("Positive objective fidelity has no selected winner")
                coverage += maximum * objective["weight_default"]
            for site in campaign["sites"]:
                if set(site["roles"]) != roles[site["id"]]:
                    raise ContractError("Campaign roles disagree with objective assignments")
            if (campaign["method"]["pool_size"] != pool_size
                    or campaign["method"]["shortlist_size"] > pool_size):
                raise ContractError("Campaign method pool counts disagree with the input pool")
            if abs(campaign["coverage"] - coverage / weights) > 1e-7:
                raise ContractError("Campaign coverage does not match objective values")
    label = directory.relative_to(ROOT) if directory.is_relative_to(ROOT) else directory
    print(f"OK {label}: 6 schemas, hashes, references, coverage")


def main() -> int:
    try:
        check_bundle(ROOT / "data/fixtures")
        pilot = ROOT / "data/pilot"
        if any(pilot.glob("*.json")):
            check_bundle(pilot)
        processed = ROOT / "data/processed"
        if any(processed.glob("*.json")):
            check_bundle(processed)
    except (ContractError, OSError, KeyError, ZeroDivisionError) as exc:
        print(f"INVALID {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
