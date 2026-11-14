# Written with AI assistance (Claude Code); reviewed by: pending (Geo lead).
"""Source registry: every feature column points at one of these source IDs.

Licenses and citations follow docs/science/DATASET_SPECIFICATION.md section 6
and the providers' pages; see docs/DATA_SOURCES.md for the human-readable list.
"""

SOURCES = {
    "COP_GLO30": {
        "name": "Copernicus DEM GLO-30 Public",
        "provider": "Copernicus Programme / ESA / Airbus (AWS Open Data mirror)",
        "product_id": "Copernicus_DSM_COG_10 (GLO-30)", "version": "2021 release",
        "url": "https://registry.opendata.aws/copernicus-dem/",
        "access": "https://copernicus-dem-30m.s3.amazonaws.com/<tile>/<tile>.tif (public COG, HTTP range reads)",
        "license": "Copernicus DEM licence: free use with mandatory attribution "
                   "('produced using Copernicus WorldDEM-30 (c) DLR e.V. 2010-2014 and (c) Airbus Defence and "
                   "Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved')",
        "period": "TanDEM-X acquisitions 2011-2015", "body": "earth", "evidence_class": "observed",
        "kind": "digital surface model (includes vegetation/buildings)",
        "crs": "EPSG:4326 (horizontal), EGM2008 geoid heights (vertical), metres",
        "native_resolution": "1 arc-second (~30 m); longitude spacing widens poleward of 50 deg",
        "citation": "European Space Agency, Sinergise (2021). Copernicus Global Digital Elevation Model. "
                    "Distributed by OpenTopography/AWS. https://doi.org/10.5069/G9028PQB",
    },
    "ESA_WC_V200": {
        "name": "ESA WorldCover 10 m 2021 v200", "provider": "ESA / WorldCover consortium",
        "product_id": "ESA_WorldCover_10m_2021_v200", "version": "v200",
        "url": "https://esa-worldcover.org/",
        "access": "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ (public COG)",
        "license": "CC BY 4.0", "period": "2021", "body": "earth", "evidence_class": "observed",
        "kind": "land-cover classification (Sentinel-1/2 derived map)",
        "crs": "EPSG:4326", "native_resolution": "10 m (1/12000 deg)",
        "citation": "Zanaga, D. et al. (2022). ESA WorldCover 10 m 2021 v200. https://doi.org/10.5281/zenodo.7254221",
    },
    "NASA_POWER_CLIM": {
        "name": "NASA POWER climatology (MERRA-2 based)", "provider": "NASA Langley Research Center POWER Project",
        "product_id": "POWER Climatology API, community RE", "version": "API v2.x (recorded per response)",
        "url": "https://power.larc.nasa.gov/",
        "access": "https://power.larc.nasa.gov/api/temporal/climatology/point",
        "license": "Public (NASA open data); acknowledge the NASA POWER Project",
        "period": "climatology period stated in each response header (2001-2025 at time of access)",
        "body": "earth", "evidence_class": "modelled",
        "kind": "reanalysis-based near-surface (2 m) AIR temperature and corrected precipitation; "
                "NOT land-surface temperature",
        "crs": "EPSG:4326", "native_resolution": "0.5 x 0.625 deg (MERRA-2 grid)",
        "citation": "NASA Langley Research Center (LaRC) POWER Project, funded through the NASA Earth Science/Applied "
                    "Science Program. https://power.larc.nasa.gov/",
    },
    "MACROSTRAT": {
        "name": "Macrostrat geologic map compilation", "provider": "Macrostrat (UW-Madison) and cited map sources",
        "product_id": "API v2 geologic_units/map", "version": "API v2 (live; map source_id recorded per AOI)",
        "url": "https://macrostrat.org/", "access": "https://macrostrat.org/api/v2/geologic_units/map",
        "license": "CC BY 4.0 (plus attribution of the original map source)",
        "period": "compiled maps of differing publication dates", "body": "earth", "evidence_class": "proxy",
        "kind": "geologic map unit at the AOI centre (categorical; map scale varies by source)",
        "crs": "EPSG:4326", "native_resolution": "map scale of source (recorded)",
        "citation": "Peters, S.E., Husson, J.M., Czaplewski, J. (2018). Macrostrat: a platform for geological data "
                    "integration and deep-time Earth crust research. G-cubed 19. https://doi.org/10.1029/2018GC007467",
    },
    "PGDA_LOLA_5MPP": {
        "name": "High-Resolution LOLA Topography for Lunar South Pole Sites (5 m/px)",
        "provider": "NASA GSFC Planetary Geodesy Data Archive (PGDA)", "product_id": "PGDA product 78, Site<NN>",
        "version": "final_adj_5mpp_surf", "url": "https://pgda.gsfc.nasa.gov/products/78",
        "access": "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site<NN>/Site<NN>_final_adj_5mpp_surf.tif",
        "license": "Public (NASA); cite Barker et al. 2021", "period": "LRO LOLA 2009-2020",
        "body": "moon", "evidence_class": "observed",
        "kind": "laser-altimetry DEM (heights relative to 1737.4 km sphere)",
        "crs": "south polar stereographic, MOON_ME frame, sphere R=1737400 m", "native_resolution": "5 m",
        "citation": "Barker, M.K. et al. (2021). Improved LOLA elevation maps for south pole landing sites: error "
                    "estimates and their impact on illumination conditions. PSS 203, 105119. "
                    "https://doi.org/10.1016/j.pss.2020.105119",
    },
    "USGS_MARS_BLEND": {
        "name": "Mars MGS MOLA - MEX HRSC Blended DEM Global 200 m v2",
        "provider": "USGS Astrogeology (NASA MGS MOLA + ESA/DLR/FU Berlin Mars Express HRSC)",
        "product_id": "Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2", "version": "v2",
        "url": "https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m",
        "access": "https://planetarymaps.usgs.gov/mosaic/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif",
        "license": "Public (USGS/NASA); HRSC credit ESA/DLR/FU Berlin", "period": "MOLA 1997-2001; HRSC 2004-2016",
        "body": "mars", "evidence_class": "observed",
        "kind": "BLENDED DEM: HRSC stereo where available, MOLA gridded altimetry elsewhere; posted at 200 m, "
                "effective resolution varies by location and is coarser where MOLA-only",
        "crs": "equirectangular, sphere R=3396190 m", "native_resolution": "200 m posting (blend; not homogeneous)",
        "citation": "Fergason, R.L., Hare, T.M., Laura, J. (2018). HRSC and MOLA Blended Digital Elevation Model at "
                    "200m v2. USGS Astrogeology Science Center.",
    },
}


def registry():
    """Return the registry as a list sorted by source ID (for manifests/sources.json)."""
    return [{"source_id": key, **value} for key, value in sorted(SOURCES.items())]
