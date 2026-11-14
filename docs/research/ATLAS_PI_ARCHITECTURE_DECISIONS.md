# ATLAS-Π architecture, repository audit and decisions

Written with AI assistance (Claude); human review pending.

## 1. Repository audit (13 November 2026, branch `main`, uncommitted user files `docs/reports/` untouched)

| Area | Status found | Evidence |
|---|---|---|
| Measured pilot bundle (`data/pilot`) | **Implemented, real**: 9 Copernicus GLO-30 Earth windows (one water-dominated, excluded), LOLA 5 m Mons Mouton, MOLA-HRSC 200 m Jezero, ESA WorldCover fractions, 200 m mission grids, SPICE geometry | `synthetic: false`, SHA-256 per raster |
| Climate / temperature / precipitation | **Missing** (adapters implemented, not run) | `attrs.t_min_c = null` everywhere |
| Global discovery | **Missing** in the existing engine (purposive windows only) | `earth_acquisition_report.json` |
| Objective fidelity, k ≤ 3 campaign, gap ledger | **Implemented** (`pipeline/engine`) | `results.json` |
| Validation experiments E1–E5 | **Not run** | `validation.json` statuses |
| Same Sun twin | Partially synthetic per README (not re-verified) | — |
| Mission Lab, dynamics (MuJoCo/Basilisk), SPICE, Open MCT | **Implemented** (TS + optional Python services) | README, tests |
| Web stack | React 19, TypeScript 7, Vite 8, Zustand 5, MapLibre 6, Three 0.186, Open MCT 4.3.1; static JSON, no backend | `web/package.json` |
| Python | numpy 2.4, scipy 1.18, rasterio 1.5, spiceypy 8.0, astropy 8; no torch/sklearn | `.venv` |

There is no HTTP API: the browser loads versioned static JSON per data mode, and optional loopback services exist only for SPICE/dynamics. ATLAS-Π follows the same model, so the "API" is a typed, schema-validated bundle plus a CLI.

## 2. Module map (additive; no existing module rewritten)

```
pipeline/analog_transfer/
  config/            versioned registries: tasks.json (12 tasks, 11 factors, status rules, missions),
                     physical_factors.json (9 conditions + references), measurements.json, site_context.json
  registry.py        load + validate configuration (fails loudly)
  features.py        200/400/800 m slope, roughness, relief, traversability; 4 km block bootstrap; W1
  counterfactual.py  CF_TERRAMECHANICS (Bekker, load- vs mass-matched), CF_SOLAR (SPICE geometry)
  transfer.py        factor records, pure assess() status rules, tensor, certificates
  constellation.py   requirements, LCB contribution matrix, exact optimiser, greedy, Pareto, sensitivity
  planner.py         Monte Carlo EVPI over the portfolio decision; per-site placement
  evidence.py        claim → comparison → feature → dataset graph
  redteam.py         deterministic A–H adversarial review
  evaluation.py      H1–H6, controls, ablations, robustness
  discovery.py       Kazakhstan coarse-to-fine screen (GLO-90 → GLO-30)
  dossier.py         Markdown Planetary Transferability Dossier
  build.py, __main__.py   orchestration + CLI (build | verify | dossier | counterfactual | discover)
contracts/atlas_pi.schema.json      bundle contract (JSON Schema 2020-12)
tests/test_analog_transfer.py       39 unit/fixture/integration tests
web/src/atlas/                      lazy route #/atlas: AtlasLab.tsx, physics.ts (parity-tested port), types.ts, atlas.css
```

Minimal shared edits:

- `web/src/state/store.ts` (route), `SiteHeader.tsx` (nav item), `App.tsx` (lazy import), `guide/topics.ts`, `content/copy.json`, `i18n/ru.json`;
- `web/scripts/copy-data.mjs` packages `atlas_pi.json` only when its recorded input hashes match the packaged pilot files;
- `web/src/styles/theme.css` tightens nav spacing at ≤ 1180 px so seven items fit at 1024 px.

## 3. Decisions

| # | Decision | Alternatives considered | Reason |
|---|---|---|---|
| D1 | Keep similarity, evidence coverage, evidence quality, resolution and physics as separate axes; derive status by ordered rules | Weighted composite score | The directive and the scientific need: a composite hides non-transferability |
| D2 | Thresholds in tolerance units (z = 1, z = 2) | Arbitrary 0.7/0.4 cut-offs | Interpretable; varied ×0.5/×2 |
| D3 | Wasserstein-1 between quantile functions at matched 200/400/800 m cells | Mahalanobis on summary statistics | 11 windows cannot support a covariance estimate; W1 is in physical units (degrees) |
| D4 | Spatial block bootstrap (4 km blocks) | i.i.d. pixel bootstrap | Pixels are spatially autocorrelated; i.i.d. would understate intervals |
| D5 | Lower confidence bound in the optimiser + exact enumeration | Greedy on point estimates | Penalised objective is non-monotone; pools are small enough to be exact |
| D6 | Physics enters only through primary dependencies; secondary ones are listed, never silently scored | Penalise every dependency | Otherwise every task collapses to CONDITIONAL and discrimination is lost |
| D7 | SUPPORTED requires evidence quality ≥ 0.6 | Status independent of quality | Unverified (grade D) premises must not yield SUPPORTED |
| D8 | No ML model | Small CNN/MAE embeddings | No labels; leakage-prone; no measurable value demonstrable |
| D9 | Static bundle + CLI, not a server | REST API | Matches the existing architecture (offline package, no backend) |
| D10 | Mars gravity 3.73 m/s² (NSSDCA, updated 2025-05-19) | 3.71 used by Mission Lab | Verified current value; the discrepancy is documented, Mission Lab is left unchanged |

## 4. Concurrent-development safety

- No branch switch, commit, push or reset.
- New files are isolated under `pipeline/analog_transfer/`, `web/src/atlas/` and `docs/research/ATLAS_PI_*`.
- Shared files received small additive edits (listed above).
- `data/pilot/atlas_pi.json`, `atlas_solar.json` and `atlas_discovery.json` are new generated outputs; existing pilot files are unchanged.
