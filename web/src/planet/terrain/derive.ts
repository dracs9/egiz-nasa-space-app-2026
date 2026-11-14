// EGIZ Planetary Studio · terrain-derived products. Pure functions of the measured analysis grid:
// every raster here is "terrain-derived" from elevation by the stated algorithm, at a stated baseline.
// No function interpolates beyond the grid or fills missing data; NaN propagates.
import { fieldRange, type Field } from '../../astral/world/field';

export interface Raster { side: number; west: number; north: number; cell: number; data: Float32Array; unit: string; baselineM: number }
const raster = (f: Field, data: Float32Array, unit: string, baselineM: number): Raster => ({ side: f.side, west: f.west, north: f.north, cell: f.posting, data, unit, baselineM });
const DEG = 180 / Math.PI;

/** Slope (deg) and downslope aspect (deg clockwise from north) by central differences over `baselineM` (snapped to whole posts). */
export function slopeAspect(f: Field, baselineM = f.posting): { slope: Raster; aspect: Raster; gx: Float32Array; gy: Float32Array } {
  const k = Math.max(1, Math.round(baselineM / f.posting)), n = f.side, b = k * f.posting;
  const slope = new Float32Array(n * n).fill(NaN), aspect = new Float32Array(n * n).fill(NaN), gx = new Float32Array(n * n).fill(NaN), gy = new Float32Array(n * n).fill(NaN);
  for (let r = k; r < n - k; r++) for (let c = k; c < n - k; c++) {
    const i = r * n + c, dx = (f.z[i + k] - f.z[i - k]) / (2 * b), dy = (f.z[i - k * n] - f.z[i + k * n]) / (2 * b);
    if (Number.isNaN(dx + dy)) continue;
    gx[i] = dx; gy[i] = dy; slope[i] = Math.atan(Math.hypot(dx, dy)) * DEG;
    aspect[i] = Math.hypot(dx, dy) > 1e-9 ? (Math.atan2(-dx, -dy) * DEG + 360) % 360 : NaN;
  }
  return { slope: raster(f, slope, 'deg', b), aspect: raster(f, aspect, 'deg', b), gx, gy };
}

/** RMS height residual about the least-squares plane in a (2·half+1)² post window (m). */
export function roughnessRaster(f: Field, half = 2): Raster {
  const n = f.side, out = new Float32Array(n * n).fill(NaN), w = 2 * half + 1, count = w * w;
  let sxx = 0; for (let d = -half; d <= half; d++) sxx += d * d * w;
  for (let r = half; r < n - half; r++) for (let c = half; c < n - half; c++) {
    let sz = 0, sxz = 0, syz = 0, szz = 0;
    for (let dr = -half; dr <= half; dr++) { const row = (r + dr) * n + c; for (let dc = -half; dc <= half; dc++) { const z = f.z[row + dc]; sz += z; sxz += dc * z; syz += dr * z; szz += z * z; } }
    if (Number.isNaN(sz)) continue;
    // Residual sum of squares of the plane fit on a centred, symmetric window (closed form).
    const ss = szz - (sz * sz) / count - (sxz * sxz) / sxx - (syz * syz) / sxx;
    out[r * n + c] = Math.sqrt(Math.max(0, ss) / count);
  }
  return raster(f, out, 'm', w * f.posting);
}

/** Laplacian of elevation (1/m) over `baselineM`: negative on convex forms (ridges, rims), positive in concave forms (valleys, floors). */
export function curvatureRaster(f: Field, baselineM = f.posting): Raster {
  const k = Math.max(1, Math.round(baselineM / f.posting)), n = f.side, b = k * f.posting, out = new Float32Array(n * n).fill(NaN);
  for (let r = k; r < n - k; r++) for (let c = k; c < n - k; c++) { const i = r * n + c; out[i] = (f.z[i + k] + f.z[i - k] + f.z[i + k * n] + f.z[i - k * n] - 4 * f.z[i]) / (b * b); }
  return raster(f, out, '1/m', b);
}

