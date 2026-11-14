import { expect, it } from 'vitest';
import { candidateFidelity } from './candidateFidelity';
import { testData } from '../data/testData';

it('keeps a wholly ineligible fixture unknown across default and focused views', () => {
  for (const run of testData.results.runs) {
    expect(candidateFidelity(run, 'FAKE_KZ_020', null)).toBeNull();
    for (const objective of Object.keys(run.fidelity)) expect(candidateFidelity(run, 'FAKE_KZ_020', objective)).toBeNull();
    expect(candidateFidelity(run, 'UNKNOWN_SITE', null)).toBeNull();
  }
});
it('preserves a measured zero and picks the best known value without filling nulls', () => {
  const run = { ...testData.results.runs[0], fidelity: { O1: { ZERO: { F: 0, partial: false }, MIXED: { F: null, reason: 'missing' as const } }, O2: { MIXED: { F: .7, partial: true } } } };
  expect(candidateFidelity(run, 'ZERO', null)).toBe(0);
  expect(candidateFidelity(run, 'MIXED', null)).toBe(.7);
  expect(candidateFidelity(run, 'MIXED', 'O1')).toBeNull();
});
