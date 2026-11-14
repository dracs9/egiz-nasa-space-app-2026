// EGIZ Planetary Studio · Sun geometry and direct-beam transmission.
// Packaged sites carry CSPICE records (measured ephemeris geometry). Streamed Earth sites have no record,
// so an analytic low-precision solar ephemeris is used and labelled as such; a test compares it to SPICE.
import { solarAt } from '../../mission/solar';
import type { SpiceGeometry, SolarSample } from '../../mission/types';
import type { Body } from './site';

const RAD = Math.PI / 180, DEG = 180 / Math.PI;
export interface SunState { t: number; sunEnu: number[]; elevationDeg: number; azimuthDeg: number; fluxWm2: number; utc: Date }

/** Sun state at `t` seconds after the record epoch (clamped to the record; callers show the coverage). */
export function sunAt(rec: SpiceGeometry, t: number): SunState {
  const tc = Math.max(0, Math.min(rec.duration, t)), s = solarAt(rec, tc);
  return { t: tc, sunEnu: s.sunEnu, elevationDeg: s.elevationDeg, azimuthDeg: s.azimuthDeg, fluxWm2: s.solarFluxWm2, utc: new Date(Date.parse(rec.epochUtc) + tc * 1000) };
}

/**
 * Geometric solar position for an Earth observer (Meeus, Astronomical Algorithms ch. 25, low-precision series;
 * the NOAA solar calculator uses the same series). No refraction, no parallax. Typical error ≲ 0.05°.
 */
export function analyticSunEarth(date: Date, latDeg: number, lonDeg: number): { sunEnu: number[]; elevationDeg: number; azimuthDeg: number; fluxWm2: number } {
  const jd = date.getTime() / 86400000 + 2440587.5, T = (jd - 2451545) / 36525;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T, M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * RAD;
  const e = 0.016708634 - 0.000042037 * T;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) + (0.019993 - 0.000101 * T) * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
  const lambda = (L0 + C) * RAD, eps = (23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60) * RAD;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda)), ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const gmst = (280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T) * RAD;
  const H = gmst + lonDeg * RAD - ra, phi = latDeg * RAD;
  const el = Math.asin(Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(decl) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
  const r = (1.000001018 * (1 - e * e)) / (1 + e * Math.cos(M + C * RAD));
  return { sunEnu: [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)], elevationDeg: el * DEG, azimuthDeg: (az * DEG + 360) % 360, fluxWm2: 1361 / (r * r) };
}

/** A record with the SPICE record's shape, computed analytically. `engine` states that it is not SPICE. */
export function analyticEarthRecord(siteId: string, lat: number, lon: number, epochUtc: string, durationS = 172800, step = 600): SpiceGeometry {
  const t0 = Date.parse(epochUtc), samples: SolarSample[] = [];
  for (let t = 0; t <= durationS; t += step) { const s = analyticSunEarth(new Date(t0 + t * 1000), lat, lon); samples.push({ t, sunEnu: s.sunEnu, elevationDeg: s.elevationDeg, azimuthDeg: s.azimuthDeg, solarFluxWm2: s.fluxWm2, earthElevationDeg: null, earthRangeKm: null }); }
  return { schema: 'egiz.spice_geometry', version: '1.0.0', engine: 'Analytic solar ephemeris (Meeus low-precision series); not a SPICE kernel computation', siteId, body: 'earth', lat, lon, epochUtc, frame: 'WGS84 topocentric ENU', observer: 'site', aberration: 'NONE', duration: durationS, step, kernels: [], samples,
    limitations: ['Geometric position without refraction; accuracy about 0.05°, compared against the packaged CSPICE record in tests.'] } as unknown as SpiceGeometry;
}

/**
 * Declared direct-beam transmission (0–1) used by the solar-energy layer. These are ASSUMED clear-sky models,
 * not site measurements: Moon — vacuum; Mars — Beer–Lambert with dust optical depth τ = 0.5; Earth — Meinel &
 * Meinel (1976) clear-sky 0.7^(AM^0.678).
 */
export function beamTransmission(body: Body, elevationDeg: number): number {
  if (elevationDeg <= 0) return 0;
  if (body === 'moon') return 1;
  const airmass = 1 / Math.max(0.02, Math.sin(elevationDeg * RAD));
  return body === 'mars' ? Math.exp(-0.5 * airmass) : 0.7 ** (airmass ** 0.678);
}
export const TRANSMISSION_NOTE: Record<Body, string> = {
  moon: 'Vacuum: no atmospheric attenuation.',
  mars: 'Assumed: Beer–Lambert direct beam with dust optical depth τ = 0.5 (a moderate clear-season value); diffuse sky light is not counted.',
  earth: 'Assumed: Meinel & Meinel (1976) clear-sky direct beam; clouds, aerosols and diffuse light are not modelled.',
};

/** Default mission departure: the first time in the record when the Sun is rising through 5° elevation (0 if never). */
export function morningStart(rec: SpiceGeometry | null): number {
  if (!rec) return 0;
  for (let i = 1; i < rec.samples.length; i++) if (rec.samples[i].elevationDeg >= 5 && rec.samples[i - 1].elevationDeg < rec.samples[i].elevationDeg && rec.samples[i - 1].elevationDeg < 5) return rec.samples[i].t;
  return 0;
}
/** Evenly spaced Sun samples across a window of the record, for insolation integration. */
export function sunSteps(rec: SpiceGeometry, body: Body, fromS: number, toS: number, count: number) {
  const out = [];
  for (let k = 0; k < count; k++) { const s = sunAt(rec, fromS + ((toS - fromS) * (k + 0.5)) / count); out.push({ sunEnu: s.sunEnu, fluxWm2: s.fluxWm2, transmission: beamTransmission(body, s.elevationDeg) }); }
  return out;
}
