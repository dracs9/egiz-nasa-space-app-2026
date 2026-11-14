# EGIZ Planetary Mission Explorer — design and rendering direction

Reference inspected: `references/mission-explorer.png`, supplied by the user.

## What makes the reference work

The globe occupies roughly two thirds of the working width and nearly all of its height. The side rails are instruments, not cards competing for attention. A narrow top bar establishes the mission; a bottom transport unifies time, events and viewpoint. Fine, low-contrast rules create structure without enclosing every element. The planet supplies almost all the color and depth. Amber is reserved for selection, timing and mission events.

Typography works in three registers: tracked uppercase instrument labels, quiet sans-serif descriptions, and tabular monospaced telemetry. Tight, consistent baselines and generous space around the scene make a dense interface feel calm. Overlays attach information to a location or event rather than decorating the scene.

The terminator, restrained limb light and large-scale composition sell planetary size. Thin trajectories sit in three-dimensional space; they are not generic rings. A local vehicle is never implied to be physically scaled against an entire world. Movement should explain a change of focus, time or coordinate system, with manual control taking precedence.

## EGIZ implementation

Retain Three.js, the measured terrain bundle, deterministic worker, archived experiments and scientific comparison workflow. Make the Mission Explorer the default entry point. Use charcoal panels and sparse amber selection. Put target, reference environment and configuration in the left rail; recorded mode-specific telemetry and event history in the right rail. Anchor playback and real event selection across the full workstation width.

Add a planet-fixed orbital context using equirectangular imagery, a directional day/night shader, view-dependent atmospheric limb scattering for Earth/Mars and no atmosphere on the Moon. Latitude/longitude map directly to a spherical coordinate function shared with site markers and camera targeting. Sun direction is art-directed and disclosed; orbital context is not an ephemeris or orbital propagation result. Graticules are geographic reference lines, not invented spacecraft trajectories.

Transition from planet to measured regional terrain with an explicit representation handoff. Do not imply that a global texture contains local elevation or that a 200 m DEM resolves wheel hazards. Reuse the local, metre-scale simulation and its continuous replay interpolation. Add camera bookmarks and event selection without changing the numerical record.

The original vehicle rigs already include nozzles, foil, wheels, suspension, masts, panels and dynamic pivots. Improve their detail/materials and use the actual meshes to generate the technical schematic. Their design remains an EGIZ engineering demonstrator, not a certified flight article or a specific NASA rover. Blender is not installed on this host; existing procedural modelling and mesh batching are retained.

## Verification

Record actual browser inspection, interactions, performance and automated results in `MISSION_EXPLORER_VALIDATION.md`. Do not infer visual quality, FPS, GPU time, memory or correctness from source code alone. The globe imagery is visual context; only the separately attributed terrain samples drive numerical analysis.

## First-time experience — 2026-10-19

The cinematic workstation needed an explanation of its purpose and a visible starting point. A compact first-visit introduction names the available worlds and missions in one sentence. Visitors can start a five-step guide or dismiss the introduction; that choice is remembered locally. The persistent Quick guide button is available on desktop and mobile.

The guide moves the actual camera through world, terrain and vehicle views, then calls the existing simulation worker. Replay and results unlock only when a recorded run exists. Back navigation reuses a valid run; editing the mission invalidates its guided results. The final guide step sits with the analysis, where the engine's outcome and explanation appear once, with a route into Earth analog comparison. It does not invent an achievement or automatically run an experiment on page load.

Live readings now use clearer names, have expandable unit/meaning explanations, and distinguish simulated readings from spacecraft telemetry. The empty results state points to running a mission; duplicate setup and playback instructions have been removed. Terrain resolution, approximate energy estimates and model limitations remain explicit. Keyboard focus follows guide headings, playback has a direct scroll/focus action, and the guide is optional throughout.
