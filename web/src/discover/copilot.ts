// Tool-grounded research assistant for the Discover workspace.
// Every number in an answer is produced by one of the allowlisted tools below, which read only the
// measured discovery bundle. Each tool result carries the evidence it used (dimension ids, sources).
// The rule-based planner works offline; an optional LLM (server-side proxy, see llm.ts) may call the
// same tools but never adds numbers of its own. Written with AI assistance (Claude); review pending.
import { aggregate, col, gapLedger, haversineKm, roverExperiment, slopeCdf, statusOf, text } from './engine';
import type { DiscoveryBundle, ScoreShard, TargetEntry, ValidationDoc } from './types';

export interface ToolContext {
  bundle: DiscoveryBundle; target: TargetEntry; shard: ScoreShard; weights: Record<string, number>;
  selected: string | null; compare: string[]; validation: ValidationDoc | null;
}
export interface Fact { label: string; value: string; evidence: string }
export interface ToolResult { tool: string; ok: boolean; summary: string; facts: Fact[]; notes: string[]; windows?: string[] }
export interface Tool { name: string; description: string; schema: Record<string, unknown>; run(ctx: ToolContext, input: Record<string, unknown>): ToolResult }

const f2 = (v: number | null | undefined, d = 2) => v == null || !Number.isFinite(v) ? '—' : v.toFixed(d);
const idx = (ctx: ToolContext, id: string) => ctx.bundle.windows.id.indexOf(id);
const winName = (ctx: ToolContext, i: number) => `${ctx.bundle.windows.name[i]} (${ctx.bundle.windows.id[i]})`;
const dimLabel = (ctx: ToolContext, d: string) => ctx.bundle.dimensions.find(x => x.id === d)?.label ?? d;

function dims(ctx: ToolContext, i: number) {
  return ctx.shard.dims.map((d, k) => ({ id: d, label: dimLabel(ctx, d), s50: ctx.shard.s50[k][i], lo: ctx.shard.lo[k][i], hi: ctx.shard.hi[k][i], status: statusOf(ctx.shard, d, i) }));
}

function resolveWindow(ctx: ToolContext, input: Record<string, unknown>): number {
  const id = typeof input.window === 'string' ? input.window : ctx.selected;
  return id ? idx(ctx, id) : -1;
}

const noWindow = (tool: string): ToolResult => ({ tool, ok: false, summary: 'No Earth window selected', facts: [], notes: ['Select a candidate in the list or on the map, or name one.'] });

