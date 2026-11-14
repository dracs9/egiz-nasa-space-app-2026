"""Attribute and objective fidelity from MATHEMATICAL_SPECIFICATION §§5–7.

Written with AI assistance (Codex); human review pending.
"""

from __future__ import annotations

import math
from numbers import Real

FUNCTIONS = {"match", "logmatch", "at_most", "at_least", "colder", "category", "light", "impossible"}


def _number(value):
    return isinstance(value, Real) and not isinstance(value, bool) and math.isfinite(value)


def _positive(params, name):
    value = params.get(name)
    if not _number(value) or value <= 0:
        raise ValueError(f"{name} must be positive and finite")
    return float(value)


def attribute_fidelity(spec: dict, x_e, x_t=None) -> float | None:
    """Return one fidelity in [0,1]; missing or nonfinite measurements are null.

    Nonpositive values have no real logarithm and are missing for logmatch.
    The impossible function is reserved for the gap ledger, outside coverage.
    """
    fn = spec.get("fn", spec.get("type"))
    if fn not in FUNCTIONS:
        raise ValueError(f"Unknown fidelity function: {fn!r}")
    params = spec.get("params", {})
    if fn == "impossible":
        return 0.0
    needs_target = spec.get("needs_target", fn in {"match", "logmatch", "colder", "category"})
    if x_e is None or (needs_target and x_t is None):
        return None
    if fn == "category":
        matrix = params.get("matrix", spec.get("matrix", {}))
        result = matrix.get(str(x_e), {}).get(str(x_t))
        if result is None:
            return None
        if not _number(result) or not 0 <= result <= 1:
            raise ValueError("Category fidelity matrix entries must be in [0,1]")
        return float(result)
    if not _number(x_e) or (needs_target and not _number(x_t)):
        return None
    if fn == "light":
        if not 0 <= x_e <= 1:
            raise ValueError("Precomputed light fidelity must be in [0,1]")
        return float(x_e)
    if fn in {"match", "logmatch"}:
        sigma = _positive(params, "sigma")
        if not _number(x_t):
            return None
        if fn == "logmatch":
            if x_e <= 0 or x_t <= 0:
                return None
            delta = (math.log10(x_e) - math.log10(x_t)) / sigma
        else:
            delta = (x_e - x_t) / sigma
    else:
        tau = _positive(params, "tau")
        threshold = x_t if fn == "colder" else params.get("a")
        if not _number(threshold):
            raise ValueError("Threshold a (or target for colder) must be finite")
        delta = max(0.0, threshold - x_e if fn == "at_least" else x_e - threshold) / tau
    return math.exp(-0.5 * delta * delta)


def light_fidelity(light: dict | float | None, snow_free=None, params=None) -> tuple[float | None, int | None]:
    """Evaluate monthly low-sun opportunities; best month is one-based.

    Missing snow is explicitly permitted for P0 (snow not modelled). If supplied,
    unknown snow months cannot win over a known month.
    """
    params = params or {}
    if light is None:
        return None, None
    if _number(light):
        return attribute_fidelity({"fn": "light", "needs_target": False}, light), None
    if "F" in light:
        return light_fidelity(light["F"])[0], light.get("best_month")
    hours = light.get("hours_low", light.get("hours"))
    sweep = light.get("sweep_deg", light.get("sweep"))
    if hours is None or sweep is None or len(hours) != 12 or len(sweep) != 12:
        return None, None
    if snow_free is not None and len(snow_free) != 12:
        raise ValueError("snow_free_frac must have exactly 12 months")
    scores = []
    for m, (h, az) in enumerate(zip(hours, sweep)):
        fh = attribute_fidelity({"fn": "at_least", "params": {"a": params.get("hours_a", 6), "tau": params.get("hours_tau", 3)}}, h)
        fa = attribute_fidelity({"fn": "at_least", "params": {"a": params.get("sweep_a", 270), "tau": params.get("sweep_tau", 90)}}, az)
        snow = 1.0 if snow_free is None else snow_free[m]
        if fh is None or fa is None or not _number(snow):
            scores.append(None)
        elif not 0 <= snow <= 1:
            raise ValueError("snow_free_frac must be in [0,1]")
        else:
            scores.append(math.sqrt(fh * fa) * snow)
    known = [(score, m + 1) for m, score in enumerate(scores) if score is not None]
    if not known:
        return None, None
    score, month = max(known, key=lambda item: (item[0], -item[1]))
    return score, month


def _lookup(key, attrs, extra):
    if key in attrs:
        return attrs[key]
    if key in extra:
        return extra[key]
    return extra.get("context", {}).get(key)


def objective_fidelity(objective: dict, attrs_e: dict, attrs_t: dict, extra: dict | None = None) -> dict:
    """Compute the weighted geometric mean with explicit missingness/admission.

    ``extra`` holds context fractions, optional monthly light, shadow fidelity,
    and snow_free_frac. Unknown context is not asserted to pass a constraint;
    dataset builders must list missing context for the UI to disclose it.
    """
    extra = extra or {}
    context_missing = False
    for constraint in objective.get("constraints", []):
        value = _lookup(constraint["attr"], attrs_e, extra)
        if isinstance(value, (list, tuple)):
            value = max((v for v in value if _number(v)), default=None)
        if not _number(value):
            context_missing = True
            continue
        op = constraint["op"]
        if op not in {"<=", ">="}:
            raise ValueError(f"Unsupported constraint operator: {op}")
        if (op == "<=" and value > constraint["value"]) or (op == ">=" and value < constraint["value"]):
            return {"F": None, "reason": "constraint"}
    attributes = objective.get("attributes", [])
    if not attributes:
        raise ValueError("An objective must contain at least one attribute")
    parts = {}
    total = known = log_sum = 0.0
    optional_missing = context_missing
    best_month = None
    for spec in attributes:
        weight = spec.get("weight", 1)
        if not _number(weight) or weight <= 0:
            raise ValueError("Attribute weight must be positive and finite")
        attr = spec["attr"]
        if attr in parts:
            raise ValueError(f"Duplicate objective attribute: {attr}")
        if attr == "light":
            part, best_month = light_fidelity(extra.get("light"), extra.get("snow_free_frac"), spec.get("params"))
            snow_free = extra.get("snow_free_frac")
            if snow_free is None or any(not _number(value) for value in snow_free):
                optional_missing = True
        elif attr == "shadow":
            shadow = extra.get("shadow")
            if isinstance(shadow, dict):
                delta = shadow.get("mean_abs_difference")
                part = attribute_fidelity({"fn": "match", "params": {"sigma": spec.get("params", {}).get("sigma", 0.1)}}, delta, 0)
            else:
                part = attribute_fidelity({"fn": "light", "needs_target": False}, shadow)
        else:
            part = attribute_fidelity(spec, _lookup(attr, attrs_e, extra), attrs_t.get(attr))
        parts[attr] = part
        # §5.4 explicitly permits the light objective without P1 shadows.
        if attr == "shadow" and part is None and spec.get("priority") == "P1":
            optional_missing = True
            continue
        total += weight
        if part is not None:
            known += weight
            log_sum += weight * math.log(max(part, 1e-6))
    missing_weight_max = objective.get("missing_weight_max", extra.get("missing_weight_max", 0.3))
    if known == 0 or (total - known) / total > missing_weight_max + 1e-12:
        return {"F": None, "reason": "missing"}
    result = {"F": math.exp(log_sum / known), "partial": known < total or optional_missing, "parts": parts}
    if best_month is not None:
        result["best_month"] = best_month
    return result
