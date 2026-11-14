// EGIZ Planetary Studio · investigation record. One persistent research object that carries a question from
// discovery to simulation: target, priorities, candidates, the open site, marks, measurements, saved views,
// twin experiments and reviewed answers — with the dataset and software versions needed to reproduce it.
import type { XY } from '../../astral/world/field';
import { aggregate } from '../../discover/engine';
import type { ToolContext } from '../../discover/copilot';
import type { DiscoveryBundle } from '../../discover/types';
import type { LayerSet } from '../compute';
import type { IntelAnswer } from '../intel/engine';
import { ML_MODEL } from '../intel/ml';
import type { CameraPose } from '../render/terrainView';
import { BODY_LABEL, type Site } from '../terrain/site';
import { TRANSMISSION_NOTE } from '../terrain/solar';
import { TWIN_VERSION, type Experiment } from '../twin/twin';

export const INVESTIGATION_VERSION = '1.0.0';
export type MarkKind = 'landing' | 'science' | 'hazard' | 'note';
export const MARK_LABEL: Record<MarkKind, string> = { landing: 'Landing site', science: 'Science target', hazard: 'Hazard', note: 'Note' };
export const MARK_COLOR: Record<MarkKind, string> = { landing: '#e8c36a', science: '#7fc8b8', hazard: '#e0705c', note: '#c9c4b8' };
export interface MarkRecord extends XY { id: string; kind: MarkKind; label: string; h: number; lat: number; lon: number; siteKey: string; radiusM?: number }
export interface MeasureRecord { id: string; kind: 'distance' | 'profile' | 'area' | 'compare'; siteKey: string; points: XY[]; label: string; values: Record<string, number | null> }
export interface SavedView { id: string; name: string; siteKey: string; pose: CameraPose }
export interface StreamRef { id: string; name: string; lat: number; lon: number }
export interface Investigation {
  schema: 'egiz.investigation'; version: string; id: string; title: string; question: string; createdUtc: string; updatedUtc: string;
  target: string | null; profile: string; weights: Record<string, number> | null; candidates: string[];
  siteKey: string | null; streamed: StreamRef | null; marks: MarkRecord[]; measurements: MeasureRecord[]; views: SavedView[];
  experiments: Experiment[]; answers: IntelAnswer[]; notes: string;
  software: { investigation: string; twin: string; ml: string };
  // Expedition journey (optional and additive: records saved before the journey existed stay valid).
  /** The world the visitor chose to explore. */
  world?: 'moon' | 'mars';
  /** Ordered log of decisions, so the dossier can say what was chosen, when and why. */
  trail?: TrailEntry[];
  /** Summary of the last analysis run, enough to detect staleness and to verify a re-run reproduces it. */
  analysis?: AnalysisRecord | null;
  /** Planetary targets examined as alternatives to the investigated one. */
  considered?: string[];
  /** The visitor's stated conclusion, written in the dossier. */
  decision?: { text: string; utc: string } | null;
  /** Guided first journey: the furthest step reached and when the visitor first entered Mission Home. */
  journey?: { step: JourneyStep; reached: JourneyStep[]; homeUtc?: string | null };
  /** The planetary target the kept Earth candidates were ranked for (to flag them when the site changes). */
  analogsFor?: string | null;
  /** Display name of the mission site, so every surface can name it without loading the discovery index. */
  siteName?: string | null;
}
/** Steps of the guided expedition, in order (Mission Home follows the last one). */
export const JOURNEY_STEPS = ['explore', 'site', 'analysis', 'alternatives', 'analogs'] as const;
export type JourneyStep = typeof JOURNEY_STEPS[number];
export const isJourneyStep = (v: unknown): v is JourneyStep => (JOURNEY_STEPS as readonly unknown[]).includes(v);
export type TrailKind = 'world' | 'target' | 'profile' | 'analysis' | 'switch' | 'site' | 'candidate' | 'experiment' | 'decision';
export interface TrailEntry { utc: string; kind: TrailKind; text: string; ref?: string }
export interface AnalysisStepRecord { id: string; title: string; ms: number; summary: string; ok: boolean }
export interface AnalysisRecord {
  target: string; profile: string; weightsKey: string; ranUtc: string; bundleSha: string;
  /** Top-10 Earth windows in rank order; a re-run must reproduce exactly this list for the same inputs. */
  top10: string[]; verdict: string; steps: AnalysisStepRecord[]; findings: { severity: string; title: string; detail: string }[];
}
/** Stable key for a weight vector (sorted, 3 decimals) — identical weights give identical keys. */
export const weightsKey = (w: Record<string, number>) => Object.keys(w).sort().map(k => `${k}:${(w[k] ?? 0).toFixed(3)}`).join(',');
export function newInvestigation(title: string, nowUtc: string, id = `inv-${nowUtc.replace(/[^0-9]/g, '').slice(0, 14)}`): Investigation {
  return { schema: 'egiz.investigation', version: INVESTIGATION_VERSION, id, title, question: '', createdUtc: nowUtc, updatedUtc: nowUtc, target: null, profile: 'general', weights: null, candidates: [], siteKey: null, streamed: null, marks: [], measurements: [], views: [], experiments: [], answers: [], notes: '',
    software: { investigation: INVESTIGATION_VERSION, twin: TWIN_VERSION, ml: `${ML_MODEL.id} ${ML_MODEL.version}` } };
}
export const serializeInvestigation = (inv: Investigation) => JSON.stringify(inv, null, 2);
/** Validate an imported record. Rejects other schemas and versions rather than guessing at their meaning. */
export function parseInvestigation(text: string): Investigation {
  let v: Investigation; try { v = JSON.parse(text) as Investigation; } catch { throw new Error('The file is not valid JSON, so it is not an investigation record.'); }
  if (!v || v.schema !== 'egiz.investigation') throw new Error('This file is not an EGIZ investigation record.');
  if (v.version !== INVESTIGATION_VERSION) throw new Error(`This investigation was saved with version ${v.version}; this build reads ${INVESTIGATION_VERSION}.`);
  for (const k of ['marks', 'measurements', 'views', 'experiments', 'answers', 'candidates'] as const) if (!Array.isArray(v[k])) throw new Error(`The investigation record is incomplete (${k}).`);
  if (v.world !== undefined && v.world !== 'moon' && v.world !== 'mars') throw new Error('The investigation names an unknown world.');
  for (const k of ['trail', 'considered'] as const) if (v[k] !== undefined && !Array.isArray(v[k])) throw new Error(`The investigation record is malformed (${k}).`);
  if (v.journey !== undefined && (typeof v.journey !== 'object' || v.journey === null || !isJourneyStep(v.journey.step) || !Array.isArray(v.journey.reached))) throw new Error('The investigation record is malformed (journey).');
  return v;
}

