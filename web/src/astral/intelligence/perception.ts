// EGIZ ASTRAL · scene perception. Deterministic baselines and an unsupervised terrain-unit model that run on the
// measured site field and orthoimage. Outputs are interpretations, never observations: every result names its
// method, input resolution and limits. No labelled planetary training data is used anywhere in this file.
import type { Field, XY } from "../world/field.ts";

export interface SiteImage { side: number; pixelM: number; west: number; north: number; data: Uint8Array }
export interface FeatureGrid {
  side: number; cellM: number; west: number; north: number; names: string[];
  /** one Float32Array per feature; NaN where inputs are missing */ values: Float32Array[];
}
export const FEATURES = ["slope_deg", "roughness_m", "tpi_m", "brightness", "texture", "coherence"] as const;

function integral(src: ArrayLike<number>, side: number): Float64Array {
  const out = new Float64Array((side + 1) * (side + 1));
  for (let r = 0; r < side; r++) { let row = 0; for (let c = 0; c < side; c++) { row += src[r * side + c]; out[(r + 1) * (side + 1) + c + 1] = out[r * (side + 1) + c + 1] + row; } }
  return out;
}
const boxSum = (ii: Float64Array, side: number, r0: number, c0: number, r1: number, c1: number) => {
  r0 = Math.max(0, r0); c0 = Math.max(0, c0); r1 = Math.min(side, r1); c1 = Math.min(side, c1);
  return { sum: ii[r1 * (side + 1) + c1] - ii[r0 * (side + 1) + c1] - ii[r1 * (side + 1) + c0] + ii[r0 * (side + 1) + c0], n: (r1 - r0) * (c1 - c0) };
};

/** Per-cell terrain and image descriptors. Elevation features need only the field; image features are NaN without imagery. */
export function terrainFeatures(f: Field, image: SiteImage | null, cellM = 8): FeatureGrid {
  // At least one post per cell: coarse worlds (e.g. 32 m Earth GLO-30) use the native posting as the cell.
  const per = Math.max(1, Math.round(cellM / f.posting)), side = Math.floor((f.side - 1) / per), n = f.side;
  const valid = new Uint8Array(n * n), zz = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) if (!Number.isNaN(f.z[i])) { valid[i] = 1; zz[i] = f.z[i]; }
  const iz = integral(zz, n), iv = integral(valid, n);
  const slope = new Float32Array(side * side).fill(NaN), rough = slope.slice(), tpi = slope.slice(), bright = slope.slice(), texture = slope.slice(), coherence = slope.slice();
  for (let R = 0; R < side; R++) for (let C = 0; C < side; C++) {
    const r0 = R * per, c0 = C * per, cell = boxSum(iv, n, r0, c0, r0 + per, c0 + per);
    if (cell.sum < cell.n) continue;
    let s = 0, q = 0, count = 0;
    for (let r = Math.max(1, r0); r < Math.min(n - 1, r0 + per); r++) for (let c = Math.max(1, c0); c < Math.min(n - 1, c0 + per); c++) {
      const i = r * n + c, gx = (f.z[i + 1] - f.z[i - 1]) / (2 * f.posting), gy = (f.z[i - n] - f.z[i + n]) / (2 * f.posting);
      const local = boxSum(iz, n, r - 2, c - 2, r + 3, c + 3), lv = boxSum(iv, n, r - 2, c - 2, r + 3, c + 3);
      if (Number.isNaN(gx + gy) || lv.sum < lv.n) continue;
      s += (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI; q += (f.z[i] - local.sum / local.n) ** 2; count++;
    }
    if (!count) continue;
    const k = R * side + C, ring = Math.round(40 / f.posting);
    const wide = boxSum(iz, n, r0 - ring, c0 - ring, r0 + per + ring, c0 + per + ring), wv = boxSum(iv, n, r0 - ring, c0 - ring, r0 + per + ring, c0 + per + ring);
    slope[k] = s / count; rough[k] = Math.sqrt(q / count);
    tpi[k] = boxSum(iz, n, r0, c0, r0 + per, c0 + per).sum / cell.n - wide.sum / Math.max(1, wv.sum);
  }
  if (image) {
    const px = Math.round(cellM / image.pixelM), w = image.side, d = image.data;
    for (let R = 0; R < side; R++) for (let C = 0; C < side; C++) {
      let sum = 0, sq = 0, j11 = 0, j22 = 0, j12 = 0, count = 0, missing = false;
      for (let r = Math.max(1, R * px); r < Math.min(w - 1, (R + 1) * px) && !missing; r++) for (let c = Math.max(1, C * px); c < Math.min(w - 1, (C + 1) * px); c++) {
        const v = d[r * w + c];
        if (v === 0) { missing = true; break; }
        const gx = d[r * w + c + 1] - d[r * w + c - 1], gy = d[(r - 1) * w + c] - d[(r + 1) * w + c];
        sum += v; sq += v * v; j11 += gx * gx; j22 += gy * gy; j12 += gx * gy; count++;
      }
      if (missing || !count) continue;
      const k = R * side + C, mean = sum / count;
      bright[k] = mean; texture[k] = Math.sqrt(Math.max(0, sq / count - mean * mean));
      coherence[k] = Math.hypot(j11 - j22, 2 * j12) / (j11 + j22 + 1e-6);
    }
  }
  return { side, cellM: per * f.posting, west: f.west, north: f.north, names: [...FEATURES], values: [slope, rough, tpi, bright, texture, coherence] };
}
export const cellCentre = (g: FeatureGrid, k: number): XY => ({ x: g.west + ((k % g.side) + 0.5) * g.cellM, y: g.north - (Math.floor(k / g.side) + 0.5) * g.cellM });
export const cellAt = (g: FeatureGrid, p: XY) => { const c = Math.floor((p.x - g.west) / g.cellM), r = Math.floor((g.north - p.y) / g.cellM); return c >= 0 && r >= 0 && c < g.side && r < g.side ? r * g.side + c : -1; };

