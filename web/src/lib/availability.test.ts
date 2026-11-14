import { expect, it } from 'vitest';
import { objectiveAvailability } from './availability';
import { testData } from '../data/testData';
it('distinguishes a measured zero from no eligible observations', () => {
  const tile = testData.candidates.tiles.find(t => t.pool !== 'control')!;
  const run = { ...testData.results.runs[0], fidelity: { O1: { [tile.id]: { F: null, reason: 'missing' as const } }, O2: { [tile.id]: { F: 0, partial: false } } } };
  expect(objectiveAvailability(run, 'O1', [tile], 'global')).toEqual({ count: 0, ceiling: null });
  expect(objectiveAvailability(run, 'O2', [tile], 'global')).toEqual({ count: 1, ceiling: 0 });
});
