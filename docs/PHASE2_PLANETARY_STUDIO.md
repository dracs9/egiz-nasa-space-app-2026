# EGIZ Phase II — Planetary Studio

Engineering and verification record, 14 November 2026. AI-assisted (Claude Code, Claude Fable 5.2); human scientific review pending. Nothing here is validated against field, test-bed or flight data.

Open it at `/#/planet?data=pilot` (first entry in the main navigation).

## What it is

One workspace in which a single persistent investigation moves through **Discover → Inspect → Simulate → Compare → Decide**. The 3D terrain, the selected point, the mission and the assistant's context stay alive across stages.

```
web/src/planet/
  terrain/site.ts         unified Site model over every terrain package + in-memory quadtree
  terrain/derive.ts       terrain-derived rasters, statistics, shadow march, insolation
  terrain/solar.ts        Sun state, analytic Earth ephemeris, declared beam transmission
  terrain/earthStream.ts  on-demand Earth elevation (AWS Terrain Tiles) on the local metric grid
  render/terrainView.ts   one quadtree renderer for all sites (Three.js)
  render/colormaps.ts     scientific colour scales shared by texture and legend
  compute.ts, planet.worker.ts   Web Worker jobs with a main-thread fallback
  twin/twin.ts            vehicle configuration, scenarios, sensitivity, experiments
  intel/engine.ts         tool registry, intent parser, independent critic
  intel/ml.ts             unsupervised candidate-space model
  workspace/              investigation record, persistence, report generator
  ui/                     shell, stage panels, Discover stage, assistant panel
web/tests/planet.test.ts  38 scientific and integration tests
```

## Base branch

Work is on `feat/phase2-planetary-intelligence`, created from `origin/main` (which carries ATLAS-Π, EGIZ Discover, the geospatial release, the Mons Mouton and Earth world packages) with `feat/cinematic-landing-world` merged in. The checked-out branch at the start had none of those systems.

## What existed and was reused

| System | Where | How Phase II uses it |
|---|---|---|
| `egiz.world_scene` packages (Jezero 1 m, two Earth GLO-30 windows) | `astral/world/core.ts`, `field.ts` | manifest validation, tile decoding, the `Field` grid and its point queries |
| `egiz.world_manifest` lunar pyramid (5 m) | `world/core/world.ts` | loader, tile pyramid, horizon grid, CSPICE record, crater candidates |
| Deterministic mission simulator | `astral/sim/*` | executes every twin run (A* routing, Bekker/Janosi–Hanamoto, energy) |
| Discovery engine and its copilot tools | `discover/engine.ts`, `copilot.ts` | ranking with intervals, gap ledger, all eleven existing tools |
| ATLAS-Π bundle | `data/pilot/atlas_pi.json` | task transferability and measurement planning, read as built |
| Discover map component | `discover/DiscoverMap.tsx` | reused unchanged |

Two existing studios (`/#/astral` for Jezero, `/#/studio` for Mons Mouton) each bound one renderer to one package format. They are untouched and remain available.

## Existing code modified

- `astral/sim/terramechanics.ts`, `astral/sim/mission.ts`: the drive model accepted exactly six wheels. Static load transfer is now written as the moment balance over all contacts, so 4, 6 or 8 wheels are supported. For six wheels it reduces to the original closed form (regression-tested to 1e-6).
- `App.tsx`, `state/store.ts`, `components/SiteHeader.tsx`, `guide/topics.ts`, `content/copy.json`, `i18n/ru.json`: one route, one navigation entry, two translations.

## Capabilities and status

