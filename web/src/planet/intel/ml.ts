// EGIZ Planetary Studio · unsupervised machine learning for candidate discovery.
// What this is: standardisation, PCA, seeded k-means++, silhouette model selection, Mahalanobis outlier scores and
// maximal-marginal-relevance diversity, fitted in the browser on the measured discovery index.
// What this is NOT: a supervised or pretrained model. There are no labels of "true analogs" large enough to train
// one (≤ 21 published benchmark sites), so nothing here predicts analog quality; it organises the candidate space.
// Validation: (1) recovery of known groups on controlled synthetic data (unit tests), (2) seed stability and
// (3) GEOGRAPHIC hold-out — centroids are fitted on one set of spatial blocks and applied to the other, so
// neighbouring windows never sit on both sides of the split.
export const ML_MODEL = { id: 'egiz.candidate-space.kmeans', version: '1.0.0', kind: 'unsupervised (PCA + k-means++), fitted in session', seed: 2026 } as const;

export function mulberry32(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export interface Standardized { z: Float64Array[]; rows: number[]; mean: number[]; sd: number[] }
/** Z-score each column over complete rows. `rows` maps back to the caller's indices; incomplete rows are dropped, not imputed. */
export function standardize(x: (number | null)[][]): Standardized {
  const d = x[0]?.length ?? 0, rows: number[] = [];
  x.forEach((r, i) => { if (r.every(v => typeof v === 'number' && Number.isFinite(v))) rows.push(i); });
  const mean = new Array(d).fill(0), sd = new Array(d).fill(0);
  for (const i of rows) for (let j = 0; j < d; j++) mean[j] += x[i][j]! / rows.length;
  for (const i of rows) for (let j = 0; j < d; j++) sd[j] += (x[i][j]! - mean[j]) ** 2 / Math.max(1, rows.length - 1);
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  return { z: rows.map(i => Float64Array.from(x[i], (v, j) => (v! - mean[j]) / sd[j])), rows, mean, sd };
}
export function covariance(z: Float64Array[]): number[][] {
  const d = z[0]?.length ?? 0, c = Array.from({ length: d }, () => new Array(d).fill(0));
  for (const r of z) for (let i = 0; i < d; i++) for (let j = i; j < d; j++) c[i][j] += (r[i] * r[j]) / Math.max(1, z.length - 1);
  for (let i = 0; i < d; i++) for (let j = 0; j < i; j++) c[i][j] = c[j][i];
  return c;
}
/** Symmetric eigen-decomposition by cyclic Jacobi rotations (small matrices). Eigenvalues descending. */
export function eigenSym(a: number[][]): { values: number[]; vectors: number[][] } {
  const n = a.length, m = a.map(r => [...r]), v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += m[i][j] ** 2;
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(m[p][q]) < 1e-300) continue;
      const th = (m[q][q] - m[p][p]) / (2 * m[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const kp = m[k][p], kq = m[k][q]; m[k][p] = c * kp - s * kq; m[k][q] = s * kp + c * kq; }
      for (let k = 0; k < n; k++) { const pk = m[p][k], qk = m[q][k]; m[p][k] = c * pk - s * qk; m[q][k] = s * pk + c * qk; }
      for (let k = 0; k < n; k++) { const kp = v[k][p], kq = v[k][q]; v[k][p] = c * kp - s * kq; v[k][q] = s * kp + c * kq; }
    }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => m[j][j] - m[i][i]);
  return { values: order.map(i => m[i][i]), vectors: order.map(i => v.map(r => r[i])) };
}
export function pca(z: Float64Array[], k = 2): { components: number[][]; explained: number[]; scores: number[][] } {
  const e = eigenSym(covariance(z)), total = e.values.reduce((a, b) => a + Math.max(0, b), 0) || 1, components = e.vectors.slice(0, k);
  return { components, explained: e.values.slice(0, k).map(v => Math.max(0, v) / total), scores: z.map(r => components.map(c => c.reduce((s, w, j) => s + w * r[j], 0))) };
}
const dist2 = (a: ArrayLike<number>, b: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return s; };
export const assign = (z: Float64Array[], centroids: number[][]) => z.map(r => { let best = 0, bd = Infinity; centroids.forEach((c, k) => { const d = dist2(r, c); if (d < bd) { bd = d; best = k; } }); return best; });

