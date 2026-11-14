"""Small, traceable terrain evidence products from genuine local DEM windows.

Surfaces and east-west profiles are for inspection; scoring uses full grids.
Elevations retain native vertical datums and must not be compared absolutely.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from pipeline.common.terrain import _central, slope_at_offset
from pipeline.planets.access import read_window, to_local_grid

BINS = [0, 1, 2, 5, 10, 15, 20, 30, 45, 60, 90]


def finite_list(values):
    return [float(v) if np.isfinite(v) else None for v in np.asarray(values).flat]


def summarize(z, p):
    """20 km surface, 10 km central profile, and 10 km fine-slope distribution."""
    core = _central(z, round(20000 / p))
    fine = _central(z, round(10000 / p))
    # A 25 x 25 surface with 800 m cells; require all samples in each cell.
    factor = round(800 / p)
    blocks = core.reshape(25, factor, 25, factor)
    surface = blocks.mean(axis=(1, 3))
    slopes = _central(slope_at_offset(z, p, 1), round(10000 / p))
    valid = slopes[np.isfinite(slopes)]
    counts = np.histogram(valid, bins=BINS)[0]
    return {"pixel_m": p, "baseline_m": 2 * p, "core20_valid_fraction": float(np.isfinite(core).mean()),
            "surface": {"side": 25, "cell_m": 800, "elevation_m": finite_list(surface)},
            "profile": {"direction": "west_to_east", "distance_m": ((np.arange(fine.shape[1]) + .5) * p).tolist(),
                        "north_offset_m": -p / 2, "elevation_m": finite_list(fine[fine.shape[0] // 2])},
            "slope_histogram": {"edges_deg": BINS, "counts": counts.tolist(), "valid_count": int(valid.size),
                                "missing_count": int(slopes.size - valid.size)}}


def build(base):
    base = Path(base)
    candidates = json.loads((base / "earth_candidates.json").read_text())
    targets = json.loads((base / "targets.json").read_text())
    if candidates["synthetic"] or targets["synthetic"]:
        raise ValueError("Measured terrain evidence requires observed inputs")
    rows = list(csv.DictReader((base / "earth_manifest.csv").open(newline="", encoding="utf-8")))
    target_paths = {"MOON_MONS_MOUTON": "Site20v2_final_adj_5mpp_surf.tif", "MARS_JEZERO": "Jezero_MOLA_HRSC_200m.tif"}
    target_urls = {
        "MOON_MONS_MOUTON": "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site20v2/Site20v2_final_adj_5mpp_surf.tif",
        "MARS_JEZERO": "https://planetarymaps.usgs.gov/mosaic/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif",
    }
    records = []
    for row in rows:
        records.append((row["id"], "earth", float(row["lon"]), float(row["lat"]), base / row["dem"], row["source_url"]))
    for target in targets["targets"]:
        path = base.parent / "raw" / "targets" / target_paths[target["id"]]
        records.append((target["id"], target["body"], target["lon"], target["lat"], path, target_urls[target["id"]]))
    entries = []
    for id_, body, lon, lat, path, url in records:
        z, affine, crs = read_window(path, lon, lat, 11000, body)
        grids = {}
        for p in ([200] if body == "mars" else [50] if body == "moon" else [50, 200]):
            local = to_local_grid(z, affine, crs, (lon, lat), body, p, 11000)
            grids[str(2 * p)] = summarize(local, p)
        entries.append({"id": id_, "body": body, "lon": lon, "lat": lat,
                        "source": {"url": url, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "native_crs": crs.to_string()},
                        "grids": grids})
    document = {"schema": "egiz.terrain_evidence", "version": "1.0.0", "synthetic": False,
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "inputs": {f"{name}_sha256": hashlib.sha256((base / f"{name}.json").read_bytes()).hexdigest()
                           for name in ["earth_candidates", "targets"]},
                "method": "Full grid average reprojection; 800 m surface cells require all finite samples. Fine slope central difference. Profiles retain metric distances and original elevations; the UI centers each profile on its mean.",
                "entries": entries}
    output = base / "terrain_evidence.json"
    output.write_text(json.dumps(document, allow_nan=False, separators=(",", ":")) + "\n")
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default="data/pilot")
    print(build(parser.parse_args().data_dir))


if __name__ == "__main__":
    main()
