# ML data interface proposal (DRAFT)

Written with AI assistance (Claude Code); human review pending. No geospatial ML interface exists yet. Stage 1 consumes the existing contract files (`earth_candidates`, `targets`, `mission_templates`, optional `sun_windows`, `results`) through `pipeline/ml/loader.py`. This is the minimum the ML layer needs from the Geospatial Engineer for Stages 2–3.

## Already sufficient (Stage 1)

Existing `earth_candidates.json` / `targets.json` contracts: stable IDs, unit-named attributes, `missing` lists, provenance. Keep `null` for missing values and keep the LF line endings (hashes).

## Requested additions

1. **Site manifest** (`sites.json` or columns in `earth_candidates`): `aoi_id`, `geo_group` (spatial block / region ID for leakage-safe splits), `sampling_design` (how the site was chosen: random stratum, curated, practice), footprint polygon or bbox, CRS.
2. **Patch index** (`patches.parquet` or CSV): `patch_id`, `aoi_id`, `geo_group`, `body`, path, size (px), `pixel_m`, vertical unit, CRS, `valid_frac`, source DEM ID + version, checksum. Patches as float32 GeoTIFF or `.npy` + JSON sidecar, with a separate nodata mask.
3. **Source registry** keys referenced by every attribute (`attr_sources` already exists for targets — the same for Earth tiles).
4. **Climate and snow** values with explicit `missing` when unavailable, never 0.
5. **Snapshot versioning:** a manifest with schema versions and SHA-256 of every file.

## Scale needed to unlock gated components

≥ 100 candidate sites from a documented sampling design (novelty); ≥ 50 geographically distinct sites and ≥ 5 000 valid patches (terrain encoder). Lunar/Martian patches at the same physical pixel spacing as the Earth patches they are compared with.
