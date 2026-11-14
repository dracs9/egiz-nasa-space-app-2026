# EGIZ engineering evolution · 19–20 October 2026

> Subsequent expansion: [EGIZ 4 native dynamics, measured mesh streaming and robust validation](EGIZ_4_ENGINEERING.md). MuJoCo and Basilisk now execute; this document retains the preceding cycle’s baseline and decisions.


Independent pre-event development, explicitly requested by the repository owner. This is a substantial verified increment, **not completion of the long-term Space Engineering OS vision**. Existing uncommitted work was retained. No publication, submission, history rewrite or organizer communication occurred.

## Audit and architectural decision

The existing application was run in the browser before editing. `MISSION_LAB.md`, `SCIENTIFIC_METHODOLOGY.md`, `engineering/REAL_DATA_GUIDE.md`, the pipeline, contract system, workers, store, source packaging, mission engines, rendering runtime, tests and reproduction tools were inspected. Baseline `make check`: **122 Python tests, 122 web tests, type checking, data/secret checks and production build passed**.

Confirmed existing systems: separately packaged observed/synthetic sources; nine Copernicus/WorldCover Earth windows; NASA LOLA lunar terrain; USGS 200 m MOLA–HRSC Jezero terrain; objective fidelity and complementary campaign optimization; exact preference frontier; original globe and articulated vehicle renderers; measured regional terrain queries; deterministic A* traversal and RK4 launch/descent; EVA screening; a single mission replay clock; comparison workers; IndexedDB archives and source-bound JSON/Markdown exports.

The strongest gaps were connections between these systems. Vehicle dimensions did not constrain motor performance, mission telemetry did not alter Earth-test selection, and scene illumination was illustrative. EGIZ retains React/TypeScript, Three.js, MapLibre, Python ingestion and the existing contracts. It adds two scientific adapters and pure typed engineering/transfer modules, rather than replacing the application or adding a distributed service architecture.

## Implemented systems

| System | Concrete implemented behavior |
|---|---|
| Rover Engineering Lab | Mass, cruise speed, battery, slope limit, wheel radius, support dimensions, centre of mass, wheel-shaft torque-speed curve and per-wheel power alter numerical outcomes. Original six-wheel rig renders configured wheel radius, width, track and wheelbase. Inspection includes an exploded chassis/mast/wheel assembly. |
| Mobility model 2.0 | Six equally loaded driven wheels; quasi-static segment force, ideal linear DC wheel-shaft torque-speed envelope, mechanical power cap, dissipative descent braking, conservative static tip screen, gross bus load and battery integration. Worker returns recorded torque, RPM, utilization, stability margin, battery and generation. |
| Route optimization | Existing shortest admissible A* retained; engineering constraints applied to directed grid edges; optional minimum gross electrical energy search uses Dijkstra on the same graph. No solar-aware route objective is claimed. |
| Planetary visualization | Existing measured mesh and interpolation patch retained. Added configuration-dependent mobility overlay, dimensioned rig, bounded illustrative suspension articulation, and SPICE solar direction on the globe and local scene. All motion still follows recorded solver states. |
| Scientific geometry | Real NASA CSPICE_N0067 through SpiceyPy 8.0.0, official DE440s/LSK/PCK kernels and recorded SHA-256 manifest. Computes local solar ENU/elevation/azimuth, inverse-square solar flux, geometric Earth elevation/range and vacuum light time. Includes a 24-hour actual-run catalog for all 11 sites and an optional local custom-epoch service. |
| Solar power | Optional horizontal panel aperture × efficiency × assumed transmission × positive SPICE zenith component × irradiance enters the rover battery integration. Gross consumption and generated energy remain separate. Batteries saturate at capacity; excess generation is discarded. |
| Mission Control | NASA Open MCT 4.3.1 really executes in an optional same-origin frame. Its object and telemetry providers consume actual EGIZ states. The main replay clock controls the data horizon; no second simulation/wall clock supplies telemetry. Official assets, fonts, workers, licenses and notices are packaged locally and lazy loaded. |
| Design experiments | Nine actual runs varying wheel radius and wheel-shaft torque, plus existing mode-specific sensitivity/comparison tools. Each design can be replayed and archived. |
| Mission-aware transfer | Same rover/endpoints executed on the planetary target and eight eligible Earth windows under physical Earth and explicitly substituted target parameters: **17 real solver runs**. Four transparent objectives cover regional slope exposure, physical Earth torque, bus demand and near-limit test terrain. |
| Campaign optimization | Enumerates all nonempty subsets up to a 1–3 site budget; maximizes weighted per-objective best-site coverage with deterministic ties and fewer redundant sites. Compared with terrain-only ranking, top individual sites and greedy marginal coverage. Exact only over the observed pilot pool. |
| Experimental design | Ranks explicit measurement tasks using modeled load/stability stress and missing evidence. Provides source-linked site explanations, outcomes, mismatches, field checklists and a full reproducible run archive. This is a transparent heuristic, not Bayesian expected information gain. |
| Reproduction | Embedded measured terrain still checked against the loaded source bundle. Browser imports authenticate SPICE records against the packaged execution or rerun the optional service; CLI reproduction reruns CSPICE when present. Legacy model-1 inputs without new engineering/solar fields remain importable and are recalculated. |

