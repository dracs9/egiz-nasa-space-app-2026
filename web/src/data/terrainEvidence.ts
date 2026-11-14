import type { Results } from '../types/contracts';
export interface TerrainGrid {
  pixel_m: number; baseline_m: number; core20_valid_fraction: number;
  surface: { side: number; cell_m: number; elevation_m: (number | null)[] };
  profile: { direction: string; north_offset_m: number; distance_m: number[]; elevation_m: (number | null)[] };
  slope_histogram: { edges_deg: number[]; counts: number[]; valid_count: number; missing_count: number };
}
export interface TerrainEntry { id: string; body: string; lon: number; lat: number; source: { url: string; sha256: string; native_crs: string }; grids: Record<string, TerrainGrid> }
export interface TerrainEvidence { schema: string; version: string; synthetic: false; inputs: Record<string, string>; method: string; entries: TerrainEntry[] }
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const nullableNumbers = (values: unknown): values is (number | null)[] => Array.isArray(values) && values.every(v => v === null || finite(v));
export function validateTerrainEvidence(value: unknown, results: Results): TerrainEvidence {
  const data = value as TerrainEvidence;
  const invalid = () => { throw new Error('Terrain evidence is invalid or belongs to different source inputs. Rebuild the evidence bundle.'); };
  if (!data || data.schema !== 'egiz.terrain_evidence' || data.version !== '1.0.0' || data.synthetic !== false || results.synthetic || !data.inputs || !Array.isArray(data.entries)) invalid();
  for (const name of ['earth_candidates_sha256', 'targets_sha256']) if (!/^[a-f0-9]{64}$/.test(data.inputs[name] ?? '') || data.inputs[name] !== results.inputs[name]) invalid();
  const ids = new Set<string>();
  for (const entry of data.entries) {
    if (!entry || typeof entry.id !== 'string' || ids.has(entry.id) || !entry.source || !/^[a-f0-9]{64}$/.test(entry.source.sha256) || typeof entry.source.url !== 'string' || !entry.grids || !Object.keys(entry.grids).length) invalid();
    ids.add(entry.id);
    for (const [key, grid] of Object.entries(entry.grids)) {
      if (!grid || ![100, 400].includes(grid.baseline_m) || String(grid.baseline_m) !== key || grid.pixel_m * 2 !== grid.baseline_m || !finite(grid.core20_valid_fraction) || grid.core20_valid_fraction < 0 || grid.core20_valid_fraction > 1) invalid();
      const s = grid.surface, p = grid.profile, h = grid.slope_histogram;
      if (!s || !Number.isInteger(s.side) || s.side < 1 || s.side > 100 || s.side * s.cell_m !== 20000 || !nullableNumbers(s.elevation_m) || s.elevation_m.length !== s.side ** 2) invalid();
      if (!p || !nullableNumbers(p.elevation_m) || !Array.isArray(p.distance_m) || !p.distance_m.every((v, i) => finite(v) && v > 0 && v < 10000 && (i === 0 || v > p.distance_m[i - 1])) || p.distance_m.length !== p.elevation_m.length || p.distance_m.length !== 10000 / grid.pixel_m) invalid();
      if (!h || !Array.isArray(h.counts) || !h.counts.every(v => Number.isInteger(v) && v >= 0) || !Array.isArray(h.edges_deg) || !h.edges_deg.every((v, i) => finite(v) && v >= 0 && v <= 90 && (!i || v > h.edges_deg[i - 1])) || h.edges_deg.length !== h.counts.length + 1 || !Number.isInteger(h.valid_count) || !Number.isInteger(h.missing_count) || h.missing_count < 0 || h.counts.reduce((a, b) => a + b, 0) !== h.valid_count || h.valid_count + h.missing_count !== p.distance_m.length ** 2) invalid();
    }
  }
  return data;
}
