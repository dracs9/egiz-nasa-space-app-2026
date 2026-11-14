# Written with AI assistance (Claude Code); reviewed by: pending (Geo lead).
"""CLI: python -m pipeline.geodata {audit,acquire,features,manifest,validate,all}.

acquire/features share one resumable per-AOI processor: ``acquire`` runs every
stage (downloads are cached), ``features`` reruns the stages from the cache.
"""
from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor

from pipeline.geodata import DERIVED, RAW, RELEASE
from pipeline.geodata.aois import pilot_aois, planetary_aois


def selected_aois(scope):
    from pipeline.geodata.sample import load_selection
    aois = pilot_aois() + planetary_aois()
    if scope in {"all", "sampled"}:
        aois += load_selection()
    if scope == "sampled":
        aois = [a for a in aois if a.pool == "sampled"]
    return aois


def cmd_acquire(args, force=False):
    from pipeline.geodata.features import process
    from pipeline.geodata.rasters import copernicus_tiles
    if args.sample:
        from pipeline.geodata.sample import select
        _, summary = select(n_total=args.sample)
        print("sample selection:", json.dumps(summary))
    tiles = copernicus_tiles(RAW)
    aois = selected_aois(args.scope)
    if args.only:
        aois = [a for a in aois if a.aoi_id in set(args.only)]

    def one(aoi):
        record = process(aoi, tile_names=tiles, force=force)
        failed = {k: v.get("error", "")[:160] for k, v in record["stages"].items() if v["status"] == "failed"}
        print(f"{aoi.aoi_id}: " + ", ".join(f"{k}={v['status']}" for k, v in record["stages"].items())
              + (f"  FAILED {failed}" if failed else ""), flush=True)
        return not failed

    planets = [a for a in aois if a.body != "earth"]
    earth = [a for a in aois if a.body == "earth"]
    ok = [one(a) for a in planets]
    with ThreadPoolExecutor(args.workers) as pool:
        ok += list(pool.map(one, earth))
    print(f"{sum(ok)}/{len(ok)} AOIs without failed stages")
    return 0


def cmd_manifest(args):
    from pipeline.geodata.catalog import build_release
    ids = {a.aoi_id for a in selected_aois(args.scope)}
    print(build_release(RELEASE, ids, verify_files=not args.no_verify_files))
    return 0


def cmd_validate(args):
    from pipeline.geodata.qa import validate_release
    errors = validate_release(RELEASE)
    coverage = json.loads((RELEASE / "manifests" / "coverage.json").read_text(encoding="utf-8"))
    print(json.dumps({k: coverage[k] for k in ["n_aois", "n_distinct_sites", "by_body", "by_coverage_level"]}))
    for e in errors:
        print("ERROR", e)
    print("release valid" if not errors else f"{len(errors)} release errors")
    return 1 if errors else 0


def cmd_audit(args):
    """Inventory of what is on disk now (raw cache, derived records, release)."""
    def size(path):
        return sum(p.stat().st_size for p in path.rglob("*") if p.is_file()) if path.exists() else 0
    report = {"raw_cache_bytes": {p.name: size(p) for p in sorted(RAW.iterdir())} if RAW.exists() else {},
              "derived_records": len(list((DERIVED / "aoi").glob("*.json"))) if DERIVED.exists() else 0,
              "derived_grid_bytes": size(DERIVED / "grids"),
              "release_present": (RELEASE / "aoi_catalog.json").exists()}
    print(json.dumps(report, indent=1))
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python -m pipeline.geodata", description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name in ["acquire", "features"]:
        p = sub.add_parser(name)
        p.add_argument("--scope", choices=["pilot", "all", "sampled"], default="all")
        p.add_argument("--only", nargs="*")
        p.add_argument("--workers", type=int, default=6)
        p.add_argument("--sample", type=int, default=0, help="(re)select N sampled Earth AOIs first")
    p = sub.add_parser("manifest")
    p.add_argument("--scope", choices=["pilot", "all"], default="all")
    p.add_argument("--no-verify-files", action="store_true", help="skip checksum re-verification of local rasters")
    sub.add_parser("validate")
    sub.add_parser("audit")
    args = parser.parse_args(argv)
    if args.cmd == "acquire":
        return cmd_acquire(args)
    if args.cmd == "features":
        return cmd_acquire(args, force=True)
    return {"manifest": cmd_manifest, "validate": cmd_validate, "audit": cmd_audit}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
