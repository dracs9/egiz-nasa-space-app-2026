# ML Stage 2 pre-registration — DRAFT, NOT FROZEN

Written with AI assistance (Claude Code); human review pending. Drafted 14 November 2026.

**Status: draft.** Nothing has been evaluated against the reference set. The set is frozen only after review by the science lead. Freezing means a commit that adds the SHA-256 values in §6 and a date. Any evaluation run before that commit does not count.

## 1. Question

Do the EGIZ rankings place Earth sites that agencies documented for a specific mission task near the top **for that task**, and better than simple baselines?

This adopts experiment E3 of `docs/science/VALIDATION_PROTOCOL.md` (hypothesis H3, exclusion rules and baselines) without changing it. Below are only the additions needed for the ML layer and for geo-0.1.0.

## 2. Reference set

- File: `data/ml/reference/reference_sites-0.1.0.csv`. Sources: `data/ml/reference/sources-0.1.0.csv`. The format extends `data/curated/practice_sites.csv` with `activity, years, agency, evidence_grade, verification`. The JETT3 rows are copied unchanged from that file.
- Unit: a **pair** (site × objective). A site may appear in several pairs.
- Evidence grade:
  - **A**: an agency primary document read by us links the site to the task.
  - **B**: a peer-reviewed or agency document cited by a reliable secondary source, not read by us.
  - **C**: encyclopedia or press only, or a non-agency operator.
- `testable=false` follows the E3 exclusion rules (chemistry, biology, caves, scale below 100 m, source does not link the site to the task). One ML rule is added: **artificial landforms** (nuclear or explosive craters). Exclusions are fixed now, before any rank is seen.
- `coord_precision`:
  - `feature`: the centre of a named crater, caldera or volcano that fits in the 22 km window;
  - `point`: a facility;
  - `area`: the centroid of a park, range, basin or field larger than the window, where the training spot inside it is not known.

  `area` pairs are excluded from P1, because their AOI may not contain the place where the training happened.

## 3. Reference AOIs

Each testable pair with sourced coordinates gets a reference AOI: a 22 km window centred on the stated coordinates. It is built with the geo release code path (`pipeline/geodata`, branch `geo/data-foundation` at 234ae86, the same code as geo-0.1.0) and the env supplement method. Coordinates are used as stated. They are **not** moved after results are seen. A reference AOI is ranked among the eligible geo-0.1.0 Earth candidates for its objective, and the other reference AOIs are not in that pool.

**Built (attributes only, no scores):**
- `data/ml/reference/ref-aois-0.1.0/`, by `tools/build_reference_aois.py`: 25 AOIs, all stages ok except McMurdo land cover (ESA WorldCover does not cover latitudes below 60° S, so quality fails and the AOI is skipped; it is not in P1).
- `data/ml/reference/ref-env-0.1.0/`, by `tools/acquire_env_supplement.py`: MODIS LST and IMERG for all 25, no missing values.

Fixed definitions (implemented in `pipeline/ml/evaluate.py`):
- `pct` = 100 × (n_better + 0.5 × n_tied) / n_eligible_pool.
- A reference AOI with null F (it fails a constraint, or too much weight is missing) gets **pct = 100** and is flagged; it is not dropped.
- **Overlap rule:** for each pair, pool AOIs whose centre is closer than 31.2 km (22 km × √2) to the reference centre are removed. Example: the pilot window `PR_JETT_SP_CRATER` is removed when ranking `RF_JETT_SP_CRATER`.
- Baselines keep the objective's constraints, so they rank the same eligible set. Dryness-only uses the O5 parameters (`precip_mm` at_most a = 50, τ = 100; `bare_frac` at_least a = 0.8, τ = 0.2).
- S3 stability uses the Stage 1 perturbation config (200 draws, seed 2026).

## 4. Analyses

