import { expect, it } from 'vitest';
import { fieldPlan } from './fieldPlan';
import { pilotTestData, testData } from '../data/testData';
it('exports the actual site, target, input hashes, gaps and unassessed field requirements', () => {
  for (const data of [pilotTestData, testData]) {
    const run = data.results.runs[0], tile = data.candidates.tiles[0];
    const target = data.targets.targets.find(t => t.id === run.target)!;
    const template = data.templates.templates.find(t => t.id === run.template)!;
    const text = fieldPlan(data, target, tile, template, run);
    expect(text).toContain(tile.id); expect(text).toContain(target.name);
    expect(text).toContain(data.results.inputs.earth_candidates_sha256);
    expect(text).toContain('Missing inputs remain unassessed');
    expect(text).toContain('None are assessed by EGIZ');
    expect(text).toContain(data.results.synthetic ? 'SYNTHETIC SOFTWARE FIXTURES' : 'exploratory and unvalidated');
    for (const objective of template.objectives) expect(text).toContain(objective.name);
  }
});
