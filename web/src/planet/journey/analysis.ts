// EGIZ Expedition · the site analysis. A fixed sequence of real computations over the measured discovery index,
// the candidate-space model, the gap ledger, the published-analog validation, ATLAS-Π and the independent critic.
// Every step is executed when the visitor runs it; its wall-clock time is measured, never simulated, and every
// number in a summary is read from the step's own output. Findings are written from those outputs by fixed rules.
import type { AtlasBundle, Status } from '../../atlas/types';
import type { ToolContext } from '../../discover/copilot';
import { aggregate, gapLedger, type Aggregate } from '../../discover/engine';
import type { DiscoveryBundle, ScoreShard, TargetEntry, ValidationDoc } from '../../discover/types';
import { callIntel, rankingStability, review, type Finding, type IntelContext } from '../intel/engine';
import { fitCandidateSpace, ML_MODEL, type CandidateSpace } from '../intel/ml';
import { candidateFeatures, FEATURES, weightsKey, type AnalysisRecord } from '../workspace/investigation';

export type Evidence = 'measured' | 'derived' | 'model' | 'curated' | 'literature' | 'missing';
export interface StepFact { label: string; value: string; evidence: Evidence }
export interface StepOutput { ok: boolean; summary: string; facts: StepFact[]; detail?: string[] }
export interface StepResult extends StepOutput { id: StepId; ms: number }
export type StepId = 'fingerprint' | 'aggregate' | 'stability' | 'space' | 'gaps' | 'validation' | 'transfer' | 'review';
export interface AnalysisInput { bundle: DiscoveryBundle; target: TargetEntry; shard: ScoreShard; weights: Record<string, number>; profile: string; validation: ValidationDoc | null; atlas: AtlasBundle | null; space: CandidateSpace | null }
/** Mutable scratch shared by consecutive steps of one run. */
export interface RunState { agg?: Aggregate; order?: number[]; space?: CandidateSpace; findings?: Finding[]; verdict?: string; stability?: ReturnType<typeof rankingStability> }

export const STEPS: { id: StepId; title: string; method: string; data: (i: AnalysisInput) => string }[] = [
  { id: 'fingerprint', title: 'Read the site fingerprint', method: 'Terrain statistics derived from the elevation model at fixed baselines; literature values where nothing is measured', data: i => `${i.target.dem} · discovery index ${i.bundle.version}` },
  { id: 'aggregate', title: 'Score every Earth window', method: 'Weighted geometric mean of per-dimension similarities with Monte-Carlo 90 % intervals; unmeasured dimensions excluded and reported as coverage', data: i => `${i.bundle.windows.id.length.toLocaleString('en')} windows · Copernicus GLO-30, ESA WorldCover, NASA POWER, Macrostrat` },
  { id: 'stability', title: 'Stress-test the ranking', method: 'Halve and double each active priority weight; measure how much of the top-10 survives (Jaccard) and whether the leader separates from ranks 2–6', data: i => `${Object.values(i.weights).filter(w => w > 0).length} active weights · ${i.profile} profile` },
  { id: 'space', title: 'Map the candidate space (machine learning)', method: `${ML_MODEL.kind}: standardised terrain and climate features, PCA, k-means++ (k by silhouette), Mahalanobis outliers, geographic block hold-out`, data: () => `${FEATURES.length} measured features per window` },
  { id: 'gaps', title: 'Find where the analogy breaks', method: 'Gap ledger: parameter-by-parameter difference between the leading Earth window and the target, including gravity, pressure, light and temperature', data: i => `${i.target.id} vs leading window` },
  { id: 'validation', title: 'Check against published analog sites', method: 'How highly the method ranks Earth sites where real analog campaigns were run (AUC with bootstrap 90 % interval)', data: i => i.validation ? `validation set · ${i.validation.draws} draws` : 'validation file not packaged' },
  { id: 'transfer', title: 'Ask what transfers, task by task (ATLAS-Π)', method: 'Rule-based transferability per mission task: SUPPORTED, CONDITIONAL, WEAK, NON_TRANSFERABLE or UNKNOWN', data: i => i.atlas ? `ATLAS-Π ${i.atlas.version}` : 'ATLAS-Π bundle not packaged for this data mode' },
  { id: 'review', title: 'Independent review', method: 'The critic re-derives support from the workspace state and can reject a recommendation (ties, instability, missing evidence, unverified geology)', data: () => 'all outputs above' },
];

const f = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d));
const pct = (v: number) => `${Math.round(v * 100)} %`;
const name = (b: DiscoveryBundle, i: number) => `${b.windows.name[i]}${b.windows.country[i] ? ` (${b.windows.country[i]})` : ''}`;

export function discoveryContext(i: AnalysisInput, selected: string | null = null): ToolContext {
  return { bundle: i.bundle, target: i.target, shard: i.shard, weights: i.weights, selected, compare: [], validation: i.validation };
}

