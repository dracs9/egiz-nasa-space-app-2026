# EGIZ 4.0 — native dynamics and measured terrain expansion

Independent development, 20 October 2026. AI-assisted; human scientific review and field calibration remain outstanding. This is a substantial verified increment, not completion of the long-term Space Engineering OS.

## Audit: retained foundation

The baseline was executed before changes: **125 Python tests, 136 web tests, production build passed** (`artifacts/egiz4-baseline.log`). Source inspection confirmed dimensioned six-wheel geometry, configurable torque/speed/power-limited regional rover calculations, energy routing, design sweeps, authentic CSPICE execution, NASA Open MCT recorded telemetry, matched Earth/control experiments and exact campaign search. These were retained.

The existing rover is quasi-static and regional. The previous visual suspension samples an interpolated 200 m DEM; it is not a contact solver. Existing launch/descent are local point-mass calculations, not orbital propagation. Neither the previous nor new work establishes field validation.

## Implemented: actual native engines

### MuJoCo 3.16.0 / RESEARCH

Installed and executed the official CPython 3.13 macOS ARM64 wheel. Original EGIZ MJCF builds a free chassis, six massive passive trailing arms, six steering knuckles, six independently driven massive wheels, spring/damper hinges, joint travel limits and rigid contact. Geometric inertia comes from assigned mass and collision solids. Total vehicle mass exactly matches the configured mass. Nominal whole-vehicle CG height retains its fast-model meaning: the adapter solves chassis height from the declared 75% chassis / 6% arms / 3% knuckles / 16% wheels mass allocation. Articulation changes the loaded COM. This is an independent trailing-arm architecture, **not a rocker-bogie mechanism**.

The actual current rover design supplies mass, wheel dimensions/spacing, CG height, motor shaft torque/speed/power limits, efficiency, idle bus power, speed command and assumed friction. Users can change suspension stiffness/damping, gravity, steering and course geometry. Native `implicitfast` integrates at 2 ms by default; samples are recorded about every 50 ms. Full forward dynamics refreshes the sampled pose/contact state. No analytic fallback runs under a native engine label.

Contact experiments use explicitly **synthetic** flat, asymmetric step or inclined slab geometry in SI metres. MuJoCo outputs chassis pose/velocity, each body pose, wheel spin/steer/suspension angles, contact normal forces and world force directions, signed tread/hub slip and estimated bus energy. Slip uses the non-spinning steering frame. Native geometry and body poses drive the renderer directly. Input and MJCF hashes, engine version, solver settings and actual states are exported.

Limits: the detailed visual skin extends beyond simplified collision solids; instruments, motors and panels use the declared lumped mass allocation rather than individually calibrated inertias. Fixed Coulomb coefficient, rigid ground/wheels, no deformable soil or calibrated regolith, no wear, no structural stress analysis. Vehicle self-collisions are disabled. Contact peaks are sensitive diagnostics, not qualified structural design loads. The electrical estimate includes positive shaft work divided by assumed efficiency plus idle load; it excludes stall copper losses, regeneration and thermal constraints. Only a finite set of controlled numerical cases has been verified.

### Basilisk 2.12.0 / RESEARCH

Installed and executed the official `bsk` macOS ARM64 ABI3 wheel. EGIZ creates a real Basilisk spacecraft, process, gravity body and state recorder. Earth, Moon and Mars support a configurable circular-reference initial altitude, inclination and tangential initial impulse. The native spacecraft/gravity modules propagate Cartesian position and velocity with default RK4 at 2 s. Recorded energy and angular-momentum invariants are independently calculated from these actual states.

The spacecraft marker is enlarged for visibility; it is not a dimensioned spacecraft bus. Orbit replay uses a reference sphere with a true-scale trajectory in a declared body-centered inertial mathematical frame. Existing attributed planetary imagery is visual context, not ephemeris registration or a rotating ground track. Delta-v changes the initial velocity; there is no finite burn, propellant use, attitude control, third body, atmosphere or harmonic gravity model. This does not upgrade the existing local descent solver to 6-DOF.

