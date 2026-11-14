# EGIZ ASTRAL — model registry

Source of truth: `web/src/astral/intelligence/registry.ts`, shown in Mission Studio → Intelligence → Model registry.

| ID | Task | Status | Evaluation |
|---|---|---|---|
| `egiz-geomorph-rules-v1` | Terrain shape/texture classes | Inference ready | Unvalidated: no expert or field labels |
| `egiz-terrain-units-kmeans-v1` | Clustering, outliers, query-by-example | Fits in session | Unvalidated; seed stability not assessed |
| `egiz-dtm-depression-v1` | Crater candidates | Inference ready | Unvalidated against a crater catalogue |
| `egiz-shadow-segmentation-v1` | Rock candidates | Inference ready | Unvalidated against rover rock counts |
| `egiz-shading-registration-v1` | Registration check, image Sun azimuth | Inference ready | Azimuth recovery verified on analytic surfaces in tests |
| `egiz-copilot-intent-v1` | Commands and grounded answers | Inference ready | Parser unit-tested; fixed request shapes |
| `remote-llm` | Free-form dialogue | Not configured | No relay implemented |
| `ibm-nasa-prithvi-eo-2` | Earth-observation foundation model | Not applicable here | Not downloaded, not run |
| `ibm-esa-terramind` | Multimodal Earth-observation model | Not applicable here | Not downloaded, not run |

## Why the Earth foundation models are not applied

Prithvi-EO is trained on multi-band Harmonized Landsat–Sentinel-2 at 30 m; TerraMind on Sentinel-1/2, elevation and land cover at about 10 m. The Jezero input is one panchromatic band at 0.25 m. There is no basis for transferring those models to it without a domain evaluation, so they are registered as candidates for the Earth-analog side of EGIZ only. Their licences, sizes and exact training details were not re-checked online in this session.

## What a trained planetary model would need

- Terrain segmentation: expert polygons for this site (for example the published photogeologic map rasterised to the ortho grid) or a labelled orbital image set, with a held-out evaluation.
- Rock detection: rover-derived rock counts or manually digitised rocks on HiRISE tiles to measure completeness against diameter.
- Craters: a catalogue reaching about 10 m diameter for recall and false-positive rates.
