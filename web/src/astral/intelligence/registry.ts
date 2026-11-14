// EGIZ ASTRAL · model registry. Lists every inference component the product can name, with its real status.
// Nothing here is reported as available unless the code that runs it ships in this build.
import { CLASSIFIER, CRATER_DETECTOR, ROCK_DETECTOR } from "./perception.ts";

export type ModelStatus = "inference-ready" | "trains-in-session" | "download-required" | "not-configured" | "incompatible" | "experimental";
export interface ModelCard {
  id: string; name: string; task: string; architecture: string; trainingDomain: string; inputs: string[]; resolution: string;
  weights: string; version: string; license: string; hardware: string; memory: string; inference: string;
  status: ModelStatus; evaluation: string; limitations: string; runsOn: ("mars" | "moon" | "earth")[];
}
export const STATUS_LABEL: Record<ModelStatus, string> = {
  "inference-ready": "Inference ready", "trains-in-session": "Fits in session", "download-required": "Download required",
  "not-configured": "Not configured", incompatible: "Not applicable here", experimental: "Experimental",
};
export const MODELS: ModelCard[] = [
  { id: CLASSIFIER.id, name: "Geomorphometric terrain classes", task: "Terrain segmentation (shape and texture classes)", architecture: "Fixed-threshold rule baseline; no learned parameters",
    trainingDomain: "None (rules)", inputs: ["site elevation field", "orthoimage (optional)"], resolution: "8 m cells from 2 m elevation posts and 1 m imagery",
    weights: "none", version: "1", license: "project licence", hardware: "CPU, in browser", memory: "< 50 MB", inference: "web/src/astral/intelligence/perception.ts · classifyTerrain",
    status: "inference-ready", evaluation: "Unvalidated: no expert or field labels for this site were available.", limitations: CLASSIFIER.note, runsOn: ["mars", "moon", "earth"] },
  { id: "egiz-terrain-units-kmeans-v1", name: "Unsupervised terrain units and outliers", task: "Clustering, anomaly scoring, query-by-example retrieval", architecture: "Seeded k-means++ (k = 6) on six standardised terrain/image descriptors",
    trainingDomain: "The currently loaded site only; refitted each session", inputs: ["terrain feature grid"], resolution: "8 m cells",
    weights: "in memory (centroids exported in the mission dossier)", version: "1", license: "project licence", hardware: "CPU, in browser", memory: "< 50 MB", inference: "perception.ts · fitTerrainUnits / similarTo",
    status: "trains-in-session", evaluation: "Unvalidated: units are statistical groupings without geological labels; stability across seeds not assessed.",
    limitations: "Units have no geological meaning until an expert names them. Outliers are statistical, not discoveries. Not transferable between sites.", runsOn: ["mars", "moon", "earth"] },
  { id: CRATER_DETECTOR.id, name: "Crater candidates from elevation", task: "Surface-object detection (craters)", architecture: "Multi-radius circular depression and rim test",
    trainingDomain: "None (geometric rule)", inputs: ["site elevation field"], resolution: "2 m posts, radii 8–96 m", weights: "none", version: "1", license: "project licence",
    hardware: "CPU, in browser", memory: "< 20 MB", inference: "perception.ts · detectCraters", status: "inference-ready", evaluation: "Unvalidated against a crater catalogue.", limitations: CRATER_DETECTOR.note, runsOn: ["mars", "moon"] },
  { id: ROCK_DETECTOR.id, name: "Rock candidates from shadows", task: "Surface-object detection (boulders)", architecture: "Local-contrast shadow segmentation with sun-direction geometry",
    trainingDomain: "None (image-processing rule)", inputs: ["0.25 m orthoimage tiles", "image illumination azimuth from the shading fit"], resolution: "0.25 m/px; reliable above about 1.5 m diameter",
    weights: "none", version: "1", license: "project licence", hardware: "CPU, in browser", memory: "< 20 MB per tile", inference: "perception.ts · detectRocks", status: "inference-ready",
    evaluation: "Unvalidated against rover-derived rock counts.", limitations: ROCK_DETECTOR.note, runsOn: ["mars"] },
  { id: "egiz-shading-registration-v1", name: "Image–terrain shading fit", task: "Data-quality check and illumination estimate", architecture: "Linear least squares of brightness on terrain gradients with offset search",
    trainingDomain: "None", inputs: ["site elevation field", "orthoimage"], resolution: "2 m", weights: "none", version: "1", license: "project licence", hardware: "CPU, in browser", memory: "< 50 MB",
    inference: "perception.ts · fitShading", status: "inference-ready", evaluation: "Azimuth recovery verified on synthetic shaded surfaces in unit tests; not compared with image labels.", limitations: "Assumes near-Lambertian shading; albedo contrasts lower the fit. Elevation estimate is biased.", runsOn: ["mars", "moon", "earth"] },
  { id: "egiz-copilot-intent-v1", name: "Research copilot (local intent parser)", task: "Natural-language commands and evidence-grounded answers", architecture: "Deterministic pattern grammar that maps requests to typed, allow-listed tools; answers are composed from tool output",
    trainingDomain: "None", inputs: ["text", "current studio context"], resolution: "n/a", weights: "none", version: "1", license: "project licence", hardware: "CPU, in browser", memory: "negligible",
    inference: "intelligence/copilot.ts", status: "inference-ready", evaluation: "Parser covered by unit tests; no open-ended language understanding.", limitations: "Understands a fixed set of request shapes. It never writes free-form scientific prose and cannot answer outside its tools.", runsOn: ["mars", "moon", "earth"] },
  { id: "remote-llm", name: "Remote language model (optional)", task: "Free-form dialogue over the same typed tools", architecture: "Provider-neutral adapter interface (CopilotProvider)", trainingDomain: "Provider dependent", inputs: ["text", "tool schemas"], resolution: "n/a",
    weights: "external service", version: "—", license: "provider terms", hardware: "network", memory: "—", inference: "not implemented in this build", status: "not-configured",
    evaluation: "Not evaluated.", limitations: "No relay service or API key is configured. The studio does not depend on it.", runsOn: [] },
  { id: "ibm-nasa-prithvi-eo-2", name: "Prithvi-EO-2.0", task: "Earth-observation foundation model (segmentation, change)", architecture: "Vision transformer (masked autoencoder) on HLS time series", trainingDomain: "Earth: Harmonized Landsat–Sentinel-2, six bands, 30 m",
    inputs: ["HLS multispectral chips"], resolution: "30 m", weights: "Hugging Face ibm-nasa-geospatial (not downloaded)", version: "2.0", license: "Apache-2.0", hardware: "GPU recommended", memory: "several GB",
    inference: "not integrated", status: "incompatible", evaluation: "Not evaluated here.", limitations: "Trained on multispectral Earth imagery; it has no basis for single-band 0.25 m Mars orbital images and is not applied to them.", runsOn: [] },
  { id: "ibm-esa-terramind", name: "TerraMind", task: "Multimodal Earth-observation foundation model", architecture: "Any-to-any generative transformer", trainingDomain: "Earth: Sentinel-1/2, DEM, land cover (TerraMesh)",
    inputs: ["Sentinel-1", "Sentinel-2", "DEM"], resolution: "10 m", weights: "Hugging Face ibm-esa-geospatial (not downloaded)", version: "1.0", license: "Apache-2.0", hardware: "GPU recommended", memory: "several GB",
    inference: "not integrated", status: "incompatible", evaluation: "Not evaluated here.", limitations: "Earth sensors and scales only. A candidate for the Earth-analog side of EGIZ after a domain evaluation, not for planetary imagery.", runsOn: [] },
];
export const modelsFor = (body: "mars" | "moon" | "earth") => MODELS.map(card => ({ ...card, applicable: card.runsOn.includes(body) }));