export const TERRAIN_CLASSES = [
  { id: 0, key: "nodata", label: "No data", color: "#000000", rule: "missing elevation" },
  { id: 1, key: "steep", label: "Steep slope", color: "#d2553f", rule: "mean slope ≥ 20°" },
  { id: 2, key: "moderate", label: "Moderate slope", color: "#d9a441", rule: "mean slope 10–20°" },
  { id: 3, key: "rough", label: "Rough / blocky surface", color: "#9b6fd0", rule: "10 m detrended relief RMS ≥ 0.20 m" },
  { id: 4, key: "lineated", label: "Aligned linear texture", color: "#3fa7c9", rule: "image structure-tensor coherence ≥ 0.45 with above-median texture on gentle, smooth ground (candidate aeolian bedforms or fracture sets)" },
  { id: 5, key: "depression", label: "Local depression", color: "#4c78c8", rule: "topographic position ≤ −1.0 m within 40 m" },
  { id: 6, key: "high", label: "Local high / crest", color: "#c9b77a", rule: "topographic position ≥ +1.0 m within 40 m" },
  { id: 7, key: "smooth", label: "Smooth, gentle surface", color: "#5a9d76", rule: "none of the above" },
] as const;
export const CLASSIFIER = { id: "egiz-geomorph-rules-v1", kind: "rule baseline", note: "Fixed thresholds on measured-terrain and image descriptors. Not a geological map: classes describe shape and texture, not lithology or origin. Unvalidated against field or expert labels." };
/** Rule baseline over the feature grid. */
export function classifyTerrain(g: FeatureGrid): Uint8Array {
  const [slope, rough, tpi, , texture, coherence] = g.values, out = new Uint8Array(g.side * g.side);
  const textures = Array.from(texture).filter(v => !Number.isNaN(v)).sort((a, b) => a - b), median = textures[textures.length >> 1] ?? Infinity;
  for (let k = 0; k < out.length; k++) {
    if (Number.isNaN(slope[k])) continue;
    out[k] = slope[k] >= 20 ? 1 : slope[k] >= 10 ? 2 : rough[k] >= 0.2 ? 3 : coherence[k] >= 0.45 && texture[k] >= median ? 4 : tpi[k] <= -1 ? 5 : tpi[k] >= 1 ? 6 : 7;
  }
  return out;
}

