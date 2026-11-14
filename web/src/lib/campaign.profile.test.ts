// @vitest-environment node
// Synthetic algorithm stress profile. Timing is recorded, never a flaky pass/fail criterion.
import { expect, it } from 'vitest';
import { coverage, optimize } from './campaign';

it('profiles a 3000-site, nine-objective campaign with a measured 120-site shortlist', () => {
  let seed = 2026;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32);
  const nSites = 3000, nObjectives = 9, perObjective = 12;
  const F = Array.from({ length: nSites }, () => Array.from({ length: nObjectives }, () => random() * .75));
  // Nine disjoint groups of twelve specialists plus twelve balanced candidates
  // form exactly 120 shortlisted sites. All nine objective weights are positive.
  for (let o = 0; o < nObjectives; o++) for (let j = 0; j < 12; j++) F[o * 12 + j][o] = .98 + j / 12 * .019;
  for (let j = 0; j < 12; j++) F[108 + j] = Array(nObjectives).fill(.9 + j / 12 * .01);
  const W = [1, .9, 1.1, 1.2, .8, 1.3, .7, 1, 1.1];
  const start = performance.now();
  const result = optimize(F, W, 3, perObjective);
  const elapsedMs = performance.now() - start;
  expect(result.shortlistSize).toBe(120); expect(result.sites).toEqual([47, 71, 119]);
  expect(result.coverage).toBeCloseTo(coverage(F, W, result.sites), 12);
  expect(result.coverage).toBeGreaterThanOrEqual(result.greedyCoverage - 1e-12);
  console.info(JSON.stringify({
    synthetic: true, purpose: 'Software algorithm profile, not scientific validation',
    scenario: { seed: 2026, sites: nSites, objectives: nObjectives, positive_weights: nObjectives, k: 3, shortlist_per_objective: perObjective, shortlist_size: result.shortlistSize, exact_triples: 280840 },
    timed_operation: 'optimize: full-pool shortlist construction + greedy + exact search + smaller-campaign check',
    excludes: ['React rendering', 'browser Worker startup and message transfer', 'data loading', 'map rendering'],
    elapsed_ms: Number(elapsedMs.toFixed(3)), target_ms: 300, under_target_on_this_run: elapsedMs <= 300,
    selected_indices: result.sites, coverage: result.coverage, greedy_coverage: result.greedyCoverage,
  }));
});