### Execution, cancellation and archive

`pipeline/dynamics/engines.py` is the actual adapter; `python -m pipeline.dynamics` runs, builds references and reproduces archives. `contracts/dynamics_experiment.schema.json` and browser runtime guards define a new explicit dynamics experiment domain without mislabeling inertial coordinates as local DEM coordinates.

The existing loopback science service now serves only web/dist (not the repository) and accepts bounded native jobs from the same origin. Two isolated subprocesses maximum, a 60 s wall limit, at most eight completed server jobs, validated enumerated inputs, no arbitrary code/path/kernel requests. Cancel terminates the native process. The UI limits automation to three sequential jobs and archives at most twelve experiments in a separate IndexedDB database. Imported native archives re-execute their inputs and compare all numerical state, joint, force, geometry, event and metric fields. Cached references restore their own inputs and are labeled recorded executions; editing them requires explicit native execution. The browser-only application still works without Python.

## Implemented: interactive mechanical world

The established instrument deck, cameras, radiator, foil, wiring and solar hardware are reused. New native bodies own their actual suspension links, pivots, bearing covers, steering/motor assemblies and wheel hubs, fasteners and treads. Rigid details are batched per physical component. The native assembly offers picking, highlight bounds, component selection, exploded inspection, force vectors, chassis tracking and event navigation. Exploded offsets are explicitly visual and pause playback.

A single elapsed-time clock drives both comparison viewports, engineering charts, component telemetry and Open MCT. Views hold the last recorded state after a shorter run ends. No scene animation advances independent physical state. The renderer uses recorded samples; camera controls and inspection remain visual operations.

Open MCT was extended rather than reintegrated. It now consumes either existing local mission records or native dynamics records, including all six contact forces, signed slips, suspension hinges and orbital invariants. Missing quantities are omitted rather than fabricated as zero. The existing strict-CSP plot now supports signed channels.

## Implemented: measured mesh streaming

`make terrain-build` derives a 4 × 4 km Mons Mouton atlas from the fingerprinted cached native **5 m LOLA raster**. The existing all-valid reprojection policy produces a local AEQD grid. Shared vertex posts create 21 tiles: one 40 m, four 20 m, sixteen 10 m meshes. Each fetched tile has SHA-256 verification. The browser loads progressively, replaces a level only when complete, preserves seam agreement and retains missing-data holes. The finest level has 320,000 surface triangles across sixteen tiles; the complete tile payload is approximately 1.82 MiB.

This is actual geometric refinement, not texture displacement. The atlas has surface/slope/elevation views, orbit navigation and two-point ENU measurement/export. Surface normals and chord grade are mesh-derived quantities, not new observations. The method retains source vertical datum and coordinate provenance. Posting is not laser footprint density or vertical accuracy.

Jezero remains a 200 m regional DEM. There is no claim of wheel-scale measured Jezero terrain, global geometry streaming, HiRISE acquisition, deformable terrain, measured rock collision geometry or calibrated solar shadows. Lunar atlas and synthetic contact course are explicitly distinguished.

## Implemented: original robust Earth validation

The retained 17-record mission-aware transfer workflow now has a five-case robustness tool: nominal, traction −20%, rolling resistance +30%, efficiency −10%, and their combined adverse case. It actually reruns the matched mission on every supplied measured window under each assumption set. The nominal records are reused in the browser; the benchmark recomputes all 85 records. A worker, 45 s limit, state budget and termination-based cancellation bound the study.

An original EGIZ implementation of standard **maximin complementary-site optimization** maximizes the worst experimental coverage across cases, then mean coverage, then deterministic tie-breaks. It reports worst utility of nominal and terrain-only selections, case-specific regret and coverage sensitivity as measurement priorities. All stress-run inputs/results and decisions can be exported together with a field-plan addendum.

The application and implementation are EGIZ-specific; maximin optimization itself is established mathematics. The intervals are declared scenario stresses, not measured uncertainty distributions. Utilities are not success probabilities. Measurement response is not Bayesian expected information gain. The native contact solver does not automatically calibrate regional Earth-transfer parameters; field measurements and explicit parameter fitting are still required.

