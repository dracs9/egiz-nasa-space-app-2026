// EGIZ ASTRAL · site height field. The single terrain representation shared by the renderer overlays,
// spatial analysis, perception, routing and rover simulation. Assembled only from measured world tiles.
import { decodeHeights, type WorldManifest, type WorldTile } from "./core.ts";

export interface Field {
  /** posts per side */ side: number; /** metres between posts */ posting: number;
  west: number; north: number; /** row 0 is north; NaN = no data */ z: Float32Array;
  level: number; provenance: "measured" | "measured-area-average";
}
export interface XY { x: number; y: number }

/** Stitch every tile of one level into a site-wide grid (shared edge posts coincide). */
export function assembleField(m: WorldManifest, level: number, tiles: Map<string, Float32Array>): Field {
  const info = m.levels[level], e = m.encoding, n = info.tiles_per_side, side = n * e.posts + 1;
  const z = new Float32Array(side * side).fill(NaN);
  for (const t of m.tiles) {
    if (t.level !== level) continue;
    const data = tiles.get(t.key);
    if (!data) throw new Error(`World tile ${t.key} is missing; the site field would be incomplete`);
    for (let r = 0; r <= e.posts; r++) for (let c = 0; c <= e.posts; c++)
      z[(t.row * e.posts + r) * side + t.col * e.posts + c] = data[(r + e.apron) * e.side + c + e.apron];
  }
  return { side, posting: info.posting_m, west: m.extent.west, north: m.extent.north, z, level, provenance: level === m.levels.length - 1 ? "measured" : "measured-area-average" };
}
export async function loadField(m: WorldManifest, level: number, fetchTile: (t: WorldTile) => Promise<ArrayBuffer>): Promise<Field> {
  const wanted = m.tiles.filter(t => t.level === level), tiles = new Map<string, Float32Array>();
  await Promise.all(wanted.map(async t => { tiles.set(t.key, decodeHeights(await fetchTile(t), m.encoding)); }));
  return assembleField(m, level, tiles);
}

export const inside = (f: Field, p: XY) => p.x >= f.west && p.y <= f.north && p.x <= f.west + (f.side - 1) * f.posting && p.y >= f.north - (f.side - 1) * f.posting;
/** Bilinear elevation; null outside coverage or next to missing data. */
export function sample(f: Field, p: XY): number | null {
  const col = (p.x - f.west) / f.posting, row = (f.north - p.y) / f.posting;
  if (!(col >= 0 && row >= 0 && col <= f.side - 1 && row <= f.side - 1)) return null;
  const c = Math.min(f.side - 2, Math.floor(col)), r = Math.min(f.side - 2, Math.floor(row)), i = r * f.side + c;
  const a = f.z[i], b = f.z[i + 1], d = f.z[i + f.side], e = f.z[i + f.side + 1];
  if (Number.isNaN(a + b + d + e)) return null;
  const u = col - c, v = row - r;
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + d * (1 - u) * v + e * u * v;
}
/** Gradient (dz/dx east, dz/dy north) by central differences over `baseline` metres. */
export function gradient(f: Field, p: XY, baseline = f.posting): { gx: number; gy: number } | null {
  const w = sample(f, { x: p.x - baseline, y: p.y }), e = sample(f, { x: p.x + baseline, y: p.y });
  const s = sample(f, { x: p.x, y: p.y - baseline }), n = sample(f, { x: p.x, y: p.y + baseline });
  if (w === null || e === null || s === null || n === null) return null;
  return { gx: (e - w) / (2 * baseline), gy: (n - s) / (2 * baseline) };
}
export function slopeDeg(f: Field, p: XY, baseline = f.posting): number | null {
  const g = gradient(f, p, baseline);
  return g ? (Math.atan(Math.hypot(g.gx, g.gy)) * 180) / Math.PI : null;
}
/** Downslope-facing azimuth, degrees clockwise from north. */
export function aspectDeg(f: Field, p: XY, baseline = f.posting): number | null {
  const g = gradient(f, p, baseline);
  return g && Math.hypot(g.gx, g.gy) > 1e-9 ? ((Math.atan2(-g.gx, -g.gy) * 180) / Math.PI + 360) % 360 : null;
}
/** RMS height residual about the local plane in a (2·half+1)² post window: metre-scale roughness at the field posting. */
export function roughness(f: Field, p: XY, half = 2): number | null {
  const c0 = Math.round((p.x - f.west) / f.posting), r0 = Math.round((f.north - p.y) / f.posting);
  if (c0 < half || r0 < half || c0 >= f.side - half || r0 >= f.side - half) return null;
  let n = 0, sz = 0, sxz = 0, syz = 0, sxx = 0;
  for (let dr = -half; dr <= half; dr++) for (let dc = -half; dc <= half; dc++) {
    const z = f.z[(r0 + dr) * f.side + c0 + dc];
    if (Number.isNaN(z)) return null;
    n++; sz += z; sxz += dc * z; syz += dr * z; sxx += dc * dc;
  }
  const mean = sz / n, a = sxz / sxx, b = syz / sxx;
  let ss = 0;
  for (let dr = -half; dr <= half; dr++) for (let dc = -half; dc <= half; dc++) ss += (f.z[(r0 + dr) * f.side + c0 + dc] - mean - a * dc - b * dr) ** 2;
  return Math.sqrt(ss / n);
}

