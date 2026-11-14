"""Reproduce engine artifacts without disguising fixtures as observations.

Written with AI assistance (Codex); human review pending.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline.contracts.fixtures import generate  # noqa: E402
from pipeline.contracts.validate import ContractError, validate_file  # noqa: E402
from pipeline.engine.run import main as run_engine  # noqa: E402

INPUTS = ["earth_candidates", "targets", "mission_templates", "sun_windows"]


def build(*, fixtures: bool = False) -> Path:
    processed = ROOT / "data/processed"
    present = [name for name in INPUTS if (processed / f"{name}.json").exists()]
    if fixtures or not present:
        directory = ROOT / "data/fixtures"
        generate(output=directory)
        print("SYNTHETIC DEMO DATA — not NASA observations. Output: data/fixtures", flush=True)
    else:
        if len(present) != len(INPUTS):
            missing = sorted(set(INPUTS) - set(present))
            raise ContractError(f"Incomplete real-data inputs: {', '.join(missing)}. "
                                "Finish ingestion, or explicitly use make fixtures.")
        directory = processed
        for name in INPUTS:
            validate_file(directory / f"{name}.json", production=True)
        print("Building from validated real input files in data/processed", flush=True)
    run_engine({"earth_candidates": directory / "earth_candidates.json",
                "targets": directory / "targets.json",
                "mission_templates": directory / "mission_templates.json",
                "sun_windows": directory / "sun_windows.json", "out": directory / "results.json"})
    if directory.name == "fixtures":
        from pipeline.contracts.twin_fixtures import generate as generate_renders

        frames = generate_renders()
        print(f"Rendered {len(frames['items'])} labelled synthetic Same-Sun frames", flush=True)
    validation = directory / "validation.json"
    if not validation.exists():
        inputs = [validate_file(directory / f"{name}.json") for name in INPUTS]
        report = {"schema": "egiz.validation", "version": "1.0.0", "synthetic": False,
                  "generated_at": max(item["generated_at"] for item in inputs),
                  "provenance": inputs[0]["provenance"], "preregistration_commit": "not-supplied",
                  "experiments": [{"id": f"E{i}", "hypothesis": f"Pending documented experiment E{i}",
                                   "metric": "not run", "value": None, "status": "not_run",
                                   "notes": "A documented, independently reviewed experiment is required."
                                   } for i in range(1, 11)],
                  "practice_pairs": [], "baselines": [], "controls": [], "figures": []}
        from pipeline.contracts.validate import validate_data

        validate_data(report, production=True)
        validation.write_text(json.dumps(report, sort_keys=True, separators=(",", ":")) + "\n")
    for name in INPUTS + ["results", "validation"]:
        validate_file(directory / f"{name}.json", production=directory == processed)
    print(f"Validated 6 data contracts in {directory.relative_to(ROOT)}")
    return directory


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixtures", action="store_true")
    args = parser.parse_args()
    try:
        build(fixtures=args.fixtures)
    except (ContractError, ValueError, OSError) as exc:
        print(f"Data build failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
