# Egiz

**[Feature guide: what EGIZ includes and how to use it](docs/USER_GUIDE.md)**

Design an Earth test campaign for a Moon base region or a Mars landing site. Egiz compares terrain and environmental attributes, scores mission objectives, and selects up to three complementary sites. Its gap ledger explains which conditions need laboratory testing. An exact priority frontier reveals when a different site becomes preferable, and measured terrain dossiers export field verification checklists.

**Current state: a local prototype with an exploratory measured terrain pilot and an optional synthetic software demo; competition readiness is not established.** Fixtures are invented software inputs, not NASA observations. Real raster ingestion and Earth Engine adapters are separate. See [implementation status](docs/engineering/IMPLEMENTATION_STATUS.md) for prior verification and remaining dependencies.

## Run locally

Requires Python 3.11+ and Node.js 24.14.1+ (the pinned optional Open MCT distribution requires this Node version; tested with Python 3.13 and Node 24.14.1).

The exact tested Python 3.13 environment is recorded in `requirements-lock.txt`. Use `.venv/bin/python -m pip install -r requirements-lock.txt` to reproduce that environment; the general `requirements.txt` lets older supported Python versions select compatible packages.

```bash
make setup
make dev
```

Open the address printed by Vite. New visitors open the measured Mons Mouton pilot; an explicit source link or saved source preference takes precedence. Change the site budget, choose objectives or Mars, inspect a site, and open Evidence. A persistent banner identifies the selected data and its limitations.

The default **Measured terrain pilot** lets you inspect the actual NASA PGDA/USGS target measurements and nine Copernicus Earth windows. This mode is exploratory and unvalidated; ESA WorldCover 2021 land cover is included; climate, seasonal snow availability and target temperatures are missing. It has its own sources, results and missing-data explanations. Synthetic terrain images are unavailable in this mode. Source selection is explicit in shared URLs (`data=demo` or `data=pilot`) and can be changed at any time. A complete future `data/processed` bundle appears as a separate **Observed dataset** option.

```bash
make check       # Python, contracts, input hashes, TypeScript, UI tests and build
make data        # Reproduce complete real inputs if present, otherwise use demo fixtures
make fixtures    # Explicitly rebuild synthetic files in data/fixtures only
make offline     # Package artifacts/egiz-offline.zip with a local launcher
make serve       # Serve web/dist at http://127.0.0.1:4173
```

The browser application needs no backend, database, API key, or generative AI service. Offline packages include data, fonts, and code. Satellite imagery requires internet; the local map/table remains available. Serve the app over localhost rather than opening `index.html` directly.

## Campaign & Measured Pilot

The measured pilot includes **nine real Earth windows and two planetary targets**. In Campaign, explore **When does the best site change?** to inspect exact two-objective priority switches and apply them to the optimizer. Open a site for measured Earth–planet surfaces, shared-axis profiles, slope distributions and source hashes. Export the actual analysis or a Markdown field verification plan. Regional metrics use matching 200 m sampling across bodies. Independent WorldCover land-cover data excludes the original water-dominated Kazakhstan window from all campaigns.

See [audit](docs/EGIZ_AUDIT.md), [method](docs/SCIENTIFIC_METHODOLOGY.md), [validation](docs/SCIENTIFIC_VALIDATION.md), [development record](docs/IMPLEMENTATION_PROGRESS.md), and [competition status / measured demo](docs/COMPETITION_READINESS.md). This is an exploratory pilot; missing environment, geological validation and global sampling remain open.

## Mission Lab

Open **Mission Lab** from Campaign or use `/#/lab?data=pilot&target=MARS_JEZERO`. EGIZ reconstructs the cached measured terrain into an interactive 3D scene and computes deterministic rover, launch, descent and regional EVA scenarios. Configuration, telemetry, events, replay, saved experiments, JSON reproduction, Markdown reports and five-run Earth/planet/counterfactual comparisons are implemented. The original ranking and evidence tools remain intact.

The flagship comparison holds mission inputs fixed while running actual Earth terrain under Earth parameters and explicitly substituted planetary parameters. It includes regional geometry statistics and result-backed explanations. This is a simplified local research/education prototype: **200 m terrain, reference atmospheres, point-mass flight, regional kinematic traversal; no spacecraft or field certification.**

Read the [implemented model, equations, workflow, sources and next steps](docs/MISSION_LAB.md), [execution audit](docs/ASCENSION_EXECUTION.md) and [verification record](docs/ASCENSION_VALIDATION.md). Rebuild terrain with `.venv/bin/python -m pipeline.common.mission_terrain`; reproduce 24 benchmark scenarios with `node tools/benchmark_mission.mjs` (Node 22.18+).

