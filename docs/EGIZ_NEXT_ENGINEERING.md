# EGIZ · operating decisions and observation loop

Implemented on 22 October 2026, building on the existing Mission Explorer. Independent, AI-assisted development; human scientific review and physical validation remain pending. Existing attribution, October chronology and competition disclosures are retained.

## Baseline and retained foundation

No applicable AGENTS.md was found in the checkout or its parent directories. README, Mission Lab, engineering/native verification documents and the actual solver/UI/archive modules were inspected before changes. The existing untracked `docs/reports/` material was preserved.

Fresh baseline: **151 Python tests, 169 web tests, production build passed**. The original measured lunar traverse was executed in the browser, with recorded replay and telemetry. Screenshot: `artifacts/next-baseline.jpg`. Logs copied to `artifacts/next-baseline-*`.

Retained: measured Earth/Moon/Mars terrain, map/campaign/evidence tools, vehicle configuration, launch/descent/EVA, NASA CSPICE, Open MCT, MuJoCo/Basilisk, measured mesh atlas, archived experiments, Earth/control campaigns and finite robust campaign search. No framework migration or wholesale scene/solver replacement was performed.

The largest connection gaps were the unconstrained nine-design sweep, criteria separate from alternative selection, event inspection separate from acceptance boundaries, and field plans without an executable measurement/model update. The former independent radius/torque sweep is now reached through **Find a feasible operating mode** and uses fixed hardware/requirements. Other manual design controls remain available.

| Parameter class | Actual role |
|---|---|
| Mass, commanded speed, wheel radius, torque/speed/power envelope, support spans/CG, rolling resistance, efficiency, idle load, battery, route objective | Drive the existing regional calculation |
| Solar aperture/efficiency/transmission + actual recorded CSPICE geometry | Drive the existing electrical collection assumption |
| Wheel width and suspension travel in FAST | Illustrative geometry/articulation; native MuJoCo retains its distinct dynamic inputs |
| Camera, exposure, illustrative sun without SPICE, materials, rocks, relief exaggeration | Display only |

## End-to-end implementation

The existing **Tests** panel now fixes task/hardware/requirements and searches selected speed bounds and allowed route objectives with the existing `simulate` solver. It records baseline plus every evaluated alternative, all gates, supported resource slack and the energy/time/slack Pareto set. Decision priority selects minimum energy, minimum time or maximum supported resource slack. Arrival is mandatory; incomplete tasks cannot earn a feasible result.

The existing rover contract represents payload through total vehicle mass and auxiliary bus demand; there is no separate payload CAD or instrument duty-cycle model. Both total mass and auxiliary demand are frozen during search.

Search deliberately varies operating controls only. Payload, motor, battery, dimensions, efficiency and surface assumptions are not secretly improved. It makes no mass/cost/capability coupling claim for alternative hardware. Hardware design remains an explicit manual experiment until defensible component relations are available.

The worker has a 12 s compute budget, 30 s UI watchdog, at most 21 alternatives, a conservative 300,000 total planned-state bound and 40,000 planned states per record. Each solver call is bounded by the existing model. Cancellation terminates the worker; generation checks reject superseded responses, including edits during execution and asynchronous imports. A single call can exceed the between-record compute budget; the UI watchdog is the outer limit. An exhausted study reports a partial evaluated set, not a proof of infeasibility over the remaining space.

The decision map reruns one or two recorded candidates on a 3×3 finite grid of rolling-resistance factors 0.8/1/1.3 and efficiency factors 0.85/1/1.05 (efficiency capped at 1). Candidate count uses measured nominal compute cost and a state bound, with at most 18 actual stress records. Each cell opens the actual records; choice is minimum energy among feasible candidates. This is conditional sensitivity to declared assumptions, not measured uncertainty, a probability distribution or global robust design optimization.

**Mission chronograph:** the existing transport now includes recorded energy, fixed ceiling, requirement crossing events, elapsed time, coordinates and causal explanations. Threshold locations interpolate recorded samples; they are not a higher-resolution event solver. Selecting an event seeks scene and cursor together and focuses the recorded state. Final-reserve crossings are distinguished from terminal acceptance, since later solar charging can recover reserve. A/B scenes, energy traces and criteria use the same elapsed time, holding shorter records at their terminal state. Before task completion, resource compliance is pending unless an irreversible violation is already recorded.

Complete studies can also be saved in the existing local archive (IndexedDB database upgrade 1→2 preserves the original runs store). Up to three full studies are retained without automatic eviction; the saved study control reexecutes all inputs after a reload. JSON export remains available.

Direct deltas require matching solver/integrator, model class, physical environment, solar geometry and actual route/task geometry. Different routes remain inspectable side by side, with direct deltas disabled. Missing engineering channels remain unknown rather than becoming zero.

## Reproducible measured example

Built-in inputs: default Mons Mouton rover, speed 0.20 m/s, unchanged 900 kg hardware / 3,000 Wh battery; fixed requirements ≤7,200 s, ≤400 Wh, terminal reserve ≥2,500 Wh. These inputs are loaded explicitly; no successful outcome is hardcoded.

An actual local run found:

- Baseline: incomplete route, 3,600 m in 18,000 s, 590.074677 Wh. Four of five gates fail.
- Ten calculated alternatives; six feasible in this declared regional model.
- Minimum energy: **1.20 m/s, astar-energy; 276.840020 Wh, 4,170.785577 s**, 5,004.94 m completed route, 2,723.159980 Wh terminal reserve.
- Minimum time: **1.20 m/s, astar; 282.276825 Wh, 3,746.858845 s**.
- Baseline energy threshold: **T+10,157.933069 s**, local E≈59 m / N≈259 m. Time limit crosses at 7,200 s.
- Two-choice, 18-run stress map: the energy-preferred option remains preferred in all nine tested cells. The map does **not** manufacture a switch.

