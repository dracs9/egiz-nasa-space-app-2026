# ATLAS-Π limitations

Written with AI assistance (Claude); human review pending.

## Scientific

1. **Sample.** Nine purposive Earth windows and two targets, plus a regional Kazakhstan screen. This is not a global or representative sample.
2. **What the uncertainty covers.** Bootstrap intervals measure spatial sampling within a 20 km window. They do not include DEM vertical error, PGDA clone uncertainty, or co-registration error.
3. **Declared assumptions.** Tolerances, task–factor weights, status thresholds, process compatibility (1.0/0.2), λ/κ and planner priors are all declared, not measured. Statuses of 34% of cells change when tolerances are halved or doubled.
4. **Geology.** Process tags are categorical. Six of nine Earth windows and the lunar target are grade D (unverified). No mineralogy or lithology is inferred from DEMs.
5. **Missing environment.** Temperature, precipitation and snow are missing. HABITAT_LAYOUT and COLD_DRY_SURFACE are UNKNOWN everywhere, by design.
6. **Physics.** CF_TERRAMECHANICS is a Bekker model without gravity-dependent soil strength, and the direction of the transfer error is contested in the literature. CF_SOLAR has:
   - no terrain horizon;
   - Earth clear-sky values only, with no cloud;
   - a declared Mars optical depth;
   - irradiance only, not power.
7. **Scale.** No input resolves metre-scale hazards (rocks, boulders). Mars comparisons are limited by the 200 m nominal MOLA-HRSC grid.
8. **Discovery.** Candidates are computational. Land cover, water/built fraction and geology are not acquired for them, and literature novelty was not checked block by block.
9. **Validation.** No field validation of any recommendation exists. The hypothesis criteria are not formally preregistered.
10. **Learned representations.** None (H6 not run).

## Engineering

- Mars gravity is 3.73 m/s² in ATLAS-Π (current NSSDCA value) but 3.71 in the existing Mission Lab environment. This was not changed, to avoid modifying another module; reconcile it separately.
- The interactive counterfactual covers terramechanics only. Solar values in the UI are precomputed at τ = 0.5.
- The bundle is 1.8 MB (lazy loaded only on `#/atlas`). The evidence graph is serialised in full.
- The UI is partially translated into Russian (headings and labels). Generated scientific text stays in English.
- The planner uses perfect-information EVPI with other uncertain components held at their current state; this is a first-order approximation, not nested Monte Carlo.
