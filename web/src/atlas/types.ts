// ATLAS-Pi bundle contract (contracts/atlas_pi.schema.json). Written with AI assistance (Claude); human review pending.
export type Status = 'SUPPORTED' | 'CONDITIONAL' | 'WEAK' | 'NON_TRANSFERABLE' | 'UNKNOWN';
export type Kind = 'observed' | 'retrieved' | 'derived' | 'model' | 'curated' | 'assumed' | 'unknown';
export interface Side { value: unknown; unit?: string | null; kind: Kind; source: string; grade?: string; quality?: number }
export interface FactorRecord {
  factor: string; name: string; metric: string; tolerance: number; unit: string | null;
  match: number | null; ci: [number, number] | null; kind: Kind; quality: number;
  role: 'primary' | 'secondary'; weight: number; effective_resolution_m: number | null;
  earth: Side | null; target: Side | null; detail: Record<string, unknown>;
}
export interface PhysicsRecord {
  factor: string; name: string; role: 'primary' | 'secondary'; reproducible_in_field: 'yes' | 'partial' | 'no';
  corrections: string[]; correction_scope?: string | null; lab_alternatives: string[];
  earth: Side; target: Side;
}
export interface Cell {
  site: string; target: string; task: string; status: Status; reasons: string[];
  axes: { task_match: number | null; task_match_ci90: [number, number] | null; evidence_coverage: number; evidence_quality: number;
    resolution_sufficient: boolean; resolution_limited_factors: string[]; operational_relevance: number; physical_mismatch: string[] };
  factors: FactorRecord[]; physics: PhysicsRecord[]; constraints: { failed: { attr: string; observed: number; op: string; value: number }[]; unknown: string[] };
  limitations: string[]; explanation: string[]; counter_evidence: string[]; certificate: string;
}
export interface Task { id: string; name: string; bodies: string[]; description: string; required_resolution_m: number; min_evidence: number;
  factors: { factor: string; role: string; weight: number }[]; physics: Record<string, string>; limitations: string[] }
export interface Mission { id: string; target: string; name: string; task_weights: Record<string, number> }
export interface Requirement { id: string; task: string; factor: string; name: string; weight: number }
export interface Coverage { id: string; task: string; factor: string; name: string; best_site: string | null; lcb: number | null; status: Status | null; level: 'strong' | 'covered' | 'uncovered' }
export interface Portfolio { selected: string[]; objective: { J: number; coverage: number; redundancy: number }; covered?: number; strong?: number }
export interface Constellation {
  mission: string; target: string; k: number; parameters: Record<string, unknown>; requirements: Requirement[];
  lab_only_tasks: { task: string; weight: number; blocking: string[]; alternatives: string[] }[];
  selected: string[]; objective: Portfolio['objective']; greedy: Portfolio; baseline_topk_individual: Portfolio; baseline_general_similarity: Portfolio;
  contributions: { site: string; marginal_J: number; requirements_won: string[] }[];
  per_requirement: Coverage[]; uncovered: Coverage[]; covered: number; strong: number;
  pareto: { selected: string[]; coverage: number; evidence_quality: number; uncertainty: number; process_diversity: number }[];
}
export interface TerrainSummary { relief_m: number; traversable_lt15: number; source_pixel_m: number; slope: Record<string, { p10: number; p50: number; p90: number; hist: number[] }> }
export interface SiteRow { id: string; name: string | null; country: string | null; pool: string; lon: number; lat: number;
  process?: { tags: string[]; grade: string; source: string }; terrain: TerrainSummary }
export interface TargetRow { id: string; name: string; body: 'moon' | 'mars'; lon: number; lat: number; dem_product: string;
  process?: { tags: string[]; grade: string; source: string }; terrain: TerrainSummary }
export interface Measurement { id: string; name: string; instrument?: string; scale?: string; sampling?: string; effort?: string; expected_evidence?: string;
  limitations?: string; resolves: string[]; side: string; pair: string[] | null; evpi: number; evpi_relative: number | null;
  decision_change_probability: number; touched: boolean; status_flip_probability: Record<string, number>;
  per_site: { site: string; evpi: number; decision_change_probability: number }[] }
export interface Review { site: string; site_name: string; target: string; A_supporting: string[]; B_counter_evidence: string[]; C_hidden_assumptions: string[];
  D_scale_mismatch: string[]; E_physical_mismatch: string[]; F_alternative_explanation: string[]; G_sensitivity: string[]; H_next_evidence: string[] }
export interface Terramechanics { model: string; target_body: 'moon' | 'mars'; status: string; equations: string[]; findings: string[]; limitations: string[];
  inputs: { rover: Rover; soil: Soil }; cases: Record<'target' | 'earth_load_matched' | 'earth_mass_matched', TerraCase> }
