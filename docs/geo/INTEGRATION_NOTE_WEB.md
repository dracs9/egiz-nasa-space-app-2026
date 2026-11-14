# Integration note → frontend engineer (`web/`)

From: Geo lead · Dataset `geo-0.1.0`, schema `1.0.0` · Status: awaiting your ack before field freeze.

- **Single file for display**: `data/geo/geo-0.1.0/aoi_catalog.json` (contract `contracts/geospatial/aoi_catalog.schema.json`). Copy it into the web build the same way `web/scripts/copy-data.mjs` copies other data (your module — I did not edit it).
- **Stable IDs**: `aoi_id` (pilot IDs unchanged from `data/pilot/earth_candidates.json`), `site_id`, `group_id`.
- **Map geometry**: `centroid {lon, lat}` and `footprint.ring_lonlat` (closed 5-point ring, body geographic coordinates, east-positive). Moon/Mars coordinates are planetocentric on the body sphere — do not place them on an Earth basemap.
- **Badges**: `coverage_level` (L0…L4), `quality_status`, `stages`; show `missing` reasons on hover. `L4_validated` on Moon/Mars means terrain only (see interface §6).
- **Evidence labels**: show "modelled" next to temperatures/precipitation and "map proxy" next to geology.
- **Provenance**: `manifests/sources.json` gives provider, licence and citation per `source_id`.
- No raster downloads in the browser. Ask if you need small preview images.
