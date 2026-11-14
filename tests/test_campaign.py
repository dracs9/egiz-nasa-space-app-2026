"""Independent combinatorial oracle. Written with AI assistance (Codex); review pending."""

import math
from itertools import combinations

import numpy as np
import pytest

from pipeline.engine.campaign import design, exact_best, gap_ledger, greedy, shortlist


def oracle(F, W, k):
    def score(sites):
        return sum(W[j] * max(F[i, j] for i in sites) for j in range(F.shape[1])) / sum(W)
    choices = [(sites, score(sites)) for sites in combinations(range(F.shape[0]), k)]
    return min(choices, key=lambda item: (-item[1], item[0]))


def test_exact_100_random_tasks_against_independent_oracle_and_greedy_bound():
    rng = np.random.default_rng(2026)
    for _ in range(100):
        n, m, k = rng.integers(10, 26), rng.integers(3, 7), int(rng.integers(1, 4))
        F, W = rng.random((n, m)), rng.random(m)
        expected_sites, expected_score = oracle(F, W, k)
        sites, score = exact_best(F, W, np.arange(n), k)
        assert sites == expected_sites
        assert score == pytest.approx(expected_score, abs=1e-12)
        _, greedy_score = greedy(F, W, k)
        assert greedy_score + 1e-12 >= (1 - 1 / math.e) * score


def test_shortlist_bound_and_each_objective_winner():
    F = np.random.default_rng(42).random((3000, 5))
    U = shortlist(F, np.ones(5))
    assert len(U) <= 120
    assert set(np.argmax(F, axis=0)).issubset(set(U))


def test_ties_prefer_lexical_ids_and_fewer_sites():
    F = [[1, 1], [1, 1], [0, 0]]
    result = design(F, [1, 1], site_ids=["Z", "A", "B"], objective_ids=["O1", "O2"])
    assert all(item["coverage"] == 1 for item in result)
    assert all(item["sites"] == [{"id": "A", "roles": ["O1", "O2"], "best_month": None}] for item in result)
    assert exact_best(F, [1, 1], np.arange(3), 2)[0] == (0, 1)
    assert greedy(F, [1, 1], 3)[0] == [0, 1, 2]


def test_complementary_roles_zero_weight_and_null():
    result = design([[1, None, 0], [0, 1, 1], [0.5, 0.5, 1]], [1, 1, 0],
                    site_ids=["A", "B", "C"], objective_ids=["O1", "O2", "O3"])
    assert result[1]["coverage"] == 1
    assert [s["roles"] for s in result[1]["sites"]] == [["O1"], ["O2"]]
    assert result[1]["per_objective"][2]["site"] is None


def test_selected_site_measurement_zero_stays_distinct_from_unknown():
    # Input order differs from lexical selection order, exercising mask reorder.
    result = design([[0.9, 0, None, 0.6], [1, 0, None, 0.5]], [1, 1, 1, 0],
                    site_ids=["Z", "A"], objective_ids=["POSITIVE", "ZERO", "UNKNOWN", "OFF"])[0]
    assert result["sites"] == [{"id": "A", "roles": ["POSITIVE"], "best_month": None}]
    assert result["per_objective"] == [
        {"objective": "POSITIVE", "site": "A", "F": 1},
        {"objective": "ZERO", "site": None, "F": 0},
        {"objective": "UNKNOWN", "site": None, "F": None},
        {"objective": "OFF", "site": None, "F": 0.5},
    ]
    assert result["coverage"] == pytest.approx(1 / 3)


def test_design_merges_global_greedy_if_shortlist_incomplete():
    # per_objective=1 removes the complement D, though greedy can use it.
    F = np.array([[1, 0.2, 0.2], [0.2, 1, 0.2], [0.2, 0.2, 1], [0.8, 0.8, 0],
                  [0.0, 0.85, 0.85]])
    result = design(F, [1, 1, 1], per_objective=1)
    for item in result:
        assert item["coverage"] + 1e-9 >= item["method"]["greedy_coverage"]
    # Separate forced shortlist proves the merge branch, independently of
    # the ranking particulars of the natural shortlist above.
    from unittest.mock import patch
    with patch("pipeline.engine.campaign.shortlist", return_value=np.array([0, 1, 2])):
        merged = design([[0.1], [0.2], [0.3], [1]], [1], k_max=1)
    assert merged[0]["method"]["merged_greedy"]
    assert merged[0]["coverage"] == 1


def test_gap_ceiling_missing_not_zero_and_physical_always_present():
    physical = [{"gap": "gravity", "alternative": "parabolic flight", "source": "SOURCE"}]
    result = gap_ledger({"O1": {"A": {"cold": 0.05, "unknown": None}, "B": {"cold": 0.01}}},
                        {"O1": {"A": {"F": 0.1}, "B": {"F": None}}}, physical)
    assert result["attribute"] == [{"objective": "O1", "attr": "cold", "ceiling": 0.05}]
    assert result["physical"] == physical
    assert result["objective_ceiling"] == {"O1": 0.1}


@pytest.mark.parametrize("F,W,U,k", [([[1]], [0], [0], 1), ([[2]], [1], [0], 1),
                                        ([[1]], [1], [2], 1), ([[1]], [1], [0], 2)])
def test_invalid_optimizer_input(F, W, U, k):
    with pytest.raises(ValueError):
        exact_best(F, W, np.array(U), k)
