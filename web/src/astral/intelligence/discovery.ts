// EGIZ ASTRAL · discovery helpers: candidate science targets, structured hypotheses and the reference library.
// Everything returned here is a computational suggestion built from measured descriptors; nothing is a finding.
import type { XY } from "../world/field.ts";
import { cellAt, cellCentre, TERRAIN_CLASSES, type Crater, type FeatureGrid, type TerrainUnitModel } from "./perception.ts";

export interface ScienceTarget extends XY { id: string; kind: "crater-rim" | "descriptor-outlier" | "unit-contact"; score: number; reason: string; status: "computational suggestion" }
/** Rank places worth a closer look: fresh-looking crater rims, descriptor outliers and contacts between terrain units. */
export function scienceTargets(g: FeatureGrid, units: TerrainUnitModel, craters: Crater[], reachable: (p: XY) => boolean, count = 8, minSpacing = 60): ScienceTarget[] {
  const all: ScienceTarget[] = [];
  for (const c of craters) {
    const p = { x: c.x + c.radiusM * 1.15, y: c.y };
    all.push({ ...p, id: `target:rim:${c.id}`, kind: "crater-rim", score: 0.5 + Math.min(0.5, c.depthToDiameter * 4), status: "computational suggestion",
      reason: `Rim of a ${(c.radiusM * 2).toFixed(0)} m crater candidate (depth/diameter ${c.depthToDiameter.toFixed(2)}): impact rims expose material from depth.` });
  }
  for (let k = 0; k < units.anomaly.length; k++) {
    if (!(units.anomaly[k] >= units.anomalyThreshold)) continue;
    all.push({ ...cellCentre(g, k), id: `target:outlier:${k}`, kind: "descriptor-outlier", score: Math.min(1, 0.4 + units.anomaly[k] / 10), status: "computational suggestion",
      reason: `Terrain and image descriptors are ${units.anomaly[k].toFixed(1)}× farther from terrain unit ${units.assignment[k] + 1} than its typical cell.` });
  }
  for (let r = 2; r < g.side - 2; r += 2) for (let c = 2; c < g.side - 2; c += 2) {
    const seen = new Set<number>();
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) { const u = units.assignment[(r + dr) * g.side + c + dc]; if (u >= 0) seen.add(u); }
    if (seen.size >= 3) all.push({ ...cellCentre(g, r * g.side + c), id: `target:contact:${r * g.side + c}`, kind: "unit-contact", score: 0.3 + 0.15 * seen.size, status: "computational suggestion",
      reason: `${seen.size} terrain units meet within ${(5 * g.cellM).toFixed(0)} m: several surface types can be sampled from one stop.` });
  }
  all.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const kept: ScienceTarget[] = [];
  for (const t of all) { if (kept.length >= count) break; if (reachable(t) && !kept.some(o => Math.hypot(o.x - t.x, o.y - t.y) < minSpacing)) kept.push(t); }
  return kept;
}

