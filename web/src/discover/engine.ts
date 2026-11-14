// Browser side of the EGIZ Discovery Engine. The science (dimension similarities with
// Monte Carlo uncertainty) is computed once in Python; this module re-aggregates it with
// user weights and ports the small deterministic pieces (gap ledger, rover experiment).
// Every function here has a Python twin and a parity test (engine.test.ts).
// Written with AI assistance (Claude); human review pending.
import { terramechanics } from '../atlas/physics';
import type { Body, Category, DiscoveryBundle, GapRow, RoverExperiment, ScoreShard } from './types';

export const Z90 = 1.6448536269514722;
export const EPS = 1e-3;
const STATUS = ['measured', 'missing', 'not_assessed', 'not_applicable'] as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Log-normal moments from median and 5-95 % interval (pipeline.discovery.similarity.log_moments). */
export function logMoments(s50: number, lo: number, hi: number) {
  const mu = Math.log(clamp(s50, EPS, 1));
  const sd = (Math.log(clamp(hi, EPS, 1)) - Math.log(clamp(lo, EPS, 1))) / (2 * Z90);
  return { mu, sd: Math.max(0, sd) };
}

export interface Aggregate { fidelity: Float64Array; lo: Float64Array; hi: Float64Array; coverage: Float64Array; score: Float64Array; category: Category[] }

/** Weighted geometric aggregation over measured dimensions (pipeline.discovery.rank.aggregate). */
export function aggregate(shard: ScoreShard, weights: Record<string, number>): Aggregate {
  const W = shard.s50[0]?.length ?? 0;
  const num = new Float64Array(W), den = new Float64Array(W), vr = new Float64Array(W), app = new Float64Array(W);
  shard.dims.forEach((d, k) => {
    const w = weights[d] ?? 0;
    if (!(w > 0)) return;
    const s50 = shard.s50[k], lo = shard.lo[k], hi = shard.hi[k], st = shard.status[k];
    for (let i = 0; i < W; i++) {
      if (st[i] !== 3) app[i] += w;
      if (st[i] !== 0) continue;
      const m = logMoments(s50[i] ?? 1, lo[i] ?? 1, hi[i] ?? 1);
      num[i] += w * m.mu; den[i] += w; vr[i] += (w * m.sd) ** 2;
    }
  });
  const out: Aggregate = { fidelity: new Float64Array(W), lo: new Float64Array(W), hi: new Float64Array(W), coverage: new Float64Array(W), score: new Float64Array(W), category: [] };
  for (let i = 0; i < W; i++) {
    if (den[i] > 0) {
      const mu = num[i] / den[i], sd = Math.sqrt(vr[i]) / den[i];
      out.fidelity[i] = Math.exp(mu); out.lo[i] = Math.exp(mu - Z90 * sd); out.hi[i] = Math.min(1, Math.exp(mu + Z90 * sd));
    } else { out.fidelity[i] = NaN; out.lo[i] = NaN; out.hi[i] = NaN; }
    out.coverage[i] = app[i] > 0 ? den[i] / app[i] : 0;
    const s = out.fidelity[i] * out.coverage[i];
    out.score[i] = Number.isFinite(s) ? s : 0;
    const width = out.hi[i] - out.lo[i];
    out.category.push(out.coverage[i] < 0.5 ? 'missing_driven' : out.coverage[i] >= 0.6 && width <= 0.35 ? 'strong' : 'weak');
  }
  return out;
}

export function statusOf(shard: ScoreShard, dim: string, i: number) {
  const k = shard.dims.indexOf(dim);
  return k < 0 ? 'not_assessed' : STATUS[shard.status[k][i]];
}

/** Share (0-100) of population values <= v (pipeline.discovery.rank.population_percentile). */
export function percentileFn(values: ArrayLike<number>, population: boolean[]) {
  const ref = Array.from(values).filter((v, i) => population[i] && Number.isFinite(v)).sort((a, b) => a - b);
  return (v: number) => {
    if (!Number.isFinite(v) || !ref.length) return NaN;
    let lo = 0, hi = ref.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (ref[mid] <= v) lo = mid + 1; else hi = mid; }
    return lo / ref.length * 100;
  };
}

