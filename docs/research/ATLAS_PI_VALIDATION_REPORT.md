# ATLAS-Π validation report

Written with AI assistance (Claude); human scientific review pending. All numbers are copied from `data/pilot/atlas_pi.json` (`evaluation`, `constellations`, `planner`, `discovery`), produced by `python -m pipeline.analog_transfer build` on 13 November 2026. Re-running the build reproduces them, and `verify` checks the content hash. Nothing here is a field validation of any recommendation.

## Protocol

- **Data:** measured pilot only. 9 Earth windows (one excluded by WorldCover water 0.96), Mons Mouton (LOLA 5 m) and Jezero (MOLA-HRSC 200 m). Comparisons use 200 m grids at 200/400/800 m cells; SPICE solar geometry comes from the packaged NAIF kernels.
- **Tensor:** 198 cells (9 sites × 11 tasks × 2 targets).
- **Uncertainty:** 4 km spatial block bootstrap, 200 replicates, fixed seeds; 90% intervals.
- **Criteria:** fixed in ATLAS_PI_SCIENTIFIC_HYPOTHESES.md (not formally preregistered; see the chronology note there).

## Status distribution

| Target | SUPPORTED | CONDITIONAL | WEAK | NON_TRANSFERABLE | UNKNOWN |
|---|---|---|---|---|---|
| Mons Mouton (Moon) | 0 | 9 | 47 | 35 | 8 |
| Jezero (Mars) | 1 | 25 | 22 | 35 | 16 |

The only SUPPORTED cell is SP Crater → Jezero rover route planning: match 0.79, 90% CI 0.62–0.89. It is **not robust**: it becomes CONDITIONAL when tolerances are halved.

The Mons Mouton result is itself a finding. None of the nine 20 km windows reproduces a lunar polar massif: Mons Mouton has median slope 11.7° and relief 2550 m at 200 m cells, whereas the Earth windows have median slopes of 0.7–6.2°.

## Hypotheses (measured)

| ID | Verdict | Measured result | Caveat |
|---|---|---|---|
| H1 | supported | 12 of 15 assessable field tasks have a different top site or Kendall τ < 0.7 vs the general similarity ranking | Partly expected by construction. Moon differences are among near-zero matches |
| H2 | supported (Mars only) | Jezero K=3: optimiser 16/25 requirements covered vs 13/25 (top-3 individual) and 13/25 (top-3 general similarity). K=2: 14 vs 13 vs 13. Moon K=2/K=3: 6 vs 6 (tie) | Only one target shows a gain. The covered count still depends on the same statuses. Greedy ≠ exact for Jezero K=2,3 |
| H3 | supported | Jezero: mismatched 100 m Earth vs 400 m target shifts W1 by 0.99° on average (between-site SD 1.93°); τ = 0.67; the top-3 set changes from {Iceland, Utah, Atacama} to {Iceland, Boszhira, water window}; SP Crater crosses the 2° tolerance (false dissimilarity). Moon: mean shift 1.00° (SD 1.87°), τ = 0.83, same top-3 set in a different order | The direction is mixed: scale mismatch produced false *dissimilarity* and re-ordering, not systematic false similarity |
| H4 | supported | 48/198 statuses change when physics is removed. Six Jezero WHEEL_SOIL cells have terrain match 0.75–0.94 yet are NON_TRANSFERABLE (e.g. SP Crater 0.94, Atacama 0.89) | Partly definitional |
| H5 | supported | Jezero: field geology verification EVPI 0.036 (9.1% of current value), decision-change probability 45%; high-resolution DEM survey EVPI 0.022 (6.5%), 81%. Moon: geology EVPI 0.013 (8.0%), 87%. Bevameter control EVPI = 0 for both missions | EVPI depends on declared priors |
| H6 | not run | — | No labels, 11 windows, no DL framework |

## Controls

