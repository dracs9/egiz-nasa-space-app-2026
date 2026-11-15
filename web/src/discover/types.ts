// Contract of data/discovery/discovery.json and scores/<target>.json (pipeline/discovery/bundle.py).
// Written with AI assistance (Claude); human review pending.
export type Body = 'moon' | 'mars';
export type DimStatus = 'measured' | 'missing' | 'not_assessed' | 'not_applicable';
export type Category = 'strong' | 'weak' | 'missing_driven';

export interface Dimension {
  id: string; label: string; group: string; method: string; weight: number; applies_to: string[];
  status_default: 'measured' | 'not_assessed'; reason: string; integration_path: string;
  bodies_not_applicable: Record<string, string>;
}
export interface DimScore { s50: number | null; lo: number | null; hi: number | null; status: DimStatus; percentile: number | null }
export interface Explanation { kind: string; text: string; dimension?: string; value?: number | null; percentile?: number | null }
export interface GapRow {
  key: string; parameter: string; unit: string; target_value: unknown; earth_value: unknown; difference: number | null;
  ratio_earth_to_target: number | null; measurable: boolean; earth_evidence: string; target_evidence: string;
  source: string; uncertainty: string; relevance: string[]; alternative: string | null; note: string;
}
export interface RoverCase { label: string; slope_limit_deg: number; sinkage_mm: number; traversable_frac: number; climbing_energy_j_per_m: number | null }
export interface RoverExperiment {
  model: string; status: string; window: string; body: Body; baseline_m: number;
  rover: Record<string, number | string>; soil: Record<string, number | string>;
  cases: Record<'target' | 'earth_load_matched' | 'earth_mass_matched', RoverCase>;
  deltas: Record<'earth_load_matched' | 'earth_mass_matched', { d_slope_limit_deg: number; d_traversable_frac: number; sinkage_ratio: number | null; energy_ratio: number | null }>;
  assumptions: string[]; limitations: string[]; references: string[];
  /** Which outputs depend on this window (window) and which only on gravity, rover and soil (body). */
  levels?: { body: string[]; window: string[]; body_label: string; note: string };
  soil_reused_from_moon?: boolean; soil_note?: string | null;
}
/** Window-independent rover terramechanics, reported once per body (pipeline.discovery.rover.body_rover_model). */
export interface RoverBodyModel {
  level: 'body'; label: string; body: Body; status: string; model: string;
  rover: Record<string, number | string>; soil: Record<string, number | string>;
  soil_reused_from_moon: boolean; soil_note: string | null; note: string;
  cases: Record<'target' | 'earth_load_matched' | 'earth_mass_matched', { label: string; slope_limit_deg: number; sinkage_mm: number }>;
  deltas: Record<'earth_load_matched' | 'earth_mass_matched', { d_slope_limit_deg: number; sinkage_ratio: number | null }>;
  limitations: string[]; references: string[];
}
export interface ShortlistEntry {
  window: string; rank: number; score: number; fidelity: number; lo: number; hi: number; coverage: number;
  category: Category; score_percentile: number | null; dims: Record<string, DimScore>; explanation: Explanation[];
  gaps: GapRow[] | null; rover: RoverExperiment | null; geology_classes: string[];
  /** Present on on-demand point results (pipeline.discovery.point). */
  name?: string;
}
export interface BenchmarkResult { site: string; role: string; window: string; status?: string; rank?: number; score?: number; score_percentile?: number | null; coverage?: number; category?: Category; target_body_match?: boolean }
export interface FingerprintFeature { value: unknown; unit: string; sigma: number | null; evidence: string; source: string }
export interface TargetEntry {
  id: string; body: Body; name: string; kind: string; lon: number; lat: number; significance: string;
  coordinate_reference: string; fine_baseline_m: number; dem: string;
  fingerprint: Record<string, Record<string, FingerprintFeature>>;
  dimension_status: Record<string, DimStatus>; target_slope_cdf: number[];
  shortlist: ShortlistEntry[]; benchmark: BenchmarkResult[]; shard: string; n_scored: number; n_strong_evidence: number;
}
export interface BenchmarkSite { id: string; name: string; lon: number; lat: number; role: string; bodies: string[]; aspects: string[]; program: string; reference: string; pilot_aoi: string | null; notes: string[] }
export type Columns = Record<string, (number | string | boolean | null | string[])[]>;
export interface DiscoveryBundle {
  schema: 'egiz.discovery'; version: string; synthetic: false; content_sha256: string; generated_at: string;
  inputs: { geo_release: { path: string; sha256: string }; index: { path: string; sha256: string | null; n_windows: number | null; failures: Record<string, number> | null; sources: Record<string, unknown>[] }; draws: number; seed: number };
  population: { definition: string; n: number };
  dimensions: Dimension[];
  profiles: Record<string, { label: string; weights: Record<string, number> }>;
  constants: {
    body: Record<'earth' | Body, { g_m_s2: number; obliquity_deg: number; day_h: number; solar_constant_w_m2: number; pressure_pa: number; atmosphere: string; magnetic_field: boolean; source: string }>;
    thermal_reference: Record<Body, { min_k: number; max_k: number; quantity: string; scope: string; source: string }>;
    radiation: Record<'earth' | Body, { msv_per_day: number; scope: string; source: string }>;
    tau: Record<string, number>; geology_classes: Record<string, string>;
  };
  windows: Columns & { id: string[]; name: string[]; lon: number[]; lat: number[]; pool: string[]; in_population: boolean[] };
  targets: TargetEntry[];
  rover_body_level?: Partial<Record<Body, RoverBodyModel>>;
  unavailable_targets: { id: string; reason: string }[];
  benchmark_sites: BenchmarkSite[];
  reproduce: string[];
}
export interface ScoreShard {
  schema: 'egiz.discovery_scores'; version: string; target: string; dims: string[]; status_codes: DimStatus[];
  s50: (number | null)[][]; lo: (number | null)[][]; hi: (number | null)[][]; status: number[][]; w1_deg: (number | null)[];
}
/** Bare, arid, latitude-matched negative control (pipeline.discovery.validation.evaluate_hard_negative). */
export interface HardNegative { definition: string; n_hard_negative: number; n_per_positive: number[]; n_positive_matched: number; auc: number | null; auc_90ci: number[] | null }
export interface ValidationTarget {
  target: string; body: Body; positives: string[];
  metrics: { [k: string]: number | number[] | null | HardNegative | undefined; hard_negative?: HardNegative };
  per_positive: { site: string; window: string; aspects: string[]; score: number; percentile: number }[];
  ablation_auc_without: Record<string, number>;
  sensitivity: { auc_p05_p50_p95: number[]; top10_jaccard_p05_p50_p95: number[] };
  reproducibility: { spearman_seed_2026_vs_7: number; top10_identical: boolean };
}
export interface ValidationDoc { schema: 'egiz.discovery_validation'; population: string; draws: number; targets: ValidationTarget[]; caveats: string[]; generated_at: string }