/** Topographic position index: elevation minus the mean of a (2k+1)² window (m). Uses a NaN-aware summed-area table. */
export function tpiRaster(f: Field, radiusM: number): Raster {
  const n = f.side, k = Math.max(1, Math.round(radiusM / f.posting)), m = n + 1;
  const sum = new Float64Array(m * m), cnt = new Int32Array(m * m);
  for (let r = 0; r < n; r++) { let rs = 0, rc = 0; for (let c = 0; c < n; c++) { const z = f.z[r * n + c]; if (!Number.isNaN(z)) { rs += z; rc++; } sum[(r + 1) * m + c + 1] = sum[r * m + c + 1] + rs; cnt[(r + 1) * m + c + 1] = cnt[r * m + c + 1] + rc; } }
  const out = new Float32Array(n * n).fill(NaN);
  for (let r = k; r < n - k; r++) for (let c = k; c < n - k; c++) {
    const r0 = r - k, r1 = r + k + 1, c0 = c - k, c1 = c + k + 1, q = cnt[r1 * m + c1] - cnt[r0 * m + c1] - cnt[r1 * m + c0] + cnt[r0 * m + c0];
    if (q < (2 * k + 1) ** 2 * 0.9 || Number.isNaN(f.z[r * n + c])) continue;
    out[r * n + c] = f.z[r * n + c] - (sum[r1 * m + c1] - sum[r0 * m + c1] - sum[r1 * m + c0] + sum[r0 * m + c0]) / q;
  }
  return raster(f, out, 'm', (2 * k + 1) * f.posting);
}
export const elevationRaster = (f: Field): Raster => raster(f, f.z, 'm', f.posting);

export interface Stats { n: number; valid: number; min: number; max: number; mean: number; p5: number; p25: number; p50: number; p75: number; p90: number; p95: number }
export function stats(data: ArrayLike<number>): Stats {
  const v: number[] = [];
  for (let i = 0; i < data.length; i++) if (Number.isFinite(data[i])) v.push(data[i]);
  const s = Float64Array.from(v).sort(), q = (p: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN);
  let sum = 0; for (const x of s) sum += x;
  return { n: data.length, valid: s.length, min: s.length ? s[0] : NaN, max: s.length ? s[s.length - 1] : NaN, mean: s.length ? sum / s.length : NaN, p5: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9), p95: q(0.95) };
}
/** Normalised histogram (fractions of valid samples) over [lo, hi). */
export function histogram(data: ArrayLike<number>, lo: number, hi: number, bins: number): number[] {
  const h = new Array<number>(bins).fill(0); let n = 0;
  for (let i = 0; i < data.length; i++) { const v = data[i]; if (!Number.isFinite(v)) continue; n++; h[Math.max(0, Math.min(bins - 1, Math.floor(((v - lo) / (hi - lo)) * bins)))]++; }
  return h.map(x => (n ? x / n : 0));
}
/** 1-Wasserstein distance between two empirical distributions (same unit as the data), by quantile integration. */
export function wasserstein1(a: ArrayLike<number>, b: ArrayLike<number>, quantiles = 200): number {
  const sorted = (d: ArrayLike<number>) => { const v: number[] = []; for (let i = 0; i < d.length; i++) if (Number.isFinite(d[i])) v.push(d[i]); return Float64Array.from(v).sort(); };
  const x = sorted(a), y = sorted(b);
  if (!x.length || !y.length) return NaN;
  let s = 0;
  for (let i = 0; i < quantiles; i++) { const p = (i + 0.5) / quantiles; s += Math.abs(x[Math.floor(p * x.length)] - y[Math.floor(p * y.length)]); }
  return s / quantiles;
}

