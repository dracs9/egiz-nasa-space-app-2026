"""Contract-validated, reproducible batch engine and command-line entry point.

Written with AI assistance (Codex); human review pending.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np

from . import ENGINE_VERSION
from .campaign import design, gap_ledger
from .fidelity import objective_fidelity


def _read(path):
    """Validate and hash one immutable byte snapshot, never a later reread."""
    from pipeline.contracts.validate import ContractError, validate_data

    path = Path(path)
    try:
        raw = path.read_bytes()
        data = json.loads(raw)
    except (OSError, ValueError) as error:
        raise ContractError(f"{path}: {error}") from error
    return validate_data(data, production="processed" in path.parts), hashlib.sha256(raw).hexdigest()


def _sun_for(sun, target, tile):
    if not sun or not sun.get("lat_bins"):
        return None
    values = next((item for item in sun["targets"] if item["target"] == target["id"]), None)
    if values is None:
        return None
    # Nearest centre is equivalent to the documented floor rule for uniform
    # 0.1° bands and also supports deliberately sparse offline fixtures.
    bins = sun["lat_bins"]
    step = sun.get("model", {}).get("lat_step_deg", 0.1)
    if abs(bins[0] - (-90 + step / 2)) < 1e-7 and abs(bins[-1] - (90 - step / 2)) < 1e-7:
        i = max(0, min(len(bins) - 1, math.floor((tile["lat"] + 90) / step)))
    else:
        i = min(range(len(bins)), key=lambda j: abs(bins[j] - tile["lat"]))
    return {"hours_low": values["hours_low"][i], "sweep_deg": values["sweep_deg"][i]}


def compute_run(candidates, target, template, sun=None, params=None, shadows=None):
    """Compute one run in memory; controls are scored, excluded from campaigns."""
    params = params or {}
    tiles = sorted(candidates["tiles"], key=lambda tile: tile["id"])
    objectives = template["objectives"]
    fidelity = {objective["id"]: {} for objective in objectives}
    parts = {objective["id"]: {} for objective in objectives}
    months = {}
    for tile in tiles:
        light = _sun_for(sun, target, tile)
        for objective in objectives:
            extra = {
                "context": tile.get("context", {}),
                "snow_free_frac": tile.get("snow_free_frac"),
                "missing_weight_max": params.get("missing_weight_max", 0.3),
                "light": light,
            }
            if shadows and tile["id"] in shadows and target["id"] in shadows:
                a = np.asarray(shadows[tile["id"]], dtype=float)
                b = np.asarray(shadows[target["id"]], dtype=float)
                if a.shape == b.shape and np.all(np.isfinite(a)) and np.all(np.isfinite(b)):
                    extra["shadow"] = {"mean_abs_difference": float(np.mean(np.abs(a - b)))}
            cell = objective_fidelity(objective, tile["attrs"], target["attrs"], extra)
            fidelity[objective["id"]][tile["id"]] = cell
            if tile["pool"] != "control":
                part_values = cell.get("parts")
                if part_values is None:
                    # Attribute ceilings are over the pool, even when a site
                    # cannot satisfy enough of an objective to receive an F.
                    part_values = {}
                    for spec in objective["attributes"]:
                        probe = objective_fidelity({"attributes": [spec], "constraints": []},
                                                   tile["attrs"], target["attrs"], extra)
                        part_values[spec["attr"]] = probe.get("parts", {}).get(spec["attr"])
                parts[objective["id"]][tile["id"]] = part_values
            if "best_month" in cell:
                months.setdefault(tile["id"], {})[objective["id"]] = cell["best_month"]
    ids = [tile["id"] for tile in tiles if tile["pool"] != "control"]
    matrix = np.array([[fidelity[objective["id"]][id_]["F"] for objective in objectives] for id_ in ids], dtype=float)
    if not ids:
        matrix = np.empty((0, len(objectives)))
    weights = [objective["weight_default"] for objective in objectives]
    campaigns = design(matrix, weights, params.get("k_max", 3), site_ids=ids,
                       objective_ids=[objective["id"] for objective in objectives], best_months=months,
                       per_objective=params.get("shortlist_per_objective", 20)) if ids else []
    physical = [{key: value for key, value in gap.items() if key != "body"}
                for gap in params.get("gap_alternatives", []) if gap["body"] in {target["body"], "both"}]
    eligible_fidelity = {o: {id_: cell for id_, cell in cells.items() if id_ in ids} for o, cells in fidelity.items()}
    gaps = gap_ledger(parts, eligible_fidelity, physical, threshold=params.get("gap_threshold", 0.1))
    return {"target": target["id"], "template": template["id"], "fidelity": fidelity,
            "campaigns": campaigns, "gaps": gaps}


def main(paths=None) -> Path:
    """Read four inputs and write results; ``paths`` accepts descriptive keys.

    generated_at is the latest input snapshot timestamp, rather than wall-clock
    execution time, so the same version and input bytes produce identical output.
    """
    if paths is None:
        parser = argparse.ArgumentParser(description=__doc__)
        parser.add_argument("--data-dir", default="data/fixtures")
        parser.add_argument("--out")
        args = parser.parse_args()
        base = Path(args.data_dir)
        paths = {name: base / f"{name}.json" for name in ("earth_candidates", "targets", "mission_templates", "sun_windows")}
        paths["out"] = Path(args.out) if args.out else base / "results.json"
    aliases = {"earth_candidates": "candidates", "mission_templates": "templates", "sun_windows": "sun"}
    normalized = {key: Path(paths[key] if key in paths else paths[aliases[key]])
                  for key in ("earth_candidates", "targets", "mission_templates", "sun_windows")}
    snapshots = {name: _read(path) for name, path in normalized.items()}
    inputs = {name: snapshot[0] for name, snapshot in snapshots.items()}
    candidates, targets = inputs["earth_candidates"], inputs["targets"]
    templates, sun = inputs["mission_templates"], inputs["sun_windows"]
    params = dict(templates["params"], gap_alternatives=templates.get("gap_alternatives", []))
    runs = []
    for target in sorted(targets["targets"], key=lambda value: value["id"]):
        for template in sorted(templates["templates"], key=lambda value: value["id"]):
            if template["id"] in target["templates"] and template["body"] == target["body"]:
                runs.append(compute_run(candidates, target, template, sun, params))
    provenance = {}
    for document in inputs.values():
        for source in document["provenance"]:
            provenance[json.dumps(source, sort_keys=True)] = source
    result = {
        "schema": "egiz.results", "version": "1.0.0", "engine_version": ENGINE_VERSION,
        "generated_at": max(document["generated_at"] for document in inputs.values()),
        "synthetic": any(document["synthetic"] for document in inputs.values()),
        "provenance": [provenance[key] for key in sorted(provenance)],
        "inputs": {f"{'templates' if name == 'mission_templates' else name}_sha256": snapshot[1]
                   for name, snapshot in snapshots.items()}, "runs": runs,
    }
    from pipeline.contracts.validate import check_no_synthetic, validate_data

    out = Path(paths.get("out", paths.get("output", "data/fixtures/results.json")))
    production = "processed" in out.resolve().parts
    if result["synthetic"] and production:
        raise ValueError("Synthetic inputs must never produce output in data/processed")
    if production:
        # A false metadata flag cannot turn FAKE_ identifiers into observations.
        # Check input snapshots too: unused/no-score fake tiles need not occur
        # in a selected campaign but still invalidate a production calculation.
        for document in inputs.values():
            check_no_synthetic(document)
    validate_data(result, production=production)
    out.parent.mkdir(parents=True, exist_ok=True)
    # Atomic replacement leaves a previous valid result intact on write failure.
    temp = out.with_suffix(out.suffix + ".tmp")
    temp.write_text(json.dumps(result, sort_keys=True, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    temp.replace(out)
    return out


if __name__ == "__main__":
    print(main())
