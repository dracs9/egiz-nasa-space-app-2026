"""Validated, deterministic loader for an EGIZ data snapshot.

Reads the existing contract files (earth_candidates, targets, mission_templates,
optional sun_windows and results), validates them with the shared contract
validator, hashes the exact bytes read, and keeps missingness explicit.
Nothing is imputed: a missing value stays ``None`` and is listed.

Written with AI assistance (Claude Code); human review pending.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pipeline.contracts.validate import ContractError, validate_data

REQUIRED = ("earth_candidates", "targets", "mission_templates")
OPTIONAL = ("sun_windows", "results")
UNIT_SUFFIXES = ("_deg", "_m", "_c", "_mm", "_frac")
RESULT_INPUT_KEYS = {
    "earth_candidates": "earth_candidates_sha256",
    "targets": "targets_sha256",
    "mission_templates": "templates_sha256",
    "sun_windows": "sun_windows_sha256",
}
# Pools that are never ranked as discovery candidates (engine excludes them from campaigns).
EXCLUDED_POOLS = {"control"}


@dataclass
class Snapshot:
    """One immutable, validated data snapshot."""

    path: str
    files: dict[str, dict[str, Any]]
    synthetic: bool
    candidates: list[dict[str, Any]]
    targets: dict[str, dict[str, Any]]
    templates: dict[str, dict[str, Any]]
    params: dict[str, Any]
    gap_alternatives: list[dict[str, Any]]
    sun: dict[str, Any] | None
    results: dict[str, Any] | None
    results_consistent: bool | None
    sources: list[dict[str, str]]
    skipped: list[dict[str, str]] = field(default_factory=list)
    issues: list[str] = field(default_factory=list)
    kind: str = "contract"
    dataset_version: str | None = None

    @property
    def candidate_count(self) -> int:
        return len(self.candidates) + len(self.skipped)


def _read(path: Path) -> tuple[dict[str, Any], str]:
    try:
        raw = path.read_bytes()
        data = json.loads(raw)
    except (OSError, ValueError) as error:
        raise ContractError(f"{path}: {error}") from error
    return data, hashlib.sha256(raw).hexdigest()


def _has_unit(attr: str) -> bool:
    """Unit in the name: a unit suffix, or the dimensionless ``frac_`` prefix used by the engine."""
    return attr.endswith(UNIT_SUFFIXES) or attr.startswith("frac_")


def _finite_or_none(value: Any) -> bool:
    if value is None:
        return True
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def load_snapshot(directory: str | Path, *, ids: list[str] | None = None,
                  limit: int | None = None) -> Snapshot:
    """Load and validate a snapshot directory.

    ``ids`` restricts candidates to the given AOI IDs; ``limit`` keeps the first
    N candidates in ID order (deterministic development subsets). Invalid
    records are skipped with a reason, never silently dropped.
    """
    directory = Path(directory)
    raw: dict[str, dict[str, Any]] = {}
    files: dict[str, dict[str, Any]] = {}
    for name in REQUIRED + OPTIONAL:
        path = directory / f"{name}.json"
        if not path.exists():
            if name in REQUIRED:
                raise ContractError(f"Missing required snapshot file: {path}")
            continue
        data, digest = _read(path)
        validate_data(data, production="processed" in directory.parts)
        raw[name] = data
        files[name] = {"sha256": digest, "schema": data.get("schema"), "version": data.get("version")}

    flags = {bool(data.get("synthetic", False)) for data in raw.values()}
    if len(flags) != 1:
        raise ContractError("Mixed observed/synthetic files in one snapshot")
    synthetic = flags.pop()

    issues: list[str] = []
    results = raw.get("results")
    results_consistent: bool | None = None
    if results is not None:
        inputs = results.get("inputs", {})
        stale = [name for name, key in RESULT_INPUT_KEYS.items()
                 if name in files and inputs.get(key) != files[name]["sha256"]]
        results_consistent = not stale
        if stale:
            issues.append("results.json input hashes do not match: " + ", ".join(stale)
                          + " (engine is recomputed; committed results are not used)")

    targets = {t["id"]: t for t in raw["targets"]["targets"]}
    templates = {t["id"]: t for t in raw["mission_templates"]["templates"]}
    params = dict(raw["mission_templates"].get("params", {}))
    gap_alternatives = list(raw["mission_templates"].get("gap_alternatives", []))

    for target in targets.values():
        for attr, value in target.get("attrs", {}).items():
            if not _has_unit(attr):
                issues.append(f"target {target['id']}: attribute {attr} has no unit suffix")
            if not _finite_or_none(value):
                raise ContractError(f"target {target['id']}: {attr} is not finite or null")

    tiles = sorted(raw["earth_candidates"]["tiles"], key=lambda tile: tile["id"])
    if ids is not None:
        wanted = set(ids)
        unknown = wanted - {tile["id"] for tile in tiles}
        if unknown:
            raise ContractError(f"Unknown candidate IDs: {sorted(unknown)}")
        tiles = [tile for tile in tiles if tile["id"] in wanted]
    if limit is not None:
        if limit < 1:
            raise ValueError("limit must be positive")
        tiles = tiles[:limit]

    candidates: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    for tile in tiles:
        if tile.get("pool") in EXCLUDED_POOLS:
            skipped.append({"id": tile["id"], "reason": f"pool '{tile['pool']}' is excluded from ranking"})
            continue
        bad = [attr for attr, value in tile.get("attrs", {}).items() if not _finite_or_none(value)]
        bad += [attr for attr, value in tile.get("context", {}).items() if not _finite_or_none(value)]
        if bad:
            skipped.append({"id": tile["id"], "reason": "non-finite values: " + ", ".join(sorted(bad))})
            continue
        unitless = [attr for attr in tile.get("attrs", {}) if not _has_unit(attr)]
        if unitless:
            skipped.append({"id": tile["id"], "reason": "attributes without unit suffix: " + ", ".join(unitless)})
            continue
        declared = set(tile.get("missing", []))
        actual = {attr for attr, value in tile.get("attrs", {}).items() if value is None}
        if actual - declared:
            issues.append(f"{tile['id']}: null attributes not declared in 'missing': {sorted(actual - declared)}")
        candidates.append(tile)

    sources = []
    for name in ("earth_candidates", "targets"):
        for i, item in enumerate(raw[name].get("provenance", []), start=1):
            sources.append({"id": f"{name}:{i}", "dataset": item.get("dataset", ""),
                            "role": item.get("role", ""), "url": item.get("url", "")})

    return Snapshot(path=directory.as_posix(), files=files, synthetic=synthetic, candidates=candidates,
                    targets=targets, templates=templates, params=params,
                    gap_alternatives=gap_alternatives, sun=raw.get("sun_windows"), results=results,
                    results_consistent=results_consistent, sources=sources, skipped=skipped, issues=issues)


def summary(snapshot: Snapshot) -> dict[str, Any]:
    """Machine-readable validation report."""
    missing: dict[str, int] = {}
    for tile in snapshot.candidates:
        for attr, value in tile.get("attrs", {}).items():
            if value is None:
                missing[attr] = missing.get(attr, 0) + 1
    return {
        "path": snapshot.path,
        "kind": snapshot.kind,
        "dataset_version": snapshot.dataset_version,
        "synthetic": snapshot.synthetic,
        "files": snapshot.files,
        "candidates_loaded": len(snapshot.candidates),
        "distinct_groups": len({t.get("group_id") for t in snapshot.candidates if t.get("group_id")}),
        "candidates_skipped": snapshot.skipped,
        "targets": sorted(snapshot.targets),
        "templates": sorted(snapshot.templates),
        "engine_results_consistent": snapshot.results_consistent,
        "missing_attribute_counts": dict(sorted(missing.items())),
        "issues": snapshot.issues,
    }
