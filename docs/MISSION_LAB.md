# EGIZ Mission Lab · implemented model 1.0.0

**20 October update:** this document preserves the model-1 reference. Rover engineering model 2.0, actual SPICE/Open MCT integrations, configured vehicle geometry, power telemetry and mission-aware Earth validation are documented in [ENGINEERING_EVOLUTION.md](ENGINEERING_EVOLUTION.md). Legacy inputs remain reproducible; new rover defaults enable the engineering model.

Independent, AI-assisted product development on **18 October 2026**. This document describes implemented behavior, not a complete aerospace digital twin or externally validated prediction system.

## Run and reproduce

```bash
npm --prefix web ci
npm --prefix web run dev
# Open /#/lab?data=pilot&target=MARS_JEZERO

# Rebuild measured grids only when the cached source rasters are present:
.venv/bin/python -m pipeline.common.mission_terrain

# Numerical tests and reproducible pilot benchmark:
npm --prefix web test -- src/mission
node tools/benchmark_mission.mjs  # Node 22.18+; tested on Node 24
node tools/reproduce_mission.mjs artifacts/mission-browser-export.json

# Full regression and offline build:
make check
make offline
python3 artifacts/egiz-offline/serve.py --no-network
```

## Product workflow and signature demonstration

1. Select Jezero in Campaign, inspect the existing evidence and selected analogs, and open **Mission Lab**. Mission Lab preserves the campaign optimizer and uses its selected candidates.
2. Inspect the 200 m reconstruction. Orbit, zoom, switch to overhead/follow/ground camera, inspect local coordinates, change slope/elevation layer, or measure the A–B section. Ground camera uses focused WASD/arrow keys in 5 m increments with a 2 m viewing clearance: it is a regional inspection camera, not a human-eye walking simulation.
3. Start the default **Rover traverse**. Its path is calculated with A*, with slope and traction constraints. Play, pause, seek, restart and change replay speed. The route, event stream and charts consume the same snapshots.
4. Open **Scientific analysis** for the calculated outcome and explicit limitations. Add surface observations and export a surface plan. **Habitat & EVA** reuses the regional traversal screen with a habitat-origin marker, an EVA mass/speed preset, a line-of-sight check and the same explicitly mechanical energy proxy. It does not predict astronaut metabolism or life support.
5. Open **Compare & sensitivity → Run analog experiment**. This computes the planetary mission plus two terrestrial candidates, each under Earth parameters and substituted target parameters. Geometry statistics, route outcomes, energy bars and deterministic explanations distinguish terrain from environment effects.
6. Compare the Iceland and Wadi Rum results. In the default rover case Iceland supports the regional route under both environments, while Wadi Rum remains blocked under the configured slope/traction limits. This makes the limits of analog transfer visible without changing the campaign’s scientific scores.
7. Run **Launch & flight** and **Descent & landing**. Presets are invented engineering scenarios, not replicas of real spacecraft. Change parameters to test no liftoff, propellant depletion, impact, safe-speed contact or a regional slope failure.
8. **Save** stores full experiments in IndexedDB on this origin/device. **JSON** opens a complete archive with download, clipboard-copy and selectable-text options, including for embedded browsers without native download support. It embeds the scenario, terrain snapshot, original input/source hashes, constants, model/integrator version, states, events and metrics. Markdown reports summarize results. **Import & reproduce** validates the schema/model, matches embedded terrain against the currently loaded measured bundle, and recalculates outputs; it never trusts uploaded telemetry. A different dataset version must be loaded to reproduce an older terrain snapshot. Hash labels alone cannot authenticate arbitrary uploaded elevations.

## Architecture

