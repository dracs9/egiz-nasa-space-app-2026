"""Proposed Jezero target surface temperatures from Mars 2020 MEDA TIRS.

Downloads the calibrated TIRS CSV for every ``--step``-th sol over one Mars
year (669 sols) from the PDS Atmospheres node, keeps ``GROUND_TEMP`` (ground
brightness temperature, K) on rows that pass the label's quality flags, and
summarises the year in the same terms as the Earth side of the engine:

- ``t_min_c``: 5th percentile of the daily minima (Earth: P5 of night LST);
- ``t_max_c``: 95th percentile of the daily maxima (Earth: P95 of day LST);
- ``_lo`` / ``_hi``: lowest and highest daily extreme in the sample.

The result is a *proposal* for ``data/curated/targets.csv`` (owned by the
science lead); it is not written there.

Flags (from the CAL_TIRS PDS4 label): a row is dropped when the front wheel
obstructs the downward field of view, the rover is tilted >= 20 deg, the ground
footprint is in rover shadow, or the rover is moving (flag value 0). Empty
flags mean not evaluated and are kept.

Usage::

    python tools/acquire_meda_ground_temp.py --cache <dir outside repo> \
        --out data/env/target-climate-0.1.0/mars_jezero_meda.json

Written with AI assistance (Claude Code); human review pending.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import statistics
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/data_calibrated_env"
CITATION = ("J.A. Rodriguez-Manfredi et al. (2021), The Mars Environmental Dynamics Analyzer, MEDA, "
            "NASA Planetary Data System, DOI 10.17189/1522849")
BAD_IF_ZERO = ("WHEEL_OUTSIDE_TIRS_DOWNWARD_LOOKING_FOV", "ROVER_LOW_TILT",
               "TIRS_GROUND_FOOTPRINT_NOT_IN_SHADOW", "ROVER_STILL")
SOLS_PER_YEAR = 669
K0 = 273.15


def _get(url: str, timeout: int = 120) -> bytes:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return response.read()


def _ranges() -> list[tuple[int, int, str]]:
    html = _get(BASE + "/").decode("utf-8", "replace")
    found = sorted(set(re.findall(r"sol_(\d{4})_(\d{4})/", html)))
    return [(int(a), int(b), f"sol_{a}_{b}") for a, b in found]


def _tirs_file(ranges, sol: int) -> str | None:
    for lo, hi, name in ranges:
        if lo <= sol <= hi:
            url = f"{BASE}/{name}/sol_{sol:04d}/"
            try:
                html = _get(url).decode("utf-8", "replace")
            except Exception:
                return None
            files = sorted(set(re.findall(r'(WE__\d{4}_+CAL_TIRS_+P\d+\.CSV)', html)))
            return url + files[-1] if files else None  # highest product version
    return None


def _daily_extremes(path: Path) -> tuple[float, float, int] | None:
    values = []
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            if any(row.get(flag, "").strip() == "0" for flag in BAD_IF_ZERO):
                continue
            cell = row.get("GROUND_TEMP", "").strip()
            if cell:
                values.append(float(cell))
    if not values:
        return None
    return min(values), max(values), len(values)


def _percentile(values: list[float], q: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * q
    low = int(position)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", required=True, help="download directory (keep outside the repository)")
    parser.add_argument("--out", default="data/env/target-climate-0.1.0/mars_jezero_meda.json")
    parser.add_argument("--first", type=int, default=1)
    parser.add_argument("--step", type=int, default=20)
    parser.add_argument("--min-samples", type=int, default=1000,
                        help="skip sols with fewer flagged-good samples (short windows miss the diurnal range)")
    args = parser.parse_args(argv)

    cache = Path(args.cache)
    cache.mkdir(parents=True, exist_ok=True)
    ranges = _ranges()
    days = []
    for target in range(args.first, args.first + SOLS_PER_YEAR, args.step):
        for sol in range(target, target + 5):  # nearest sol with a TIRS file
            url = _tirs_file(ranges, sol)
            if url:
                break
        else:
            print(f"sol {target}: no TIRS file within 5 sols", file=sys.stderr)
            continue
        local = cache / url.rsplit("/", 1)[1]
        if not local.exists():
            local.write_bytes(_get(url, timeout=600))
        extremes = _daily_extremes(local)
        if extremes is None:
            print(f"sol {sol}: no ground temperature passing flags", file=sys.stderr)
            continue
        tmin, tmax, n = extremes
        if n < args.min_samples:
            print(f"sol {sol}: only {n} samples, skipped", file=sys.stderr)
            continue
        days.append({"sol": sol, "file": url, "min_k": round(tmin, 2), "max_k": round(tmax, 2), "n": n})
        print(f"sol {sol}: min {tmin:.1f} K, max {tmax:.1f} K, n={n}", flush=True)

    minima = [d["min_k"] for d in days]
    maxima = [d["max_k"] for d in days]
    result = {
        "schema": "egiz.target_climate_proposal", "schema_version": "0.1.0",
        "target_id": "MARS_JEZERO", "status": "proposal for science lead; not in data/curated",
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": {"dataset": "Mars 2020 MEDA calibrated TIRS (CAL_TIRS), GROUND_TEMP", "citation": CITATION,
                   "archive": BASE, "quantity": "ground brightness temperature"},
        "method": (f"every {args.step}th sol from sol {args.first} over {SOLS_PER_YEAR} sols (one Mars year); "
                   f"sols with < {args.min_samples} good samples skipped; rows dropped when any of {', '.join(BAD_IF_ZERO)} == 0; per-sol min and max of GROUND_TEMP; "
                   "t_min_c = P5 of daily minima, t_max_c = P95 of daily maxima; lo/hi = sample extremes"),
        "caveats": [
            "MEDA does not sample every hour of every sol; a daily minimum can miss the true pre-dawn minimum.",
            "Brightness temperature, not kinetic temperature (emissivity not applied).",
            "Rover traverses: the footprint changes along the drive, not a fixed point.",
        ],
        "values": {
            "t_min_c": round(_percentile(minima, 0.05) - K0, 1),
            "t_min_c_lo": round(min(minima) - K0, 1),
            "t_min_c_hi": round(statistics.median(minima) - K0, 1),
            "t_max_c": round(_percentile(maxima, 0.95) - K0, 1),
            "t_max_c_lo": round(statistics.median(maxima) - K0, 1),
            "t_max_c_hi": round(max(maxima) - K0, 1),
        } if days else None,
        "sols_used": len(days),
        "days": days,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {out}: {len(days)} sols, values {result['values']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
