// Terrain analysis on the shared analysis height model. One slope definition is used by the
// inspector, planner, simulator and dossier: central differences at the local analysis posting
// (same formula as numpy.gradient in pipeline/world/terrain.py slope_deg).
import type { World } from '../core/world';
import type { MapPoint } from '../core/types';

const DEG = 180 / Math.PI;

export interface SlopeSample { slopeDeg: number; aspectDeg: number; gradientEast: number; gradientNorth: number; baselineM: number }

export function slopeAt(world: World, x: number, y: number, baselineM = world.postingAt({ x, y })): SlopeSample | null {
  const e = world.heightAt(x + baselineM, y), w = world.heightAt(x - baselineM, y);
  const n = world.heightAt(x, y + baselineM), s = world.heightAt(x, y - baselineM);
  if (e === null || w === null || n === null || s === null) return null;
  const gx = (e - w) / (2 * baselineM), gy = (n - s) / (2 * baselineM);
  return { slopeDeg: Math.atan(Math.hypot(gx, gy)) * DEG, aspectDeg: (Math.atan2(-gx, -gy) * DEG + 360) % 360, gradientEast: gx, gradientNorth: gy, baselineM };
}

/** RMS deviation (m) of analysis heights from their best-fit plane in a square window. */
export function roughnessAt(world: World, x: number, y: number, windowM = 30): number | null {
  const step = world.postingAt({ x, y }), k = Math.max(1, Math.round(windowM / 2 / step));
  const pts: [number, number, number][] = [];
  for (let i = -k; i <= k; i++) for (let j = -k; j <= k; j++) {
    const h = world.heightAt(x + i * step, y + j * step);
    if (h === null) return null;
    pts.push([i * step, j * step, h]);
  }
  const plane = fitPlane(pts);
  return Math.sqrt(pts.reduce((a, [px, py, h]) => a + (h - (plane.a * px + plane.b * py + plane.c)) ** 2, 0) / pts.length);
}

/** Least-squares plane z = a x + b y + c. */
export function fitPlane(pts: [number, number, number][]) {
  let sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0;
  const n = pts.length;
  for (const [x, y, z] of pts) { sx += x; sy += y; sz += z; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; }
  const mx = sx / n, my = sy / n, mz = sz / n;
  const cxx = sxx / n - mx * mx, cyy = syy / n - my * my, cxy = sxy / n - mx * my, cxz = sxz / n - mx * mz, cyz = syz / n - my * mz;
  const det = cxx * cyy - cxy * cxy;
  const a = det ? (cxz * cyy - cyz * cxy) / det : 0, b = det ? (cyz * cxx - cxz * cxy) / det : 0;
  return { a, b, c: mz - a * mx - b * my };
}

export interface ProfilePoint { distance: number; x: number; y: number; h: number; slopeDeg: number | null; gradeDeg: number | null }
export interface Profile { points: ProfilePoint[]; length: number; ascent: number; descent: number; maxGradeDeg: number; maxSlopeDeg: number; postingM: number }

/** Elevation profile along a polyline at the analysis posting. */
export function profile(world: World, path: MapPoint[], spacingM?: number): Profile {
  const points: ProfilePoint[] = [];
  let distance = 0, ascent = 0, descent = 0, maxGrade = 0, maxSlope = 0;
  const posting = spacingM ?? world.postingAt(path[0]);
  for (let s = 0; s < path.length - 1; s++) {
    const a = path[s], b = path[s + 1], len = Math.hypot(b.x - a.x, b.y - a.y);
    const count = Math.max(1, Math.ceil(len / posting));
    for (let i = s ? 1 : 0; i <= count; i++) {
      const f = i / count, x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
      const h = world.heightAt(x, y);
      if (h === null) continue;
      const d = distance + len * f, prev = points.at(-1);
      let grade: number | null = null;
      if (prev && d > prev.distance) {
        grade = Math.atan((h - prev.h) / (d - prev.distance)) * DEG;
        if (h > prev.h) ascent += h - prev.h; else descent += prev.h - h;
        maxGrade = Math.max(maxGrade, Math.abs(grade));
      }
      const slope = slopeAt(world, x, y)?.slopeDeg ?? null;
      if (slope !== null) maxSlope = Math.max(maxSlope, slope);
      points.push({ distance: d, x, y, h, slopeDeg: slope, gradeDeg: grade });
    }
    distance += len;
  }
  return { points, length: distance, ascent, descent, maxGradeDeg: maxGrade, maxSlopeDeg: maxSlope, postingM: posting };
}

/** Visibility between two surface points with observer/target heights above ground (analysis heights). */
export function lineOfSight(world: World, a: MapPoint, b: MapPoint, observerH = 1.5, targetH = 1.5) {
  const ha = world.heightAt(a.x, a.y), hb = world.heightAt(b.x, b.y);
  if (ha === null || hb === null) return null;
  const za = ha + observerH, zb = hb + targetH, len = Math.hypot(b.x - a.x, b.y - a.y);
  const count = Math.max(2, Math.ceil(len / world.postingAt(a)));
  let blockedAt: number | null = null, minClearance = Infinity;
  for (let i = 1; i < count; i++) {
    const f = i / count, h = world.heightAt(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
    if (h === null) continue;
    // Spherical drop of the chord relative to the local surface is < 2 cm over 500 m on the Moon; include it anyway.
    const drop = (len * f) * (len * (1 - f)) / (2 * world.radius);
    const clearance = za + (zb - za) * f - drop - h;
    minClearance = Math.min(minClearance, clearance);
    if (clearance < 0 && blockedAt === null) blockedAt = len * f;
  }
  return { visible: blockedAt === null, blockedAtM: blockedAt, minClearanceM: minClearance, distanceM: len };
}

export function polygonArea(poly: MapPoint[]) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p.x * q.y - q.x * p.y; }
  return Math.abs(a) / 2;
}
