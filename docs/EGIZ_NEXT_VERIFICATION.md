# EGIZ verification · 22 October 2026

Executed locally on macOS ARM64, Node 24.14.1, Python 3.13. These are software/numerical checks, not physical validation. User-created `docs/reports/` contents were left intact.

| Check | Observed result |
|---|---|
| Fresh baseline Python | 151 passed |
| Fresh baseline web | 169 passed, 38 files |
| Fresh baseline production build | Passed |
| `make check` after implementation | **152 Python / 180 web tests passed**, 41 web files; task validation, Ruff, bundle/source/hash/secret checks, TypeScript and build passed |
| Final web suite after clock/search refinements | 180 passed |
| Final production build | Passed; additionally verifies the emitted operating-study worker |
| `.venv/bin/python -m pip check` | No broken requirements |
| Two new engineering sessions | JSON Schema validation passed |
| `node tools/reproduce_operating.mjs artifacts/next-MOON_MONS_MOUTON.json` | 29 records, all states/events/routes/metrics, gates, Pareto labels and map decisions reproduce; max difference 0 |
| Same reproduction for Mars | 29 records; max difference 0 |
| Existing `rover-reference.json` | 1,132 states; max difference 0 |
| Historical `mission-browser-export.json`, original model 1.0.0 | 219 states; ground impact reproduced; max difference 8.881784197001252e-16 |
| Existing `robust-transfer.json` | 85 mission records and 36 exact subsets reproduced; worst utility 0.6709120520057982; max state difference 0 |
| Offline packaging | Existing offline launcher/package regenerated from final production assets |
| `git diff --check` | Passed |

The full Python suite executes the installed optional native dynamics/SPICE tests on this host; no skipped integrations are counted as executed. Existing native modules and reference fingerprints were retained. New meaningful tests cover measured-terrain feasibility, impossible requirements, fixed hardware/task preservation, actual stress runs, threshold localization, missing reserve telemetry, separate holdout fitting, units/gaps/provenance/excitation rejection, calibration scope/reproduction, candidate window determinism, worker cancellation/stale replies/loading errors and acceptance at a selected recorded time.

## Production browser observations

- Measured lunar scene, requirement example, ten actual search results, six feasible options and energy/time priorities were exercised at `http://127.0.0.1:4173`.
- Saved a complete 29-record study in IndexedDB, reloaded the production page and recomputed it from the saved study control. The pre-existing single-run archive count remained 1 after the database 1→2 upgrade. Existing records were not evicted.
- Complete ~25 MB engineering session imported through the real file chooser. The app reexecuted its baseline, alternatives and 18 stress records. The resulting recommendation retained 276.84 Wh / 4,170.79 s. Import does not trust uploaded telemetry or winning labels.
- Choosing baseline energy violation set the chronograph, scene state and cursor to T+10,157.933 s. The 400 Wh threshold is an interpolation of actual recorded samples; local location E≈59 m / N≈259 m.
- A/B opened full baseline and selected records, synchronized scene clocks, energy traces and event selectors. Different route geometry disables direct deltas. At T+0 both records showed pending criteria; at the A energy event, A still showed pending arrival and failed time while completed B showed passing final criteria.
- Existing Earth/control campaign executed 17 solver records. Iceland + Wadi Rum were selected for this particular lunar operating mode; displayed campaign utility ~55.0/100 is experimental coverage, not mission probability. Site inspection displayed concrete measurements/limits and three candidate DSM windows with source fingerprints.
- Synthetic measurement JSON imported through the actual chooser with one fit and one held-out series. η=76%, idle=65 W, synthetic holdout RMSE displayed 0.000 W, prior held-out RMSE 36.417 W. The UI explicitly reports unconfirmed physical validation.
- Applied the model only to a physical Earth/Iceland record, recalculated **205.43 Wh / 3,721.68 s**, then saved the full record in IndexedDB. The archive count changed to 1 and the save confirmation was observed. Synthetic calibration stayed visible.
- Opening the recommendation with Enter was exercised through the actual focused button.
- RU was used for the main workflow; EN remains available and the original localization tests passed. Source names/IDs, scientific records and exported model strings preserve their original identifiers/language.
- A real 390 px iframe exercised narrow responsive CSS, search and opening the recommended record. Document client width and scroll width were both 375 px (390 px iframe minus scrollbar), with no horizontal document overflow. This is a layout/interaction check on a desktop browser, not mobile hardware verification. The in-app viewport override itself was ignored (actual outer page stayed 1280×720).
- Rendering observation during recorded rover playback: **60 fps active, 172 calls, ~321k triangles, DPR 1.5, CPU submission 0.54 ms, GPU 4.30 ms**. No universal FPS claim. Existing hidden/idle render guards remain; no postprocessing was added. Physical weak-GPU and mobile performance and OS reduced-motion emulation were not measured.

The initial complete JSON textarea review caused browser automation timeouts. The final manifest review was exercised successfully (37,626 characters / 11 nominal records before adding the stress map). The final UI reviews a bounded manifest that omits telemetry/terrain arrays, raw calibration rows and SPICE samples. The full JSON export still includes these records. Browser native Blob-download capture was not established; CLI-produced complete sessions, JSON file-chooser imports and record reproduction were verified. A test screenshot is not treated as evidence of a file reaching a Downloads directory.

## Evidence files

- `artifacts/next-baseline.jpg` — original UI before changes.
- `artifacts/next-desktop.jpg` — recorded lunar state and operating recommendation.
- `artifacts/next-chronograph.jpg` — baseline requirement violation.
- `artifacts/next-mobile.jpg` — actual narrow iframe recommendation.
- `artifacts/next-baseline-{python,web,build}.log`, `next-complete-check.log`, `next-production.log` — executed checks.
- `artifacts/next-{MOON_MONS_MOUTON,MARS_JEZERO}.json` — complete numerical sessions.
- `artifacts/next-operating-benchmark.json` — calculated results and measured compute cost.
- `artifacts/next-legacy-reproduction.log`, `next-robust-reproduction.log` — retained-archive reproduction.
- `artifacts/egiz-offline.zip` — regenerated existing offline package.

The temporary iframe harness was removed from source and final distribution. Full implementation, exact demonstration and limits: [EGIZ_NEXT_ENGINEERING.md](EGIZ_NEXT_ENGINEERING.md).
