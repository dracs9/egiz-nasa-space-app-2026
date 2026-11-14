# Geospatial data interface — `geo-0.1.0`

Owner: Geo lead. Consumers: ML engineer (`pipeline/ml/`), frontend engineer (`web/`).
Status: **PROPOSED** — field names are frozen once both consumers acknowledge (see `docs/geo/INTEGRATION_NOTE_*.md`). After that, any rename or unit change bumps `schema_version` and is announced first.

Written with AI assistance (Claude Code); reviewed by: pending.

## 1. Where things are

```
data/geo/geo-0.1.0/                     <- committed, small, LF line endings (.gitattributes: -text)
  aoi_catalog.json                      web: one record per AOI (markers, footprints, coverage, missing)
  aoi_features.csv                      ML: one row per AOI, wide, unit-suffixed columns
  aoi_features.columns.json             column dictionary: unit, description, evidence class, source per body, method
  patch_index.csv                       ML: one row per analysis raster (patch)
  manifests/sources.json                source registry (provider, product id, version, licence, citation, period)
  manifests/assets.json                 every raster: path, sha256, bytes, CRS, transform, units, datum, nodata, resolution
  manifests/coverage.json               counts by body / pool / coverage level / stage / variable / source
  quality/<aoi_id>.json, REPORT.md      per-AOI QA checks and missing-data reasons
  illumination/real_dem_shadows.json    real-DEM shadow products (section 7)
data/derived/geo-0.1.0/                 <- NOT committed (rebuild): per-AOI records, analysis grids (GeoTIFF)
data/raw/geo/                           <- NOT committed: cached native source windows/products + .meta.json sidecars
contracts/geospatial/*.schema.json      JSON Schemas; patch_index.columns.md
```

Rebuild everything from scratch: `python -m pipeline.geodata acquire --scope all && python -m pipeline.geodata manifest && python -m pipeline.geodata validate` (or `make geo-acquire geo-manifest geo-validate`). Re-running downloads nothing that is already cached.

## 2. Identifiers (keep them distinct)

| ID | Meaning | Example |
|---|---|---|
| `site_id` | a physical place (named site or sampled cell); one per location | `SITE_BOZJYRA_KZ` |
| `aoi_id` | one measured 22 km window around the site centre; one AOI per site in this release | `PILOT_BOSZHIRA`, `SM_E012.345_N34.567` |
| `group_id` | spatial block for **leakage-safe splits**: Earth 2°×2° cell (`EARTH_GN42E054`), `MOON_SOUTH_POLE`, `MARS_JEZERO` | |
| tile | source raster tile URL(s), in `patch_index.source_tiles` and `assets.tiles` | Copernicus 1° tile |
| `patch_id` | one analysis grid: `<aoi_id>__DEM_P<pixel_m>` | `PILOT_UTAH__DEM_P50` |

Pilot `aoi_id`s are unchanged from `data/pilot/earth_candidates.json` so existing web references keep working. **ML: split by `group_id`, never by row or patch.** All Moon AOIs share one group (overlapping south-pole region); treat Moon/Mars as held-out reference targets, not training rows.

## 3. Coordinates, CRS, units

- Centroids: planetocentric longitude/latitude in degrees, east-positive, −180…180 (Earth: WGS84). `footprint.ring_lonlat` is the closed 22 km window corner ring in the body's geographic CRS.
- Analysis grids are **local, north-up, square-pixel metric grids** centred on the AOI (never raw EPSG:4326 pixels):
  - Earth: UTM zone of the centre (`pipeline/earth/pool.py:utm_epsg`), heights m above EGM2008 geoid (Copernicus is a surface model — includes vegetation/buildings).
  - Moon: azimuthal equidistant on sphere R = 1 737 400 m; heights m relative to that sphere (PGDA).
  - Mars: azimuthal equidistant on sphere R = 3 396 190 m; heights m relative to that sphere (USGS blend).
- Resampling: all-valid **average** from source to grid (`pipeline/planets/access.py:to_local_grid`); a grid pixel is NaN unless every contributing source pixel is valid. Grids are never finer than the source posting (no upsampling): Earth 50 m and 200 m from ~30 m; Moon 50 m and 200 m from 5 m; Mars 200 m from 200 m.
- Units are in column names: `_deg`, `_m`, `_c` (°C), `_mm`, `_frac` (0…1), `_ma` (million years), `_per_m` (1/m), `_unitless` (−1…1), `_label` (text).

## 4. Missing data

- CSV: **empty cell**. JSON: `null`. Never 0, never NaN literals.
- Every missing value has a reason in `aoi_catalog.json → missing[<column>]` and `quality/<aoi_id>.json`.
- `not_comparable: …` — an Earth atmosphere/land-cover variable that has no measured counterpart on the Moon/Mars. We do **not** copy Earth variables or engine conventions (e.g. `precip_mm = 0` used in `targets.json`) into this table.