const bilinear = (f: Field, x: number, y: number): number => { // NaN = no data here; -Infinity = outside the grid
  const col = (x - f.west) / f.posting, row = (f.north - y) / f.posting;
  if (!(col >= 0 && row >= 0 && col <= f.side - 1 && row <= f.side - 1)) return -Infinity;
  const c = Math.min(f.side - 2, Math.floor(col)), r = Math.min(f.side - 2, Math.floor(row)), i = r * f.side + c, u = col - c, v = row - r;
  return f.z[i] * (1 - u) * (1 - v) + f.z[i + 1] * u * (1 - v) + f.z[i + f.side] * (1 - u) * v + f.z[i + f.side + 1] * u * v;
};
/**
 * Is the Sun's centre visible from (x, y, z0 + 0.5 m)? Marches toward the Sun through `occluder`, with the
 * body-curvature term d²/2R so distant relief drops below the tangent plane as it should. Terrain outside
 * the occluder grid cannot cast a shadow (a stated limitation, not an assumption of flatness).
 */
export function sunVisible(occluder: Field, zmax: number, x: number, y: number, z0: number, sunEnu: number[], radiusM: number): boolean {
  if (sunEnu[2] <= 0) return false;
  const hz = Math.hypot(sunEnu[0], sunEnu[1]);
  if (hz < 1e-6) return true;
  const ux = sunEnu[0] / hz, uy = sunEnu[1] / hz, rise = sunEnu[2] / hz;
  for (let d = occluder.posting; ; d += Math.max(occluder.posting, d * 0.04)) {
    const ray = z0 + 0.5 + rise * d + (d * d) / (2 * radiusM);
    if (ray > zmax) return true;
    const z = bilinear(occluder, x + ux * d, y + uy * d);
    if (z === -Infinity) return true;
    if (z > ray) return false;
  }
}
/** Terrain shadow mask on the analysis grid at `stride` posts (1 = shadowed, 255 = no data). */
export function shadowRaster(f: Field, occluder: Field, sunEnu: number[], radiusM: number, stride = 2): { side: number; cell: number; data: Uint8Array } {
  const side = Math.floor((f.side - 1) / stride) + 1, data = new Uint8Array(side * side), zmax = fieldRange(occluder).max;
  for (let r = 0; r < side; r++) for (let c = 0; c < side; c++) {
    const z0 = f.z[r * stride * f.side + c * stride];
    data[r * side + c] = Number.isNaN(z0) ? 255 : sunVisible(occluder, zmax, f.west + c * stride * f.posting, f.north - r * stride * f.posting, z0, sunEnu, radiusM) ? 0 : 1;
  }
  return { side, cell: f.posting * stride, data };
}

export interface SunStep { sunEnu: number[]; fluxWm2: number; transmission: number }
/**
 * Direct-beam insolation over a set of Sun samples: fraction of samples with the Sun's centre visible, and the
 * mean direct irradiance on the local surface (W/m², flux × declared beam transmission × cos incidence).
 * This is the solar ENERGY product; it is independent of how the 3D scene is lit.
 */
export function insolation(f: Field, occluder: Field, steps: SunStep[], radiusM: number, stride = 4, onProgress?: (done: number, total: number) => void): { lit: Raster; irradiance: Raster } {
  const side = Math.floor((f.side - 1) / stride) + 1, lit = new Float32Array(side * side), irr = new Float32Array(side * side), zmax = fieldRange(occluder).max, b = f.posting;
  steps.forEach((s, k) => {
    for (let r = 0; r < side; r++) for (let c = 0; c < side; c++) {
      const fr = Math.min(f.side - 2, Math.max(1, r * stride)), fc = Math.min(f.side - 2, Math.max(1, c * stride)), i = fr * f.side + fc, z0 = f.z[i], o = r * side + c;
      if (Number.isNaN(z0)) { lit[o] = NaN; irr[o] = NaN; continue; }
      if (!sunVisible(occluder, zmax, f.west + fc * b, f.north - fr * b, z0, s.sunEnu, radiusM)) continue;
      const gx = (f.z[i + 1] - f.z[i - 1]) / (2 * b), gy = (f.z[i - f.side] - f.z[i + f.side]) / (2 * b);
      const cos = Number.isNaN(gx + gy) ? s.sunEnu[2] : (-gx * s.sunEnu[0] - gy * s.sunEnu[1] + s.sunEnu[2]) / Math.hypot(gx, gy, 1);
      lit[o] += 1; irr[o] += s.fluxWm2 * s.transmission * Math.max(0, cos);
    }
    onProgress?.(k + 1, steps.length);
  });
  const n = Math.max(1, steps.length);
  for (let i = 0; i < lit.length; i++) { lit[i] /= n; irr[i] /= n; }
  const meta = { side, west: f.west, north: f.north, cell: f.posting * stride, baselineM: 2 * b };
  return { lit: { ...meta, data: lit, unit: 'fraction' }, irradiance: { ...meta, data: irr, unit: 'W/m²' } };
}