export function mulberry32(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export interface TerrainUnitModel {
  id: "egiz-terrain-units-kmeans-v1"; k: number; seed: number; features: string[]; mean: number[]; std: number[];
  centroids: number[][]; sizes: number[]; spread: number[]; trainedCells: number;
  assignment: Int16Array; /** distance to own centroid ÷ that unit's mean distance */ anomaly: Float32Array; anomalyThreshold: number;
}
/** Unsupervised terrain units: seeded k-means++ on standardised descriptors, fitted in-session on this site only. */
export function fitTerrainUnits(g: FeatureGrid, k = 6, seed = 20261113): TerrainUnitModel {
  const dims = g.values.filter(v => v.some(x => !Number.isNaN(x))), names = g.names.filter((_, i) => g.values[i].some(x => !Number.isNaN(x)));
  const cells: number[] = [];
  for (let i = 0; i < g.side * g.side; i++) if (dims.every(v => !Number.isNaN(v[i]))) cells.push(i);
  if (cells.length < k * 20) throw new Error("Too few valid cells to fit terrain units");
  const mean = dims.map(v => cells.reduce((s, i) => s + v[i], 0) / cells.length);
  const std = dims.map((v, d) => Math.sqrt(cells.reduce((s, i) => s + (v[i] - mean[d]) ** 2, 0) / cells.length) || 1);
  const D = dims.length, X = new Float32Array(cells.length * D);
  cells.forEach((i, row) => dims.forEach((v, d) => { X[row * D + d] = (v[i] - mean[d]) / std[d]; }));
  const random = mulberry32(seed), dist = (row: number, c: number[]) => { let s = 0; for (let d = 0; d < D; d++) s += (X[row * D + d] - c[d]) ** 2; return s; };
  const first = Math.floor(random() * cells.length), centroids: number[][] = [Array.from(X.subarray(first * D, first * D + D))];
  const nearest = new Float64Array(cells.length).fill(Infinity);
  while (centroids.length < k) {
    let total = 0;
    for (let row = 0; row < cells.length; row++) { nearest[row] = Math.min(nearest[row], dist(row, centroids[centroids.length - 1])); total += nearest[row]; }
    let pick = random() * total, row = 0;
    while (row < cells.length - 1 && (pick -= nearest[row]) > 0) row++;
    centroids.push(Array.from(X.subarray(row * D, row * D + D)));
  }
  const label = new Int16Array(cells.length);
  for (let iteration = 0; iteration < 30; iteration++) {
    let moved = 0;
    const sums = centroids.map(() => new Float64Array(D)), counts = new Array(k).fill(0);
    for (let row = 0; row < cells.length; row++) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) { const d = dist(row, centroids[c]); if (d < bestD) { bestD = d; best = c; } }
      if (label[row] !== best) { label[row] = best; moved++; }
      counts[best]++; for (let d = 0; d < D; d++) sums[best][d] += X[row * D + d];
    }
    for (let c = 0; c < k; c++) if (counts[c]) centroids[c] = Array.from(sums[c], v => v / counts[c]);
    if (!moved) break;
  }
  // Order units by mean slope so identifiers are stable across runs and readable.
  const order = centroids.map((_, c) => c).sort((a, b) => centroids[a][0] - centroids[b][0]), rank = order.map((_, i) => order.indexOf(i));
  const sorted = order.map(c => centroids[c]), sizes = new Array(k).fill(0), spread = new Array(k).fill(0);
  const assignment = new Int16Array(g.side * g.side).fill(-1), anomaly = new Float32Array(g.side * g.side).fill(NaN), raw = new Float32Array(cells.length);
  for (let row = 0; row < cells.length; row++) { const u = rank[label[row]]; raw[row] = Math.sqrt(dist(row, sorted[u])); sizes[u]++; spread[u] += raw[row]; assignment[cells[row]] = u; }
  for (let u = 0; u < k; u++) spread[u] /= Math.max(1, sizes[u]);
  const scores: number[] = [];
  for (let row = 0; row < cells.length; row++) { const s = raw[row] / (spread[assignment[cells[row]]] || 1); anomaly[cells[row]] = s; scores.push(s); }
  scores.sort((a, b) => a - b);
  return { id: "egiz-terrain-units-kmeans-v1", k, seed, features: names, mean, std, centroids: sorted.map(c => c.map((v, d) => v * std[d] + mean[d])), sizes, spread, trainedCells: cells.length, assignment, anomaly, anomalyThreshold: scores[Math.floor(scores.length * 0.99)] };
}
/** Query by example: similarity of every cell to a reference cell in the standardised descriptor space (1 = identical). */
export function similarTo(g: FeatureGrid, model: TerrainUnitModel, reference: number): Float32Array {
  const dims = model.features.map(name => g.values[g.names.indexOf(name)]), out = new Float32Array(g.side * g.side).fill(NaN);
  if (dims.some(v => Number.isNaN(v[reference]))) return out;
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    for (let d = 0; d < dims.length; d++) s += ((dims[d][i] - dims[d][reference]) / model.std[d]) ** 2;
    if (!Number.isNaN(s)) out[i] = Math.exp(-s / (2 * dims.length));
  }
  return out;
}

