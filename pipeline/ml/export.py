"""Build and validate versioned discovery-result documents.

Written with AI assistance (Claude Code); human review pending.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import jsonschema

from pipeline.engine import ENGINE_VERSION

from . import ML_VERSION, RESULT_SCHEMA_VERSION
from .baseline import METHOD_NAME, engine_matches_committed, run_all
from .loader import Snapshot

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = ROOT / "contracts" / "ml" / "discovery-result.schema.json"

LIMITATIONS_PILOT = [
    "Exploratory pilot: candidates are a small hand-selected set of regional windows, not a global sample.",
]
LIMITATIONS_GEO = [
    "Candidates are the Earth AOIs of a geospatial release (sampled 60° S–80° N, no Antarctica); "
    "a sample, not exhaustive coverage of Earth.",
]
LIMITATIONS = [
    "Ranking reuses the provisional deterministic engine; weights and widths are not calibrated against "
    "independent field evidence (Stage 2 pre-registered evaluation not yet run).",
    "Terrain similarity does not establish field suitability, access, safety or planetary equivalence.",
    "Ranking stability reflects sensitivity to method parameters only, not DEM or land-cover measurement error.",
    "Learned similarity, geology and novelty are not available in Stage 1.",
]


def _schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def validate_document(doc: dict) -> None:
    jsonschema.Draft202012Validator(_schema()).validate(doc)


def _run_id(snapshot: Snapshot, profile_id: str, target_id: str, config: dict) -> str:
    payload = json.dumps({"files": {k: v["sha256"] for k, v in sorted(snapshot.files.items())},
                          "ids": [t["id"] for t in snapshot.candidates], "profile": profile_id,
                          "target": target_id, "config": config, "method": [METHOD_NAME, ML_VERSION]},
                         sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def build_documents(snapshot: Snapshot, config: dict | None = None,
                    created_at: str | None = None) -> list[dict[str, Any]]:
    created_at = created_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    consistent = engine_matches_committed(snapshot)
    if consistent is False:
        snapshot.issues.append("Recomputed engine F differs from committed results.json")
    docs = []
    for profile in run_all(snapshot, config):
        target, template, objective = profile["target"], profile["template"], profile["objective"]
        profile_id = f"{template['id']}/{objective['id']}"
        physical = [{"gap": g["gap"], "alternative": g["alternative"], "source": g.get("source")}
                    for g in snapshot.gap_alternatives if g.get("body") in {target["body"], "both"}]
        doc = {
            "schema": "egiz.ml.discovery_result",
            "schema_version": RESULT_SCHEMA_VERSION,
            "status": "DRAFT",
            "run_id": _run_id(snapshot, profile_id, target["id"], profile["config"]),
            "created_at": created_at,
            "method": {"name": METHOD_NAME, "version": ML_VERSION, "engine_version": ENGINE_VERSION,
                       "config": profile["config"]},
            "dataset": {
                "path": snapshot.path,
                "kind": snapshot.kind,
                "dataset_version": snapshot.dataset_version,
                "synthetic": snapshot.synthetic,
                "provenance_class": "synthetic" if snapshot.synthetic else "derived",
                "files": snapshot.files,
                "candidate_count": snapshot.candidate_count,
                "eligible_count": sum(c["eligible"] for c in profile["candidates"]),
                "skipped": snapshot.skipped,
                "engine_results_consistent": consistent,
                "sources": snapshot.sources,
            },
            "target": {"id": target["id"], "body": target["body"], "name": target.get("name", target["id"]),
                       "kind": target.get("kind"), "lon": target["lon"], "lat": target["lat"]},
            "mission_profile": {"id": profile_id, "template_id": template["id"],
                                "objective_id": objective["id"], "name": objective.get("name", objective["id"]),
                                "attributes": objective["attributes"],
                                "constraints": objective.get("constraints", [])},
            "component_definitions": profile["definitions"],
            "ranking": {"primary_component": "deterministic_fidelity",
                        "order": "descending deterministic_fidelity; ineligible candidates last with rank null; "
                                 "ties broken by aoi_id"},
            "candidates": profile["candidates"],
            "physical_non_equivalence": physical,
            "limitations": (LIMITATIONS_GEO if snapshot.kind == "geo" else LIMITATIONS_PILOT) + LIMITATIONS
                           + [f"Snapshot issue: {issue}" for issue in snapshot.issues],
        }
        validate_document(doc)
        docs.append(doc)
    return docs


def write_documents(docs: list[dict], out_dir: str | Path) -> list[Path]:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    index = []
    for doc in docs:
        name = f"{doc['target']['id']}__{doc['mission_profile']['id'].replace('/', '__')}.json"
        path = out_dir / name
        path.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        paths.append(path)
        top = next((c for c in doc["candidates"] if c["rank"] == 1), None)
        index.append({"file": name, "run_id": doc["run_id"], "target": doc["target"]["id"],
                      "mission_profile": doc["mission_profile"]["id"],
                      "eligible": doc["dataset"]["eligible_count"],
                      "top_candidate": top["aoi_id"] if top else None})
    (out_dir / "index.json").write_text(json.dumps({"schema": "egiz.ml.discovery_index",
                                                    "schema_version": RESULT_SCHEMA_VERSION,
                                                    "results": index}, indent=2) + "\n", encoding="utf-8")
    return paths
