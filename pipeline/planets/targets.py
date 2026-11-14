# Written with AI assistance (Codex); human review pending.
"""Build source-traceable target attributes from curated rows and actual DEMs."""
import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path

from pipeline.common.sun import h_max_moon
from pipeline.common.terrain import terrain_attributes
from pipeline.contracts.validate import validate_data
from pipeline.earth.gee_terrain import rename_attributes
from pipeline.planets.access import AccessError, read_window, to_local_grid

REGIONAL_KEYS = {"slope_r_p50_deg", "slope_r_p90_deg", "frac_lt20_r", "relief_m", "elev_min_m"}


def measure_target_terrain(z, transform, crs, center, body, baseline):
    """Fine metrics use baseline/2 pixels; all regional metrics use 200 m pixels.

    Earth ingestion/stage A uses the same 200 m regional grid. Matching only
    the 2 km difference baseline while retaining different pixels biases the
    sampling and the elevation percentiles, particularly for the lunar target.
    """
    p = baseline / 2
    grid = to_local_grid(z, transform, crs, center, body, p, 11000)
    attrs = rename_attributes(terrain_attributes(grid, p), baseline)
    if p != 200:
        regional = to_local_grid(z, transform, crs, center, body, 200, 11000)
        measured = terrain_attributes(regional, 200)
        attrs.update({key: measured[key] for key in REGIONAL_KEYS})
    return attrs


def build_targets(curated_csv, out_path, *, products=None, only=None):
    """No target is emitted without a readable real DEM and a source key.

    products maps target id to a local file or URL. Missing curated temperature
    values remain null; they never become generic planetary temperatures.
    """
    curated_csv = Path(curated_csv)
    products = products or {}
    registry_path = curated_csv.parent/"sources.csv"
    with registry_path.open(newline="", encoding="utf-8") as file:
        registry = {r["key"]: r for r in csv.DictReader(file)}
    targets, provenance = [], []
    with curated_csv.open(newline="", encoding="utf-8") as file:
        for lineno, row in enumerate(csv.DictReader(file), 2):
            if only and row["id"] not in only:
                continue
            sources = row["source_keys"].split(";")
            if not sources or any(key not in registry for key in sources):
                raise ValueError(f"{curated_csv}:{lineno}: unknown or empty source_keys")
            product = products.get(row["id"])
            if product is None:
                raise AccessError(f"{row['id']}: no DEM supplied; use --dem {row['id']}=/path/to/source.tif")
            lon, lat = float(row["lon"]), float(row["lat"])
            baseline = int(row["fine_baseline_m"])
            z, transform, crs = read_window(product, lon, lat, 11000, row["body"])
            attrs = measure_target_terrain(z, transform, crs, (lon, lat), row["body"], baseline)
            attr_sources = {key: f"computed:{row['dem_product']}; pixel={200 if key in REGIONAL_KEYS else baseline / 2:g}m" for key in attrs}
            for key in ["t_min_c", "t_max_c"]:
                attrs[key] = float(row[key]) if row[key] else None
                if row[key]:
                    attr_sources[key] = ";".join(sources)
            attrs.update({"precip_mm": 0, "bare_frac": 1})
            attr_sources.update({"precip_mm": "definition:EGIZ_METHOD", "bare_frac": "definition:EGIZ_METHOD"})
            targets.append({"id": row["id"], "body": row["body"], "name": row["name"], "kind": row["kind"],
                            "lon": lon, "lat": lat, "dem_product": row["dem_product"], "fine_baseline_m": baseline,
                            "attrs": attrs, "attr_sources": attr_sources,
                            "h_max_deg": h_max_moon(lat) if row["body"] == "moon" else None,
                            "templates": row["templates"].split(";")})
            for key in sources:
                source = registry[key]
                record = {"dataset": source["citation"], "provider": "see source citation", "version": "see product",
                          "url": source["url_or_doi"], "role": "target definition and DEM"}
                if record not in provenance:
                    provenance.append(record)
    if not targets:
        raise ValueError("no target rows selected")
    result = {"schema": "egiz.targets", "version": "1.0.0", "synthetic": False,
              "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
              "provenance": provenance, "targets": targets}
    validate_data(result, production=True)
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--curated", default="data/curated/targets.csv")
    parser.add_argument("--out", default="data/processed/targets.json")
    parser.add_argument("--dem", action="append", default=[], metavar="TARGET=PATH_OR_URL")
    parser.add_argument("--only", action="append")
    args = parser.parse_args()
    try:
        products = dict(item.split("=", 1) for item in args.dem)
        print(build_targets(args.curated, args.out, products=products, only=args.only))
    except (OSError, ValueError, AccessError) as exc:
        parser.exit(2, f"Target processing blocked: {exc}\n")


if __name__ == "__main__":
    main()