export interface Crater extends XY { id: string; radiusM: number; depthM: number; depthToDiameter: number; rimFraction: number; confidence: number }
export const CRATER_DETECTOR = { id: "egiz-dtm-depression-v1", kind: "terrain-derived baseline", note: "Circular closed depressions with a raised rim, searched at radii 8–96 m on the site field. Degraded, filled, overlapping or sub-16 m craters are missed; pits and scour hollows can be false positives. Unvalidated against a crater catalogue." };
/** Circular depression search on measured elevation. */
export function detectCraters(f: Field, stride = 2): Crater[] {
  const radii = [8, 12, 16, 24, 32, 48, 64, 96], found: Crater[] = [], n = f.side;
  const at = (r: number, c: number) => (r < 0 || c < 0 || r >= n || c >= n ? NaN : f.z[r * n + c]);
  const cos = Array.from({ length: 16 }, (_, i) => Math.cos((i * Math.PI) / 8)), sin = cos.map((_, i) => Math.sin((i * Math.PI) / 8));
  for (const R of radii) {
    const k = R / f.posting;
    if (k < 3) continue;
    for (let r = Math.ceil(k); r < n - k; r += stride) for (let c = Math.ceil(k); c < n - k; c += stride) {
      let centre = at(r, c), ringMean = 0, a = 0, b = 0;
      const ring: number[] = [];
      for (let i = 0; i < 8; i++) centre += at(Math.round(r + (sin[i * 2] * k) / 4), Math.round(c + (cos[i * 2] * k) / 4));
      centre /= 9;
      for (let i = 0; i < 16; i++) { const z = at(Math.round(r + sin[i] * k), Math.round(c + cos[i] * k)); ring.push(z); ringMean += z; a += z * cos[i]; b += z * sin[i]; }
      if (Number.isNaN(centre + ringMean)) continue;
      ringMean /= 16; a /= 8; b /= 8; // first harmonic = regional tilt across the ring
      const depth = ringMean - centre;
      if (depth < 0.03 * 2 * R) continue;
      let rim = 0;
      for (let i = 0; i < 16; i++) if (ring[i] - a * cos[i] - b * sin[i] - centre > 0.5 * depth) rim++;
      if (rim < 13) continue;
      found.push({ id: "", x: f.west + c * f.posting, y: f.north - r * f.posting, radiusM: R, depthM: depth, depthToDiameter: depth / (2 * R), rimFraction: rim / 16, confidence: Math.min(1, (depth / (2 * R)) / 0.1) * (rim / 16) });
    }
  }
  found.sort((p, q) => q.confidence * q.radiusM - p.confidence * p.radiusM);
  const kept: Crater[] = [];
  for (const c of found) if (!kept.some(o => Math.hypot(o.x - c.x, o.y - c.y) < Math.max(o.radiusM, c.radiusM))) kept.push(c);
  return kept.map(c => ({ ...c, id: `crater:${Math.round(c.x)}:${Math.round(c.y)}:${c.radiusM}` }));
}

