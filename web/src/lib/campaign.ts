// AI-assisted implementation of MATHEMATICAL_SPECIFICATION §8. Human review pending.
import type { Campaign, EarthTile, MissionTemplate, Run } from '../types/contracts';

export function coverage(F: number[][], W: number[], sites: number[]): number {
  const weight = W.reduce((s, w) => s + w, 0); if (!weight) return 0;
  return W.reduce((sum, w, o) => sum + w * Math.max(0, ...sites.map(s => F[s][o] ?? 0)), 0) / weight;
}
export function exactBest(F: number[][], W: number[], k: number, shortlist?: number[]): { sites: number[]; coverage: number } {
  const pool = shortlist ?? F.map((_, i) => i); const size = Math.min(k, pool.length);
  let best: number[] = []; let bestScore = -1;
  const total = W.reduce((a, b) => a + b, 0);
  if (!size || !total) return { sites: [], coverage: 0 };
  const consider = (indices: number[]) => {
    let sum = 0;
    for (let o = 0; o < W.length; o++) {
      let value = 0; for (const s of indices) value = Math.max(value, F[s][o]);
      sum += W[o] * value;
    }
    const score = sum / total;
    // Pool order is lexical by site ID. Equal scores retain the first combination.
    if (score > bestScore + 1e-12) { bestScore = score; best = indices.slice(); }
  };
  for (let a = 0; a < pool.length; a++) {
    if (size === 1) { consider([pool[a]]); continue; }
    for (let b = a + 1; b < pool.length; b++) {
      if (size === 2) { consider([pool[a], pool[b]]); continue; }
      for (let c = b + 1; c < pool.length; c++) consider([pool[a], pool[b], pool[c]]);
    }
  }
  return { sites: best, coverage: Math.max(0, bestScore) };
}
export function greedy(F: number[][], W: number[], k: number): { sites: number[]; coverage: number } {
  const sites: number[] = []; let score = 0;
  while (sites.length < Math.min(k, F.length)) {
    let best = -1, gain = score;
    for (let i = 0; i < F.length; i++) if (!sites.includes(i)) {
      const next = coverage(F, W, [...sites, i]);
      if (next > gain + 1e-12) { gain = next; best = i; }
    }
    if (best < 0) break; sites.push(best); score = gain;
  }
  return { sites: sites.sort((a, b) => a - b), coverage: score };
}
export function optimize(F: number[][], W: number[], k: number, perObjective = 20) {
  if (!W.some(w => w > 0) || !F.some(row => row.some((value, o) => W[o] > 0 && value > 0))) return { sites: [] as number[], coverage: 0, shortlistSize: 0, greedyCoverage: 0, merged: false };
  const shortlist = new Set<number>();
  const indices = F.map((_, i) => i);
  const top = (fn: (i: number) => number) => indices.slice().sort((a, b) => fn(b) - fn(a) || a - b).slice(0, perObjective);
  for (let o = 0; o < W.length; o++) if (W[o] > 0) for (const i of top(i => F[i][o])) shortlist.add(i);
  for (const i of top(i => coverage(F, W, [i]))) shortlist.add(i);
  let pool = [...shortlist].sort((a, b) => a - b);
  const greedyResult = greedy(F, W, k);
  let result = exactBest(F, W, k, pool);
  let merged = false;
  if (greedyResult.coverage > result.coverage + 1e-12) {
    pool = [...new Set([...pool, ...greedyResult.sites])].sort((a, b) => a - b);
    result = exactBest(F, W, k, pool); merged = true;
  }
  // Prefer a smaller campaign if it covers the same objectives equally well.
  for (let n = 1; n < result.sites.length; n++) {
    const smaller = exactBest(F, W, n, pool);
    if (smaller.coverage >= result.coverage - 1e-12) { result = smaller; break; }
  }
  return { ...result, shortlistSize: pool.length, greedyCoverage: greedyResult.coverage, merged };
}
export function designCampaigns(run: Run, template: MissionTemplate, tiles: EarthTile[], enabled: string[], weights: Record<string, number> | null, lens: 'global' | 'kazakhstan', shortlistSize = 20): Campaign[] {
  const objectives = template.objectives.filter(o => enabled.includes(o.id));
  const pool = tiles.filter(t => t.pool !== 'control' && (lens === 'global' || t.pool === 'kazakhstan')).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const W = objectives.map(o => weights?.[o.id] ?? o.weight_default);
  const F = pool.map(t => objectives.map(o => run.fidelity[o.id]?.[t.id]?.F ?? 0));
  return ([1, 2, 3] as const).map(k => {
    const best = optimize(F, W, k, shortlistSize);
    const ids = best.sites.map(i => pool[i].id);
    const perObjective = objectives.map((o, index) => {
      let site: string | null = null, score: number | null = null;
      for (const id of ids) { const f = run.fidelity[o.id]?.[id]?.F; if (f != null && (score === null || f > score)) { site = id; score = f; } }
      return { objective: o.id, site: W[index] > 0 && score !== null && score > 0 ? site : null, F: score };
    });
    return { k, coverage: best.coverage, sites: ids.map(id => {
      const roles = perObjective.filter(o => o.site === id).map(o => o.objective);
      const lighting = roles.map(o => run.fidelity[o]?.[id]).find(c => c && c.F !== null && c.best_month);
      return { id, roles, best_month: lighting && lighting.F !== null ? lighting.best_month ?? null : null };
    }), per_objective: perObjective, method: { shortlist_size: best.shortlistSize, pool_size: pool.length, exact_coverage: best.coverage, greedy_coverage: best.greedyCoverage, merged_greedy: best.merged } };
  });
}
