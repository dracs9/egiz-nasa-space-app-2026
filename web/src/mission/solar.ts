import type { MissionTerrain, SpiceGeometry, SolarSample } from "./types.ts";

export function validateGeometry(value: unknown, terrain: MissionTerrain, duration = 0): SpiceGeometry {
  const g = value as SpiceGeometry;
  const valid = g && g.schema === "egiz.spice_geometry" && g.version === "1.0.0" &&
    typeof g.engine === "string" && g.engine.includes("CSPICE") && g.siteId === terrain.id &&
    g.body === terrain.body && g.lat === terrain.lat && g.lon === terrain.lon &&
    g.frame === {earth:"IAU_EARTH",moon:"MOON_ME_DE421",mars:"IAU_MARS"}[terrain.body] &&
    g.aberration === "NONE" && Number.isFinite(Date.parse(g.epochUtc)) &&
    Number.isFinite(g.duration) && g.duration >= duration && g.duration <= 86400 &&
    Number.isFinite(g.step) && g.step >= 60 && g.step <= 3600 &&
    Array.isArray(g.kernels) && g.kernels.length === (terrain.body === "moon" ? 5 : 3) &&
    new Set(g.kernels.map(k=>k.name)).size === g.kernels.length &&
    g.kernels.every(k => /^[a-f0-9]{64}$/.test(k.sha256) && k.url.startsWith("https://naif.jpl.nasa.gov/")) &&
    Array.isArray(g.samples) && g.samples.length === Math.ceil(g.duration/g.step)+1 && g.samples.length <= 1442 &&
    g.samples[0].t === 0 && g.samples.at(-1)!.t === g.duration &&
    g.samples.every((s, i) => Number.isFinite(s.t) && (!i || s.t > g.samples[i-1].t) &&
      Array.isArray(s.sunEnu) && s.sunEnu.length === 3 && s.sunEnu.every(Number.isFinite) &&
      Math.abs(Math.hypot(...s.sunEnu) - 1) < 1e-6 &&
      Number.isFinite(s.solarFluxWm2) && s.solarFluxWm2 > 0 && s.solarFluxWm2 < 2000 &&
      Number.isFinite(s.elevationDeg) && Math.abs(s.elevationDeg) <= 90 &&
      Number.isFinite(s.azimuthDeg) &&
      (s.earthElevationDeg === null || (Number.isFinite(s.earthElevationDeg) && Math.abs(s.earthElevationDeg) <= 90)) &&
      (s.earthRangeKm === null || (Number.isFinite(s.earthRangeKm) && s.earthRangeKm > 0))) &&
    Array.isArray(g.limitations) && g.limitations.every(x => typeof x === "string");
  if (!valid) throw new Error("SPICE geometry is invalid, belongs to another site, or does not cover the mission duration.");
  return g;
}

/** Interpolates only recorded CSPICE vectors. Out-of-coverage queries fail explicitly. */
export function solarAt(g: SpiceGeometry, t: number): SolarSample {
  if (!Number.isFinite(t) || t < 0 || t > g.duration + 1e-7) throw new Error("Time is outside the SPICE geometry record.");
  let lo = 0, hi = g.samples.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >>> 1;
    if (g.samples[m].t <= t) lo = m; else hi = m;
  }
  const a = g.samples[lo], b = g.samples[hi], f = (t - a.t) / (b.t - a.t);
  const mix = (a: number, b: number) => a + f * (b - a);
  const v = a.sunEnu.map((v, i) => mix(v, b.sunEnu[i])), length = Math.hypot(...v);
  const sunEnu = v.map(v => v / length);
  return { t, sunEnu, elevationDeg: Math.asin(sunEnu[2]) * 180 / Math.PI,
    azimuthDeg: (Math.atan2(sunEnu[0], sunEnu[1]) * 180 / Math.PI + 360) % 360,
    solarFluxWm2: mix(a.solarFluxWm2, b.solarFluxWm2),
    earthElevationDeg: a.earthElevationDeg === null || b.earthElevationDeg === null ? null : mix(a.earthElevationDeg, b.earthElevationDeg),
    earthRangeKm: a.earthRangeKm === null || b.earthRangeKm === null ? null : mix(a.earthRangeKm, b.earthRangeKm),
  };
}

/** Re-authenticate imported geometry against the packaged genuine run or re-execute CSPICE.
 * Repeating a source URL/hash alone is not proof that uploaded vectors came from SPICE.
 */
export async function verifyImportedGeometry(g:SpiceGeometry,terrain:MissionTerrain):Promise<SpiceGeometry> {
  validateGeometry(g,terrain);
  const matches=(a:SpiceGeometry)=>a.epochUtc===g.epochUtc && a.duration===g.duration && a.step===g.step &&
    a.frame===g.frame && a.observer===g.observer && a.engine===g.engine &&
    JSON.stringify(a.kernels)===JSON.stringify(g.kernels) && JSON.stringify(a.samples)===JSON.stringify(g.samples);
  const response=await fetch(`${import.meta.env.BASE_URL}data/pilot/spice_geometry.json`);
  if(response.ok) {
    const catalog=await response.json();
    const canonical=catalog.entries?.find((r:SpiceGeometry)=>r.siteId===g.siteId);
    if(canonical && matches(canonical)) return validateGeometry(canonical,terrain);
  }
  const live=await fetch(`${import.meta.env.BASE_URL}api/science/geometry`,{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({siteId:g.siteId,epochUtc:g.epochUtc,duration:g.duration}),signal:AbortSignal.timeout(20000),
  });
  if(!live.ok)throw new Error("Imported SPICE vectors do not match the packaged record. Start the optional science service to re-execute this epoch.");
  const canonical=validateGeometry(await live.json(),terrain);
  if(!matches(canonical)) throw new Error("Imported SPICE geometry differs from actual CSPICE execution. The archive was not reproduced.");
  return canonical;
}
