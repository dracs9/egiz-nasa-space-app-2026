"""Typed contracts; JSON Schema is authoritative.

Written with AI assistance (Codex); human review pending.
"""

from typing import Any, Literal, NotRequired, TypedDict


class Provenance(TypedDict):
    dataset: str
    provider: str
    version: str
    url: str
    role: str
    period: NotRequired[str]


class Envelope(TypedDict):
    schema: str
    version: str
    generated_at: str
    synthetic: bool
    provenance: list[Provenance]


class EarthTile(TypedDict):
    id: str
    pool: Literal["global", "practice", "kazakhstan", "control"]
    stratum: str | None
    name: str | None
    country: str | None
    lon: float
    lat: float
    attrs: dict[str, float | None]
    context: dict[str, float | None]
    missing: list[str]
    snow_free_frac: NotRequired[list[float | None]]


class EarthCandidates(Envelope):
    tiles_hash: str
    tiles: list[EarthTile]


class Target(TypedDict):
    id: str
    body: Literal["moon", "mars"]
    name: str
    kind: Literal["base_region", "landing_site", "validation_only"]
    lon: float
    lat: float
    dem_product: str
    fine_baseline_m: Literal[100, 400]
    attrs: dict[str, float | None]
    attr_sources: dict[str, str]
    h_max_deg: float | None
    templates: list[str]
    image: NotRequired[str | None]


class Targets(Envelope):
    targets: list[Target]


class MissionTemplates(Envelope):
    params: dict[str, int | float]
    templates: list[dict[str, Any]]
    gap_alternatives: list[dict[str, str]]


class SunWindows(Envelope):
    model: dict[str, Any]
    lat_bins: list[float]
    targets: list[dict[str, Any]]


class FidelityCell(TypedDict):
    F: float | None
    partial: NotRequired[bool]
    parts: NotRequired[dict[str, float | None]]
    reason: NotRequired[Literal["missing", "constraint"]]
    best_month: NotRequired[int]


class Campaign(TypedDict):
    k: Literal[1, 2, 3]
    coverage: float
    sites: list[dict[str, Any]]
    per_objective: list[dict[str, Any]]
    method: dict[str, int | float | bool]
    explain: NotRequired[dict[str, list[str]]]


class AttributeGap(TypedDict):
    objective: str
    attr: str
    ceiling: float


class PhysicalGap(TypedDict):
    gap: str
    alternative: str
    source: str


class GapLedger(TypedDict):
    attribute: list[AttributeGap]
    objective_ceiling: dict[str, float | None]
    physical: list[PhysicalGap]


class Run(TypedDict):
    target: str
    template: str
    fidelity: dict[str, dict[str, FidelityCell]]
    campaigns: list[Campaign]
    gaps: GapLedger


class Results(Envelope):
    engine_version: str
    inputs: dict[str, str]
    runs: list[Run]


class Validation(Envelope):
    preregistration_commit: str
    experiments: list[dict[str, Any]]
    practice_pairs: list[dict[str, Any]]
    baselines: list[dict[str, Any]]
    controls: list[dict[str, Any]]
    figures: list[str]
