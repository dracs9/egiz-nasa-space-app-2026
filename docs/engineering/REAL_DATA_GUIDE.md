# Real data acquisition and the measured pilot

**20 October: optional scientific geometry.** Install `.venv/bin/python -m pip install -e '.[science]'`, then `make science-fetch` and `make science-build` to reproduce genuine NASA CSPICE solar/Earth geometry for the existing 11 measured origins. Kernel URLs and exact SHA-256 values are pinned in `data/kernels/manifest.json`; downloads are checked, binaries ignored, computed records packaged separately. `make science-serve` enables custom epochs through Vite. This does not acquire better terrain or observed weather. See [engine provenance, runtime and frame limitations](SCIENTIFIC_ENGINES.md).

Written with AI assistance (Codex); human and scientific review pending. Commands below were run on 2026-10-15. Implementation authorization from the current user does not establish competition organizer permission or preregistration.

The application now defaults to the labelled measured pilot for new visitors; explicit source links and saved preferences take precedence. The synthetic software demonstration remains separately selectable. The **Measured terrain pilot** option now loads `data/pilot/` through a separate packaged data source: two planetary targets, nine Earth windows, 1,800 latitude bins, and exploratory engine output. Share it with `/#/campaign?data=pilot`. It is incomplete for global inference. WorldCover land-cover fractions are measured from a classified map. Climate, seasonal snow availability and target surface temperatures are missing, not simulated. Do not copy this pilot into `data/processed/` or describe its rankings as validated best analogs. Its validation envelope explicitly records all observational experiments as `not_run`; it has no preregistration record.

The build packages `/data/demo/`, `/data/pilot/` and, only when complete, `/data/observed/`. Files from different sources cannot be mixed; flags, `FAKE_` references and stale input hashes cause rejection. Source changes clear incompatible selections, cancel superseded loads and preserve the chosen source in the URL. A failed load stays an error until an explicit retry or source change. Measured mode does not request synthetic Same-Sun frames.

## Installation

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[dev,earth]'
```

Source inputs belong in ignored `data/raw/`. No credentials are included. The checked-in manifest and JSON outputs are small; the original lunar raster is approximately 108 MB and is intentionally excluded from Git.

## Public planetary sources

The [NASA PGDA product 78](https://pgda.gsfc.nasa.gov/products/78) links the exact Site20 and extended Site20v2 elevation products. The original Site20 is 3,200 × 3,200 pixels at 5 m, or **16 × 16 km**. Its extent center (native x=73,000 m, y=118,000 m) defines the pilot lunar center, 31.7427611534° E, 85.4265772804° S. This is a raster analysis center, not an official selected base site. The extended Site20v2 is used for the actual pilot calculations.

```sh
.venv/bin/python -m pipeline.planets.access download \
  https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site20v2/Site20v2_final_adj_5mpp_surf.tif \
  data/raw/targets/Site20v2_final_adj_5mpp_surf.tif
.venv/bin/python -m pipeline.planets.access spike \
  data/raw/targets/Site20v2_final_adj_5mpp_surf.tif \
  --lon 31.7427611534 --lat -85.4265772804 --body moon --half-m 11000
```

The current [USGS Mars blended DEM metadata](https://astrogeology.usgs.gov/search/map/Mars/Topography/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendShade_Global_200mp_v2.lbl.xml) links the source GeoTIFF below. Direct HTTP range reads succeeded even though the legacy Astropedia human-readable page did not load in one browsing attempt. **Do not download the approximately 11 GB global file** to get a local window.

```sh
.venv/bin/python -m pipeline.planets.access spike \
  https://planetarymaps.usgs.gov/mosaic/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif \
  --lon 77.4509 --lat 18.4446 --body mars --half-m 11000
```

The measured Jezero native subset was 111 × 117 pixels, all finite, with elevations −2,732 to −1,638 m. `access.read_window` returns `(z, affine, CRS)`; use rasterio to persist this subset, or pass the remote URL directly to the target builder. Planets are averaged onto local AEQD grids using the documented body radii; Earth uses the site's UTM zone. A separate validity reprojection rejects averages containing source nodata.

```sh
.venv/bin/python -m pipeline.planets.targets \
  --dem MOON_MONS_MOUTON=data/raw/targets/Site20v2_final_adj_5mpp_surf.tif \
  --dem MARS_JEZERO=https://planetarymaps.usgs.gov/mosaic/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif \
  --out data/pilot/targets.json
```

Only rows in `data/curated/targets.csv` are emitted. Every target must have a source registry key and a readable DEM; a missing product aborts the command. Temperatures stay null until location-specific source values are reviewed.

## Public Earth fallback and local ingestion

[Copernicus DEM on AWS](https://registry.opendata.aws/copernicus-dem/) provides public COGs without an AWS account. These are digital surface models, not bare-earth field measurements. The fallback reads one degree tile per requested window and refuses truncation at a tile boundary; supply a local adjacent-tile mosaic when needed.

```sh
.venv/bin/python -m pipeline.earth.public_dem \
  --lon -111.628601417 --lat 35.5733252222 --out data/raw/earth_dem30/SP_CRATER.tif