export interface ShadingFit { azimuthDeg: number; elevationDeg: number; r2: number; offsetM: XY; offsetR2Gain: number; samples: number }
/** Least-squares fit of image brightness to terrain gradients: recovers the image's illumination azimuth and tests
 *  image–terrain registration (the fit should peak at zero offset). Elevation is biased high by sky light. */
export function fitShading(f: Field, image: SiteImage): ShadingFit | null {
  const scale = Math.round(f.posting / image.pixelM), n = f.side - 1, w = image.side;
  if (scale < 1 || n * scale > w) return null;
  const b = new Float32Array(n * n).fill(NaN), gx = b.slice(), gy = b.slice();
  for (let r = 1; r < n - 1; r++) for (let c = 1; c < n - 1; c++) {
    let sum = 0, bad = false;
    for (let dr = 0; dr < scale; dr++) for (let dc = 0; dc < scale; dc++) { const v = image.data[(r * scale + dr) * w + c * scale + dc]; if (v === 0 || v === 255) bad = true; sum += v; }
    if (!bad) b[r * n + c] = sum / (scale * scale);
    // cell-centred gradients from the four surrounding posts
    const i = r * f.side + c, z00 = f.z[i], z01 = f.z[i + 1], z10 = f.z[i + f.side], z11 = f.z[i + f.side + 1];
    gx[r * n + c] = (z01 + z11 - z00 - z10) / (2 * f.posting); gy[r * n + c] = (z00 + z01 - z10 - z11) / (2 * f.posting);
  }
  const fit = (dr: number, dc: number) => {
    let N = 0, sx = 0, sy = 0, sb = 0, sxx = 0, syy = 0, sxy = 0, sxb = 0, syb = 0, sbb = 0;
    for (let r = 12; r < n - 12; r += 2) for (let c = 12; c < n - 12; c += 2) {
      const v = b[(r + dr) * n + c + dc], x = gx[r * n + c], y = gy[r * n + c];
      if (Number.isNaN(v + x + y)) continue;
      N++; sx += x; sy += y; sb += v; sxx += x * x; syy += y * y; sxy += x * y; sxb += x * v; syb += y * v; sbb += v * v;
    }
    if (N < 1000) return null;
    const cxx = sxx - (sx * sx) / N, cyy = syy - (sy * sy) / N, cxy = sxy - (sx * sy) / N, cxb = sxb - (sx * sb) / N, cyb = syb - (sy * sb) / N, cbb = sbb - (sb * sb) / N;
    const det = cxx * cyy - cxy * cxy;
    if (Math.abs(det) < 1e-12 || cbb <= 0) return null;
    const c1 = (cxb * cyy - cyb * cxy) / det, c2 = (cyb * cxx - cxb * cxy) / det, c0 = sb / N - (c1 * sx) / N - (c2 * sy) / N;
    return { c0, c1, c2, r2: (c1 * cxb + c2 * cyb) / cbb, N };
  };
  const zero = fit(0, 0);
  if (!zero) return null;
  let best = { dr: 0, dc: 0, r2: zero.r2 };
  for (let dr = -4; dr <= 4; dr++) for (let dc = -4; dc <= 4; dc++) { const s = fit(dr, dc); if (s && s.r2 > best.r2) best = { dr, dc, r2: s.r2 }; }
  return { azimuthDeg: ((Math.atan2(-zero.c1, -zero.c2) * 180) / Math.PI + 360) % 360, elevationDeg: (Math.atan2(zero.c0, Math.hypot(zero.c1, zero.c2)) * 180) / Math.PI,
    r2: zero.r2, offsetM: { x: best.dc * f.posting, y: -best.dr * f.posting }, offsetR2Gain: best.r2 - zero.r2, samples: zero.N };
}

