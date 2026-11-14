# EGIZ implementation audit · 17–18 October 2026

This is an audit of local independent development, not competition eligibility or a scientific endorsement. Existing uncommitted work was preserved. The starting checkout was `docs/google-doc`, HEAD `c81bacb`, with extensive modified and untracked application files. No reset, commit, push, deployment, publication or organizer message was performed.

## Verified architecture

Curated target/source CSVs → windowed NASA PGDA / USGS planetary rasters and Copernicus Earth DSMs → metric reprojection and shared terrain functions → schema-validated input JSON → objective fidelity → complementary campaign search → static React/TypeScript application. Separately selectable synthetic fixtures, default measured pilot and optional complete observed bundle remain separate. Workers recalculate custom campaigns; explicit fallback handles worker failure. MapLibre is lazy loaded; satellite imagery is online, while tables and measurements are packaged.

The input fingerprint chain binds results to four input files. New terrain evidence is bound to target/candidate hashes and raw raster SHA-256 values. It loads only in measured modes. A stale optional evidence bundle fails packaging and runtime validation. No backend, account or LLM is required by the application.

## Subsystem assessment

| Subsystem | Verified behavior | Remaining weakness / assessment |
| --- | --- | --- |
| Acquisition | Nine actual public Copernicus/WorldCover windows, two actual planetary windows; cached source URLs checked | Purposive pilot, not global sampling. Earth Engine service execution still requires an authorized project. |
| Terrain science | Shared central differences; fine 100/400 m baselines; regional 2 km baseline | Fixed a lunar/Earth regional sampling mismatch. Matching pixels cannot equalize source effective resolution or DSM/DTM differences. |
| Fidelity | Missing data, constraints, geometric mean, per-attribute evidence | Tolerances and weights are modeling choices pending domain validation. Climate/thermal inputs remain missing; classified land cover is now acquired. |
| Campaign | 1–3 complementary sites; exact shortlist with greedy full-pool check; redundant sites removed | No full-pool global-optimum claim for large catalogs. Nine-site pilot is exhaustively included. |
| Counterfactual analysis | New exact single-site upper envelope, switch thresholds, interactive priorities and export | Fixed model scores; preference analysis is not measurement uncertainty. |
| Evidence | New real terrain surfaces, common-axis profiles, histogram counts, missing pixels, hashes and source links | 800 m display cells and one transect support inspection, not independent validation or obstacle mapping. |
| Research planning | New source-bound Markdown checklist, missing measurements and independent verification steps | No field routes, permissions, safety assessment or invented observations. |
| Reliability | Baseline and updated unit/integration/build checks; retry and worker fallback tests | Independent Firefox/Safari and actual device testing are outstanding. |
| UX / visuals | Existing dark editorial design retained; new controls and paired plots tested in desktop and 375 px browser view | External usability study and formal screen-reader audit remain outstanding. |
| Performance | O(n log n) preference hull; 3,000 synthetic software lines timed under 1 ms median on this machine | This is computation timing, not global acquisition throughput. MapLibre remains the largest lazy chunk. |
| Maintainability | Existing Python, JSON contracts, React/Zustand structure retained; export helper shared | Main legacy components remain dense; unnecessary architectural replacement was avoided. |
| Novelty | Explainable complementary campaigns plus exact preference switches and traceable evidence are demonstrated | No world-first claim. Map sliders, GIS, multicriteria analysis and coverage optimization have substantial prior art. |
| Demonstration | Real Moon/Mars target → pilot → objective trade-off → dossier → export works locally | Scientific and competition readiness remain unestablished. |

## Adversarial findings addressed

1. **Planetary scientist:** lunar regional attributes used 50 m pixels while Earth regional attributes used 200 m. `measure_target_terrain` now uses 200 m regional sampling for both planets, with a numerical regression test. Fine lunar metrics retain 50 m pixels.
2. **Data expert:** source product labels were insufficient links in terrain evidence. The evidence now includes exact product URLs, native CRS and cached raster hashes. Required Copernicus attribution is included in the product and source guide.
3. **Geospatial engineer:** a 500 m display cell could not group both 50 and 200 m grids evenly. Tests found this; 800 m cells now aggregate integer blocks on both grids. Missing samples propagate.
4. **Product reviewer:** changing a slider without applying the same decision to the campaign would be misleading. The Apply action enables the same pair, sets their weights, selects the one-site budget and re-optimizes. Integration and browser checks verify consistency.
5. **Scientific admission:** independent WorldCover maps 95.8658% of the original coastal Kazakhstan window as permanent water. The declared water constraint now excludes it from all objectives and campaigns. No coordinate was silently moved.
6. **Skeptical judge:** missing environment and a tiny pool cannot support a claim of discovering the world's best analog. Pilot disclosures, partial labels, exports, evidence and documentation preserve that limitation.

The old 15 October audit is historical. Its worker/missing-ceiling findings had already been fixed before this session and were not claimed as new work. Competition task statuses were not rewritten to manufacture completion. Current verification is recorded in [SCIENTIFIC_VALIDATION](SCIENTIFIC_VALIDATION.md) and [IMPLEMENTATION_PROGRESS](IMPLEMENTATION_PROGRESS.md).
