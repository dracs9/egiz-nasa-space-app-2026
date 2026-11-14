# Data sources — geospatial release `geo-0.1.0`

Machine-readable registry: `pipeline/geodata/sources.py` → `data/geo/geo-0.1.0/manifests/sources.json`. Per-file checksums and access times: `manifests/assets.json` and `data/raw/geo/**/*.meta.json`. Written with AI assistance (Claude Code); licence wording must be re-checked against provider pages before submission (SUB-03).

| ID | Dataset | Provider | Body | Evidence | Native res. / CRS | Licence and required attribution | Citation |
|---|---|---|---|---|---|---|---|
| COP_GLO30 | Copernicus DEM GLO-30 Public (2021) | Copernicus / ESA / Airbus; AWS Open Data | Earth | observed (DSM) | 1″ (~30 m), EPSG:4326, EGM2008 m | Free with attribution (Copernicus DEM licence) | ESA & Sinergise (2021), doi:10.5069/G9028PQB |
| ESA_WC_V200 | ESA WorldCover 10 m 2021 v200 | ESA / WorldCover consortium | Earth | proxy (class fractions) | 10 m, EPSG:4326 | CC BY 4.0 | Zanaga et al. (2022), doi:10.5281/zenodo.7254221 |
| NASA_POWER_CLIM | NASA POWER climatology (MERRA-2 based), T2M, T2M_MAX, T2M_MIN, PRECTOTCORR | NASA LaRC POWER Project | Earth | modelled | 0.5° × 0.625° | NASA open data; acknowledge POWER Project | power.larc.nasa.gov |
| MACROSTRAT | Macrostrat geologic map units (API v2) | Macrostrat, UW-Madison + original map sources (recorded per AOI) | Earth | proxy (map category) | source map scale | CC BY 4.0 + original map attribution | Peters et al. (2018), doi:10.1029/2018GC007467 |
| PGDA_LOLA_5MPP | High-Resolution LOLA Topography, south-pole sites 01, 04, 07, 11, 20v2, 23 | NASA GSFC PGDA (product 78) | Moon | observed (laser altimetry) | 5 m, polar stereographic, R = 1737.4 km | NASA public; cite Barker et al. | Barker et al. (2021), PSS 203:105119, doi:10.1016/j.pss.2020.105119 |
| USGS_MARS_BLEND | MOLA–HRSC Blended DEM Global 200 m v2 | USGS Astrogeology; NASA MGS MOLA; ESA/DLR/FU Berlin HRSC | Mars | observed (blend) | 200 m posting, equirectangular, R = 3396.19 km | Public; credit HRSC to ESA/DLR/FU Berlin | Fergason, Hare & Laura (2018), USGS |

## Notes per source

- **Copernicus GLO-30** is a surface model: forest canopy and buildings are in the heights. Longitude spacing widens poleward of 50° (1.5″, 2″, 3″ …); mosaics use the finest spacing present with nearest selection, so no new values are created.
- **WorldCover** fractions are fractions of classified pixels in a 20 km UTM square after nearest-neighbour reprojection — area proxies with classification error, 2021 snapshot.
- **NASA POWER** values are **2 m air temperature and precipitation from a reanalysis-based climatology** for the 0.5° cell containing the AOI centre. They are not land-surface (skin) temperature, not in-situ observations, and not the conditions on a specific mission date. The climatology period is stored with every AOI (`quality/<aoi_id>.json → climate_meta.period`).
- **Macrostrat**: the most detailed scale returned at the AOI centre is used; the original map reference (authors, year, DOI) is stored per AOI. Lithology text is a map description, not spectroscopy.
- **PGDA**: Mons Mouton uses Site20v2 (Aug 2022 extended raster). Site01/04/07/11/23 centres are computed from each raster's extent centre, not typed in. Sites are ~20 km wide, so part of the 1 km margin can be nodata (visible as `dem_valid_frac`).
- **USGS Mars blend**: HRSC stereo where available, MOLA elsewhere; the effective resolution varies by location and is coarser than the 200 m posting where only MOLA contributes. It is never presented as one homogeneous native-resolution observation.

## Not used in this release

MODIS LST / snow, GPM IMERG, NASADEM (need Earth Engine credentials), ERA5-Land (needs CDS key), Landsat / Sentinel-2 spectra, HiRISE / CTX / THEMIS, planetary geologic maps, Diviner. See `docs/geo/UNAVAILABLE_AND_GAPS.md`.