export const TOOLS: Tool[] = [
  {
    name: 'rank_candidates', description: 'Rank Earth windows for the active target with the active weights; optional country ISO filter and k.',
    schema: { type: 'object', properties: { country: { type: 'string' }, k: { type: 'integer', minimum: 1, maximum: 20 } } },
    run(ctx, input) {
      const agg = aggregate(ctx.shard, ctx.weights);
      const country = typeof input.country === 'string' ? input.country.toUpperCase() : null;
      const k = Math.min(20, Math.max(1, Number(input.k) || 5));
      const order = Array.from(agg.score.keys()).filter(i => !country || ctx.bundle.windows.country[i] === country).sort((a, b) => agg.score[b] - agg.score[a]).slice(0, k);
      return { tool: 'rank_candidates', ok: order.length > 0, summary: `Top ${order.length} for ${ctx.target.name}${country ? ` in ${country}` : ''}`,
        facts: order.map((i, n) => ({ label: `#${n + 1} ${winName(ctx, i)}`, value: `score ${f2(agg.score[i], 3)}, fidelity ${f2(agg.fidelity[i])} [${f2(agg.lo[i])}–${f2(agg.hi[i])}], coverage ${f2(agg.coverage[i])}, ${agg.category[i]}`, evidence: 'aggregate of measured dimensions' })),
        notes: ['Score = fidelity × coverage; unmeasured dimensions lower coverage and cannot raise the score.'], windows: order.map(i => ctx.bundle.windows.id[i]) };
    },
  },
  {
    name: 'explain_candidate', description: 'Per-dimension similarity with 90 % intervals, status and Earth-wide percentile for one window.',
    schema: { type: 'object', properties: { window: { type: 'string' } } },
    run(ctx, input) {
      const i = resolveWindow(ctx, input); if (i < 0) return noWindow('explain_candidate');
      const agg = aggregate(ctx.shard, ctx.weights);
      const facts = dims(ctx, i).map(d => ({ label: d.label, value: d.status === 'measured' ? `${f2(d.s50)} [${f2(d.lo)}–${f2(d.hi)}]` : d.status.replace('_', ' '), evidence: d.id }));
      return { tool: 'explain_candidate', ok: true, summary: `${winName(ctx, i)} vs ${ctx.target.name}: fidelity ${f2(agg.fidelity[i])} [${f2(agg.lo[i])}–${f2(agg.hi[i])}], coverage ${f2(agg.coverage[i])}`,
        facts, notes: [`Evidence category: ${agg.category[i]}.`, `Terrain rarity percentile ${f2(col(ctx.bundle, 'rarity_terrain_pct', i), 1)}; nearest established analog ${text(ctx.bundle, 'nearest_established', i)} at ${f2(col(ctx.bundle, 'novelty_km', i), 0)} km.`], windows: [ctx.bundle.windows.id[i]] };
    },
  },
  {
    name: 'why_rank', description: 'Strongest and weakest measured dimensions and the effect of coverage for one window.',
    schema: { type: 'object', properties: { window: { type: 'string' } } },
    run(ctx, input) {
      const i = resolveWindow(ctx, input); if (i < 0) return noWindow('why_rank');
      const agg = aggregate(ctx.shard, ctx.weights);
      const order = Array.from(agg.score.keys()).sort((a, b) => agg.score[b] - agg.score[a]);
      const m = dims(ctx, i).filter(d => d.status === 'measured' && d.s50 != null).sort((a, b) => (b.s50 ?? 0) - (a.s50 ?? 0));
      const missing = dims(ctx, i).filter(d => d.status === 'missing' || d.status === 'not_assessed').map(d => d.label);
      return { tool: 'why_rank', ok: true, summary: `${winName(ctx, i)} ranks #${order.indexOf(i) + 1} of ${order.length}`,
        facts: [...m.slice(0, 2).map(d => ({ label: `Strength: ${d.label}`, value: f2(d.s50), evidence: d.id })), ...m.slice(-2).reverse().map(d => ({ label: `Weakness: ${d.label}`, value: f2(d.s50), evidence: d.id })),
          { label: 'Coverage', value: `${f2(agg.coverage[i])} (score = ${f2(agg.fidelity[i])} × ${f2(agg.coverage[i])})`, evidence: 'aggregate' }],
        notes: missing.length ? [`Unmeasured: ${missing.join(', ')}.`] : [], windows: [ctx.bundle.windows.id[i]] };
    },
  },
  {
    name: 'compare_candidates', description: 'Side-by-side dimension scores for 2-4 windows.',
    schema: { type: 'object', properties: { windows: { type: 'array', items: { type: 'string' } } } },
    run(ctx, input) {
      const ids = (Array.isArray(input.windows) ? input.windows.filter((x): x is string => typeof x === 'string') : ctx.compare).slice(0, 4);
      const list = ids.map(id => idx(ctx, id)).filter(i => i >= 0);
      if (list.length < 2) return { tool: 'compare_candidates', ok: false, summary: 'Need at least two windows to compare', facts: [], notes: ['Add candidates to the comparison tray (+ Compare).'] };
      const agg = aggregate(ctx.shard, ctx.weights);
      const facts: Fact[] = [];
      ctx.shard.dims.forEach((d, k) => {
        if (ctx.target.dimension_status[d] !== 'measured') return;
        facts.push({ label: dimLabel(ctx, d), value: list.map(i => `${ctx.bundle.windows.id[i]}: ${ctx.shard.status[k][i] === 0 ? f2(ctx.shard.s50[k][i]) : 'n/a'}`).join(' · '), evidence: d });
      });
      facts.push({ label: 'Score', value: list.map(i => `${ctx.bundle.windows.id[i]}: ${f2(agg.score[i], 3)}`).join(' · '), evidence: 'aggregate' });
      return { tool: 'compare_candidates', ok: true, summary: `Comparison of ${list.length} windows for ${ctx.target.name}`, facts, notes: [], windows: list.map(i => ctx.bundle.windows.id[i]) };
    },
  },
  {
    name: 'gap_ledger', description: 'Computed mismatches (gravity, pressure, thermal, radiation, illumination...) between a window and the target.',
    schema: { type: 'object', properties: { window: { type: 'string' } } },
    run(ctx, input) {
      const i = resolveWindow(ctx, input); if (i < 0) return noWindow('gap_ledger');
      const rows = gapLedger(ctx.bundle, ctx.target.body, ctx.target.lat, i, ctx.shard.w1_deg[i]);
      const show = (v: unknown) => Array.isArray(v) ? v.join('–') : typeof v === 'number' ? (Math.abs(v) < 1e-3 && v !== 0 ? v.toExponential(2) : String(+v.toPrecision(4))) : String(v ?? '—');
      return { tool: 'gap_ledger', ok: true, summary: `Where ${winName(ctx, i)} cannot reproduce ${ctx.target.name}`,
        facts: rows.map(r => ({ label: r.parameter, value: `target ${show(r.target_value)} vs Earth ${show(r.earth_value)} ${r.unit}${r.ratio_earth_to_target ? ` (×${show(r.ratio_earth_to_target)})` : ''}`, evidence: `${r.key}: ${r.earth_evidence}` })),
        notes: rows.filter(r => r.note).map(r => `${r.parameter}: ${r.note}`), windows: [ctx.bundle.windows.id[i]] };
    },
  },
  {
    name: 'uncertainty', description: 'Interval widths per dimension and which dimensions dominate the uncertainty.',
    schema: { type: 'object', properties: { window: { type: 'string' } } },
    run(ctx, input) {
      const i = resolveWindow(ctx, input); if (i < 0) return noWindow('uncertainty');
      const m = dims(ctx, i).filter(d => d.status === 'measured' && d.lo != null && d.hi != null).sort((a, b) => ((b.hi ?? 0) - (b.lo ?? 0)) - ((a.hi ?? 0) - (a.lo ?? 0)));
      const agg = aggregate(ctx.shard, ctx.weights);
      return { tool: 'uncertainty', ok: true, summary: `Aggregate 90 % interval ${f2(agg.lo[i])}–${f2(agg.hi[i])} for ${winName(ctx, i)}`,
        facts: m.map(d => ({ label: d.label, value: `width ${f2((d.hi ?? 0) - (d.lo ?? 0))}`, evidence: d.id })),
        notes: ['Intervals propagate DEM vertical error, Mars blend-DEM smoothing, land-cover class accuracy, climatology error and map-scale uncertainty (Monte Carlo).', 'Dimensions with no dataset are not in the interval; they reduce coverage instead.'] };
    },
  },
  {
    name: 'recommend_simulation', description: 'Rover terramechanics experiment on the candidate slope distribution under target and Earth-test gravity.',
    schema: { type: 'object', properties: { window: { type: 'string' } } },
    run(ctx, input) {
      const i = resolveWindow(ctx, input); if (i < 0) return noWindow('recommend_simulation');
      const cdf = slopeCdf(n => col(ctx.bundle, n, i));
      if (!cdf) return { tool: 'recommend_simulation', ok: false, summary: 'No 100 m slope distribution for this window', facts: [], notes: [] };
      const ex = roverExperiment(cdf, ctx.target.body, ctx.bundle.windows.id[i]);
      const c = ex.cases, d = ex.deltas.earth_mass_matched;
      return { tool: 'recommend_simulation', ok: true, summary: `Rover experiment on ${winName(ctx, i)} (model estimate)`,
        facts: [
          { label: 'Slope limit (target gravity)', value: `${f2(c.target.slope_limit_deg, 1)}°`, evidence: 'CF_TERRAMECHANICS' },
          { label: 'Slope limit (Earth, mass-matched test)', value: `${f2(c.earth_mass_matched.slope_limit_deg, 1)}° (Δ ${f2(d.d_slope_limit_deg, 1)}°)`, evidence: 'CF_TERRAMECHANICS' },
          { label: 'Traversable fraction of this terrain', value: `${f2(c.target.traversable_frac * 100, 1)} % target vs ${f2(c.earth_mass_matched.traversable_frac * 100, 1)} % Earth test`, evidence: 'measured slope CDF (GLO-30, 100 m)' },
          { label: 'Sinkage ratio Earth/target', value: `${f2(d.sinkage_ratio)}×`, evidence: 'Bekker model' },
          { label: 'Climbing energy ratio Earth/target', value: `${f2(d.energy_ratio)}×`, evidence: 'Bekker model + slope CDF' },
        ], notes: ex.assumptions, windows: [ctx.bundle.windows.id[i]] };
    },
  },
  {
    name: 'target_fingerprint', description: 'Fingerprint of the active planetary target with evidence classes.',
    schema: { type: 'object', properties: {} },
    run(ctx) {
      const facts: Fact[] = [];
      for (const [group, feats] of Object.entries(ctx.target.fingerprint)) for (const [name, f] of Object.entries(feats)) {
        const v = Array.isArray(f.value) ? f.value.join(', ') : typeof f.value === 'number' ? (+f.value.toPrecision(4)).toString() : String(f.value);
        facts.push({ label: `${group} · ${name}`, value: `${v}${f.unit && f.unit !== 'class' ? ` ${f.unit}` : ''}${f.sigma ? ` ± ${+f.sigma.toPrecision(2)}` : ''}`, evidence: `${f.evidence}: ${f.source}` });
      }
      return { tool: 'target_fingerprint', ok: true, summary: `${ctx.target.name} — ${ctx.target.significance}`, facts, notes: [`DEM: ${ctx.target.dem}; fine baseline ${ctx.target.fine_baseline_m} m.`] };
    },
  },
  {
    name: 'validation_summary', description: 'Benchmark of published analog sites vs the Earth-wide population for the active target.',
    schema: { type: 'object', properties: {} },
    run(ctx) {
      const v = ctx.validation?.targets.find(x => x.target === ctx.target.id);
      if (!v) return { tool: 'validation_summary', ok: false, summary: 'No validation record for this target', facts: [], notes: ['Run python -m pipeline.discovery validate.'] };
      const m = v.metrics as Record<string, number | number[] | null>;
      const ci = Array.isArray(m.auc_90ci) ? ` [${m.auc_90ci.join('–')}]` : '';
      return { tool: 'validation_summary', ok: true, summary: `ROC AUC ${m.auc}${ci} for ${v.positives.length} published analogs vs ${m.n_background} lattice windows`,
        facts: v.per_positive.map(p => ({ label: p.site, value: `percentile ${f2(p.percentile, 1)}`, evidence: p.aspects.join(', ') })), notes: ctx.validation!.caveats };
    },
  },
  {
    name: 'earth_to_planet', description: 'For one Earth window, which planetary target it resembles most (default weights).',
    schema: { type: 'object', properties: { window: { type: 'string' } } },
    run(ctx, input) {
      const i = resolveWindow(ctx, input); if (i < 0) return noWindow('earth_to_planet');
      const best = text(ctx.bundle, 'best_target', i);
      const t = ctx.bundle.targets.find(x => x.id === best);
      return { tool: 'earth_to_planet', ok: !!t, summary: t ? `${winName(ctx, i)} resembles ${t.name} most (score ${f2(col(ctx.bundle, 'best_target_score', i), 3)})` : 'No target scored',
        facts: [], notes: ['Computed with the general profile across all targets in the bundle.'], windows: [ctx.bundle.windows.id[i]] };
    },
  },
  {
    name: 'find_window', description: 'Find windows by name, id or country, or nearest to lon/lat.',
    schema: { type: 'object', properties: { query: { type: 'string' }, lon: { type: 'number' }, lat: { type: 'number' } } },
    run(ctx, input) {
      const W = ctx.bundle.windows;
      let hits: number[] = [];
      if (typeof input.lon === 'number' && typeof input.lat === 'number') {
        hits = W.id.map((_, i) => i).sort((a, b) => haversineKm(+input.lon!, +input.lat!, W.lon[a], W.lat[a]) - haversineKm(+input.lon!, +input.lat!, W.lon[b], W.lat[b])).slice(0, 3);
      } else if (typeof input.query === 'string' && input.query.trim()) {
        const q = input.query.trim().toLowerCase();
        hits = W.id.map((_, i) => i).filter(i => W.id[i].toLowerCase().includes(q) || String(W.name[i]).toLowerCase().includes(q) || String(W.country[i] ?? '').toLowerCase() === q).slice(0, 8);
      }
      return { tool: 'find_window', ok: hits.length > 0, summary: hits.length ? `${hits.length} window(s) found` : 'No window matches', facts: hits.map(i => ({ label: W.id[i], value: `${W.name[i]} · ${W.lat[i].toFixed(2)}°, ${W.lon[i].toFixed(2)}°`, evidence: 'index' })), notes: [], windows: hits.map(i => W.id[i]) };
    },
  },
];