## 5. Feature columns (`aoi_features.csv`)

Bookkeeping: `aoi_id, site_id, group_id, body, pool, lon, lat, coverage_level, quality_status`.

| Family | Columns | Evidence | Source |
|---|---|---|---|
| Core terrain (shared function `pipeline/common/terrain.py:terrain_attributes`, unchanged) | `slope_f{B}_p50_deg, slope_f{B}_p90_deg, frac_lt10_f{B}, frac_lt20_f{B}, tri_f{B}_m` (fine baseline B: Earth 400 & 100, Moon 100, Mars 400); `slope_r_p50_deg, slope_r_p90_deg, frac_lt20_r, relief_m, elev_min_m` (2 km baseline, 200 m grid) | derived | COP_GLO30 / PGDA_LOLA_5MPP / USGS_MARS_BLEND |
| Supplementary terrain (`pipeline/geodata/features.py:extra_terrain`) | `elev_p05_m, elev_p50_m, elev_p95_m, elev_std_m`; `slope_f{B}_mean_deg, _std_deg`; `slope_f{B}_bin_{0_5,5_15,15_30,gt30}_frac`; `aspect_northness_mean_unitless, aspect_eastness_mean_unitless, aspect_sloped_frac`; `curv_lap_f{B}_std_per_m`; `dem_valid_frac` | derived | as above |
| Land cover (Earth) | `tree, crop, built, bare, snow, water, grass_shrub, moss_lichen _frac`, `landcover_classified_frac` | proxy (classified-map area fractions) | ESA_WC_V200 |
| Climate (Earth) | `t2m_max_warmest_month_c, t2m_min_coldest_month_c, t2m_mean_annual_c, t2m_seasonal_range_c, precip_annual_mm` | modelled (reanalysis climatology) | NASA_POWER_CLIM |
| Geology (Earth) | `geo_unit_name_label, geo_lith_label, geo_age_interval_label, geo_age_top_ma, geo_age_bottom_ma, geo_map_scale_label` | proxy (map category at AOI centre) | MACROSTRAT |

Critical distinctions:
- `t2m_*` is **2 m air temperature** from a MERRA-2-based climatology at a 0.5° cell — not land-surface temperature, not an observation at the AOI, not the conditions at any mission date. MODIS LST (`lst_*_c`, observed) would be added as separate columns when Earth Engine credentials exist; it is never merged into `t2m_*`.
- `geo_lith_label` is a geologic-map description, **not** spectral/mineralogical evidence. Map scale is recorded because unit boundaries at "small"/"tiny" scale can be kilometres off.
- Moon/Mars: terrain only. Surface temperatures for targets remain the curated literature values in `data/curated/targets.csv` (owned by science), not in this table.

## 6. Coverage levels

`L0_sampled` (AOI defined) → `L1_dem` (DEM terrain computed, core ≥ 90 % valid) → `L2_environment` (land cover with ≥ 99 % classified + climate) → `L3_geology` (map unit found) → `L4_validated` (all body-applicable stages done and every QA check passed). Moon/Mars: only the DEM stage applies, so `L4` there means "terrain complete and QA-passed", not "has environment data". Use `stages` to see exactly which stages ran (`ok`, `failed`, `not_applicable`, `no_data`). An AOI never advances past a failed or missing stage.

## 7. Illumination products

`illumination/real_dem_shadows.json` (`pipeline/lighting/real_shadows.py`): shadow fraction of the central 10 km on **real 50 m grids** (Mons Mouton + Earth pilots).
- `controlled_same_incidence`: identical h ∈ {1.5, 3, 5, 10, 20}°, az ∈ {0, 90, 180, 270}°. Compares terrain geometry only.
- `actual_local_sun`: Earth — NOAA solar positions over 2025 (10 min) and shadow at a real 5° equatorward Sun; Moon — geometric bound h_max = 90 − |lat| + 1.54°. A SPICE time series is not computed in this release.
- Shadows ignore terrain beyond the 22 km window (low-Sun fractions are lower bounds). A same-angle comparison is **not** an equivalent illumination environment (29.5 d synodic day and 1.54° obliquity on the Moon, no atmosphere/diffuse light, vs. Earth's 24 h day, 23.44° obliquity and scattering sky).

## 8. For the web app

Load only `aoi_catalog.json` (≈ tens of KB per hundred AOIs) for markers, footprints (`ring_lonlat`), `coverage_level`, `quality_status`, `summary` and `missing`. Rasters are never needed for display. If a terrain preview is wanted, ask the Geo lead for small PNG/JSON exports; do not fetch GeoTIFFs from the browser.

## 9. Versioning

`schema_version` (contract, semver; 1.x additive only) and `dataset_version` (`geo-MAJOR.MINOR.PATCH`, new data) are in every JSON file. A new dataset version gets a new directory; old directories are not edited.
