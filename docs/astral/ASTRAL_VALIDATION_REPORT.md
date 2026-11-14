# EGIZ ASTRAL — validation report

Run on 2026-11-13: Windows 11, Python 3.14.5, Node 24.16.0. The steps of `make check` were run individually because the Makefile assumes a POSIX virtualenv path.

## Results

| Step | Result |
|---|---|
| `tools/tasks.py validate` | pass |
| `ruff check pipeline tests tools/…` | pass |
| `pytest -q` | 143 passed, 17 skipped (MuJoCo/Basilisk not installed), **1 failed** (below) |
| `tools/check_bundle.py`, `tools/check_secrets.py` | pass |
| `tsc --noEmit` | pass |
| `vitest run` | 42 files, 208 tests passed (180 existing + 28 new) |
| `npm run build` including `check-build.mjs` | pass |

### The failing Python test

`tests/test_spice.py::test_catalog_reexecutes_to_same_numbers_and_covers_all_measured_sites` asserts exact floating-point equality between a fresh CSPICE run and the packaged catalogue. It is skipped when kernels are absent, which was the state at the start of this session. After `python -m pipeline.science.spice fetch` it runs and fails on this machine: vectors differ by at most 1.5 × 10⁻¹¹. Neither the test nor `pipeline/science/spice.py` was modified. A tolerance is the likely fix and is left to the maintainers.

## New tests

`web/tests/astral.test.ts` (28): coordinate maths and round trip; height decoding; manifest validation and tamper rejection; seam and apron continuity on real tiles; coarse level equals the box mean of measured posts; LOD selection covers the site exactly once; progressive draw set without overlap; shadow-mask limits; slope, profile, area, line of sight and shadow on analytic surfaces; shading-fit azimuth and detection of an 8 m misregistration; crater, rock and class detection on analytic inputs; k-means determinism; the Bekker worked case; slip solution; drive response to slope, load, gravity and surface; route admissibility and objective trade-offs on the real site; mission energy balance, determinism and replay; effect of battery, rover, surface, fidelity and obstacles; rejection of invalid specifications; targets and hypotheses on the real site; copilot parsing of the documented requests, schema rejection, confirmation and logging; registry honesty; tile-cache concurrency, cancellation and eviction.

`tests/test_world.py` (9): byte-range TIFF reading equals GDAL for TIFF and BigTIFF; refusal of compressed sources; pyramid scale, seams, parent/child agreement and fingerprints on an analytic plane; no-data stays no-data; box-mean and quantisation guards; imagery block averages; packaged Jezero tiles match the manifest; illumination record structure and agreement with the existing catalogue.

## Browser verification (dev server, built-in browser pane)

Observed working: world load with progress; tile streaming from L0 to L4; inspector with coordinates, measured values, interpretation and illumination; one-sentence mission planning with science stops; route alternatives; simulation with follow camera, telemetry, events, battery/slip timeline and elevation profile; playback; shadow-segmented rock detection with keep-outs and traversability overlay; stress test with detailed-fidelity, weak-soil and rock re-plan re-runs; what-if with the baseline pinned; refusal of an unresolvable place name.

**Not exercised in the browser:** final layout of the Compare and Evidence panels, the dossier download, the Scout rover model, the onboard camera, the profile tool, the remaining overlays (classes, units, outliers, similarity, shadow duration), the narrow-viewport layout, keyboard-only use, and Russian localisation (studio strings are English only).

## Scientific validation

No interpretation or simulation output was compared with independent ground truth. See `ASTRAL_LIMITATIONS.md`.
