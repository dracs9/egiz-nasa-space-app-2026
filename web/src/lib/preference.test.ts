import { expect, it } from 'vitest';
import { preferenceEnvelope, preferenceLines, preferenceRanking, type PreferenceLine } from './preference';
import { pilotTestData } from '../data/testData';
const line = (id: string, left: number | null, right: number | null): PreferenceLine => ({ id, left, right, partial: left === null || right === null });
it('finds exact preference thresholds including a narrow winning interval', () => {
  const lines = [line('A', 1, 0), line('B', .500001, .500001), line('C', 0, 1), line('D', .1, .1)];
  const intervals = preferenceEnvelope(lines);
  expect(intervals.map(i => i.id)).toEqual(['A', 'B', 'C']);
  expect(intervals[0].end).toBeCloseTo(.499999, 12);
  expect(intervals[1].end).toBeCloseTo(.500001, 12);
});
it('handles parallel lines, identical scores, endpoints and missing data honestly', () => {
  const lines = [line('Z', .5, .5), line('A', .5, .5), line('M', null, 1), line('N', null, null)];
  expect(preferenceEnvelope(lines)).toEqual([{ id: 'A', start: 0, end: .5 }, { id: 'M', start: .5, end: 1 }]);
  expect(preferenceRanking(lines, .5)[0].id).toBe('A');
  expect(preferenceRanking(lines, 1)[0].id).toBe('M');
  expect(preferenceRanking(lines, 0).find(l => l.id === 'M')).toBeUndefined();
  expect(preferenceRanking(lines, .25).find(l => l.id === 'M')?.knownWeight).toBe(.25);
  expect(preferenceEnvelope([line('N', null, null)])).toEqual([]);
});
it('agrees with exhaustive ranking throughout every measured pilot envelope', () => {
  for (const run of pilotTestData.results.runs) {
    const objectives = Object.keys(run.fidelity);
    for (const a of objectives) for (const b of objectives) if (a !== b) {
      const lines = preferenceLines(run, pilotTestData.candidates.tiles, a, b, 'global');
      const intervals = preferenceEnvelope(lines);
      for (const interval of intervals) expect(preferenceRanking(lines, (interval.start + interval.end) / 2)[0].id).toBe(interval.id);
      for (let t = .001; t < 1; t += .007) {
        const interval = intervals.find(i => t > i.start && t < i.end);
        if (interval) expect(preferenceRanking(lines, t)[0].id).toBe(interval.id);
      }
      expect(lines.some(l => l.id.startsWith('FAKE_'))).toBe(false);
    }
  }
});
it('rejects invalid scientific inputs', () => {
  expect(() => preferenceEnvelope([line('A', NaN, 1)])).toThrow();
  expect(() => preferenceEnvelope([line('A', 1, 1), line('A', 0, 0)])).toThrow();
  expect(() => preferenceRanking([], 2)).toThrow();
});