Both Moon and Mars examples were benchmarked. `tools/reproduce_operating.mjs` reexecutes every archived state/event/route/metric and reevaluates gates, Pareto labels and cell winners. Two 29-record sessions reproduced with zero maximum numerical difference on this host. Runtime/elapsed times are recorded in `artifacts/next-operating-benchmark.json`; they are not cross-device performance guarantees.

## Earth verification and observations

The existing 17-run mission-aware campaign now supplies a concrete test contract: mechanism unknown, measurement needed, supported conclusion and nontransferable planetary properties. Existing known sites and matched controls remain. A bounded enumeration considers non-overlapping ~4 km windows inside each supplied measured Earth DSM, scores the fraction of supported slopes within ±2° of the target route P90 (or its configured boundary when blocked), and returns at most three candidate survey windows with ≥90% gradient support. Local bounds, score, slope band and source fingerprint are reproducible. These are not newly acquired observations or confirmed accessible field sites.

`contracts/power_observations.schema.json` and its synthetic example define a narrow SI JSON import. Required channels: elapsed seconds, known positive total mechanical shaft power in W, bus voltage in V and bus current in A. Provenance, hardware identifier, instrument, conditions, declared uncertainty, timestamps and a sample-gap limit are required. One fit series and one separately identified validation series are mandatory. Missing/nonfinite channels, wrong units, gaps, duplicate series identifiers and insufficient load excitation fail closed.

The model fits `Pbus = Pidle + Pshaft / η`, two identifiable parameters. Holdout rows never enter fitting. Both raw series, prior parameters, fitted values and fit/holdout RMSE are embedded in the applied scenario. Application is limited to matching declared hardware in a physical Earth rover experiment. It does not calibrate friction, rolling resistance, soil, temperature response or planetary conditions. The importer declares independent acquisition; software cannot establish physical independence or instrument truth from metadata alone.

The explicitly synthetic control recovers **η=0.76, Pidle=65 W**; exact algebraic holdout residuals round to 0.000 W, versus prior model RMSE 36.417 W. This is software verification only. In the production browser, importing this file, applying it to the Iceland Earth record, rerunning and saving produced **205.43 Wh in 3,721.68 s**, with the synthetic calibration label visible and full provenance retained. Physical validation remains unconfirmed.

## Visual implementation and resource use

Original EGIZ navigation and side instruments remain. Graphite/black surfaces, warm text, brass selection, tabular mono telemetry, a low-angle illustrative key light and closer vehicle framing strengthen the central scene. Scientific view retains its original exposure and the identical calculation. Representation handoffs identify planetary imagery, regional measurements and recorded vehicle states. Reduced-motion CSS and existing camera behavior are retained; no new postprocessing or always-on effects were added.

A local production replay measured **60 fps active, 172 draw calls, ~321k triangles, DPR 1.5, CPU submit 0.54 ms, GPU 4.30 ms**. This is one observed desktop sample, not a mobile/GPU guarantee. The existing idle/hidden scene render guards and lazy native/Open MCT/model workspaces remain. Terrain preview profiles are now memoized across playback ticks. Study JSON review shows a bounded manifest; full telemetry remains in the downloadable archive instead of inserting tens of megabytes into a textarea.

## Demonstration · 2–3 minutes

1. Open `/#/lab?data=pilot&target=MOON_MONS_MOUTON`, then **Tests**. Select **Load the mission constraint example → Search fixed requirements**. Show 6/10 and switch decision priority between energy and time.
2. Open the baseline energy violation. The chronograph and 3D state move to T+10,157.9 s. Open the recommended record and **Compare A/B**; show the incomplete baseline and completed alternative, synchronized events/plots, and the disabled direct-delta explanation.
3. Return to **Tests**, calculate the decision map; explain that all nine finite cases retain the same energy choice. **Prepare Earth verification → Build mission-aware campaign → Inspect Iceland** shows the measurement contract and candidate survey windows. Save the complete study on this device, or export its JSON and the field plan.

For the observation loop: replay the physical Iceland Earth test, return to **Earth tests**, import `contracts/examples/power_observations.json`, inspect fit/holdout residuals, apply the explicitly synthetic model, calculate and save. Importing the complete study recalculates its baseline, alternatives and stress map rather than trusting uploaded telemetry.

## Commands and remaining scope

```sh
npm --prefix web run dev
# Optional native engines / custom SPICE epochs:
make science-serve
# Validation / exact record reproduction:
make check
node tools/benchmark_operating.mjs
node tools/reproduce_operating.mjs artifacts/next-MOON_MONS_MOUTON.json
node tools/reproduce_operating.mjs artifacts/next-MARS_JEZERO.json
```

The new import is JSON, not arbitrary laboratory CSV. Calibration is the narrow electrical model; no real measurement series was available. Search does not optimize hardware bills of materials or run native dynamics for every candidate. Candidate windows cover the cached pilot DSMs, not a global site search. Regional grids do not resolve contact obstacles; native rigid contact does not establish regolith behavior; SPICE visibility is not a radio link budget. Mobile CSS was exercised in a real narrow iframe because the in-app browser ignored viewport overrides; physical mobile hardware, reduced-motion OS settings and weak-GPU performance were not observed. See `EGIZ_NEXT_VERIFICATION.md` for final checks and evidence.
