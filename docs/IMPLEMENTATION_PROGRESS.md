# Independent development record · 17–18 October 2026

The user explicitly authorized immediate independent development, accepting possible competition restrictions. This session continued existing implementation from 15 October. All dates are actual; no work is relabeled as hackathon work. Existing contributor changes were preserved; no competition task was marked complete merely because local code exists. No commit, push, publication, external message, paid resource or submission was performed.

## Delivered

- Audited the existing Python → JSON → React/Zustand/MapLibre pipeline and prior tests before changing it. Baseline: **111 Python / 52 UI tests**, contracts, hashes, type check, Ruff and build passed.
- Acquired **six additional authentic Copernicus DEM windows**, bringing the measured pilot to nine Earth windows and two existing planetary targets. Kept all climate/thermal unknowns null. Raw raster hashes and sources are recorded; large inputs remain ignored.
- Implemented an **exact two-objective preference frontier**, including analytic switch intervals, alternative rankings, missing-evidence handling, geography filtering, scenario application to the same optimizer and source-bound JSON export. O(n log n) construction was benchmarked on up to 3,000 explicitly synthetic software lines.
- Implemented **measured terrain dossiers**: equal-baseline Earth–planet surfaces, shared-axis profiles, slope distributions, nodata, exact source URLs and fingerprints. Evidence is loaded separately, checked against result input hashes and recoverable through Retry.
- Added **Markdown field verification plans**, grounded in the selected site/target observations, missing measurements and recorded model inputs. They make no access, safety, geology or mission-engineering guarantees.
- Fixed a **scientific sampling mismatch**: regional target metrics now use the same 200 m pixels as Earth, while fine target metrics retain their appropriate baseline. Rebuilt actual targets, results and evidence.
- During adversarial browser review, identified the original Kazakhstan coastal window's flat DSM as requiring independent land-cover checking. Acquired **ESA WorldCover 2021 v200 for every pilot window**, retaining categorical classes and metric footprints. It classifies **95.8658%** of that window as permanent water; the existing ≤50% water rule now excludes it from all objectives/campaigns. Its coordinates and record remain visible. Tests prevent regression.
- Made the genuine measured pilot the default for new visitors. Explicit source URLs and saved source preferences take precedence; fixture mode remains visibly separate.
- Executed a seeded **200-trial sensitivity study plus 50 masking trials** using actual pilot inputs. Recomputed it after land-cover acquisition rather than retaining stale terrain-only results.
- Added current audit, innovation comparison, implemented methodology, validation, development and competition/demo records. Rechecked the actual current official FAQ, team guide and challenge summary in a browser. Preserved earlier planning/audit documents as history.

## Final verification

`make check` runs the project task validator, Ruff, Python tests, six-file contracts/hashes/coverage checks, secret-pattern scan, TypeScript, Vitest, production build and bundled worker/dataset checks. Final results are captured locally in `artifacts/verification-final.log`.

The completed final state has **120 Python tests and 63 UI tests**. New checks include numerical terrain/profile/histogram invariants, actual pilot histogram agreement, regional pixel sampling, exact/narrow preference intervals, ordered real objective pairs vs exhaustive ranking, input rejection, scenario→optimizer/export agreement, source isolation, stale evidence, fetch failure/retry, measured water admission and incorrect cached land-cover footprints.

The earlier successful intermediate full run had 119 Python / 63 UI tests; the added cached-footprint regression also passed independently before the final run. Failed intermediate checks were corrected: display-cell divisibility, old hard-coded pilot counts/default mode assumptions, an unavailable-target guard, and changed source-driven frontier expectations. A mistakenly targeted Python lint invocation against the JavaScript benchmark was rerun with the correct file scope; this was a check-command error, not a JavaScript defect.

Browser verification used the actual local app, including the final production bundle:

| Journey / condition | Observed result |
| --- | --- |
| Measured source; Moon→Mars | Correct target/template, data disclosures and scores |
| Priority changes and Apply | Winner changes; same weights re-optimize a one-site campaign |
| Kazakhstan filter | Geography-consistent campaign and preference pool |
| Missing two-objective pair | Explicit no-evidence state; Apply and export disabled |
| Measured dossier | Actual surfaces, matching baseline, shared profile scale and source detail |
| Water-dominated candidate | Candidate table says Not eligible; dossier explains 95.9% mapped water vs 50% limit |
| 375×812 viewport | New controls usable; no observed horizontal document overflow |
| Production HTTP / packaged data | HTTP 200; served results, candidates and evidence equal source JSON |
| Offline archive | 130 packaged files; observed terrain evidence equals source product |

**Browser download limitation:** the in-app browser download-event check timed out and reset its automation session; no downloaded native file was verified. Exports are verified through UI integration tests inspecting actual payloads/download behavior, but an independent native download check remains open. This is not recorded as a passed browser download test. Firefox/Safari, real devices, formal screen-reader QA, independent usability testing and an offline launch on a second machine remain unverified.

The owned temporary QA servers are stopped after verification. Use `make dev` to continue locally, or `make serve` for the built application. The local `artifacts/egiz-offline.zip` includes a launcher and genuine precomputed pilot data; basemap imagery still needs network access.

## Measured result and interpretation

After land cover was included, the lunar O1/O2 preference switch is **16.968240719550248%** priority on O2. Before land cover it was 20.902182215830736%; that intermediate value is superseded, not silently retained. The new evidence also changed campaign scores. The water-screen example is a concrete demonstration of why a flat DEM is insufficient to select a field analog.

Current numerical outputs, sensitivity results and commands are in [SCIENTIFIC_VALIDATION](SCIENTIFIC_VALIDATION.md). Product differentiation is bounded in [INNOVATION_RESEARCH](INNOVATION_RESEARCH.md). No statistical confidence, worldwide optimum or scientifically new site is claimed.

## Outstanding dependencies and work

1. Authorized global Earth Engine processing and an assessed candidate-sampling strategy; this session verified public pilot acquisition, not the remote GEE pipeline.
2. Site-specific target thermal data, climate and monthly operational snow availability. Classified cover is now present; it still needs field/context review.
3. Geological/process evidence, DEM error propagation, independent analog/practice pairs, held-out validation and human scientific review. Mission objective names do not mean lithology was measured.
4. Updated final presentation/media, rehearsals and formal submission formats after the actual 2026 guides are released. Existing slides/video remain historical drafts.
5. Organizer determination of prior-work eligibility and any requested external publication/submission. No organizer authorization is inferred from the user's development instruction.

These gaps prevent a claim of completed scientific validation or competition readiness. They do not prevent continuing independent product engineering.