## Engineering equations and fidelity

For along-track segment grade α, six driven wheels, mass m, gravity g, rolling coefficient c, wheel radius r, wheel-shaft stall torque τ₀ and no-load wheel speed n₀:

```text
F = mg(c cos α + sin α)
Fstall = 6 τ₀ / r
v₀ = 2πr n₀ / 60
v = max(0, min(vcommand, v₀(1 − |F|/Fstall), 6 Pwheel / |F|))
τwheel = |F| r / 6
Pbus = max(0,F) v / η + Pidle
θtip = atan(min(track, wheelbase)/(2 hCG))
Psolar = flux × max(0, SunENU.up) × aperture × efficiency × transmission
dEbattery/dt = (Psolar − Pbus) / 3600
```

The sign of grade controls ascent/descent loads. Braking is dissipative with no regeneration or brake thermal model. No acceleration transients, slip, soil sinkage, obstacle clearance, wheel load transfer, suspension forces or dynamic rollover are predicted. Suspension travel and wheel width are **visual-only**. Solar aperture is an assumed horizontal electrical area, not an area extracted from CAD. The 200 m measured DEM has no wheel-scale scientific support. Decorative materials/rocks remain separate from observations and collisions. Flight remains the previously verified local point-mass RK4 model; it is not an orbital solver.

SPICE uses geometric `NONE` vectors. Earth observer offsets use zero-height WGS84 geodetic positions, but IAU_EARTH text-PCK orientation is not precision ITRF. Mars uses the documented spherical regional coordinates with IAU_MARS; DE440s supplies the Mars-system barycenter as a center approximation. The Moon uses **MOON_ME_DE421**, matching the LOLA source, through official `moon_080317.tf` frame definitions and `moon_pa_de421_1900-2050.bpc` lunar orientation. Three kernels support Earth/Mars; five support Moon. No terrain occultation, refraction, site weather, thermal conversion or radio link budget is included. ENU → globe/local rendering transformations have cardinal-direction regression tests.

## Original transfer algorithm and measured benchmark

`web/src/mission/transfer.ts` implements EGIZ's original mission-aware utility and campaign search. It uses P10/P50/P90 of recorded moving states. Slope relevance compares the target with target-physics Earth controls; load/power compare physical Earth records with the target. Each matching term is `exp(−mean absolute quantile mismatch / declared tolerance)`. The boundary term is the valid regional cell fraction in 80–120% of the effective slope limit, capped at 10% prevalence. Objective weights are **0.30/0.30/0.25/0.15**. Every equation and tolerance is exposed in the UI and export.

No moving route yields zero route/load/power credit. Boundary terrain can still be useful when the configured traverse is blocked, and its distinct role is disclosed. Quantiles are sample-weighted rather than time-weighted. No coverage score is a mission-success probability, external validation, field access recommendation or claim of environmental equivalence.

Actual reference benchmark: 900 kg rover, default endpoints, Jezero regional DEM. **4,463.258646 m**, **5,579.073308 s**, **344.659063 Wh gross consumption**; destination reached under the configured screens. This is a calculation, not a measured rover result.

| Two-site selection method | Coverage utility | Sites |
|---|---:|---|
| Exact mission-aware search | 0.7021016026 | Iceland + Wadi Rum |
| Greedy marginal coverage | 0.7021016026 | Iceland + Wadi Rum |
| Top individual relevance | 0.6564428066 | Iceland + Boszhira |
| Terrain-only baseline | 0.2775245498 | S P Crater + Rio Tinto |