export interface Rover { name?: string; mass_kg: number; wheels: number; wheel_diameter_m: number; wheel_width_m: number }
export interface Soil { name?: string; kc: number; kphi: number; n: number; phi_deg: number; c_pa: number }
export interface TerraCase { label: string; test_mass_kg: number; gravity: number; wheel_load_n: number; sinkage_m: number; compaction_resistance_n: number;
  contact_length_m: number; resistance_to_load: number; slope_limit_deg: number; sinkage_ratio_vs_target?: number; slope_limit_error_deg?: number }
export interface SolarProfile { body: string; daylight_fraction: number; elevation_daylight_quantiles: number[] | null; max_elevation_deg: number;
  mean_tracking_irradiance_wm2: number; mean_horizontal_irradiance_wm2: number; atmosphere: string; tau?: number }
export interface SolarCF { earth: SolarProfile; target: SolarProfile; limitations: string[];
  components: { geometry_daylight_median_elev_diff_deg: number | null; duration_daylight_fraction_diff: number; irradiance_tracking_ratio: number | null; irradiance_log10_ratio: number | null } }
export interface Hypothesis { id: string; verdict: string; criterion?: string; caveat?: string; reason?: string; [key: string]: unknown }
export interface GraphNode { id: string; type: string; label?: string; url?: string; sha256?: string; citation?: string; grade?: string; [key: string]: unknown }
export interface AtlasBundle {
  schema: 'egiz.atlas_pi'; version: string; synthetic: false; generated_at: string; engine: string; content_sha256: string;
  inputs: Record<string, string>; parameters: Record<string, unknown>;
  registry: { tasks: { tasks: Task[]; missions: Mission[]; factors: Record<string, { name: string; metric: string; tolerance: number | null; unit: string | null }>;
    status_rules: Record<string, unknown> }; physical: { factors: { id: string; name: string }[]; references: Record<string, string> };
    measurements: { measurements: unknown[] }; context: Record<string, unknown> };
  sites: SiteRow[]; targets: TargetRow[];
  tensor: { cells: Cell[]; general_similarity: Record<string, number | null> };
  certificates: Record<string, { id: string; claim: string; assumptions: string[]; uncertainty: string; evidence: string[]; reproducibility: { engine: string; command: string; inputs: Record<string, string> } }>;
  stability: Record<string, { nominal: Status; 'x0.5': Status; x2: Status; stable: boolean }>;
  constellations: Record<string, Record<string, Constellation>>;
  sensitivity: Record<string, { dirichlet: { draws: number; selection_frequency: Record<string, number>; median_jaccard: number };
    task_emphasis_x3: { task: string; selected: string[]; jaccard_vs_nominal: number }[] }>;
  counterfactual: { terramechanics: Record<'moon' | 'mars', Terramechanics>; solar: Record<string, SolarCF> };
  planner: Record<string, { measurements: Measurement[]; draws: number; method: string }>;
  redteam: Record<string, Review[]>;
  evidence_graph: { nodes: GraphNode[]; edges: { from: string; to: string; rel: string }[] };
  evaluation: { hypotheses: Hypothesis[]; controls: Hypothesis[]; ablations: { nominal_selected_k3: Record<string, string[]>;
    variants: Record<string, { status_changes?: number; selected_k3: Record<string, string[]>; selection_differs_from_nominal: Record<string, boolean> }> };
    robustness: { 'tolerance_x0.5_x2': { cells: number; stable: number; fraction_stable: number } } } | null;
  performance: Record<string, number>; limitations: string[]; dossiers: Record<string, string>;
  discovery?: Discovery | null;
}
export interface DiscoveryBlock { id: string; lon: number; lat: number; usable: boolean; relief_m?: number; coarse_match?: number; flag?: string | null; unusual?: boolean; terrain_family?: number }
export interface DiscoveryCandidate { id: string; lon: number; lat: number; recentred_deg: number; terrain: TerrainSummary; source: { url: string; product: string };
  nearest_catalog_site: string; nearest_catalog_km: number; category: string; coarse_match: number; unusual: boolean; missing: string[]; next_measurements: string[];
  cells: Record<string, { task: string; status: Status; reasons: string[]; axes: Cell['axes'] }[]> }
export interface Discovery { region: { name: string; lon: [number, number]; lat: [number, number] }; screen_target: string; method: Record<string, unknown>;
  provenance: Record<string, string>; failures: { id: string; reason: string }[]; performance: Record<string, number>; limitations: string[];
  screen_agreement: { spearman_coarse_vs_level2_route_match: number; n: number; mean_coarse_match: number; mean_level2_route_match: number; note: string } | null;
  level1_blocks: DiscoveryBlock[]; candidates: DiscoveryCandidate[] }
