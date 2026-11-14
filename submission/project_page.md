# EGIZ — Earth-wide search for Moon and Mars analog sites

## High-level summary

EGIZ searches the whole Earth for places that resemble a lunar south-pole base site or a Mars landing site, and shows exactly where each analogy breaks. It ranks 4,544 measured 22 km Earth windows against 10 targets (six lunar, four Martian) on eight measured dimensions — terrain at three scales, exposed ground, lithology, aridity, temperature and Sun geometry — with Monte Carlo uncertainty, and reports four more (mineralogy, dust, ice, caves) as not assessed instead of guessing. Each candidate gets a dossier and a computed gap ledger: gravity, pressure, radiation and rover-performance differences no Earth site can close. A benchmark against published analog sites, with a deliberately hard control, says how far to trust the ranking. A Kazakhstan chapter zooms from 75 km to 20 km around promising windows in Mangystau and Ustyurt. Everything is computed from public NASA and ESA data, and every number traces to code.

## Project details

**What it does.** Pick a target (e.g. Jezero crater). EGIZ scores every Earth window dimension by dimension, aggregates fidelity × coverage, and returns a geographically diverse shortlist with 90 % intervals, Earth-wide percentiles, rarity and novelty. Opening a candidate shows matched and mismatched dimensions, the gap ledger, and a rover experiment; from there the user can test the terrain in Mission Lab (rover, lander, EVA models on measured 200 m grids) or a 3D world built from LOLA 5 m and HiRISE data.

**Headline finding, stated honestly.** For Jezero, the closest window found is in western China (37.97° N, 88.24° E; fidelity 0.63, 90 % interval 0.42–0.96). In Kazakhstan, a Mangystau window ranks 43rd of 4,544 (99.0th percentile) and Boszhira's benchmark window sits at the 97.3rd percentile; a 20 km refinement near Mangystau reaches a would-be rank of 25. But against bare, arid, latitude-matched land the method's AUC for Jezero is only 0.48 (0.30–0.66): it separates analog sites from forests and farmland, not from generic desert. These are field-check leads, not proven analogs — and every lunar top window is labelled "closest found — weak match".

**How it works.** Python pipeline (`pipeline/discovery`): acquisition with HTTP range reads of public COGs and APIs, feature extraction with per-feature uncertainty and evidence class (observed / derived / modelled / proxy / literature), distribution-aware similarity, Monte Carlo propagation, validation with ablation, weight sensitivity and seed reproducibility, and a hashed, reproducible bundle (`python -m pipeline.discovery verify`). React/TypeScript front end with parity tests against the Python reference.

**Limits.** Similarity is not suitability: access, permits and safety are not assessed. Positive labels reflect where past campaigns ran. The rover model is a static Bekker estimate; Mars runs reuse lunar soil parameters. Full list: `docs/discovery/LIMITATIONS.md`.

## NASA data

* LOLA 5 m/px DEMs of the lunar south pole — NASA GSFC Planetary Geodesy Data Archive (PGDA)
* MOLA (Mars Global Surveyor) within the USGS HRSC/MOLA blended Mars DEM (200 m)
* NASA POWER climatology 2001–2025 (2 m air temperature, precipitation)
* HiRISE (Mars Reconnaissance Orbiter) Jezero terrain, via USGS
* SPICE kernels, NASA NAIF (solar and Earth geometry)

## Space agency partner data

* Copernicus DEM GLO-30 (ESA / Copernicus programme) — Earth terrain
* ESA WorldCover 2021 v200 — Earth land cover

## References

Datasets, software libraries and licences are listed in `submission/references.md` and `docs/discovery/DATASETS.md` (with endpoints, versions and checksums in the bundle manifest). Code is MIT licensed (`LICENSE`).

## Use of AI

See `submission/ai_use.md` (the text of that file's first section is the field content).
