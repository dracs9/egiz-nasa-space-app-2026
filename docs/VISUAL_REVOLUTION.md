# EGIZ observatory rendering update · 18 October 2026

Implemented locally at the user's explicit direction, with AI assistance (Codex). This is a significant upgrade to the existing Mission Lab, not a new scientific model or a claim of validated spacecraft dynamics. No external models, photographs, commercial assets, new dependencies or public deployment were used. All source datasets, ranking calculations, the simulation integrator and experiment archive contracts are preserved.

## Implemented

- Original, reusable Three.js vehicle assemblies: six-wheel rover with tread ribs, steering pivots, terrain-following suspension struts, science mast, stereo lenses, antenna, solar cells, heat-rejection fins and stowed instrument arm; single-stage rocket with shaped fairing, tank boundaries, raceways, engine bell and feed lines; four-legged lander with instrument deck, arrays, four nozzles and kinematic foot/strut contact; suited EVA operator and a fixed illustrative habitat at the origin vicinity.
- PBR finishes, procedural foil normals and ground microtexture, metal reflections, illustrative directional sunlight, vehicle shadows and instanced scenery rocks. Rigid parts are merged by material while mechanical pivots remain separate.
- Mars, Moon and Earth treatments. Atmospheric tint diminishes with recorded altitude using the configured reference scale height. Zero-density environments have no atmospheric fog. Lunar disturbances are emitted only with motion/thrust and use short illustrative ballistic arcs; there is no wind or ambient airborne dust.
- Default vehicle inspection, follow, regional, overhead, rover-mounted, surface inspection and user-interruptible cinematic cameras. Ground controls use focused WASD/arrows in 5 m increments. Camera transitions are damped; reduced-motion preference disables automatic camera orbit and transitions. Narrow-screen framing is aspect aware.
- Shared recorded-state interpolation for scene transforms, HUD and telemetry charts. Positions and continuous readouts interpolate between snapshots; phase, thrust and acceleration retain the preceding discrete sample. Stored snapshots and exported numerical outputs are never modified.
- Wheel rotation derives from recorded distance. Terrain orientation and wheel/foot placement derive from the measured interpolated surface. Steering and suspension are visual kinematics, not contact dynamics. Original instantaneous segment speeds remain unchanged.
- Throttle-sensitive exhaust and near-surface disturbance. An ignition countdown derives from the actual recorded ignition event. Exhaust stops at contact because the integration has terminated; the terminal telemetry retains the solver's contact snapshot, including thrust immediately before contact. No post-contact dynamics or structural deformation are invented.
- Mission control, cinematic and scientific presentation modes; optional trajectory and force/velocity annotations; fullscreen; measured elevation and regional slope layers; adjustable illustrative sun and rendering quality.
- Clickable replay events and outcome annotations that distinguish completed criteria, failure and an incomplete/model-limited record. Quick experiments load explicit inputs for regional traversal, tight slopes, low energy, delayed ignition, insufficient thrust, guided descent and unpowered/late-ignition descent. Their outcomes are computed by the existing worker.
- Optional side-by-side comparison of any two computed analog or sensitivity runs. A single elapsed-time clock drives both; a completed/blocked run holds its final frame while the other continues. Independent terrain and environmental assumptions remain visible.
- Lazy Mission Lab loading, instanced rocks, merged rigid geometry, capped/adaptive pixel ratio, idle render suppression, frame-cadence/draw-call/triangle instrumentation and explicit geometry/material/texture/environment/shadow/renderer cleanup. Comparison scenes mount only when opened.

## Terrain and interpretation boundaries

The existing 200 m grids remain the only elevation observations. The 180 m close-range patch uses the same bilinear surface as the scientific queries throughout its central 110 m, then blends into the existing regional mesh triangles along its outer strip to avoid a rendering seam. It adds tessellation, not measured detail. Missing or out-of-bounds samples produce no faces. Display layer colors refer to the measured regional elevations or slopes.

Microtexture, rocks, materials, lighting, mechanical articulation, vehicle dimensions and disturbance particles are illustrative, visibly labeled and excluded from the scientific model. Fixed world-space scenery rocks are excluded from the planned corridor to avoid depicting unmodeled collisions. The scene is not a photographic reconstruction or a wheel-scale DTM. The target ring is a visual annotation, not a certified landing footprint. Surface-contact success still means only that the solver's configured speed and regional slope thresholds passed.

Reference atmospheric tint is an artistic transfer function, not radiative transfer, observed weather or a simulated global planetary horizon. The regional view shows the measured data footprint. There is no orbit-to-global-planet transition, orbital mechanics, damage simulation, manual rover dynamics, regenerative braking, engine transients or measured microterrain.

## Verification record

`make check` passed: repository task validation; Ruff; **122 Python tests**; both dataset bundles' schema/hash/reference checks; secret-pattern scan; TypeScript; **108 UI/unit tests across 25 files**; production build and packaged worker checks. Final frontend build/test output is retained under `artifacts/visual-revolution/`.

New tests cover interpolation without changing stored snapshots, exact discrete ignition/throttle boundaries, deterministic backward seeking, hard-contact classification and propulsion termination, slope orientation, valid batched geometry in all four vehicle modes, real failure presets, replay event jumps, comparison mounting/unmounting, local-to-regional surface continuity and nodata preservation.

Actual browser inspection used the local application, including:

- Mars rover rendering, active traversal, pause and restart; body tilt, tread rotation and visible surface contact.
- Rocket delayed ignition: replay to zero gives zero thrust and the on-pad state; ignition/exhaust and ascent follow recorded events.
- Guided Mars descent: computed contact **0.80 m/s** at **52.7 s**, reported as soft landing. Unpowered descent: **100.18 m/s** at **17.7 s**, reported as hard landing, with no successful landing animation substituted.
- Moon selection, airless appearance, rover-mounted camera, fullscreen and true-scale inspection.
- Earth/Mars comparison with the same displayed time and distinct speed/energy values. Three canvases while comparison is open, one after closing.
- Mobile viewport at **390 × 844**, responsive controls and no horizontal page overflow; desktop viewport restored afterward.
- About **60 active frames/s** observed in this machine's browser during rover and launch playback, including a rover observation of **94 draw calls / 244k triangles at DPR 1.5**, and launch **23 calls / 84k triangles**. These are sampled developer-browser observations, not a GPU timing study, sustained thermal benchmark or promise for other hardware. Shadow/detail/viewport changes alter the counts.

Screenshots are retained locally in `artifacts/visual-revolution/`. Earlier browser geometry merge warnings were corrected by normalizing rigid geometry to non-indexed attributes. The removed soft-shadow constant was replaced with the installed Three.js version's supported shadow map. Mobile framing, initial onboard clipping, terrain patch seams and explicit shadow-target disposal were also corrected during inspection.

## Next worthwhile work

1. A provenance-preserving high-resolution terrain tier before wheel-scale obstacles, landing hazards or geological interpretation.
2. A validated rover contact/traction/suspension solver and vehicle attitude dynamics, with matching measured vehicle parameters, before claiming physical articulation.
3. Art-reviewed vehicle assets and calibrated PBR materials; further spacecraft surface detailing and atmospheric rendering.
4. Global-body rendering and an orbit-to-measured-region transition with clear scale/provenance boundaries.
5. Persistent browser regression automation, GPU timing, context-loss testing and physical-device profiling. The current browser verification is recorded manual automation, not a checked-in headless E2E harness.
