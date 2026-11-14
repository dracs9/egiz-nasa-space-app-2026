"""Versioned configuration loading and validation for ATLAS-Pi.

Configuration is data, not code: tasks, factors, physical conditions,
measurements and curated site context live in ``config/*.json``.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

CONFIG = Path(__file__).resolve().parent / "config"
ROLES = {"primary", "secondary"}
REPRODUCIBLE = {"yes", "partial", "no"}
KINDS = {"observed", "retrieved", "derived", "model", "curated", "assumed", "unknown"}


class RegistryError(ValueError):
    pass


def _load(name: str) -> dict:
    return json.loads((CONFIG / name).read_text())


def config_hash() -> str:
    digest = hashlib.sha256()
    for path in sorted(CONFIG.glob("*.json")):
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


@dataclass(frozen=True)
class Registry:
    tasks: dict
    physical: dict
    measurements: dict
    context: dict

    @property
    def factors(self) -> dict:
        return self.tasks["factors"]

    @property
    def rules(self) -> dict:
        return self.tasks["status_rules"]

    def task_list(self, body: str | None = None) -> list[dict]:
        return [t for t in self.tasks["tasks"] if body is None or body in t["bodies"]]

    def task(self, task_id: str) -> dict:
        for task in self.tasks["tasks"]:
            if task["id"] == task_id:
                return task
        raise KeyError(task_id)

    def physical_factor(self, factor_id: str) -> dict:
        for factor in self.physical["factors"]:
            if factor["id"] == factor_id:
                return factor
        raise KeyError(factor_id)

    def mission(self, mission_id: str) -> dict:
        for mission in self.tasks["missions"]:
            if mission["id"] == mission_id:
                return mission
        raise KeyError(mission_id)


def validate(reg: Registry) -> None:
    """Fail loudly on inconsistent configuration."""
    physical_ids = {f["id"] for f in reg.physical["factors"]}
    for f in reg.physical["factors"]:
        if f["reproducible_in_field"] not in REPRODUCIBLE:
            raise RegistryError(f"{f['id']}: bad reproducible_in_field")
        for body, value in f["values"].items():
            if value["kind"] not in KINDS:
                raise RegistryError(f"{f['id']}.{body}: bad kind {value['kind']}")
    seen = set()
    for task in reg.tasks["tasks"]:
        if task["id"] in seen:
            raise RegistryError(f"duplicate task {task['id']}")
        seen.add(task["id"])
        if not task["factors"]:
            raise RegistryError(f"{task['id']}: no factors")
        for spec in task["factors"]:
            if spec["factor"] not in reg.factors or spec["role"] not in ROLES or spec["weight"] <= 0:
                raise RegistryError(f"{task['id']}: invalid factor spec {spec}")
        for dep, role in task["physics"].items():
            if dep not in physical_ids or role not in ROLES:
                raise RegistryError(f"{task['id']}: invalid physics dependency {dep}:{role}")
        if not 0 < task["min_evidence"] <= 1 or task["required_resolution_m"] <= 0:
            raise RegistryError(f"{task['id']}: invalid evidence/resolution requirement")
        if not set(task["bodies"]) <= {"moon", "mars"}:
            raise RegistryError(f"{task['id']}: invalid bodies")
    for mission in reg.tasks["missions"]:
        for task_id, weight in mission["task_weights"].items():
            if task_id not in seen or weight < 0:
                raise RegistryError(f"{mission['id']}: invalid task weight {task_id}")
    known = {f for m in reg.measurements["measurements"] for f in m["resolves"]}
    if not known <= set(reg.factors) | physical_ids:
        raise RegistryError("measurement resolves an unknown factor")
    rules = reg.rules
    if not 0 < rules["conditional_point"] < rules["supported_lower_bound"] < 1:
        raise RegistryError("status thresholds out of order")
    if not 0 <= rules.get("supported_min_quality", -1) <= 1:
        raise RegistryError("supported_min_quality must be in [0,1]")


def load() -> Registry:
    reg = Registry(_load("tasks.json"), _load("physical_factors.json"),
                   _load("measurements.json"), _load("site_context.json"))
    validate(reg)
    return reg
