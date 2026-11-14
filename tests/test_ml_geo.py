"""ML adapter tests for the geospatial release geo-0.1.0.

Written with AI assistance (Claude Code); human review pending.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from pipeline.contracts.validate import ContractError
from pipeline.ml.export import build_documents, validate_document
from pipeline.ml.geo import UNMAPPED, load_geo_snapshot
from pipeline.ml.loader import load_snapshot

ROOT = Path(__file__).resolve().parents[1]
GEO = ROOT / "data" / "geo" / "geo-0.1.0"
PILOT = ROOT / "data" / "pilot"
FILES = ("aoi_catalog.json", "aoi_features.columns.json", "aoi_features.csv", "manifests/sources.json")

pytestmark = pytest.mark.skipif(not GEO.exists(), reason="geo-0.1.0 release not present")


@pytest.fixture(scope="module")
def geo():
    return load_geo_snapshot(GEO, PILOT)


def _copy_release(tmp_path: Path) -> Path:
    out = tmp_path / "geo"
    (out / "manifests").mkdir(parents=True)
    for name in FILES:
        shutil.copy(GEO / name, out / name)
    return out


def test_release_loads_earth_aois_only(geo):
    assert geo.kind == "geo" and geo.dataset_version == "geo-0.1.0"
    assert len(geo.candidates) == 329 and geo.skipped == []
    assert {t["group_id"].split("_")[0] for t in geo.candidates} == {"EARTH"}
    assert len({t["group_id"] for t in geo.candidates}) == 326
    assert set(geo.targets) == {"MOON_MONS_MOUTON", "MARS_JEZERO"}


def test_pilot_ids_are_preserved(geo):
    pilot_ids = {t["id"] for t in load_snapshot(PILOT).candidates}
    assert pilot_ids <= {t["id"] for t in geo.candidates}


def test_climate_is_context_not_substituted(geo):
    for tile in geo.candidates:
        for attr in UNMAPPED:
            assert tile["attrs"][attr] is None
            assert tile["missing_reasons"][attr] == UNMAPPED[attr]
    with_t2m = [t for t in geo.candidates if t["environment"]["t2m_min_coldest_month_c"] is not None]
    assert len(with_t2m) > 300


def test_missing_cells_stay_none(geo):
    l1 = [t for t in geo.candidates if t["coverage_level"] == "L1_dem"]
    assert l1 and all(t["attrs"]["bare_frac"] is None for t in l1)
    assert all(t["context"]["water_frac"] is None for t in l1)


def test_quality_failures_are_skipped_with_reason(tmp_path):
    out = _copy_release(tmp_path)
    lines = (out / "aoi_features.csv").read_text(encoding="utf-8").splitlines()
    header = lines[0].split(",")
    q = header.index("quality_status")
    row = next(i for i, line in enumerate(lines[1:], start=1) if line.startswith("SM_"))
    cells = lines[row].split(",")
    victim = cells[0]
    cells[q] = "fail"
    lines[row] = ",".join(cells)
    (out / "aoi_features.csv").write_text("\n".join(lines) + "\n", encoding="utf-8")
    snap = load_geo_snapshot(out, PILOT)
    assert {"id": victim, "reason": "quality_status fail"} in snap.skipped
    assert victim not in {t["id"] for t in snap.candidates}


def test_incompatible_units_are_rejected(tmp_path):
    out = _copy_release(tmp_path)
    columns = json.loads((out / "aoi_features.columns.json").read_text(encoding="utf-8"))
    columns["columns"]["relief_m"]["unit"] = "km"
    (out / "aoi_features.columns.json").write_text(json.dumps(columns), encoding="utf-8")
    with pytest.raises(ContractError, match="relief_m"):
        load_geo_snapshot(out, PILOT)


def test_documents_validate_with_groups_and_context():
    snap = load_geo_snapshot(GEO, PILOT, limit=30)
    docs = build_documents(snap, {"stability_draws": 10}, created_at="2026-11-14T00:00:00+00:00")
    assert len(docs) == 9
    for doc in docs:
        validate_document(doc)
        assert doc["dataset"]["kind"] == "geo"
        for c in doc["candidates"]:
            assert c["group_id"] and c["group_id"].startswith("EARTH_")
            assert c["explanation"]["context"]["environment"]["evidence"] == "modelled"
            assert c["explanation"]["context"]["geology"]["evidence"] == "proxy"
            assert c["components"]["geological_similarity"]["status"] == "not_available"
