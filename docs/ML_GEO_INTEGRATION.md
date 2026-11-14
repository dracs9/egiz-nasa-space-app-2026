# ML ↔ geo-0.1.0 integration · 14 November 2026

Written with AI assistance (Claude Code); human review pending. Reply to `docs/geo/INTEGRATION_NOTE_ML.md`. The release files (`data/geo/geo-0.1.0`, `contracts/geospatial`, `docs/GEOSPATIAL_DATA_INTERFACE.md`, `docs/geo/`) were taken unchanged from `origin/geo/data-foundation` (234ae86).

## Acknowledgement to the Geo lead

**ACK for field freeze of schema 1.0.0** with no rename requests. The ML adapter (`pipeline/ml/geo.py`) reads `aoi_catalog.json`, `aoi_features.csv`, `aoi_features.columns.json` and `manifests/sources.json`; validates the catalog and column dictionary against `contracts/geospatial`; checks dataset/schema versions, the column dictionary, engine-column units and CSV↔catalog AOI agreement; hashes every file read.

Requests for a later 1.1 (additive, not blocking):
1. `country` for sampled AOIs (empty today; useful for display only).
2. MODIS LST columns `lst_*_c` and GPM IMERG precipitation, which are what the engine's `t_min_c`, `t_max_c`, `precip_mm` are defined as.
3. Committed small patch rasters, or a reproducible fetch that the ML tests can run (needed only for Stage 3).

## How the release is used

- Candidates: the 329 Earth AOIs (`quality_status = pass`, coverage ≥ `L1_dem`); Moon/Mars rows are never candidates. Targets, templates and Sun windows still come from `data/pilot`.
- Engine attributes copied 1:1 (same `terrain_attributes` definition and baselines): `slope_f{400,100}_*`, `frac_lt*`, `tri_*`, `slope_r_*`, `frac_lt20_r`, `relief_m`, `elev_min_m`, `bare_frac`; constraints use `water/built/tree/crop/snow_frac`.
- **Not substituted:** `t2m_*` (modelled air temperature) is not used as `t_min_c`/`t_max_c` (spec: MODIS LST); POWER `precip_annual_mm` is not used as `precip_mm` (spec: IMERG). They appear in `explanation.context.environment` with `evidence: modelled`. Cold/dry objectives O5 and M4 therefore stay non-computable — a science decision, see open question 9.
- Geology labels appear in `explanation.context.geology` with `evidence: proxy`; `geological_similarity` stays `not_available` (no harmonised Moon/Mars geology).
- Every candidate carries `site_id`, `group_id`, `coverage_level` for leakage-safe evaluation in Stage 2.

`python -m pipeline.ml infer --geo data/geo/geo-0.1.0 --out artifacts/ml/discovery-geo` (or `make ml-infer-geo`): 9 schema-valid documents in ~22 s on CPU (15 MB, git-ignored).

## Results on 329 sites (exploratory, uncalibrated)

| Profile | Eligible | F ≥ 0.8 | Rank 1 (F, top-1 share under perturbation) | Best pilot |
| --- | --- | --- | --- | --- |
| Mars M1 landing hazard | 314 | 70 | SM_E056.315_N32.716 (0.999, 55%) | Iceland #20 |
| Mars M2 rover routes | 314 | 4 | SM_W109.248_N36.384 (0.993, 100%) | Iceland #5 |
| Mars M3 field geology | 296 | 6 | SM_E036.670_N20.393 (0.998, 100%) | Wadi Rum #6 |
| Moon O1 landing hazard | 314 | 7 | SM_E120.248_N47.202 (0.970, 67%) | Rio Tinto #38 |
| Moon O2 EVA/geology | 296 | 0 | SM_W074.290_S15.440 (0.770, 54%) | Death Valley #4 |
| Moon O3 LTV slope mobility | 314 | 0 | SM_E065.484_N34.688 (0.738, 76%) | Rio Tinto #31 |
| Moon O4 low-Sun ops | 314 | 0 | SM_E097.441_N79.268 (0.784, 100%) | Iceland #31 |
| O5 / M4 cold-dry | 0 | — | non-computable (engine climate attributes missing) | — |

Reading:
- With the pilot only, the best lunar landing-terrain match was F ≈ 0.11. In the sampled pool, 7 AOIs exceed 0.8. **The pilot windows were a weak sample for Mons Mouton terrain**, not evidence that such terrain is absent on Earth.
- Mars landing-terrain similarity is common (70 AOIs ≥ 0.8): flat, smooth terrain is not discriminating; the more specific rover-route and geology profiles are.
- Rank 1 under perturbation is often split between two near-equal sites (top-1 share 50–70 %), while top-3 membership is stable: report top-k sets, not a single winner.
- None of this is validated against documented analog use; that is Stage 2.

## Caveat found

AOIs at `L1_dem` have no land cover, so water/built constraints cannot be checked. The engine treats unknown context as "not asserted to fail" and still scores them (4 of the Mars M2 top 10). Their `operational_suitability` is `null` and the missing constraint values are listed, but the rank is not penalised. See open question 10.
