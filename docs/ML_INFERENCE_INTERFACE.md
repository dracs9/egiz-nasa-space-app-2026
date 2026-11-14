# ML inference interface (DRAFT 0.1.0)

Written with AI assistance (Claude Code); human review pending. Status **DRAFT**: field names may change after review by the frontend owner. Schema: [`contracts/ml/discovery-result.schema.json`](../contracts/ml/discovery-result.schema.json). Examples: [`contracts/ml/examples/`](../contracts/ml/examples/).

## Producing results

```bash
make ml-infer                      # data/pilot → artifacts/ml/discovery/
python -m pipeline.ml infer --data data/pilot --out <dir> [--limit N] [--ids ID ...] [--draws 200] [--seed 20261107] [--created-at ISO]
```

Output: one file per target × mission profile, `<TARGET>__<TEMPLATE>__<OBJECTIVE>.json`, plus `index.json` listing files, run IDs, eligible counts and the rank-1 candidate. Every document is validated against the schema before it is written. With a fixed `--created-at`, output is byte-for-byte reproducible.

## Mission profile

`mission_profile.id = "<template_id>/<objective_id>"`, e.g. `MARS_SURFACE_OPS/M2` (rover routes). Profiles are exactly the objectives of templates in `mission_templates.json`; no parallel list.

## Candidate fields

| Field | Meaning |
| --- | --- |
| `rank` | 1…n among eligible candidates; `null` if ineligible |
| `aoi_id`, `name`, `country`, `lon`, `lat`, `pool` | from `earth_candidates.json` |
| `eligible`, `ineligible_reason` | `constraint` (a mission constraint failed) or `missing` (missing weight > limit) |
| `components.*` | separate scores, each `{status, value, reason?, provenance_class?}` |
| `explanation.matching` / `mismatches` | attributes with fidelity ≥ 0.8 / < 0.5, failed constraints (display thresholds only, not used for ranking) |
| `explanation.attributes[]` | Earth value, target value, fidelity, weight, `log_contribution`, target source |
| `explanation.missing_fields` | human-readable missing values (Earth or target side) |

`status` ∈ `computed`, `exploratory`, `not_available`, `not_applicable`. When not available/applicable, `value` is `null` and `reason` is required — the frontend must show the reason, never a zero.

## Components

| Component | Value | Notes |
| --- | --- | --- |
| `deterministic_fidelity` | F ∈ [0,1] or null | Primary ranking signal; engine recomputation; `partial` flag |
| `learned_similarity` | null | Stage 3 |
| `environmental_similarity` | [0,1] or null | Only for objectives that use climate attributes; pilot: not available |
| `geological_similarity` | null | No geology data |
| `operational_suitability` | true / false / null | With `constraints[]` checks |
| `novelty` | null | Stage 3; never means "Moon-like" |
| `data_completeness` | [0,1] | Known attribute weight share; `missing_fields` |
| `ranking_stability` | object | `top1_frequency`, `topk_frequency`, `k`, `median_rank`, `rank_p05`, `rank_p95`, `draws` |

`log_contribution` values of one candidate sum exactly to `ln F` (tested), so a bar chart of contributions is a faithful explanation.

Ranking stability is computed by re-scoring under log-normal perturbation (sd 0.25) of attribute weights and match widths (`sigma`, `tau`). It shows how much the order depends on provisional method parameters — **not** measurement uncertainty and **not** evidence strength.

## Document-level fields

`run_id` (hash of input files, candidate IDs, profile, config and method), `method` (name, version, engine version, config), `dataset` (file hashes, synthetic flag, counts, skipped records, `engine_results_consistent`, sources), `component_definitions`, `physical_non_equivalence` (gravity, vacuum, thermal, radiation… from templates), `limitations`.
