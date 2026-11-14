# EGIZ ASTRAL — world engine design

## Principle

One measured world, three consumers. The renderer, the interpretation layer and the simulator read the same tiles, the same site field, the same object list and the same Sun vector.

```
pipeline/world (Python)            web/src/astral (TypeScript)
  remote_tiff.py  byte-range read    world/core.ts     manifest, tile maths, LOD, streaming cache, coordinates
  build.py        reproject + tile   world/field.ts    site height field and spatial analysis
  illumination.py multi-day CSPICE   view/worldView.ts renderer (Three.js)
        |                            intelligence/*    perception, registry, discovery, copilot
        v                            sim/*             terramechanics, traversability, mission
  data/world/<site>/                 studio/*          session, tools, dossier, Mission Studio
```

## Coordinates

- **Local frame:** x east, y north, metres from the site origin; z metres above the source vertical datum. The Jezero origin is the published landing coordinate 18.4446°N 77.4509°E, the same origin as the existing 200 m grid, so both share one frame.
- **Local CRS:** azimuthal equidistant on the body sphere (`+proj=aeqd +R=3396190`). `localToLatLon` / `latLonToLocal` implement the spherical inverse and forward; tests check a 1 km offset against R and a sub-millimetre round trip.
- **Source CRS:** the USGS mosaics are equirectangular with standard parallel 0°, so a source pixel is 1 m north–south but 0.949 m east–west at this latitude. The builder reprojects through PROJ instead of treating pixels as square metres.
- **Scene axes:** +X east, +Y up, −Z north; true scale, no vertical exaggeration. Web Mercator is never used.

## World scene manifest (`egiz.world_scene` 1.0.0)

Body, target, frame, local CRS and axes, extent, height encoding, level table with per-level provenance, every tile with SHA-256 of its height and image payloads, both source products (URL, citation, vertical datum, pixel size, source window, window hash), the illumination reference, method and limitations. `validateManifest` rejects synthetic or incomplete packages.

## Tile hierarchy

| Level | Tile | Terrain posting | Image pixel | Origin |
|---|---|---|---|---|
| Regional | 20 km window | 200 m | — | measured, MOLA–HRSC (existing EGIZ grid) |
| L0 | 2048 m | 16 m | 4 m | area average of L4 |
| L1 | 1024 m | 8 m | 2 m | area average |
| L2 | 512 m | 4 m | 1 m | area average |
| L3 | 256 m | 2 m | 0.5 m | area average |
| L4 | 128 m | 1 m | 0.25 m | measured (source posting) |

Each tile holds 129 × 129 posts plus a one-post apron, int16 in 0.02 m steps (serialisation, not accuracy). Neighbouring tiles share edge posts exactly; the apron lets normals be computed by central differences across the seam, so shading is continuous.

## Level of detail and streaming

- `selectTiles` refines the quadtree while the projected geometric error (half the level posting) exceeds a pixel budget: 6 / 3 / 1.5 px for performance / balanced / high.
- `ancestorsOf` + `resolveDrawSet`: ancestors load coarse-first and a subtree falls back to its finest loaded ancestor while leaves arrive. Draws never overlap and always cover the view.
- `TileCache`: bounded concurrency (6), cancellation of requests no longer wanted, LRU eviction, disposal of late results.
- Skirts close cracks between levels. Frustum culling uses tile bounds with measured min/max elevation.

## Site field

`field.ts` stitches level L3 (2 m, 1025 × 1025 posts) into the grid used by inspection, overlays, perception, routing, the simulator and the shadow mask: bilinear sample, gradient, slope, aspect, plane-detrended roughness, profile, path length, polygon area, local relief, line of sight, horizon angle, point shadow and site-wide shadow mask.

## Objects and provenance

Objects carry stable identifiers from quantised coordinates (`crater:x:y:r`, `rock:tile:x:y`, `target:…`, waypoint ids). The same record is drawn, listed, used as a routing keep-out and written to the dossier.

Provenance classes: `measured`, `measured-area-average`, `image-derived`, `terrain-derived`, `model-inferred`, `assumed`, `illustrative`, `hypothetical`. The layer list, inspector headings, viewport legend and copilot answers show the class.
