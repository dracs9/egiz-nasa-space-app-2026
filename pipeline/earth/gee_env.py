# Written with AI assistance (Codex); human review pending.
"""Source-scaled surface temperature, precipitation and land cover from GEE."""
import calendar

from pipeline.earth.pool import initialize_ee


def lst_c(raw):
    return None if raw is None else raw*.02 - 273.15


def monthly_precip_mm(rate_mm_h, year, month):
    return None if rate_mm_h is None else rate_mm_h*24*calendar.monthrange(year, month)[1]


def environment(fc, *, project=None, start_year=2015, end_year=2024, precip_start_year=2001):
    """Temporal per-pixel P5/P95 LST, annual mean precipitation, area fractions.

    LST keeps mandatory-QA good pixels (bits 0–1 == 0). No air temperatures or
    invented missing observations are substituted. Returned rows merge by id.
    """
    ee = initialize_ee(project)
    if not hasattr(fc, "getInfo"):
        fc = ee.FeatureCollection(fc)
    start, end = f"{start_year}-01-01", f"{end_year+1}-01-01"

    def lst(collection, band, qc):
        def scale(image):
            keep = image.select(qc).bitwiseAnd(3).eq(0)
            return image.select(band).multiply(.02).subtract(273.15).updateMask(keep).rename("temperature")
        return ee.ImageCollection(collection).filterDate(start, end).map(scale)

    day = lst("MODIS/061/MOD11A2", "LST_Day_1km", "QC_Day").merge(lst("MODIS/061/MYD11A2", "LST_Day_1km", "QC_Day"))
    night = lst("MODIS/061/MOD11A2", "LST_Night_1km", "QC_Night").merge(lst("MODIS/061/MYD11A2", "LST_Night_1km", "QC_Night"))
    temp = night.reduce(ee.Reducer.percentile([5])).rename("t_min_c").addBands(day.reduce(ee.Reducer.percentile([95])).rename("t_max_c"))

    def precip(image):
        date = ee.Date(image.get("system:time_start"))
        hours = date.advance(1, "month").difference(date, "hour")
        return image.select("precipitation").multiply(hours).copyProperties(image, ["system:time_start"])

    monthly = ee.ImageCollection("NASA/GPM_L3/IMERG_MONTHLY_V07").filterDate(f"{precip_start_year}-01-01", end).map(precip)
    annual = ee.ImageCollection.fromImages([monthly.filterDate(f"{y}-01-01", f"{y+1}-01-01").sum() for y in range(precip_start_year, end_year+1)])
    rain = annual.mean().rename("precip_mm")
    cover = ee.ImageCollection("ESA/WorldCover/v200").first().select("Map")
    fallback = ee.ImageCollection("MODIS/061/MCD12Q1").filterDate("2021-01-01", "2022-01-01").first().select("LC_Type1").eq(16)
    bands = cover.eq(60).unmask(fallback).rename("bare_frac")
    for name, code in [("tree_frac", 10), ("crop_frac", 40), ("built_frac", 50), ("water_frac", 80), ("snow_frac", 70)]:
        bands = bands.addBands(cover.eq(code).rename(name))
    # Preserve native product scales. Sampling all bands at 1 km would destroy
    # the narrow water/built fractions used by objective constraints.
    merged = {}
    for image, scale in [(temp, 1000), (rain, 11000), (bands, 100)]:
        for feature in image.reduceRegions(fc, ee.Reducer.mean(), scale=scale).getInfo()["features"]:
            props = feature["properties"]
            row = merged.setdefault(props["id"], {"id": props["id"], "attrs": {}, "context": {}})
            for key in ["t_min_c", "t_max_c", "precip_mm", "bare_frac"]:
                if key in props:
                    row["attrs"][key] = props[key]
            for key in ["tree_frac", "crop_frac", "built_frac", "water_frac", "snow_frac"]:
                if key in props:
                    row["context"][key] = props[key]
    return list(merged.values())