export interface KMeans { k: number; labels: number[]; centroids: number[][]; inertia: number; iterations: number }
export function kmeans(z: Float64Array[], k: number, seed: number = ML_MODEL.seed, maxIter = 100): KMeans {
  const rand = mulberry32(seed), n = z.length, d = z[0]?.length ?? 0;
  if (n < k) throw new Error(`k-means needs at least k = ${k} complete rows; got ${n}.`);
  const centroids: number[][] = [Array.from(z[Math.floor(rand() * n)])], near = new Float64Array(n).fill(Infinity);
  while (centroids.length < k) { // k-means++ seeding
    let total = 0; for (let i = 0; i < n; i++) { near[i] = Math.min(near[i], dist2(z[i], centroids[centroids.length - 1])); total += near[i]; }
    let pick = rand() * total, idx = 0; for (; idx < n - 1; idx++) { pick -= near[idx]; if (pick <= 0) break; }
    centroids.push(Array.from(z[idx]));
  }
  let labels = assign(z, centroids), iterations = 0;
  for (; iterations < maxIter; iterations++) {
    const sum = Array.from({ length: k }, () => new Array(d).fill(0)), count = new Array(k).fill(0);
    labels.forEach((l, i) => { count[l]++; for (let j = 0; j < d; j++) sum[l][j] += z[i][j]; });
    for (let c = 0; c < k; c++) if (count[c]) centroids[c] = sum[c].map(v => v / count[c]);
    const next = assign(z, centroids);
    if (next.every((l, i) => l === labels[i])) break;
    labels = next;
  }
  return { k, labels, centroids, inertia: labels.reduce((s, l, i) => s + dist2(z[i], centroids[l]), 0), iterations };
}
/** Mean silhouette on a seeded subsample (exact for n ≤ maxN). */
export function silhouette(z: Float64Array[], labels: number[], maxN = 1200, seed: number = ML_MODEL.seed): number {
  const rand = mulberry32(seed), idx = z.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const use = idx.slice(0, maxN), k = Math.max(...labels) + 1;
  let total = 0, counted = 0;
  for (const i of use) {
    const sum = new Array(k).fill(0), cnt = new Array(k).fill(0);
    for (const j of use) if (j !== i) { sum[labels[j]] += Math.sqrt(dist2(z[i], z[j])); cnt[labels[j]]++; }
    if (!cnt[labels[i]]) continue;
    const a = sum[labels[i]] / cnt[labels[i]]; let b = Infinity;
    for (let c = 0; c < k; c++) if (c !== labels[i] && cnt[c]) b = Math.min(b, sum[c] / cnt[c]);
    if (b === Infinity) continue;
    total += (b - a) / Math.max(a, b); counted++;
  }
  return counted ? total / counted : 0;
}
/** Adjusted Rand index between two labelings of the same items (1 = identical partition, ≈0 = chance). */
export function adjustedRand(a: number[], b: number[]): number {
  const table = new Map<string, number>(), ra = new Map<number, number>(), rb = new Map<number, number>(), c2 = (n: number) => (n * (n - 1)) / 2;
  a.forEach((x, i) => { table.set(`${x}|${b[i]}`, (table.get(`${x}|${b[i]}`) ?? 0) + 1); ra.set(x, (ra.get(x) ?? 0) + 1); rb.set(b[i], (rb.get(b[i]) ?? 0) + 1); });
  let index = 0, sa = 0, sb = 0; for (const v of table.values()) index += c2(v); for (const v of ra.values()) sa += c2(v); for (const v of rb.values()) sb += c2(v);
  const expected = (sa * sb) / c2(a.length), max = (sa + sb) / 2;
  return max === expected ? 1 : (index - expected) / (max - expected);
}
/** Squared Mahalanobis distance of every row from the sample mean (ridge-regularised covariance). */
export function mahalanobis(z: Float64Array[]): number[] {
  const e = eigenSym(covariance(z)), floor = Math.max(1e-6, e.values[0] * 1e-6);
  return z.map(r => e.vectors.reduce((s, vec, k) => s + vec.reduce((p, w, j) => p + w * r[j], 0) ** 2 / Math.max(floor, e.values[k]), 0));
}
/** Greedy maximal marginal relevance: high score, far (in feature space) from what is already chosen. */
export function mmr(score: number[], z: Float64Array[], k: number, lambda = 0.7): number[] {
  const n = score.length, hi = Math.max(...score), lo = Math.min(...score), rel = score.map(s => (hi > lo ? (s - lo) / (hi - lo) : 1)), chosen: number[] = [];
  let scale = 0; for (let i = 0; i < Math.min(n, 200); i++) scale = Math.max(scale, Math.sqrt(dist2(z[i], z[0])));
  while (chosen.length < Math.min(k, n)) {
    let best = -1, bv = -Infinity;
    for (let i = 0; i < n; i++) { if (chosen.includes(i)) continue; const near = chosen.length ? Math.min(...chosen.map(c => Math.sqrt(dist2(z[i], z[c])))) / (scale || 1) : 1; const v = lambda * rel[i] + (1 - lambda) * Math.min(1, near); if (v > bv) { bv = v; best = i; } }
    chosen.push(best);
  }
  return chosen;
}

