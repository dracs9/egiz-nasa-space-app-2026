# Written with AI assistance (Codex); human review pending.
"""Deterministic 20 km candidates; global sampling is done on real GEE land."""
import argparse
import csv
import json
from pathlib import Path
from typing import cast

from pyproj import CRS, Transformer


def utm_epsg(lon, lat):
    if not -180 <= lon <= 180 or not -80 <= lat <= 84:
        raise ValueError("UTM requires longitude [-180,180] and latitude [-80,84]")
    zone = min(60, int((lon + 180)//6) + 1)
    # Official Norway/Svalbard exceptions keep tiles in the correct grid zone.
    if 56 <= lat < 64 and 3 <= lon < 12:
        zone = 32
    if 72 <= lat < 84 and 0 <= lon < 42:
        zone = 31 if lon < 9 else 33 if lon < 21 else 35 if lon < 33 else 37
    return (32600 if lat >= 0 else 32700) + zone


def tile_id(lon, lat, prefix="GL"):
    return f"{prefix}_{'E' if lon >= 0 else 'W'}{abs(lon):07.3f}_{'N' if lat >= 0 else 'S'}{abs(lat):06.3f}"


def square_coordinates(lon, lat, side_m=20000):
    """Closed WGS84 ring from a metric square centered in the site's UTM zone."""
    if side_m <= 0:
        raise ValueError("side_m must be positive")
    projected = CRS.from_epsg(utm_epsg(lon, lat))
    forward = Transformer.from_crs(4326, projected, always_xy=True)
    backward = Transformer.from_crs(projected, 4326, always_xy=True)
    x, y = forward.transform(lon, lat)
    half = side_m/2
    corners = [(x-half, y-half), (x+half, y-half), (x+half, y+half), (x-half, y+half), (x-half, y-half)]
    return [list(backward.transform(*corner)) for corner in corners]


def initialize_ee(project=None):
    """Initialize using an explicit project and existing local EE credentials."""
    import os
    project = project or os.environ.get("EE_PROJECT")
    if not project:
        raise RuntimeError("EE_PROJECT is required. Authenticate with earthengine authenticate and enable Earth Engine for the project.")
    try:
        import ee
    except ImportError as exc:
        raise RuntimeError("Install optional earthengine-api to acquire Earth observations") from exc
    # Service account (non-interactive servers): EE_SERVICE_ACCOUNT_KEY points to its JSON key file,
    # which stays outside the repository. Otherwise the user's `earthengine authenticate` credentials.
    key = os.environ.get("EE_SERVICE_ACCOUNT_KEY")
    try:
        if key:
            import json
            email = json.loads(open(os.path.expanduser(key), encoding="utf-8").read())["client_email"]
            ee.Initialize(ee.ServiceAccountCredentials(email, os.path.expanduser(key)), project=project)
        else:
            ee.Initialize(project=project)
    except Exception as exc:
        raise RuntimeError("Earth Engine initialization failed; verify EE_PROJECT and EE_SERVICE_ACCOUNT_KEY, "
                           f"or run earthengine authenticate ({type(exc).__name__}: {exc})") from exc
    return ee


def build_pool(seed=2026, n_per_stratum=None, *, project=None, practice_csv=None, volcanic_geojson=None,
               controls_per_class=20):
    """Return an ee.FeatureCollection with reproducible, filtered 20 km squares.

    Default stratification uses transparent latitude bands, not climate labels.
    A real source polygon is mandatory for volcanic sampling. Controls require
    >70% observed forest/crop/snow; campaign candidates require >=50% barren.
    """
    ee = initialize_ee(project)
    counts = n_per_stratum or {"hot_desert": 1000, "cold_polar": 1000, "other_open": 1000}
    if any(n < 0 for n in counts.values()):
        raise ValueError("stratum counts cannot be negative")
    if counts.get("volcanic") and volcanic_geojson is None:
        raise ValueError("volcanic stratum requires documented source volcanic_geojson polygons")
    land = ee.FeatureCollection("USDOS/LSIB_SIMPLE/2017").filter(ee.Filter.neq("country_na", "Antarctica")).geometry()
    boxes = {
        "hot_desert": ee.Geometry.Rectangle([-180, -35, 180, 35], geodesic=False),
        "cold_polar": ee.Geometry.MultiPolygon([
            [[[-180, 60], [180, 60], [180, 84], [-180, 84], [-180, 60]]],
            [[[-180, -80], [180, -80], [180, -60], [-180, -60], [-180, -80]]]], geodesic=False),
        "other_open": ee.Geometry.Rectangle([-180, -60, 180, 60], geodesic=False),
    }
    if volcanic_geojson:
        boxes["volcanic"] = ee.FeatureCollection(json.loads(Path(volcanic_geojson).read_text())).geometry()
    cover = ee.ImageCollection("ESA/WorldCover/v200").first().select("Map")
    bare = cover.eq(60)
    fallback = ee.ImageCollection("MODIS/061/MCD12Q1").filterDate("2021-01-01", "2022-01-01").first().select("LC_Type1").eq(16)
    bare = bare.unmask(fallback)
    tiles = []
    for index, (stratum, count) in enumerate(sorted(counts.items())):
        if not count:
            continue
        if stratum not in boxes:
            raise ValueError(f"unknown stratum {stratum}")
        region = boxes[stratum].intersection(land, maxError=100)
        # Download point coordinates, then construct genuinely metric polygons.
        points = cast(dict, ee.FeatureCollection.randomPoints(region, count*4, seed+index, maxError=100).getInfo())["features"]
        proposed = []
        for point in points:
            lon, lat = point["geometry"]["coordinates"]
            if -80 <= lat <= 84:
                proposed.append(ee.Feature(ee.Geometry.Polygon([square_coordinates(lon, lat)], geodesic=False),
                                  {"id": tile_id(lon, lat), "lon": lon, "lat": lat,
                                   "pool": "global", "stratum": stratum, "utm_epsg": utm_epsg(lon, lat)}))
        accepted = bare.rename("bare_frac").reduceRegions(ee.FeatureCollection(proposed), ee.Reducer.mean(), scale=500)
        accepted = accepted.filter(ee.Filter.gte("bare_frac", .5)).limit(count).getInfo()["features"]
        if len(accepted) < count:
            raise RuntimeError(f"only {len(accepted)}/{count} eligible {stratum} tiles; reduce requested count or enlarge source strata")
        tiles.extend(accepted)
    # Sample actual cover classes before verifying the whole 20 km footprint.
    # Every retained control is scored by the same later acquisition functions.
    for index, (name, code) in enumerate([("FOREST", 10), ("CROP", 40), ("SNOW", 70)]):
        if not controls_per_class:
            continue
        mask = cover.eq(code)
        sampled = mask.selfMask().sample(region=land, scale=5000, numPixels=controls_per_class*100,
                                         seed=seed+100+index, geometries=True).getInfo()["features"]
        proposed = []
        for point in sampled:
            lon, lat = point["geometry"]["coordinates"]
            if -80 <= lat <= 84:
                proposed.append(ee.Feature(ee.Geometry.Polygon([square_coordinates(lon, lat)], geodesic=False),
                                  {"id": tile_id(lon, lat, f"CT_{name}"), "lon": lon, "lat": lat,
                                   "pool": "control", "stratum": None, "utm_epsg": utm_epsg(lon, lat)}))
        accepted = mask.rename("control_cover_frac").reduceRegions(ee.FeatureCollection(proposed), ee.Reducer.mean(), scale=500)
        accepted = accepted.filter(ee.Filter.gt("control_cover_frac", .7)).limit(controls_per_class).getInfo()["features"]
        if len(accepted) < controls_per_class:
            raise RuntimeError(f"only {len(accepted)}/{controls_per_class} verified {name} controls; enlarge source sampling")
        tiles.extend(accepted)
    if practice_csv:
        with open(practice_csv, newline="", encoding="utf-8") as file:
            for row in csv.DictReader(file):
                lon, lat = float(row["lon"]), float(row["lat"])
                props = {"id": f"PR_{row['site_id']}", "name": row["name"], "lon": lon, "lat": lat,
                         "pool": "practice", "stratum": None, "utm_epsg": utm_epsg(lon, lat)}
                tiles.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [square_coordinates(lon, lat)]}, "properties": props})
    # Deduplicate repeated practice site/objective rows and rounded coordinate IDs.
    unique = {f["properties"]["id"]: f for f in tiles}
    return ee.FeatureCollection(list(unique.values()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project")
    parser.add_argument("--out", default="data/raw/earth_pool.geojson")
    parser.add_argument("--count-per-stratum", type=int, default=1000)
    parser.add_argument("--practice-csv", default="data/curated/practice_sites.csv")
    args = parser.parse_args()
    try:
        fc = build_pool(n_per_stratum={k: args.count_per_stratum for k in ["hot_desert", "cold_polar", "other_open"]},
                        project=args.project, practice_csv=args.practice_csv)
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(fc.getInfo(), indent=2), encoding="utf-8")
        print(out)
    except (RuntimeError, ValueError) as exc:
        parser.exit(2, f"Earth acquisition blocked: {exc}\n")


if __name__ == "__main__":
    main()
