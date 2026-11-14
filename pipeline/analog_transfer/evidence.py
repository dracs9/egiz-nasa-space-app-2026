"""Evidence graph: dataset -> derived feature -> comparison -> claim.

Every claim node can be traced back to the source files (with SHA-256 where the
provider file was cached), the processing method and the curated or reference
sources that entered the assessment. Provenance fields that the provider does not
supply are omitted rather than invented.
"""

from __future__ import annotations

FEATURE_METHOD = {
    "slope_dist": "features.slope_deg on block-mean 200/400/800 m grids; quantile functions (512)",
    "traversable": "fraction of 200 m cells with central-difference slope < 15 deg",
    "roughness": "features.roughness_log10: 3x3 least-squares plane residual std",
    "relief": "P95-P5 elevation of valid 200 m cells",
    "fine_slope": "existing EGIZ attribute at the target fine baseline (pipeline.common.terrain)",
    "surface_cover": "ESA WorldCover fractions (pipeline.earth.public_cover)",
    "process": "curated process tags (config/site_context.json)",
    "illumination_geometry": "Moon: EGIZ light fidelity (NOAA); Mars: SPICE daylight elevation distribution",
    "irradiance": "CF_SOLAR on SPICE solar geometry",
    "thermal": "attrs.t_min_c",
    "aridity": "attrs.precip_mm",
}
GRID_FACTORS = {"slope_dist", "traversable", "roughness", "relief", "fine_slope"}


class Graph:
    def __init__(self):
        self.nodes: dict[str, dict] = {}
        self.edges: set[tuple[str, str, str]] = set()

    def node(self, node_id: str, **attrs) -> str:
        self.nodes.setdefault(node_id, {"id": node_id, **attrs})
        return node_id

    def edge(self, a: str, b: str, rel: str) -> None:
        self.edges.add((a, b, rel))

    def upstream(self, node_id: str) -> list[str]:
        seen, stack = set(), [node_id]
        while stack:
            cur = stack.pop()
            for a, b, _ in self.edges:
                if b == cur and a not in seen:
                    seen.add(a)
                    stack.append(a)
        return sorted(seen)

    def to_json(self) -> dict:
        return {"nodes": sorted(self.nodes.values(), key=lambda n: n["id"]),
                "edges": [{"from": a, "to": b, "rel": r} for a, b, r in sorted(self.edges)]}


def build_graph(terrain_entries: list[dict], landcover: dict, solar: dict | None, registry,
                cells: list[dict]) -> Graph:
    g = Graph()
    dem = {}
    for e in terrain_entries:
        src = e["source"]
        ds = g.node(f"DS:{src['sha256'][:12]}", type="dataset", label=src["url"].rsplit("/", 1)[-1],
                    url=src["url"], sha256=src["sha256"], native_pixel_m=e.get("source_pixel_m"),
                    crs=src.get("native_crs"), body=e["body"])
        dem[e["id"]] = ds
    cover = {}
    for w in landcover.get("windows", []):
        cover[w["id"]] = g.node(f"DS:{w['sha256'][:12]}", type="dataset", label=w["url"].rsplit("/", 1)[-1],
                                url=w["url"], sha256=w["sha256"], native_pixel_m=w.get("pixel_m"),
                                license=landcover.get("license"), citation=landcover.get("citation"))
    spice_ids = []
    if solar:
        for k in solar["kernels"]:
            spice_ids.append(g.node(f"DS:{k['sha256'][:12]}", type="dataset", label=k["name"], url=k["url"],
                                    sha256=k["sha256"], provider="NASA NAIF"))
    for key, text in registry.physical["references"].items():
        g.node(f"REF:{key}", type="reference", label=key, citation=text)
    for sid, ctx in {**registry.context["sites"], **registry.context["targets"]}.items():
        g.node(f"LIT:{sid}", type="curated", label=f"process context {sid}", grade=ctx["grade"], citation=ctx["source"])

    def feature(entity: str, factor: str) -> str:
        fid = g.node(f"FT:{entity}:{factor}", type="feature", label=f"{factor} @ {entity}", method=FEATURE_METHOD[factor])
        if factor in GRID_FACTORS and entity in dem:
            g.edge(dem[entity], fid, "derived_from")
        if factor == "surface_cover" and entity in cover:
            g.edge(cover[entity], fid, "derived_from")
        if factor in ("illumination_geometry", "irradiance"):
            for k in spice_ids:
                g.edge(k, fid, "derived_from")
        if factor == "process":
            g.edge(f"LIT:{entity}", fid, "asserted_by")
        return fid

    for c in cells:
        claim = g.node(f"CLM:{c['site']}|{c['target']}|{c['task']}", type="claim", status=c["status"],
                       label=f"{c['task']} {c['site']} -> {c['target']}")
        for f in c["factors"]:
            cmp_id = g.node(f"CMP:{c['site']}|{c['target']}|{f['factor']}", type="comparison",
                            label=f"{f['factor']} {c['site']} vs {c['target']}", match=f["match"], kind=f["kind"])
            if f["match"] is not None:
                g.edge(feature(c["site"], f["factor"]), cmp_id, "input")
                g.edge(feature(c["target"], f["factor"]), cmp_id, "input")
            g.edge(cmp_id, claim, "supports" if (f["match"] or 0) >= 0.6065 else "weakens" if f["match"] is not None else "missing")
        for p in c["physics"]:
            pid = g.node(f"PHY:{p['factor']}", type="physical_factor", label=p["name"], reproducible=p["reproducible_in_field"])
            g.edge(pid, claim, "constrains")
        if c["status"] in ("NON_TRANSFERABLE",) and "PHYSICS_PRIMARY" in c["reasons"]:
            for ref in ("WONG_2012", "NIKSIRAT_2020", "DACA_2022"):
                if any(p["factor"] in ("gravity", "regolith_mechanics") for p in c["physics"]):
                    g.edge(f"REF:{ref}", claim, "cites")
    return g


def evidence_for(g: Graph, cell: dict) -> list[str]:
    return [n for n in g.upstream(f"CLM:{cell['site']}|{cell['target']}|{cell['task']}")
            if n.split(":", 1)[0] in ("DS", "REF", "LIT", "CMP")]
