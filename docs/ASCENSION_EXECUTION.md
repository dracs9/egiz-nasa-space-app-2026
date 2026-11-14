# EGIZ Ascension · independent development · 18 October 2026

This work is explicitly authorized local product development. It is pre-event work, not a claim of hackathon eligibility. Existing uncommitted work and scientific scoring are preserved. Codex assists implementation and verification; human scientific review is pending.

## Baseline verified

- Git HEAD c81bacb; substantial pre-existing uncommitted implementation, left intact.
- 120 Python tests and 63 Vitest tests pass on 18 October.
- Nine measured terrestrial windows, two targets, ESA cover, source fingerprints, priority switching, paired terrain evidence and field plans exist.
- Same Sun is an explicitly synthetic render sequence; no measured interactive 3D viewer or physics simulation existed.
- Cached Copernicus, LOLA Site20v2 and MOLA–HRSC rasters permit offline reconstruction. Ranking and evidence will remain separate from simulation.

## Execution strategy

1. Generate a separately versioned, georeferenced 200 m terrain product from existing rasters, with input/source SHA-256, native/local CRS, nodata and resolution disclosure.
2. Implement pure, deterministic simulation functions: RK4 point-mass launch/descent; terrain-constrained routing/traversal; reproducible scenario/results and storage.
3. Integrate a lazy-loaded Mission Lab and Three.js terrain viewer. Add configuration, inspection, camera controls, synchronous telemetry, playback, outcomes and export.
4. Connect campaign targets and candidates; make native, physical Earth and controlled parameter-substitution experiments explicit. Add controlled batches and numerical parameter sensitivity.
5. Test analytical cases, constraints, provenance, UI behavior, existing regression suite, build, offline packaging and actual desktop/mobile browser journeys. Record results and remaining limits in ASCENSION_VALIDATION.md.

## Scope and scientific boundary

Regional 200 m terrain cannot resolve wheels, boulders, landing pads or habitats. Rover routes are regional kinematic screening, and flight is a local, constant-gravity point mass with a prescribed thrust direction and idealized atmosphere. Neither certifies field suitability or spacecraft performance. No paid service, external deployment or remote Git mutation is required.
