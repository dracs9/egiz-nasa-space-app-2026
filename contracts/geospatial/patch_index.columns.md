# patch_index.csv columns (contract 1.x)

CSV, UTF-8, LF, header row. One row per analysis grid (patch).

| column | meaning |
|---|---|
| patch_id | `<aoi_id>__<VAR>_P<pixel_m>`; unique |
| aoi_id, site_id, group_id, body | join keys to `aoi_catalog.json` / `aoi_features.csv`; split on `group_id` |
| variable | raster variable and unit, e.g. `elevation_m` |
| source_tiles | `;`-joined source raster URLs (tile IDs) the patch was derived from |
| asset_path | repo-relative path of the GeoTIFF (not committed; rebuild with `python -m pipeline.geodata features`) |
| sha256, bytes | checksum and size of that GeoTIFF |
| crs | analysis CRS (Earth: UTM EPSG; Moon/Mars: PROJ AEQD string on the body sphere) |
| pixel_m, rows, cols | square pixel size in metres and grid shape (22 km window) |
| native_res_m | source posting before resampling (no upsampling: pixel_m >= native_res_m) |
| resampling | resampling method; average with all-valid footprint rule |
| valid_frac | fraction of finite pixels in the patch |
| committed | always `false` in geo-0.1.0 (rasters are regenerated, not stored in git) |