## Mission Engineer

A typed deterministic experiment interface executes three real suspension or impulse variants, compares actual states, exposes violations/events and supports cancellation. It remains usable without AI credentials. No natural-language model/provider integration is claimed; a generic chatbot and fabricated tool results were not added.

## Running the workflows

```sh
.venv/bin/python -m pip install -e '.[science,dynamics,dev]'
npm --prefix web ci
make dynamics-build        # executes MuJoCo and Basilisk; four authentic references
make terrain-build         # requires fingerprinted cached LOLA source
make science-serve         # built app + native APIs at http://127.0.0.1:8766
npm --prefix web run dev   # optional hot-reload UI, proxies the same service
```

Mission Explorer → configure Mars rover → **NATIVE PHYSICS LAB** → Copy active mission design → run contact course → select component/event → change suspension → run/compare. Native archives persist when leaving the tab. For planetary field planning, return to **Earth validation**, build the matched campaign, then execute the robustness study and export the plan/archive. **Orbital flight** operates the Basilisk experiment in the same native laboratory. **Measured atlas** opens the real lunar LOD geometry.

## Fidelity and remaining work

| Level | Implemented scope | Calibration status |
|---|---|---|
| FAST | Existing browser regional rover, local launch/descent and EVA models | Screening approximations |
| ADVANCED | Reserved for separately verified higher-order internal models | No new solver is advertised under this label |
| RESEARCH | Actual MuJoCo contact and Basilisk orbital adapters | Numerically checked controlled cases; no field/flight validation |

Rendering detail does not raise solver fidelity. Priority gaps: wheel-scale measured Jezero geometry, calibrated wheel/soil interaction, true rocker-bogie constraints if selected, manipulator dynamics, finite burns/attitude, 3D guidance and touchdown, planet-wide geometry streaming, automatic multi-fidelity calibration, Bayesian experiment design and a grounded optional natural-language tool planner. Chrono, GMAT, ROS 2/Gazebo are not integrated. Native reference inputs do not constitute a measured planetary digital twin.

## Sources, licenses and competition chronology

- [MuJoCo Python documentation](https://mujoco.readthedocs.io/en/stable/python.html), [official source/license](https://github.com/google-deepmind/mujoco): Apache-2.0. EGIZ uses the engine, not a relabeled physics implementation.
- [Basilisk official source/license](https://github.com/AVSLab/basilisk), [official orbit example](https://github.com/AVSLab/basilisk/blob/develop/examples/scenarioBasicOrbit.py), [maintainer package](https://pypi.org/project/bsk/): ISC. EGIZ adapter/geometry/experiment tools are original; the native integrator and spacecraft dynamics are third-party.
- [PyChrono official installation](https://api.projectchrono.org/pychrono_installation.html): recommends a dedicated conda distribution. This checkout has no conda/mamba; macOS Chrono packages do exist. MuJoCo's maintained native wheel was selected for this bounded multibody slice. Chrono was not installed or claimed technically impossible.
- [NASA PGDA LOLA product](https://pgda.gsfc.nasa.gov/products/78), source URL and SHA-256 retained in the atlas. Existing Three.js, Open MCT and imagery attributions remain in their original files. Optional Python wheel licenses/transitive notices remain with their installed distributions; the environment binaries are not bundled in the web application.
- Native environment versions are captured in `requirements-dynamics-lock.txt`; this is a separate tested environment snapshot, leaving the prior baseline lock intact.
- Current [official team guide](https://www.spaceappschallenge.org/resources/team-formation-guide/) and [terms](https://www.spaceappschallenge.org/legal/) were rechecked; see the retained [20 October rules audit](competition/RULES_RECHECK_2026_10_20.md). Development occurred before the competition period. No eligibility approval, organizer message or competition-period authorship is claimed. Do not change dates or present these features as created during the event.

Exact final verification is recorded in [EGIZ_4_VERIFICATION.md](EGIZ_4_VERIFICATION.md).
