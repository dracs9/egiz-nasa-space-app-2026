# EGIZ ASTRAL — data provenance

## Jezero world package (`data/world/mars-jezero`)

| Item | Value |
|---|---|
| Terrain | Mars 2020 Terrain Relative Navigation HiRISE DTM mosaic, 1 m/px (USGS Astrogeology Science Center, Fergason et al. 2020) |
| Terrain file | `JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif`, 21 400 × 21 488 px, float32 |
| Vertical datum | Elevation above the Mars areoid (MOLA topography, DeltaGeoid product) |
| Imagery | Mars 2020 TRN HiRISE orthorectified image mosaic, 25 cm/px (USGS, Fergason et al. 2020) |
| Imagery file | `JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first.tif`, 85 600 × 85 952 px, uint8 |
| Source CRS | Equirectangular, Mars 2000 sphere R = 3 396 190 m, standard parallel 0° |
| Window | 2048 m × 2048 m centred on 18.4446°N 77.4509°E; source windows and their SHA-256 are in the manifest |
| Output | 341 height tiles and 341 JPEG tiles, 24.1 MB; elevation −2611 to −2546 m; 100 % valid |
| Regional context | Existing EGIZ 200 m MOLA–HRSC grid, same origin |
| Illumination | `illumination.json`: three consecutive 24 h CSPICE runs from 2026-11-14T00:00Z at 600 s; kernels fingerprinted in `data/kernels/manifest.json` |

File names, sizes, CRS and pixel sizes were read from the file headers in this session. The DOIs in the manifest (10.5066/P9REJ9JN for the DTM, 10.5066/P9QJDP48 for the orthomosaic; Fergason, Hare, Mayer, Galuszka, Redding, Smith et al.) were checked against the two USGS product pages on 2026-11-13.

## How the window was read

Both mosaics are uncompressed TIFFs with one full-width row per strip. `pipeline/world/remote_tiff.py` parses the TIFF directory and requests only the needed columns of each row by HTTP range: 88 MB transferred instead of several hundred. Compressed, tiled or multi-band files are refused.

## Reproducibility

- `python -m pipeline.world.scene mars-jezero` was run twice; both runs gave the same tile fingerprint `d186b0d4…cb30` (SHA-256 over all tile hashes).
- `web/scripts/copy-world.mjs` re-hashes every tile against the manifest at build time and aborts on a mismatch.
- The first day of the world illumination record agrees with the packaged EGIZ record to 1.5 × 10⁻¹¹ per Sun-vector component.

## Storage

`data/world/mars-jezero` (24 MB) is not git-ignored; `data/raw/world` (88 MB cached source windows), `web/public/world` (generated copy) and SPICE kernels are. Whether to commit the package or rebuild it in CI is a maintainer decision; nothing was committed in this session.

## Not acquired

Geological map (Stack et al. 2020), CRISM or other spectral products, CTX products, thermal inertia, rover-derived rock counts. Earth and Moon worlds are not built for this engine.
