# Validation record · 17–18 October 2026

**Status: software verified; exploratory observational calculations reproduced; external analog validity not established.** Tests on synthetic planes verify numerical behavior, not real field suitability. This session is independent development before the event. No preregistration is claimed retroactively. Existing `data/pilot/validation.json` observational experiment statuses remain `not_run`.

## Executed checks

Baseline `make check`: 111 pytest + 52 Vitest tests passed. After implementation and regional sampling correction: 115 pytest + 60 Vitest passed, along with Ruff, TypeScript, contracts, input hashes, coverage consistency, secret-pattern scan and production build. Subsequent evidence consistency/recovery checks are recorded in [IMPLEMENTATION_PROGRESS](IMPLEMENTATION_PROGRESS.md) with final counts.

New numerical checks cover planar slopes and profile spacing at both 50/200 m pixels, nodata propagation into surfaces/profiles, histogram counts, actual pilot histogram agreement with scoring fractions, common 200 m regional sampling, exact analytic preference switches including a 0.0002 percentage-point winning interval, equal/parallel lines, missing active evidence and invalid inputs. Every ordered objective pair in both measured target runs is checked against exhaustive ranking throughout its envelope. UI tests check Apply→optimizer agreement, stale input rejection, real/synthetic separation and terrain-fetch retry.

The lunar sampling regression independently computes 200 m regional attributes on a synthetic high-frequency surface and retains 50 m fine metrics. In the actual lunar pilot, regional P90 slope changed **21.565328° → 21.580438°**, relief **2551.275391 → 2549.963379 m**, and sampled minimum elevation **3117.205078 → 3150.247803 m**. The latter illustrates why pixel spacing matters. These are changes in raster-derived metrics, not new field observations.

## Actual pilot outputs after correction

| Target | Budget 1 | Budget 2 | Budget 3 | Interpretation |
| --- | --- | --- | --- | --- |
| Lunar Site20 extent center | 0.185467047 | 0.242645287 | 0.268203344 | Death Valley; then add Rio Tinto; then add Iceland for complementary objectives |
| Jezero | 0.571766835 | 0.643820127 | 0.643820127 | Iceland; add Wadi Rum for complementary objectives; third site supplies no gain |

These are weighted model coverage values within nine deliberately selected windows, not percentages of planetary equivalence. Missing objectives retain denominator weight. WorldCover 2021 supplies classified cover and context fractions. Terrain-only objectives can now have complete model inputs, while solar/weather and cold-environment objectives remain incomplete. The lunar cold objective and Martian cold objective have no eligible score. Complete model inputs do not establish physical or geological equivalence.

For lunar O1 vs O2, the exact frontier switches from the Rio Tinto window to the Death Valley window at **t = 0.16968240719550248**, where t is O2's normalized priority. At 10% O2, Rio Tinto leads; at 50%, Death Valley leads. This is a conditional model fact, not a validated preference between destinations. O2 uses terrain/cover proxies; no rock composition was measured. For Mars M1 vs M2, the Iceland window leads over the full M1/M2 priority interval; a third objective can still favor a complementary site. `node tools/benchmark_preference.mjs` reproduces the report in `artifacts/preference-benchmark.json`.

## Independent land-cover check changed the result

A browser review identified the original Mangystau coordinate as a degenerate flat DSM. Independent ESA WorldCover 2021 classification, sampled on a metric 20 km square, identifies **95.8658% permanent water**. The declared water constraint (≤50%) now excludes that window for every objective on both bodies. A regression checks its actual classified fraction, null constraint cells and absence from every selected campaign. No arbitrary flatness rejection or coordinate substitution was used.

WorldCover was acquired for all nine windows. Its class fractions change bare-surface fidelity as well as constraints; all target/candidate hashes, results, evidence and sensitivity outputs were recomputed. Before cover, the lunar switch was 20.90%; after the actual observed cover inputs it is **16.97%**. The earlier value is retained here as chronology, not as a current result. WorldCover classification error, a 2021 snapshot and nearest-neighbor resampling limit the interpretation; no per-pixel confidence is invented.

## Exploratory sensitivity experiment actually run

Command: `.venv/bin/python -m pipeline.engine.robustness --data-dir data/pilot --runs 200 --mask-runs 50 --seed 20261018 --out data/pilot/robustness.json`.

Each of 200 seeded trials recomputes attribute/objective scores: objective and attribute weights × U(0.8,1.2), tolerances × U(0.7,1.3), and an 80% pool subset (ceil, eight of nine windows). Fifty additional trials mask 10% of attributes independently. Outputs: `robustness.json`, `robustness_diagnostics.json`. This is a deliberately chosen perturbation study; it does not sample an empirical observation-error distribution. Selection frequencies include whether a site survives pool subsampling.

| Target / budget | Median site-set Jaccard vs baseline | Fraction within ±0.05 coverage | Median Jaccard after missingness |
| --- | --- | --- | --- |
| Moon / 2 | 1.000 | 0.750 | 1.000 |
| Moon / 3 | 1.000 | 0.670 | 1.000 |
| Mars / 2 | 1.000 | 0.720 | 1.000 |
| Mars / 3 | 1.000 | 0.760 | 0.833 |

A favorable median alone does not establish stability of scores: only 67% of the lunar three-site trials stay within 0.05 coverage. Masking changes the median Mars three-site overlap to 0.833. Earlier terrain-only sensitivity figures (including lunar median Jaccard 0.667) were superseded after land-cover acquisition and recalculation. No confidence percentage was added to the UI. DEM/source uncertainty and spatially correlated missingness are not represented by this experiment.

## Performance measurement

Node v24.14.1, this local machine, 100 measured runs after 10 warmups; deterministic synthetic software lines, seed 20261017. Representative recorded median / P95: 100 candidates **0.020 / 0.062 ms**; 1,000 **0.155 / 0.260 ms**; 3,000 **0.535 / 0.631 ms**. Timings vary by run. No pre-change baseline exists; no acquisition, rendering or full-campaign speedup is inferred. The algorithm sorts then builds a linear hull, avoiding pairwise intersections of all candidate lines.

## Browser verification and its limits

The local browser demonstrated measured mode, Moon→Mars selection, priority winner changes, Apply→one-site re-optimization, site dossier, paired measured surfaces and shared-axis profiles. A 375×812 viewport displayed the new controls without horizontal overflow. Additional export/geography/production checks are listed in the implementation log. These are one browser session, not independent Chrome/Firefox/Safari or real-device certifications.

## Open validation requirements

- An independently assembled field/practice benchmark, sufficient reviewed task-site pairs, held-out validation and negative controls.
- An authorized global Earth Engine run and documented sampling sufficiency; nine purposive windows cannot establish worldwide discovery or novelty.
- Verified climate, seasonal snow availability, target thermal values and geological observations; field review of classified cover.
- Effective-resolution and source-error propagation using appropriate quality products / lunar clones.
- Human scientific review of features, tolerances, mission interpretation and external validity.

Reproduction details and limitations are in [SCIENTIFIC_METHODOLOGY](SCIENTIFIC_METHODOLOGY.md) and [REAL_DATA_GUIDE](engineering/REAL_DATA_GUIDE.md). Passing these checks does not resolve event eligibility.
