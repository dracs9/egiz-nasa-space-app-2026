// EGIZ ASTRAL Planetary World Core contracts. One representation is shared by the
// renderer, analysis tools, AI layer and simulator. Written with AI assistance (Claude).

export type EvidenceClass = 'measured' | 'model-detected' | 'computational-hypothesis' | 'illustrative' | 'assumed' | 'reference' | 'derived';

export interface Quantization { offset: number; scale: number }

export interface TileDescriptor {
  key: string; level: number; col: number; row: number;
  west: number; north: number; size: number; posting: number;
  minH: number; maxH: number; geometricErrorMax: number; geometricErrorRms: number;
  quantization: Quantization; sha256: string; bytes: number;
}

export interface GridLayer {
  file: string; cell: number; west: number; north: number; width: number; height: number;
  quantization?: Quantization; validFraction?: number; purpose?: string; modelId?: string;
}

export interface WorldManifest {
  schema: 'egiz.world_manifest'; version: string; synthetic: false;
  id: string; siteId: string; name: string; body: 'moon';
  referenceFrame: { body: string; shape: 'sphere'; radiusM: number; verticalDatum: string; mapProjection: string; worldFrame: string; originLonLat: [number, number] };
  source: { product: string; url: string; sha256: string; citation: string; nativePostingM: number; nativeCrs: string };
  pyramid: { footprintM: number; cells: number; apron: number; levels: number; fullLevels: number; operationalBox: [number, number, number, number]; postingsM: number[]; method: string; tiles: TileDescriptor[] };
  layers: { horizon: GridLayer; units: GridLayer };
  illumination: { file: string; samples: number; sunElevationDeg: { min: number; max: number }; earthElevationDeg: { min: number; max: number }; sunAboveHorizonFraction: number; maxElevationTime: number };
  objects: { file: string; craters: number; anomalies: number };
  perception: string; registry: string;
  evidenceClasses: Record<string, string>;
  missingData: string[];
}

/** Spatially addressable world object; identical ids are used by scene, map, inspector, simulator and evidence. */
export interface SceneObject {
  id: string; type: 'crater' | 'anomaly' | 'reference' | 'waypoint' | 'rover' | 'science-target';
  evidenceClass: EvidenceClass;
  x: number; y: number; lon: number; lat: number; radius: number;
  confidence: number | null;
  properties: Record<string, unknown>;
  provenance: { modelId: string | null; input: string; sourceSha256: string };
}

export interface IlluminationRecord {
  schema: 'egiz.world_illumination'; version: string; engine: string; frame: string; observer: string;
  epochUtc: string; step: number; duration: number; columns: string[];
  samples: number[][]; kernels: { name: string; sha256: string; url: string }[]; limitations: string[];
}

export interface UnitClass { id: number; label: string; descriptor: string; centroid: Record<string, number>; areaFraction: number; meanAssignmentMargin: number }
export interface PerceptionRecord {
  schema: 'egiz.world_perception'; version: string; seed: number;
  units: { modelId: string; layer: string; features: string[]; classes: UnitClass[]; inertiaPerSample: number; trainingSamples: number; meanAssignmentMargin: number };
  craters: { modelId: string; count: number; radiiTestedM: number[]; minScore: number; acceptance: Record<string, number> };
  anomalies: { modelId: string; count: number; d2Threshold: number; quantile: number };
  slope20Percentiles: Record<string, number>;
}

export type ModelStatus = 'available' | 'installed' | 'download_required' | 'inference_ready' | 'training_available' | 'experimental' | 'unavailable' | 'incompatible';
export interface ModelEntry {
  id: string; name: string; task: string; architecture: string; trainingDomain: string; inputs: string[];
  resolution: string; weights: string; version: string; license: string; hardware: string; memory: string;
  inference: string; status: ModelStatus[]; evaluation: string; limitations: string[];
  runtime?: 'python-build' | 'browser' | 'remote' | 'none';
}

export interface Raster { width: number; height: number; data: Float32Array | Uint8Array; west: number; north: number; cell: number }

/** Local map point: AEQD metres east (x) and north (y) of the site centre. */
export interface MapPoint { x: number; y: number }