export interface ImagePatch { width: number; height: number; pixelM: number; west: number; north: number; data: Uint8Array; tileKey: string }
export interface Rock extends XY { id: string; diameterM: number; shadowLengthM: number; contrast: number; litFace: boolean; confidence: number; tileKey: string }
export const ROCK_DETECTOR = { id: "egiz-shadow-segmentation-v1", kind: "image-derived baseline", note: "Segments compact shadows darker than the local background and requires a brighter sun-facing neighbour, after the shadow-based rock mapping approach used for HiRISE landing-site studies (Golombek et al. 2008). Diameter is the shadow width across the Sun direction. Rocks under about 1.5 m are badly incomplete at 0.25 m/px; dark sand patches, scarps and small pits produce false positives. Positions are good to about one diameter. Unvalidated against rover ground truth here." };
/** Shadow-segmentation rock candidates in one image patch. `sunAzimuthDeg` is where the Sun was for this image. */
export function detectRocks(patch: ImagePatch, sunAzimuthDeg: number): Rock[] {
  const { width: w, height: h, data } = patch, half = 16, ii = new Float64Array((w + 1) * (h + 1)), i2 = new Float64Array((w + 1) * (h + 1));
  for (let r = 0; r < h; r++) { let s = 0, q = 0; for (let c = 0; c < w; c++) { const v = data[r * w + c]; s += v; q += v * v; ii[(r + 1) * (w + 1) + c + 1] = ii[r * (w + 1) + c + 1] + s; i2[(r + 1) * (w + 1) + c + 1] = i2[r * (w + 1) + c + 1] + q; } }
  const stats = (r: number, c: number) => {
    const r0 = Math.max(0, r - half), c0 = Math.max(0, c - half), r1 = Math.min(h, r + half + 1), c1 = Math.min(w, c + half + 1), n = (r1 - r0) * (c1 - c0);
    const s = ii[r1 * (w + 1) + c1] - ii[r0 * (w + 1) + c1] - ii[r1 * (w + 1) + c0] + ii[r0 * (w + 1) + c0], q = i2[r1 * (w + 1) + c1] - i2[r0 * (w + 1) + c1] - i2[r1 * (w + 1) + c0] + i2[r0 * (w + 1) + c0];
    return { mean: s / n, std: Math.sqrt(Math.max(0, q / n - (s / n) ** 2)) };
  };
  const dark = new Uint8Array(w * h), z = new Float32Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) { const v = data[r * w + c]; if (v === 0) continue; const s = stats(r, c); z[r * w + c] = (s.mean - v) / (s.std + 1); if (v < s.mean - 2 * s.std && v < 0.85 * s.mean) dark[r * w + c] = 1; }
  // unit vector pointing toward the Sun in image (col, row) coordinates; rows increase southward
  const ux = Math.sin((sunAzimuthDeg * Math.PI) / 180), uy = -Math.cos((sunAzimuthDeg * Math.PI) / 180);
  const seen = new Uint8Array(w * h), rocks: Rock[] = [], stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!dark[start] || seen[start]) continue;
    stack.push(start); seen[start] = 1;
    let area = 0, sc = 0, sr = 0, lo = Infinity, hi = -Infinity, plo = Infinity, phi = -Infinity, zs = 0, edge = false;
    while (stack.length) {
      const i = stack.pop()!, c = i % w, r = (i - c) / w;
      area++; sc += c; sr += r; zs += z[i];
      const along = c * ux + r * uy, across = -c * uy + r * ux;
      lo = Math.min(lo, along); hi = Math.max(hi, along); plo = Math.min(plo, across); phi = Math.max(phi, across);
      if (c === 0 || r === 0 || c === w - 1 || r === h - 1) edge = true;
      for (const j of [i - 1, i + 1, i - w, i + w]) if (j >= 0 && j < w * h && dark[j] && !seen[j] && Math.abs((j % w) - c) <= 1) { seen[j] = 1; stack.push(j); }
    }
    const length = hi - lo + 1, width = phi - plo + 1;
    if (edge || area < 4 || area > 900 || width < 2 || length > 6 * width || area < 0.45 * length * width) continue;
    const cc = sc / area, cr = sr / area, bc = Math.round(cc + ux * (length / 2 + 1.5)), br = Math.round(cr + uy * (length / 2 + 1.5));
    const lit = bc >= 0 && br >= 0 && bc < w && br < h && data[br * w + bc] > stats(br, bc).mean;
    const diameterM = width * patch.pixelM, contrast = zs / area;
    // The rock sits at the sunward end of its shadow, half a diameter further toward the Sun.
    const x = patch.west + (cc + ux * (length / 2 + width / 2) + 0.5) * patch.pixelM, y = patch.north - (cr + uy * (length / 2 + width / 2) + 0.5) * patch.pixelM;
    rocks.push({ id: `rock:${patch.tileKey}:${Math.round(x * 2)}:${Math.round(y * 2)}`, x, y, diameterM, shadowLengthM: length * patch.pixelM, contrast, litFace: lit, confidence: Math.min(1, contrast / 4) * (lit ? 1 : 0.4) * Math.min(1, diameterM / 1.5), tileKey: patch.tileKey });
  }
  return rocks;
}

