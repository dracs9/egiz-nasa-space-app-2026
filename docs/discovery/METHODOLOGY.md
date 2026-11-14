# EGIZ Discovery Engine — scientific methodology

Written with AI assistance (Claude); human scientific review pending. Code: `pipeline/discovery/`,
browser port `web/src/discover/`. Every formula below has a Python implementation and, where the
browser recomputes it, a TypeScript twin with a parity test (`web/src/discover/engine.test.ts`).

## 1. Question

For a lunar or Martian reference site: which 22 km windows on Earth reproduce it, along which
independent scientific dimensions, with what uncertainty, how rare is that on Earth — and where does
the analogy fail? The answer is a per-dimension profile plus a computed gap ledger, never one number.

## 2. Units of comparison

* **Earth window** — a 22 km square (20 km core + 1 km margin) around a centre point, processed by the
  unchanged `pipeline.geodata` stages: Copernicus GLO-30 terrain on local UTM grids (200 m and 50 m),
  ESA WorldCover 2021 class fractions, NASA POWER climatology at the centre, Macrostrat map unit at
  the centre. Windows come from four sets (`pipeline/discovery/sites.py`):
  * global lattice — Fibonacci points at 220 km nominal spacing, kept if a GLO-30 tile exists
    (land), latitude 80 S–84 N. **This near-equal-area sample is the reference population for every
    Earth-wide percentile.**
  * Kazakhstan regional lattice — hexagonal, 75 km spacing, inside the Natural Earth polygon.
  * benchmark sites — published analog field sites, hypotheses and a-priori negative controls.
  * the 329 Earth windows of `geo-0.1.0` (pilot + stratified sample; not part of the population
    because its sampling is stratified toward arid climates).
* **Planetary target** — the same 22 km window on the target body: PGDA LOLA 5 m DEMs for six lunar
  south-pole sites, the USGS HRSC/MOLA blend (200 m posting) for Jezero, Gale, Oxia Planum and
  southern Utopia Planitia. Terrain is compared at the target's fine baseline (Moon 100 m, Mars 400 m)
  and the common 2 km baseline — matched spatial baselines on both bodies.

## 3. Dimensions

| id | what it compares | method | status |
|---|---|---|---|
| terrain_fine | slope distribution at the fine baseline | 1-Wasserstein distance W1 between piecewise-linear slope CDFs built from p50, p90, the < 10° and < 20° fractions and the slope-class fractions; s = exp(−W1 / 3°) | measured |
| terrain_roughness | TRI, slope spread, Laplacian-curvature spread | log ratios (factor 2 = 1 unit), decorrelated distance (§5); Mars: TRI only, the only fine-baseline roughness feature measured on both sides | measured |
| terrain_regional | 2 km-baseline slope p50/p90, fraction < 20°, relief, elevation spread | standardised differences (3°, 5°, 0.15, factor 2), decorrelated distance | measured |
| surface_exposure | exposed, unvegetated ground | WorldCover bare + ½ moss/lichen fraction; target = fully exposed (physical constraint) | measured (Earth proxy) |
| geology | lithology class | Macrostrat label at the window centre + Holocene volcano / impact structure within 30 km → common vocabulary; s = ½ best class match + ½ mean coverage of the target's literature classes, with a partial-credit matrix | measured (map proxy vs literature) |
| aridity | aridity and open water | exp(−P / 150 mm) × (1 − open-water fraction); targets have no liquid precipitation | measured (modelled + proxy) |
| thermal | near-surface air temperature regime | Earth monthly 2 m air range vs Mars near-surface air range (Viking Lander 1, 184–242 K): s = exp(−gap / 25 K) × (½ + ½ overlap fraction) | Mars only; **not applicable to the Moon** (no air) |
| illumination | noon solar elevation over a year | fraction of the target's range [90 − \|φ\| − ε, 90 − max(0, \|φ\| − ε)] reproduced by the Earth window's range (ε obliquity) | measured (derived geometry) |
| mineralogy | spectral composition | — | not assessed: no EMIT/ASTER/CRISM/M3 product acquired |
| aeolian_dust | wind, dust, dunes | — | not assessed (Earth/Mars); not applicable on the Moon |
| ice_permafrost | ground ice / permafrost | — | not assessed: no CCI Permafrost, LEND, SHARAD product acquired |
| subsurface_voids | caves, lava tubes, pits | — | not assessed: no inventory acquired |

Missing values are never filled: a window without the data for a dimension is `missing` for it.
Lithology classes come from map units and literature, never from spectra; they are not mineral
identifications. Earth 2 m air temperature is modelled climatology, not land-surface temperature.

## 4. Uncertainty propagation

Monte Carlo with fixed seeds (64–128 draws per window, target and dimension; `similarity.py`):

