# Written with AI assistance (Codex); human review pending.
"""Monthly observed snow-free fractions; invalid MODIS flags are excluded."""
from typing import cast

from pipeline.earth.pool import initialize_ee


def snow_free_frac(fc, *, project=None, start_year=2001, end_year=2024):
    ee = initialize_ee(project)
    collection = ee.ImageCollection("MODIS/061/MOD10A1").filterDate(f"{start_year}-01-01", f"{end_year+1}-01-01")

    def observed(image):
        snow = image.select("NDSI_Snow_Cover")
        return snow.lt(10).updateMask(snow.gte(0).And(snow.lte(100)))

    months = [collection.filter(ee.Filter.calendarRange(m, m, "month")).map(observed).mean().rename(f"m{m}") for m in range(1, 13)]
    image = ee.Image.cat(months)
    rows = cast(dict, image.reduceRegions(fc, ee.Reducer.mean(), scale=500).getInfo())["features"]
    return [{"id": f["properties"]["id"], "snow_free_frac": [f["properties"].get(f"m{m}") for m in range(1, 13)]} for f in rows]