/** Execute one step synchronously and time it. Steps read earlier results from `st`. */
export function runStep(id: StepId, inp: AnalysisInput, st: RunState): StepResult {
  const t0 = performance.now(); let out: StepOutput;
  try { out = compute(id, inp, st); } catch (e) { out = { ok: false, summary: `This step failed: ${e instanceof Error ? e.message : String(e)}`, facts: [] }; }
  return { id, ms: performance.now() - t0, ...out };
}

function compute(id: StepId, inp: AnalysisInput, st: RunState): StepOutput {
  const { bundle: b, target: t, shard } = inp;
  if (id === 'fingerprint') {
    const feats = Object.values(t.fingerprint).flatMap(g => Object.values(g)), byEv = (e: string) => feats.filter(x => x.evidence === e).length;
    const measured = b.dimensions.filter(d => t.dimension_status[d.id] === 'measured');
    return { ok: true, summary: `${t.name}: ${feats.length} fingerprint values — ${byEv('derived')} derived from ${t.dem}, ${byEv('literature')} from literature, ${byEv('physical_constraint')} physical constraints. ${measured.length} of ${b.dimensions.length} comparison dimensions have evidence for this site.`,
      facts: [{ label: 'Elevation model', value: t.dem, evidence: 'measured' }, { label: 'Slope baseline', value: `${t.fine_baseline_m} m`, evidence: 'derived' }, { label: 'Dimensions with evidence', value: `${measured.length} / ${b.dimensions.length}`, evidence: 'derived' }, { label: 'Index content hash', value: b.content_sha256.slice(0, 16), evidence: 'curated' }] };
  }
  if (id === 'aggregate') {
    if (shard.target !== t.id) throw new Error(`score shard is for ${shard.target}, not ${t.id}`);
    const agg = aggregate(shard, inp.weights), order = Array.from(agg.score.keys()).filter(i => agg.score[i] > 0).sort((x, y) => agg.score[y] - agg.score[x]);
    st.agg = agg; st.order = order; const top = order[0], strong = order.filter(i => agg.category[i] === 'strong').length;
    if (top === undefined) return { ok: false, summary: 'No Earth window received a positive score under these priorities.', facts: [] };
    return { ok: true, summary: `${order.length.toLocaleString('en')} Earth windows scored. Closest: ${name(b, top)} with fidelity ${f(agg.fidelity[top], 3)} (90 % interval ${f(agg.lo[top], 3)}–${f(agg.hi[top], 3)}). ${strong.toLocaleString('en')} windows rest on strong evidence.`,
      facts: [{ label: 'Windows scored', value: order.length.toLocaleString('en'), evidence: 'derived' }, { label: 'Leading window', value: b.windows.id[top], evidence: 'derived' }, { label: 'Leader fidelity (90 % interval)', value: `${f(agg.fidelity[top], 3)} (${f(agg.lo[top], 3)}–${f(agg.hi[top], 3)})`, evidence: 'derived' }, { label: 'Coverage of weighted dimensions', value: pct(agg.coverage[top]), evidence: 'derived' }],
      detail: order.slice(0, 10).map((i, r) => `${r + 1}. ${name(b, i)} · ${b.windows.id[i]} · ${f(agg.fidelity[i], 3)} [${f(agg.lo[i], 3)}–${f(agg.hi[i], 3)}] · ${agg.category[i].replace('_', ' ')}`) };
  }
  if (id === 'stability') {
    const s = rankingStability(discoveryContext(inp), 10); st.stability = s; const worst = s.rows[0];
    return { ok: true, summary: `Under single-weight changes the top-10 keeps at least ${pct(s.minJaccard)} of its members${worst ? ` (most sensitive: ${worst.label}, ${worst.change})` : ''}. ${s.leaderOverlap} of ranks 2–6 overlap the leader at the 90 % level.`,
      facts: [{ label: 'Minimum top-10 overlap', value: pct(s.minJaccard), evidence: 'derived' }, { label: 'Most sensitive priority', value: worst ? `${worst.label} (${worst.change})` : '—', evidence: 'derived' }, { label: 'Ranks 2–6 tied with leader', value: `${s.leaderOverlap} of 5`, evidence: 'derived' }] };
  }
  if (id === 'space') {
    const space = inp.space ?? (() => { const x = candidateFeatures(b); return fitCandidateSpace(x.x, FEATURES.map(q => q.label), x.lon, x.lat); })(); st.space = space;
    const top = (st.order ?? []).slice(0, 10), groups = new Set(top.map(i => space.rows.indexOf(i)).filter(p => p >= 0).map(p => space.labels[p])), outliers = top.filter(i => { const p = space.rows.indexOf(i); return p >= 0 && space.outlier[p] > space.outlierThreshold; }).length;
    return { ok: true, summary: `${space.nRows.toLocaleString('en')} windows fall into ${space.k} terrain-and-climate groups (silhouette ${f(space.silhouette)}; geographic hold-out ARI ${f(space.geographicHoldoutAri)}). The top-10 analogs span ${groups.size} of those groups${outliers ? `; ${outliers} are statistical outliers` : ''}. Unsupervised structure — it does not predict analog quality.`,
      facts: [{ label: 'Groups (k)', value: String(space.k), evidence: 'model' }, { label: 'Silhouette', value: f(space.silhouette), evidence: 'model' }, { label: 'Geographic hold-out ARI', value: f(space.geographicHoldoutAri), evidence: 'model' }, { label: 'Top-10 groups', value: `${groups.size} of ${space.k}`, evidence: 'model' }], detail: [`${inp.space ? 'Reused the model fitted earlier in this session' : 'Fitted now, in this browser'}, seed ${ML_MODEL.seed}; seed-stability ARI ${f(space.seedStabilityAri)}.`] };
  }
  if (id === 'gaps') {
    const top = st.order?.[0]; if (top === undefined) return { ok: false, summary: 'No leading window to compare.', facts: [] };
    const rows = gapLedger(b, t.body, t.lat, top, shard.w1_deg[top]), measurable = rows.filter(r => r.measurable);
    const big = [...measurable].sort((x, y) => Math.abs(Math.log(Math.abs(y.ratio_earth_to_target ?? 1) || 1)) - Math.abs(Math.log(Math.abs(x.ratio_earth_to_target ?? 1) || 1)));
    return { ok: true, summary: `${measurable.length} parameters can be compared between ${b.windows.id[top]} and ${t.id}. The largest breaks: ${big.slice(0, 3).map(r => `${r.parameter} (Earth ${String(r.earth_value)} vs ${String(r.target_value)} ${r.unit})`).join('; ')}.`,
      facts: big.slice(0, 4).map(r => ({ label: r.parameter, value: `Earth ${String(r.earth_value)} · target ${String(r.target_value)} ${r.unit}`, evidence: 'derived' as Evidence })), detail: big.slice(0, 8).map(r => `${r.parameter}: ${r.note || r.relevance.join(', ')}${r.alternative ? ` → ${r.alternative}` : ''}`) };
  }
  if (id === 'validation') {
    const v = inp.validation?.targets.find(x => x.target === t.id);
    if (!v) return { ok: true, summary: `No published-analog validation is recorded for ${t.id}; the ranking is unvalidated for this site.`, facts: [{ label: 'Validation', value: 'none for this target', evidence: 'missing' }] };
    const auc = v.metrics.auc as number | null, ci = v.metrics.auc_90ci as number[] | undefined;
    return { ok: true, summary: `Known analog campaign sites rank above ${f(auc !== null ? auc * 100 : null, 0)} % of ordinary windows (AUC ${f(auc)}${ci ? `, 90 % interval ${f(ci[0])}–${f(ci[1])}` : ''}, ${v.metrics.n_positive} sites). Labels reflect where campaigns happened, so this bounds skill only loosely.`,
      facts: [{ label: 'AUC (90 % interval)', value: `${f(auc)}${ci ? ` (${f(ci[0])}–${f(ci[1])})` : ''}`, evidence: 'derived' }, { label: 'Published sites used', value: String(v.metrics.n_positive), evidence: 'curated' }, { label: 'Seed reproducibility (Spearman)', value: f(v.reproducibility.spearman_seed_2026_vs_7, 3), evidence: 'derived' }],
      detail: v.per_positive.map(p => `${p.site}: percentile ${f(p.percentile, 1)}`) };
  }
  if (id === 'transfer') {
    const cells = inp.atlas?.tensor.cells.filter(c => c.target === t.id) ?? [];
    if (!cells.length) return { ok: true, summary: inp.atlas ? `ATLAS-Π has no task-level assessment for ${t.id}; resemblance is not functional suitability.` : 'ATLAS-Π is not packaged in this data mode.', facts: [{ label: 'Task transferability', value: 'not assessed', evidence: 'missing' }] };
    const count = (s: Status) => cells.filter(c => c.status === s).length, sites = new Set(cells.map(c => c.site)).size;
    return { ok: true, summary: `${cells.length} task × site assessments over ${sites} catalogued Earth sites: ${count('SUPPORTED')} supported, ${count('CONDITIONAL')} conditional, ${count('WEAK')} weak, ${count('NON_TRANSFERABLE')} non-transferable, ${count('UNKNOWN')} unknown.`,
      facts: (['SUPPORTED', 'CONDITIONAL', 'WEAK', 'NON_TRANSFERABLE', 'UNKNOWN'] as Status[]).map(s => ({ label: s.toLowerCase().replace('_', '-'), value: String(count(s)), evidence: 'derived' as Evidence })) };
  }
  // review
  const ctx: IntelContext = { site: null, layers: null, selection: null, timeS: 0, config: null, plan: null, run: null, sensitivity: null, discovery: discoveryContext(inp, st.order?.length ? b.windows.id[st.order[0]] : null), atlas: inp.atlas, compare: null, space: st.space ?? inp.space };
  const r = review([callIntel(ctx, 'rank_candidates', {})], ctx); st.findings = r.findings; st.verdict = r.verdict;
  return { ok: true, summary: `Verdict: ${r.verdict}. ${r.findings.filter(x => x.severity === 'reject').length} rejections, ${r.findings.filter(x => x.severity === 'caution').length} cautions, ${r.findings.filter(x => x.severity === 'info').length} notes.`,
    facts: [{ label: 'Verdict', value: r.verdict, evidence: 'derived' }], detail: r.findings.map(x => `[${x.severity}] ${x.title}: ${x.detail}`) };
}

