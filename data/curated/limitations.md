# Research scope and missing evidence

- Mission weights, Gaussian scales, and thresholds are initial project research parameters from `docs/science/MATHEMATICAL_SPECIFICATION.md`; they are not NASA endorsements or validated requirements.
- Target surface-temperature fields are blank until a source specific to the selected location, sampling period, and definition is established. Generic Moon/Mars temperatures are not substituted. Their objective contributions remain missing.
- The lunar target coordinate is the inverse-projected center of the actual PGDA Site20 raster extent, not an official selected base location. Mons Mouton is a historical NASA candidate region. PGDA Site20 is 16 × 16 km; the extended Site20v2 is preferred for the 20 km analysis plus margin.
- A small real raster pilot proves acquisition and processing only. It does not implement the intended global, stratified ~3,000-tile experiment or establish a best Earth analog.
- Copernicus is a digital **surface** model. Buildings and vegetation can affect elevations. Surface-cover and environment observations cannot be inferred from a DEM.
- Missing environment and constraint context remain null. A campaign can have incomplete objective eligibility until MODIS, GPM, WorldCover, and snow products are acquired.
- The initial practice CSV has one potentially testable O2 site vicinity and an excluded artificial-light O4 case. This is insufficient for the preregistered E3 sample size. The coordinate is a documented nearby AZGS image viewpoint, not a JETT traverse. Do not report validation success.
- NOAA refraction assumes a standard atmosphere. Apparent position near the horizon depends on weather; astropy's horizon refraction approximation also degrades below 5 degrees. Precision must be reported at the measured altitude range.
- Low-Sun windows use all 2025 days, UTC day boundaries at longitude zero, and a 10-minute sample. They include apparent altitude, and exclude terrain horizon and cloud effects. Sampled circular span is below 360 degrees even for a complete apparent revolution.
- Shadows and renders use local DEM geometry with a finite margin. Lunar curvature, distant horizon, atmospheric scattering, and unresolved obstacles are not included.
- Terrestrial field tests do not reproduce reduced gravity, vacuum/thin atmosphere, space radiation, or planetary regolith properties. Gap alternatives are separate test methods, not claims of field equivalence.
- No competition organizer permission or preregistration commit is implied by these implementation files. The user's current instruction authorized implementation; historical task dates and competition gates remain as recorded.
