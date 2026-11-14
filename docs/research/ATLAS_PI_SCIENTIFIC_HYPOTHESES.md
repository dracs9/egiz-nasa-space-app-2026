# ATLAS-Π scientific hypotheses and decision criteria

Written with AI assistance (Claude); human review pending.

**Chronology disclosure.** The criteria below were written in `pipeline/analog_transfer/evaluation.py` before the evaluation module first ran. That was *after* an exploratory run of the tensor and the constellation optimiser had been inspected (13 November 2026). They are therefore **not a formal preregistration**. Two changes were made after the first evaluation output was read:

1. H1 initially counted lab-only tasks whose match uses a single factor. This inflated the result, so they were excluded.
2. EVPI values below 1e-12 are now reported as exactly zero; previously, floating-point roundoff produced a non-zero value.

Both changes are recorded here and in the validation report.

| ID | Hypothesis | Test (data) | Supported if | Rejected if |
|---|---|---|---|---|
| H1 | Mission-conditioned assessment changes practical recommendations relative to one general similarity score | Kendall τ and top-site identity between per-task match rankings and an unconditioned geometric-mean terrain similarity (measured pilot, field-transferable tasks using ≥ 2 measured factors) | ≥ half of assessable tasks have a different top site or τ < 0.7 | fewer than half |
| H2 | A complementary portfolio covers more mission requirements than the same number of individually best sites | Count of requirements covered (status SUPPORTED/CONDITIONAL and factor LCB within two tolerances). This count is not the optimised quantity. Baselines: top-K individual, top-K general similarity; K = 2, 3; Moon and Mars | more covered in ≥ 1 mission/K and fewer in none | fewer in any |
| H3 | Comparing at mismatched spatial scales distorts similarity | Binned W1 between slope histograms at matched vs mismatched baselines (100 m vs 400 m) from `terrain_evidence.json` | top-3 set changes, a site crosses the 2° tolerance, or the mean shift is ≥ 25% of the between-site SD | none of these |
| H4 | Explicit physical-mismatch modelling changes conclusions | Re-assess every cell with physics removed | ≥ 1 status change and ≥ 1 cell with terrain match ≥ 0.61 that is NON_TRANSFERABLE for physics | neither |
| H5 | The planner identifies information that materially affects the decision | Monte Carlo EVPI over the K=3 portfolio choice under declared priors | ≥ 1 measurement with EVPI ≥ 5% of current value and decision-change probability ≥ 20%; **and** the bevameter control (which cannot change any field status) has EVPI = 0 | otherwise |
| H6 | Learned terrain representations add retrieval value beyond deterministic features | Requires labelled analog-validity data | — | — |

H6 is declared **not run**: there are no independent labels, only 11 windows, and no deep-learning framework is installed.

## Declared priors and constants (all varied or documented)

- **Factor match:** exp(−z²/2) with declared tolerances. z = 1 → 0.6065 (SUPPORTED lower-bound threshold); z = 2 → 0.1353 (CONDITIONAL threshold). Tolerances are varied ×0.5 and ×2.
- **Evidence quality weights:** observed/retrieved 1, derived 0.9, model 0.7, assumed 0.5, curated by grade (A 1, B 0.8, C 0.4, D 0.25). SUPPORTED requires ≥ 0.6.
- **Process compatibility:** 1.0 if a tag is shared, otherwise 0.2.
- **Constellation:** λ = 0.1 redundancy penalty and κ = 0.5 conditional discount, varied over λ ∈ {0, 0.1, 0.3} and κ ∈ {0.25, 0.5, 0.75}; 200 Dirichlet task-weight draws.
- **Planner priors:** missing match ~ U(0,1); post-survey metre-scale match ~ U(0,1); curated-tag correctness A 0.95, B 0.85, C 0.6, D 0.5; lunar best-month snow-free fraction ~ U(0,1).
- **Mars optical depth τ = 0.5:** a declared scenario value, not a retrieval.

## Falsifiability notes

- H2 is not trivially true. The optimiser maximises J (LCB-weighted coverage minus redundancy), not the covered count. On the Moon the result is a tie, which is reported.
- H4 is partly definitional (the rules encode physics). Its empirical content is that real sites with strong terrain matches would be recommended by a similarity-only system.
