# ATLAS-Π prior-art table

Written with AI assistance (Claude); human review pending. This table is not a patent search. "Potential new contribution" means a combination or operationalisation not found in this session's focused search. It does not claim novelty or priority.

| Proposed capability | Existing related work | What already exists | Potential new contribution | Evidence produced here |
|---|---|---|---|---|
| Mission-conditioned transferability (tensor + statuses) | Stern et al. 2025 two-step fidelity; Lee 2010 / Preston & Dartnell 2014 purpose-based analogs; EGIZ v2 objective fidelity | Qualitative, purpose-based assessment; EGIZ's existing numeric objective fidelity | Rule-based per-cell statuses (SUPPORTED … UNKNOWN). Similarity, evidence coverage, evidence quality, resolution and physics are kept as separate axes. Bootstrap intervals and content-addressed certificates are attached | H1: 12/15 tasks rank sites differently from a general similarity score. H4: high terrain match co-exists with NON_TRANSFERABLE (e.g. SP Crater WHEEL_SOIL 0.94) |
| Non-transferable factor catalog | NASA analog / parabolic / TVAC guidance; EGIZ gap ledger (body-level) | Lists of what analogs cannot reproduce | Task-specific primary/secondary dependencies change the status; correction models are named per factor | 48/198 status changes when physics is ablated |
| Analog constellation optimisation | Max-coverage / facility location; submodular optimisation; EGIZ k ≤ 3 coverage campaign | Generic optimisation; EGIZ maximises best-site objective fidelity | Requirements are (task, factor) pairs. Optimisation uses lower-confidence-bound contributions gated by status, with a redundancy penalty, top-K and general-similarity baselines, Pareto alternatives and an uncovered/lab-only report | H2: Jezero K=3 covers 16/25 vs 13/25 for both baselines. Moon: no gain (tie) |
| Counterfactual planetary transfer | Bekker/Wong terramechanics; Wong 2012 mass-matching; reduced-gravity experiments; EGIZ Mission Lab parameter substitution | Individual physical models and experiments | A model that compares load- vs mass-matched protocols, flags its own contested direction, and decomposes "Same Sun" into geometry, duration and irradiance using SPICE | Moon mass-matched sinkage ×3.32, Mars ×1.90 (Bekker); flagged CONTESTED |
| Active field-measurement selection | Bayesian experimental design; EVPI; adaptive submodularity | Generic information-gain methods | EVPI defined on the portfolio decision. Re-assessment of statuses under declared priors; per-site placement; zero-value detection | H5: geology verification EVPI 9.1% of value (Jezero); bevameter correctly 0 |
| Evidence graph / certificates | Scientific provenance (PROV-style) systems | Source tracking | Claim → comparison → feature → hashed dataset graph; 198 content-addressed certificates | Integration tests: every certificate resolves to graph nodes and, for terrain claims, a hashed DEM |
| Scientific red team | Adversarial review practice | Human review | Deterministic A–H review generated only from computed records | Reviews for constellation and general-similarity favourites |
| Regional discovery | Global analog catalogs; Qaidam DL matching (arXiv 2501.08584) | Catalogs; learned matching | Coarse-to-fine screen with novelty categorisation and explicit "not proof" status | 288 blocks → 10 GLO-30 windows; screen–detail Spearman 0.88 |

## Not claimed

- No claim that any capability is unprecedented, patentable or first.
- No claim that a discovery candidate is a new analog; categories are computational and literature novelty was not checked block by block.
- No learned representation is claimed (H6 not run).