.venv/bin/python -m pipeline.earth.public_dem \
  --lon -116.82 --lat 36.24 --out data/raw/earth_dem30/DEATH_VALLEY.tif
.venv/bin/python -m pipeline.earth.public_dem \
  --lon 51.2 --lat 43.4 --out data/raw/earth_dem30/MANGYSTAU.tif
.venv/bin/python -m pipeline.earth.export \
  --manifest data/pilot/earth_manifest.csv --out data/pilot/earth_candidates.json
```

The two non-practice grid centers are pilot choices, not independently established analogs. The Kazakhstan center comes from the supplied planning examples; its suitability is unassessed. The S P coordinate is a nearby documented AZGS image viewpoint, not a published JETT traverse coordinate. These differences are material for validation.

The local manifest requires `id,lon,lat,dem,source_url`. Optional fields include `pool,stratum,name,country,dataset,provider,source_version`, environment attributes and cover context. Relative DEM paths resolve against the manifest directory. Supplied environment or context values additionally require `env_source_url`. Unobserved fields are null and listed in `missing`.

`data/pilot/acquisition_report.json` records source SHA-256 hashes, native bounds and CRS, local grid sizes and measured valid fractions. Earth source boundaries cause a small fraction of missing margin pixels; missing values are retained. The actual analysis core is measured by the shared terrain module. This pilot has no independent GEE/Python E2b comparison.

## Earth Engine route

```sh
earthengine authenticate
export EE_PROJECT=your-enabled-google-cloud-project
make earth EARTH_COUNT_PER_STRATUM=10 EARTH_OUT_DIR=data/real_smoke
# Full provisional pool, environment, optional snow and Kazakhstan candidates:
make earth EARTH_ARGS="--snow --kazakhstan-count 200"
# Equivalent direct command:
.venv/bin/python -m pipeline.earth.acquire --project your-enabled-google-cloud-project \
  --count-per-stratum 10 --out-dir data/real_smoke --snow
# Individual stages remain available for source inspection:
.venv/bin/python -m pipeline.earth.pool --out data/raw/earth_pool.geojson
.venv/bin/python -m pipeline.earth.gee_terrain data/raw/earth_pool.geojson \
  --stage a --out data/raw/earth_stage_a.json
.venv/bin/python -m pipeline.earth.gee_terrain data/raw/earth_pool.geojson \
  --stage b --out data/raw/earth_stage_b.json
```

This session did not have an authenticated `EE_PROJECT`, so the GEE route was **not executed**. `initialize_ee` fails with a required-project/authentication message rather than generating replacement observations. Authentication remains an external prerequisite.

`make earth` now calls the real acquisition orchestrator, rather than displaying help. `PROJECT=...` optionally overrides `EE_PROJECT`; `EARTH_COUNT_PER_STRATUM`, `EARTH_OUT_DIR`, and `EARTH_ARGS` configure scope. `pipeline.earth.acquire` runs pool → terrain A → terrain B → environment → optional snow → export, validates exact ID consistency across stages, and preserves an existing artifact if acquisition fails. It emits `earth_acquisition_status.json` describing scope and remaining scientific limits. A missing project fails before reading authentication state or writing output. The optional `--kazakhstan-count` uses LSIB-clipped, barren-filtered Kazakhstan points. Only orchestration with injected mock adapters was tested locally; that verifies merging and error propagation, not the remote Earth Engine API.

`build_pool` samples real LSIB land, verifies barren fractions, includes practice sites and 20 verified controls per forest/crop/snow class. Default candidate strata use coarse latitude bands and are provisional geographic strata, not a verified global climate/volcano inventory. A volcanic stratum requires a documented source GeoJSON. Insufficient eligible observations abort acquisition with an explicit shortfall; sampling retries, global quota and timeout tuning still need an authenticated run.

`stage_a`/`stage_b` download Copernicus averages and run the same Python central-difference terrain calculation. This deliberately shares the definition, but does not supply an independent server-side E2b validation. At global scale per-tile downloads may require substantial quota/time; cached local rasters remain the fallback.

`gee_env.environment(fc)` applies mandatory-QA filtering and LST scale 0.02 K, returns spatial means of temporal P5 night/P95 day observations for 2015–2024, and computes IMERG monthly rates × actual month hours, annual sums averaged over 2001–2024. WorldCover fractions have MCD12Q1 barren fallback. `gee_snow.snow_free_frac(fc)` excludes non-observation flags and returns 12 monthly fractions. Null values remain missing. These network adapters have unit and geometry tests, but their service execution remains unverified without credentials.

## Lighting, engine, and validation

```sh
.venv/bin/python -m pipeline.lighting.windows \
  --targets data/pilot/targets.json --out data/pilot/sun_windows.json