| Capability | Status |
|---|---|
| Unified site model for Moon, Mars, packaged Earth and streamed Earth | Fully implemented and tested |
| Quadtree renderer: screen-space-error LOD, streaming, cancellation, skirts, apron normals, curvature | Implemented with limitations (skirts hide level seams; no geomorphing) |
| Terrain layers: elevation, slope, aspect, roughness, curvature, landform position, coverage | Fully implemented and tested against analytic references |
| Nine rendering modes | Implemented with limitations ("Geological" and "Uncertainty" show substitutes and say why) |
| Sun from ephemeris, computed terrain shadows, direct-Sun fraction, solar energy layer | Implemented with limitations (occluder limited to the packaged grid; shadows on the analysis grid only) |
| Inspection, distance, profile, area, marks, saved views, cross-section dock | Fully implemented; browser-verified |
| Synchronized two-site comparison with common-resolution statistics | Implemented with limitations (no linked cursor) |
| Streamed Earth terrain for any discovery candidate | Implemented with limitations (network required; composite lineage; analytic Sun) |
| Vehicle configuration (4/6/8 wheels, 16 parameters, payload, power, soil, gravity) | Fully implemented and tested |
| Twin run, alternatives, timeline, replay, telemetry export | Fully implemented; browser-verified |
| Before/after scenarios, one-at-a-time sensitivity, cross-gravity counterfactual | Fully implemented and tested |
| Saved experiments with fingerprint reproduction | Fully implemented and tested |
| Intelligence layer: 10 new tools + 11 Discover tools, bilingual intent parser | Implemented with limitations (fixed vocabulary; no language model) |
| Independent critic | Fully implemented and tested |
| Candidate-space ML (PCA, k-means++, outliers, diversity) | Implemented with limitations (unsupervised only) |
| Investigation persistence, import/export, Markdown report | Fully implemented and tested |
| Language-model orchestration of the new tools | Infrastructure only (`TOOL_SCHEMAS` exported; not wired to the server proxy) |
| Open MCT feed from the new twin | Not implemented (CSV export instead) |
| Supervised or pretrained models | Not implemented (no adequate labels) |
| Geological maps, soil, thermal, multispectral data | Not implemented (no dataset integrated) |
| MuJoCo / Basilisk coupling to the new twin | Not implemented |

## Scientific methods

- **Frame.** Local azimuthal-equidistant metres on the body sphere for every site. The scene adds the second-order curvature drop `r²/2R`.
- **Slope, aspect.** Central differences over a stated baseline snapped to whole posts. Border posts are left empty rather than extrapolated.
- **Roughness.** RMS residual about the least-squares plane in a 5 × 5 post window (closed form on a symmetric window).
- **Curvature, landform position.** Laplacian of elevation; elevation minus neighbourhood mean via a NaN-aware summed-area table.
- **Terrain shadow.** March from each post toward the Sun through the occluder grid with growing steps; the ray height includes `d²/2R`. Terrain outside the occluder grid cannot cast a shadow.
- **Solar energy.** Mean of flux × declared beam transmission × cos(incidence on the local surface) over evenly spaced Sun samples. Transmission is assumed: vacuum (Moon), Beer–Lambert τ = 0.5 (Mars), Meinel clear sky (Earth).
- **Analytic Sun (streamed sites only).** Meeus low-precision series. Against the packaged CSPICE record for Boszhira: elevation within 0.3°, azimuth within 0.3°, flux within 3 W/m².
- **Streamed elevation.** Terrarium tiles decoded and bilinearly sampled at the inverse-projected position of each post; the grid's SHA-256 is recorded.
- **Comparison.** Both grids are block-averaged to the coarser posting before slope is measured; the distance between slope distributions is 1-Wasserstein.
- **Vertical exaggeration.** A vertex-shader display transform. Physical shading uses the true normal; heights, layers, shadows and simulation are unaffected.
- **Mobility limits.** The slope screen is the minimum of the plan limit, the tilt limit and the steepest grade the drive model can climb and descend on the chosen soil under the chosen gravity.
- **Sensitivity.** Central log-difference elasticity at ±20 %, one parameter at a time, routes re-planned, in a window of the analysis grid around the mission.
- **Fingerprint.** 64-bit FNV-1a of site identity, configuration, plan and summary at 9 significant digits. An identity check, not a security hash.

## Machine learning actually implemented

`egiz.candidate-space.kmeans 1.0.0`: standardised terrain and climate columns of the discovery index, PCA, seeded k-means++ with k chosen by silhouette over 3–7, top-1 % Mahalanobis outliers, maximal-marginal-relevance shortlist. Fitted in the browser; no pretrained weights and no labels.

Validation: recovery of planted groups on controlled data (ARI > 0.97), seed stability, and a geographic hold-out — centroids fitted on one colour of a 30° checkerboard are applied to the other, so neighbouring windows never sit on both sides. On the measured index (more than 3000 complete rows) the hold-out ARI is above 0.5.

