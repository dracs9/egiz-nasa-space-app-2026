# Implemented scientific method · 18 October 2026

**20 October addition:** [engineering and transfer equations](ENGINEERING_EVOLUTION.md) describe the new regional quasi-static mobility model, real CSPICE geometry, mission-aware experimental coverage and benchmark protocol. They supplement the existing observed-terrain fidelity method; neither method is externally validated or a mission-success probability.

This supplement describes the implemented pilot and new evidence tools. Existing model definitions remain in [MATHEMATICAL_SPECIFICATION](science/MATHEMATICAL_SPECIFICATION.md); acquisition details remain in [REAL_DATA_GUIDE](engineering/REAL_DATA_GUIDE.md). None of the numeric preference tolerances has been externally validated.

## Observations and spatial conventions

| Input | Actual pilot product | Spatial / reference convention |
| --- | --- | --- |
| Moon | [NASA PGDA Site20v2 LOLA](https://pgda.gsfc.nasa.gov/products/78), 5 m pixels | Native south polar stereographic, MOON_ME DE421; local AEQD on 1,737,400 m sphere. The analysis center is the prior Site20 raster extent center, not an official base selection. |
| Mars | [USGS MOLA–HRSC blended DEM 200 m v2](https://planetarymaps.usgs.gov/mosaic/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif), cached Jezero subset | Native planetary geographic CRS retained in evidence; local AEQD on 3,396,190 m sphere. Product elevations retain their planetary reference; no Earth datum conversion is asserted. |
| Earth | [Copernicus GLO-30 Public 2021 COGs](https://registry.opendata.aws/copernicus-dem/), nine windows | WGS84 geographic source, local UTM. Orthometric EGM2008 heights per [provider specifications](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM). DSM includes vegetation and structures; it is not bare-earth terrain. |

The source registry and actual downloaded-raster hashes are retained. Code's MIT license does not relicense source datasets. Copernicus's free license includes attribution obligations; see [data notice](engineering/REAL_DATA_GUIDE.md#copernicus-attribution). PGDA provides scientific citation information; site-specific redistribution and publication obligations should be reviewed before an external release. No remote publication occurred.

Planetary latitudes/longitudes are not transformed through Earth WGS84. Reprojection uses each raster's native CRS and the documented body radius. Absolute Earth and planetary elevation values are never interpreted as a shared datum. Within-window slopes, relief and centered profiles can be compared subject to source error and sampling limitations.

## Sampling and feature computation

Nine deliberately chosen regional windows include S P Crater vicinity, Death Valley, Mangystau, Atacama, Utah, Iceland, Wadi Rum, Rio Tinto and Boszhira. Coordinates are exact in `data/pilot/earth_manifest.csv`; regional names identify sampled windows, not validated analogs, expedition destinations or proven new discoveries. No representative/global sampling claim is made. Two windows are in Kazakhstan.

Every source is read with an 11 km half-width, then averaged onto local metric grids. A separate validity reprojection prevents nodata from being averaged away. Fine terrain uses a 10 km core and central differences at 100 m (50 m pixels, lunar comparison) or 400 m (200 m pixels, Mars comparison). Regional slopes use a 2 km baseline over a 20 km core. **As corrected this session, all regional attributes use 200 m pixels on Earth and both planetary targets.** This supersedes the earlier lunar computation of regional metrics on 50 m pixels.

Slope = degrees(atan(hypot((z[x+o]−z[x−o])/(2op), (z[y+o]−z[y−o])/(2op)))). The center and stencil samples must be finite. Fractions count only valid slope samples. TRI is mean absolute difference from eight neighbors, then median over the fine core. Relief is P95−P5 elevation over the regional core. Less than 50% finite regional core produces null attributes. Measurement uncertainty is not inferred from valid-pixel fraction.

Matching grids does not match effective source resolution, interpolation errors or measurement physics. PGDA documents extensive interpolation in its high-resolution products. No per-site PGDA uncertainty clones, Copernicus height-error maps or vegetation correction have been propagated in this pilot.

## Objective scoring and campaign search

Attribute scores use the declared Gaussian/log-Gaussian or threshold functions; the objective combines known weighted terms geometrically, with explicit missing-weight and suitability rules. Those are transparent modeling choices, not a validated physical probability. Unknown context leaves objectives partial. Missing objective scores receive no credited coverage while remaining in the mission-weight denominator. Null ceilings stay null; they are distinct from a measured zero.

Campaign coverage is the weighted sum of each objective's best selected-site fidelity. Exact shortlist search is checked against greedy selection over the full pool. The pilot's nine eligible windows fit entirely into the shortlist; larger pools are not guaranteed a full global optimum. Controls are excluded from all recommendations.

## Land-cover admission and context

[ESA WorldCover 2021 v200](https://esa-worldcover.org/en/data-access), CC BY 4.0, is read in credential-free 3° COG tiles. A 20 km local UTM square is sampled with nearest-neighbor categorical reprojection at 10 m. Fractions are calculated over recognized classified pixels; less than 99% valid coverage aborts acquisition. Categorical codes are never averaged as elevations. Class 60 is bare ground; 10/40/50/70/80 supply tree/crop/built/snow-or-ice/permanent-water context. Annual mapped snow/ice is not the monthly operational snow-free fraction.

The acquisition report records source URLs, hashes and fractions. The original coastal Kazakhstan window has mapped water fraction 0.958658, exceeding every template's 0.5 limit; it is retained transparently for inspection but cannot enter a campaign. This resolves a false terrain-only match. WorldCover errors and temporal change are not modeled as certainty. Climate and target temperatures remain unavailable.

## Exact counterfactual preference frontier

For two selected objectives A and B, candidate e has line `s_e(t) = (1−t) F_A(e) + t F_B(e)`, 0≤t≤1. Missing terms receive no credit and remain visibly null. Candidates with neither score are excluded; candidates without any assessed active weight are excluded from the instantaneous ranking. The upper envelope is computed with slope sorting and a monotone hull in O(n log n). Parallel lines retain the higher intercept, then lexical ID. Switches are analytic intersections, not slider samples. At a boundary, instantaneous ties use lexical ID; interval ownership describes open interiors. Zero-width winners have no displayed interval.

These intervals are **preference sensitivity for fixed scores**, not confidence intervals, robustness to DEM error or probabilities that a site is best. Applying a scenario sets the same two weights in the campaign engine and uses a one-site budget. Export records actual scores, exact intervals, source input hashes, target, geography and synthetic status.

## Evidence and field-plan products

`pipeline.common.evidence` builds 25×25 surfaces with 800 m display cells from full grids; every source sample in a display cell must be finite. The 10 km west-to-east profile follows the central row, half a pixel south of the center on the even-sized grid. Profiles retain metric sample positions; the UI subtracts each profile's own mean and uses shared vertical axes. Vertical and horizontal display scales differ and are disclosed. Surface colors normalize separately per window. Slope histograms use fixed edges 0,1,2,5,10,15,20,30,45,60,90 degrees and expose valid/missing counts.

Terrain evidence carries raw hashes, exact URLs, CRS and candidate/target fingerprints. It is lazily loaded and rejected if stale. Missing cells and profile gaps remain visible. Display products do not feed the ranking algorithm.

The Markdown field checklist carries source hashes, observed values, unavailable inputs, independent measurement tasks and unassessed access/permit/safety questions. It supplies no routes, access guarantees or invented field results. Gravity, atmosphere, radiation, thermal cycling, regolith mechanics and rock composition remain outside demonstrated terrain equivalence.