export function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number) {
  const r = Math.PI / 180, dlat = (lat2 - lat1) * r, dlon = (lon2 - lon1) * r;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dlon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(clamp(h, 0, 1)));
}

/** Greedy diverse shortlist: best score first, no two picks closer than minKm (geographic diversity). */
export function diverseTop(order: number[], score: ArrayLike<number>, lon: number[], lat: number[], k = 25, minKm = 150): number[] {
  const out: number[] = [];
  for (const i of order) {
    if (out.length >= k) break;
    if (!(score[i] > 0)) continue;
    if (out.every(j => haversineKm(lon[i], lat[i], lon[j], lat[j]) >= minKm)) out.push(i);
  }
  return out;
}

// ----------------------------------------------------------------------------- physics helpers

export function noonElevationRange(latDeg: number, obliquityDeg: number): [number, number] {
  const lo = 90 - Math.max(Math.abs(latDeg - obliquityDeg), Math.abs(latDeg + obliquityDeg));
  const dec = clamp(latDeg, -obliquityDeg, obliquityDeg);
  const hi = 90 - Math.min(Math.abs(latDeg + obliquityDeg), Math.abs(latDeg - obliquityDeg), Math.abs(latDeg - dec));
  return [lo, hi];
}
export function somiglianaGravity(latDeg: number) {
  const s2 = Math.sin(latDeg * Math.PI / 180) ** 2;
  return 9.7803253359 * (1 + 0.00193185265241 * s2) / Math.sqrt(1 - 0.00669437999013 * s2);
}
export function isaPressurePa(elevationM: number) {
  const h = clamp(elevationM, -500, 11000);
  return 101325 * (1 - 2.25577e-5 * h) ** 5.25588;
}

// ----------------------------------------------------------------------------- window accessors

export function col(b: DiscoveryBundle, name: string, i: number): number | null {
  const v = b.windows[name]?.[i];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
export function text(b: DiscoveryBundle, name: string, i: number): string | null {
  const v = b.windows[name]?.[i];
  return typeof v === 'string' ? v : null;
}

// ----------------------------------------------------------------------------- slope CDF (100 m)

export const GRID = Array.from({ length: 61 }, (_, i) => i);

/** Piecewise-linear slope CDF on GRID from window statistics (pipeline.discovery.similarity.cdf_points/eval_cdf). */
export function slopeCdf(get: (name: string) => number | null, b = 100): number[] | null {
  if (get(`slope_f${b}_p50_deg`) == null) return null;
  const n = (v: number | null) => v ?? NaN;
  const b0 = n(get(`slope_f${b}_bin_0_5_frac`)), b1 = n(get(`slope_f${b}_bin_5_15_frac`)), b2 = n(get(`slope_f${b}_bin_15_30_frac`));
  const raw: [number, number][] = [
    [n(get(`slope_f${b}_p50_deg`)), 0.5], [n(get(`slope_f${b}_p90_deg`)), 0.9], [10, n(get(`frac_lt10_f${b}`))],
    [20, n(get(`frac_lt20_f${b}`))], [5, b0], [15, b0 + b1], [30, b0 + b1 + b2],
  ];
  const knots: [number, number][] = [[0, 0], ...raw.map(([x, y]): [number, number] => Number.isFinite(x) && Number.isFinite(y) ? [x, y] : [60, 1]), [60, 1]];
  const order = knots.map((k, i) => [k[0], i] as const).sort((a, c) => a[0] - c[0] || a[1] - c[1]).map(p => p[1]);
  const xs = order.map(i => knots[i][0]);
  let run = 0;
  const ys = order.map(i => (run = Math.max(run, clamp(knots[i][1], 0, 1))));
  xs[0] = 0; xs[xs.length - 1] = 60;
  for (let k = 0; k < xs.length; k++) xs[k] = clamp(xs[k], 0, 60);
  for (let k = 1; k < xs.length; k++) xs[k] = Math.max(xs[k], xs[k - 1]);
  return GRID.map(g => {
    if (g >= xs[xs.length - 1]) return 1;
    for (let k = 0; k < xs.length - 1; k++) if (g >= xs[k] && g < xs[k + 1]) {
      const span = xs[k + 1] - xs[k] > 1e-9 ? xs[k + 1] - xs[k] : 1;
      return ys[k] + (g - xs[k]) * (ys[k + 1] - ys[k]) / span;
    }
    return 0;
  });
}

function interp(x: number, xs: number[], ys: number[]) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  const k = Math.floor(x - xs[0]);
  return ys[k] + (x - xs[k]) * (ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]);
}

