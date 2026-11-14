# ATLAS-Π data provenance

Written with AI assistance (Claude); human review pending. Every dataset node in the evidence graph (`atlas_pi.json → evidence_graph`) carries its URL and, where cached, SHA-256.

| Dataset | Provider / licence | Used for | Resolution | Access in this work | Provenance status |
|---|---|---|---|---|---|
| Copernicus DEM GLO-30 Public (2021) | Copernicus Programme / ESA / Airbus; licence per registry (review before publication) | 9 Earth windows (existing pilot) and 10 discovery windows | 30 m → 200 m cells | Pilot: cached tiles with SHA-256 (existing). Discovery: remote COG windows read 13 Nov 2026 (not cached; URL recorded) | Pilot hashed; discovery URL-only |
| Copernicus DEM GLO-90 Public | same | Level-1 discovery screen | 90 m, read at ~370 m | Remote COG overview reads (18 tiles), 13 Nov 2026 | URL-only |
| ESA WorldCover 2021 v200 | ESA / WorldCover consortium, CC BY 4.0 (Zanaga et al. 2022, doi:10.5281/zenodo.7254221) | Bare fraction and water/built constraints (pilot only) | 10 m | Existing pilot cache with SHA-256 | Hashed. **Not acquired for discovery windows** |
| NASA PGDA LOLA 5 m Site20v2 | NASA GSFC PGDA (Barker et al. 2021) | Mons Mouton | 5 m → 200 m | Existing cache, SHA-256 | Hashed |
| MOLA–HRSC blended DEM 200 m v2 | USGS / NASA / ESA / DLR / FU Berlin | Jezero | 200 m nominal | Existing cache, SHA-256 | Hashed |
| NAIF generic kernels (naif0012.tls, pck00011.tpc, de440s.bsp, moon_080317.tf, moon_pa_de421) | NASA NAIF | Solar geometry (`atlas_solar.json`) | — | Existing kernels, manifest SHA-256 verified at run time | Hashed |
| NOAA solar equations (existing `sun_windows.json`) | NOAA GML | Lunar low-Sun window fidelity | 0.1° latitude bins | Existing | Existing provenance |
| NSSDCA Moon/Mars fact sheets | NASA | Body gravity | — | Web, verified 13 Nov 2026 (Mars 3.73 m/s², updated 2025-05-19) | Cited |
| Apollo-era lunar Bekker estimates | NASA M2M-30044; TM-20250006958 | Counterfactual soil scenario | — | Literature values (rough estimates) | Cited; `assumed` |

## Generated files

| File | Content | Reproduce |
|---|---|---|
| `data/pilot/atlas_solar.json` | SPICE solar elevation/flux series: Earth 12 monthly days, Moon 30 days, Mars 12 seasonal epochs; kernel manifest | `python -m pipeline.analog_transfer build --solar-rebuild` |
| `data/pilot/atlas_discovery.json` | Level-1 blocks and Level-2 candidates with source URLs | `python -m pipeline.analog_transfer discover` (network) |
| `data/pilot/atlas_pi.json` | Tensor, certificates, constellations, counterfactuals, planner, red team, evidence graph, evaluation, dossiers; input SHA-256 and content hash | `python -m pipeline.analog_transfer build`; `verify` |

## Not available

The following were not acquired, and their absence is represented as `unknown`, never as zero:

- temperature (MODIS LST);
- precipitation (GPM IMERG);
- snow (MOD10A1);
- target temperatures (Diviner/THEMIS);
- metre-scale DEMs (HiRISE DTM, drone/lidar);
- Jezero or field-site soil mechanics;
- geological maps;
- WorldCover for discovery windows.