| Layer | Implementation | Responsibility |
| --- | --- | --- |
| Scientific acquisition | Existing `pipeline.planets.access` and source caches | Native CRS reading, body-aware projection and validity masks |
| Reconstruction | `pipeline.common.mission_terrain` | Separate versioned 100×100 grids; no ranking-input changes |
| Terrain queries | `web/src/mission/terrain.ts` | Bilinear sampling, central gradients, sections, line of sight, validation |
| Scenario | `types.ts`, `environment.ts` | SI units, versioned inputs, explicit native/Earth/counterfactual semantics |
| Physics and routes | `engine.ts`, `routing.ts` | Pure deterministic calculation, RK4 flight, A* and kinematic traversal |
| Worker | `workers/mission.worker.ts` | Batch execution away from the UI; 45-second UI watchdog |
| Visualization | `TerrainViewer.tsx` | Three.js indexed measured mesh, cameras, layers, symbolic markers, recorded trajectory |
| Analysis | `analysis.ts`, `ComparisonEvidence.tsx` | Empirical terrain quantiles, comparisons and result-backed explanations |
| Persistence | `storage.ts` | IndexedDB, validated imports, portable JSON and Markdown reports |
| Workspace | `MissionLab.tsx`, `mission.css` | Configuration, validation, shared playback clock, telemetry, experiments |

Rendering is not the scientific integrator. The worker computes the complete bounded run, then the interface replays recorded states. There is no random telemetry, scripted flight path, LLM dependency, server, cloud database or paid API. IDs/timestamps differ between executions; numerical states are deterministic for identical inputs, model code and runtime. Different JavaScript engines may differ at floating-point roundoff; the reproduction CLI compares numerical fields with absolute 1e-9 plus relative 1e-12 tolerance, not a promise of scientific accuracy. The seed is retained but unused because the current models have no randomness.

## Terrain and provenance

The new product reconstructs 11 existing measured windows: nine Earth, one Moon and one Mars. The water-dominated Kazakhstan candidate remains in the source bundle for audit, but is excluded from the Mission Lab Earth selector and comparison batches using measured cover. A campaign selecting fewer than two sites supplies its selected sites first, then eligible existing windows fill the comparison slots; the fallback windows are not described as selected by the optimizer.

Each 20 km window is averaged onto 200 m north-up cells with the existing all-valid-footprint mask. A grid has 100×100 pixel centers, from −9,900 to +9,900 m east and +9,900 to −9,900 m north. No interpolation or procedural detail is added to the observations. Serialized millimetres are numerical storage precision, not terrain accuracy. Mesh cells containing missing samples are omitted. Physics bilinearly interpolates neighboring valid samples; the render uses triangles, so their sub-cell interpolation can differ slightly. Marker vertical offsets are visual only.