/** Terrain and climate features of the discovery index used by the candidate-space model (measured columns only). */
export const FEATURES: { col: string; label: string; log?: boolean }[] = [
  { col: 'slope_f100_p50_deg', label: 'slope p50 (100 m)' }, { col: 'slope_f100_p90_deg', label: 'slope p90 (100 m)' }, { col: 'slope_f400_p50_deg', label: 'slope p50 (400 m)' },
  { col: 'relief_m', label: 'log relief', log: true }, { col: 'tri_f100_m', label: 'log ruggedness', log: true }, { col: 'elev_p50_m', label: 'median elevation' },
  { col: 'precip_annual_mm', label: 'log precipitation', log: true }, { col: 't2m_mean_annual_c', label: 'mean temperature' }, { col: 't2m_min_coldest_month_c', label: 'coldest-month minimum' },
];
export function candidateFeatures(b: DiscoveryBundle): { x: (number | null)[][]; lon: number[]; lat: number[] } {
  const cols = FEATURES.map(f => b.windows[f.col] as (number | null)[] | undefined);
  return { x: b.windows.id.map((_, i) => FEATURES.map((f, j) => { const v = cols[j]?.[i]; return typeof v !== 'number' || !Number.isFinite(v) ? null : f.log ? Math.log10(Math.max(1e-3, v)) : v; })), lon: b.windows.lon, lat: b.windows.lat };
}

