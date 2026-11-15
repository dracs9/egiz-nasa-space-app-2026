"""CLI for the EGIZ Discovery Engine.

python -m pipeline.discovery plan     --set global --set kz          # list windows, no network
python -m pipeline.discovery acquire  --set global --set kz --set benchmark --set targets
python -m pipeline.discovery context                                 # volcano / impact / country context
python -m pipeline.discovery build                                   # fingerprints, ranking, gaps, bundle
python -m pipeline.discovery validate                                # benchmark, ablation, sensitivity
python -m pipeline.discovery verify                                  # rebuild in memory and compare hashes
python -m pipeline.discovery report                                  # docs/discovery/RESULTS.md from the bundle
python -m pipeline.discovery point --body mars --lon 77.45 --lat 18.44 # analyse any Moon/Mars point on demand
python -m pipeline.discovery alphaearth-index                        # AlphaEarth mean embedding per Earth window (Earth Engine)
python -m pipeline.discovery earth-albedo                            # Earth surface albedo per window (NASA POWER)
python -m pipeline.discovery alphaearth-bridge                       # train physics -> AlphaEarth embedding model
python -m pipeline.discovery serve                                   # point API on 127.0.0.1:8767 (Vite proxies /api/point)
python -m pipeline.discovery refine-plan|refine-acquire|refine-index|refine-build   # Kazakhstan 20 km refinement
"""
from __future__ import annotations

import argparse
import json
import sys


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="python -m pipeline.discovery")
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("plan", "acquire"):
        s = sub.add_parser(name)
        s.add_argument("--set", action="append", choices=["global", "kz", "benchmark", "targets"], default=None)
        s.add_argument("--global-spacing-km", type=float, default=220.0)
        s.add_argument("--kz-spacing-km", type=float, default=75.0)
        s.add_argument("--limit", type=int, default=None)
        s.add_argument("--workers", type=int, default=8)
        s.add_argument("--keep-native", action="store_true", help="do not delete native source windows")
    sub.add_parser("context")
    sub.add_parser("index")
    b = sub.add_parser("build")
    b.add_argument("--draws", type=int, default=128)
    sub.add_parser("validate")
    sub.add_parser("report")
    sub.add_parser("verify")
    pt = sub.add_parser("point")
    pt.add_argument("--body", choices=["moon", "mars"], required=True)
    pt.add_argument("--lon", type=float, required=True)
    pt.add_argument("--lat", type=float, required=True)
    pt.add_argument("--out", default=None)
    ai = sub.add_parser("alphaearth-index")
    ai.add_argument("--year", type=int, default=2024)
    ai.add_argument("--workers", type=int, default=4)
    sub.add_parser("alphaearth-bridge")
    ea = sub.add_parser("earth-albedo")
    ea.add_argument("--workers", type=int, default=6)
    sv = sub.add_parser("serve")
    sv.add_argument("--port", type=int, default=8767)
    sub.add_parser("refine-plan")
    ra = sub.add_parser("refine-acquire")
    ra.add_argument("--workers", type=int, default=6)
    sub.add_parser("refine-index")
    sub.add_parser("refine-build")
    args = p.parse_args(argv)

    if args.cmd in {"plan", "acquire"}:
        from pipeline.discovery.acquire import select
        sets = args.set or ["global", "kz", "benchmark", "targets"]
        aois = select(sets, global_spacing_km=args.global_spacing_km, kz_spacing_km=args.kz_spacing_km,
                      limit=args.limit)
        if args.cmd == "plan":
            from collections import Counter
            print(json.dumps({"n": len(aois), "by_pool": Counter(a.pool for a in aois)}, indent=1))
            return 0
        from pipeline.discovery.acquire import run
        print(json.dumps(run(aois, workers=args.workers, purge=not args.keep_native)))
        return 0
    if args.cmd == "context":
        from pipeline.discovery.context import build_context
        print(build_context())
        return 0
    if args.cmd == "index":
        from pipeline.discovery.index import compile_index
        print(json.dumps(compile_index(), indent=1))
        return 0
    if args.cmd == "build":
        from pipeline.discovery.bundle import build
        print(build(draws=args.draws))
        return 0
    if args.cmd == "validate":
        from pipeline.discovery import OUT
        from pipeline.discovery.validation import run_validation
        bundle = OUT / "discovery.json"
        draws = json.loads(bundle.read_text())["inputs"]["draws"] if bundle.exists() else 128
        print(run_validation(draws=draws))
        return 0
    if args.cmd == "report":
        from pipeline.discovery.report import write_report
        print(write_report())
        return 0
    if args.cmd == "point":
        from pipeline.discovery.point import analyze
        result = analyze(args.body, args.lon, args.lat)
        text = json.dumps(result, ensure_ascii=False, allow_nan=False)
        if args.out:
            open(args.out, "w", encoding="utf-8").write(text)
        top = result["target"]["shortlist"][:5]
        print(json.dumps({"point": result["point"], "terrain": result["terrain"], "verdict": result["verdict"],
                          "top": [{k: e[k] for k in ("name", "score", "fidelity", "lo", "hi", "category")} for e in top],
                          "timing_s": result["timing_s"]}, ensure_ascii=False, indent=1))
        return 0
    if args.cmd == "alphaearth-index":
        from pipeline.discovery.alphaearth import build_index
        print(json.dumps(build_index(args.year, workers=args.workers), indent=1))
        return 0
    if args.cmd == "alphaearth-bridge":
        from pipeline.discovery.bridge import train
        print(json.dumps(train(), indent=1))
        return 0
    if args.cmd == "earth-albedo":
        from pipeline.discovery.earth_albedo import acquire
        print(json.dumps(acquire(args.workers), indent=1))
        return 0
    if args.cmd == "serve":
        from pipeline.discovery.serve import serve
        serve(args.port)
        return 0
    if args.cmd.startswith("refine-"):
        from pipeline.discovery import refine as RF
        if args.cmd == "refine-plan":
            doc = RF.plan_seeds()
            print(json.dumps({"seeds": len(doc["seeds"]), "windows_to_acquire": len(RF.refine_aois(doc["seeds"]))}))
        elif args.cmd == "refine-acquire":
            print(json.dumps(RF.acquire(workers=args.workers)))
        elif args.cmd == "refine-index":
            print(json.dumps(RF.compile_region_index(), indent=1))
        else:
            print(RF.build())
        return 0
    if args.cmd == "verify":
        from pipeline.discovery.bundle import verify
        ok, detail = verify()
        print(detail)
        return 0 if ok else 1
    return 2


if __name__ == "__main__":
    sys.exit(main())