export interface CandidateSpace {
  model: typeof ML_MODEL; features: string[]; nRows: number; nDropped: number; k: number; silhouette: number; silhouetteByK: Record<number, number>;
  seedStabilityAri: number; geographicHoldoutAri: number; holdout: { fitRows: number; testRows: number; blockDeg: number };
  labels: number[]; rows: number[]; centroidsOriginalUnits: Record<string, number>[]; sizes: number[]; pca: { explained: number[]; scores: number[][] }; outlier: number[]; outlierThreshold: number;
  limitations: string[];
}
/**
 * Fit the candidate space. `lon`/`lat` are used only for the geographic hold-out (checkerboard of `blockDeg` blocks).
 * k is chosen by silhouette over 3–7 unless given.
 */
export function fitCandidateSpace(x: (number | null)[][], features: string[], lon: number[], lat: number[], k?: number, blockDeg = 30): CandidateSpace {
  const st = standardize(x), z = st.z;
  if (z.length < 40) throw new Error(`Only ${z.length} complete rows: too few to fit a candidate space.`);
  const byK: Record<number, number> = {};
  if (k === undefined) { let best = 3, bs = -Infinity; for (let c = 3; c <= 7; c++) { byK[c] = silhouette(z, kmeans(z, c).labels, 600); if (byK[c] > bs) { bs = byK[c]; best = c; } } k = best; }
  const fit = kmeans(z, k), sil = byK[k] ?? silhouette(z, fit.labels, 600);
  const seeds = [7, 101, 9001].map(s => adjustedRand(fit.labels, kmeans(z, k!, s).labels));
  const block = (i: number) => (Math.floor((lon[st.rows[i]] + 180) / blockDeg) + Math.floor((lat[st.rows[i]] + 90) / blockDeg)) % 2;
  const train = z.filter((_, i) => block(i) === 0), testIdx = z.map((_, i) => i).filter(i => block(i) === 1);
  const held = train.length >= k * 5 && testIdx.length >= k * 5 ? adjustedRand(testIdx.map(i => fit.labels[i]), assign(testIdx.map(i => z[i]), kmeans(train, k, ML_MODEL.seed).centroids)) : NaN;
  const d2 = mahalanobis(z), sorted = [...d2].sort((a, b) => a - b), threshold = sorted[Math.floor(sorted.length * 0.99)], p = pca(z, 2), sizes = new Array(k).fill(0);
  fit.labels.forEach(l => sizes[l]++);
  return { model: ML_MODEL, features, nRows: z.length, nDropped: x.length - z.length, k, silhouette: sil, silhouetteByK: byK, seedStabilityAri: seeds.reduce((a, b) => a + b, 0) / seeds.length, geographicHoldoutAri: held,
    holdout: { fitRows: train.length, testRows: testIdx.length, blockDeg }, labels: fit.labels, rows: st.rows,
    centroidsOriginalUnits: fit.centroids.map(c => Object.fromEntries(features.map((f, j) => [f, c[j] * st.sd[j] + st.mean[j]]))), sizes, pca: { explained: p.explained, scores: p.scores }, outlier: d2, outlierThreshold: threshold,
    limitations: ['Clusters describe structure in the chosen terrain and climate features only; they are not geological units and not analog-quality classes.', 'k-means assumes roughly spherical groups in standardised space; a low silhouette means the candidate space is a continuum rather than distinct types.', 'Outliers are statistical (top 1 % Mahalanobis distance): unusual feature combinations, which may equally be data artefacts.', 'Rows with any missing feature are excluded, not imputed.'] };
}
