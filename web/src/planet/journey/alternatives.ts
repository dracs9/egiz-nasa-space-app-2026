// EGIZ Expedition · alternatives. Compares the investigated site with the other measured sites on the same world.
// Two independent, explainable measures:
//  · terrain resemblance — per-feature differences of the measured fingerprints, each divided by the spread of that
//    feature across the sites of this world, so no single unit dominates;
//  · shared Earth analogs — overlap of the top-k Earth windows when both sites are ranked under the same priorities,
//    i.e. whether one Earth field campaign could rehearse both.
// Neither re-scores anything: inputs are the bundle fingerprints and the published score shards.
import { aggregate } from '../../discover/engine';
import type { DiscoveryBundle, ScoreShard, TargetEntry } from '../../discover/types';
import { arcDeg } from './globe';
import { FEATURE_INFO, featureValue } from './knowledge';

/** Fingerprint features compared, per world (the Moon uses 100 m baselines, Mars 400 m, as in the index). */
export const COMPARE_FEATURES: Record<'moon' | 'mars', string[]> = {
  moon: ['slope_f100_p50_deg', 'slope_f100_p90_deg', 'tri_f100_m', 'slope_r_p50_deg', 'relief_m', 'noon_elevation_max_deg'],
  mars: ['slope_f400_p50_deg', 'slope_f400_p90_deg', 'tri_f400_m', 'slope_r_p50_deg', 'relief_m', 'noon_elevation_max_deg'],
};
export interface FeatureDelta { key: string; label: string; a: number; b: number; diff: number; z: number }
export interface Resemblance { id: string; meanZ: number; deltas: FeatureDelta[] }

const val = (t: TargetEntry, key: string) => { const v = featureValue(t, key); return v === null ? null : FEATURE_INFO[key]?.log ? Math.log10(Math.max(1, v)) : v; };
function spread(peers: TargetEntry[], key: string): number {
  const xs = peers.map(p => val(p, key)).filter((v): v is number => v !== null); if (xs.length < 2) return 1;
  const m = xs.reduce((s, x) => s + x, 0) / xs.length, sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
  return sd > 1e-9 ? sd : 1;
}
/** Standardised fingerprint differences of every peer against `base` (lower meanZ = more alike). */
export function resemblance(base: TargetEntry, peers: TargetEntry[]): Resemblance[] {
  const keys = COMPARE_FEATURES[base.body], scale = Object.fromEntries(keys.map(k => [k, spread(peers, k)]));
  return peers.filter(p => p.id !== base.id).map(p => {
    const deltas = keys.flatMap(k => { const a = featureValue(base, k), b = featureValue(p, k), va = val(base, k), vb = val(p, k); return a === null || b === null || va === null || vb === null ? [] : [{ key: k, label: FEATURE_INFO[k]?.label ?? k, a, b, diff: b - a, z: (vb - va) / scale[k] }]; });
    return { id: p.id, meanZ: deltas.length ? deltas.reduce((s, d) => s + Math.abs(d.z), 0) / deltas.length : NaN, deltas };
  }).sort((x, y) => x.meanZ - y.meanZ);
}
/** Top-k Earth windows of a shard under the given weights (ids in rank order). */
export function topWindows(b: DiscoveryBundle, shard: ScoreShard, weights: Record<string, number>, k = 50): string[] {
  const a = aggregate(shard, weights); return Array.from(a.score.keys()).filter(i => a.score[i] > 0).sort((x, y) => a.score[y] - a.score[x]).slice(0, k).map(i => b.windows.id[i]);
}
export function overlap(a: string[], b: string[]) { const sb = new Set(b), shared = a.filter(x => sb.has(x)); return { shared, jaccard: shared.length / (new Set([...a, ...b]).size || 1) }; }
/** Surface distance between two sites on a body of the given radius, km. */
export const surfaceKm = (a: TargetEntry, b: TargetEntry, radiusKm: number) => (arcDeg(a, b) * Math.PI / 180) * radiusKm;
