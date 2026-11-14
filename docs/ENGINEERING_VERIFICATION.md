# Engineering verification · 20 October 2026

> Subsequent expansion: [EGIZ 4 native dynamics, measured mesh streaming and robust validation](EGIZ_4_ENGINEERING.md). MuJoCo and Basilisk now execute; this document retains the preceding cycle’s baseline and decisions.


This record covers actual local execution, not external scientific or field validation. Host: macOS arm64, Python 3.13, Node v24.14.1, Codex in-app browser. Original working-tree changes were retained. No remote deployment or competition submission occurred.

## Exact commands and results

| Executed command | Result |
|---|---|
| `make check` before editing | PASS: 122 Python tests; 122 web tests; task validation, Ruff, source/schema/hash checks, secret-pattern scan, TypeScript and production build. |
| `.venv/bin/python -m pip install 'spiceypy==8.0.0'` | Installed and imported the official PyPI arm64 CPython 3.13 wheel; actual `CSPICE_N0067` execution. |
| `npm --prefix web install --save-exact openmct@4.3.1` | Installed the official NASA npm distribution; Node engine requirement met. |
| `.venv/bin/python -m pipeline.science.spice manifest` | Recorded SHA-256 fingerprints of the actual unmodified official downloads. Five kernels: LSK, text PCK, DE440s SPK, lunar FK and binary lunar orientation PCK. |
| `.venv/bin/python -m pipeline.science.spice fetch` | PASS: cached official kernels verified against the tracked manifest. Clean installations download those exact URLs. |
| `make science-build` | PASS: native CSPICE computed all 11 measured origins for 24 hours at 600 s samples, including final endpoint: 145 samples/site, 1,595 actual geometry states. Moon uses MOON_ME_DE421; Earth/Mars use their documented IAU frames. |
| `make check` after implementation | PASS: **125 Python tests; 136 web tests across 30 files**; task validation, Ruff, source/schema/hash checks, secret scan, TypeScript and production build. Log: `artifacts/engineering-final-check.log`. |
| `make science-check` | PASS: three native SPICE tests and ten engineering/transfer/Open MCT adapter tests. Includes independent solar zenith projection and reexecution of Earth/Moon/Mars catalog records. Log: `artifacts/engineering-science-check.log`. |
| `npm --prefix web run typecheck` | PASS on final source. |
| `npm --prefix web test -- --run` | PASS: 136 tests on final source, including custom UTC-input and asynchronous-edit regression tests, scientific model tests and original UI regressions. |
| `npm --prefix web run build` | PASS. Production checks confirm source modes, real terrain, workers, Open MCT runtime/adapter/fonts/licenses, and the 11-site CSPICE catalog. No build warnings after asset-loader repair. |
| `node tools/benchmark_transfer.mjs` | PASS: five mission variants × 17 actual runs = **85 runs**. Artifact: `artifacts/transfer-benchmark.json`. |
| `node tools/reproduce_transfer.mjs artifacts/transfer-reference.json` | PASS: 17 runs independently recomputed; same selected sites, coverage utility 0.7021016025872794 and 36 evaluated subsets. |
| `node tools/reproduce_mission.mjs artifacts/rover-reference.json` | PASS: 1,132 states; zero maximum numeric difference; destination reached. |
| `node tools/reproduce_mission.mjs artifacts/rover-browser-spice.json` | PASS: complete 1.35 MB archive read from the actual browser export. Native CSPICE reexecuted the archived geometry. All 1,132 simulator states reproduced; maximum numeric difference **8.881784197001252e−16**, below absolute 1e−9 + relative 1e−12 tolerance. |
| `node tools/benchmark_mission.mjs` | PASS: original 24 rover/launch/descent/EVA scenarios and flight timestep comparison executed under the current model. Artifact: `artifacts/mission-benchmark.json`. |
| `.venv/bin/python tools/make_offline.py` | PASS after the final build. Produces `artifacts/egiz-offline/` and approximately 15 MB `artifacts/egiz-offline.zip`. |
| `.venv/bin/python artifacts/egiz-offline/serve.py --no-network --no-browser --port 4173` | Actually served the production package with the existing restrictive CSP for browser verification. |

`requirements-lock.txt` remains the pre-existing general environment record. The optional science dependency is pinned in the `science` extra in `pyproject.toml`; the Open MCT version is pinned in `web/package-lock.json`. The new CI science job downloads the fingerprinted official kernels and executes native tests, instead of silently treating skipped tests as integration verification. Without the optional dependency/kernels, native tests explicitly skip; the browser's real recorded catalog remains available.

## Browser checks performed

