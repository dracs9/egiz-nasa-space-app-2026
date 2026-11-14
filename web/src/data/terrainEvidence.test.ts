import { expect, it } from 'vitest';
import evidence from '../../../data/pilot/terrain_evidence.json';
import { pilotTestData, testData } from './testData';
import { validateTerrainEvidence } from './terrainEvidence';

it('accepts genuine matching source evidence and rejects stale or synthetic sources', () => {
  const result = validateTerrainEvidence(evidence, pilotTestData.results);
  expect(result.entries).toHaveLength(11);
  expect(result.entries.filter(e => e.body === 'earth')).toHaveLength(9);
  expect(() => validateTerrainEvidence(evidence, testData.results)).toThrow();
  expect(() => validateTerrainEvidence({ ...evidence, inputs: { ...evidence.inputs, targets_sha256: 'f'.repeat(64) } }, pilotTestData.results)).toThrow();
});
it('rejects broken dimensions, nodata substitution and inconsistent histogram counts', () => {
  const corrupt = structuredClone(evidence);
  corrupt.entries[0].grids['100']!.surface.elevation_m.pop();
  expect(() => validateTerrainEvidence(corrupt, pilotTestData.results)).toThrow();
  const counts = structuredClone(evidence);
  counts.entries[0].grids['100']!.slope_histogram.counts[0] += 1;
  expect(() => validateTerrainEvidence(counts, pilotTestData.results)).toThrow();
});
