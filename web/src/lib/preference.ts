// Exact single-site preference envelope. These are model trade-offs, not probabilities.
import type { EarthTile, Run } from '../types/contracts';

export interface PreferenceLine { id: string; left: number | null; right: number | null; partial: boolean }
export interface PreferenceInterval { id: string; start: number; end: number }
const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export function preferenceLines(run: Run, tiles: EarthTile[], left: string, right: string, lens: 'global' | 'kazakhstan'): PreferenceLine[] {
  return tiles.filter(t => t.pool !== 'control' && (lens === 'global' || t.pool === 'kazakhstan')).flatMap(t => {
    const a = run.fidelity[left]?.[t.id], b = run.fidelity[right]?.[t.id];
    if (a?.F == null && b?.F == null) return [];
    return [{ id: t.id, left: a?.F ?? null, right: b?.F ?? null, partial: a?.F == null || b?.F == null || a.partial || b.partial }];
  });
}
function checked(lines: PreferenceLine[]) {
  const ids = new Set<string>();
  for (const line of lines) {
    if (ids.has(line.id) || [line.left, line.right].some(v => v !== null && (!Number.isFinite(v) || v < 0 || v > 1))) throw new Error('Preference lines need unique IDs and finite fidelities in [0, 1].');
    ids.add(line.id);
  }
  return lines.filter(l => l.left !== null || l.right !== null);
}
export function preferenceRanking(lines: PreferenceLine[], t: number) {
  if (!Number.isFinite(t) || t < 0 || t > 1) throw new Error('Preference must be between zero and one.');
  return checked(lines).map(line => ({ ...line, score: (1 - t) * (line.left ?? 0) + t * (line.right ?? 0), knownWeight: (line.left === null ? 0 : 1 - t) + (line.right === null ? 0 : t) }))
    .filter(line => line.knownWeight > 0).sort((a, b) => b.score - a.score || lexical(a.id, b.id));
}
/** O(n log n) upper hull of affine scores; no discretized slider search. */
export function preferenceEnvelope(lines: PreferenceLine[]): PreferenceInterval[] {
  const sorted = checked(lines).map(line => ({ id: line.id, a: line.left ?? 0, m: (line.right ?? 0) - (line.left ?? 0) }))
    .sort((a, b) => a.m - b.m || b.a - a.a || lexical(a.id, b.id));
  const hull: { id: string; a: number; m: number; start: number }[] = [];
  for (const line of sorted) {
    if (hull.at(-1)?.m === line.m) continue; // Parallel lines: highest intercept, then lexical ID.
    let start = -Infinity;
    while (hull.length) {
      const previous = hull.at(-1)!;
      start = (previous.a - line.a) / (line.m - previous.m);
      if (start > previous.start) break;
      hull.pop();
    }
    hull.push({ ...line, start: hull.length ? start : -Infinity });
  }
  return hull.flatMap((line, i) => {
    const start = Math.max(0, line.start), end = Math.min(1, hull[i + 1]?.start ?? 1);
    return end > start ? [{ id: line.id, start, end }] : [];
  });
}