- **Earth:** Copernicus GLO-30 Public 2021, approximately 30 m source posting, local UTM, EGM2008 orthometric elevations. This is a digital surface model, including canopy/buildings where present. [AWS registry](https://registry.opendata.aws/copernicus-dem/) and [provider documentation](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM.html). Existing acquisition dates/URLs/hashes are preserved; processing here does not imply new acquisition. The public-product license/attribution applies; the separately restricted Copernicus view service is not used.
- **Moon:** [NASA PGDA LOLA Site20v2](https://pgda.gsfc.nasa.gov/products/78), 5 m posting before downsampling, native south polar stereographic / MOON_ME DE421, local AEQD on a 1,737,400 m sphere. Source interpolation/error limits remain. The site center is the previously documented raster extent center, not an official base selection.
- **Mars:** [USGS MOLA–HRSC blended DEM v2](https://astrogeology.usgs.gov/search/map/Mars/Topography/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendShade_Global_200mp_v2.lbl.xml), 200 m posting, local AEQD on a 3,396,190 m sphere. This is regional topography, not a wheel-scale Jezero DTM.

Raw raster SHA-256, source URL/native CRS, local CRS/origin and candidate/target input hashes travel with every experiment. The builder refuses changed raw rasters or stale evidence. Absolute heights retain their native datums and are never compared between planets. Comparison slope statistics use a 400 m central-difference stencil over the 20 km reconstruction; campaign fine-core statistics remain separate. Line-of-sight sampling uses quarter-cell increments of the interpolated surface and 2 m endpoint heights; Earth curvature, buildings, vegetation and local obstacles are unresolved.

The initial viewer used schematic markers. The 18 October observatory update adds original procedural vehicle assemblies, illustrative PBR microtextures, shadows, camera rigs, recorded-state interpolation and synchronized comparison scenes; see [implementation and verification](VISUAL_REVOLUTION.md). No photography or external vehicle models were added. Three.js (MIT, pinned in the lockfile) is lazy-loaded with Mission Lab. The scene uses measured macroterrain plus explicitly illustrative surface materials and sunlight, not validated seasonal illumination. Original engineering vehicle geometry uses metric dimensions; regional markers are explicitly symbolic. Relief exaggeration affects only display and defaults to 1×. The regional footprint mesh is about 19,602 triangles; the vehicle-scale interpolation patch and vehicle assemblies add detail without adding observations. Progressive global tiling is unnecessary for this slice. GPU resolution is capped, idle scenes avoid redundant rendering, and a topographic fallback handles unavailable WebGL.

## Flight equations and numerical treatment

State is east position x, datum height z, horizontal velocity u, vertical velocity w and propellant p. North position is fixed. Mass m = dry mass + p. The thrust angle θ is fixed relative to vertical for launch; descent thrust is vertical.

```text
dp/dt = −T / (Isp × g₀)                 g₀ = 9.80665 m/s²
dx/dt = u                              dz/dt = w
du/dt = (T sin θ − ½ρ Cd A |v| u) / m
dw/dt = (T cos θ − ½ρ Cd A |v| w) / m − g
q = ½ρ |v|²                            |v| = sqrt(u² + w²)
ρ = ρref exp(−max(−500, h) / H)
```

Earth h is datum elevation (an approximate use of orthometric height); Mars h is height above the initial local surface; Moon is vacuum. Reference gravity is Earth 9.80665, Moon 1.62, Mars 3.71 m/s². Reference density is 1.225, 0, 0.02 kg/m³ respectively; H is 8,500 m for Earth and 11,100 m for Mars. These are rounded scenario assumptions, not measured local atmospheres. Reference pressure and temperature are displayed context and do not drive thermodynamics. References: [NASA rocket equation](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/ideal-rocket-equation/), [NASA drag equation](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/drag-equation/), [NASA planetary fact-sheet ratios](https://nssdc.gsfc.nasa.gov/planetary/factsheet/planet_table_ratio.html).

Launch supports 1–16 piecewise-constant throttle commands (0–100% of configured maximum thrust), starting at t=0 with strictly increasing times. The optional program is preserved in exports; omitted programs retain constant full thrust. Delayed ignition, coast and restart commands are supported subject to remaining propellant. This is ideal instantaneous throttling, without engine transient or restart restrictions.

Classical RK4 advances the point mass. Configured timestep is an upper bound: steps split at throttle changes, fuel exhaustion and the time horizon, and are bounded to one-quarter terrain cell in horizontal motion using a conservative thrust acceleration estimate. Thrust is frozen within a descent controller step. Ground contact is located with 30 bisection iterations using the same RK4 substep. Launch stays on the pad until vertical thrust exceeds weight; release from changing mass is limited by the configured step, while scheduled command times are exact. Maximum altitude/speed/pressure are sampled extrema, not continuous analytic maxima. The engine records an apogee sign-change bracket rather than inventing an exact apogee time. Integration stops at invalid terrain, 100 km height above the initial surface, 5 km/s, or 120,000 steps. Local constant gravity is already approximate before these bounds.

The descent controller activates below the configurable ignition AGL. Available deceleration a = max(0.1, Tmax/m − g). Desired vertical speed is:

```text
wdesired = −max(0.8, min(25, 0.2 × AGL, 0.35 × sqrt(2a × AGL)))
T = clamp(m × (g + (wdesired − w) / 0.6), 0, Tmax)
```

This explicit demonstration controller uses a stopping-distance envelope and a height-proportional terminal approach. It is not optimal guidance. Ignition is a sampled event; controller behavior is not globally fourth-order even though each smooth dynamics step uses RK4. Convergence checks therefore report actual differences rather than promising RK4 order for switched guidance.

Outcomes: no liftoff; duration complete (incomplete flight); terrain boundary; model/integration limit; launch ground impact; excessive touchdown speed; excessive regional slope; unresolved slope; or soft landing under both user thresholds. Defaults are ≤3 m/s and ≤10° regional slope. A soft result never resolves sub-grid landing hazards. Fuel depletion is an explicit timeline event; a subsequent hard contact is still classified by touchdown speed.

## Surface model

A* searches eight-neighbor grid nodes, minimizes three-dimensional segment length and uses straight-line horizontal distance as an admissible heuristic. Direct mode checks a single segment. Every candidate segment samples full regional gradients at quarter-cell spacing and must satisfy:

```text
regional slope ≤ configured limit
tan(regional slope) + Crr ≤ μ
```

The second criterion is a deliberately conservative screening approximation applied uphill and downhill, not a validated wheel/regolith law. Sub-grid clearance, rollover and surface roughness are not estimated from an inadequate 200 m grid.

For segment grade α and three-dimensional length ds:

```text
speed = cruise speed / (1 + 3 tan |α|)
dE [Wh] = (m g (Crr cos α + max(0, dz/ds)) / efficiency × ds
           + idle power × dt) / 3600
```

The speed penalty and resistance/traction parameters are explicit engineering assumptions. No regenerative braking is credited. Segment energy and travel time are clipped exactly at time/energy budgets. A* plans on the coarse grid; endpoints connect to nearest nodes after checking admissibility. Ground motion is kinematic with instantaneous segment speed changes, not an acceleration/contact solver. The EVA mode uses the same mechanical cost proxy and must not be interpreted as human energy expenditure. Models currently share one planner; there is no manual driving or multi-agent coordination.

## Comparisons, sensitivity and limits

Analog batches hold vehicle, mission start/destination offsets and operation limits constant. The planetary target runs with its own reference environment. Each selected Earth terrain runs once with Earth physics and once with substituted planetary parameters. Identical local offsets are a controlled regional sampling convention, not evidence that features at those offsets correspond geologically. In this rover model, gravity affects mechanical energy; it cancels from the simple traction inequality, so changing gravity alone cannot rescue a blocked slope route.

Five deterministic perturbations vary launch thrust, descent initial velocity, or surface slope limit by −20%, −10%, 0, +10%, +20%. These are sensitivity sweeps, not Monte Carlo, confidence intervals or success probabilities. At configured parameter bounds some sweep values may coincide; invalid batches are rejected. Terrain quantiles are empirical summaries of valid grid slopes and relief. They do not include DEM error uncertainty.

## Executable follow-up backlog

1. Acquire a defensible local high-resolution DTM with spatial error products. Add a second resolution tier only with matching raw provenance, nodata and effective-resolution tests. Then investigate clearance/roughness and landing-footprint uncertainty.
2. Add controller event localization and analytic terrain-intersection segments; compare with independently implemented flight reference solutions. Add height-dependent gravity only with a consistent body/reference model and benchmarks.
3. Extend the implemented piecewise-constant throttle program with validated engine transients, downrange guidance and per-vehicle geometry. Do not call the present solver six-degree-of-freedom flight dynamics.
4. Add archived-model migrations, cryptographic reconstruction manifests and multi-version dataset selection; preserve fail-closed imports when a source version is unavailable.
5. Add measured Earth atmospheric inputs with timestamps/uncertainty before describing the Earth analog environment as observed. Add parameter uncertainty only with justified distributions.
6. Add saved multi-waypoint routes and habitat/station layouts, manual command replay, terrain-aware route alternatives and visibility uncertainty. Do not turn regional mechanical cost into EVA physiology.
7. Add a permanent browser regression harness and GPU/frame-time benchmarks on physical mobile hardware. Current browser checks are manual through the local automation tool; no universal frame-rate claim is made.

## Competition disclosure

The official [2026 Team Formation Guide](https://www.spaceappschallenge.org/resources/team-formation-guide/) was re-read in the browser on 18 October 2026. It says participants must wait until **14 November 2026, 09:00 local time** to begin challenge work. The user explicitly authorized independent development now. This does not provide organizer permission or establish eligibility. Preserve the October source/history and disclose it accurately; eligibility and permitted reuse require an organizer determination. No messages were sent, project submitted, repository published or public deployment performed.