/** Mobility screen from slope and roughness limits: 0 go, 1 caution (within 30 % of a limit), 2 slope no-go, 3 roughness no-go, 255 no data. */
export function mobilityClasses(slope: Raster, rough: Raster, limits: { maxSlopeDeg: number; maxStepM: number }): Uint8Array {
  const out = new Uint8Array(slope.data.length);
  for (let i = 0; i < out.length; i++) {
    const s = slope.data[i], q = rough.data[i];
    out[i] = Number.isNaN(s) || Number.isNaN(q) ? 255 : s > limits.maxSlopeDeg ? 2 : q > limits.maxStepM ? 3 : s > 0.7 * limits.maxSlopeDeg || q > 0.7 * limits.maxStepM ? 1 : 0;
  }
  return out;
}

export interface SiteSummary {
  postingM: number; baselineM: number; extentKm: number; validFraction: number; reliefM: number;
  elevation: Stats; slope: Stats; roughness: Stats; slopeHist: number[]; hypsometry: number[]; fractionBelow15: number; fractionAbove25: number;
}
/** Quantitative site description. `baselineM` makes slope comparable across sites of different posting. */
export function summarize(f: Field, baselineM = f.posting): SiteSummary {
  const { slope } = slopeAspect(f, baselineM), rough = roughnessRaster(f, 2), el = stats(f.z), sl = stats(slope.data);
  let lt15 = 0, gt25 = 0; for (const v of slope.data) if (Number.isFinite(v)) { if (v < 15) lt15++; if (v > 25) gt25++; }
  return { postingM: f.posting, baselineM: slope.baselineM, extentKm: ((f.side - 1) * f.posting) / 1000, validFraction: el.valid / el.n, reliefM: el.max - el.min, elevation: el, slope: sl, roughness: stats(rough.data),
    slopeHist: histogram(slope.data, 0, 45, 45), hypsometry: histogram(f.z, el.min, el.max + 1e-6, 40), fractionBelow15: lt15 / Math.max(1, sl.valid), fractionAbove25: gt25 / Math.max(1, sl.valid) };
}
/** Resample a field to a coarser posting by block mean of whole posts (used to compare sites at one common resolution). */
export function coarsen(f: Field, factor: number): Field {
  if (factor <= 1) return f;
  const side = Math.floor((f.side - 1) / factor) + 1, z = new Float32Array(side * side), h = Math.floor(factor / 2);
  for (let r = 0; r < side; r++) for (let c = 0; c < side; c++) {
    let s = 0, n = 0;
    for (let dr = -h; dr <= h; dr++) for (let dc = -h; dc <= h; dc++) { const rr = r * factor + dr, cc = c * factor + dc; if (rr < 0 || cc < 0 || rr >= f.side || cc >= f.side) continue; const v = f.z[rr * f.side + cc]; if (!Number.isNaN(v)) { s += v; n++; } }
    z[r * side + c] = n ? s / n : NaN;
  }
  return { side, posting: f.posting * factor, west: f.west, north: f.north, z, level: f.level, provenance: 'measured-area-average' };
}
