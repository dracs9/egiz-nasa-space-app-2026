# Integration note → ML engineer (`pipeline/ml/`)

From: Geo lead · Dataset `geo-0.1.0`, schema `1.0.0` · Status: awaiting your ack before field freeze.

**Read:** `data/geo/geo-0.1.0/aoi_features.csv` (+ `aoi_features.columns.json`), `patch_index.csv`. Spec: `docs/GEOSPATIAL_DATA_INTERFACE.md`.

1. **Rows** = AOIs (one per physical site). Do not treat patches of one AOI as independent samples.
2. **Splits**: group by `group_id` (Earth 2°×2° blocks). Moon/Mars rows are reference targets (`pool = target | target_extra`), not training data.
3. **Missing** = empty cell; reasons in `aoi_catalog.json → missing`. Do not impute with 0. `not_comparable` means the variable does not exist on that body.
4. **Evidence**: `columns.json → evidence` per column (`derived`, `proxy`, `modelled`). `t2m_*` is modelled air temperature, not LST.
5. **Comparable across bodies**: only terrain families with the same baseline (e.g. `slope_r_*`, `relief_m`, `elev_std_m`, `slope_f100_*` exists for Earth and Moon; `slope_f400_*` for Earth and Mars).
6. **Rasters**: `patch_index.csv → asset_path` (GeoTIFF float32, NaN nodata, local metric CRS). Not committed; run `python -m pipeline.geodata features` to rebuild — checksums must match `sha256`.
7. Filter on `coverage_level` / `quality_status` rather than on column presence.
8. Parquet: not produced (no pyarrow dependency, DEC-025). Convert from CSV on your side if needed.

Requests back to Geo: name any column you need renamed/added *before* freeze; anything after freeze becomes `schema_version 1.1`.
