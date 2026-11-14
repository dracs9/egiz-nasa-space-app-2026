"""ATLAS-Pi command line.

python -m pipeline.analog_transfer build [--draws 150] [--boot 200] [--no-eval] [--solar-rebuild]
python -m pipeline.analog_transfer dossier SITE TARGET [--mission ID] > dossier.md
python -m pipeline.analog_transfer counterfactual moon --mass 900 --phi 35 --cohesion 0
python -m pipeline.analog_transfer verify            # rebuild and compare content hash
"""

from __future__ import annotations

import argparse
import json
import sys

from . import counterfactual
from .build import PILOT, build
from .dossier import render


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m pipeline.analog_transfer", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="compute data/pilot/atlas_pi.json")
    b.add_argument("--draws", type=int, default=150)
    b.add_argument("--boot", type=int, default=200)
    b.add_argument("--no-eval", action="store_true")
    b.add_argument("--solar-rebuild", action="store_true")
    d = sub.add_parser("dossier", help="print a Markdown transferability dossier")
    d.add_argument("site")
    d.add_argument("target")
    d.add_argument("--mission")
    c = sub.add_parser("counterfactual", help="run CF_TERRAMECHANICS for a declared rover/soil")
    c.add_argument("body", choices=["moon", "mars"])
    c.add_argument("--mass", type=float)
    c.add_argument("--wheels", type=int)
    c.add_argument("--diameter", type=float)
    c.add_argument("--width", type=float)
    c.add_argument("--phi", type=float)
    c.add_argument("--cohesion", type=float)
    sub.add_parser("verify", help="rebuild in memory and compare the content hash with the saved bundle")
    dv = sub.add_parser("discover", help="coarse-to-fine Kazakhstan discovery (network: Copernicus public COGs)")
    dv.add_argument("--target", default="MARS_JEZERO")
    dv.add_argument("--shortlist", type=int, default=10)
    args = parser.parse_args(argv)
    if args.cmd == "build":
        if args.solar_rebuild:
            from .build import load_context
            load_context(solar_rebuild=True)
        doc = build(n_boot=args.boot, planner_draws=args.draws, with_evaluation=not args.no_eval)
        verdicts = [(h["id"], h["verdict"]) for h in (doc["evaluation"] or {}).get("hypotheses", [])]
        print(json.dumps({"written": str(PILOT / "atlas_pi.json"), "content_sha256": doc["content_sha256"],
                          "cells": len(doc["tensor"]["cells"]), "verdicts": verdicts, "performance": doc["performance"]}, indent=2))
        return 0
    if args.cmd == "dossier":
        doc = json.loads((PILOT / "atlas_pi.json").read_text())
        sys.stdout.write(render(doc, args.site, args.target, args.mission))
        return 0
    if args.cmd == "counterfactual":
        rover = {k: v for k, v in {"mass_kg": args.mass, "wheels": args.wheels, "wheel_diameter_m": args.diameter,
                                   "wheel_width_m": args.width}.items() if v is not None}
        soil = {k: v for k, v in {"phi_deg": args.phi, "c_pa": args.cohesion}.items() if v is not None}
        print(json.dumps(counterfactual.terramechanics(args.body, rover, soil), indent=2))
        return 0
    if args.cmd == "discover":
        from .build import load_context
        from .discovery import run
        ctx, _ = load_context()
        doc = run(ctx, args.target, args.shortlist)
        print(json.dumps({"candidates": [(c["id"], c["category"], c["nearest_catalog_km"]) for c in doc["candidates"]],
                          "failures": doc["failures"], "performance": doc["performance"]}, indent=2))
        return 0
    if args.cmd == "verify":
        saved = json.loads((PILOT / "atlas_pi.json").read_text())
        p = saved["parameters"]
        doc = build(out=False, n_boot=p["bootstrap_replicates"], planner_draws=p["planner_draws"],
                    with_evaluation=saved.get("evaluation") is not None)
        same = doc["content_sha256"] == saved["content_sha256"]  # dossiers derive from this hash
        print(json.dumps({"saved": saved["content_sha256"], "rebuilt": doc["content_sha256"], "identical": same}, indent=2))
        return 0 if same else 1
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
