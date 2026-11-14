# Performance — before / after (2026-11-14)

> **Superseded (14 Nov 2026):** the three.js landing measured here was replaced on `main` by the film-based landing (PR #3). The figures below describe the old landing and are kept as a record; the new landing has not been re-measured.

Rule: no change to any scientific output. The discovery bundle, score shards and
`docs/discovery/RESULTS.md` are untouched by this work (only web code, assets and
`vercel.json` changed). `python -m pipeline.discovery verify` reproduces the committed bundle.

## How it was measured

* Production build (`npm --prefix web run build`) served by `vite preview`.
* Bundle: raw and gzip (level 9) size of the chunks the landing page loads (static import
  graph from `dist/index.html`).
* Lighthouse 12.6.1, mobile form factor (simulated slow 4G, 4× CPU), performance category.
  Headless Chrome renders WebGL in software here, so Lighthouse over-states GPU cost.
* Real-GPU probe (puppeteer-core, Chrome headless with ANGLE/D3D11) on this machine:
  Intel Arc integrated GPU, 1440×900, DPR 1. Long tasks and LCP from PerformanceObservers,
  FPS from requestAnimationFrame over 6 s idle and 6 s scripted scroll.
* CPU profile (CDP Profiler) of the landing load to find causes.

## Top causes found (landing)

1. **Synchronous shader compile/link: 22.3 s on the main thread** (three.js `getUniforms`
   waiting for the terrain/sky programs; ANGLE D3D11 compiles the large terrain shader slowly),
   plus ~3.6 s for the relief bake shader in the engine constructor.
2. **23 MB of textures**: three 2048² lossless RGBA detail maps (~6 MB each; RGB packs normals,
   alpha packs cavity, so lossy re-encoding is not acceptable) and 4096-px Moon/Earth sky maps.
3. All non-landing pages (Campaign, Matrix, Evidence, Twin, Brief, site drawer, guide) and the
   MapLibre CSS were in the landing bundle.
4. Scroll handler interleaved layout reads (`offsetTop`) with style writes per section.
5. No pause when the tab is hidden; no DPR cap on phones; bloom kept under sustained load.

## Changes

* `WorldEngine.start()` compiles every program with `renderer.compileAsync`
  (KHR_parallel_shader_compile) before the first draw, then bakes and starts the loop.
  The static poster (`/hero/moon-south-pole-*.jpg`) shows until then. Drawn output unchanged.
* Rendering pauses on `visibilitychange`; reduced-motion users get on-demand rendering.
* DPR capped at 1 on compact screens; bloom dropped while frame time stays > 20 ms at the
  lowest resolution; a GPU below ~15 fps for 5 s falls back to the static poster;
  low-memory / ≤ 4-core phones get the poster directly.
* Compact screens load 1024² lossless downsamples of the detail maps and the existing
  2048-px sky maps; desktop keeps the originals (identical look).
* Non-landing pages lazy-loaded; MapLibre CSS imported only by map components.
* Scroll tick reads all layout first, then writes.
* `vercel.json`: hashed `/assets/*` immutable for a year; data JSON `max-age=0, must-revalidate`
  (ETag revalidation); static media one day + stale-while-revalidate.
* Already in place and kept: passive rAF-throttled scroll; Discover score shards load per
  target; Discover map uses a GeoJSON circle layer (no DOM markers); the Anthropic SDK is
  only dynamically imported when a viewer opts in with their own key in ASTRAL Studio
  (not downloaded otherwise; Discover uses the server proxy `api/copilot.ts`).

## Results

| Measure | Before | After | Target |
|---|---|---|---|
| Landing initial JS (gzip) | 202 KB | 168 KB | ≤ ~300 KB ✔ |
| Landing initial JS+CSS (gzip) | 238 KB | 193 KB | — |
| Lighthouse mobile, landing: score | 0.53 | 0.77 | — |
| Lighthouse mobile, landing: LCP | 2.6 s | 2.5 s | ≤ 2.5 s ✔ (borderline) |
| Lighthouse mobile, landing: TBT | 17 390 ms | 710 ms | ≤ 200 ms ✘ |
| Lighthouse mobile, landing: CLS | 0.003 | 0.003 | ✔ |
| Lighthouse mobile, landing: bytes | 25.2 MB | 13.1 MB | — |
| Real GPU, landing: longest main-thread task | 22 837 ms | 2 352 ms | — |
| Real GPU, landing: TBT (long tasks − 50 ms) | 25 076 ms | 3 124 ms | — |
| Real GPU, landing: LCP | 23.8 s (world) | poster at once; world fades in at 26 s | — |
| Real GPU, landing: FPS idle / scrolling | 18 / 29 | 28.5 / 28.9 | ≥ 50 ✘ |
| Lighthouse mobile, Discover: score / LCP / TBT | not measured before | 0.51 / 10.0 s / 950 ms | ✘ |

## Not met, and why (honest)

* **World render speed on an integrated GPU (~28 fps) and its ~26 s compile** are set by the
  terrain fragment shader itself. The fixes above stop it from freezing the page, but making
  it fast needs a simpler shader (fewer texture taps/loops) or KTX2 textures, which changes
  how the landing looks — not done without a decision.
* **Discover LCP 10 s on simulated slow 4G** is network-bound: `discovery.json` is 3.9 MB raw
  (~1.4 MB transferred). Splitting it per target needs a bundle schema change (and a new bundle
  hash); deferred to keep the scientific bundle stable before the freeze.
* Target-switch latency in Discover (< 150 ms goal) was not measured in this pass.
