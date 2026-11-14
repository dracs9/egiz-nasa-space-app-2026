# Geospatial baseline audit (07.11.2026)

Branch `geo/data-foundation`, base commit `9e81c36`. Everything below was checked in this checkout today; earlier reports were not trusted. Written with AI assistance (Claude Code); reviewed by: pending.

## 1. Environment and tests

- No `.venv` existed; global Python 3.13.3 had no numpy/rasterio. Created `.venv` from `requirements.txt` (rasterio 1.5.2, pyproj 3.8.0, numpy 2.5.4, scipy 1.18.1, astropy 8.0.2, jsonschema 4.26.0, earthengine-api). `Makefile` uses POSIX `.venv/bin/python`; on Windows the venv is `.venv/Scripts/python.exe` (fixed in the Makefile `PYTHON` detection).
- Baseline `pytest -q`: **131 passed, 18 skipped, 1 failed**.
  - Skips: optional `spiceypy`, `mujoco`, `Basilisk` not installed.
  - Failure: `tests/test_contracts.py::test_committed_bundle_integrity` — `earth_candidates_sha256 is stale`. Cause: `git config core.autocrlf=true` on this Windows checkout converts committed LF JSON to CRLF, so file hashes differ. Not a data error; fix is a `.gitattributes` rule for `data/fixtures` (root config, owner tech lead — integration request filed). The new release ships its own `data/geo/<ver>/.gitattributes` (`-text`).

## 2. Modules (all exist)

| Module | Network | Status |
|---|---|---|
| `pipeline/common/terrain.py` (`terrain_attributes`, `slope_at_offset`) | no | used unchanged by the new pipeline |
| `pipeline/common/sun.py`, `shadows.py`, `render.py` | no | used unchanged |
| `pipeline/common/evidence.py`, `mission_terrain.py`, `terrain_pyramid.py` | yes (via `planets.access`) | not touched |
| `pipeline/earth/pool.py`, `kz.py`, `gee_terrain.py`, `gee_env.py`, `gee_snow.py`, `acquire.py`, `dem_windows.py` | Earth Engine | **never validated live**: `.env.example` has empty `EE_PROJECT`, no credentials on this machine |
| `pipeline/earth/public_dem.py` | public COG | single 1° tile only; rejects windows crossing a tile edge |
| `pipeline/earth/public_cover.py` | public COG | single 3° tile only; same edge limitation |
| `pipeline/earth/pilot.py`, `export.py`, `crosscheck.py`, `sanity.py` | partly | `ingest_local` reads local rasters that are no longer on disk |
| `pipeline/planets/access.py`, `targets.py`, `clones.py` | yes | `PRODUCTS` maps only Site01/Site20 (v1); curated targets use Site20v2 |
| `pipeline/lighting/windows.py`, `shadow_curves.py`, `renders.py`, `illum_check.py` | no | shadow curves only on supplied DEMs; no real-DEM shadow product existed |

## 3. Data on disk

| Path | Size | Content |
|---|---|---|
| `data/curated/` | 26 KB | 2 targets (Mons Mouton, Jezero), 14 sources, templates, practice sites |
| `data/pilot/` | 2.9 MB | 9 Earth windows (`earth_candidates.json`, `earth_manifest.csv`), targets, results, reports |
| `data/terrain/moon-mouton/` | 2.1 MB | 21 mesh tiles z0–z2 + manifest |
| `data/fixtures/` | 0.8 MB | synthetic fixtures (`synthetic: true`) |
| `data/dynamics/` | 7.1 MB | references.json |
| `data/raw/`, `data/processed/` | — | **absent** at audit time |

- No GeoTIFFs. `earth_manifest.csv` points at `../raw/earth_dem30/*.tif`; `earth_acquisition_report.json` records sha256 for files that are not present. The pilot is therefore **not reproducible from this checkout** without re-acquisition.
- 9 pilot windows: SP Crater (`PR_JETT_SP_CRATER`), Death Valley (`GL_W116.820_N36.240`), Mangystau/Caspian (`KZ_E051.200_N43.400`, water-dominated, excluded), Atacama, Utah, Iceland, Wadi Rum, Rio Tinto, Bozjyra (`PILOT_BOSZHIRA`). DEM attributes + WorldCover fractions present for all 9; **climate missing for all 9** (`t_min_c, t_max_c, precip_mm`).
- `data/pilot/targets.json` stores `precip_mm: 0`, `bare_frac: 1` for Moon/Mars by engine convention (`definition:EGIZ_METHOD`). Acceptable for the engine, but not measurements; the new feature table marks them `not_comparable` instead.
- Mons Mouton terrain pyramid: `manifest.json → sourceSha256 = 0e96c409…f072f`. Re-downloaded `Site20v2_final_adj_5mpp_surf.tif` today (108 192 905 bytes) has **the same sha256** → the committed tiles are verified to derive from the authentic PGDA product.

## 4. Contracts

- Root schemas: `earth_candidates, mission_templates, results, robustness, shadows, sun_windows, targets, validation` (1.x) and `dynamics_experiment, engineering_session, power_observations` (1.0.0).
- No contract for `mission_terrain.json`, `terrain_evidence.json`, report JSONs. No `contracts/geospatial/` (now added).

## 5. Source access checks (today)

| Source | Access | Result |
|---|---|---|
| Copernicus GLO-30 COG (AWS) + `tileList.txt` | anonymous HTTPS range reads | OK (26 450 tiles listed) |
| ESA WorldCover v200 COG (AWS) | anonymous | OK |
| PGDA LOLA 5 mpp Site01/04/07/11/20/20v2/23 | anonymous HTTPS | OK, slow/stalling server → resumable Range downloads added |
| USGS MOLA/HRSC blend 200 m v2 | 302 → AWS S3 COG | OK, windowed reads |
| NASA POWER climatology API | anonymous | OK (period 2001–2025, API v2.10.1) |
| Macrostrat API v2 | anonymous, CC BY 4.0 | OK |
| Earth Engine (MODIS LST, IMERG, MOD10A1, NASADEM) | needs `EE_PROJECT` + auth | **not available** |
| ERA5-Land (CDS), Earthdata (AppEEARS, IMERG direct) | needs accounts/keys | **not available** |

## 6. Gaps and quick wins

1. Rebuild the pilot from public sources with checksums → done in `geo-0.1.0` (multi-tile mosaics fix edge truncation).
2. Climate gap → filled with NASA POWER (modelled air temperature/precip, clearly labelled); MODIS LST still pending credentials.
3. No geology → Macrostrat map units (proxy) added for Earth.
4. No staged coverage / AOI catalog / patch index → added.
5. Not done: Landsat/Sentinel-2 spectral products, HiRISE/CTX/THEMIS, planetary geology/mineralogy, SPICE time series (see `docs/geo/UNAVAILABLE_AND_GAPS.md`).