It does not predict analog quality. The 21 published benchmark sites are too few and too biased by logistics to train a supervised model; that remains unbuilt.

## Critic

Re-derived from workspace state, not from the answer text. It rejects when ranks 2–6 overlap rank 1 at the 90 % level in three or more cases, when halving or doubling one weight keeps under 40 % of the top-10, when under 60 % of the active weight rests on measured dimensions, and when a "completed" traverse is claimed for a vehicle smaller than the terrain posting. It cautions on unverified geology, resolution mismatch, statistical outliers, weak cluster structure and unvalidated simulation.

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 50 files, 323 tests passed (285 before Phase II + 38 new) |
| `python -m pytest -q` | 249 passed, 18 skipped, 2 failed |
| `ruff check` | clean |
| `npm run build` | succeeded; `PlanetWorkspace` 203 kB (69 kB gzip), `planet.worker` emitted |
| `tools/check_bundle.py`, `tools/check_secrets.py` | OK |

The two Python failures (`test_bundle_is_reproducible`, `test_catalog_reexecutes_to_same_numbers_and_covers_all_measured_sites`) fail identically on `origin/main` before any Phase II change. The 18 skips are the optional MuJoCo/Basilisk runtimes and an absent source raster.

Browser (built-in preview, 1440 × 900 and 375 × 812, development server):

- Discover: 4544 windows on the map, ranking with intervals, Kazakhstan filter, candidate profile.
- Jezero opened with its orthoimage; a point read −2568.24 m, 3.4° slope; slope layer and legend correct.
- Mons Mouton rendered at 6.1° Sun with computed shadows; direct-Sun fraction integrated over the 30-day record.
- A Kazakhstan candidate (`GX_E052.422_N44.129`) streamed and rendered from 9 public tiles, badged "streamed".
- Assistant-designed traverse on Jezero: 1482 m, 14.12 h, completed; +20 % mass changed energy by +8.7 % and minimum battery by −21.6 %.
- Sensitivity over 8 parameters in 15 s; three-gravity counterfactual in 2.8 s; a saved experiment reproduced its fingerprint exactly.
- Comparison of the streamed candidate with Boszhira at a common 32 m: slope distance 2.76°.
- Report generated with ten sections; investigation restored after reload.
- Four site switches left one canvas and a stable heap (79–98 MB). No console errors on a fresh tab.

Not verified: Firefox, Safari, real phones, screen readers, frame rate on low-end GPUs.

## Performance observed

Twin run on the 1025² Jezero grid: about 1.2 s in the worker. Layers for a 1153² lunar grid: a few seconds, off the main thread. Insolation over the lunar record (48 samples, stride 6): about 15–25 s with progress. Rendering is on demand, so an idle scene uses no GPU.

## Known limitations

- Shadows and layers cover the analysis grid; on the Moon that is the 5.76 km operational box, and terrain beyond the 26 km horizon grid never occludes.
- Level seams are hidden by skirts rather than stitched; there is no geomorphing between levels.
- No per-post elevation error exists for any product, so no quantitative uncertainty map is possible.
- Streamed terrain needs a network connection, is not version-pinned and has mixed lineage.
- The twin is quasi-static: no inertia, suspension, slip-sinkage or steering. Soil profiles are literature values.
- The assistant understands a fixed set of question shapes in English and Russian.
- Studio text is English; only the navigation entry is translated.
- The comparison's second view shows no computed shadows and has no linked cursor.
- Investigations live in browser storage; export the JSON to keep them elsewhere.

## Highest-value missing data

Per-post DTM error maps; LROC NAC orthoimagery for Mons Mouton; a verified geological map for Jezero (USGS SIM 3464) with unit boundaries; thermal inertia (THEMIS) and Diviner temperatures; rock abundance; in-situ soil mechanics for any Earth analog site. None was integrated in this phase.

## Reproduce

```bash
npm --prefix web ci
npm --prefix web run typecheck
npm --prefix web test -- --run
npm --prefix web run build
python -m pytest -q
npm --prefix web run dev
```

Then open `http://127.0.0.1:5173/#/planet?data=pilot`.

## Recommended next milestone

Wire the exported tool schemas to the existing server-side language-model proxy so free-form questions reach the same validated tools, and add a per-post error product so the Uncertainty mode can show real elevation uncertainty.
