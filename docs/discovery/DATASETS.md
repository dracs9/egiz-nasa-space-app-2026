# EGIZ Discovery Engine — dataset catalog

Written with AI assistance (Claude); human review pending. Evidence classes follow
`pipeline/geodata`: observed, derived, proxy, modelled, simulated, synthetic_fixture; plus
`literature` (published value or class) and `physical_constraint` (e.g. no vegetation on Mars).

## Acquired and used

| Source | Provider / product | Used for | Evidence | Access | Licence |
|---|---|---|---|---|---|
| COP_GLO30 | ESA Copernicus DEM GLO-30 Public 2021, AWS COGs | Earth terrain (slopes, TRI, relief, curvature) on local UTM grids | derived | anonymous HTTPS range reads | Copernicus DEM licence (free, attribution) |
| ESA_WC_V200 | ESA WorldCover 2021 v200, 10 m, AWS COGs | bare, vegetation, snow, water, built-up fractions | proxy (classified map) | anonymous HTTPS range reads | CC BY 4.0 |
| NASA_POWER_CLIM | NASA POWER climatology API (MERRA-2 based, 0.5°) | 2 m air temperature, precipitation | modelled | public API | public |
| MACROSTRAT | Macrostrat geologic map units API | lithology label at window centre, map scale | proxy (map category) | public API | CC BY 4.0 |
| PGDA_LOLA_5MPP | NASA PGDA product 78, LOLA 5 m/px south-pole site DEMs | six lunar targets | derived | public download | NASA open data |
| USGS_MARS_BLEND | USGS HRSC/MOLA blended DEM global 200 m v2 | four Mars targets | derived | HTTPS range reads | public domain |
| GVP_VOTW | Smithsonian Global Volcanism Program, Holocene volcano list (WFS) | distance to nearest Holocene volcano | derived context | public WFS | Smithsonian terms (attribution) |
| WIKIDATA_IMPACTS | Wikidata items "impact crater" (Q55818 and subclasses) on Earth | distance to nearest impact structure | derived context | SPARQL | CC0 (community-curated; cross-check with the Earth Impact Database) |
| NATURAL_EARTH | Natural Earth 1:50m admin-0 countries | country of window centre, Kazakhstan lattice polygon | proxy | public download | public domain |
| HiRISE (ASTRAL) | USGS Mars 2020 TRN HiRISE DTM 1 m + orthomosaic 25 cm | Jezero 3D world (Mission Studio) | derived / observed | HTTPS range reads | public domain |
| Literature constants | NSSDCA fact sheets; Hassler 2014; Zhang 2020; UNSCEAR 2008; Paige 2010 | gap ledger, thermal reference | literature | — | — |

Exact URLs, versions, access dates and SHA-256 of every acquisition are in
`data/discovery/index/manifest.json` (sources), the per-window records under
`data/derived/egiz-index-1.0.0/aoi/` (not committed: rebuilt by `acquire`) and
`data/geo/geo-0.1.0/manifests/`.

## Not acquired (dimension reported as not assessed)

| Need | Candidate product | Blocker / integration path |
|---|---|---|
| Land-surface temperature (observed) | MODIS MOD11A2 / Landsat TIRS | Earth Engine project (`EE_PROJECT`, `earthengine authenticate`); `pipeline/earth/gee_env.py` is coded |
| Mineral indicators | EMIT L2B, ASTER, Sentinel-2 ratios | NASA Earthdata login or Earth Engine; add `min_*` columns as spectral proxies |
| Wind, aerosol, dust | ERA5-Land, MERRA-2, MAIAC AOD | Copernicus CDS key / Earth Engine |
| Permafrost, ground ice | ESA CCI Permafrost; LEND, Mini-RF; SWIM, SHARAD | open data but not yet ingested |
| Caves, lava tubes | USGS Mars cave candidate catalog; lunar pit catalogues; karst maps | not yet ingested |
| Target mineralogy | CRISM, OMEGA, M3 | per-site product selection needed |
| Site-specific target temperatures | Diviner (Moon), MCD / THEMIS (Mars) | body-level literature references used instead, labelled as such |

## Synthetic data

None in the discovery bundle (`synthetic: false` is enforced by `web/scripts/copy-data.mjs` and the
tests). The synthetic demo dataset of the older Campaign workspace remains separate and labelled.