const n = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d));
/** Markdown report generated from the live analysis state. Every number is read from a computed record. */
export function buildReport(inv: Investigation, ctx: { site: Site | null; layers: LayerSet | null; discovery: ToolContext | null; atlasVersion: string | null; generatedUtc?: string }): string {
  const { site: s, layers: l, discovery: d } = ctx, out: string[] = [];
  const push = (...lines: string[]) => out.push(...lines), table = (head: string[], rows: string[][]) => push(`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map(r => `| ${r.join(' | ')} |`), '');
  push(`# ${inv.title}`, '', `_EGIZ investigation ${inv.id} · created ${inv.createdUtc} · report generated ${ctx.generatedUtc ?? inv.updatedUtc}_`, '', '> Exploratory research record. Simulated quantities are not validated against field, test-bed or flight data. Human scientific review is pending.', '');
  push('## Research question', '', inv.question || '_No question was recorded._', '');
  if (inv.decision?.text) push('## Conclusion', '', inv.decision.text, '', `_Recorded ${inv.decision.utc}._`, '');
  if (inv.world) push(`- **World:** ${BODY_LABEL[inv.world]}`, '');
  const an = inv.analysis;
  if (an) {
    const stale = d ? an.target !== d.target.id || an.weightsKey !== weightsKey(inv.weights ?? d.weights) : false;
    push('## Site analysis', '', `Run ${an.ranUtc} for ${an.target}, profile "${an.profile}", discovery index \`${an.bundleSha.slice(0, 16)}\`. Critic verdict: **${an.verdict}**.${stale ? ' ⚠ The site or priorities changed after this run; it is out of date.' : ''}`, '');
    table(['Step', 'Time', 'Result'], an.steps.map(s => [s.title, `${s.ms} ms`, s.summary.replace(/\|/g, '/')]));
    push(`Top-10 Earth windows: ${an.top10.join(', ')}.`, '');
    if (an.findings.length) push(...an.findings.map(f => `- [${f.severity}] **${f.title}** — ${f.detail}`), '');
  }
  const alts = (inv.considered ?? []).filter(id => id !== inv.target);
  if (alts.length) push('## Alternatives considered', '', ...alts.map(id => `- ${id}`), '');
  push('## Selected regions', '');
  if (d) push(`- **Target:** ${d.target.name} (${d.target.id}, ${BODY_LABEL[d.target.body]}) at ${n(d.target.lat, 4)}°, ${n(d.target.lon, 4)}° — ${d.target.significance}`);
  if (s) push(`- **3D site:** ${s.name} (${s.id}, ${BODY_LABEL[s.body]}), ${n(s.lat, 4)}°, ${n(s.lon, 4)}°, ${((s.extent.east - s.extent.west) / 1000).toFixed(1)} km window`);
  push(inv.candidates.length ? `- **Earth candidates:** ${inv.candidates.join(', ')}` : '- **Earth candidates:** none selected', '');
  push('## Dataset provenance', '');
  if (s) table(['Item', 'Value'], [['Elevation product', s.provenance.product], ['Citation', s.provenance.citation], ['Native posting', `${s.provenance.nativePostingM.toFixed(1)} m`], ['Analysis grid', `${s.field.side} × ${s.field.side} posts at ${s.field.posting} m (${s.field.provenance})`], ['Vertical datum', s.provenance.verticalDatum], ['Local CRS', `\`${s.provenance.crs}\``], ['Delivery', s.provenance.delivery], ['SHA-256', s.provenance.sha256 ? `\`${s.provenance.sha256}\`` : 'not available'], ['Sun geometry', s.sunNote], ['Processing', s.provenance.method]]);
  if (d) push(`- Discovery index ${d.bundle.version}, content \`${d.bundle.content_sha256}\`, ${d.bundle.population.definition}.`);
  if (ctx.atlasVersion) push(`- ATLAS-Π transferability bundle ${ctx.atlasVersion}.`);
  push('', '## Methodology', '', '- Terrain layers (slope, aspect, roughness, curvature, topographic position) are computed from the analysis grid by central differences and plane-detrended residuals at the stated baselines.',
    '- Terrain shadow marches from each post toward the Sun through the occluder grid with a body-curvature term; solar energy is direct beam × declared transmission × cosine of incidence on the local surface.',
    '- Candidate ranking is a weighted geometric mean of per-dimension similarities with 90 % intervals (discovery engine); unmeasured dimensions are excluded and reported as coverage.',
    '- Mission simulation: A* routing on the measured grid, Bekker pressure–sinkage with Janosi–Hanamoto shear, static wheel-load transfer, ideal battery (deterministic; identical inputs give identical fingerprints).',
    `- Candidate-space model: ${ML_MODEL.kind}; validated by seed stability and a geographic block hold-out.`, '');
  push('## Assumptions', '');
  if (s) push(`- ${TRANSMISSION_NOTE[s.body]}`);
  push('- Soil parameters are literature profiles, never site measurements.', '- Vehicle parameters are scenario inputs, not specifications of a real rover.', '- Priority weights express mission preferences; they are not measured quantities.', ...new Set(inv.experiments.flatMap(e => e.model.assumptions).map(a => `- ${a}`)), '');
  push('## Results', '');
  if (l && s) { const m = l.summary; push('### Terrain', ''); table(['Quantity', 'Value', 'Evidence'], [['Relief', `${n(m.reliefM, 1)} m`, 'measured'], ['Elevation range', `${n(m.elevation.min, 1)} … ${n(m.elevation.max, 1)} m`, 'measured'], [`Slope p50 / p90 / p95 (${m.baselineM} m baseline)`, `${n(m.slope.p50)}° / ${n(m.slope.p90)}° / ${n(m.slope.p95)}°`, 'terrain-derived'], ['Roughness p50 / p95', `${n(m.roughness.p50, 2)} / ${n(m.roughness.p95, 2)} m`, 'terrain-derived'], ['Area below 15°', `${n(m.fractionBelow15 * 100, 0)} %`, 'terrain-derived'], ['Valid posts', `${n(m.validFraction * 100, 1)} %`, 'measured']]); }
  if (d && inv.candidates.length) {
    const a = aggregate(d.shard, inv.weights ?? d.weights); push('### Candidates', '');
    table(['Window', 'Fidelity (90 % interval)', 'Coverage', 'Evidence category', 'Country'], inv.candidates.map(w => { const i = d.bundle.windows.id.indexOf(w); return i < 0 ? [w, 'not in index', '—', '—', '—'] : [w, `${n(a.fidelity[i], 3)} (${n(a.lo[i], 3)}–${n(a.hi[i], 3)})`, `${n(a.coverage[i] * 100, 0)} %`, a.category[i], String(d.bundle.windows.country[i] ?? '—')]; }));
  }
  if (inv.measurements.length) { push('### Measurements', ''); table(['Measurement', 'Site', 'Values'], inv.measurements.map(m => [m.label, m.siteKey, Object.entries(m.values).map(([k, v]) => `${k} ${n(v, 2)}`).join('; ')])); }
  if (inv.marks.length) { push('### Marked locations', ''); table(['Kind', 'Label', 'Site', 'Lat, Lon', 'Elevation'], inv.marks.map(m => [MARK_LABEL[m.kind], m.label, m.siteKey, `${n(m.lat, 5)}°, ${n(m.lon, 5)}°`, `${n(m.h, 1)} m`])); }
  if (inv.experiments.length) {
    push('### Simulated missions (comparison)', '');
    table(['Experiment', 'Outcome', 'Distance', 'Duration', 'Energy used', 'Min battery', 'Peak slip', 'Gravity', 'Fingerprint'], inv.experiments.map(e => [e.name, e.summary.outcome, `${n(e.summary.distanceM, 0)} m`, `${n(e.summary.durationS / 3600, 2)} h`, `${n(e.summary.energyUsedWh, 0)} Wh`, `${n(e.summary.minBatteryWh, 0)} Wh`, `${n(e.summary.maxSlip * 100, 0)} %`, e.config.gravity === 'site' ? e.site.body : `${e.config.gravity} (counterfactual)`, `\`${e.fingerprint}\``]));
    for (const e of inv.experiments) { push(`**${e.name}** — ${e.explanation}`, '', ...e.routes.map(r => `- Route "${r.objective}": ${r.reason ?? `${n(r.lengthM, 0)} m, ${n(r.driveEnergyWh, 0)} Wh drive energy, max slope ${n(r.maxSlopeDeg)}°, risk exposure ${n(r.riskExposure, 0)}`}`), ...e.warnings.map(w => `- ⚠ ${w}`), ''); }
  }
  if (inv.answers.length) { push('### Reviewed findings', ''); for (const a of inv.answers) { push(`**Q: ${a.question}** — critic verdict: **${a.verdict}** (context: ${a.context})`, '', ...a.results.map(r => `- ${r.title}: ${r.summary}`), ...a.findings.map(f => `  - [${f.severity}] ${f.title}: ${f.detail}`), ''); } }
  push('## Uncertainty', '', '- Similarity intervals are 90 % Monte-Carlo intervals from the discovery engine; they cover feature uncertainty, not model-form error.', '- Elevation products carry no per-pixel error here; none is propagated into slope, shadow or simulation.', '- Simulation outputs have no uncertainty estimate; the one-at-a-time sensitivity analysis shows which inputs they depend on.', '');
  push('## Limitations', '', ...(s ? s.limitations.map(x => `- ${x}`) : []), '- Geometric and climatic resemblance is not functional analog suitability; transferability is task-specific (ATLAS-Π).', '- No geological map, composition, soil mechanics or thermal measurement is included unless listed above.', '');
  if (d) { const missing = d.bundle.dimensions.filter(x => d.target.dimension_status[x.id] !== 'measured'); push('## Recommended next measurements', '', ...(missing.length ? missing.map(x => `- **${x.label}** (${d.target.dimension_status[x.id].replace('_', ' ')})${x.integration_path ? ` — ${x.integration_path}` : ''}`) : ['- All similarity dimensions are measured for this target.']), '- Field verification of slope and roughness at the vehicle scale along any proposed route.', '- In-situ soil bearing and shear tests before treating simulated slip or sinkage as predictive.', ''); }
  push('## Reproducibility', '', `- Investigation schema ${inv.schema} ${inv.version}; twin ${inv.software.twin}; ML ${inv.software.ml}.`, ...(d ? [`- Priority profile "${inv.profile}"; weights ${JSON.stringify(inv.weights ?? d.weights)}.`, ...d.bundle.reproduce.map(c => `- \`${c}\``)] : []), ...inv.experiments.map(e => `- Experiment "${e.name}": site ${e.site.key} (${e.site.postingM} m, grid ${e.site.gridSide}), fingerprint \`${e.fingerprint}\`; re-run from the saved investigation to verify.`), '- Import the investigation JSON in the Planetary Studio to reopen this exact state.', '');
  if (inv.notes) push('## Notes', '', inv.notes, '');
  if (inv.trail?.length) push('## Investigation trail', '', ...inv.trail.map(e => `- ${e.utc} · ${e.text}`), '');
  return out.join('\n');
}
