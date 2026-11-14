# ML open questions

Written with AI assistance (Claude Code); human review pending.

| # | Question | Why it matters | Current assumption | Who answers |
| --- | --- | --- | --- | --- |
| 1 | Add `.gitattributes` with `*.json -text` (or `eol=lf`)? | Windows checkouts with `core.autocrlf=true` change bytes and break SHA-256 bundle checks | Local `core.autocrlf=false` | Repo owner (root config) |
| 2 | Make `pipeline.engine.run._sun_for` public (or expose a `context_for(tile, target)` helper)? | ML re-scores with perturbed parameters and must pass the engine's exact context | Import of the private function; covered by the engine-equality test | Engine owner |
| 3 | Should `PR_JETT_SP_CRATER` (practice pool, a documented JETT3 analog) stay in the candidate pool used for evaluation? | A reference site inside the development pool can leak into Stage 2 validation | Kept in Stage 1 ranking, flagged by `pool: practice`; decide before pre-registration | Science lead |
| 4 | Profiles without a template: astronaut field training, surface equipment tests | Brief lists them; templates do not | Not added; profiles = existing objectives only | Science lead + engine owner |
| 5 | Climate source for Earth (and target temperatures) | O5 and M4 are uncomputable for every candidate | Reported as `not_available` | Geospatial engineer |
| 6 | Is a lockfile for Python 3.11 wanted? | `requirements-lock.txt` pins numpy 2.5.4 (Python ≥ 3.12) while `pyproject` says ≥ 3.11 | Installed from ranges | Repo owner |
| 7 | Frontend: where should ML results live in `web/public`? | Contract is DRAFT until the frontend adapter agrees | `artifacts/ml/discovery/` (ignored) + committed examples | Frontend owner |
| 8 | Perturbation sizes for ranking stability (sd 0.25 on log weights and widths) | Defines what "stable" means | Provisional; to be frozen in Stage 2 pre-registration | Science lead |
| 9 | May modelled `t2m_min_coldest_month_c` / POWER precipitation stand in for the spec's MODIS LST / IMERG attributes (as a labelled proxy), or must cold/dry objectives wait for LST? | O5 and M4 are non-computable for all 329 AOIs | Not substituted (geo interface says t2m is not LST) | Science lead |
| 10 | Should AOIs whose constraint values are unknown (`L1_dem`, no land cover) be excluded from ranking or just flagged? | They can rank high without a water/built check | Flagged (`operational_suitability: null`), not excluded — engine semantics kept | Science lead + engine owner |
| 11 | The 9 pilot AOIs have slightly different terrain values in geo-0.1.0 than in `data/pilot` (new 200 m / 50 m grids) | Two versions of "the same" site | ML uses whichever snapshot is selected; values are not mixed | Geo lead |