.venv/bin/python -m pipeline.engine.templates --out data/pilot/mission_templates.json
.venv/bin/python -m pipeline.engine.run --data-dir data/pilot
.venv/bin/python -m pipeline.contracts.validate data/pilot/earth_candidates.json \
  data/pilot/targets.json data/pilot/mission_templates.json data/pilot/sun_windows.json data/pilot/results.json
.venv/bin/python -m pytest pipeline/common/tests/test_sun.py \
  pipeline/common/tests/test_shadows.py pipeline/common/tests/test_render.py \
  pipeline/planets/tests pipeline/earth/tests pipeline/lighting/tests
```

The full documented E1 geometry grid (7 latitudes × 4 dates × 48 daily samples) was compared with astropy `AltAz`, pressure=0, retaining geometric altitude >1°. Measured maximum altitude error was **0.0067051°**, maximum circular azimuth error **0.0957723°**, and horizon-sign agreement **100%** over 1,344 samples. A separate standard-atmosphere apparent-altitude test above 5° also passes; horizon refraction depends on atmospheric conditions. This establishes tested numerical behavior, not a preregistration claim or a scientific analog-validation result.

Tests also check metre-based square sizes, UTM zone exceptions, nodata propagation, projection grid size, all four cardinal shadow directions, 100 m step shadow length, and deterministic image output. Optional shadow curves and same-Sun renders require supplied DEM windows and document their finite-horizon limits.

`data/curated/practice_sites.csv` contains only one potentially testable source pair. The artificial-light JETT3 case is explicitly excluded from natural-light validation. E3 requires at least eight preregistered evaluable pairs, reviewed science parameters, source-specific target temperatures, full environmental coverage, a global pool, and a genuine preregistration commit. None of those missing prerequisites is implied by passing software tests or producing exploratory pilot results.


## 17–18 October expansion and reproduction

The pilot now contains nine deliberately selected Earth windows, including two Kazakhstan windows. The six additions (Atacama, Utah, Iceland, Wadi Rum, Rio Tinto, Boszhira) were acquired from actual public Copernicus COGs during this session. Coordinates and source tile URLs are in `data/pilot/earth_manifest.csv`; cache hashes are in `earth_acquisition_report.json`. Names label regional sample windows, not independently established analogs or approved field sites. No global inference follows from this pilot.

```sh
.venv/bin/python -m pipeline.earth.public_cover
.venv/bin/python -m pipeline.earth.pilot
.venv/bin/python -m pipeline.planets.targets \
  --dem MOON_MONS_MOUTON=data/raw/targets/Site20v2_final_adj_5mpp_surf.tif \
  --dem MARS_JEZERO=data/raw/targets/Jezero_MOLA_HRSC_200m.tif \
  --out data/pilot/targets.json
.venv/bin/python -m pipeline.engine.run --data-dir data/pilot
.venv/bin/python -m pipeline.common.evidence
make check
```

The planetary cache prerequisites and source URLs are documented above; a fresh checkout must acquire them first. The prior acquisition report remains historical. The new `terrain_evidence.json` is a small precomputed observation-derived product for offline inspection, not live elevation acquisition. Rebuild it whenever candidate/target inputs change: packaging rejects stale hashes. The new preference explorer loads fixed objective scores, computes exact switching priorities and can apply them to the one-site campaign. Site dossiers export source-bound Markdown field verification checklists.

All regional target attributes now use the same 200 m pixel sampling as Earth. This corrects the earlier lunar regional sampling; fine 100 m lunar baseline attributes continue to use 50 m pixels. Details and validation: [implemented methodology](../SCIENTIFIC_METHODOLOGY.md), [validation](../SCIENTIFIC_VALIDATION.md).

## Copernicus attribution

Derived terrain products are produced using Copernicus WorldDEM-30. © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.

Dataset accessed from the [AWS registry](https://registry.opendata.aws/copernicus-dem/) on 15 and 17 October 2026. The [provider's license and citation guidance](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM) applies independently of the code license. Elevation colors and surfaces are computed from the data, not AI-generated imagery.


## ESA WorldCover pilot context

On 18 October 2026 (Asia/Almaty), public WorldCover 2021 v200 COG windows were acquired for all nine centers. `pipeline.earth.public_cover` caches 10 m categorical UTM windows, checks ≥99% classified coverage, writes cover fractions/source metadata atomically to the manifest, and records raw hashes in `data/pilot/landcover_report.json`. Run it before Earth ingestion. Source: [ESA data access, license and citation](https://esa-worldcover.org/en/data-access), [Zanaga et al. 2022 DOI](https://doi.org/10.5281/zenodo.7254221), CC BY 4.0. No current access or field condition is inferred.

The original coastal window at 51.2 E, 43.4 N is 95.8658% mapped permanent water. It remains in the catalog as a transparent rejected candidate; the existing ≤50% water constraint excludes every one of its objectives. It was not moved to a more convenient coordinate. `landcover_report.json` is the actual measurement record. WorldCover's annual snow/ice class does not replace monthly snow-free data.