* DEM vertical error → slope error σ = deg(√2 σz / baseline): GLO-30 σz = 2 m (documented
  relative accuracy), LOLA 5 m σz = 1 m (assumed), HRSC/MOLA blend σz = 10 m (assumed). Applied as a
  systematic shift of the whole slope CDF per draw.
* Effective-resolution penalty for the Mars blend DEM (smoother than its 200 m posting): relative
  σ = 25 % on fine-baseline statistics, applied to the target side as a multiplicative CDF scale.
* WorldCover class fractions σ = 0.08 (absolute); POWER temperature σ = 2 K, precipitation σ = 25 %;
  map-scale-dependent σ for geology (0.10 large … 0.30 tiny).
* Each draw recomputes the dimension similarity; the median and the 5–95 % interval are stored.

## 5. Correlated features

Within a dimension, standardised differences d are combined as D² = dᵀ R⁻¹ d / k_eff, where R is the
Earth-population correlation of the transformed features, shrunk toward the identity (λ = 0.3), and
k_eff = (Σλᵢ)² / Σλᵢ² is the participation ratio of its eigenvalues. Three nearly identical features
therefore carry about one feature's worth of evidence (tested in `tests/test_discovery.py`). Across
dimensions, terrain is split into three groups (fine distribution, roughness, regional relief) with
explicit weights instead of counting every slope statistic separately.

## 6. Aggregation and ranking

For weights w and measured dimensions A (mirrored in TypeScript):

    mu_d = ln s50_d,   sd_d = (ln hi_d − ln lo_d) / (2 · 1.645)
    fidelity = exp( Σ_A w mu / Σ_A w ),   90 % interval exp(mu ± 1.645 · √(Σ_A w² sd²) / Σ_A w)
    coverage = Σ_A w / Σ_applicable w        (not-assessed dimensions are applicable)
    score    = fidelity × coverage           (default ranking)

`score` can never reach 1 while any dimension is unmeasured, and a window lacking data for a
dimension loses coverage instead of gaining similarity. Evidence category: **strong** (coverage ≥ 0.6
and interval width ≤ 0.35), **weak**, or **missing_driven** (coverage < 0.5). Mission profiles
(general, rover mobility, EVA geology, power/illumination, astrobiology) only change weights.

## 7. Rarity, novelty, diversity

* **Earth-wide percentile** of a dimension or score: share of global-lattice windows at or below it.
* **Rarity**: mean robust-standardised distance to the 10 nearest global-lattice windows in terrain
  feature space (and separately environment space); its percentile is reported ("terrain rarer than
  97 % of lattice windows").
* **Novelty**: great-circle distance to the nearest established analog site of the benchmark list;
  established < 30 km, near_established < 200 km, unexplored otherwise. Novelty is reported, never
  added to fidelity.
* **Diversity**: shortlists use maximal marginal relevance (score − 0.3 × max feature similarity to
  already chosen windows) with a hard 150 km exclusion radius (browser: greedy 150 km exclusion).

## 8. Science vs operations

Operational suitability is a separate axis and never enters the score: fraction of ground below 15°
(derived), built-up fraction (WorldCover proxy for infrastructure), snow/ice fraction, median
elevation. Access, permits and safety are reported as **not assessed** (no data source).

## 9. Computed gap ledger

Per candidate and target (`gaps.py`, browser `gapLedger`): gravity (WGS84 normal gravity at the
window latitude vs NSSDCA), atmospheric pressure (ICAO standard atmosphere at the window's median
elevation vs NSSDCA), composition, temperature range (with the air-vs-surface caveat for the Moon),
surface radiation dose rate (MSL/RAD, Chang'e-4 LND, UNSCEAR), day length, noon solar elevation, solar
flux, vegetated fraction, magnetic field, dust physics, and the slope-distribution residual. Rows that
cannot be quantified with acquired evidence say `measurable: false`. Laboratory alternatives come
from `data/curated/gap_alternatives.csv`.

## 10. Rover experiment (Mission Lab link)

`rover.py` / `rover_experiment` applies CF_TERRAMECHANICS (Bekker rigid wheel, Apollo-era lunar soil
estimate, 900 kg six-wheel demonstration rover) to the candidate's measured 100 m slope distribution:
traction-limited slope, traversable fraction, sinkage and mean climbing energy per metre under target
gravity, a load-matched and a mass-matched Earth test. The deltas state how an Earth test on that
terrain mis-states target performance. Static model; the direction of the gravity effect on soil
strength is contested in the literature; not a hardware result.

## 11. Validation design

See `docs/discovery/VALIDATION.md` for results. Fixed before results were seen: positives are
published analog field sites whose literature names the target body; background is the global
lattice; four a-priori negative controls; metrics ROC AUC with bootstrap interval, precision/recall
at k, per-positive percentiles, ablation per dimension, 200 Dirichlet weight perturbations, and
seed-to-seed rank correlation. No tolerance or weight was tuned on these results.
