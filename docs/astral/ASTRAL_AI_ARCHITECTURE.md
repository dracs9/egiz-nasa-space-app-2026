# EGIZ ASTRAL — intelligence architecture

## Position

Deterministic engines decide. The intelligence layer detects, groups, ranks, proposes and explains; every output carries its method, input resolution and limits. No labelled planetary training data was available, so nothing here is a trained supervised model and nothing claims to be.

## Components (`web/src/astral/intelligence`)

| Component | What it does | Kind |
|---|---|---|
| `terrainFeatures` | Six descriptors per 8 m cell: slope, 10 m detrended relief RMS, topographic position (40 m), image brightness, texture, structure-tensor coherence | descriptors of measured data |
| `classifyTerrain` | Seven shape/texture classes by fixed thresholds | rule baseline |
| `fitTerrainUnits` | Seeded k-means++ (k = 6) on standardised descriptors, fitted in the browser on the loaded site; outlier score = distance to own centroid ÷ unit mean | unsupervised ML, fitted in session |
| `similarTo` | Query-by-example similarity in descriptor space | retrieval |
| `detectCraters` | Multi-radius circular depression and rim test on elevation | terrain-derived baseline |
| `fitShading` | Least squares of brightness on terrain gradients: image Sun azimuth and image–terrain registration offset | data-quality model |
| `detectRocks` | Shadow segmentation on 0.25 m tiles with a lit-face test | image-derived baseline |
| `dataQuality` | Coverage, range, discontinuities, saturation, registration, illumination | checks |
| `scienceTargets`, `hypothesesAt` | Ranked candidate targets; structured falsifiable hypotheses | computational suggestions |
| `copilot.ts` | Request → typed tool calls → validated execution → composed answer | deterministic parser |

## Copilot contract

1. `parseIntent` maps text to `ToolCall[]` (19 tools). Unmatched text yields nothing and the UI says the request was not understood.
2. `validateCall` enforces the allow-list and each parameter's type and range.
3. Tools marked `confirm` (`reset_mission`) need an explicit confirmation.
4. `runTool` executes against live studio state and returns sections tagged *Measured*, *Computed*, *Model interpretation*, *Assumption*, *Limitation*, *Source*, *Done*.
5. Every call goes to the tool log (Evidence panel and dossier).

Numbers in answers come only from tool results. There is no free-text generation, so nothing can be invented; the cost is that the copilot understands a fixed set of request shapes.

`CopilotProvider` is the seam for a remote model: it would emit the same `ToolCall` objects through the same validation. No relay or key is configured.

## Context and evidence

Tools read the current selection, rover pose, mission specification, result, detected rocks, scene time and analysis. “This point”, “the rover”, “the largest crater”, compass areas and `x, y` coordinates resolve through `resolvePlace`.

Answers list evidence identifiers: `src:dtm`, `src:ortho`, `model:<id>`, `ref:<id>`. The reference library in `discovery.ts` holds ten citations with conservative paraphrases; the copilot cannot cite anything outside it.

## Not implemented

Supervised segmentation or detection networks, Earth foundation models on planetary data, vector search over external imagery, change detection (no multi-temporal data), a learned simulation surrogate, and an LLM dialogue relay.
