# EGIZ 4 verification — 20 October 2026

Host: macOS ARM64, Python 3.13, Node 24.14.1. Actual installed engines: MuJoCo 3.16.0, Basilisk (`bsk`) 2.12.0, existing SpiceyPy 8.0.0. Optional dependencies execute on the host; their binaries are not bundled in the static website.

## Baseline and regression

- `make check` before modifications: **125 Python / 136 web tests passed**, type check/build/source checks passed (`artifacts/egiz4-baseline.log`).
- `make check` after the native expansion: **151 Python tests / 145 web tests in 33 files passed**, Ruff, input/bundle validation, secret scan, TypeScript and production build passed (`artifacts/egiz4-check.log`).
- `.venv/bin/python -m pip check`: no broken requirements.
- `make dynamics-check`: real optional native invariants and process-lifecycle tests, plus native browser protocol/Open MCT and robust optimizer tests. See `artifacts/egiz4-native-check.log`.

No skipped native tests are counted as executed integrations on this host. CI includes a new optional-engine installation job; remote GitHub execution has not been observed here.

## Native physical/numerical evidence

- `python -m pipeline.dynamics build`: executes two 30 s MuJoCo rover suspension cases and two 7,200 s Basilisk orbit cases. Packaged JSON contains actual body/joint/contact or Cartesian orbital states and provenance. This is not a dependency-only integration.
- Static contact: stationary 900 kg rover, summed wheel normal loads after 12 s agree with `mg` within relative `1e-5` on Earth (8,825.985 N), Moon (1,458 N), and Mars (3,339 N). Recorded body quaternions remain normalized. Vehicle mass sums to 900 kg.
- Rolling reference: native flat Mars terminal speed 0.649741124 m/s for a 0.65 m/s command; maximum absolute wheel slip below 0.005. A regression test prevents resolving hub velocity in a spinning wheel frame.
- Repeated native execution reproduces states exactly on this host. Halving the flat-test timestep from 2 ms to 1 ms keeps final position within 0.02 m and energy within 0.01 Wh. This is a controlled convergence check, not contact/soil calibration.
- Basilisk circular orbits on Earth/Moon/Mars agree with independent analytic positions within 0.02 m after 7,200 s; radius variation <0.01 m; energy and angular momentum relative drift <`1e-8`.
- Mars 400 km circular reference: period 7,101.274334837 s, speed 3,358.857031371 m/s, energy relative drift `1.45288e-14`, momentum relative drift `7.18012e-15`.
- Initial +120 m/s Mars impulse: recorded maximum altitude 995,498.279 m, within 1 m of independent vis-viva apoapsis. This is an initial-state impulse, not a finite thruster integration.
- `python -m pipeline.dynamics verify --archive artifacts/native-reference-0.json` and `...native-reference-2.json`: native re-execution compares all numerical states/joints/forces, metrics, geometry and events (tolerance `1e-8 + 1e-11 |value|`). Engine/model/input fingerprints must match.
- `node tools/compare_rover_fidelity.mjs`: actual FAST vs RESEARCH flat reference. FAST uses prescribed steady motion and zero rolling resistance; native has a 1 s settling phase, actuator transients and contact/joint dissipation. FAST 7.8 m / 0.4 Wh versus native 6.717094 m / 0.478178 Wh in 12 s. These differences are documented model differences, not a claim that either reproduces a real rover.
- Two additional nominal mass-property cases verify whole-vehicle CG height, including the declared 0.12 m initial settling clearance. Native process tests genuinely start a subprocess, receive its engine result, and kill a running job via cancellation. Input validation rejects invalid/unknown/nonfinite controls before process launch.

## Original algorithm benchmark

```sh
node tools/benchmark_transfer.mjs
node tools/benchmark_robust.mjs
node tools/reproduce_robust.mjs artifacts/robust-transfer.json
```

The five-case benchmark executes **85 actual measured-terrain mission records**. Exact search considers 36 bounded subsets of eight Earth windows at a two-site budget. Maximin selection: Iceland + Wadi Rum; worst utility **0.6709120520**, mean **0.6895652585**, terrain-only selection worst utility **0.2773389082**. Nominal selection has the same worst utility and maximum case-specific regret is zero in this case. **The robust method does not outperform the nominal method on this reference case.** It quantifies finite assumption sensitivity rather than inventing a probability. Strongest individual parameter response: rolling resistance +30%, about 2.905 utility points. One host execution of the complete benchmark took approximately 1.1 s, including serialization; this is not a cross-device performance guarantee.

`reproduce_robust.mjs` reruns all archived missions and re-evaluates exact selections, coverage and maximin decisions. It verifies actual state values, not only summary scores.

## Measured terrain

`make terrain-build`: actual all-valid reprojection from the fingerprinted 5 m LOLA raster. 21 tiles, 1,906,055 tile bytes, 40/20/10 m shared posts. Tests verify every tile SHA-256 and exact shared fine-tile seam elevations. The source's 5 m posting does not imply centimetre precision. No synthetic geometry replaces missing measurements.

## Browser verification and limits

Browser inspection covers actual native-job execution from the app, dimensioned body assemblies, component inspection, synchronized suspension comparison, recorded engineering events, Open MCT native channels, atlas refinement and actual field-campaign/robustness controls. Screenshots are saved in `artifacts/egiz4-*.jpg`. Renderer readouts are local observations, not a guaranteed frame rate. The final synchronized native views reached approximately 60 fps with 201 draw calls and 197,330 triangles per native viewport (DPR capped at 1.5); initial shader compilation and simultaneous viewports can be slower.

The in-app browser's automated download-event capture timed out for a Blob export; that does not establish a file-download result. A reviewable JSON export and native CLI reproduction provide an inspectable fallback. No unobserved browser download is counted as verified.

See [implementation and scientific limits](EGIZ_4_ENGINEERING.md). This remains pre-event independent development; the official team guide and license/attribution terms were read in the browser on 20 October. Eligibility approval is unresolved. No organizer messages were sent.

## Final production and failure verification

The built app was served directly by `make science-serve` on loopback 8766, and both native job types executed from that production origin. No Vite proxy is required for this runtime. The strict offline launcher at port 4173 loaded native references and Open MCT: 601 authentic rover samples (including per-wheel forces) and 3,601 orbital samples, including negative specific energy.

The final Jezero design browser archive (`artifacts/egiz4-native-browser.json`, 601 states) was captured through the visible reviewable JSON control and re-executed with zero numerical difference. A separate high-CG, narrow-track lunar steering/release stress case on the synthetic 9.17° slab crossed the declared 78.46° tilt termination criterion at **5.80 s**, reaching **80.2369°**. It was imported through the actual file chooser, re-executed by MuJoCo in the app, and reproduced with zero numerical difference. This is a designed rigid-contact failure experiment, not a calibrated lunar rollover prediction. Initial course poses are tested for absence of penetration; tilted-course initialization includes a recorded surface lift. Rigid chassis crossmembers visibly attach each suspension pivot; their inertia remains in the declared chassis lump.

The offline ZIP was regenerated after the final build. Browser mobile viewport override did not alter this in-app browser's actual dimensions; responsive CSS is implemented, but a live mobile layout result is not claimed. Browser download-event automation timed out; reviewable JSON extraction and the native file-chooser import/reproduction were successfully verified.
