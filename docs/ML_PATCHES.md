# Terrain patch dataset patches-0.1.0 (for the Stage 3 encoder)

Written with AI assistance (Claude Code); human review pending. 14 November 2026.

## Grids: rebuilt from the geo lead's own code and verified

geo-0.1.0 ships `patch_index.csv` (one row per DEM grid, with SHA-256) but not the rasters (`committed=false`). The grids were rebuilt with `pipeline/geodata/features.py:stage_dem_earth` from branch `geo/data-foundation` at commit 234ae86, unchanged, run in a detached worktree outside this checkout. Inputs are Copernicus DEM GLO-30 public COGs on AWS, read as windows (~2.2 MB per AOI, about 0.7 GB in total).

| Check | Result |
| --- | --- |
| Earth AOIs processed | 329 / 329, 0 failures |
| Grid SHA-256 equal to `patch_index.csv` (50 m and 200 m) | **656 / 658** |
| Mismatch | `PR_JETT_SP_CRATER` (both grids). Its terrain attributes differ from the release by ≤ 8 × 10⁻⁶ relative, probably a different cached source window. **For the geo lead.** |
| Terrain attributes recomputed vs `aoi_features.csv` | max relative difference 1.7 × 10⁻⁵ (16 columns per AOI) |

The grids are not committed: they are large, and they can be reproduced the same way.

## Tiles

`python -m pipeline.ml patches --grids <dir with <aoi>_p50.tif> --out artifacts/ml/patches-0.1.0` runs `pipeline/ml/patches.py`.

- Source: the 50 m local UTM grids (440 × 440 px). Every grid is re-verified by SHA-256 against `patch_index.csv`; on a mismatch the grid is skipped with a reason, so `PR_JETT_SP_CRATER` is excluded.
- Tiles: 64 × 64 px (3.2 km), stride 64, 36 per grid. Values are elevation minus the tile median, in metres, because absolute height is a shortcut and not terrain shape. NaN marks missing pixels, and tiles with less than 95 % valid pixels are dropped.
- **Sea surface:** Copernicus stores the sea as exactly 0 m. Tiles with more than 5 % exact-zero pixels are dropped. This removed 1207 tiles; without the filter, about 10 % of the set would be flat sea.
- Split: by `group_id` (hash with seed 20261107), 70/15/15. A group never spans two splits.

| | patches | groups |
| --- | --- | --- |
| train | 7595 | 216 |
| val | 1674 | 47 |
| test | 1332 | 37 |
| **total** | **10 601** from 303 sites | 300 |

Gate from brief §2.1 (≥ 50 sites and ≥ 5000 patches): **met**. This makes the encoder *eligible*. It does not make it useful: whether learned similarity adds anything over the deterministic engine is decided by the Stage 2 pre-registered evaluation, which has not been run yet.

## Not done

- No model has been trained. Training waits for Stage 2 pre-registration (brief §3).
- No Moon or Mars patches: they are held-out targets and are built by a different code path (`stage_dem_planet`).
- The 200 m grids are not tiled yet. A multi-scale encoder could use them.
- Patches overlap only within an AOI, but neighbouring AOIs in different groups can still be near each other. Group blocks are about 1°; a check on the minimum distance between splits is a TODO.
