# EGIZ ASTRAL — performance report

Machine: Intel Core Ultra 7 265H (16 threads), 15 GB RAM, NVIDIA RTX PRO 500 laptop GPU (ANGLE/D3D11), Windows 11.

## Measured (Node 24, single thread, real Jezero field)

| Operation | Time |
|---|---|
| Assemble 2 m site field from 64 tiles | 29 ms |
| Terrain features, 8 m cells | 50 ms |
| Rule classification | 4 ms |
| k-means terrain units | 129 ms |
| Crater search | 539 ms |
| Terrain shadow mask 257 × 257 | 68 ms |
| Navigation grid 1025 × 1025 + drive look-up | 199 ms |
| Plan three routes + simulate 406 m (fast) | 78 ms |
| Plan three routes + simulate 406 m (detailed) | 83 ms |

Full web test suite: 11 s. First source download: 88 MB.

## Data sizes

Height tile 34 kB; image tile roughly 20–110 kB. Whole package 24.1 MB. A close view kept 65–100 tiles resident.

## Rendering

Observed on the *high* profile: about 0.66 M triangles at the site overview and 2.7–3.3 M at rover range with 65–97 tiles drawn.

**Frame rate was not measured reliably.** The browser pane used for testing was hidden and throttled animation frames (1–6 fps reported), so no fps figure is claimed. The *balanced* and *performance* profiles were not measured. The close-range triangle count on *high* is larger than it needs to be; lowering the pixel budget or decimating flat tiles is the obvious optimisation.

## Main-thread work

Scene analysis (about 0.8 s) and the navigation grid (0.2 s) run on the main thread behind a status message. Rock detection decodes and scans 0.25 m tiles on the main thread. None is in a Web Worker yet.

## Not verified

Smooth camera motion, memory stability over long sessions, integrated-GPU behaviour and other hardware.
