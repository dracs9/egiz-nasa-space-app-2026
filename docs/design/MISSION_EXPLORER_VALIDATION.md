# Mission Explorer verification — 19 October 2026

## Implemented scope

The flagship Mission Explorer is the default entry point for an empty application route. The existing worker, measured terrain, numerical engine, experiment archive, comparison and analysis remain the foundation. Rover, launch, descent and EVA modes share the new workstation and retain their own configuration and telemetry. Other campaign pages retain their existing workflows.

- Dominant planetary/local viewport, compact instrument rails, restrained amber accents and a full-width playback strip.
- Earth, Mars and Moon imagery, custom illumination/terminator shaders, Earth clouds and ocean highlights, atmospheric limb treatment for Earth/Mars, and airless lunar presentation.
- Geographic markers tested against Three.js sphere UV coordinates. Explicit planet-fixed → local east/north handoff to the measured terrain representation.
- Original articulated engineering models with additional thermal blankets, foil normal/roughness maps, seams, fasteners, cable looms, optics and equipment details. The schematic is rendered from the same meshes.
- Regional, vehicle, follow, overhead, onboard, surface and cinematic camera rigs. Cinematic orbit phase now derives from simulation time, making replay framing repeatable.
- Playback, pause, restart, speed, scrubbing, next-event navigation, event selection, six camera/story bookmarks, actual rendered view captures and a guided path into real analog comparisons.
- On-demand rendering, progressive 2K → 4K globe textures, bounded pixel ratio, adaptive local quality, rigid-mesh batching and explicit disposal of geometry/material/texture/query resources.

## Automated checks

| Check | Observed result |
| --- | --- |
| `npm --prefix web test` | **116 tests passed**, 27 files |
| `.venv/bin/python -m pytest -q` | **122 tests passed** |
| `npm --prefix web run build` | Type checking, production bundling and worker/dataset packaging checks passed |
| `node tools/benchmark_mission.mjs` | 24 deterministic scenarios; slowest execution 8.301 ms in this run |
| `node tools/reproduce_mission.mjs artifacts/mission-reproduction.json` | 529 frames reproduced, **maximum numeric difference 0**, no discrepancies |

Logs are retained under [`verification/`](verification/). The numerical reproduction is evidence of deterministic consistency, not independent validation of physical accuracy. The numerical solver was not modified for the redesign.

Regression coverage includes returning from an Earth analog to the already selected Mars target, restoring appropriate flight replay speed from the archive, exact scrubber endpoint selection despite browser decimal serialization, equirectangular marker alignment, and reproducible cinematic phase. Existing tests cover recorded forces, touchdown, terrain contact, event timing, failed runs, comparison clocks and finite batched vehicle geometry.

## Browser verification

Inspected the actual Three.js application in the Codex in-app browser, including the production build served by Vite preview. No production-origin console errors or warnings appeared during the inspected workflow. Earlier development hot-reload errors are historical and were resolved before the production check.

| Interaction | Observed evidence |
| --- | --- |
| Planet selection | Earth, Moon and Mars render with distinct materials and atmosphere treatment; the Earth marker is located in Arizona, with source coordinates displayed |
| Orbit → region | Target focus followed by an explicitly labeled coordinate/representation handoff; local measured grid and inspection tools become available |
| Rover replay | 1,167 recorded states; paused at T+1,116 s showing 838.2 m, 0.8 m/s and 69.2 Wh; completed route 4,463.3 m, 393.2 Wh, 5,783.3 s |
| Lunar launch | At T+2.67 s: 55.5 m altitude, 41.8 m/s, 15.8 m/s², 576.7 kg propellant, 0 Pa dynamic pressure and 24,000 N thrust; depletion and model-limit events exposed |
| Mars descent | Ignition at 8.1 s; contact at 52.71474235011313 s; 0.7998662274613648 m/s touchdown; terminal display rounds to 0.80 m/s, with 487.8 kg propellant |
| Scrubbing and events | Event picker reaches ignition/contact, including events sharing a timestamp; keyboard End reaches the exact terminal state; replay button and event stream agree |
| Archive | Saved a calculated descent, reloaded the production page, restored embedded configuration/terrain and replayed at the corrected 5× flight rate |
| Cameras/bookmarks | Planet, region, vehicle, tracking, scientific and outcome views selected; camera settles on the correct subject; captured thumbnails populate from actual scene renders |
| Guided experience | Followed planet → regional grid → configured rover → real calculation → scientific view → computed outcome → Earth analog comparison |
| Analog results | Five real runs: Jezero and both Iceland cases complete; both Wadi Rum cases are blocked. Iceland uses 770.3 Wh with Earth assumptions and 376.6 Wh with Mars assumptions |
| Responsive | Desktop 1440×960; phone 390×844; tablet 768×1024. Phone document width 375 px and tablet width 753 px, both within the viewport after accounting for scrollbar |

Observed weaknesses were corrected during inspection: inherited grid placement, hidden phone controls, tablet header stacking, clipped world selectors, overly smooth lander surfaces, a misplaced lander body, leg offsets during free descent, stale archived-flight speed, and a scrubber maximum that could stop a few floating-point units before contact. Regional inspection no longer has a large contact banner covering its terrain.

## Measured rendering performance

Host GPU: **Apple M4, 8 GPU cores**. Browser viewport 1440×960, DPR 1, adaptive rendering. These are samples from this host, not cross-device guarantees.

