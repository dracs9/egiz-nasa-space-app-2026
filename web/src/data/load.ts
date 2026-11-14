// AI-assisted implementation; human review pending.
import { applyHonestObjectiveNames } from '../lib/honesty';
import { ATTR_KEYS, type AppData, type Envelope } from '../types/contracts';
import { dataModeInfo, isDataMode, type DataMode } from './modes';

export class DataLoadError extends Error {
  constructor(public kind: 'network' | 'schema' | 'version', public file: string, public path = '', public got = '') {
    super(kind === 'version' ? `Data version ${got} not supported by this app (expects 1.x).` : kind === 'schema' ? `Data format error in ${file}${path ? ` at ${path}` : ''}.` : `Data failed to load: ${file}.`);
    this.name = 'DataLoadError';
  }
}
type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const score = (v: unknown): boolean => number(v) && v >= 0 && v <= 1;
function syntheticReference(value: unknown, path = '$'): string | null {
  if (typeof value === 'string') return value.startsWith('FAKE_') ? path : null;
  if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) { const found = syntheticReference(value[i], `${path}[${i}]`); if (found) return found; } }
  else if (object(value)) for (const [key, child] of Object.entries(value)) {
    if (key.startsWith('FAKE_')) return `${path}.${key}`;
    const found = syntheticReference(child, `${path}.${key}`); if (found) return found;
  }
  return null;
}
export function validateEnvelope(value: unknown, file: string): Envelope & Obj {
  const fail = (path: string): never => { throw new DataLoadError('schema', file, path); };
  if (!object(value)) return fail('$');
  if (typeof value.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.version)) fail('version');
  if (!(value.version as string).startsWith('1.')) throw new DataLoadError('version', file, 'version', value.version as string);
  if (value.schema !== `egiz.${file.replace('.json', '')}`) fail('schema');
  if (typeof value.synthetic !== 'boolean') fail('synthetic');
  if (typeof value.generated_at !== 'string' || !Number.isFinite(Date.parse(value.generated_at))) fail('generated_at');
  if (!Array.isArray(value.provenance)) fail('provenance');
  for (const item of value.provenance as unknown[]) {
    if (!object(item) || ['dataset', 'provider', 'version', 'url', 'role'].some(key => typeof item[key] !== 'string')) fail('provenance[]');
  }
  return value as Envelope & Obj;
}
export function validateDataFile(value: unknown, file: string): Envelope & Obj {
  const data = validateEnvelope(value, file);
  const fail = (path: string): never => { throw new DataLoadError('schema', file, path); };
  if (!data.synthetic) { const reference = syntheticReference(data); if (reference) fail(`${reference} (observed data cannot contain FAKE_ identifiers or references)`); }
  const array = (key: string): Obj[] => {
    if (!Array.isArray(data[key]) || !(data[key] as unknown[]).every(object)) fail(key);
    return data[key] as Obj[];
  };
  const ids = (items: Obj[], key: string) => {
    const unique = new Set();
    for (const item of items) {
      if (typeof item.id !== 'string' || !/^[A-Z][A-Z0-9_.-]*$/.test(item.id) || unique.has(item.id)) fail(`${key}.id`);
      if (data.synthetic && !(item.id as string).startsWith('FAKE_')) fail(`${key}.id (synthetic IDs must begin FAKE_)`);
      if (!data.synthetic && (item.id as string).startsWith('FAKE_')) fail(`${key}.id (observed data cannot contain FAKE_ identifiers)`);
      unique.add(item.id);
    }
  };
  const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === 'string');
  const month = (v: unknown): boolean => v === null || (Number.isInteger(v) && Number(v) >= 1 && Number(v) <= 12);
  const attrs = (value: unknown, path: string) => {
    if (!object(value)) fail(path);
    for (const [key, attr] of Object.entries(value as Obj)) {
      if (!ATTR_KEYS.includes(key as typeof ATTR_KEYS[number]) || (attr !== null && !number(attr))) fail(`${path}.${key}`);
      if (attr !== null && key.includes('frac') && !score(attr)) fail(`${path}.${key} (fraction)`);
      if (number(attr) && key.startsWith('slope_') && (attr < 0 || attr > 90)) fail(`${path}.${key} (slope)`);
    }
  };
  if (file === 'earth_candidates.json') {
    const tiles = array('tiles'); ids(tiles, 'tiles');
    if (typeof data.tiles_hash !== 'string') fail('tiles_hash');
    for (const tile of tiles) {
      if (!number(tile.lat) || Math.abs(tile.lat) > 90 || !number(tile.lon) || Math.abs(tile.lon) > 180) fail('tiles.coordinates');
      if (!['global', 'practice', 'kazakhstan', 'control'].includes(String(tile.pool))) fail('tiles.pool');
      if (!object(tile.context) || !strings(tile.missing) || tile.missing.some(key => !ATTR_KEYS.includes(key as typeof ATTR_KEYS[number]))) fail('tiles.attributes');
      attrs(tile.attrs, 'tiles.attrs');
      if (tile.name !== null && typeof tile.name !== 'string') fail('tiles.name');
      if (tile.country !== null && typeof tile.country !== 'string') fail('tiles.country');
      if (tile.pool === 'practice' && !tile.name) fail('tiles.name (practice site)');
      for (const key of ['tree_frac', 'crop_frac', 'built_frac', 'water_frac', 'snow_frac']) if ((tile.context as Obj)[key] !== null && !score((tile.context as Obj)[key])) fail(`tiles.context.${key}`);
    }
  } else if (file === 'targets.json') {
    const targets = array('targets'); ids(targets, 'targets');
    if (!targets.length) fail('targets (empty)');
    for (const target of targets) {
      if (!['moon', 'mars'].includes(String(target.body)) || !strings(target.templates) || typeof target.name !== 'string' || ![100, 400].includes(Number(target.fine_baseline_m)) || !object(target.attr_sources) || !Object.values(target.attr_sources as Obj).every(v => typeof v === 'string') || typeof target.dem_product !== 'string' || !number(target.lat) || Math.abs(target.lat) > 90 || !number(target.lon) || !['base_region', 'landing_site', 'validation_only'].includes(String(target.kind))) fail('targets[]');
      attrs(target.attrs, 'targets.attrs');
    }
  } else if (file === 'mission_templates.json') {
    const templates = array('templates'); ids(templates, 'templates');
    if (!object(data.params) || !Array.isArray(data.gap_alternatives) || !number((data.params as Obj).shortlist_per_objective) || Number((data.params as Obj).shortlist_per_objective) < 1 || Number((data.params as Obj).shortlist_per_objective) > 20) fail('params');
    for (const template of templates) {
      if (!Array.isArray(template.objectives) || !template.objectives.length) fail('templates.objectives');
      if (typeof template.name !== 'string' || !['moon', 'mars'].includes(String(template.body))) fail('templates[]');
      for (const o of template.objectives as Obj[]) {
        if (!object(o) || typeof o.id !== 'string' || typeof o.name !== 'string' || typeof o.description !== 'string' || !Array.isArray(o.attributes) || !number(o.weight_default) || Number(o.weight_default) < 0 || !Array.isArray(o.constraints)) fail('templates.objectives[]');
        for (const spec of o.attributes as Obj[]) if (!object(spec) || typeof spec.attr !== 'string' || !['match', 'logmatch', 'at_most', 'at_least', 'colder', 'category', 'light'].includes(String(spec.fn)) || !object(spec.params) || !number(spec.weight) || Number(spec.weight) < 0 || typeof spec.needs_target !== 'boolean') fail('templates.objectives.attributes[]');
      }
    }
  } else if (file === 'results.json') {
    for (const run of array('runs')) {
      if (typeof run.target !== 'string' || typeof run.template !== 'string' || !object(run.fidelity) || !object(run.gaps) || !Array.isArray(run.campaigns)) fail('runs[]');
      for (const [o, cells] of Object.entries(run.fidelity as Obj)) {
        if (!object(cells)) fail(`fidelity.${o}`);
        for (const [id, cell] of Object.entries(cells as Obj)) {
          if (!object(cell) || (cell.F !== null && !score(cell.F)) || (object(cell) && cell.F === null && !['constraint', 'missing'].includes(String(cell.reason)))) fail(`fidelity.${o}.${id}`);
          if (object(cell) && cell.F !== null && (typeof cell.partial !== 'boolean' || (cell.best_month !== undefined && !month(cell.best_month)) || (cell.parts !== undefined && (!object(cell.parts) || !Object.values(cell.parts).every(v => v === null || score(v)))))) fail(`fidelity.${o}.${id}.parts`);
        }
      }
      const gaps = run.gaps as Obj;
      if (!object(gaps.objective_ceiling) || !Object.values(gaps.objective_ceiling as Obj).every(value => value === null || score(value)) || !Array.isArray(gaps.attribute) || !Array.isArray(gaps.physical)) fail('runs.gaps');
      for (const g of gaps.physical as Obj[]) if (!object(g) || ['gap', 'alternative', 'source'].some(key => typeof g[key] !== 'string')) fail('runs.gaps.physical[]');
      for (const g of gaps.attribute as Obj[]) if (!object(g) || typeof g.objective !== 'string' || typeof g.attr !== 'string' || !score(g.ceiling)) fail('runs.gaps.attribute[]');
      for (const campaign of run.campaigns as Obj[]) {
        if (!object(campaign) || ![1, 2, 3].includes(Number(campaign.k)) || !score(campaign.coverage) || !Array.isArray(campaign.sites) || !Array.isArray(campaign.per_objective) || !object(campaign.method)) fail('campaigns[]');
        for (const site of campaign.sites as Obj[]) if (!object(site) || typeof site.id !== 'string' || !strings(site.roles) || !month(site.best_month)) fail('campaigns.sites[]');
        for (const p of campaign.per_objective as Obj[]) if (!object(p) || typeof p.objective !== 'string' || (p.site !== null && typeof p.site !== 'string') || (p.F !== null && !score(p.F))) fail('campaigns.per_objective[]');
        const method = campaign.method as Obj;
        if (!['shortlist_size', 'pool_size'].every(key => number(method[key]) && Number(method[key]) >= 0) || !score(method.exact_coverage) || !score(method.greedy_coverage) || typeof method.merged_greedy !== 'boolean') fail('campaigns.method');
      }
    }
  } else if (file === 'sun_windows.json') {
    if (!object(data.model) || !number((data.model as Obj).lat_step_deg) || Number((data.model as Obj).lat_step_deg) <= 0 || !Array.isArray(data.lat_bins) || !data.lat_bins.length || !data.lat_bins.every(number)) fail('lat_bins');
    for (const sun of array('targets')) {
      if (typeof sun.target !== 'string' || !number(sun.h_max_deg)) fail('targets[]');
      for (const key of ['hours_low', 'sweep_deg']) if (!Array.isArray(sun[key]) || (sun[key] as unknown[][]).length !== (data.lat_bins as unknown[]).length || (sun[key] as unknown[][]).some(row => !Array.isArray(row) || row.length !== 12 || row.some(n => !number(n) || n < 0 || n > (key === 'hours_low' ? 24 : 360)))) fail(`targets.${key}`);
    }
  } else if (file === 'validation.json') {
    for (const e of array('experiments')) if (!['confirmed', 'not_confirmed', 'inconclusive', 'not_run'].includes(String(e.status)) || ['id', 'hypothesis', 'metric', 'notes'].some(key => typeof e[key] !== 'string') || (e.value !== null && !number(e.value) && (!object(e.value) || !Object.values(e.value).every(number)))) fail('experiments[]');
    for (const key of ['practice_pairs', 'baselines', 'controls', 'figures']) if (!Array.isArray(data[key])) fail(key);
    for (const pair of data.practice_pairs as Obj[]) if (!object(pair) || typeof pair.site !== 'string' || typeof pair.target !== 'string' || typeof pair.objective !== 'string' || typeof pair.testable !== 'boolean' || (pair.pct !== null && (!number(pair.pct) || pair.pct < 0 || pair.pct > 100))) fail('practice_pairs[]');
    for (const baseline of data.baselines as Obj[]) if (!object(baseline) || typeof baseline.name !== 'string' || (baseline.median_pct !== null && (!number(baseline.median_pct) || baseline.median_pct < 0 || baseline.median_pct > 100))) fail('baselines[]');
  }
  return data;
}
export async function loadDatasetCatalog(fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<DataMode[]> {
  const file = 'datasets.json';
  let response: Response;
  try { response = await fetcher(`${import.meta.env.BASE_URL}data/${file}`, { cache: 'no-cache', signal }); } catch { throw new DataLoadError('network', file); }
  if (!response.ok) throw new DataLoadError('network', file);
  let value: unknown;
  try { value = await response.json(); } catch { throw new DataLoadError('schema', file, '$ (invalid JSON)'); }
  if (!object(value) || value.version !== '1.0.0' || !Array.isArray(value.modes) || !value.modes.every(isDataMode) || !value.modes.includes('demo') || new Set(value.modes).size !== value.modes.length) throw new DataLoadError('schema', file, 'modes');
  return value.modes;
}
export async function loadData(fetcher: typeof fetch = fetch, mode: DataMode = 'demo', signal?: AbortSignal): Promise<AppData> {
  const names = ['earth_candidates', 'targets', 'mission_templates', 'sun_windows', 'results', 'validation'];
  const values = await Promise.all(names.map(async name => {
    const file = `${name}.json`;
    let response: Response;
    try { response = await fetcher(`${import.meta.env.BASE_URL}${dataModeInfo[mode].path}/${file}`, { cache: 'no-cache', signal }); } catch { throw new DataLoadError('network', file); }
    if (!response.ok) throw new DataLoadError('network', file);
    let value: unknown;
    try { value = await response.json(); } catch { throw new DataLoadError('schema', file, '$ (invalid JSON)'); }
    return validateDataFile(value, file);
  }));
  const [candidates, targets, templates, sun, results, validation] = values;
  const synthetic = mode === 'demo';
  if (values.some(value => value.synthetic !== synthetic)) throw new DataLoadError('schema', 'bundle', `${mode} requires ${synthetic ? 'synthetic demo fixtures' : 'observed inputs'} in every file; mixed sources are not permitted`);
  const data = { candidates, targets, templates, sun, results, validation } as unknown as AppData;
  const tileIds = new Set(data.candidates.tiles.map(t => t.id));
  const flags = values.map(value => value.synthetic);
  if (new Set(flags).size !== 1) throw new DataLoadError('schema', 'bundle', 'mixed observed and synthetic sources');
  for (const target of data.targets.targets) if (!data.templates.templates.some(t => t.body === target.body && target.templates.includes(t.id))) throw new DataLoadError('schema', 'targets.json', 'templates (no compatible mission template)');
  for (const run of data.results.runs) {
    if (!data.targets.targets.some(t => t.id === run.target) || !data.templates.templates.some(t => t.id === run.template)) throw new DataLoadError('schema', 'results.json', 'runs (unknown target/template)');
    const template = data.templates.templates.find(t => t.id === run.template)!;
    if (data.targets.targets.find(t => t.id === run.target)!.body !== template.body) throw new DataLoadError('schema', 'results.json', 'runs (target/template body mismatch)');
    for (const objective of template.objectives) if (!run.fidelity[objective.id] || !Object.hasOwn(run.gaps.objective_ceiling, objective.id) || (run.gaps.objective_ceiling[objective.id] !== null && !number(run.gaps.objective_ceiling[objective.id]))) throw new DataLoadError('schema', 'results.json', `fidelity.${objective.id}`);
    for (const campaign of run.campaigns) if (campaign.sites.some(s => !tileIds.has(s.id) || data.candidates.tiles.find(t => t.id === s.id)?.pool === 'control')) throw new DataLoadError('schema', 'results.json', 'campaigns.sites (unknown/control site)');
  }
  applyHonestObjectiveNames(data.templates);
  return data;
}
export const hasSyntheticData = (data: AppData) => Object.values(data).some(file => file?.synthetic === true);