## Observatory 3D Rendering

Mission Lab opens at vehicle scale with original articulated rover, rocket, lander and EVA assemblies, PBR materials, body-specific lighting, recorded-state interpolation, cinematic and scientific cameras, event-based replay, explicit failure experiments and synchronized Earth/planet 3D comparison. The measured 200 m terrain and scientific solver remain intact; surface detail and mechanical animation are visibly illustrative. See [implemented scope, browser evidence and remaining work](docs/VISUAL_REVOLUTION.md).

## Engineering & Mission Control

Mission Explorer connects a configurable six-wheel drivetrain and dimensioned 3D assembly to recorded motor/power/stability telemetry, a real **NASA CSPICE / SpiceyPy** geometry adapter, **NASA Open MCT** Mission Control, nine-design trade studies, and a mission-aware Earth validation campaign. The latter executes 17 matched measured-terrain runs, optimizes complementary experimental coverage, benchmarks simpler baselines, and exports a reproducible field plan. Genuine SPICE records for all 11 sites and the Open MCT runtime are packaged for browser-only use; custom SPICE epochs use an optional loopback Python service.

Open `/#/lab?data=pilot&target=MARS_JEZERO` and use **Rover engineering → Calculate → Mission Control → Earth validation**. Read the [implemented systems, equations, flagship workflow, numerical results and remaining priorities](docs/ENGINEERING_EVOLUTION.md), [engine sources/licenses](docs/engineering/SCIENTIFIC_ENGINES.md), and [verification record](docs/ENGINEERING_VERIFICATION.md). The regional model does not resolve wheel contact, soil, dynamic suspension or orbital mechanics.

## Real data

See [the data guide](docs/engineering/REAL_DATA_GUIDE.md). Global processing requires an authenticated Google Earth Engine project and verified planetary DEM inputs. Nothing automatically reads or prints credentials. Never put keys in the repository.

The four engine inputs are `earth_candidates.json`, `targets.json`, `mission_templates.json`, and `sun_windows.json`. `make data` uses complete validated inputs in `data/processed/` and records their SHA-256 hashes. It refuses incomplete real-data inputs. Scientific validation stays `not_run` until experiments actually run. Synthetic data cannot be written into `data/processed/`.

## Method

- Terrain uses central differences at matching metric baselines: 100 m for lunar comparisons, 400 m for Mars, and 2 km regionally.
- Objective fidelity uses a weighted geometric mean, an explicit missing-weight limit, and suitability constraints.
- Campaign coverage averages each objective's best site. The engine enumerates a shortlist and checks greedy selection across the full pool. This does not establish a global optimum over the full pool.
- Similar test conditions do not establish field suitability, access, safety, or planetary equivalence.

Read the [mathematics](docs/science/MATHEMATICAL_SPECIFICATION.md), [contracts](docs/engineering/API_AND_SCHEMA_CONTRACTS.md), and [validation protocol](docs/science/VALIDATION_PROTOCOL.md).

## Native engineering expansion

[EGIZ 4 implementation and model limits](docs/EGIZ_4_ENGINEERING.md) · [exact verification](docs/EGIZ_4_VERIFICATION.md). MuJoCo contact dynamics, Basilisk orbit propagation, a measured 10 m lunar mesh atlas and robust mission-conditioned Earth testing extend the existing browser workflows. Optional runtime: `pip install -e '.[science,dynamics,dev]'`, then `make science-serve` and `npm --prefix web run dev`. Browser-only recorded references remain available.

## Operating decisions and observations

The **Tests** workspace searches feasible operating modes under fixed hardware, task and requirements, using actual regional rover records. It connects Pareto trade-offs, finite decision maps, requirement events in the mission chronograph, synchronized A/B evidence and the existing Earth campaign. A versioned SI observation import fits two electrical parameters with a separate held-out series; its included control is explicitly synthetic and does not establish physical validation. The workspace uses a restrained graphite/brass observatory treatment.

[Implemented scope, exact demo and scientific limits](docs/EGIZ_NEXT_ENGINEERING.md) · [verification and browser evidence](docs/EGIZ_NEXT_VERIFICATION.md).

```sh
node tools/benchmark_operating.mjs
node tools/reproduce_operating.mjs artifacts/next-MOON_MONS_MOUTON.json
```

## License & Disclosure

Egiz is independent and is not endorsed by NASA or ESA. Code is [MIT licensed](LICENSE). See [AI disclosure](submission/ai_use.md) and [references](submission/references.md).