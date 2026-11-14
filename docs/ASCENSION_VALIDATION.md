# Ascension validation · 18 October 2026

Independent AI-assisted implementation and local verification. These are software and simplified-model checks, not external aerospace validation. The pre-existing working tree was preserved; no remote changes or deployment were made.

## Regression results

`make check` passes: **122 Python tests**, **96 Vitest tests in 23 files**, Ruff, TypeScript, task validation, data contracts/fingerprints, secret-pattern checks and production build. Baseline was 120 Python / 63 UI tests. The new Mission Lab contributes 27 engine/data/analysis tests and 6 UI workflow tests; two Python tests check measured grid geometry/nodata and source provenance. Logs are retained locally in `artifacts/ascension-check.log` and `artifacts/ascension-build.log`.

Flight tests compare vacuum ballistic altitude/velocity and contact time to analytic solutions; variable-mass flight to the rocket equation with gravity loss; propellant conservation including off-step burnout; drag/vacuum and cross-body differences; smooth-dynamics timestep refinement; controlled descent; excessive slopes; no liftoff; deterministic replay; and invalid inputs. Programmed thrust tests use off-grid changes at 3.37 and 7.13 seconds, exact integrated propellant, analytic velocity, delayed ignition and backward-compatible constant thrust.

Surface tests cover plane gradients, nodata, slope/traction constraints, A* detours, route/energy/time limits, line of sight, result export/import and matched analog comparisons. Uploaded grids with retained hash labels but changed elevations are rejected. UI tests exercise calculation, pause/restart, complete archive export, save, the five-run analog batch, throttle editing, invalid inputs, synthetic-data exclusion and recoverable loading errors. The test viewer/worker/storage adapters are mocked; browser checks below exercise the real components separately.

## Reproducible measured benchmarks

Run `node tools/benchmark_mission.mjs` with Node 22.18 or newer. The retained `artifacts/mission-benchmark.json` records all inputs, 24 scenarios, runtime, measurements and slope statistics. The example `artifacts/mission-reproduction.json` is a full Jezero descent archive. Timing is one local CPU execution per case, not a statistical performance study: the latest sweep’s slowest case took **15.82 ms** on this host. It includes result copying and excludes data acquisition, worker transfer, GPU rendering and browser layout. No universal FPS or mobile hardware claim is made.

Default Jezero scenarios on the measured 200 m grid:

| Mode | Calculated outcome | Key result |
| --- | --- | --- |
| Rover | Destination reached | 4,463.259 m, 5,783.331 s, 393.198 Wh mechanical/idle proxy |
| Launch | Local model boundary | Stops before 100 km above the start surface; no orbital-success claim |
| Descent | Soft landing under configured thresholds | 0.799866 m/s, 52.714742 s, 112.248833 kg propellant |
| EVA preset | Destination reached | 4,463.259 m, 4,626.665 s, 143.987 Wh mechanical proxy; not physiology |

Measured descent refinement:

| Configured dt (s) | Contact time (s) | Contact speed (m/s) | Fuel (kg) |
| --- | --- | --- | --- |
| 0.2 | 52.55465 | 0.79972 | 111.9693 |
| 0.1 | 52.71474 | 0.79987 | 112.2488 |
| 0.05 | 52.79319 | 0.79995 | 112.3858 |
| 0.025 | 52.78183 | 0.79999 | 112.3660 |

The switched, sampled controller does not have global RK4 order. Contact time changes by about 0.239 s over this sweep. Smooth ballistic/drag cases have separate analytical/refinement checks. Further controller-event localization remains in the backlog.

The matched rover comparison calculates **770.3 Wh** for Iceland with Earth parameters and **376.6 Wh** with substituted Mars parameters, over the same 4,466 m regional route. Wadi Rum is blocked in both environments by the stated slope/traction model. This is an explicit environmental substitution, not a claim that Iceland physically has Mars gravity or that either site is operationally certified.

## Actual browser verification

Tested the real dev app and the built offline package through the Codex in-app browser:

- Measured Jezero 3D mesh; orbit, overhead and regional ground camera; keyboard movement; elevation/slope layers; coordinate picking; observation placement and its recorded datum height.
- Real worker calculation, advancing vehicle/trajectory, synchronized telemetry/charts, pause/restart, replay speed, completed rover and descent outcomes, bounded launch and parameter rejection.
- Five-run native/Earth/counterfactual comparison, geometry statistics and result-backed explanations.
- IndexedDB save persisted across reload; imported full descent archive was recalculated successfully.
- The final launch UI used 75% thrust followed by shutdown at 3.37 s. The copied archive contains all 219 frames and the exact event time. The browser clipboard content was parsed and saved as `artifacts/mission-browser-export.json`.
- `node tools/reproduce_mission.mjs artifacts/mission-browser-export.json` re-executes that browser archive in Node. Outcomes, metrics and event times match exactly. Maximum telemetry difference is 8.881784197001252e-16 Pa in dynamic pressure. This is cross-engine floating-point roundoff; byte-for-byte numerical identity across engines is not claimed. `artifacts/mission-reproduction-check.json` and the generated Markdown report preserve this check.
- Native Blob-download completion was not exposed by this embedded browser. Download buttons remain available; the verified copy/selectable archive panel provides a working alternative. Native Markdown/report download delivery was not separately verified.
- Desktop 1,440×1,000 and narrow 390×844 viewport checks: no document horizontal overflow; mobile canvas 345 px within a 375 px content viewport. These are browser viewport tests, not physical-device performance measurements.
- Offline server used `--no-network` (same-origin CSP, external services blocked). The measured scene, worker, comparisons and archive copying worked. No console errors were observed in the final offline run. This is a CSP-isolated run, not an operating-system network-disconnection test.

Screenshots: `artifacts/missionlab-desktop.jpg`, `artifacts/missionlab-full.jpg`, `artifacts/missionlab-mobile.jpg`. Distribution: `artifacts/egiz-offline.zip`; extract and run `python3 serve.py --no-network`. Fonts, terrain, scripts and workers are bundled.

## Scope still requiring work

The implemented product is a measured regional reconstruction and reproducible mission-screening lab. It does not resolve wheel/landing-footprint hazards, six-degree-of-freedom spacecraft dynamics, orbit, observed weather, thermal/dust/seasonal illumination, astronaut physiology or probabilistic mission risk. Scientific limitations, equations, source links, architecture, the demo journey and an executable follow-up backlog are in [MISSION_LAB.md](MISSION_LAB.md).

The official 2026 guide restricts challenge work before 14 November at 09:00 local time. This October work is explicitly disclosed as independent pre-event development; competition eligibility is unresolved, not assumed.
