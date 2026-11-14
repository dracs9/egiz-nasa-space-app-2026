// EGIZ · tests for the planetary-investigation modules: globe geometry, the analysis pipeline on the real measured
// discovery index, alternatives, investigation-record compatibility and the report.
// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AtlasBundle } from '../src/atlas/types';
import type { DiscoveryBundle, ScoreShard, ValidationDoc } from '../src/discover/types';
import { aggregate } from '../src/discover/engine';
import { analysisCurrent, insights, runStep, STEPS, toRecord, type AnalysisInput, type RunState } from '../src/planet/journey/analysis';
import { COMPARE_FEATURES, overlap, resemblance, surfaceKm, topWindows } from '../src/planet/journey/alternatives';
import { arcDeg, toLatLon, toVec } from '../src/planet/journey/globe';
import { FEATURE_INFO, fingerprintRows, formatFeature, PLACES } from '../src/planet/journey/knowledge';
import { buildReport, newInvestigation, parseInvestigation, serializeInvestigation, weightsKey } from '../src/planet/workspace/investigation';

const DATA = path.resolve(__dirname, '../../data'), has = existsSync(path.join(DATA, 'discovery/discovery.json'));
const json = <T>(p: string): T => JSON.parse(readFileSync(path.join(DATA, p), 'utf8')) as T;
const bundle = has ? json<DiscoveryBundle>('discovery/discovery.json') : null;
const shard = (id: string) => json<ScoreShard>(`discovery/scores/${id}.json`);
const validation = has && existsSync(path.join(DATA, 'discovery/validation.json')) ? json<ValidationDoc>('discovery/validation.json') : null;
const atlas = existsSync(path.join(DATA, 'pilot/atlas_pi.json')) ? json<AtlasBundle>('pilot/atlas_pi.json') : null;

describe('globe geometry', () => {
  it('round-trips latitude and longitude through the mesh frame', () => {
    for (const [lat, lon] of [[0, 0], [18.4446, 77.4509], [-89.76681, -171.8699], [45, -179.5], [-30, 120]]) {
      const p = toLatLon(toVec(lat, lon)); expect(p.lat).toBeCloseTo(lat, 6); expect(((p.lon - lon + 540) % 360) - 180).toBeCloseTo(0, 6);
    }
  });
  it('places longitude 0 at the texture centre (u = 0.5) as three.js SphereGeometry does', () => {
    // SphereGeometry vertex at u: x = -cos(2πu), z = sin(2πu). u = 0.5 → (+1, 0, 0).
    const v = toVec(0, 0); expect(v.x).toBeCloseTo(1, 9); expect(v.z).toBeCloseTo(0, 9);
  });
  it('measures great-circle angles', () => {
    expect(arcDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 90 })).toBeCloseTo(90, 6);
    expect(arcDeg({ lat: 90, lon: 0 }, { lat: -90, lon: 0 })).toBeCloseTo(180, 6);
  });
  it('lists orientation landmarks with valid coordinates for both worlds', () => {
    for (const w of ['moon', 'mars'] as const) { expect(PLACES[w].length).toBeGreaterThan(5); for (const p of PLACES[w]) { expect(Math.abs(p.lat)).toBeLessThanOrEqual(90); expect(Math.abs(p.lon)).toBeLessThanOrEqual(180); } }
  });
});

describe.skipIf(!has)('site analysis on the measured discovery index', () => {
  const target = bundle!.targets.find(t => t.id === 'MARS_JEZERO')!, weights = bundle!.profiles.general.weights;
  const input = (): AnalysisInput => ({ bundle: bundle!, target, shard: shard('MARS_JEZERO'), weights, profile: 'general', validation, atlas, space: null });
  it('runs every step, each with a measured duration and its own outputs', () => {
    const st: RunState = {}, inp = input(), results = STEPS.map(s => runStep(s.id, inp, st));
    expect(results.every(r => r.ok)).toBe(true); expect(results.every(r => r.ms >= 0 && Number.isFinite(r.ms))).toBe(true);
    // The aggregate step equals the discovery engine, never a re-scored copy.
    const a = aggregate(inp.shard, weights), lead = Array.from(a.score.keys()).sort((x, y) => a.score[y] - a.score[x])[0];
    expect(results[1].facts.find(f => f.label === 'Leading window')!.value).toBe(bundle!.windows.id[lead]);
    expect(st.space?.k).toBeGreaterThanOrEqual(3); expect(['supported', 'conditional', 'rejected', 'informational']).toContain(st.verdict);
    expect(insights(inp, st, results).length).toBeGreaterThan(2);
  });
  it('reproduces: identical inputs give an identical top-10, and the record detects staleness', () => {
    const run = () => { const st: RunState = {}, inp = input(), r = STEPS.map(s => runStep(s.id, inp, st)); return toRecord(inp, st, r, '2026-11-14T00:00:00Z'); };
    const a = run(), b = run(); expect(a.top10).toEqual(b.top10); expect(a.top10).toHaveLength(10);
    expect(analysisCurrent(a, 'MARS_JEZERO', weights)).toBe(true);
    expect(analysisCurrent(a, 'MARS_GALE', weights)).toBe(false);
    expect(analysisCurrent(a, 'MARS_JEZERO', { ...weights, terrain_fine: 3 })).toBe(false);
  });
  it('reports a failed step instead of inventing a result when the shard is for another site', () => {
    const r = runStep('aggregate', { ...input(), shard: shard('MARS_GALE') }, {}); expect(r.ok).toBe(false); expect(r.summary).toMatch(/failed/);
  });
});

