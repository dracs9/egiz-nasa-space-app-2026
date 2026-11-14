# Written with AI assistance (Codex); human review pending.
"""Generate NOAA low-Sun windows at the contract's 0.1-degree latitude bins."""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from pipeline.common.sun import lowsun_windows
from pipeline.contracts.validate import validate_data


def latitude_bin(lat):
    if not np.isfinite(lat) or not -90 <= lat <= 90:
        raise ValueError("latitude outside [-90,90]")
    return int(np.clip(np.floor((lat + 90)/.1), 0, 1799))


def build_windows(targets, out, *, year=2025, step_min=10):
    if isinstance(targets, (str, Path)):
        targets = json.loads(Path(targets).read_text())
    bins = np.round(np.arange(1800)*.1 - 89.95, 2).tolist()
    rows = []
    for target in targets["targets"]:
        if target["body"] != "moon":
            continue
        hours, sweep = [], []
        for lat in bins:
            h, a = lowsun_windows(lat, target["h_max_deg"], year, step_min)
            hours.append(h)
            sweep.append(a)
        rows.append({"target": target["id"], "h_max_deg": target["h_max_deg"], "hours_low": hours, "sweep_deg": sweep})
    result = {"schema": "egiz.sun_windows", "version": "1.0.0", "synthetic": targets["synthetic"],
              "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
              "provenance": [{"dataset": "NOAA Solar Calculator equations", "provider": "NOAA GML",
                              "version": "Meeus/NOAA; Egiz implementation", "url": "https://gml.noaa.gov/grad/solcalc/calcdetails.html", "role": "derived solar geometry"}],
              "model": {"algorithm": "NOAA", "refraction": True, "step_min": step_min, "year": year, "lat_step_deg": .1},
              "lat_bins": bins, "targets": rows}
    validate_data(result)
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, separators=(",", ":"), allow_nan=False) + "\n")
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--targets", default="data/processed/targets.json")
    parser.add_argument("--out", default="data/processed/sun_windows.json")
    args = parser.parse_args()
    try:
        print(build_windows(args.targets, args.out))
    except (OSError, ValueError) as exc:
        parser.exit(2, f"Solar window processing blocked: {exc}\n")


if __name__ == "__main__":
    main()
