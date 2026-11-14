"""Strict file and semantic validation. Written with AI assistance (Codex); review pending."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[2]


class ContractError(ValueError):
    """A JSON value violates a versioned contract."""


def _fail(path: str, message: str) -> None:
    raise ContractError(f"{path}: {message}")


def tiles_hash(ids: list[str]) -> str:
    """SHA-256 of sorted IDs joined by a newline, without a trailing newline."""
    return hashlib.sha256("\n".join(sorted(ids)).encode()).hexdigest()


def check_no_synthetic(data: dict[str, Any], path: str = "$") -> None:
    if data.get("synthetic") is not False:
        _fail(path, "production data must have synthetic=false")

    def visit(value: Any, location: str) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                if (key in {"id", "target", "template", "tile", "site"}
                        and isinstance(child, str) and child.startswith("FAKE_")):
                    _fail(location, "production data contains a FAKE_ identifier")
                visit(child, f"{location}.{key}")
        elif isinstance(value, list):
            for index, child in enumerate(value):
                visit(child, f"{location}[{index}]")

    visit(data, path)


def _unique(items: list[dict[str, Any]], key: str, path: str) -> None:
    ids = [item[key] for item in items]
    if len(ids) != len(set(ids)):
        _fail(path, f"duplicate {key}")


def validate_data(data: dict[str, Any], *, production: bool = False) -> dict[str, Any]:
    if not isinstance(data, dict):
        _fail("$", "expected an object")
    name = data.get("schema", "")
    if not isinstance(name, str) or not re.fullmatch(r"egiz\.[a-z_]+", name):
        _fail("$.schema", "unknown schema")
    schema_path = ROOT / "contracts" / f"{name.removeprefix('egiz.')}.schema.json"
    if not schema_path.is_file():
        _fail("$.schema", f"unsupported schema {name!r}")
    schema = json.loads(schema_path.read_text())
    errors = sorted(Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(data),
                    key=lambda error: str(list(error.path)))
    if errors:
        error = errors[0]
        _fail("$" + "".join(f"[{p}]" if isinstance(p, int) else f".{p}" for p in error.path),
              error.message)

    def finite(value: Any, path: str = "$") -> None:
        if isinstance(value, float) and not math.isfinite(value):
            _fail(path, "non-finite number")
        if isinstance(value, dict):
            for key, child in value.items():
                finite(child, f"{path}.{key}")
        elif isinstance(value, list):
            for index, child in enumerate(value):
                finite(child, f"{path}[{index}]")

    finite(data)
    if production:
        check_no_synthetic(data)
    if name == "egiz.earth_candidates":
        _unique(data["tiles"], "id", "$.tiles")
        if data["tiles_hash"] != tiles_hash([tile["id"] for tile in data["tiles"]]):
            _fail("$.tiles_hash", "does not match sorted tile IDs")
        for index, tile in enumerate(data["tiles"]):
            path = f"$.tiles[{index}]"
            raw_id = tile["id"].removeprefix("FAKE_")
            if tile["pool"] == "control" and not raw_id.startswith("CT_"):
                _fail(path + ".id", "control ID must start CT_")
            if tile["pool"] == "practice" and not tile["name"]:
                _fail(path + ".name", "practice site must have a name")
            null_keys = {key for key, value in tile["attrs"].items() if value is None}
            if not null_keys.issubset(set(tile["missing"])):
                _fail(path + ".missing", "null attributes must be listed as missing")
            for key in tile["missing"]:
                if tile["attrs"].get(key) is not None:
                    _fail(path + ".missing", f"{key} has a value")
    elif name in {"egiz.targets", "egiz.mission_templates"}:
        field = "targets" if name.endswith("targets") else "templates"
        _unique(data[field], "id", f"$.{field}")
        if field == "templates":
            for template in data[field]:
                _unique(template["objectives"], "id", "$.templates.objectives")
                if sum(o["weight_default"] for o in template["objectives"]) <= 0:
                    _fail("$.templates.objectives.weight_default", "at least one weight must be positive")
    elif name == "egiz.sun_windows":
        bins = data["lat_bins"]
        if any(left >= right for left, right in zip(bins, bins[1:])):
            _fail("$.lat_bins", "must be strictly increasing")
        if any(abs(value - (-89.95 + index * 0.1)) > 1e-6
               for index, value in enumerate(bins)):
            _fail("$.lat_bins", "must contain the documented 0.1-degree band centres")
        _unique(data["targets"], "target", "$.targets")
        for target in data["targets"]:
            for key in ("hours_low", "sweep_deg"):
                if len(target[key]) != len(bins):
                    _fail(f"$.targets.{key}", "row count must equal lat_bins length")
    elif name == "egiz.results":
        pairs = [(run["target"], run["template"]) for run in data["runs"]]
        if len(pairs) != len(set(pairs)):
            _fail("$.runs", "duplicate target/template pair")
        for run in data["runs"]:
            for campaign in run["campaigns"]:
                ids = [site["id"] for site in campaign["sites"]]
                if len(ids) != len(set(ids)) or len(ids) > campaign["k"]:
                    _fail("$.runs.campaigns.sites", "duplicate sites or more sites than k")
                if any(site.removeprefix("FAKE_").startswith("CT_") for site in ids):
                    _fail("$.runs.campaigns.sites", "control sites cannot enter campaigns")
    return data


def validate_file(path: str | Path, *, production: bool | None = None) -> dict[str, Any]:
    path = Path(path)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ContractError(f"{path}: {exc}") from exc
    return validate_data(data, production=("processed" in path.parts if production is None
                                           else production))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--production", action="store_true", help="reject synthetic data")
    args = parser.parse_args(argv)
    try:
        for path in args.files:
            validate_file(path, production=True if args.production else None)
            print(f"OK {path}")
    except (ContractError, ValueError) as exc:
        print(f"INVALID {exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