Search evaluates 36 subsets over eight eligible windows. Iceland supports route/load comparison; Wadi Rum supplies near-limit terrain while its traverse is explicitly blocked. A 1° mission slope limit changes the target to blocked and selects an Atacama boundary test; low torque changes recommendations too. Increasing mass to 1,600 kg increases reference gross consumption to **516.298795 Wh**. Five benchmark mission variants execute **85 runs**. One local CPU pass took roughly 60–145 ms per 17-run batch, including copies/search/analysis and excluding worker transfer, rendering and acquisition; this is not a general performance guarantee.

## Flagship workflow

Open `/#/lab?data=pilot&target=MARS_JEZERO`.

1. Explore the globe and measured Jezero terrain.
2. Open **Rover engineering**. Change mass, wheel/motor design and route objective; use **Inspect in 3D** and the exploded assembly control.
3. Optionally select **Use recorded SPICE geometry**. To calculate another UTC epoch, run `make science-serve`, then use **Execute NASA SPICE**.
4. **Calculate this design**. Replay the actual regional route; inspect bus load, torque, battery, events, constraints and scientific overlays.
5. Open **Mission Control** for the official NASA Open MCT telemetry application. Seeking the main timeline filters its actual records to the same simulation time.
6. Run the **9-design trade study**, compare outcomes, replay alternatives, and save/export runs.
7. Open **Earth validation → Build mission-aware campaign**. Inspect all eight measured windows and matched controls, adjust the site budget and compare the four selection methods.
8. Inspect site evidence, replay the physical Earth/control run, and export the field validation plan and full archive. Collect the requested field measurements independently, then revise assumptions and rerun.

Transfer runs exclude solar charging consistently, explicitly isolating terrain, gravity and drivetrain effects. The original Campaign, matrix, evidence, Moon/Earth exploration, launch/descent/EVA and legacy archive workflows remain available.

## Runtime and reproduction

Node **24.14.1+** is required by the pinned Open MCT distribution. The ordinary built app still needs only a browser/local static server. Optional live science uses Python 3.11+; execution here used Python 3.13 on macOS arm64.

```sh
npm --prefix web ci
npm --prefix web run dev

# Optional native geometry; the browser already includes genuine recorded output:
.venv/bin/python -m pip install -e '.[science]'
make science-fetch       # official NAIF kernels, verified against tracked SHA-256
make science-build       # execute all 11 sites, package recorded output
make science-serve       # loopback-only HTTP service; Vite proxies /api/science

make check
make science-check
node tools/benchmark_transfer.mjs
node tools/reproduce_transfer.mjs artifacts/transfer-reference.json
node tools/reproduce_mission.mjs artifacts/rover-reference.json
node tools/benchmark_mission.mjs
make offline
```

The custom-epoch API is a local development integration. A static deployed build has recorded SPICE and full Open MCT but no Python API. No native backend deployment was implemented. Kernel binaries are ignored; only their pinned manifest and genuine compact results are versioned. `fetch` never silently accepts changed downloads. The original MIT code license does not relicense NASA/third-party software or measured datasets. See [scientific engine research and licenses](engineering/SCIENTIFIC_ENGINES.md).

Open MCT's stock Vue plot performs runtime template compilation, incompatible with the existing strict offline CSP. Normal mode retains that official plot. The strict offline package automatically selects an original CSP-safe SVG view registered through Open MCT's view API and consuming its telemetry request API. The official distribution and the strict policy remain unchanged. This distinction is visible in the plot label; stock tools requiring runtime templates are not claimed to work under strict CSP. Clock messages are batched at 10 Hz without advancing simulation time, and unchanged paused times trigger no requery.

## Remaining priorities

**Partially implemented:** regional rover engineering, terrain/planet visualization, mission-aware experimental design, deterministic trade studies and habitat/EVA screening. These are working but limited-fidelity systems.

**Future:** measured wheel-scale Jezero DTMs and tiled multiresolution streaming; validated Chrono contact/multibody/regolith dynamics; terrain-shadow illumination; validated propulsion/attitude/orbital adapters; dynamic suspension and thermal/power models; field-measured parameter calibration and uncertainty propagation; travel/cost/permission campaign constraints; Bayesian active design; Monte Carlo with justified uncertainty distributions; an optional tool-grounded AI Mission Architect and native deployment. No GMAT, Basilisk, Chrono, ROS, Gazebo or RocketPy execution is claimed.

NASA Space Apps eligibility remains unresolved for the pre-existing October implementation. The current official guide still says project work must begin at the November 14, 09:00 local start. This independent work does not establish organizer permission. See [current rules recheck](competition/RULES_RECHECK_2026_10_20.md). Existing dates, disclosure and authorization records were preserved.
