"""Scientific Red Team: deterministic adversarial review of high-priority candidates.

Uses only tensor cells, physical-factor records, sensitivity results and planner
output. No generative model is involved, so nothing here can invent data or citations.
"""

from __future__ import annotations


def review(site: str, target: str, cells: list[dict], stability: dict, plan: dict | None,
           sensitivity: dict | None, site_name: str) -> dict:
    mine = [c for c in cells if c["site"] == site and c["target"] == target]
    transferable = [c for c in mine if c["status"] in ("SUPPORTED", "CONDITIONAL")]
    support = []
    for c in sorted(transferable, key=lambda c: -(c["axes"]["task_match"] or 0))[:3]:
        top = max((f for f in c["factors"] if f["match"] is not None), key=lambda f: f["match"] * f["weight"])
        support.append(f"{c['task']}: {c['status']} with task match {c['axes']['task_match']:.2f}; "
                       f"strongest factor {top['name']} ({top['match']:.2f}, {top['kind']}).")
    counter = []
    for c in mine:
        for line in c["counter_evidence"]:
            if "differs by more than two tolerances" in line or "convergent" in line or "across 200-800 m" in line:
                counter.append(f"{c['task']}: {line}")
    counter = sorted(set(counter))[:8]
    assumptions = sorted({f"{f['name']}: {side['source']}" for c in mine for f in c["factors"]
                          for side in (f["earth"], f["target"]) if side and side.get("kind") in ("assumed", "curated")
                          and (side.get("grade") in (None, "C", "D"))})
    missing = sorted({f["name"] for c in mine for f in c["factors"] if f["match"] is None})
    scale = []
    for c in mine:
        if "RESOLUTION" in c["reasons"]:
            scale.append(f"{c['task']}: {', '.join(c['axes']['resolution_limited_factors'])} coarser than required.")
    if target == "MARS_JEZERO":
        scale.append("Jezero DEM is a 200 m blended MOLA/HRSC grid; effective resolution can be coarser than its nominal spacing.")
    physical = sorted({f"{p['name']} ({'not' if p['reproducible_in_field'] == 'no' else 'partially'} reproducible)"
                       for c in mine for p in c["physics"] if p["reproducible_in_field"] != "yes"})
    alt = []
    proc = next((f for c in mine for f in c["factors"] if f["factor"] == "process" and f["match"] is not None), None)
    if proc and not proc["detail"].get("shared_tags"):
        alt.append(f"Site process tags {proc['earth']['value']} share nothing with target tags {proc['target']['value']}: "
                   "terrain statistics can converge from unrelated processes (e.g. erosion vs impact cratering).")
    if proc and proc["earth"]["grade"] in ("C", "D"):
        alt.append(f"Site process context is grade {proc['earth']['grade']} (unverified); the geological premise itself may be wrong.")
    unstable = [k.split("|")[2] for k, v in stability.items() if k.startswith(f"{site}|{target}|") and not v["stable"]]
    sens = []
    if unstable:
        sens.append(f"Status changes when declared tolerances are halved or doubled for: {', '.join(sorted(unstable))}.")
    if sensitivity:
        freq = sensitivity["dirichlet"]["selection_frequency"].get(site)
        if freq is not None:
            sens.append(f"Selected in {freq:.0%} of {sensitivity['dirichlet']['draws']} random mission-priority draws.")
    nxt = []
    if plan:
        for m in plan["measurements"]:
            hit = next((p for p in m["per_site"] if p["site"] == site), None)
            if hit and hit["evpi"] > 0:
                nxt.append(f"{m['name']} (site EVPI {hit['evpi']:.4f}, decision-change probability {hit['decision_change_probability']:.0%}).")
        nxt = nxt[:3]
    if not nxt and missing:
        nxt.append(f"Acquire missing evidence: {', '.join(missing)}.")
    return {
        "site": site, "site_name": site_name, "target": target,
        "A_supporting": support or ["No task reaches SUPPORTED or CONDITIONAL."],
        "B_counter_evidence": counter or ["No factor differs by more than two tolerances."],
        "C_hidden_assumptions": assumptions + ([f"Unmeasured and excluded from scoring: {', '.join(missing)}."] if missing else []),
        "D_scale_mismatch": scale or ["Compared at matched 200-800 m cells; metre-scale hazards remain unresolved."],
        "E_physical_mismatch": physical,
        "F_alternative_explanation": alt or ["Shared process tag; alternative explanations not assessed beyond tag level."],
        "G_sensitivity": sens or ["Status stable under tolerance x0.5 and x2."],
        "H_next_evidence": nxt or ["No measurement in the catalog changes this site's decision value."],
    }