function climbingEnergy(cdf: number[], limit: number, mass: number, g: number, rho: number): number | null {
  let num = 0, den = 0;
  for (let k = 0; k < GRID.length; k++) {
    if (GRID[k] > limit) continue;
    const p = cdf[k] - (k ? cdf[k - 1] : 0);
    const th = Math.max(0, GRID[k] - 0.5) * Math.PI / 180;
    num += mass * g * (rho * Math.cos(th) + Math.sin(th)) * p; den += p;
  }
  return den > 0 ? num / den : null;
}

const r = (v: number, nd: number) => Math.round(v * 10 ** nd) / 10 ** nd;

/** Candidate-conditioned rover experiment (pipeline.discovery.rover.rover_experiment). */
export function roverExperiment(cdf: number[], body: Body, windowId: string): RoverExperiment {
  const tm = terramechanics(body, { name: 'EGIZ demonstration rover', mass_kg: 900, wheels: 6, wheel_diameter_m: 0.82, wheel_width_m: 0.33 },
    { name: 'Apollo-era lunar soil design estimate', kc: 1400, kphi: 820000, n: 1, phi_deg: 35, c_pa: 0 });
  const cases = {} as RoverExperiment['cases'];
  for (const key of ['target', 'earth_load_matched', 'earth_mass_matched'] as const) {
    const c = tm[key];
    const energy = climbingEnergy(cdf, c.slope_limit_deg, c.test_mass_kg, c.gravity, c.resistance_to_load);
    cases[key] = { label: c.label, slope_limit_deg: r(c.slope_limit_deg, 3), sinkage_mm: r(c.sinkage_m * 1000, 3),
      traversable_frac: r(interp(c.slope_limit_deg, GRID, cdf), 4), climbing_energy_j_per_m: energy == null ? null : r(energy, 2) };
  }
  const t = cases.target;
  const deltas = {} as RoverExperiment['deltas'];
  for (const key of ['earth_load_matched', 'earth_mass_matched'] as const) {
    const e = cases[key];
    deltas[key] = { d_slope_limit_deg: r(e.slope_limit_deg - t.slope_limit_deg, 3), d_traversable_frac: r(e.traversable_frac - t.traversable_frac, 4),
      sinkage_ratio: t.sinkage_mm ? r(e.sinkage_mm / t.sinkage_mm, 4) : null,
      energy_ratio: e.climbing_energy_j_per_m && t.climbing_energy_j_per_m ? r(e.climbing_energy_j_per_m / t.climbing_energy_j_per_m, 4) : null };
  }
  return { model: 'CF_TERRAMECHANICS on candidate slope CDF', status: 'MODEL_ESTIMATE', window: windowId, body, baseline_m: 100,
    rover: { mass_kg: 900, wheels: 6, wheel_diameter_m: 0.82, wheel_width_m: 0.33 }, soil: { kc: 1400, kphi: 820000, n: 1, phi_deg: 35, c_pa: 0 },
    cases, deltas,
    assumptions: ['Static Bekker rigid-wheel model, equal wheel loads, uphill traverse (conservative)',
      'Soil parameters are Apollo-era lunar estimates applied to Earth and target alike',
      'Candidate terrain = measured slope distribution at 100 m baseline; rover-scale (< 10 m) roughness is not resolved',
      'No gravity-dependent soil strength: the direction of the transfer error is contested'],
    limitations: [], references: ['WONG_2012', 'NASA_LSDB'] };
}

// ----------------------------------------------------------------------------- gap ledger

