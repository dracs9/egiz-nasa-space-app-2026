# ATLAS-Π model card

Written with AI assistance (Claude); human review pending.

## Trained models

**None.** No neural network, embedding or classifier was trained, and no pretrained model is downloaded or required.

| Item | Status |
|---|---|
| Architecture | Not applicable |
| Training data / method / hardware | Not applicable |
| Evaluation | H6 declared `not_run` |

## Why no learned component

1. **No labels.** No independent ground truth of "analog validity per task" exists for these sites. Training on curated or invented labels would produce meaningless accuracy.
2. **Sample size and leakage.** With 11 regional windows, patches from the same window are spatially autocorrelated. A learned embedding would be evaluated on near-duplicates unless validated by leave-one-window-out, which leaves 10 windows: too few to estimate a retrieval gain.
3. **Domain.** The candidate foundation models do not fit. Prithvi (Earth HLS optical) and MOMO (Mars HiRISE/CTX/THEMIS imagery) have no DEM modality and no shared Earth–Mars–Moon domain. See ATLAS_PI_RESEARCH_REVIEW.md §4.
4. **Environment.** No deep-learning framework is installed, and the directive forbids large mandatory downloads.

## Deterministic "models" in the system

| Name | Type | Inputs | Validated? |
|---|---|---|---|
| Factor match | exp(−z²/2) over W1 / absolute differences with declared tolerances | DEM-derived distributions | Positive/negative controls only (PC1, NC2) |
| CF_TERRAMECHANICS | Bekker rigid wheel + Coulomb thrust | Declared rover and Apollo-era soil estimates | No. Marked CONTESTED |
| CF_SOLAR | SPICE geometry; Earth clear-sky DNI approximation; Mars Beer–Lambert with declared τ | NAIF kernels | Geometry only (SPICE); irradiance is not validated |
| EVPI planner | Monte Carlo decision analysis | Declared priors | Negative control (bevameter EVPI = 0) |

## Path to a defensible learned component (future)

- Build labels from documented field campaigns (task, site, outcome) with evidence grades.
- Use leave-one-region-out validation.
- Compare against the deterministic W1 baseline.
- Accept only if it improves retrieval of independently documented task analogs.
- Keep the deterministic path as the default.