- **NC1** (water-dominated Kazakhstan window): passed. All cells are NON_TRANSFERABLE (SITE_CONSTRAINT); the window is never selected in any portfolio, sensitivity draw or parameter variant.
- **NC2** (spatially scrambled target grids, histogram preserved): passed. Median terrain-task match drops from 0.167 to 0.00004 (Jezero) and from 0.00009 to 0.0 (Moon); 0 SUPPORTED cells. The Moon contrast is weak because real matches are already near zero.
- **PC1** (positive control: SP Crater against itself with an independent bootstrap seed and Mars physics): passed. Match 1.00, 90% CI 0.90–1.00, SUPPORTED.

## Ablations (K = 3 portfolios)

| Variant | Status changes | Moon portfolio | Jezero portfolio |
|---|---|---|---|
| nominal | — | Death Valley, Wadi Rum | Boszhira, Wadi Rum, SP Crater |
| no resolution rule | 0 | unchanged | unchanged |
| no evidence-quality rule | 2 | unchanged | unchanged |
| no physics | 48 | unchanged | **Iceland**, Wadi Rum, SP Crater |
| point estimates instead of LCB | — | unchanged | unchanged |
| no redundancy penalty (λ = 0) | — | unchanged | **Iceland**, Wadi Rum, SP Crater |

The resolution rule had **no effect** on this dataset: resolution-limited cells were already non-SUPPORTED for other reasons. It remains in place as a safeguard and is not claimed as a demonstrated benefit.

## Robustness

- **Tolerances ×0.5 and ×2:** 130/198 statuses (65.7%) are unchanged. By status: NON_TRANSFERABLE 70/70, UNKNOWN 24/24, WEAK 22/69, CONDITIONAL 14/34, SUPPORTED 0/1. The terrain-driven boundaries are sensitive to the declared tolerances. The UI marks unstable cells with "~".
- **Mission priorities:** 200 Dirichlet draws. Median Jaccard to nominal is 1.0 for both missions. Jezero selection frequencies: Wadi Rum 100%, SP Crater 100%, Boszhira 66.5%, Iceland 18%, Atacama 3%. Moon: Death Valley 99%, Wadi Rum 83%.

## Discovery (Kazakhstan, Mangystau/western Ustyurt, 51–57°E, 42–45°N)

- **Level 1:** 18 GLO-90 tiles read through COG overviews, 288 blocks, 8.7 s. 175 blocks are flagged as probable water, playa or flat sheet (>60% of cells flatter than 0.3°). 15 blocks are robust outliers.
- **Level 2:** 10 GLO-30 windows, 24 s, no failures. Two are "existing candidate with new characterisation" (34–36 km from Boszhira). Eight are "newly identified computational candidates (unverified)".
- **Best new candidate for Jezero route planning:** E52.625 N44.125, match 0.51 (CONDITIONAL), versus 0.26 for the existing Boszhira window. Land cover and geology were **not** acquired for it.
- **Screen–detail agreement:** Spearman ρ = 0.88 (n = 10). Absolute levels differ: mean coarse match 0.76 vs detailed route-planning match 0.19. Level 1 ranks usefully but overstates similarity.

## Performance (measured on the development Mac, CPU only)

Full build (features, tensor, constellations, planner with 150 draws, evaluation): 21.7 s total, of which the planner takes 16.1 s and the features 2.9 s; peak RSS 169 MB. Tensor evaluation for 198 cells takes 0.06 s. The bundle is 1.8 MB of JSON, and the web chunk is 34 kB (9.8 kB gzip), lazily loaded. Rendering performance was checked visually only (no frame-time measurement).

## Failed or revised experiments

- The first redundancy normalisation (divided by |A|−1) rewarded adding a zero-value site, which put the water window into a Moon portfolio. It was fixed: un-normalised overlap, plus pruning of zero-marginal sites.
- H1's first version counted single-factor lab-only tasks, which inflated the result. It was fixed and is disclosed.
- SUPPORTED initially did not require evidence quality, so two cells rested on grade-D geology. The evidence-quality rule was added.
- NSSDCA Mars gravity was corrected from 3.71 to 3.73 m/s² after verification. Bekker Mars sinkage ratio: 1.905.

## Known biases

- **Purposive site pool:** windows were chosen as known or plausible analogs.
- **Expert-declared tolerances and task–factor weights.**
- **Process tags:** six of nine Earth windows are grade D.
- **Solar sampling:** only one Earth year and one synodic month were sampled.
