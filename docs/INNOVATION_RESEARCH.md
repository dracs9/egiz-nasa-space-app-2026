# Innovation review · 17–18 October 2026

Extends the existing [20 concepts](innovation/20_CONCEPTS.md), [evaluation](innovation/CONCEPT_EVALUATION.md), and [prior decision](innovation/FINAL_CONCEPT_DECISION.md); those planning records are retained. Scores below are engineering prioritization judgments, not measured originality or NASA judging scores.

## Primary-source comparison

| Tool / approach | Documented capability | Implication for EGIZ |
| --- | --- | --- |
| [NASA Planetary Analog Explorer](https://science.nasa.gov/solar-system/analog-explorer/) | Curated, side-by-side planetary/Earth image comparisons and field context | An attractive paired view alone is ordinary. EGIZ must expose metric comparisons and decisions. |
| [NASA analog research](https://science.nasa.gov/solar-system/planetary-analogs/) and [Arizona JETT/D-RATS](https://www.nasa.gov/humans-in-space/nasa-to-practice-artemis-moonwalking-roving-operations-in-arizona-desert/) | Task-specific field rehearsal, equipment and operational research | Missions require different analog properties. A DEM match cannot establish operational suitability. |
| [ESA PANGAEA](https://www.esa.int/Science_Exploration/Human_and_Robotic_Exploration/CAVES_and_Pangaea) | Geological field training | Terrain proxies do not replace lithology, process interpretation or expert instruction. |
| [Copernicus Browser / DEM services](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM) | Elevation observation, imagery and geospatial access | Data access and map layers are infrastructure rather than a novel scientific result. |
| [NASA PGDA lunar products](https://pgda.gsfc.nasa.gov/products/78) | DEMs, errors, slope products and uncertainty clones | Interpolation uncertainty matters; preference stability must not be advertised as DEM confidence. |

This review inspected the cited documented scopes; it is not an exhaustive survey of every software release. Multicriteria GIS, linear upper envelopes, terrain profiling and coverage optimization are established methods. The product-level distinction demonstrated here is a connected workflow from complementary test campaigns to exact priority switches and source-bound terrain/field evidence. No exclusive or first-ever capability is asserted.

## Twelve evaluated improvements

Scores 1–5. N=novelty, S=scientific value, R=NASA relevance, F=feasibility, D=demonstrability, E=evidence, W=memorable value, I=integration. Equal-weight total is a prioritization aid; feasibility and evidence constrain selection.

| Idea | N | S | R | F | D | E | W | I | Total | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Complementary test-site campaign | 3 | 5 | 5 | 5 | 5 | 4 | 5 | 5 | 37 | Retain existing core |
| Exact priority-switch frontier | 3 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 38 | Implement |
| Matched-scale terrain evidence + field checklist | 2 | 5 | 5 | 5 | 5 | 5 | 4 | 5 | 36 | Implement as one evidence workflow |
| Propagate PGDA clone errors into ranks | 4 | 5 | 5 | 2 | 4 | 4 | 5 | 5 | 34 | Future: acquire/review clone sets |
| Independent field-validation benchmark | 3 | 5 | 5 | 2 | 4 | 5 | 4 | 5 | 33 | Needs independent pairs and science review |
| Geologic process / lithology graph | 4 | 5 | 5 | 2 | 4 | 3 | 4 | 4 | 31 | Curated geology missing |
| Scale-response terrain spectra | 3 | 5 | 4 | 3 | 3 | 4 | 4 | 4 | 30 | Defer until effective-resolution study |
| Information-value sampling priorities | 4 | 5 | 4 | 2 | 3 | 3 | 4 | 4 | 29 | Requires calibrated error model |
| Global underrepresented-site hypotheses | 4 | 4 | 5 | 2 | 5 | 2 | 5 | 4 | 31 | No novelty inference from nine windows |
| Rover route / visibility planning | 3 | 4 | 5 | 2 | 5 | 2 | 5 | 3 | 29 | Obstacles, traction and access unobserved |
| Natural-light / snow calendar | 3 | 4 | 5 | 3 | 4 | 3 | 4 | 5 | 31 | Existing solar model retained; snow missing |
| Generative scientific assistant | 1 | 2 | 3 | 4 | 4 | 1 | 3 | 2 | 20 | Reject for this scope |

Selected system: **campaign complementarity + exact counterfactual priorities + verifiable terrain/field evidence**. The new capability explains a real model decision rather than adding a generic AI narrator. Its scientific value is transparency and reproducibility; external analog validity is still unproven.

## Competition evidence, not a winning formula

[NASA's 2025 winners announcement](https://www.nasa.gov/learning-resources/stem-engagement-at-nasa/nasa-announces-2025-international-space-apps-challenge-global-winners/) identifies SpaceGenes+ (Science), Resonant Exoplanets (Data), Twisters (Technology), and PureFlow (Mission Concept). They connect datasets or models to a specific decision. Our inference is to demonstrate one inspectable, useful calculation. Their awards do not validate EGIZ, establish a 2026 rubric or imply a likely win. The 2026 guides remain scheduled for 13 November according to the currently visible official FAQ.
