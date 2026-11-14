# ML Stage 1 report · 7 November 2026

Written with AI assistance (Claude Code); human review pending. Branch `larpmonster67` (independent research project). Nothing committed or pushed.

## What runs

`make` is not installed on the development machine, so the Make targets were verified through their underlying `python -m …` commands; the targets themselves were not executed.

| Command | Result (verified) |
| --- | --- |
| `make ml-validate-data` | pilot snapshot valid: 9 candidates loaded, 0 skipped, engine results consistent, climate missing for 9/9 |
| `make ml-infer` | 9 schema-valid documents (MOON_BASE_OPS O1–O5, MARS_SURFACE_OPS M1–M4) + `index.json`, ~1.5 s on CPU |
| `make ml-test` | 13 passed |
| `python -m pytest -q` | 143 passed, 20 skipped (was 130 / 20) |
| `ruff check pipeline/ml tests/test_ml_stage1.py` | clean |

## Files added

- `pipeline/ml/` — `loader.py` (validated snapshot loader), `baseline.py` (transparent ranking, components, stability), `export.py` (documents + schema validation), `__main__.py` (CLI).
- `contracts/ml/discovery-result.schema.json` (DRAFT 0.1.0) and `contracts/ml/examples/`.
- `tests/test_ml_stage1.py`; Makefile targets `ml-validate-data`, `ml-infer`, `ml-test`, `ml-example`.
- Docs: [audit](ML_BASELINE_AUDIT.md), [inference interface](ML_INFERENCE_INTERFACE.md), [data interface proposal](ML_DATA_INTERFACE_PROPOSAL.md), [open questions](ML_OPEN_QUESTIONS.md), [brief](ML_LEAD_BRIEF.md).

No files outside the ML ownership area were changed except the Makefile (appended targets, `.PHONY`).

## Actual outputs (pilot, exploratory)

| Profile | Rank 1 (F) | Top-1 under perturbation | Rank 2 (F) |
| --- | --- | --- | --- |
| Mars M1 landing hazard | Iceland (0.970) | 100% | Utah (0.929) |
| Mars M2 rover routes | Iceland (0.795) | 100% | Atacama (0.678) |
| Mars M3 field geology | Wadi Rum (0.811) | 100% | Death Valley (0.549) |
| Mars M4 cold/dry | — none computable (climate missing) | | |
| Moon O1 landing hazard | Rio Tinto (**0.107**) | 93% | Wadi Rum (0.016) |
| Moon O2 EVA/geology | Death Valley (0.526) | 100% | Wadi Rum (0.023) |
| Moon O3 LTV slope mobility | Rio Tinto (**0.178**) | 97.5% | SP Crater (0.030) |
| Moon O4 low-Sun ops | Iceland (0.530, partial) | 100% | Boszhira (0.416) |
| Moon O5 cold/dry | — none computable (climate missing) | | |

The Caspian window is ineligible everywhere (water fraction 0.96 > 0.5 constraint).

**Honest reading:** for Mars, several pilot windows match Jezero's regional terrain well and the ordering is robust to method parameters. For the lunar Mons Mouton target, **no pilot window is a good terrain match** for landing or slope mobility (best F ≈ 0.1–0.2): the target is much steeper than these Earth windows. A ranking still exists, but rank 1 here means "least bad of nine", which the UI must say. These are statements about nine hand-picked windows, not about Earth.

## Not done / not available

- Learned similarity, geology, novelty: `not_available` (gates in the brief §2.1; 9 sites, no patches, no geology).
- Environmental similarity: not available (no climate data).
- No evaluation against reference analogs yet — Stage 2 (reference set + pre-registration).
- Frontend integration not started; contract is DRAFT.
- Web build and Node tests were not run in this session.

## Update · 14 November 2026: geo-0.1.0 connected

The geospatial release (329 Earth AOIs, 326 spatial groups) is now a second input via `--geo`. Tests: 150 passed, 20 skipped (7 new geo tests). Details, acknowledgement to the Geo lead and results: [ML_GEO_INTEGRATION.md](ML_GEO_INTEGRATION.md). The novelty gate (≥ 100 sites) is now met; the novelty model is still Stage 3 work.

## Next (Stage 2, awaiting go-ahead)

Build the evidence-graded reference set, decide on the practice-pool question (#3 in open questions), freeze the pre-registration, then evaluate the deterministic engine and this baseline on it.