| Scene | Active cadence | CPU render submission | GPU render query | Draw calls | Triangles | Live geometry / texture resources |
| --- | --- | --- | --- | --- | --- | --- |
| Mars descent replay | 60 fps | 0.57 ms | 2.04 ms | 113–116 | ~207k | 67 / 8 |
| Mars rover replay | 60 fps | 0.62 ms | 3.26 ms | 112 | ~279k | 60 / 8 |
| Mars globe | Renders on demand | Not independently recorded here | Not instrumented | 23 | ~43k | 1 surface texture |

Local GPU timing uses asynchronous `EXT_disjoint_timer_query_webgl2` queries, sampled every sixteen available renders. Disjoint results are discarded; unsupported contexts say “timer unavailable.” CPU submission excludes the rest of the application frame. The 60 fps cadence corresponds to approximately 16.7 ms per presented frame; CPU and GPU columns are not end-to-end frame latency.

Published planet assets total approximately **11 MiB**. A displayed 4K surface map is approximately **43 MiB uncompressed RGBA including mipmaps**, an explicitly labeled allocation estimate. The 8K source files remain outside the published bundle. GPU utilization percentage, total process/VRAM usage, a long-duration memory soak, remote-network cold-load timing and low-end-device profiling were not measured.

## Scientific and visual boundaries

- Globe imagery is a licensed, color-adjusted visualization mosaic, not local elevation. [Attribution and derivative details](../../web/public/textures/ATTRIBUTION.md) are shipped with the application.
- Sun direction, materials, rocks, dust and model mechanics are illustrative. Sun direction is not an ephemeris. Geographic grid lines do not imply orbital trajectories. The globe does not claim date-accurate rotation.
- Planet and regional terrain use separate representations. The transition is deliberately disclosed; this is not continuous planetary terrain LOD.
- Vehicles are original EGIZ engineering demonstrators in scene metres, with preserved articulation. Their geometry is not a certified NASA vehicle design or a validated mass/inertia model. Close views were visually inspected; the resemblance to real flight hardware remains illustrative.
- Blender was unavailable. The [official NASA Curiosity static GLB](https://science.nasa.gov/resource/curiosity-3d-model/) was inspected: one mesh node, nine materials, no animations or separate wheel/suspension nodes. It was not substituted for the articulated rig.
- Regional 200 m grids do not resolve wheel-scale hazards. Contact uses the terrain model; decorative rocks do not create invented collision measurements. The recorded terminal flight state is retained, and post-contact dynamics are not claimed.
- The current engine remains a regional screening/educational model. Flight validity limits and uncertainty statements remain visible. Cinematic rendering does not establish orbital capability, geological equivalence or mission readiness.

## Screenshots

Actual browser captures, not concept images:

- [Mars overview](screenshots/explorer-mars.jpg)
- [Earth overview](screenshots/explorer-earth.jpg)
- [Landing contact](screenshots/explorer-landing.jpg)
- [Articulated rover](screenshots/explorer-rover.jpg)
- [Phone layout](screenshots/explorer-mobile.jpg)
- [Tablet layout](screenshots/explorer-tablet.jpg)

Run locally with `npm --prefix web run dev`. For production inspection, build first and use `npm --prefix web run preview`.

## First-time guidance verification — 2026-10-19

- Added six behavior tests covering first-visit dismissal and reopening, a complete guide using the real solver, valid replay reuse, invalidation after mission changes, disabled invalid runs, worker failure recovery, world selection, and unavailable browser preference storage. **122 frontend tests across 27 files pass.** [Test output](verification/onboarding-tests.txt).
- Production TypeScript check, Vite build and worker/dataset packaging checks pass. [Build output](verification/onboarding-build.txt). No numerical engine, dataset or 3D rendering code changed in this iteration; previous Python and performance results above are not new measurements.
- Browser-completed the five-step Mars rover guide: 1,167 recorded states, 5,783.3 simulated seconds, destination reached. The results step opened the computed analysis and selected the exact recorded end time. Back navigation reused the run. Finished the guide and reloaded: the first-visit introduction stayed dismissed, while Quick guide remained available.
- On a 390 × 844 viewport, switched the guide to descent, ran the real 529-state, 52.7-second mission, used Playback controls, and pressed Home on the timeline. Playback paused at zero with 1,200 m height, 35 m/s speed and 600 kg propellant. Expanded the reading definitions and verified the flight-specific explanations.
- Inspected the built application on mobile. Fixed a pre-existing selector that hid the guide button. At 320 × 812, removed the inherited document minimum-width overflow: document client width and scroll width both measured 305 px with the browser's 15 px scrollbar.
- At 768 × 1024, inspected the guide and planet layout; client/scroll widths both measured 753 px. On a fresh local origin at 390 × 844, inspected the first-visit welcome, verified both choices were visible, and dismissed it with Explore freely; client/scroll widths both measured 375 px.
- Keyboard focus moves to each new guide heading; the timeline shortcut focuses the range control. Early result/replay steps are unavailable before calculation; guide closure and storage denial leave the workstation usable.
- New browser captures: [first-visit introduction](screenshots/explorer-welcome.jpg), [mobile introduction](screenshots/explorer-welcome-mobile.jpg), [desktop guide](screenshots/explorer-guide.jpg), [mobile guide](screenshots/explorer-guide-mobile.jpg). These are actual application views, not mockups.

### Copy reduction

At the user’s request, shortened the welcome to one sentence, reduced guide steps to one instruction each, removed repeated setup/telemetry/timeline helper paragraphs and the redundant completion toast, and kept scientific explanations in their existing analysis or expandable reading definitions. The final guide no longer duplicates the outcome explanation. Re-ran all 122 frontend tests and the production build successfully after this revision.