export interface QualityFinding { check: string; status: "ok" | "warning" | "fail" | "info"; detail: string }
/** Automated data-quality checks on the loaded world; each finding states what was measured. */
export function dataQuality(f: Field, image: SiteImage | null, shading: ShadingFit | null): QualityFinding[] {
  const out: QualityFinding[] = [];
  let missing = 0, min = Infinity, max = -Infinity, spikes = 0;
  for (let i = 0; i < f.z.length; i++) { const z = f.z[i]; if (Number.isNaN(z)) { missing++; continue; } if (z < min) min = z; if (z > max) max = z; if (i % f.side && Math.abs(z - f.z[i - 1]) > 4 * f.posting) spikes++; }
  const coverage = 1 - missing / f.z.length;
  out.push({ check: "Elevation coverage", status: coverage > 0.999 ? "ok" : coverage > 0.95 ? "warning" : "fail", detail: `${(coverage * 100).toFixed(2)}% of ${f.posting} m posts carry a measured elevation.` });
  out.push({ check: "Elevation range", status: max - min < 5000 ? "ok" : "fail", detail: `${min.toFixed(1)} to ${max.toFixed(1)} m above the source datum (relief ${(max - min).toFixed(1)} m).` });
  out.push({ check: "Elevation discontinuities", status: spikes / f.z.length < 1e-4 ? "ok" : "warning", detail: `${spikes} post-to-post steps exceed 76° (possible stereo-matching artifacts or true scarps).` });
  if (!image) out.push({ check: "Imagery", status: "warning", detail: "No orthoimage in this world package; image-based interpretation is unavailable." });
  else {
    let zero = 0, sat = 0;
    for (const v of image.data) { if (v === 0) zero++; else if (v === 255) sat++; }
    out.push({ check: "Image coverage", status: zero / image.data.length < 0.001 ? "ok" : "warning", detail: `${((zero / image.data.length) * 100).toFixed(2)}% no-data pixels, ${((sat / image.data.length) * 100).toFixed(2)}% saturated at ${image.pixelM} m/px.` });
    if (!shading) out.push({ check: "Image–terrain registration", status: "warning", detail: "Shading fit could not be computed." });
    else {
      const shift = Math.hypot(shading.offsetM.x, shading.offsetM.y);
      out.push({ check: "Image–terrain registration", status: shift <= f.posting && shading.r2 > 0.05 ? "ok" : shading.r2 <= 0.05 ? "info" : "warning",
        detail: `Brightness–slope correlation R² ${shading.r2.toFixed(3)} over ${shading.samples} cells; best alignment at offset (${shading.offsetM.x.toFixed(0)}, ${shading.offsetM.y.toFixed(0)}) m${shift > 0 ? `, improving R² by ${shading.offsetR2Gain.toFixed(3)}` : ""}. Search resolution ${f.posting} m.` });
      out.push({ check: "Image illumination", status: "info", detail: `Shading implies the Sun at azimuth ${shading.azimuthDeg.toFixed(0)}° when the image was taken (apparent elevation ${shading.elevationDeg.toFixed(0)}°, biased high by sky light and albedo variation).` });
    }
  }
  return out;
}
