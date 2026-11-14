// AI-assisted tests. Golden inputs are synthetic Python outputs, not observed science.
import { describe, expect, it } from 'vitest';
import golden from '../../../data/fixtures/golden/golden_campaign.json';
import { testData } from '../data/testData';
import { coverage, designCampaigns, exactBest, greedy, optimize } from './campaign';

describe('campaign optimization', () => {
  it('matches all Python exact-search golden campaigns', () => {
    for (const c of golden.cases) {
      const result = exactBest(c.F, c.W, c.k);
      expect(result.sites).toEqual(c.expected_sites);
      expect(result.coverage).toBeCloseTo(c.expected_coverage, 12);
    }
  });
  it('matches fixture precomputed campaigns for both mission targets', () => {
    for (const run of testData.results.runs) {
      const template = testData.templates.templates.find(t => t.id === run.template)!;
      const campaigns = designCampaigns(run, template, testData.candidates.tiles, template.objectives.map(o => o.id), null, 'global');
      for (const c of campaigns) {
        const expected = run.campaigns.find(e => e.k === c.k)!;
        expect(c.coverage).toBeCloseTo(expected.coverage, 12);
        expect(c.sites.map(s => s.id)).toEqual(expected.sites.map(s => s.id));
      }
    }
  });
  it('selects complementary sites and respects disabled objectives', () => {
    const F = [[1, .1], [.1, 1], [.6, .6]];
    expect(exactBest(F, [1, 1], 2)).toEqual({ sites: [0, 1], coverage: 1 });
    expect(exactBest(F, [1, 0], 1).sites).toEqual([0]);
    expect(coverage(F, [1, 1], [2])).toBe(.6);
  });
  it('uses deterministic ties and prunes redundant sites', () => {
    expect(exactBest([[1], [1], [1]], [1], 2).sites).toEqual([0, 1]);
    expect(optimize([[1], [1], [1]], [1], 3).sites).toEqual([0]);
    expect(optimize([[0], [0]], [0], 3).sites).toEqual([]);
    expect(optimize([[0, 0], [0, 0]], [1, 1], 3).sites).toEqual([]);
    expect(optimize([], [1], 3).coverage).toBe(0);
  });
  it('returns an empty campaign when all eligible fidelities are missing', () => {
    const original = testData.results.runs[0]; const template = testData.templates.templates.find(t => t.id === original.template)!;
    const run = { ...original, fidelity: Object.fromEntries(template.objectives.map(o => [o.id, Object.fromEntries(testData.candidates.tiles.map(t => [t.id, { F: null, reason: 'missing' as const }]))])) };
    for (const campaign of designCampaigns(run, template, testData.candidates.tiles, template.objectives.map(o => o.id), null, 'global')) { expect(campaign.sites).toEqual([]); expect(campaign.coverage).toBe(0); }
  });
  it('keeps controls out and compares the same selected objectives in Kazakhstan', () => {
    const run = testData.results.runs[0]; const template = testData.templates.templates.find(t => t.id === run.template)!;
    const enabled = [template.objectives[1].id];
    const global = designCampaigns(run, template, testData.candidates.tiles, enabled, null, 'global');
    const kz = designCampaigns(run, template, testData.candidates.tiles, enabled, null, 'kazakhstan');
    for (const c of kz) {
      expect(c.sites.every(s => testData.candidates.tiles.find(t => t.id === s.id)?.pool === 'kazakhstan')).toBe(true);
      expect(c.per_objective.map(o => o.objective)).toEqual(enabled);
      expect(c.coverage).toBeLessThanOrEqual(global.find(g => g.k === c.k)!.coverage + 1e-12);
    }
  });
  it('checks exact coverage against greedy over the full pool', () => {
    for (const c of golden.cases) expect(optimize(c.F, c.W, c.k).coverage + 1e-12).toBeGreaterThanOrEqual(greedy(c.F, c.W, c.k).coverage);
  });
  it('assigns lighting months only to positive-weight objectives won by that site', () => {
    const [a, b] = testData.candidates.tiles.filter(t => t.pool === 'global').slice(0, 2);
    const original = testData.results.runs[0]; const source = testData.templates.templates[0];
    const template = { ...source, objectives: [{ ...source.objectives[0], id: 'O1', weight_default: 1 }, { ...source.objectives[1], id: 'O4', weight_default: 1 }] };
    const run = { ...original, fidelity: { O1: { [a.id]: { F: .95, partial: false }, [b.id]: { F: .1, partial: false } }, O4: { [a.id]: { F: .4, partial: false, best_month: 2 }, [b.id]: { F: .95, partial: false, best_month: 9 } } } };
    const both = designCampaigns(run, template, [a, b], ['O1', 'O4'], null, 'global')[1];
    expect(both.sites.find(s => s.id === a.id)?.best_month).toBeNull();
    expect(both.sites.find(s => s.id === b.id)?.best_month).toBe(9);
    const withoutLighting = designCampaigns(run, template, [a, b], ['O1', 'O4'], { O1: 1, O4: 0 }, 'global')[1];
    expect(withoutLighting.sites).toEqual([{ id: a.id, roles: ['O1'], best_month: null }]);
  });
  it('keeps selected-site measured zero separate from unknown without assigning a zero-score role', () => {
    const [a, b] = testData.candidates.tiles.filter(t => t.pool === 'global').slice(0, 2);
    const source = testData.templates.templates[0];
    const objectives = ['POSITIVE', 'ZERO', 'UNKNOWN', 'OFF'].map((id, i) => ({ ...source.objectives[0], id, weight_default: i === 3 ? 0 : 1 }));
    const template = { ...source, objectives };
    const run = { ...testData.results.runs[0], fidelity: {
      POSITIVE: { [a.id]: { F: 1, partial: false }, [b.id]: { F: .9, partial: false } },
      ZERO: { [a.id]: { F: 0, partial: false }, [b.id]: { F: 0, partial: false } },
      UNKNOWN: { [a.id]: { F: null, reason: 'missing' as const }, [b.id]: { F: null, reason: 'missing' as const } },
      OFF: { [a.id]: { F: .5, partial: false }, [b.id]: { F: .6, partial: false } },
    } };
    const campaign = designCampaigns(run, template, [a, b], objectives.map(o => o.id), null, 'global')[0];
    expect(campaign.sites).toEqual([{ id: a.id, roles: ['POSITIVE'], best_month: null }]);
    expect(campaign.per_objective).toEqual([
      { objective: 'POSITIVE', site: a.id, F: 1 }, { objective: 'ZERO', site: null, F: 0 },
      { objective: 'UNKNOWN', site: null, F: null }, { objective: 'OFF', site: null, F: .5 },
    ]);
    expect(campaign.coverage).toBeCloseTo(1 / 3);
  });
});
