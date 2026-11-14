"""Build versioned 200 m Mission Lab grids from the existing measured pilot.

AI-assisted independent development, 2026-10-18; human scientific review pending.
Never generates missing terrain or changes the ranking inputs.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from pipeline.common.evidence import finite_list
from pipeline.common.terrain import _central
from pipeline.planets.access import local_crs, local_origin, read_window, to_local_grid


def grid_document(z, cell_m=200):
    core = _central(z, round(20000 / cell_m))
    return {"side": int(core.shape[0]), "cell_m": cell_m,
            "west_m": -10000 + cell_m / 2, "north_m": 10000 - cell_m / 2,
            "elevation_m": finite_list(np.round(core, 3)),
            "valid_fraction": float(np.isfinite(core).mean())}


def build(base):
    base = Path(base)
    evidence = json.loads((base / "terrain_evidence.json").read_text())
    candidates = json.loads((base / "earth_candidates.json").read_text())
    targets = json.loads((base / "targets.json").read_text())
    if candidates["synthetic"] or targets["synthetic"] or evidence["synthetic"]:
        raise ValueError("Mission terrain requires measured inputs")
    hashes = {f"{name}_sha256": hashlib.sha256((base / f"{name}.json").read_bytes()).hexdigest()
              for name in ["earth_candidates", "targets"]}
    if any(evidence["inputs"][key] != value for key, value in hashes.items()):
        raise ValueError("Terrain evidence is stale")
    with (base / "earth_manifest.csv").open(newline="", encoding="utf-8") as source:
        paths = {row["id"]: base / row["dem"] for row in csv.DictReader(source)}
    paths.update({"MOON_MONS_MOUTON": base.parent / "raw/targets/Site20v2_final_adj_5mpp_surf.tif",
                  "MARS_JEZERO": base.parent / "raw/targets/Jezero_MOLA_HRSC_200m.tif"})
    names = {row["id"]: row.get("name") or row["id"]
             for row in candidates["tiles"] + targets["targets"]}
    entries = []
    for entry in evidence["entries"]:
        id_, body, lon, lat = (entry[key] for key in ["id", "body", "lon", "lat"])
        path = paths[id_]
        if hashlib.sha256(path.read_bytes()).hexdigest() != entry["source"]["sha256"]:
            raise ValueError(f"DEM changed since evidence: {id_}")
        z, affine, crs = read_window(path, lon, lat, 11000, body)
        local = to_local_grid(z, affine, crs, (lon, lat), body, 200, 11000)
        entries.append({"id": id_, "name": names[id_], "body": body, "lon": lon, "lat": lat,
                        "source": entry["source"], "local_crs": local_crs((lon, lat), body).to_string(),
                        "local_origin": list(local_origin((lon, lat), body)),
                        "source_pixel_m": {"earth": 30, "moon": 5, "mars": 200}[body],
                        "grid": grid_document(local)})
    document = {"schema": "egiz.mission_terrain", "version": "1.0.0", "synthetic": False,
                "generated_at": datetime.now(timezone.utc).isoformat(), "inputs": hashes,
                "method": "Average reprojection with all-valid footprint mask; 200 m cells, north-up. Pixel centers in local metres. Heights retain source vertical datum. Millimetre rounding is serialization, not measurement precision.",
                "entries": entries}
    output = base / "mission_terrain.json"
    output.write_text(json.dumps(document, allow_nan=False, separators=(",", ":")) + "\n")
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default="data/pilot")
    print(build(parser.parse_args().data_dir))
