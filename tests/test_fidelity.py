"""Equation and admission tests. Written with AI assistance (Codex); review pending."""

import math

import pytest

from pipeline.engine.fidelity import attribute_fidelity, light_fidelity, objective_fidelity


def spec(attr="bare_frac", fn="match", weight=1, **params):
    return {"attr": attr, "fn": fn, "params": params, "weight": weight,
            "needs_target": fn in {"match", "logmatch", "colder", "category"}, "priority": "P0"}


@pytest.mark.parametrize("value,expected", [(3, 1), (1, math.exp(-0.5)), (5, math.exp(-0.5))])
def test_match(value, expected):
    assert attribute_fidelity(spec(sigma=2), value, 3) == pytest.approx(expected)


def test_logmatch_ratio_symmetry_and_domain():
    s = spec(fn="logmatch", sigma=0.15)
    assert attribute_fidelity(s, 20, 10) == pytest.approx(attribute_fidelity(s, 5, 10))
    assert attribute_fidelity(s, 0, 10) is None
    assert attribute_fidelity(s, -1, 10) is None
    assert attribute_fidelity(s, 5, 5) == 1


def test_one_sided_thresholds_and_temperature():
    assert attribute_fidelity(spec(fn="at_most", a=50, tau=100), 0) == 1
    assert attribute_fidelity(spec(fn="at_most", a=50, tau=100), 150) == pytest.approx(math.exp(-0.5))
    assert attribute_fidelity(spec(fn="at_least", a=0.8, tau=0.2), 1) == 1
    assert attribute_fidelity(spec(fn="at_least", a=0.8, tau=0.2), 0.6) == pytest.approx(math.exp(-0.5))
    assert attribute_fidelity(spec(fn="colder", tau=30), -100, -50) == 1
    assert attribute_fidelity(spec(fn="colder", tau=30), -20, -50) == pytest.approx(math.exp(-0.5))
    assert attribute_fidelity({"fn": "impossible"}, None) == 0


def test_category_and_missing_and_bad_params():
    category = {"fn": "category", "matrix": {"basalt": {"tephra": 0.7}}}
    assert attribute_fidelity(category, "basalt", "tephra") == 0.7
    assert attribute_fidelity(category, "unknown", "tephra") is None
    assert attribute_fidelity(spec(sigma=1), None, 3) is None
    assert attribute_fidelity(spec(sigma=1), float("nan"), 3) is None
    with pytest.raises(ValueError):
        attribute_fidelity(spec(sigma=0), 1, 1)
    with pytest.raises(ValueError):
        attribute_fidelity({"fn": "unregistered"}, 1, 1)


def test_geometric_mean_and_zero_floor():
    objective = {"attributes": [spec("a", sigma=1, weight=3), spec("b", sigma=1, weight=1)]}
    cell = objective_fidelity(objective, {"a": 0, "b": 1}, {"a": 0, "b": 0})
    assert cell["F"] == pytest.approx(math.exp(-0.5 / 4))
    assert not cell["partial"]
    cell = objective_fidelity(objective, {"a": 100, "b": 0}, {"a": 0, "b": 0})
    assert cell["F"] == pytest.approx(1e-6 ** 0.75)


def test_missing_weight_boundary_and_context_constraints():
    objective = {"attributes": [spec("a", sigma=1, weight=7), spec("b", sigma=1, weight=3)],
                 "constraints": [{"attr": "water_frac", "op": "<=", "value": 0.5}]}
    cell = objective_fidelity(objective, {"a": 0}, {"a": 0, "b": 0})
    assert cell["F"] == 1 and cell["partial"]
    assert cell["parts"]["b"] is None
    assert objective_fidelity(objective, {"b": 0}, {"a": 0, "b": 0}) == {"F": None, "reason": "missing"}
    assert objective_fidelity(objective, {"a": 0, "b": 0}, {"a": 0, "b": 0},
                              {"context": {"water_frac": 0.51}}) == {"F": None, "reason": "constraint"}


def test_monthly_light_uses_same_month_and_snow_and_lexical_tie():
    h = [0] * 12
    az = [0] * 12
    h[2], az[2] = 6, 270
    h[3], az[3] = 6, 270
    score, month = light_fidelity({"hours_low": h, "sweep_deg": az})
    assert (score, month) == (1, 3)
    snow = [1] * 12
    snow[2] = 0
    assert light_fidelity({"hours_low": h, "sweep_deg": az}, snow) == (1, 4)
    assert light_fidelity(None) == (None, None)


def test_optional_shadow_never_disables_p0_light():
    light = spec("light", fn="light", weight=3)
    shadow = dict(spec("shadow", fn="match", weight=2, sigma=0.1), priority="P1")
    result = objective_fidelity({"attributes": [light, shadow]}, {}, {}, {"light": 0.8})
    assert result["F"] == pytest.approx(0.8)
    assert result["partial"] and result["parts"]["shadow"] is None


def test_incomplete_monthly_snow_keeps_best_known_month_and_marks_partial():
    objective = {"attributes": [spec("light", fn="light")], "constraints": [
        {"attr": "snow_free_frac", "op": ">=", "value": 0.5}]}
    light = {"hours_low": [6] * 12, "sweep_deg": [270] * 12}
    complete = objective_fidelity(objective, {}, {}, {"light": light, "snow_free_frac": [1] * 12})
    assert complete["F"] == 1 and not complete["partial"] and complete["best_month"] == 1
    partial = objective_fidelity(objective, {}, {}, {"light": light, "snow_free_frac": [None] + [1] * 11})
    assert partial["F"] == 1 and partial["partial"] and partial["best_month"] == 2
