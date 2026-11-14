import { describe, expect, it } from 'vitest';
import { DataLoadError, hasSyntheticData, loadData, loadDatasetCatalog, validateDataFile, validateEnvelope } from './load';
import { pilotTestData, testData } from './testData';

const files: Record<string, unknown> = { earth_candidates: testData.candidates, targets: testData.targets, mission_templates: testData.templates, sun_windows: testData.sun, results: testData.results, validation: testData.validation };
describe('v1 data loading', () => {
  it('accepts every complete generated fixture and displays the synthetic signal', async () => {
    for (const [name, value] of Object.entries(files)) expect(validateDataFile(value, `${name}.json`).synthetic).toBe(true);
    const fetcher = (async (input: RequestInfo | URL) => {
      const key = String(input).split('/').pop()!.replace('.json', ''); return new Response(JSON.stringify(files[key]), { status: 200 });
    }) as typeof fetch;
    expect(hasSyntheticData(await loadData(fetcher))).toBe(true);
  });
  it('rejects unsupported major versions with a clear error', () => {
    expect(() => validateEnvelope({ ...testData.targets, version: '2.0.0' }, 'targets.json')).toThrow('expects 1.x');
    expect(validateEnvelope({ ...testData.targets, version: '1.7.2' }, 'targets.json').version).toBe('1.7.2');
  });
  it('rejects malformed nested campaigns, gaps, bounds and synthetic IDs', () => {
    const cases = [
      { ...testData.results, runs: [{ ...testData.results.runs[0], gaps: {} }] },
      { ...testData.results, runs: [{ ...testData.results.runs[0], campaigns: [{ ...testData.results.runs[0].campaigns[0], sites: [{ id: 'FAKE_1', roles: null, best_month: 13 }] }] }] },
      { ...testData.results, runs: [{ ...testData.results.runs[0], fidelity: { O1: { FAKE_1: { F: 1.2, partial: false } } } }] },
    ];
    for (const data of cases) expect(() => validateDataFile(data, 'results.json')).toThrow(DataLoadError);
    expect(() => validateDataFile({ ...testData.candidates, tiles: [{ ...testData.candidates.tiles[0], lat: 100 }] }, 'earth_candidates.json')).toThrow(DataLoadError);
    expect(() => validateDataFile({ ...testData.targets, targets: [{ ...testData.targets.targets[0], id: 'MOON_UNFLAGGED' }] }, 'targets.json')).toThrow('FAKE_');
  });
  it('accepts documented coordinate-style real IDs', () => {
    const data = { ...testData.candidates, synthetic: false, tiles: [{ ...testData.candidates.tiles[0], id: 'GL_E161.50_S77.50' }] };
    expect(validateDataFile(data, 'earth_candidates.json')).toBeTruthy();
  });
  it('reports network and JSON failures without exposing raw responses', async () => {
    await expect(loadData((async () => new Response('', { status: 404 })) as typeof fetch)).rejects.toMatchObject({ kind: 'network' });
    await expect(loadData((async () => new Response('invalid JSON')) as typeof fetch)).rejects.toMatchObject({ kind: 'schema' });
  });
  it('loads the measured pilot from its explicit path and rejects synthetic substitution', async () => {
    const requested: string[] = [];
    const pilotFiles: Record<string, unknown> = { earth_candidates: pilotTestData.candidates, targets: pilotTestData.targets, mission_templates: pilotTestData.templates, sun_windows: pilotTestData.sun, results: pilotTestData.results, validation: pilotTestData.validation };
    const fetcher = (async (input: RequestInfo | URL) => {
      requested.push(String(input)); const key = String(input).split('/').pop()!.replace('.json', '');
      return new Response(JSON.stringify(pilotFiles[key]), { status: 200 });
    }) as typeof fetch;
    const loaded = await loadData(fetcher, 'pilot');
    expect(requested).toHaveLength(6); expect(requested.every(url => url.includes('data/pilot/'))).toBe(true);
    expect(hasSyntheticData(loaded)).toBe(false); expect(loaded.candidates.tiles).toHaveLength(9);
    expect(loaded.targets.targets).toHaveLength(2); expect(loaded.candidates.tiles.every(tile => tile.attrs.t_min_c === null)).toBe(true);
    const mixed = (async (input: RequestInfo | URL) => { const key = String(input).split('/').pop()!.replace('.json', ''); return new Response(JSON.stringify(key === 'validation' ? testData.validation : pilotFiles[key])); }) as typeof fetch;
    await expect(loadData(mixed, 'pilot')).rejects.toThrow('mixed sources');
    await expect(loadData(fetcher, 'demo')).rejects.toThrow('synthetic demo fixtures');
  });
  it('accepts unknown ceiling null, retains measured zero, and rejects a missing objective key', async () => {
    const value = structuredClone(pilotTestData);
    const run = value.results.runs[0]; const key = Object.keys(run.fidelity)[0];
    run.gaps.objective_ceiling[key] = null;
    expect(validateDataFile(value.results, 'results.json')).toBeTruthy();
    run.gaps.objective_ceiling[key] = 0;
    expect((validateDataFile(value.results, 'results.json').runs as typeof value.results.runs)[0].gaps.objective_ceiling[key]).toBe(0);
    delete run.gaps.objective_ceiling[key];
    const docs: Record<string, unknown> = { earth_candidates: value.candidates, targets: value.targets, mission_templates: value.templates, sun_windows: value.sun, results: value.results, validation: value.validation };
    const fetcher = (async (input: RequestInfo | URL) => new Response(JSON.stringify(docs[String(input).split('/').pop()!.replace('.json', '')]))) as typeof fetch;
    await expect(loadData(fetcher, 'pilot')).rejects.toMatchObject({ kind: 'schema', path: `fidelity.${key}` });
  });
  it('catalog permits only explicit known sources and never authorizes arbitrary fetch paths', async () => {
    expect(await loadDatasetCatalog((async () => new Response(JSON.stringify({ version: '1.0.0', modes: ['demo', 'pilot'] }))) as typeof fetch)).toEqual(['demo', 'pilot']);
    await expect(loadDatasetCatalog((async () => new Response(JSON.stringify({ version: '1.0.0', modes: ['demo', '../private'] }))) as typeof fetch)).rejects.toMatchObject({ kind: 'schema' });
  });
  it('rejects FAKE_ references in observed envelopes even when their flags were flipped', () => {
    expect(() => validateDataFile({ ...testData.results, synthetic: false }, 'results.json')).toThrow('FAKE_');
    const value = structuredClone(pilotTestData.results);
    const run = value.runs[0]; const objective = Object.keys(run.fidelity)[0];
    run.fidelity[objective].FAKE_HIDDEN_REFERENCE = { F: 0, partial: false };
    expect(() => validateDataFile(value, 'results.json')).toThrow('FAKE_');
    const target = structuredClone(pilotTestData.targets); target.targets[0].templates = ['FAKE_TEMPLATE'];
    expect(() => validateDataFile(target, 'targets.json')).toThrow('FAKE_');
  });
});
