# Unavailable datasets, missing credentials, incomplete regions — `geo-0.1.0`

Written with AI assistance (Claude Code); reviewed by: pending.

## Credentials missing on the build machine

| Need | Unlocks | How to enable |
|---|---|---|
| Earth Engine project (`EE_PROJECT` + `earthengine authenticate`) | MODIS LST day/night (observed), MOD10A1 snow persistence, GPM IMERG, NASADEM cross-check, the ~3 000-square GEE pool (`pipeline/earth/pool.py`) | set `EE_PROJECT`, then run `make earth`; new columns `lst_*_c` are added next to (never instead of) `t2m_*_c` |
| Copernicus CDS key | ERA5-Land hourly/monthly | not planned for 0.1; POWER covers the climatology need |
| NASA Earthdata login | AppEEARS subsets, Diviner/PDS bulk products | optional |

## Datasets deliberately not acquired

- **Landsat / Sentinel-2 spectra**: large, cloud/season dependent; no agreed feature definition yet. Candidate for 0.2 (e.g. median-composite band ratios via Earth Engine).
- **HiRISE / CTX / THEMIS (Mars)**: footprints cover only parts of AOIs; would need per-site DTM selection. Jezero CTX DTM is a 0.2 candidate.
- **Planetary geology / mineralogy** (e.g. USGS SIM 3292 Mars map, lunar 1:5M map, CRISM, M3): not harmonised; columns `geo_*` are `missing` for Moon/Mars with a reason.
- **Water-ice evidence** (LOLA albedo, LEND, M3 ice detections): not included; any ice statement must cite literature via the science lead, separating direct evidence from proxies.
- **SPICE illumination time series**: `spiceypy` not installed in this environment; only the geometric h_max bound is reported for the Moon.

## Incomplete regions and coverage limits

- Earth sampling covers 60° S – 80° N (UTM/WorldCover-compatible tiles). **Antarctica is not sampled** (no McMurdo Dry Valleys), and polar sites north of 80° are excluded.
- Ocean-adjacent AOIs have partial DEM coverage (no Copernicus tile over open ocean) and may fail the 99 % WorldCover rule; they stay at `L1_dem` with reasons.
- Macrostrat coverage is uneven outside North America; AOIs without a mapped unit stay at `L2_environment` (`geology: no_data`).
- Mars: one target (Jezero). Other landing sites (Gale, Utopia/VL2, Terra Sirenum) need sourced coordinates in `data/curated/targets.csv` (science lead) before they can be added.
- Moon: PGDA sites overlap the same south-pole region; they form one leakage group and are reference targets, not independent training samples.
- Actual per-run counts are in `data/geo/geo-0.1.0/manifests/coverage.json`.
