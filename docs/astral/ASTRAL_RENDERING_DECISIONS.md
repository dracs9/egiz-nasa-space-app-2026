# EGIZ ASTRAL — rendering decisions

## Engine choice

| Option | Assessment | Decision |
|---|---|---|
| CesiumJS + quantized-mesh / 3D Tiles | Strong for whole-body streaming. Needs a per-body ellipsoid and tiling scheme, pre-tiled terrain or a terrain server, a second render loop beside Three.js and a larger bundle. **Not benchmarked in this session.** | Not adopted now |
| WebGPU | Supported by Three.js, but the GLB pipeline, Draco setup and tests assume WebGL2; no measured need. | Not adopted |
| Three.js with an in-house quadtree | Already in the product; the local metric frame matches the simulator; full control over shading of scientific layers. | **Adopted** |

A 2 km site at 1 m inside a 20 km context does not need a globe. A whole-planet view is where Cesium should be benchmarked; that comparison is open work.

## Decisions

- **No tone mapping or grading.** Image brightness is shown as recorded. The Mars colour tint is a declared illustrative multiplier that can be turned off.
- **Three appearances.** *Visualization* (tint, relit), *Scientific* (no tint, relit), *As acquired* (unlit image as stored). Relighting an image that already carries its acquisition shading double-counts shading; the UI states this.
- **Terrain self-shadow is computed, not rasterised.** A 257 × 257 mask is ray-marched over the site field for the current Sun vector and applied to direct light in the terrain shader. The mission energy model uses the same horizon test. A shadow map serves only vehicle and rock meshes.
- **One Sun.** `setSun` takes the ENU unit vector interpolated from the CSPICE record. The studio has no manual sun slider.
- **Sky.** Mars: a restrained two-colour gradient and light haze, labelled illustrative. Moon palette: black sky, near-zero ambient (configured, not yet exercised with data).
- **Overlays** are one site-wide RGBA raster sampled by world position in the terrain shader, so they align at every tile level.
- **On-demand rendering.** Frames are drawn only when something changed; frame rate is reported only from back-to-back frames.
- **Quality profiles** set pixel budget, tile cache size, device-pixel-ratio cap, shadow-map size and anisotropy. The default is estimated from reported cores and memory and can be overridden.

## Known limits

- Skirts hide cracks but can appear as thin vertical faces at grazing angles.
- At rover range the 0.25 m image is magnified; the ground looks soft because nothing finer was measured.
- The regional 200 m context has no imagery and is drawn in neutral grey.
- Rock meshes are generic shapes scaled to the detected diameter.
- The NASA Perseverance model is rigid: wheels and suspension are not articulated. The procedural Scout articulates its wheels.
