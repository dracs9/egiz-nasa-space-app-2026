"""CLI for the EGIZ Discovery Engine.

python -m pipeline.discovery plan     --set global --set kz          # list windows, no network
python -m pipeline.discovery acquire  --set global --set kz --set benchmark --set targets
python -m pipeline.discovery context                                 # volcano / impact / country context
python -m pipeline.discovery build                                   # fingerprints, ranking, gaps, bundle
python -m pipeline.discovery validate                                # benchmark, ablation, sensitivity
python -m pipeline.discovery verify                                  # rebuild in memory and compare hashes
python -m pipeline.discovery report                                  # docs/discovery/RESULTS.md from the bundle
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
    if args.cmd == "verify":
        from pipeline.discovery.bundle import verify
        ok, detail = verify()
        print(detail)
        return 0 if ok else 1
    return 2


if __name__ == "__main__":
    sys.exit(main())
