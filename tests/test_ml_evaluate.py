"""Stage 2 evaluation: statistics, decision rule and freeze guard.

Only synthetic reference tiles (FAKE_) are scored here; real reference AOIs
are never ranked by tests, so no reference rank is seen before the freeze.

Written with AI assistance (Claude Code); human review pending.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from pipeline.ml import evaluate as ev
from pipeline.ml.loader import load_snapshot

ROOT = Path(__file__).resolve().parents[1]


def test_percentile_rank_with_ties_and_ineligible_reference():
    assert ev.percentile_rank(0.5, [0.9, 0.5, 0.1, None])["pct"] == pytest.approx(100 * 1.5 / 3)
    out = ev.percentile_rank(None, [0.9, 0.1])
    assert out["pct"] == 100.0 and out["ref_eligible"] is False
    assert ev.percentile_rank(0.5, [None])["pct"] is None


def test_binomial_tail_and_random_baseline():
    assert ev.binomial_tail(0, 5, 0.1) == pytest.approx(1.0)
    assert ev.binomial_tail(5, 5, 0.1) == pytest.approx(1e-5)
    assert ev.random_baseline_p(50.0, 15, n_sim=4000) == pytest.approx(0.5, abs=0.05)
    assert ev.random_baseline_p(5.0, 15, n_sim=4000) < 0.001


def test_bootstrap_resamples_sites_not_pairs():
    lo, hi = ev.clustered_bootstrap_median([10, 10, 10, 90], ["A", "A", "A", "B"], n_boot=2000)
    assert lo == 10 and hi == 90  # site A's three pairs move together


def _summary(median, ci, n=10):
    return {"n_pairs": n, "median_pct": median, "ci95_median_pct": ci}


def test_verdict_rules():
    assert ev.verdict(_summary(8, [3, 15]), _summary(30, [20, 40])) == "confirmed"
    assert ev.verdict(_summary(8, [3, 15]), _summary(5, [2, 9])) == "not_confirmed"  # not better than dryness
    assert ev.verdict(_summary(35, [25, 50]), _summary(40, [30, 50])) == "not_confirmed"
    assert ev.verdict(_summary(15, [5, 30]), _summary(40, [30, 50])) == "inconclusive"  # CI spans 20 %
    assert ev.verdict(_summary(5, [1, 9], n=7), _summary(50, [40, 60], n=7)) == "inconclusive"  # < 8 pairs


def test_analysis_members_follow_preregistration():
    pairs = [ev.Pair("A", "O2", "moon", "A", "feature", True), ev.Pair("B", "O2", "moon", "C", "feature", False),
             ev.Pair("C", "M2", "mars", "B", "area", False), ev.Pair("D", "O3", "moon", "A", "point", False)]
    m = ev.analysis_members(pairs)
    assert [p.site_id for p in m["P1"]] == ["A", "D"]
    assert len(m["S1"]) == 4
    assert [p.site_id for p in m["S4"]] == ["D"]


def test_real_reference_pairs_counts():
    pairs = ev.load_pairs(ROOT / "data/ml/reference/reference_sites-0.1.0.csv")
    m = ev.analysis_members(pairs)
    assert len(m["P1"]) == 14 and len(m["S4"]) == 3


def test_freeze_guard(tmp_path):
    with pytest.raises(ev.NotFrozen, match="not frozen"):
        ev.check_freeze(ROOT, tmp_path / "FREEZE.json")
    record = {"sha256": {name: ev.sha256_file(ROOT / name) for name in ev.FROZEN_FILES}, "reviewed_by": "test"}
    (tmp_path / "FREEZE.json").write_text(json.dumps(record), encoding="utf-8")
    assert ev.check_freeze(ROOT, tmp_path / "FREEZE.json")["reviewed_by"] == "test"
    record["sha256"][ev.FROZEN_FILES[0]] = "0" * 64
    (tmp_path / "FREEZE.json").write_text(json.dumps(record), encoding="utf-8")
    with pytest.raises(ev.NotFrozen, match="changed after the freeze"):
        ev.check_freeze(ROOT, tmp_path / "FREEZE.json")


def test_cli_refuses_without_freeze(tmp_path, capsys):
    from pipeline.ml.__main__ import main

    code = main(["evaluate", "--freeze", str(tmp_path / "missing.json"), "--out", str(tmp_path / "x.json")])
    assert code == 3 and "refused" in capsys.readouterr().err
    assert not (tmp_path / "x.json").exists()


def test_synthetic_reference_is_ranked_and_overlap_removed():
    pool = load_snapshot(ROOT / "data/pilot")
    target = pool.targets["MOON_MONS_MOUTON"]
    objective = next(o for t in pool.templates.values() for o in t["objectives"] if o["id"] == "O2")
    clone = copy.deepcopy(next(t for t in pool.candidates if t["id"] == "PILOT_UTAH"))
    clone["id"] = "FAKE_REF"
    out = ev.score_pair(pool, clone, target, objective, "full")
    assert out["pool_removed_overlap"] == 1  # PILOT_UTAH itself sits on the reference centre
    assert out["pct"] is not None and 0 <= out["pct"] <= 100
    dry = ev.score_pair(pool, clone, target, objective, "dryness")
    assert dry["pct"] is None and dry["n_eligible"] == 0  # pilot has no IMERG precip: missing, not zero
    for tile in pool.candidates:
        tile["attrs"]["precip_mm"] = 300.0
    clone["attrs"]["precip_mm"] = 10.0
    dry = ev.score_pair(pool, clone, target, objective, "dryness")
    # same eligible set as the objective: its constraints still apply (KZ coastal window, water 96 %, is out)
    assert dry["n_eligible"] == len(pool.candidates) - 2 and dry["n_better"] == 0