/** Numeric core of the computed gap ledger (pipeline.discovery.gaps.gap_ledger). */
export function gapLedger(b: DiscoveryBundle, body: Body, targetLat: number, i: number, w1: number | null): GapRow[] {
  const C = b.constants, T = C.body[body];
  const lat = b.windows.lat[i];
  const rows: GapRow[] = [];
  const row = (key: string, parameter: string, unit: string, target: unknown, earth: unknown, extra: Partial<GapRow>): GapRow => {
    const measurable = extra.measurable ?? true;
    const num = measurable && typeof target === 'number' && typeof earth === 'number';
    return { key, parameter, unit, target_value: target, earth_value: earth, difference: num ? (earth as number) - (target as number) : null,
      ratio_earth_to_target: num && target ? (earth as number) / (target as number) : null, measurable,
      earth_evidence: '', target_evidence: 'documented', source: T.source, uncertainty: '', relevance: [], alternative: null, note: '', ...extra };
  };
  rows.push(row('gravity', 'Surface gravity', 'm/s^2', T.g_m_s2, r(somiglianaGravity(lat), 5), { earth_evidence: 'derived (WGS84 normal gravity at window latitude)' }));
  const elev = col(b, 'elev_p50_m', i);
  rows.push(row('pressure', 'Surface atmospheric pressure', 'Pa', T.pressure_pa, elev == null ? null : r(isaPressurePa(elev), 1),
    { earth_evidence: 'derived (ICAO standard atmosphere at window median elevation)', measurable: elev != null }));
  rows.push(row('atmosphere', 'Atmosphere composition', 'text', T.atmosphere, 'N2 78.08 %, O2 20.95 %, CO2 ~0.042 %', { measurable: false, earth_evidence: 'documented' }));
  const th = C.thermal_reference[body];
  const tmin = col(b, 't2m_min_coldest_month_c', i), tmax = col(b, 't2m_max_warmest_month_c', i);
  rows.push(row('thermal', `Temperature range (${th.quantity})`, 'K', [th.min_k, th.max_k],
    tmin == null || tmax == null ? null : [r(tmin + 273.15, 1), r(tmax + 273.15, 1)],
    { measurable: false, earth_evidence: 'modelled (NASA POWER 2 m air temperature)', source: `${th.source}; ${th.scope}`,
      note: body === 'moon' ? 'not comparable in kind: lunar SURFACE vs Earth AIR temperature' : 'comparable quantity (near-surface air) but body-level reference' }));
  const re = C.radiation.earth, rt = C.radiation[body];
  rows.push(row('radiation', 'Ionising radiation dose rate at the surface', 'mSv/day', rt.msv_per_day, r(re.msv_per_day, 5),
    { earth_evidence: `documented (${re.scope})`, target_evidence: `measured (${rt.scope})`, source: `${rt.source}; ${re.source}` }));
  rows.push(row('day_length', 'Solar day length', 'h', T.day_h, 24, { earth_evidence: 'documented' }));
  const [tlo, thi] = noonElevationRange(targetLat, T.obliquity_deg), [elo, ehi] = noonElevationRange(lat, 23.44);
  rows.push(row('noon_elevation', 'Noon solar elevation over a year', 'deg', [r(tlo, 2), r(thi, 2)], [r(elo, 2), r(ehi, 2)],
    { measurable: false, earth_evidence: 'derived (latitude, obliquity 23.44 deg)', target_evidence: 'derived (latitude, obliquity)' }));
  rows.push(row('solar_flux', 'Top-of-atmosphere solar flux', 'W/m^2', T.solar_constant_w_m2, 1361, { earth_evidence: 'documented' }));
  const veg = ['tree_frac', 'crop_frac', 'grass_shrub_frac'].map(k => col(b, k, i));
  rows.push(row('vegetation', 'Vegetated fraction of the window', 'fraction', 0, veg.some(v => v == null) ? null : r(veg.reduce((a: number, v) => a + (v ?? 0), 0), 4),
    { earth_evidence: 'proxy (ESA WorldCover 2021 classes)', target_evidence: 'physical constraint', measurable: !veg.some(v => v == null) }));
  if (w1 != null) rows.push(row('slope_distribution', 'Slope-distribution mismatch (1-Wasserstein)', 'deg', 0, r(w1, 3), { earth_evidence: 'derived (Copernicus GLO-30)', target_evidence: 'derived' }));
  return rows;
}

// ----------------------------------------------------------------------------- dossier

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, '0')).join('');
}
