// Spherical body coordinates; mirrors pipeline/world/geodesy.py (parity-tested).
// Map frame: AEQD x east / y north (m) about the site centre, heights above the reference sphere.
// World frame: Cartesian ENU tangent frame at the site centre with curvature applied.
// Three.js frame: X = east, Y = up, Z = -north.

export interface Enu { e: number; n: number; u: number }

export function aeqdToEnu(x: number, y: number, h: number, radius: number): Enu {
  const r = Math.hypot(x, y), rho = radius + h;
  if (r === 0) return { e: 0, n: 0, u: h };
  const theta = r / radius, k = Math.sin(theta) / r, s = Math.sin(theta / 2);
  // u = rho cos(theta) - R, written without cancellation (same form as the GLSL).
  return { e: x * rho * k, n: y * rho * k, u: h - 2 * rho * s * s };
}

export function enuToAeqd(e: number, n: number, u: number, radius: number) {
  const horizontal = Math.hypot(e, n), vertical = radius + u;
  const theta = Math.atan2(horizontal, vertical);
  const h = u + horizontal * horizontal / (Math.hypot(horizontal, vertical) + vertical);
  const k = horizontal > 0 ? radius * theta / horizontal : radius / vertical;
  return { x: e * k, y: n * k, h };
}

const DEG = Math.PI / 180;
/** Inverse spherical azimuthal equidistant (Snyder 1987). */
export function aeqdToLonLat(x: number, y: number, lon0: number, lat0: number, radius: number) {
  const rho = Math.hypot(x, y);
  if (rho === 0) return { lon: lon0, lat: lat0 };
  const c = rho / radius, phi1 = lat0 * DEG;
  const lat = Math.asin(Math.cos(c) * Math.sin(phi1) + y * Math.sin(c) * Math.cos(phi1) / rho);
  const lon = lon0 * DEG + Math.atan2(x * Math.sin(c), rho * Math.cos(phi1) * Math.cos(c) - y * Math.sin(phi1) * Math.sin(c));
  return { lon: ((lon / DEG + 540) % 360) - 180, lat: lat / DEG };
}

/** Forward spherical AEQD. */
export function lonLatToAeqd(lon: number, lat: number, lon0: number, lat0: number, radius: number) {
  const phi = lat * DEG, phi1 = lat0 * DEG, dl = (lon - lon0) * DEG;
  const cosc = Math.sin(phi1) * Math.sin(phi) + Math.cos(phi1) * Math.cos(phi) * Math.cos(dl);
  const c = Math.acos(Math.max(-1, Math.min(1, cosc)));
  const k = c === 0 ? 1 : c / Math.sin(c);
  return { x: radius * k * Math.cos(phi) * Math.sin(dl), y: radius * k * (Math.cos(phi1) * Math.sin(phi) - Math.sin(phi1) * Math.cos(phi) * Math.cos(dl)) };
}

/** Lunar local solar time in lunar "hours" from the Sun azimuth (south polar site: culmination due north). */
export function lunarLocalTime(sunAzimuthDeg: number, southern: boolean) {
  const signed = ((sunAzimuthDeg + 540) % 360) - 180; // (-180,180], 0 = north
  // South: the Sun moves east -> north -> west (azimuth decreasing). North: east -> south -> west.
  const local = southern ? 12 - signed / 15 : 12 + (((sunAzimuthDeg - 180 + 540) % 360) - 180) / 15;
  return (local % 24 + 24) % 24;
}
