# Written with AI assistance (Codex); human review pending.
"""Kazakhstan candidate sampling clipped to the documented LSIB country boundary."""
from typing import cast

from pipeline.earth.pool import initialize_ee, square_coordinates, tile_id, utm_epsg


def build_kazakhstan_pool(count=200, seed=2026, *, project=None):
    ee = initialize_ee(project)
    country = ee.FeatureCollection("USDOS/LSIB_SIMPLE/2017").filter(ee.Filter.eq("country_na", "Kazakhstan")).geometry()
    points = cast(dict, ee.FeatureCollection.randomPoints(country, count*4, seed).getInfo())["features"]
    tiles = []
    for point in points:
        lon, lat = point["geometry"]["coordinates"]
        geometry = ee.Geometry.Polygon([square_coordinates(lon, lat)], geodesic=False)
        tiles.append(ee.Feature(geometry, {"id": tile_id(lon, lat, "KZ"), "lon": lon, "lat": lat,
                                          "pool": "kazakhstan", "country": "Kazakhstan", "stratum": None,
                                          "utm_epsg": utm_epsg(lon, lat)}))
    bare = ee.ImageCollection("ESA/WorldCover/v200").first().select("Map").eq(60).rename("bare_frac")
    result = bare.reduceRegions(ee.FeatureCollection(tiles), ee.Reducer.mean(), scale=500).filter(ee.Filter.gte("bare_frac", .5)).limit(count)
    if result.size().getInfo() < count:
        raise RuntimeError("insufficient eligible Kazakhstan candidates; enlarge sampling before export")
    return result
