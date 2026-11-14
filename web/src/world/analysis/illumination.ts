// SPICE-backed illumination and terrain occultation. The renderer's GLSL shadow march is generated
// from the same constants and the same algorithm, so what the user sees lit is what the power
// model calls lit (up to float32 precision and bilinear-vs-hardware sampling).
import { aeqdToEnu, enuToAeqd } from '../core/coordinates';
import type { IlluminationRecord } from '../core/types';
/** Anything that can answer horizon-grid heights (World, or a worker-side copy of the grid). */
export interface HorizonModel { radius: number; horizonHeight(x: number, y: number): number }

export const SUN_ANGULAR_RADIUS_RAD = 0.2666 * Math.PI / 180;   // mean, at 1 AU
export const EARTH_ANGULAR_RADIUS_RAD = Math.atan(6371 / 384400);
export const MARCH = { startM: 25, firstStepM: 10, growth: 1.045, maxSteps: 112, biasM: 0.6 } as const;

export interface BodyState { t: number; sun: [number, number, number]; earth: [number, number, number]; fluxWm2: number; sunElevationDeg: number; sunAzimuthDeg: number; earthElevationDeg: number; earthAzimuthDeg: number }

const DEG = 180 / Math.PI;
function norm(v: number[]): [number, number, number] { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }

/** Interpolated Sun/Earth directions (ENU unit vectors) at t seconds after the record epoch. */
export function bodiesAt(rec: IlluminationRecord, t: number): BodyState {
  if (!Number.isFinite(t) || t < 0 || t > rec.duration + 1e-6) throw new Error(`Time ${t} s is outside the SPICE record (0–${rec.duration} s).`);
  const s = rec.samples, step = rec.step;
  const i = Math.min(s.length - 2, Math.floor(t / step)), f = (t - s[i][0]) / (s[i + 1][0] - s[i][0]);
  const mix = (k: number) => s[i][k] + (s[i + 1][k] - s[i][k]) * f;
  const sun = norm([mix(1), mix(2), mix(3)]), earth = norm([mix(5), mix(6), mix(7)]);
  return {
    t, sun, earth, fluxWm2: mix(4),
    sunElevationDeg: Math.asin(sun[2]) * DEG, sunAzimuthDeg: (Math.atan2(sun[0], sun[1]) * DEG + 360) % 360,
    earthElevationDeg: Math.asin(earth[2]) * DEG, earthAzimuthDeg: (Math.atan2(earth[0], earth[1]) * DEG + 360) % 360,
  };
}

export function epochPlus(rec: IlluminationRecord, t: number) { return new Date(Date.parse(rec.epochUtc) + t * 1000); }

/** Time of the highest Sun elevation in [from, from + window] ("local noon" for this site). */
export function nextLocalNoon(rec: IlluminationRecord, from: number, windowS = 29.53 * 86400) {
  let best = from, bestEl = -Infinity;
  for (let t = from; t <= Math.min(rec.duration, from + windowS); t += rec.step) {
    const el = bodiesAt(rec, t).sunElevationDeg;
    if (el > bestEl) { bestEl = el; best = t; }
  }
  // Refine with a golden-section search on the bracketing interval.
  let a = Math.max(0, best - rec.step), b = Math.min(rec.duration, best + rec.step);
  for (let k = 0; k < 40; k++) {
    const m1 = b - (b - a) / 1.618, m2 = a + (b - a) / 1.618;
    if (bodiesAt(rec, m1).sunElevationDeg > bodiesAt(rec, m2).sunElevationDeg) b = m2; else a = m1;
  }
  return (a + b) / 2;
}

/** Minimum angular clearance (rad) of a direction above the terrain horizon, ray-marched on the horizon grid. */
export function horizonClearance(world: HorizonModel, x: number, y: number, h: number, dir: [number, number, number]) {
  const o = aeqdToEnu(x, y, h + MARCH.biasM, world.radius);
  let t = MARCH.startM, step = MARCH.firstStepM, min = Infinity;
  for (let i = 0; i < MARCH.maxSteps; i++) {
    const p = enuToAeqd(o.e + dir[0] * t, o.n + dir[1] * t, o.u + dir[2] * t, world.radius);
    const H = world.horizonHeight(p.x, p.y);
    if (Number.isFinite(H)) min = Math.min(min, (p.h - H) / t);
    t += step; step *= MARCH.growth;
  }
  return min;
}

/** Visible fraction of a uniform disk whose centre is `clearance` rad above an occluding edge. */
export function diskFraction(clearance: number, angularRadius: number) {
  if (!Number.isFinite(clearance) || clearance >= angularRadius) return 1;
  if (clearance <= -angularRadius) return 0;
  const a = clearance / angularRadius;
  return 1 - (Math.acos(a) - a * Math.sqrt(1 - a * a)) / Math.PI;
}

export function sunVisibleFraction(world: HorizonModel, x: number, y: number, h: number, sun: [number, number, number]) {
  if (sun[2] < -0.02) return 0; // well below the geometric horizon of the centre
  return diskFraction(horizonClearance(world, x, y, h, sun), SUN_ANGULAR_RADIUS_RAD);
}
export function earthVisibleFraction(world: HorizonModel, x: number, y: number, h: number, earth: [number, number, number]) {
  if (earth[2] < -0.03) return 0;
  return diskFraction(horizonClearance(world, x, y, h, earth), EARTH_ANGULAR_RADIUS_RAD);
}

/** GLSL implementation of horizonClearance/diskFraction for the terrain shader (same constants). */
export function shadowGlsl() {
  const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);
  return /* glsl */`
uniform sampler2D uHorizon; uniform vec4 uHorizonGeo; uniform float uRadius; uniform vec3 uSunEnu; uniform float uShadowSteps;
float horizonH(vec2 xy) {
  vec2 uv = vec2((xy.x - uHorizonGeo.x) / uHorizonGeo.z, (uHorizonGeo.y - xy.y) / uHorizonGeo.z) / uHorizonGeo.w;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -1.0e9;
  float v = texture2D(uHorizon, uv).r; // row 0 = north, uploaded without flip
  return v > -1.0e8 ? v : -1.0e9;
}
vec3 enuToAeqd(vec3 p) {
  float hz = length(p.xy); float vert = uRadius + p.z; float th = atan(hz, vert);
  float k = hz > 0.0 ? uRadius * th / hz : uRadius / vert;
  return vec3(p.xy * k, length(vec2(hz, vert)) - uRadius);
}
float sunVisible(vec3 enu) {
  if (uSunEnu.z < -0.02) return 0.0;
  vec3 o = enu + vec3(0.0, 0.0, ${f(MARCH.biasM)});
  float t = ${f(MARCH.startM)}; float stp = ${f(MARCH.firstStepM)}; float m = 1.0e9;
  for (int i = 0; i < ${MARCH.maxSteps}; i++) {
    if (float(i) >= uShadowSteps) break;
    vec3 q = enuToAeqd(o + uSunEnu * t);
    float H = horizonH(q.xy);
    if (H > -1.0e8) m = min(m, (q.z - H) / t);
    t += stp; stp *= ${f(MARCH.growth)};
  }
  float r = ${SUN_ANGULAR_RADIUS_RAD.toFixed(8)};
  if (m >= r) return 1.0; if (m <= -r) return 0.0;
  float a = m / r; return 1.0 - (acos(a) - a * sqrt(1.0 - a * a)) / 3.14159265;
}`;
}