| | Pairs | Ranking |
| --- | --- | --- |
| **P1 (primary)** | grade A or B, `testable=true`, coordinates sourced, `coord_precision` ∈ {feature, point} | objective F against the target of the same body (engine = Stage 1 baseline) |
| S1 | P1 plus grade C and `area` pairs | same |
| S2 | P1 | target-free F (`at_least`, `at_most` and `colder` only), as in E3 |
| S3 | P1 | stability: share of 200 perturbation draws in which the pair is in the top 10 % |
| S4 | P1 without Apollo-era pairs | same as P1 (Apollo training targeted equatorial sites, not Mons Mouton) |

Baselines, from E3: (1) dryness only, `at_most(precip)·at_least(bare)`; (2) random order (expected pct 50 %, computed from 10 000 permutations with seed 2026).

Metrics:
- `pct`: rank / number eligible × 100 per pair;
- median `pct` per analysis;
- hit@10 % and hit@K for K = 10 and 30 sites;
- binomial test of hit@10 % against p0 = 0.10;
- 95 % bootstrap interval of the median, 10 000 resamples **clustered by site**, seed 2026.

## 5. Decision rule (from E3, unchanged)

- `confirmed`: the P1 median `pct` is ≤ 20 % **and** lower than both baselines.
- `not_confirmed`: the P1 median `pct` is > 20 %, or not lower than dryness-only.
- `inconclusive`: there are fewer than **8** P1 pairs, or the bootstrap interval spans both outcomes.

Learned components evaluated later (encoder, novelty, learned ranking) use this frozen set and these metrics. A learned component counts as "adding value" only if it lowers the P1 median `pct` and the bootstrap interval of the difference excludes 0.

## 6. Freeze record

The freeze is the file `data/ml/reference/FREEZE.json`. It holds:
- the SHA-256 of `reference_sites-0.1.0.csv`, `sources-0.1.0.csv` and this document;
- the date;
- `reviewed_by`.

`python -m pipeline.ml evaluate` **refuses to run** (exit code 3, no output file) when that file is absent, when a hash differs, or when no reviewer is named. Tests rank only synthetic `FAKE_` tiles. Until the freeze, no real reference AOI is scored by any code path.

Frozen on: *not yet*. Reviewed by: *science lead, pending*.

## 7. Current state of the draft (honest forecast)

Revision 2 of the draft, 14 November 2026. The full text of Phinney 2015, NASA SP-2015-626, was read. Appendices E and I list every Apollo-era field geology exercise by date, crew and place. The draft now has 35 rows (22 sites from the book; site, years and book pages are in `verification`).

| | pairs | sites |
| --- | --- | --- |
| **P1** | **14** | 13 |
| of which O2, EVA field geology, moon | 12 | 12 (11 Apollo-era + SP Crater JETT3) |
| of which M2 / O3 (Haughton) | 2 | 1 |
| S4, P1 without Apollo-era | 3 | 2 |

P1 now meets the minimum of 8 pairs, so the analysis can reach a conclusion. **Its scope is narrow:** in practice P1 tests O2 against Apollo-era field geology training. The other objectives (O1, O3–O5, M1–M4) have one pair or none and stay untested. S4 stays `inconclusive`. This must be stated with every result. A conclusion about O2 does not generalise to the engine as a whole.

Still missing, and worth adding before freezing if they can be sourced:
1. Coordinates for Black Point Lava Flow (2 grade-A pairs: O2 and O3, D-RATS) and for Sierra Blanca / Quitman Mountains (O2).
2. Exact locations of the JETT 1–5 and D-RATS 2008–2011 tests (O2 and O3, Artemis-era).
3. Landing-hazard (O1, M1) and rover-route (M2) rehearsal sites with documented locations. None has been found yet.

Open judgement calls for the science lead:
- Haughton O3: a robotic rover is not a crewed LTV.
- McMurdo M4: an environmental analog, not a task rehearsal.
- Whether Apollo-era geology training should count for a south-pole target at all (S4).