export interface Hypothesis { id: string; status: "computational hypothesis"; observation: string; interpretation: string; support: string[]; counter: string[]; alternative: string; prediction: string; falsification: string; measurement: string; refs: string[] }
/** Structured, falsifiable hypotheses for one location, generated from its measured descriptors. */
export function hypothesesAt(g: FeatureGrid, classes: Uint8Array, units: TerrainUnitModel, craters: Crater[], p: XY): Hypothesis[] {
  const k = cellAt(g, p), out: Hypothesis[] = [];
  if (k < 0) return out;
  const [slope, rough, tpi, , texture, coherence] = g.values, cls = TERRAIN_CLASSES[classes[k]];
  const crater = craters.find(c => Math.hypot(c.x - p.x, c.y - p.y) <= c.radiusM * 1.3);
  if (crater) out.push({ id: `hyp:crater:${crater.id}`, status: "computational hypothesis",
    observation: `Closed circular depression ${(crater.radiusM * 2).toFixed(0)} m across and ${crater.depthM.toFixed(1)} m deep with a raised rim over ${(crater.rimFraction * 100).toFixed(0)}% of its circumference (2 m elevation posts).`,
    interpretation: crater.depthToDiameter >= 0.1 ? "A comparatively well-preserved impact crater." : "A degraded or partly infilled impact crater.",
    support: [`Depth/diameter ${crater.depthToDiameter.toFixed(2)}; simple craters form near 0.2 and shallow as they degrade and fill.`, "Rim stands above the regional tilt on most azimuths."],
    counter: ["The stereo terrain model smooths features under about 4 m, so small-crater depth is underestimated.", "No ejecta or rim-material signature was tested; imagery was not used for this detection."],
    alternative: "A collapse pit, deflation hollow or an artifact of stereo matching in shadow.",
    prediction: "Sub-metre imagery should show a continuous raised rim and, if fresh, blocky ejecta within about one radius.",
    falsification: "No raised rim in independent imagery, or an elongated planform aligned with regional bedforms.",
    measurement: "Rover stereo or 0.25 m orbital image inspection of the rim; rock counts on the ejecta blanket.", refs: ["src:dtm", "ref:golombek2008"] });
  if (cls.key === "lineated") out.push({ id: `hyp:lineated:${k}`, status: "computational hypothesis",
    observation: `Image texture here is strongly aligned (structure-tensor coherence ${coherence[k].toFixed(2)}, texture ${texture[k].toFixed(1)} DN) on gentle ground (${slope[k].toFixed(1)}°, relief RMS ${rough[k].toFixed(2)} m).`,
    interpretation: "Aeolian bedforms (ripples or small transverse ridges) of loose sand.",
    support: ["Regular parallel brightness banding on smooth, low-slope ground is characteristic of wind-formed ripples in orbital images.", "Low metre-scale relief is consistent with sand cover rather than blocky rock."],
    counter: ["A single-band image cannot separate sand from lineated bedrock.", "Thermal inertia or grain-size data were not used."],
    alternative: "Parallel fractures or layered bedrock exposed edge-on.",
    prediction: "Crest spacing should be metres to tens of metres with consistent orientation over the patch; rover wheels would sink and slip more here than on adjacent ground.",
    falsification: "Close-range images showing coherent rock with no loose cover.",
    measurement: "Rover imaging of the surface; wheel-slip telemetry on a short test drive; orbital thermal-inertia data.", refs: ["src:ortho", "ref:wong", "ref:moore1987"] });
  if (cls.key === "rough" || (cls.key === "high" && rough[k] > 0.12)) out.push({ id: `hyp:blocky:${k}`, status: "computational hypothesis",
    observation: `Metre-scale relief RMS ${rough[k].toFixed(2)} m with topographic position ${tpi[k] >= 0 ? "+" : ""}${tpi[k].toFixed(1)} m relative to its surroundings.`,
    interpretation: "Exposed, fractured or blocky bedrock with little loose cover.",
    support: ["Rough, positive-relief ground tends to be erosion-resistant material.", "Roughness is measured from the elevation model, independent of image brightness."],
    counter: ["Stereo-matching noise also raises roughness; no per-pixel error map is published for this product."],
    alternative: "A field of boulders on loose material, or terrain-model noise in a low-texture area.",
    prediction: "Rock detections should cluster here and wheel sinkage should be near zero.",
    falsification: "Imagery showing smooth sand, or rough texture that does not persist between independent stereo pairs.",
    measurement: "Shadow-based rock mapping at 0.25 m; rover close-up imaging; abrasion or drill response.", refs: ["src:dtm", "ref:golombek2008"] });
  if (units.anomaly[k] >= units.anomalyThreshold) out.push({ id: `hyp:outlier:${k}`, status: "computational hypothesis",
    observation: `Descriptor distance ${units.anomaly[k].toFixed(1)}× the typical value for terrain unit ${units.assignment[k] + 1} (top 1% of the site).`,
    interpretation: "A surface whose combination of slope, roughness, position and image texture is rare at this site.",
    support: ["Outlier status is computed over all valid 8 m cells of the site."], counter: ["Rarity is not significance: image seams, shadows and terrain-model artifacts are common outliers."],
    alternative: "A data artifact (mosaic seam, saturated or shadowed pixels, stereo-matching error).",
    prediction: "The feature should appear in an independent image under different illumination.", falsification: "It is absent or different in an independent observation.",
    measurement: "Compare with a second orbital image; inspect the data-quality findings for this area.", refs: ["src:dtm", "src:ortho"] });
  return out;
}