/** Plain-language findings from a completed run — fixed rules over computed values only. */
export interface Insight { tone: 'lead' | 'good' | 'caution' | 'risk'; title: string; text: string }
export function insights(inp: AnalysisInput, st: RunState, results: StepResult[]): Insight[] {
  const out: Insight[] = [], b = inp.bundle, a = st.agg, o = st.order ?? [];
  if (a && o.length) {
    const top = o[0], tied = st.stability?.leaderOverlap ?? 0;
    out.push({ tone: 'lead', title: `Closest Earth analog: ${b.windows.name[top]}`, text: `${b.windows.country[top] ?? 'No country'} · fidelity ${f(a.fidelity[top], 3)} with a 90 % interval of ${f(a.lo[top], 3)}–${f(a.hi[top], 3)}.${tied >= 3 ? ` But ${tied} of the next five are statistically indistinguishable: treat the leaders as a group, not a single winner.` : tied ? ` ${tied} of the next five overlap it.` : ' It separates from the next five at the 90 % level.'}` });
  }
  if (st.stability) out.push(st.stability.minJaccard >= 0.7 ? { tone: 'good', title: 'The ranking is robust to priorities', text: `Halving or doubling any single priority keeps at least ${pct(st.stability.minJaccard)} of the top-10.` } : { tone: st.stability.minJaccard < 0.4 ? 'risk' : 'caution', title: 'The ranking depends on your priorities', text: `A single weight change can replace up to ${pct(1 - st.stability.minJaccard)} of the top-10 (${st.stability.rows[0]?.label ?? 'one dimension'}). Decide which mission question matters before trusting one list.` });
  const missing = b.dimensions.filter(d => inp.target.dimension_status[d.id] !== 'measured');
  if (missing.length) out.push({ tone: 'caution', title: `${missing.length} of ${b.dimensions.length} dimensions have no evidence`, text: `${missing.map(d => d.label).join(', ')}. They cannot influence the ranking; the resemblance is incomplete there.` });
  const gaps = results.find(r => r.id === 'gaps'); if (gaps?.ok && gaps.facts[0]) out.push({ tone: 'risk', title: 'Where Earth cannot stand in', text: `${gaps.facts.slice(0, 3).map(x => `${x.label}: ${x.value}`).join('; ')}. These need laboratory or simulation substitutes.` });
  const val = results.find(r => r.id === 'validation'); if (val?.ok) out.push({ tone: val.facts[0]?.evidence === 'missing' ? 'caution' : 'good', title: 'Validation', text: val.summary });
  for (const fd of (st.findings ?? []).filter(x => x.severity === 'reject')) out.push({ tone: 'risk', title: `Critic: ${fd.title}`, text: fd.detail });
  return out;
}

export function toRecord(inp: AnalysisInput, st: RunState, results: StepResult[], ranUtc: string): AnalysisRecord {
  return { target: inp.target.id, profile: inp.profile, weightsKey: weightsKey(inp.weights), ranUtc, bundleSha: inp.bundle.content_sha256,
    top10: (st.order ?? []).slice(0, 10).map(i => inp.bundle.windows.id[i]), verdict: st.verdict ?? 'not reviewed',
    steps: results.map(r => ({ id: r.id, title: STEPS.find(s => s.id === r.id)?.title ?? r.id, ms: Math.round(r.ms * 10) / 10, summary: r.summary, ok: r.ok })),
    findings: (st.findings ?? []).map(x => ({ severity: x.severity, title: x.title, detail: x.detail })) };
}
/** Is a stored analysis still valid for the current target, profile and weights? */
export const analysisCurrent = (rec: AnalysisRecord | null | undefined, target: string | null | undefined, weights: Record<string, number>) => !!rec && rec.target === target && rec.weightsKey === weightsKey(weights);
