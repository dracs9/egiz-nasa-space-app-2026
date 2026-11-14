# EGIZ as one platform

How the landing page, the guided expedition, Mission Home and the existing workspaces connect.

## The journey

1. **Landing (`#/`)**: unchanged film and narrative. Chapter 08, *The Moon or Mars?*, offers the choice and **Start**. The hero panel also has a quiet *Investigate the Moon / Mars →* link.
2. **Expedition (`#/explore?body=mars&step=…&site=…`)**: a guided, five-step investigation. Every step stays reachable from the rail afterwards.
   - `explore`: globe of the world (visual mosaic for orientation only), its measured sites and landmarks.
   - `site`: a progressive briefing built from the site's fingerprint, with evidence class and source on every value, plus challenges stated by fixed rules.
   - `analysis`: eight real computations (index scoring, ranking stress test, candidate-space ML, gap ledger, published-analog validation, ATLAS-Π, critic). Each one is timed and reproducible, and the deterministic assistant answers questions about them.
   - `alternatives`: standardised fingerprint differences and shared top-50 Earth analogs against every other measured site on that world.
   - `analogs`: the Earth-wide map, a diverse shortlist, per-window statistics, ATLAS-Π task status, and where the analogy breaks.
3. **Mission Home (`#/mission`)**: site, findings, kept analogs, simulations, campaign result, open questions, next actions, what needs recalculating, every workspace, the conclusion, exports and saved missions.

## Shared context

The mission *is* the Planetary Studio's investigation record (`planet/workspace/store.ts`, persisted in `localStorage`). The record adds optional fields: `world`, `trail`, `analysis`, `considered`, `decision`, `journey`, `analogsFor` and `siteName`. Records saved before these fields existed still open.

- `expedition/nav.ts`: the workspace registry used by the header index, Mission Home and the studio switcher. `openWorkspace()` opens a tool starting from the mission. Discover gets the site and profile, ATLAS-Π the matching mission, and Mission Studio the world on the same body. The Lab, Field Campaign and Same Sun get the campaign target on the same body, and the Planetary Studio gets the site's 3D package.
- `expedition/journey.ts`: step status (done / stale / open) and `staleItems()`. Changing the site never deletes results. It flags them: the analysis was run for another site, or the analogs were ranked for another site.
- `planet/workspace/data.ts`: the discovery index, validation, ATLAS-Π, site list and score shard. It loads once and is shared by every mission surface.

## Data modes

The expedition, Earth analogs and 3D terrain always use the measured discovery index. The data-mode switch (measured pilot or synthetic demo) still applies to Field Campaign, Engineering Lab and ATLAS-Π, and Mission Home says so.

## Direct links

Any workspace URL still opens on its own. When a mission exists, the header chip and the index show it, and **Mission Home** is one click away. `#/explore` or `#/mission` with no mission shows the Moon-or-Mars choice.

## On-device surface enhancement

When a site is selected in Explore or Investigate, the globe's colour mosaic around it is upscaled ×4 by Real-ESRGAN x4plus. The model is the official weights exported to ONNX ([SceneWorks/real-esrgan-onnx](https://huggingface.co/SceneWorks/real-esrgan-onnx), BSD-3-Clause) and runs in `workers/enhance.worker.ts` through ONNX Runtime Web: WebGPU when the device has an adapter, WASM otherwise.

- The ~67 MB model is fetched once. It is checked against its published SHA-256 and kept in Cache Storage.
- The patch is a sphere segment built from the exact latitude/longitude box of the crop (`expedition/enhance.ts`, `Globe.setDetail`). Its edges are feathered and it cross-fades in, so nothing visibly switches.
- It is labelled as an AI illustration. It is never an input to any calculation.
- `scripts/copy-ort.mjs` copies the ONNX Runtime WASM binaries to `public/vendor/ort/` for same-origin loading.
