// Parity between the Python discovery engine (reference) and its browser port, on the real bundle:
// aggregation of every shortlisted window, the computed gap ledger and the rover experiment.
// Node built-ins are available in Vitest; the app tsconfig intentionally has no @types/node.
// @ts-expect-error untyped node built-in
import { readFileSync, existsSync } from 'node:fs';
// @ts-expect-error untyped node built-in
import { resolve } from 'node:path';
declare const process: { cwd(): string };
import { describe, expect, it } from 'vitest';
import { aggregate, col, diverseTop, gapLedger, isaPressurePa, noonElevationRange, percentileFn, roverExperiment, slopeCdf, somiglianaGravity } from './engine';
import { answerOffline, callTool, plan, type ToolContext } from './copilot';
import type { DiscoveryBundle, ScoreShard } from './types';

const dir = [resolve(process.cwd(), '../data/discovery'), resolve(process.cwd(), 'data/discovery')].find((p: string) => existsSync(resolve(p, 'discovery.json'))) ?? '';
const has = dir !== '';
const bundle: DiscoveryBundle | null = has ? JSON.parse(readFileSync(resolve(dir, 'discovery.json'), 'utf8')) : null;
const shard = (id: string): ScoreShard => JSON.parse(readFileSync(resolve(dir, `scores/${id}.json`), 'utf8'));

describe('physics helpers (Python twins in pipeline/discovery/dimensions.py)', () => {
  it('matches noon elevation, gravity and pressure reference values', () => {
    expect(noonElevationRange(70, 23.44)[0]).toBeCloseTo(-3.44, 6);
    expect(noonElevationRange(-85.4, 1.54)).toEqual([expect.closeTo(3.06, 6), expect.closeTo(6.14, 6)]);
    expect(somiglianaGravity(0)).toBeCloseTo(9.7803, 4);
    expect(isaPressurePa(5000)).toBeCloseTo(54020, -2);
  });
  it('builds a monotone slope CDF without zero-filling missing knots', () => {
    const cdf = slopeCdf(n => ({ slope_f100_p50_deg: 3, slope_f100_p90_deg: 8 } as Record<string, number>)[n] ?? null)!;
    expect(cdf[3]).toBeCloseTo(0.5, 9); expect(cdf[8]).toBeCloseTo(0.9, 9); expect(cdf[60]).toBe(1);
    for (let i = 1; i < cdf.length; i++) expect(cdf[i]).toBeGreaterThanOrEqual(cdf[i - 1]);
  });
  it('keeps diverse picks apart', () => {
    const picks = diverseTop([0, 1, 2, 3, 4], [0.9, 0.85, 0.8, 0.79, 0.5], [0, 0.5, 10, 10.3, 20], [0, 0, 0, 0, 0], 5, 150);
    expect(picks).toEqual([0, 2, 4]);
  });
});

describe.skipIf(!has)('parity with the Python bundle', () => {
  const b = bundle!;
  it('reproduces aggregate score, fidelity, interval and coverage for every shortlisted window', () => {
    for (const t of b.targets) {
      const s = shard(t.id);
      const agg = aggregate(s, b.profiles.general.weights);
      for (const e of t.shortlist) {
        const i = b.windows.id.indexOf(e.window);
        expect(agg.score[i]).toBeCloseTo(e.score, 3);
        expect(agg.fidelity[i]).toBeCloseTo(e.fidelity, 3);
        expect(agg.coverage[i]).toBeCloseTo(e.coverage, 3);
        expect(agg.lo[i]).toBeCloseTo(e.lo, 2);
        expect(agg.hi[i]).toBeCloseTo(e.hi, 2);
        expect(agg.category[i]).toBe(e.category);
        expect(agg.score[i]).toBeLessThan(1);
      }
    }
  });
  // Shards carry 4-decimal similarities, so near-tied scores can swap: allow +-0.5 percentile points.
  it('reproduces Earth-wide percentiles', () => {
    const t = b.targets[0], s = shard(t.id), agg = aggregate(s, b.profiles.general.weights);
    const pct = percentileFn(agg.score, b.windows.in_population);
    for (const e of t.shortlist) if (e.score_percentile != null) expect(pct(agg.score[b.windows.id.indexOf(e.window)])).toBeCloseTo(e.score_percentile, 0);
  });
  it('reproduces the numeric gap ledger', () => {
    for (const t of b.targets) for (const e of t.shortlist.filter(x => x.gaps)) {
      const i = b.windows.id.indexOf(e.window);
      const ts = gapLedger(b, t.body, t.lat, i, shard(t.id).w1_deg[i]);
      for (const row of ts) {
        const py = e.gaps!.find(g => g.key === row.key)!;
        expect(py, row.key).toBeTruthy();
        expect(row.measurable).toBe(py.measurable);
        if (typeof py.earth_value === 'number') expect(row.earth_value as number).toBeCloseTo(py.earth_value, 0);
        if (typeof py.target_value === 'number') expect(row.target_value).toBe(py.target_value);
      }
    }
  });
  it('reproduces the rover experiment', () => {
    for (const t of b.targets) for (const e of t.shortlist.filter(x => x.rover)) {
      const i = b.windows.id.indexOf(e.window);
      const ex = roverExperiment(slopeCdf(n => col(b, n, i))!, t.body, e.window);
      for (const k of ['target', 'earth_load_matched', 'earth_mass_matched'] as const) {
        expect(ex.cases[k].slope_limit_deg).toBeCloseTo(e.rover!.cases[k].slope_limit_deg, 2);
        expect(ex.cases[k].traversable_frac).toBeCloseTo(e.rover!.cases[k].traversable_frac, 3);
        expect(ex.cases[k].sinkage_mm).toBeCloseTo(e.rover!.cases[k].sinkage_mm, 2);
        if (e.rover!.cases[k].climbing_energy_j_per_m != null) expect(ex.cases[k].climbing_energy_j_per_m!).toBeCloseTo(e.rover!.cases[k].climbing_energy_j_per_m!, 0);
      }
    }
  });
});

describe.skipIf(!has)('research assistant tools', () => {
  const b = bundle!;
  const t = b.targets.find(x => x.id === 'MARS_JEZERO') ?? b.targets[0];
  const ctx: ToolContext = { bundle: b, target: t, shard: shard(t.id), weights: b.profiles.general.weights, selected: t.shortlist[0].window, compare: t.shortlist.slice(0, 2).map(e => e.window), validation: null };
  it('plans tools from English and Russian questions', () => {
    expect(plan('лучшие кандидаты в Казахстане', ctx)).toEqual([{ name: 'rank_candidates', input: { country: 'KAZ', k: 5 } }]);
    expect(plan('why does it rank here?', ctx)[0].name).toBe('why_rank');
    expect(plan('где аналогия не работает? разрыв', ctx)[0].name).toBe('gap_ledger');
    expect(plan('сравни', ctx)[0].name).toBe('compare_candidates');
  });
  it('answers only with tool output and refuses unknown tools', () => {
    const a = answerOffline('top candidates', ctx);
    expect(a.results[0].ok).toBe(true);
    expect(a.results[0].facts.length).toBeGreaterThan(0);
    expect(callTool(ctx, 'invent_numbers', {}).ok).toBe(false);
    expect(callTool(ctx, 'explain_candidate', { window: 'NOPE' }).ok).toBe(false);
  });
  it('restricts ranking to the requested country', () => {
    const r = callTool(ctx, 'rank_candidates', { country: 'KAZ', k: 5 });
    for (const id of r.windows ?? []) expect(b.windows.country[b.windows.id.indexOf(id)]).toBe('KAZ');
  });
});