describe.skipIf(!has)('alternatives', () => {
  it('ranks same-world sites by standardised fingerprint difference', () => {
    const mars = bundle!.targets.filter(t => t.body === 'mars'), base = mars.find(t => t.id === 'MARS_JEZERO')!, r = resemblance(base, mars);
    expect(r.map(x => x.id)).not.toContain('MARS_JEZERO'); expect(r).toHaveLength(mars.length - 1);
    for (let i = 1; i < r.length; i++) expect(r[i].meanZ).toBeGreaterThanOrEqual(r[i - 1].meanZ);
    expect(r[0].deltas.every(d => COMPARE_FEATURES.mars.includes(d.key))).toBe(true);
  });
  it('computes shared Earth analogs from the published shards', () => {
    const w = bundle!.profiles.general.weights, a = topWindows(bundle!, shard('MARS_JEZERO'), w, 50), b = topWindows(bundle!, shard('MARS_GALE'), w, 50), o = overlap(a, b);
    expect(a).toHaveLength(50); expect(o.shared.length).toBeLessThanOrEqual(50); expect(o.jaccard).toBeGreaterThanOrEqual(0); expect(o.jaccard).toBeLessThanOrEqual(1);
    expect(overlap(a, a).jaccard).toBe(1);
  });
  it('measures surface distance on the body', () => {
    const t = bundle!.targets, j = t.find(x => x.id === 'MARS_JEZERO')!, g = t.find(x => x.id === 'MARS_GALE')!;
    const km = surfaceKm(j, g, 3389.5); expect(km).toBeGreaterThan(3000); expect(km).toBeLessThan(4500);
  });
  it('labels every fingerprint feature in the bundle', () => {
    for (const t of bundle!.targets) for (const r of fingerprintRows(t)) { expect(FEATURE_INFO[r.key]).toBeDefined(); expect(formatFeature(r.key, r.f)).not.toBe(''); }
  });
});

describe('investigation record compatibility and report', () => {
  it('still opens records saved before the journey fields existed', () => {
    const old = newInvestigation('Legacy', '2026-11-14T00:00:00Z') as unknown as Record<string, unknown>;
    for (const k of ['world', 'trail', 'analysis', 'considered', 'decision']) delete old[k];
    const inv = parseInvestigation(JSON.stringify(old)); expect(inv.title).toBe('Legacy'); expect(inv.trail).toBeUndefined();
  });
  it('rejects a malformed journey field rather than guessing', () => {
    const v = { ...newInvestigation('X', '2026-11-14T00:00:00Z'), world: 'venus' };
    expect(() => parseInvestigation(JSON.stringify(v))).toThrow(/unknown world/);
  });
  it('writes the conclusion, analysis and trail into the reproducible report', () => {
    const inv = { ...newInvestigation('R', '2026-11-14T00:00:00Z'), world: 'mars' as const, target: 'MARS_JEZERO', decision: { text: 'Rehearse in the Tarim basin.', utc: '2026-11-14T01:00:00Z' },
      trail: [{ utc: '2026-11-14T00:10:00Z', kind: 'target' as const, text: 'Chose Jezero' }],
      analysis: { target: 'MARS_JEZERO', profile: 'general', weightsKey: weightsKey({ a: 1 }), ranUtc: '2026-11-14T00:20:00Z', bundleSha: 'abc', top10: ['W1'], verdict: 'conditional', steps: [{ id: 'aggregate', title: 'Score every Earth window', ms: 7.6, summary: '4544 scored', ok: true }], findings: [] } };
    const md = buildReport(parseInvestigation(serializeInvestigation(inv)), { site: null, layers: null, discovery: null, atlasVersion: null });
    expect(md).toMatch(/## Conclusion\n\nRehearse in the Tarim basin\./); expect(md).toMatch(/## Site analysis/); expect(md).toMatch(/Score every Earth window \| 7.6 ms/); expect(md).toMatch(/## Investigation trail/);
  });
});