export function callTool(ctx: ToolContext, name: string, input: unknown): ToolResult {
  const tool = TOOLS.find(t => t.name === name);
  if (!tool) return { tool: name, ok: false, summary: `Tool ${name} is not allowlisted`, facts: [], notes: [] };
  const args = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  try { return tool.run(ctx, args); } catch (e) { return { tool: name, ok: false, summary: `Tool failed: ${(e as Error).message}`, facts: [], notes: [] }; }
}

const KZ_NAMES = ['kazakhstan', 'казахстан', 'kz'];
/** Offline intent planner (English and Russian). Returns the tool calls it would make. */
export function plan(question: string, ctx: ToolContext): { name: string; input: Record<string, unknown> }[] {
  const q = question.toLowerCase();
  const has = (...w: string[]) => w.some(x => q.includes(x));
  const named = ctx.bundle.windows.id.find(id => q.includes(id.toLowerCase()));
  const window = named ?? ctx.selected ?? undefined;
  const country = KZ_NAMES.some(k => q.includes(k)) ? 'KAZ' : undefined;
  if (has('compare', 'сравн', ' vs ', 'против')) return [{ name: 'compare_candidates', input: {} }];
  if (has('why', 'почему', 'reason')) return [{ name: 'why_rank', input: { window } }];
  if (has('gap', 'разрыв', 'fail', 'break', 'не может', 'cannot', 'mismatch', 'отлич')) return [{ name: 'gap_ledger', input: { window } }];
  if (has('uncertain', 'неопредел', 'confidence', 'interval', 'интервал', 'доверит')) return [{ name: 'uncertainty', input: { window } }];
  if (has('simulat', 'rover', 'ровер', 'симул', 'experiment', 'эксперим', 'mission lab')) return [{ name: 'recommend_simulation', input: { window } }];
  if (has('valid', 'benchmark', 'валид', 'провер', 'auc')) return [{ name: 'validation_summary', input: {} }];
  if (has('fingerprint', 'отпечат', 'target', 'цель', 'профиль цели')) return [{ name: 'target_fingerprint', input: {} }];
  if (has('which planet', 'resemble', 'похож', 'на что')) return [{ name: 'earth_to_planet', input: { window } }];
  if (has('find', 'where is', 'найди', 'где')) return [{ name: 'find_window', input: { query: q.replace(/^(find|найди|where is|где)\s*/, '') } }];
  if (has('top', 'best', 'лучш', 'rank', 'рейтинг', 'кандидат', 'candidates') || country) return [{ name: 'rank_candidates', input: { country, k: 5 } }];
  if (window) return [{ name: 'explain_candidate', input: { window } }];
  return [{ name: 'rank_candidates', input: { k: 5 } }];
}

export interface Answer { id: string; question: string; provider: 'rules' | 'llm'; results: ToolResult[]; narrative?: string; error?: string }

export function answerOffline(question: string, ctx: ToolContext): Answer {
  return { id: `r${Date.now()}`, question, provider: 'rules', results: plan(question, ctx).map(c => callTool(ctx, c.name, c.input)) };
}
