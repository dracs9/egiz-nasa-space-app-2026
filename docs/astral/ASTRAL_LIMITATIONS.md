# EGIZ ASTRAL — limitations and incomplete work

## Scope delivered

One real site (Jezero, 2 km × 2 km around the Perseverance landing coordinate) end to end. Not a global engine, not Earth, not the Moon.

## Not done

- **ATLAS-Π integration.** Its modules are not in this branch; the studio links to the existing analog workspace instead.
- **Moon and Earth worlds.** The builder is generic, but only the Jezero configuration exists and was run. The lunar palette and regolith profile are untested with data.
- **Geological map, spectral data, thermal inertia.** Not acquired; no geological unit names appear anywhere.
- **Supervised ML, foundation models, vector search, change detection, learned surrogates, remote LLM.** Not implemented; registered as such.
- **Cesium / WebGPU benchmark.** The engine decision rests on analysis, not measurement.
- **Dynamics.** No MuJoCo coupling to the new world; quasi-static terramechanics only; no validation against test-bed or flight data.
- **Arm, drill and sampling mechanics.** A science stop is a declared duration and load.
- **Side-by-side scenario viewports.** Comparison is a table plus an overlaid baseline route.
- **Workers.** Analysis and detection run on the main thread.
- **Localisation and guide.** Studio strings are English; no interface-guide topics.
- **Accessibility.** Labels, focus rings and reduced-motion handling exist; no audit was run and the 3D canvas has no keyboard camera control.
- **Narrow screens.** A stacked layout is defined in CSS but was not checked visually.
- **Persistence.** Missions are not saved between sessions; the dossier is the export.

## Scientific cautions

- Slope, roughness and routing use 2 m area-averaged posts of a 1 m stereo DTM whose effective resolution is several posts. The DTM has no per-pixel error and none is propagated.
- The 97 crater candidates and the rock detections include false positives; neither detector has been scored against ground truth.
- The image Sun elevation from shading is biased; rock heights are not derived from it.
- Terrain shadow considers only terrain inside the 2 km site. The crater rim and delta cast no shadow in this model.
- Soil parameters are analog profiles, so slip, sinkage and energy are scenario outputs, not predictions for Jezero.
- Rover parameters marked approximate or assumed (idle load, efficiency) dominate the energy result.
- The illumination record covers 72 h from 2026-11-14; other dates need a new record.
- The two dataset DOIs were verified online. Soil constants, rover figures and the other literature citations were written from knowledge of the standard sources without re-reading them in this session; verify before reuse.
