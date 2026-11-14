"""Planetary Transferability Dossier (Markdown) rendered from the ATLAS-Pi bundle.

The same structure is rendered by the web workspace; both read only computed values.
"""

from __future__ import annotations


def _f(x, nd=2):
    return "—" if x is None else f"{x:.{nd}f}"


def render(doc: dict, site: str, target: str, mission_id: str | None = None) -> str:
    cells = [c for c in doc["tensor"]["cells"] if c["site"] == site and c["target"] == target]
    if not cells:
        raise SystemExit(f"No cells for {site} -> {target}")
    srow = next(s for s in doc["sites"] if s["id"] == site)
    trow = next(t for t in doc["targets"] if t["id"] == target)
    mission = mission_id or next(m["id"] for m in doc["registry"]["tasks"]["missions"] if m["target"] == target)
    con = doc["constellations"][mission]["3"]
    plan = doc["planner"][mission]
    review = next((r for r in doc["redteam"][mission] if r["site"] == site), None)
    L = [f"# Planetary Transferability Dossier — {srow['name'] or site} → {trow['name']}", "",
         f"Engine `{doc['engine']}` · bundle content SHA-256 `{doc['content_sha256'][:16]}…` · synthetic: {doc['synthetic']}", "",
         "## Research question", "",
         f"Which mission operations planned for **{trow['name']}** can be rehearsed at **{srow['name'] or site}** "
         f"({srow['country']}, {srow['lat']:.3f}, {srow['lon']:.3f}), under what corrections, with what uncertainty?", "",
         "## Methods", "",
         "Measured 200 m terrain grids are compared at 200/400/800 m cells (Wasserstein-1 between slope and roughness distributions, relief and traversable fraction), "
         "with a 4 km spatial block bootstrap (200 replicates) for 90% intervals. Factor matches use exp(-z²/2) in declared tolerance units; "
         "statuses follow the documented rules (similarity, evidence coverage, evidence quality, resolution and physics kept separate).", "",
         "## Operational Transferability (per task)", "",
         "| Task | Status | Task match (90% CI) | Evidence coverage | Evidence quality | Reasons |", "|---|---|---|---|---|---|"]
    for c in sorted(cells, key=lambda c: c["task"]):
        a = c["axes"]
        ci = a["task_match_ci90"]
        partial = " (partial)" if a["evidence_coverage"] < 1 else ""
        L.append(f"| {c['task']} | **{c['status']}** | {_f(a['task_match'])}{partial} ({_f(ci[0]) if ci else '—'}–{_f(ci[1]) if ci else '—'}) | "
                 f"{a['evidence_coverage']:.0%} | {_f(a['evidence_quality'])} | {', '.join(c['reasons']) or '—'} |")
    L += ["", "## Factor evidence", ""]
    factors = {}
    for c in cells:
        for f in c["factors"]:
            factors.setdefault(f["factor"], f)
    L += ["| Factor | Earth | Target | Match | 90% CI | Kind |", "|---|---|---|---|---|---|"]
    for f in factors.values():
        ev = f["earth"]["value"] if f["earth"] else None
        tv = f["target"]["value"] if f["target"] else None
        ci = f["ci"]
        L.append(f"| {f['name']} | {ev if not isinstance(ev, float) else round(ev, 3)} | {tv if not isinstance(tv, float) else round(tv, 3)} | "
                 f"{_f(f['match'])} | {(_f(ci[0]) + '–' + _f(ci[1])) if ci else '—'} | {f['kind']} |")
    L += ["", "## Physical mismatch (non-transferable factors)", ""]
    phys = {}
    for c in cells:
        for p in c["physics"]:
            phys.setdefault(p["factor"], p)
    for p in phys.values():
        L.append(f"- **{p['name']}** — reproducible in field: {p['reproducible_in_field']}; corrections: {', '.join(p['corrections']) or 'none'}; "
                 f"alternatives: {'; '.join(p['lab_alternatives'])}.")
    L += ["", "## Scientific red team", ""]
    if review:
        for key in ("A_supporting", "B_counter_evidence", "C_hidden_assumptions", "D_scale_mismatch", "E_physical_mismatch",
                    "F_alternative_explanation", "G_sensitivity", "H_next_evidence"):
            L.append(f"**{key.replace('_', ' ', 1)}**")
            L += [f"- {line}" for line in review[key]]
            L.append("")
    else:
        L.append("Not among the reviewed high-priority candidates for this mission.")
    L += ["", "## Complementary sites (analog constellation, K=3)", "",
          f"Selected: {', '.join(con['selected'])} — covers {con['covered']}/{len(con['per_requirement'])} field requirements "
          f"(top-3 individual: {con['baseline_topk_individual']['covered']}; top-3 by general similarity: {con['baseline_general_similarity']['covered']}).", "",
          "Lab-only tasks: " + "; ".join(f"{t['task']} ({', '.join(t['blocking'])})" for t in con["lab_only_tasks"]), "",
          "## Recommended next measurements (EVPI)", ""]
    for m in plan["measurements"][:5]:
        here = next((p for p in m["per_site"] if p["site"] == site), None)
        L.append(f"- **{m['name']}** — mission EVPI {m['evpi']:.4f} ({(m['evpi_relative'] or 0):.1%} of current value), "
                 f"decision-change probability {m['decision_change_probability']:.0%}" + (f"; at this site EVPI {here['evpi']:.4f}" if here else "") + ".")
    L += ["", "## Certificates", ""]
    for c in sorted(cells, key=lambda c: c["task"]):
        cert = doc["certificates"][c["certificate"]]
        L.append(f"- `{cert['id']}` — {cert['claim']}")
    L += ["", "## Limitations", ""] + [f"- {x}" for x in doc["limitations"]]
    L += ["", "## Reproducibility", "", "```", "python -m pipeline.analog_transfer build", "python -m pipeline.analog_transfer verify",
          f"python -m pipeline.analog_transfer dossier {site} {target}", "```", "",
          "Inputs (SHA-256):", ""] + [f"- {k}: `{v}`" for k, v in doc["inputs"].items()]
    return "\n".join(L) + "\n"
