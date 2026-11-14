# ATLAS-Π research review

Written with AI assistance (Claude, 13 November 2026); human scientific review pending. Sources were checked in this session unless marked otherwise. "Not found" means not found in a focused search, not "does not exist".

## 1. Research question

Which measurable characteristics of a terrestrial environment can support which specific planetary research or mission operation, under what assumptions, with what limitations and with what uncertainty?

The question replaces "which Earth site looks most like the target?". It is answered per site × target × task × factor (the Operational Transferability Tensor), not with one similarity score.

## 2. What the field already does

| Practice | Evidence | Consequence for ATLAS-Π |
|---|---|---|
| Two-step fidelity assessment: identify the processes and parameters critical to a science question, then judge how well a site matches them. One-to-one matching is not required. | Stern et al. (2025), *JGR Planets* 130(9), doi:10.1029/2024JE008803 (36-author workshop consensus, ocean-worlds focus). Abstract-level verification only. | ATLAS-Π implements this two-step logic computationally: task → factors → per-factor match, and keeps mismatch visible. |
| Analog purpose depends on the objective; different Mars conditions need different sites. | Preston & Dartnell (2014), *Int. J. Astrobiology* 13; Lee et al. (2010) via Preston & Dartnell. Cited from the existing EGIZ prior-art record; not re-verified this session. | Unit of analysis is site × task; multi-site portfolios. |
| No widely followed criteria for evaluating analog sites; calls for an open database. | A 2013 review on Cambridge Core ([link](https://www.cambridge.org/core/product/244C9EB88B74D6905133DD2228DD3112/core-reader)); authors not verified this session. | Versioned, explicit criteria and machine-readable certificates. |
| End-to-end analog landing-site selection exercise with remote sensing; image resolution was the most important identification parameter. | NASA Mars Analog Site Study, 1994 ([NTRS 19940011727](https://ntrs.nasa.gov/api/citations/19940011727/downloads/19940011727.pdf)). | Resolution-aware comparison is a first-class axis. |
| Image-texture similarity to Moon/Mars image sets with bootstrap stability. | NHSJS (2026) student paper ([link](https://nhsjs.com/2026/finding-earths-best-testbeds-for-moon-and-mars-rovers-a-quantitative-terrain-comparison/)); not peer reviewed. The author notes that DEM-based slopes are the necessary next step. | ATLAS-Π uses DEM-derived, scale-matched distributions instead of image texture. |
| Deep-learning Siamese matching of Qaidam Basin sites to Mars targets. | arXiv:2501.08584 (preprint). | Learned similarity exists; it does not provide task-conditioned transferability or physics. |
| Kilometre-scale roughness is scale dependent; compare at stated baselines. | Kreslavsky & Head (2000), *JGR* 105(E11), 26695–26711, doi:10.1029/2000JE001259. | Multi-scale (200/400/800 m) comparison, no upsampling. |
| Natural polar lighting is replaced by artificial "Sun carts" in NASA field tests. | NASA JETT3 (2022) (existing EGIZ reference). | Polar illumination is classed "partial", not reproduced. |

## 3. Reduced-gravity terramechanics (why "terrain match" cannot certify mobility)

- Wong (2012), *J. Terramechanics* 49, 49–61, proposes testing on Earth with the same *mass* as on the target body rather than the same normal load. The basis is a Bekker-type analysis of rigid-wheel sinkage and compaction resistance. [PDF](https://www.kiss.caltech.edu/papers/xterramechanics/papers/predicting.pdf)
- Wong & Kobayashi (2012), *J. Terramechanics* 49(6), 349–362, doi:10.1016/j.jterra.2012.10.004, revisit the approach.
- Parabolic-flight experiments (Niksirat, Daca & Skonieczny, 2020, *IJRR*; known in this session only through an ESA ASTRA 2022 summary) report reduced traction and increased sinkage at equal load in reduced gravity.
- Daca et al. (2022, *J. Terramechanics*) report a markedly reduced cone-index gradient at 1/6 g, which indicates lower soil strength.
- Other simulation abstracts (EPSC 2021, 2022) report gravity-independent sinkage, so the evidence is **conflicting**.

Implication: a Bekker counterfactual can show the *size* of the protocol effect (load- vs mass-matched), but not its *direction* at reduced gravity. ATLAS-Π therefore labels CF_TERRAMECHANICS `MODEL_ESTIMATE_CONTESTED`. Wheel–soil qualification is classed non-transferable to open-air field sites.

Lunar soil parameters: Apollo-era Bekker estimates (k_c ≈ 1400 N/m², k_φ ≈ 820 000–830 000 N/m³, n = 1) are described by NASA as rough estimates from Surveyor/Apollo data. Sources: NASA M2M-30044 *Lunar Surface Data Book*; NASA TM-20250006958. Apollo-era friction angles of 30–50° are reported in an NASA LPSC 2023 abstract. No reliable south-polar or Jezero values were found.

## 4. Geospatial and planetary representation learning

| Resource | What it is | Fit for ATLAS-Π |
|---|---|---|
| Prithvi-100M (NASA/IBM), [model card](https://huggingface.co/ibm-nasa-geospatial/Prithvi-100M) | MAE on six HLS optical bands (blue, green, red, narrow NIR, SWIR1, SWIR2), multi-temporal cubes. | Earth optical only; not a DEM/terrain encoder, not valid for lunar/Martian imagery. Not integrated. |
| MOMO, arXiv:2604.02719 (CVPR 2026) | Mars orbital foundation model: per-sensor MAE (HiRISE, CTX, THEMIS) merged; ~12 M samples; Mars-Bench evaluation. | Mars imagery only; no Earth domain or DEM modality; large. A future option for Mars-side image features, not for cross-body terrain transfer. |
| Generic self-supervised ViTs (e.g. DINOv2 used for CTX crater filtering, EGU26) | Domain shift and resolution mismatch reported. | Confirms the risk of naive transfer across domains. |

Decision: no learned model is trained (see the model card). With 11 windows and no independent validity labels, any embedding "accuracy" would be leakage-prone and scientifically empty.

## 5. Optimisation, information value and validation methods

- Greedy maximisation of monotone submodular coverage has the (1−1/e) guarantee. This is established practice; Krause, Singh & Guestrin (2008, *JMLR* 9) apply it to sensor placement. The redundancy-penalised objective used here is not monotone, so ATLAS-Π enumerates exactly.
- Adaptive submodularity: Golovin & Krause (2011), *JAIR*. It motivates sequential measurement planning; not implemented (future work).
- Expected value of (partial) perfect information follows standard Bayesian decision analysis (Raiffa & Schlaifer, 1961; not re-verified this session).
- Spatially structured validation: Roberts et al. (2017), *Ecography* 40:913–929; Valavi et al. (2019), *MEE* 10(2):225–232 (blockCV). Block bootstrap for dependent data follows Künsch (1989), *Ann. Statist.* 17(3), not re-verified this session.
- Clear-sky direct irradiance I_D = 1.353 kW/m² · 0.7^(AM^0.678) is published by [PVEducation](https://www.pveducation.org/pvcdrom/properties-of-sunlight/air-mass), attributed to *Applied Solar Energy* (Addison-Wesley, 1976). It is a rough approximation that degrades near the horizon.

## 6. Identified limitations of common workflows (evidence-based, not universal)

1. Qualitative or heuristic similarity with no explicit criteria (2013 review; Stern et al. 2025 motivation).
2. Image-texture or single-score similarity that mixes illumination, sensor and terrain (acknowledged by the NHSJS author).
3. Scale mismatch: resolution is the dominant identification factor (MASS 1994), and roughness is scale dependent (Kreslavsky & Head 2000).
4. Gravity-dependent mobility cannot be inferred from terrain similarity, and the reduced-gravity literature conflicts (§3).
5. Multi-site campaigns are argued for (Preston & Dartnell), but in this search no formal portfolio method was found that is conditioned on mission tasks and physical transferability.

## 7. Proposed contribution (see ATLAS_PI_PRIOR_ART.md for the precedent table)

ATLAS-Π combines established methods into a single, executable and reproducible workflow:

- a per-cell transferability status from documented rules;
- similarity, evidence coverage, evidence quality, resolution and physics kept as separate axes;
- certificates traced to hashed source files;
- an uncertainty-aware complementary portfolio optimiser with Pareto alternatives;
- named counterfactual models that declare their own contested status;
- an EVPI-ranked field-measurement planner;
- a deterministic adversarial reviewer;
- a coarse-to-fine regional discovery screen.

No component claims a new mathematical method, and no world-first claim is made.

## 8. Unresolved questions

- What metre-scale roughness do the Earth windows have? It requires drone/lidar DEMs.
- Which direction does the reduced-gravity traction transfer error take for real field soils?
- Are the geological process tags correct? Six of nine Earth windows are grade D (unverified).
- What are the temperatures and precipitation? They were never acquired, so HABITAT_LAYOUT and COLD_DRY_SURFACE remain UNKNOWN.
- Is Level-1 screening reliable at regional scale? Spearman 0.88 against Level 2 on 10 windows is encouraging but small.

## 9. Feasibility

All of the above runs on a laptop CPU. A full build takes ~22 s with ~169 MB peak RSS; the Kazakhstan discovery takes ~33 s of network reads. No GPU, paid API or large model is required.
