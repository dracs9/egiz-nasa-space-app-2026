# Written with AI assistance (Codex); human review pending.
import json

import pytest

from pipeline.earth.acquire import AcquisitionAdapters, acquire


def _adapters(calls, *, bad_stage=None):
    metadata = [
        {"id": "GL_TEST", "lon": 10., "lat": 40., "pool": "global", "stratum": "other_open"},
        {"id": "CT_FOREST_TEST", "lon": 10., "lat": 60., "pool": "control", "stratum": None},
    ]
    features = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [m["lon"], m["lat"]]},
                 "properties": m} for m in metadata]

    def pool(**kwargs):
        calls.append(("pool", kwargs))
        return {"type": "FeatureCollection", "features": features}

    def stage(name, attrs=None, context=None, snow=None):
        def run(items, **kwargs):
            calls.append((name, kwargs))
            assert [f["properties"]["id"] for f in items] == [m["id"] for m in metadata]
            rows = [{"id": m["id"], "attrs": attrs or {}, "context": context or {}} for m in metadata]
            if snow is not None:
                for row in rows:
                    row["snow_free_frac"] = snow
            if bad_stage == name:
                rows[0]["id"] = "GL_UNKNOWN"
            return rows
        return run

    return AcquisitionAdapters(pool=pool, terrain_a=stage("terrain_a", {"relief_m": 300, "tri_f400_m": 2}),
                               terrain_b=stage("terrain_b", {"tri_f100_m": 1}),
                               environment=stage("environment", {"t_min_c": -20, "precip_mm": 30, "bare_frac": .8},
                                                 {"water_frac": 0, "built_frac": 0}),
                               snow=stage("snow", snow=[.9]*12))


def test_acquisition_merges_stages_and_keeps_controls_outside_global_pool(tmp_path):
    calls = []
    path = acquire(project="unit-test-project", count_per_stratum=2, out_dir=tmp_path,
                   include_snow=True, adapters=_adapters(calls))
    data = json.loads(path.read_text())
    assert [name for name, _ in calls] == ["pool", "terrain_a", "terrain_b", "environment", "snow"]
    assert calls[0][1]["n_per_stratum"] == {"hot_desert": 2, "cold_polar": 2, "other_open": 2}
    assert all(args["project"] == "unit-test-project" for _, args in calls)
    tiles = {row["id"]: row for row in data["tiles"]}
    assert tiles["CT_FOREST_TEST"]["pool"] == "control"
    assert tiles["GL_TEST"]["attrs"]["tri_f400_m"] == 2
    assert tiles["GL_TEST"]["attrs"]["tri_f100_m"] == 1
    assert tiles["GL_TEST"]["attrs"]["precip_mm"] == 30
    assert tiles["GL_TEST"]["context"]["water_frac"] == 0
    assert tiles["GL_TEST"]["snow_free_frac"] == [.9]*12
    assert "t_max_c" in tiles["GL_TEST"]["missing"]
    assert data["synthetic"] is False  # adapter boundary test only; temp output is never shipped


def test_mismatched_stage_ids_do_not_replace_existing_artifact(tmp_path):
    previous = tmp_path/"earth_candidates.json"
    previous.write_text("existing user file")
    with pytest.raises(ValueError, match="tile IDs do not match pool"):
        acquire(project="unit-test-project", out_dir=tmp_path,
                adapters=_adapters([], bad_stage="terrain_b"))
    assert previous.read_text() == "existing user file"


def test_no_project_fails_before_any_adapter_or_filesystem_mutation(tmp_path, monkeypatch):
    monkeypatch.delenv("EE_PROJECT", raising=False)
    calls = []
    destination = tmp_path/"must_not_exist"
    with pytest.raises(RuntimeError, match="EE_PROJECT"):
        acquire(out_dir=destination, adapters=_adapters(calls))
    assert calls == []
    assert not destination.exists()
