# Equipment studio and contextual guide

Implemented 2026-10-20. Existing mission inputs, engine protocols, terrain datasets, numerical records and route navigation remain unchanged.

## Actual NASA asset

The studio loads the **original NASA/JPL Mars 2020 Perseverance GLB** from `web/public/models/perseverance.glb`, obtained from the official [NASA resource page](https://science.nasa.gov/3d-resources/mars-2020-perseverance-rover/). It contains 68 glTF meshes, 88 nodes, 44 embedded images; Three.js exposes 252 material primitives for direct picking. Original bytes and SHA-256 are recorded in `web/public/models/credits.json`.

The NASA 3D Resources repository describes its assets as free and without copyright. The [NASA media guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/) permit factual informational visualizations with source acknowledgment and no implied endorsement. Attribution is available inside the studio and the asset manifest. NASA identifiers remain part of the reference object, not EGIZ branding.

Draco's Apache-2.0 JavaScript decoder is packaged from the installed Three.js distribution with its license. It runs in a local worker. Neither remote runtime requests nor weakened WebAssembly CSP are necessary. The studio code is lazy-loaded, and the 4,987,176-byte model is requested only when opened.

## Shared engineering model

The second studio tab uses the **same configured EGIZ rig** as terrain replay and sidebar preview. Its open aluminium wheel barrels, hoops, ten-spoke webs, chevron grousers, drive hubs, thermal blankets with geometric folds, deck louvers, wiring, stepped optics and stowed instrument arm are original EGIZ geometry. Static mesh batches preserve semantic component identifiers. Dynamic suspension links remain independent; their attached collars remain connected. The existing fewer-than-90-mesh rover regression budget is preserved.

Native MuJoCo replay attaches the detailed wheel shell to each recorded wheel body. Collider shapes and solver records are unchanged. Native chassis, wheel, steering and arm transforms remain authoritative. Regional replay retains its declared distance-driven rotation and terrain-following kinematics. Rendering detail is not additional physical fidelity, calibrated soil interaction, instrument simulation or a flight-certified CAD model.

The NASA reference has rocker-bogie suspension and radioisotope power; it **does not replace** EGIZ's six independent native trailing arms or configured solar/battery model. The distinction appears in the source tabs, component guide and footer.

## Interaction

Open the studio using the equipment icon beside Quick guide, by clicking the vehicle preview, or using the equipment action inside the existing mission guide. Pick a visible mesh, select a semantic assembly, focus, isolate, inspect the full part tree, or separate whole assemblies. These inspection controls do not alter physics or recorded time. A native modal dialog confines focus and Escape closes it; closing returns focus to the invoker. GPU resources and decoder workers are disposed when switching models or closing.

The optional **Guide** control works on all six pages. It explains regions on pointer/focus, has previous/next navigation and a topic index, and highlights the relevant section. Rover design fields additionally have parameter-specific explanations. It changes no mission parameters. It adds no permanent explanation labels over the science workspace.

UI illustrations for rover, launcher, lander and EVA use original compact SVG technical elevations. Controls retain text labels and accessible names. Russian translations cover the new guide and all component explanations.

## Verification

- `npm --prefix web test`: full regression suite, including rendering geometry, configured dimensions, numerical replay, guide behavior and original scientific workflows.
- `npm --prefix web run build`: TypeScript, production bundle and packaged asset checks.
- Browser: original GLB decode/render, 9 semantic assemblies, direct primitive picking, isolate/focus, both model sources, inspection offsets, RU/EN, context guide across pages, native recorded replay.

The studio is an inspection tool. It does not claim NASA CAD tolerances, mass properties or new solver fidelity.

### Verification completed 2026-10-21

- `npm --prefix web test` — **155 passed**, 36 test files. Includes the original finite-geometry/draw-object budget, wheel envelope and semantic picking regressions, numerical simulation/replay suite and the contextual guide focus/navigation checks.
- `npm --prefix web run build` — **exit 0**. TypeScript, emitted workers, authentic native references, 21 terrain tiles, source separation, original NASA GLB fingerprint, embedded textures, Draco license/decoder and lazy studio chunk checks passed.
- Browser inspection confirmed NASA/JPL model decoding, all 9 component groups, direct material-primitive picking, focus and isolation, separated assemblies, configured EGIZ model, RU explanations and field help, guide navigation across workspaces, revised vector plates and actual recorded MuJoCo replay with the new wheel geometry. A Russian explorer header overlap found in this check was corrected.
- Physics engines were not changed; no new native numerical fidelity is claimed by this visual update.

## Connected equipment library — 2026-10-21

This increment extends the existing Perseverance/configured-rig studio. It does not replace the existing SPICE, Open MCT, MuJoCo or Basilisk adapters, analytical vehicle models, regional terrain or Earth-validation algorithms.

Five additional original GLBs were obtained from official NASA 3D Resources pages. Their exact downloads, attribution, sizes and SHA-256 fingerprints are in `web/public/models/credits.json`:

| Reference | Bytes | Source glTF meshes | Embedded images | Application connection |
|---|---:|---:|---:|---|
| Saturn V | 927,212 | 22 | 8 | Default launch inspection |
| Apollo Lunar Module | 716,840 | 134 | 6 | Default descent inspection |
| EMU | 3,448,904 | 1 | 6 | Default EVA inspection |
| LRO | 654,500 | 5 | 0 | Orbital inspection and Basilisk replay marker |
| MRO | 2,652,460 | 6 | 2 | Orbital inspection and Basilisk replay marker |

The selector can inspect all six NASA references from one studio. Component lists, picking, focus, isolation, searchable surface tree and exploded inspection adapt to the chosen reference. Configured launch, descent and EVA assemblies now also have their own relevant guides instead of the rover component list. Explanations are translated into Russian. Source information and geometric-region limitations are kept in contextual disclosures.

`partitionInspection` bakes static source surfaces into inspection groups. It preserves source triangles, UVs, normals, material groups and world-space shape, including mirrored transforms. Approximate geometric bands are used when semantic CAD components are unavailable; source material/node names additionally identify orbiter arrays, dishes and payload surfaces. These are inspection regions, not structural joints or flight CAD boundaries. The studio normalizes the reference's largest extent to its display stage; it does not claim certified dimensions or inertia. Skinned sources are rejected by this static partitioner. Perseverance retains its existing hierarchy and skinned source geometry.

A source-specific display correction is applied to EMU: fully transmissive cloth/hardware materials in that export are made opaque. Its partially transmissive visor, colours and texture maps remain. This is a rendering interpretation, not measured optical properties. The original GLB bytes remain unchanged. NASA animation tracks in the rocket/lander/orbiter files are deliberately not played as mission motion.

### Recorded orbital playback

Basilisk results now render the actual MRO reference for Mars and LRO for Moon/Earth contexts. Earth uses LRO only as a generic shape. The vehicle marker is enlarged to 0.13 reference-body radii for visibility, which is explicitly labelled. Translation follows the same `recordedState` used by charts, events, Open MCT and synchronized comparisons. No attitude or array articulation is propagated; the reference's orientation remains visual. The configured trajectory is not a historical spacecraft ephemeris.

Planet/spacecraft camera controls share the native experiment record. The follow camera transports its offset with the recorded radial frame so a complete orbit does not carry the default camera through the planet. Users can orbit the camera themselves. Fullscreen play/pause and elapsed time delegate to the existing experiment clock; there is no second simulation clock. Leaving fullscreen retains time. The viewport opens the matching model in the studio. Source-load failure keeps an explicitly labelled simple marker; it never substitutes fabricated solver states. Models are loaded only as needed from same-origin files; late loads and GPU resources are disposed on unmount. Service render counters are available as a tooltip instead of permanent text.

### Verification of this increment

- `npm --prefix web test` — **163 passed / 37 files**. Eight additional tests cover material/group/UV/normal and mirrored-surface preservation, normalized attributes, skinned-source rejection, scenario guides, known EMU transparency correction, inertial/display basis, outward camera initialization and full-orbit offset transport. Existing vehicle mesh budget and numerical replay tests pass.
- `npm --prefix web run build` — **exit 0**. TypeScript and production checks pass, including all six original GLB fingerprints/embedded assets, local Draco decoder/license, lazy studio/loader, existing scientific workers, four native references and 21 measured terrain tiles.
- Browser executed two **fresh Basilisk 2.12.0** Moon experiments: 400 km initial altitude, 25° inclination, 1,800 s duration, 2 s recorded interval, impulses 0 and 60 m/s. Both contain **901 states**. At T+1,800 s their altitudes are 400,000.00 m and 519,686.6318389056 m. The same replay time drives both 3D scenes and graph readouts.
- Full archives captured from the UI's JSON review are saved locally as `artifacts/equipment-lunar-orbit.json` (`b6149296f3ab0d7e2e65`) and `artifacts/equipment-lunar-impulse.json` (`c59bb9dce5a26409d380`). The browser download-event helper timed out; download capture is not claimed as newly verified here.
- `node tools/verify_equipment_orbits.mjs` — **exit 0**. Independent circular/elliptical Kepler solutions checked all 901 position states per run: maximum discrepancies **9.338519e-8 m** and **1.065910e-7 m**; relative energy drift **5.684e-15** and **7.067e-15**. This verifies numerical agreement for the declared point-mass model, not observed mission accuracy.
- Browser inspection: all six sources decode/render, orbiter component focus/isolation, contextual studio entry, native MRO/LRO display, fresh Moon executions, common-time comparison, fullscreen sizing and play/pause/time continuity, Russian component guide. The observed fullscreen fixed-height bug was corrected before final delivery. No new console errors were observed; the known Three.js JavaScript Draco configuration deprecation remains (pinned Three r186).

Remaining work includes rigging the historical references for compatible multibody models, calibrated surface/material properties, actual attitude propagation and high-resolution orbital imagery. These reference assets do not add staging, spacesuit physiology, Apollo landing dynamics or calibrated regolith physics.

The studio renders directly with Three.js/WebGL on demand. Camera position, target and orientation are published together, and resizing redraws the view. Dragging rotates the actual scene and picking intersects actual source meshes. Both cold and idle views were inspected. JPEG screenshots require `image/jpeg` when previewed; an incorrect MIME type in the verification tool initially produced a misleading blank preview. Render and scene state were correct. No alternate bitmap presentation backend is shipped.