- Audited the original Mars globe, measured terrain and existing Mission Explorer before implementation.
- Ran the new Jezero rover with the recorded genuine SPICE catalog. Verified changing elapsed time updates torque, RPM, gross electrical consumption, solar generation and battery state.
- Used **Execute NASA SPICE** through the actual Vite proxy/local service, including a custom **2026-11-14 14:00 UTC** epoch. The UI returned solar elevation **25.87°**, flux **526.1 W/m²**, Earth elevation **−4.66°** and one-way light time **658.4 s**. These are actual model outputs under the documented frame assumptions.
- Verified the final lunar HTTP workflow returns **MOON_ME_DE421**, five kernel fingerprints, and a 1.1630222000° initial solar elevation for 14 November 00:00 UTC. This executes the source-matching lunar FK/binary-PCK chain through EGIZ's actual proxy/service.
- Found and fixed a datetime-control event issue that submitted the initial epoch after a visible edit. The control now consumes the current field, responds to input events, and rejects a response with a different UTC epoch. Added a regression test and verified the corrected request/response in the browser.
- Added a regression for engineering edits made during a pending geometry request: the completed request preserves the latest rover configuration. Site changes and unmounted/superseded requests discard stale results.
- Verified NASA Open MCT's official stock plot consumes the actual EGIZ run in normal mode. It exposed the real channel tree and recorded-state plot while the main clock advanced.
- Verified the production offline bundle runs measured terrain, SPICE records, mission workers and the CSP-safe Open MCT view with the original strict policy. Selected **Battery remaining** through the actual Open MCT UI: **2,656.058 Wh**, 1,132 recorded samples, **T+5,579.1 s**. The separate gross consumption is 344.659 Wh; approximately 0.717 Wh of actual calculated solar generation changes battery depletion in the recorded midnight-epoch case.
- Found that NASA's stock Vue plot wrapper requires runtime template compilation under strict CSP. Implemented an explicitly EGIZ-authored SVG view registered in Open MCT and requesting data through its telemetry API. Kept the stock plot for normal mode and preserved the existing offline policy. Upstream optional runtime-template tools are not claimed to work in strict mode.
- Executed the mission-aware campaign in the browser: eight eligible measured windows, 17 target/Earth/control runs, two-site exact search over 36 subsets, and explicit blocked-route evidence for the selected Wadi Rum boundary test. The water-dominated source window remained excluded.
- Verified the rover constraint terrain overlay and its disclosed conservative uphill-screen interpretation.
- Verified the exploded assembly slider moves actual chassis/mast/wheel component groups and camera framing follows the inspection envelope. The scene explicitly labels this visual-only inspection; starting playback reassembles the rover.
- Captured original app screenshots at `artifacts/rover-exploded-assembly.jpg` and `artifacts/mission-control-offline.jpg`.

The browser's large DOM-value return was truncated on the first attempt to collect the archive. That intermediate file was not used as proof: the complete readonly export was then read in bounded chunks, its character count checked (1,352,291), and the resulting file passed independent reproduction. No telemetry was edited to make reproduction pass.

## Numerical and performance findings

Analytical tests verify flat-ground force, wheel torque/RPM, electrical power and energy; motor/power response; mass response; static tip constraints; exact battery/time clipping; real-SPICE optional charging; and interpolation of recorded states. Transfer tests compare exact selection with an independent exhaustive two-site loop, validate baseline dominance on the declared objective, reject mismatched inputs, and verify mission restrictions change recommendations. Open MCT provider tests check every channel's source values/units and prohibit future samples after a backward seek.

The default Jezero result is **4,463.258646 m**, **5,579.073308 s**, **344.659063 Wh** gross bus consumption. A 1,600 kg configuration uses **516.298795 Wh**. Low torque and a 1° slope limit stop the target route. These are internal model calculations, not externally validated predictions.

One local pass of 17-run transfer cases took about **60–145 ms**, including copying, routing and analysis but excluding worker transfer, graphics and acquisition. A representative active 3D browser sample reported **60 fps**, **112 draw calls**, **279k triangles**, **DPR 1.5**, approximately **0.45 ms CPU command submission** and **5.50 ms GPU time**. A later assembly sample reported 110 calls and 254k triangles. These are observed samples on this host and viewport, not cross-device guarantees. Open MCT loads on demand; clock delivery is batched at 10 Hz and unchanged paused times cause no query.

The original descent timestep experiment remains controller-step sensitive. At dt 0.2/0.1/0.05/0.025 s, touchdown speeds were 0.799720/0.799866/0.799948/0.799990 m/s. Touchdown times were 52.55465/52.71474/52.79319/52.78183 s. This supports a numerical regression record, not fourth-order convergence of the sampled controller or a validated lander.

## Limits of this verification

No field testing, DEM error propagation, measured soil contact, full suspension dynamics, dynamic rollover, Monte Carlo uncertainty validation, spacecraft attitude/orbit integration, global terrain streaming or AI Mission Architect was completed. NASA SPICE and Open MCT execution does not validate EGIZ's engineering assumptions. Exact campaign optimization is over the eight supplied eligible pilot windows and declared utility, not all Earth locations, access/logistics or mission-success probability. Read [implemented scope and remaining priorities](ENGINEERING_EVOLUTION.md) and [engine sources/licenses](engineering/SCIENTIFIC_ENGINES.md).