export interface Reference { id: string; title: string; citation: string; url?: string; topics: string[]; statement: string }
/** Reference library used for citations. Statements are deliberately conservative paraphrases; consult the source before reuse. */
export const REFERENCES: Reference[] = [
  { id: "ref:bekker", title: "Pressure–sinkage relation", citation: "Bekker, M.G. (1969). Introduction to Terrain-Vehicle Systems. University of Michigan Press.", topics: ["sinkage", "bekker", "soil", "wheel", "terramechanics", "compaction"], statement: "Static sinkage follows p = (kc/b + kφ)·zⁿ; compaction resistance is the work of forming the rut." },
  { id: "ref:wong", title: "Terramechanics reference and soil tables", citation: "Wong, J.Y. (2008). Theory of Ground Vehicles, 4th ed. Wiley.", topics: ["sinkage", "slip", "traction", "soil", "sand", "wheel", "terramechanics", "drawbar"], statement: "Source of the rigid-wheel sinkage formula and the LETE dry-sand parameters used as a loose-sand analog." },
  { id: "ref:janosi", title: "Shear stress–displacement relation", citation: "Janosi, Z. & Hanamoto, B. (1961). Analytical determination of drawbar pull as a function of slip. Proc. 1st ISTVS Conf.", topics: ["slip", "traction", "shear", "drawbar", "thrust"], statement: "Tractive thrust rises with slip as H = (Ac + W·tanφ)[1 − (K/iℓ)(1 − e^(−iℓ/K))]." },
  { id: "ref:carrier1991", title: "Lunar regolith mechanical properties", citation: "Carrier, W.D., Olhoeft, G.R. & Mendell, W. (1991). Physical properties of the lunar surface. Lunar Sourcebook, ch. 9. Cambridge University Press.", topics: ["lunar", "moon", "regolith", "soil"], statement: "Nominal intercrater regolith values used for the lunar surface profile." },
  { id: "ref:moore1987", title: "Viking lander surface materials", citation: "Moore, H.J. et al. (1987). Physical properties of the surface materials at the Viking landing sites on Mars. USGS Professional Paper 1389.", topics: ["mars", "soil", "drift", "cohesion", "friction"], statement: "Cohesion and friction-angle estimates for drift, crusty-to-cloddy and blocky materials; the drift values set the conservative weak-surface profile." },
  { id: "ref:golombek2008", title: "Rock mapping from HiRISE shadows", citation: "Golombek, M.P. et al. (2008). Size-frequency distributions of rocks on the northern plains of Mars with special reference to Phoenix landing surfaces. J. Geophys. Res. 113, E00A09.", url: "https://doi.org/10.1029/2007JE003065", topics: ["rock", "boulder", "shadow", "hazard", "hirise"], statement: "Rocks larger than about 1.5 m are measured in HiRISE images by segmenting their shadows; rock height is commonly near half the diameter." },
  { id: "ref:stack2020", title: "Jezero geologic map (not loaded)", citation: "Stack, K.M. et al. (2020). Photogeologic map of the Perseverance rover field site in Jezero crater. Space Sci. Rev. 216, 127.", url: "https://doi.org/10.1007/s11214-020-00739-x", topics: ["geology", "geologic", "map", "unit", "jezero", "lithology"], statement: "Published photogeologic units of the landing region. This map is not part of the world package, so EGIZ shows no geological unit names." },
  { id: "ref:bell2022", title: "Landing-site coordinates", citation: "Bell, J.F. et al. (2022). Geological, multispectral, and meteorological imaging results from the Mars 2020 Perseverance rover in Jezero crater. Sci. Adv. 8, eabo4856.", url: "https://doi.org/10.1126/sciadv.abo4856", topics: ["landing", "coordinates", "jezero", "perseverance"], statement: "Octavia E. Butler landing site at 18.4446°N, 77.4509°E, used as the site origin." },
  { id: "ref:m2020", title: "Mars 2020 rover public figures", citation: "NASA/JPL. Mars 2020 Perseverance rover: fact sheets and mission pages.", url: "https://science.nasa.gov/mission/mars-2020-perseverance/", topics: ["rover", "perseverance", "mass", "wheel", "speed", "battery", "rtg", "power"], statement: "Published mass, wheel diameter, top speed, tilt capability and power-system figures used for the reference rover profile." },
  { id: "ref:spice", title: "SPICE geometry", citation: "Acton, C.H. (1996). Ancillary data services of NASA's Navigation and Ancillary Information Facility. Planet. Space Sci. 44, 65–70; NAIF generic kernels.", url: "https://naif.jpl.nasa.gov/naif/", topics: ["sun", "solar", "illumination", "spice", "time", "shadow"], statement: "Sun direction and flux at the site come from CSPICE with fingerprinted NAIF kernels; no analytic fallback is used." },
];
export function retrieve(query: string, limit = 3): Reference[] {
  const words = query.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  return REFERENCES.map(ref => ({ ref, score: ref.topics.filter(t => words.some(w => w.startsWith(t) || t.startsWith(w))).length })).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.ref);
}
