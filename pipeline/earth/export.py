# Written with AI assistance (Codex); human review pending.
"""Merge acquisition parts, or ingest a documented local raster manifest."""
import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path

from pipeline.common.terrain import terrain_attributes
from pipeline.contracts.validate import tiles_hash, validate_data
from pipeline.earth.gee_terrain import rename_attributes
from pipeline.planets.access import read_window, to_local_grid

ATTRS = ["slope_f100_p50_deg", "slope_f100_p90_deg", "frac_lt10_f100", "frac_lt20_f100", "tri_f100_m",
         "slope_f400_p50_deg", "slope_f400_p90_deg", "frac_lt10_f400", "frac_lt20_f400", "tri_f400_m",
         "slope_r_p50_deg", "slope_r_p90_deg", "frac_lt20_r", "relief_m", "elev_min_m", "t_min_c", "t_max_c", "precip_mm", "bare_frac"]
CONTEXT = ["tree_frac", "crop_frac", "built_frac", "water_frac", "snow_frac"]


def export_candidates(parts, out_path, *, provenance=None):
    """Merge per-id fields and validate before writing a production artifact."""
    tiles = {}
    source_records = list(provenance or [])
    for part in parts:
        if isinstance(part, (str, Path)):
            part = json.loads(Path(part).read_text())
        if isinstance(part, dict):
            if part.get("synthetic"):
                raise ValueError("synthetic input is not permitted in production export")
            source_records.extend(part.get("provenance", []))
            rows = part.get("tiles", part.get("features", []))
        else:
            rows = part
        for row in rows:
            row = row.get("properties", row)
            tile = tiles.setdefault(row["id"], {"id": row["id"], "attrs": {}, "context": {}})
            for field in ["pool", "stratum", "name", "country", "lon", "lat", "snow_free_frac"]:
                if field in row:
                    tile[field] = row[field]
            tile["attrs"].update(row.get("attrs", {}))
            tile["context"].update(row.get("context", {}))
    if not source_records:
        raise ValueError("real source provenance is required for candidate export")
    for tile in tiles.values():
        for field in ["stratum", "name", "country"]:
            tile.setdefault(field, None)
        tile.setdefault("pool", "global")
        for key in ATTRS:
            tile["attrs"].setdefault(key, None)
        for key in CONTEXT:
            tile["context"].setdefault(key, None)
        tile["missing"] = [key for key in ATTRS if tile["attrs"][key] is None]
    result = {"schema": "egiz.earth_candidates", "version": "1.0.0",
              "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
              "synthetic": False, "provenance": source_records,
              "tiles_hash": tiles_hash(list(tiles)), "tiles": [tiles[k] for k in sorted(tiles)]}
    validate_data(result, production=True)
    path = Path(out_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    return path


def ingest_local(manifest, out_path):
    """CSV columns: id,lon,lat,dem,source_url; optional attrs/context columns.

    A local DEM must be authentic source elevation in metres with its CRS. CSV
    environment values need a separate env_source_url; missing values stay null.
    Relative DEM paths resolve against the manifest directory.
    """
    manifest = Path(manifest)
    rows, provenance = [], []
    with manifest.open(newline="", encoding="utf-8") as file:
        for index, row in enumerate(csv.DictReader(file), 2):
            if not row.get("source_url"):
                raise ValueError(f"{manifest}:{index}: source_url is required")
            dem = Path(row["dem"])
            if not dem.is_absolute():
                dem = manifest.parent/dem
            lon, lat = float(row["lon"]), float(row["lat"])
            source, transform, crs = read_window(str(dem), lon, lat, 11000, "earth")
            attrs = {}
            for baseline, p in [(400, 200), (100, 50)]:
                z = to_local_grid(source, transform, crs, (lon, lat), "earth", p, 11000)
                computed = rename_attributes(terrain_attributes(z, p), baseline)
                attrs.update({k: v for k, v in computed.items() if baseline == 400 or "f100" in k})
            env = {k: float(row[k]) for k in ["t_min_c", "t_max_c", "precip_mm", "bare_frac"] if row.get(k)}
            context = {k: float(row[k]) for k in CONTEXT if row.get(k)}
            if (env or context) and not row.get("env_source_url"):
                raise ValueError(f"{manifest}:{index}: env_source_url required for supplied environment values")
            attrs.update(env)
            rows.append({"id": row["id"], "lon": lon, "lat": lat, "pool": row.get("pool") or "global",
                         "stratum": row.get("stratum") or None, "name": row.get("name") or None,
                         "country": row.get("country") or None, "attrs": attrs, "context": context})
            provenance.append({"dataset": row.get("dataset") or dem.name, "provider": row.get("provider") or "user supplied source",
                               "version": row.get("source_version") or "unspecified", "url": row["source_url"], "role": "terrain"})
            if env or context:
                provenance.append({"dataset": row.get("env_dataset") or "manifest environment",
                                   "provider": row.get("env_provider") or row.get("provider") or "user supplied source",
                                   "version": row.get("env_version") or "unspecified",
                                   "url": row["env_source_url"], "role": "environment and land cover"})
    return export_candidates([rows], out_path, provenance=provenance)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--out", default="data/processed/earth_candidates.json")
    args = parser.parse_args()
    try:
        print(ingest_local(args.manifest, args.out))
    except (ValueError, OSError, RuntimeError) as exc:
        parser.exit(2, f"Earth import failed: {exc}\n")


if __name__ == "__main__":
    main()
