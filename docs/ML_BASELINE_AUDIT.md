# ML baseline audit · 7 November 2026

Written with AI assistance (Claude Code); human review pending. Facts below were verified in the `larpmonster67` working copy on 2026-11-07; anything not run is marked as such.

## Environment

- Python **3.11.9** in a venv outside the repository (`C:\Users\acer\.venvs\egiz311`; the session folder path exceeded the Windows 260-character limit for some wheels). Installed from `requirements.txt` ranges, **not** from `requirements-lock.txt` (that lock targets Python 3.13: `numpy==2.5.4` has no 3.11 wheel). Resolved: numpy 2.4.6, scipy 1.17.1.
- Not installed: `earthengine-api`, `astropy`, `spiceypy`, `mujoco`, `bsk` (optional).
- Node/web toolchain not run in this audit.
- Git on Windows with `core.autocrlf=true` rewrote committed JSON to CRLF and broke the SHA-256 bundle check. Set `core.autocrlf=false` locally for this working copy. A repository `.gitattributes` (`*.json -text` or `eol=lf`) would prevent this for every Windows contributor — see [open questions](ML_OPEN_QUESTIONS.md).

## Test baseline (before ML changes)

`python -m pytest -q` → **130 passed, 20 skipped** (skips: missing optional SPICE, MuJoCo, Basilisk, astropy). With CRLF checkout: 1 failure (`test_committed_bundle_integrity`, stale hash) — an environment artefact, not a code defect. After Stage 1: **143 passed, 20 skipped**.

## Data snapshot `data/pilot`

| File | Content |
| --- | --- |
| `earth_candidates.json` | 9 tiles, `synthetic: false`; pools `global` (1), `kazakhstan` (1), `practice` (1: `PR_JETT_SP_CRATER`), remaining pilot windows. 18 provenance records (roles: terrain; environment and land cover). |
| `targets.json` | 2 targets: `MOON_MONS_MOUTON` (PGDA LOLA 5 m, 100 m baseline), `MARS_JEZERO` (MOLA–HRSC 200 m, 400 m baseline). |
| `mission_templates.json` | `MOON_BASE_OPS` (O1–O5), `MARS_SURFACE_OPS` (M1–M4); params `missing_weight_max 0.3`, `gap_threshold 0.1`, `k_max 3`; 6 physical gap alternatives. |
| `sun_windows.json` | Latitude-binned low-Sun hours and sweep. |
| `results.json` | Committed engine output; input hashes match the files (verified). |

Feature shape: per tile `attrs` (terrain at 100 m and 400 m baselines, 2 km regional, relief, elevation, `bare_frac`, climate) and `context` (tree/crop/built/water/snow fractions). Units are in names (`_deg`, `_m`, `_c`, `_mm`, `_frac`, or `frac_` prefix).

**Missing:** `t_min_c`, `t_max_c`, `precip_mm` are null for all 9 Earth tiles; target temperatures are null. Consequently objectives **O5** and **M4** (cold/dry) are non-computable for every candidate (missing weight exceeds 0.3).

**No patch assets, no geographic group IDs, no geology layers.** Earth sampling is regional ~200 m per the README; there is no raster in the repository for Stage 3 learning.

## Engine API used

`pipeline.engine.run.compute_run(candidates, target, template, sun, params)` returns per-objective cells `{F, partial, parts}` or `{F: null, reason: constraint|missing}`. `pipeline.engine.fidelity.objective_fidelity` computes one cell. ML recomputes the engine and checks equality with committed `results.json` (exact match, tolerance 1e-9). `_sun_for` (private) is reused to give identical light context — flagged in open questions.

## How the web app gets data

Static JSON copied by `web/scripts/copy-data.mjs`; no backend. Stage 1 ML output is static JSON in the same spirit (`artifacts/ml/discovery/`, git-ignored; committed examples in `contracts/ml/examples/`). The web app does not consume it yet.

## Gate status (ML brief §2.1)

| Component | Requirement | Snapshot | Status |
| --- | --- | --- | --- |
| Transparent baseline | ≥ 1 target, ≥ 2 candidates | 2 targets, 9 candidates | built |
| Learned ranking | ≥ 30 graded labels, ≥ 3 profiles | 0 labels | not available |
| Terrain encoder | ≥ 50 sites, ≥ 5 000 patches | 9 sites, 0 patches | not available |
| Novelty | ≥ 100 sites | 9 | not available |