export interface ProfilePoint extends XY { distance: number; elevation: number | null; slopeDeg: number | null; gradeDeg: number | null }
/** Elevation profile along a polyline, sampled every `step` metres (default: field posting). */
export function profile(f: Field, line: XY[], step = f.posting): ProfilePoint[] {
  const out: ProfilePoint[] = [];
  let travelled = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], length = Math.hypot(b.x - a.x, b.y - a.y), count = Math.max(1, Math.ceil(length / step));
    for (let k = i === 1 ? 0 : 1; k <= count; k++) {
      const p = { x: a.x + ((b.x - a.x) * k) / count, y: a.y + ((b.y - a.y) * k) / count };
      out.push({ ...p, distance: travelled + (length * k) / count, elevation: sample(f, p), slopeDeg: slopeDeg(f, p), gradeDeg: null });
    }
    travelled += length;
  }
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1], b = out[i];
    if (a.elevation !== null && b.elevation !== null && b.distance > a.distance) b.gradeDeg = (Math.atan2(b.elevation - a.elevation, b.distance - a.distance) * 180) / Math.PI;
  }
  return out;
}
export function pathLength(f: Field, line: XY[]): { plan: number; surface: number } {
  const pts = profile(f, line);
  let surface = 0;
  for (let i = 1; i < pts.length; i++) surface += Math.hypot(pts[i].distance - pts[i - 1].distance, (pts[i].elevation ?? 0) - (pts[i - 1].elevation ?? 0));
  return { plan: pts.at(-1)?.distance ?? 0, surface };
}
/** Planimetric area of a polygon (shoelace), m². */
export function polygonArea(ring: XY[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; s += a.x * b.y - b.x * a.y; }
  return Math.abs(s) / 2;
}
export function lineOfSight(f: Field, from: XY, to: XY, eyeHeight = 2, targetHeight = 0): "clear" | "blocked" | "unknown" {
  const a = sample(f, from), b = sample(f, to);
  if (a === null || b === null) return "unknown";
  const count = Math.max(2, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (f.posting / 2)));
  for (let i = 1; i < count; i++) {
    const t = i / count, z = sample(f, { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
    if (z === null) return "unknown";
    if (z > a + eyeHeight + (b + targetHeight - a - eyeHeight) * t) return "blocked";
  }
  return "clear";
}
/** Highest terrain elevation angle (degrees) along an azimuth, measured from `height` metres above the surface. */
export function horizonAngle(f: Field, p: XY, azimuthDeg: number, height = 1, maxRange = 4000): number | null {
  const z0 = sample(f, p);
  if (z0 === null) return null;
  const dx = Math.sin((azimuthDeg * Math.PI) / 180), dy = Math.cos((azimuthDeg * Math.PI) / 180);
  let best = -Infinity;
  for (let d = f.posting; d <= maxRange; d += Math.max(f.posting, d * 0.03)) {
    const z = sample(f, { x: p.x + dx * d, y: p.y + dy * d });
    if (z === null) break;
    best = Math.max(best, Math.atan2(z - z0 - height, d));
  }
  return best === -Infinity ? null : (best * 180) / Math.PI;
}
/** True when terrain inside the field blocks the direct solar disc centre. Sun vector is ENU, unit length. */
export function inShadow(f: Field, p: XY, sunEnu: number[], height = 1): boolean {
  if (sunEnu[2] <= 0) return true;
  const horizontal = Math.hypot(sunEnu[0], sunEnu[1]);
  if (horizontal < 1e-6) return false;
  const az = (Math.atan2(sunEnu[0], sunEnu[1]) * 180) / Math.PI, h = horizonAngle(f, p, az, height);
  return h !== null && h > (Math.atan2(sunEnu[2], horizontal) * 180) / Math.PI;
}
/** Site-wide terrain shadow mask (1 = shadowed) at `stride` posts; used by both the renderer and the energy model. */
export function shadowMask(f: Field, sunEnu: number[], stride = 2): { side: number; cell: number; data: Uint8Array } {
  const side = Math.floor((f.side - 1) / stride) + 1, data = new Uint8Array(side * side);
  const horizontal = Math.hypot(sunEnu[0], sunEnu[1]);
  if (sunEnu[2] <= 0) { data.fill(1); return { side, cell: f.posting * stride, data }; }
  if (horizontal < 1e-6) return { side, cell: f.posting * stride, data };
  const ux = sunEnu[0] / horizontal, uy = sunEnu[1] / horizontal, rise = sunEnu[2] / horizontal;
  const maxRelief = fieldRange(f).max;
  for (let r = 0; r < side; r++) for (let c = 0; c < side; c++) {
    const z0 = f.z[r * stride * f.side + c * stride];
    if (Number.isNaN(z0)) continue;
    const x = f.west + c * stride * f.posting, y = f.north - r * stride * f.posting;
    for (let d = f.posting * stride; ; d += Math.max(f.posting, d * 0.04)) {
      const ray = z0 + 0.5 + rise * d;
      if (ray > maxRelief) break; // above every summit: lit
      const z = sample(f, { x: x + ux * d, y: y + uy * d });
      if (z === null) break;
      if (z > ray) { data[r * side + c] = 1; break; }
    }
  }
  return { side, cell: f.posting * stride, data };
}
const ranges = new WeakMap<Field, { min: number; max: number }>();
export function fieldRange(f: Field): { min: number; max: number } {
  let r = ranges.get(f);
  if (!r) {
    let min = Infinity, max = -Infinity;
    for (const z of f.z) if (!Number.isNaN(z)) { if (z < min) min = z; if (z > max) max = z; }
    ranges.set(f, (r = { min, max }));
  }
  return r;
}
/** Local relief (max − min) within a radius, metres. */
export function localRelief(f: Field, p: XY, radius: number): number | null {
  const c0 = Math.round((p.x - f.west) / f.posting), r0 = Math.round((f.north - p.y) / f.posting), k = Math.round(radius / f.posting);
  let min = Infinity, max = -Infinity;
  for (let r = Math.max(0, r0 - k); r <= Math.min(f.side - 1, r0 + k); r++) for (let c = Math.max(0, c0 - k); c <= Math.min(f.side - 1, c0 + k); c++) {
    const z = f.z[r * f.side + c];
    if (!Number.isNaN(z) && (r - r0) ** 2 + (c - c0) ** 2 <= k * k) { if (z < min) min = z; if (z > max) max = z; }
  }
  return max >= min ? max - min : null;
}
