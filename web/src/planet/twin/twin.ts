// EGIZ Planetary Studio · digital twin. A configurable vehicle + mission plan executed on the site's analysis
// grid by the existing deterministic mission simulator (astral/sim): Bekker pressure–sinkage with
// Janosi–Hanamoto shear, static load transfer, A* routing on the measured grid, SPICE Sun, terrain shadow, energy.
// This layer adds: vehicle configuration, hazards / keep-outs, scenario comparison, one-at-a-time sensitivity,
// cross-body counterfactuals, an event timeline and reproducible experiment records.
// Everything produced here is SIMULATED. None of it is validated against test-bed or flight data.
import type { Field, XY } from '../../astral/world/field';
import { simulateMission, type MissionResult, type MissionSpec, type Telemetry, type Waypoint } from '../../astral/sim/mission';
import { drive, ROVERS, SOILS, type RoverProfile } from '../../astral/sim/terramechanics';
import type { Objective } from '../../astral/sim/traverse';
import type { SpiceGeometry } from '../../mission/types';
import { GRAVITY, type Body } from '../terrain/site';

export const TWIN_VERSION = 'egiz-twin-1.0.0';
export type NumericKey = 'mass' | 'wheelRadius' | 'wheelWidth' | 'wheelbase' | 'track' | 'cgHeight' | 'groundClearance' | 'maxSpeed' | 'wheelTorqueLimit' | 'maxTiltDeg' | 'maxObstacle' | 'batteryWh' | 'idlePowerW' | 'driveEfficiency' | 'sciencePowerW' | 'scienceStopS';
export const PARAMS: { key: NumericKey; label: string; unit: string; min: number; max: number; step: number }[] = [
  { key: 'mass', label: 'Dry mass', unit: 'kg', min: 20, max: 3000, step: 5 }, { key: 'wheelRadius', label: 'Wheel radius', unit: 'm', min: 0.05, max: 0.8, step: 0.005 },
  { key: 'wheelWidth', label: 'Wheel width', unit: 'm', min: 0.04, max: 0.8, step: 0.01 }, { key: 'wheelbase', label: 'Wheelbase', unit: 'm', min: 0.4, max: 4, step: 0.05 },
  { key: 'track', label: 'Track width', unit: 'm', min: 0.4, max: 4, step: 0.05 }, { key: 'cgHeight', label: 'Centre-of-mass height', unit: 'm', min: 0.1, max: 2, step: 0.05 },
  { key: 'groundClearance', label: 'Ground clearance', unit: 'm', min: 0.05, max: 1.2, step: 0.01 }, { key: 'maxObstacle', label: 'Climbable step', unit: 'm', min: 0.02, max: 1, step: 0.01 },
  { key: 'maxSpeed', label: 'Top speed', unit: 'm/s', min: 0.005, max: 3, step: 0.005 }, { key: 'wheelTorqueLimit', label: 'Wheel torque limit', unit: 'N·m', min: 5, max: 2000, step: 5 },
  { key: 'maxTiltDeg', label: 'Tilt limit', unit: '°', min: 5, max: 45, step: 1 }, { key: 'driveEfficiency', label: 'Drivetrain efficiency', unit: '', min: 0.2, max: 0.95, step: 0.01 },
  { key: 'batteryWh', label: 'Battery capacity', unit: 'Wh', min: 50, max: 30000, step: 50 }, { key: 'idlePowerW', label: 'Idle load', unit: 'W', min: 1, max: 1000, step: 1 },
  { key: 'sciencePowerW', label: 'Instrument load', unit: 'W', min: 0, max: 1500, step: 5 }, { key: 'scienceStopS', label: 'Science stop', unit: 's', min: 60, max: 14400, step: 60 },
];
export interface TwinConfig {
  baseRover: string; overrides: Partial<Record<NumericKey, number>>; wheels: 4 | 6 | 8; payloadKg: number;
  power: { kind: 'rtg'; powerW: number } | { kind: 'solar'; areaM2: number; efficiency: number };
  surface: string; /** 'site' or a substituted body (counterfactual gravity on the same measured terrain) */ gravity: Body | 'site';
}
export interface Hazard extends XY { id: string; label: string; radiusM: number }
export interface MissionPlan { start: XY; destination: XY; waypoints: Waypoint[]; hazards: Hazard[]; objective: Objective; maxSlopeDeg: number; reserveFraction: number; startTimeS: number; requireDaylight: boolean; fidelity: 'fast' | 'detailed' }
export interface TwinSite { key: string; id: string; body: Body; field: Field; sun: SpiceGeometry | null; sha256: string | null; delivery: string }

export function defaultConfig(body: Body): TwinConfig {
  const base = body === 'moon' ? 'egiz-scout' : 'm2020-class', g = ROVERS[base].generation;
  return { baseRover: base, overrides: {}, wheels: 6, payloadKg: 0, power: g.kind === 'rtg' ? { kind: 'rtg', powerW: g.powerW } : { kind: 'solar', areaM2: g.areaM2, efficiency: g.efficiency }, surface: body === 'moon' ? 'lunar-regolith' : body === 'mars' ? 'mars-drift' : 'dry-sand', gravity: 'site' };
}
/** Declared direct-beam transmission applied to solar arrays in the simulation (assumed, constant). */
export const ARRAY_TRANSMISSION: Record<Body, number> = { moon: 1, mars: 0.6, earth: 0.7 };

/** The vehicle actually simulated: base profile + overrides + payload. Returns errors instead of clamping silently. */
export function buildRover(config: TwinConfig, body: Body): { rover: RoverProfile; errors: string[] } {
  const base = ROVERS[config.baseRover] ?? ROVERS['m2020-class'], errors: string[] = [], o = config.overrides;
  for (const p of PARAMS) { const v = o[p.key]; if (v !== undefined && !(Number.isFinite(v) && v >= p.min && v <= p.max)) errors.push(`${p.label} must be between ${p.min} and ${p.max} ${p.unit}.`.replace(' .', '.')); }
  if (![4, 6, 8].includes(config.wheels)) errors.push('Wheel count must be 4, 6 or 8.');
  if (!(config.payloadKg >= 0 && config.payloadKg <= 2000)) errors.push('Payload must be between 0 and 2000 kg.');
  if (!SOILS[config.surface]) errors.push(`Unknown surface profile: ${config.surface}.`);
  if (config.power.kind === 'solar' ? !(config.power.areaM2 > 0 && config.power.areaM2 <= 60 && config.power.efficiency > 0 && config.power.efficiency <= 0.5) : !(config.power.powerW >= 0 && config.power.powerW <= 5000)) errors.push('Power source parameters are out of range.');
  const merged = { ...base, ...o };
  if (merged.groundClearance < merged.maxObstacle) errors.push('Climbable step cannot exceed ground clearance.');
  const rover: RoverProfile = { ...merged, id: 'twin', name: `${base.name.split(' (')[0]} — configured`, kind: 'hypothetical', wheels: config.wheels, mass: merged.mass + config.payloadKg,
    note: 'Configured twin vehicle. Parameters are scenario inputs, not a specification of any real rover.',
    generation: config.power.kind === 'rtg' ? { kind: 'rtg', powerW: config.power.powerW } : { kind: 'solar', areaM2: config.power.areaM2, efficiency: config.power.efficiency, transmission: ARRAY_TRANSMISSION[body] } };
  return { rover, errors };
}

/**
 * The limits the route planner enforces, as one screen: the slope limit (plan, tilt and the steepest grade the drive
 * model can climb or descend on the chosen soil under the chosen gravity) and the climbable step.
 */
export function mobilityLimits(config: TwinConfig, body: Body, planMaxSlopeDeg = 15): { maxSlopeDeg: number; maxStepM: number; tractionLimitDeg: number; binding: 'plan' | 'tilt' | 'traction' } {
  const { rover } = buildRover(config, body), soil = SOILS[config.surface] ?? SOILS['dry-sand'], g = GRAVITY[config.gravity === 'site' ? body : config.gravity];
  let traction = 0;
  for (let d = 1; d <= 40; d++) { const r = (d * Math.PI) / 180; if (!drive(rover, soil, g, r, 0).admissible || !drive(rover, soil, g, -r, 0).admissible) break; traction = d; }
  const maxSlopeDeg = Math.min(planMaxSlopeDeg, rover.maxTiltDeg, traction);
  return { maxSlopeDeg, maxStepM: rover.maxObstacle, tractionLimitDeg: traction, binding: maxSlopeDeg === traction && traction < Math.min(planMaxSlopeDeg, rover.maxTiltDeg) ? 'traction' : maxSlopeDeg === rover.maxTiltDeg && rover.maxTiltDeg < planMaxSlopeDeg ? 'tilt' : 'plan' };
}

export interface TimelineItem { t: number; type: string; title: string; detail: string; x: number; y: number; batteryWh: number | null; distanceM: number | null }
export interface TwinRun {
  version: string; result: MissionResult; rover: RoverProfile; gravity: number; gravityBody: Body; timeline: TimelineItem[]; warnings: string[];
  summary: { outcome: string; distanceM: number; durationS: number; driveTimeS: number; energyUsedWh: number; energyGeneratedWh: number; minBatteryWh: number; finalBatteryWh: number; maxSlip: number; meanSlip: number; maxSinkageM: number; maxTiltDeg: number; shadowTimeS: number; scienceStops: number; meanSpeedMs: number; whPerKm: number };
  fingerprint: string;
}
const TITLES: Record<string, string> = { start: 'Departure', science: 'Science stop', 'shadow-entry': 'Enters terrain shadow', 'shadow-exit': 'Leaves terrain shadow', 'high-slip': 'High wheel slip', immobilized: 'Immobilised', reserve: 'Energy reserve reached', darkness: 'Sunset', complete: 'Arrival', 'data-gap': 'Data gap' };

/** Deterministic 64-bit FNV-1a fingerprint of a JSON-serialisable value (identity of a result, not a security hash). */
export function fingerprint(value: unknown): string {
  const text = JSON.stringify(value, (_k, v) => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toPrecision(9)) : v));
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b ^ (c + i), 0x85ebca6b) >>> 0; }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export function runTwin(site: TwinSite, config: TwinConfig, plan: MissionPlan): TwinRun {
  const gravityBody = config.gravity === 'site' ? site.body : config.gravity, gravity = GRAVITY[gravityBody], { rover, errors } = buildRover(config, site.body);
  const spec: MissionSpec = { version: '1.0.0', siteId: site.id, roverId: 'twin', surface: config.surface, start: plan.start, destination: plan.destination, waypoints: plan.waypoints, objective: plan.objective, maxSlopeDeg: plan.maxSlopeDeg, reserveFraction: plan.reserveFraction, startTimeS: plan.startTimeS, requireDaylight: plan.requireDaylight, fidelity: plan.fidelity };
  const world = { siteId: site.id, gravity, field: site.field, solar: site.sun, obstacles: plan.hazards.map(h => ({ id: h.id, x: h.x, y: h.y, radius: h.radiusM, height: null })) };
  let result = simulateMission(spec, world, { twin: rover });
  if (errors.length) result = { ...result, outcome: 'invalid', explanation: errors.join(' '), frames: [], events: [], route: null };
  const m = result.metrics, f = site.field, warnings: string[] = [];
  if (f.posting > rover.wheelbase) warnings.push(`Terrain posting (${f.posting} m) is coarser than the vehicle (${rover.wheelbase.toFixed(1)} m wheelbase): rocks, steps and ruts are not resolved, so mobility results are regional screens, not wheel-scale predictions.`);
  if (gravityBody !== site.body) warnings.push(`Counterfactual: ${site.body} terrain simulated under ${gravityBody} gravity (${gravity} m/s²). Soil profile and Sun record are unchanged.`);
  if (SOILS[config.surface]?.origin === 'assumed') warnings.push(`Soil "${SOILS[config.surface].name}" is a declared literature profile, not a measurement at this site.`);
  if (!site.sun) warnings.push('No Sun record: shadow, daylight and solar generation were not evaluated.');
  else if (!site.sun.engine.includes('CSPICE')) warnings.push('Sun geometry is analytic (not CSPICE) for this streamed site.');
  if (result.outcome === 'completed' && m.minBatteryWh < rover.batteryWh * (plan.reserveFraction + 0.1)) warnings.push('Battery came within 10 % of capacity of the reserve.');
  if (m.maxSlip > 0.6) warnings.push(`Peak wheel slip ${(m.maxSlip * 100).toFixed(0)} %: outside the range where the quasi-static slip model is trustworthy.`);
  if (m.maxTiltDeg > 0.8 * rover.maxTiltDeg) warnings.push(`Peak tilt ${m.maxTiltDeg.toFixed(1)}° is above 80 % of the ${rover.maxTiltDeg}° limit.`);
  const nearest = (t: number): Telemetry | null => { let best: Telemetry | null = null; for (const fr of result.frames) { if (fr.t > t + 1e-6) break; best = fr; } return best ?? result.frames[0] ?? null; };
  const timeline = result.events.map(e => { const fr = nearest(e.t); return { t: e.t, type: e.type, title: TITLES[e.type] ?? e.type, detail: e.detail, x: e.x, y: e.y, batteryWh: fr ? fr.batteryWh : null, distanceM: fr ? fr.distance : null }; });
  if (result.outcome !== 'completed' && result.outcome !== 'invalid' && !timeline.some(t => ['immobilized', 'reserve', 'darkness'].includes(t.type))) { const last = result.frames.at(-1); timeline.push({ t: m.durationS, type: result.outcome, title: 'Mission terminated', detail: result.explanation, x: last?.x ?? plan.start.x, y: last?.y ?? plan.start.y, batteryWh: last?.batteryWh ?? null, distanceM: last?.distance ?? null }); }
  const summary = { outcome: result.outcome, distanceM: m.distanceM, durationS: m.durationS, driveTimeS: m.driveTimeS, energyUsedWh: m.energyUsedWh, energyGeneratedWh: m.energyGeneratedWh, minBatteryWh: m.minBatteryWh, finalBatteryWh: m.finalBatteryWh, maxSlip: m.maxSlip, meanSlip: m.meanSlip, maxSinkageM: m.maxSinkageM, maxTiltDeg: m.maxTiltDeg, shadowTimeS: m.shadowTimeS, scienceStops: m.scienceStops,
    meanSpeedMs: m.driveTimeS > 0 ? m.distanceM / m.driveTimeS : 0, whPerKm: m.distanceM > 0 ? m.energyUsedWh / (m.distanceM / 1000) : 0 };
  return { version: TWIN_VERSION, result, rover, gravity, gravityBody, timeline, warnings, summary, fingerprint: fingerprint({ site: [site.key, site.sha256, f.posting, f.side], config, plan, summary, route: result.route?.points.length ?? 0 }) };
}

/** Square window of the analysis grid around the mission (same posts, no resampling); used for fast scenario sweeps. */
export function cropField(f: Field, points: XY[], marginM: number): Field {
  const xs = points.map(p => p.x), ys = points.map(p => p.y), span = (f.side - 1) * f.posting;
  const half = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 + marginM, cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  if (half * 2 >= span) return f;
  const n = Math.ceil((2 * half) / f.posting) + 1, c0 = Math.max(0, Math.min(f.side - n, Math.round((cx - half - f.west) / f.posting))), r0 = Math.max(0, Math.min(f.side - n, Math.round((f.north - (cy + half)) / f.posting)));
  const z = new Float32Array(n * n);
  for (let r = 0; r < n; r++) z.set(f.z.subarray((r0 + r) * f.side + c0, (r0 + r) * f.side + c0 + n), r * n);
  return { side: n, posting: f.posting, west: f.west + c0 * f.posting, north: f.north - r0 * f.posting, z, level: f.level, provenance: f.provenance };
}
const missionPoints = (p: MissionPlan) => [p.start, p.destination, ...p.waypoints, ...p.hazards];
export const sweepSite = (site: TwinSite, plan: MissionPlan): TwinSite => ({ ...site, field: cropField(site.field, missionPoints(plan), Math.max(400, site.field.posting * 40)) });

export type Outputs = Pick<TwinRun['summary'], 'energyUsedWh' | 'durationS' | 'minBatteryWh' | 'maxSlip' | 'maxSinkageM' | 'distanceM' | 'whPerKm'>;
export const OUTPUT_LABEL: Record<keyof Outputs, string> = { energyUsedWh: 'Energy used (Wh)', durationS: 'Duration (s)', minBatteryWh: 'Minimum battery (Wh)', maxSlip: 'Peak slip', maxSinkageM: 'Peak sinkage (m)', distanceM: 'Distance (m)', whPerKm: 'Energy per km (Wh/km)' };
export interface Delta { key: keyof Outputs; label: string; before: number; after: number; change: number; relative: number | null }
/** Before/after comparison of two runs, largest relative change first. */
export function compareRuns(a: TwinRun, b: TwinRun): { deltas: Delta[]; outcomeChanged: boolean; before: string; after: string } {
  const deltas = (Object.keys(OUTPUT_LABEL) as (keyof Outputs)[]).map(key => { const before = a.summary[key], after = b.summary[key]; return { key, label: OUTPUT_LABEL[key], before, after, change: after - before, relative: Math.abs(before) > 1e-9 ? (after - before) / Math.abs(before) : null }; });
  return { deltas: deltas.sort((x, y) => Math.abs(y.relative ?? 0) - Math.abs(x.relative ?? 0)), outcomeChanged: a.summary.outcome !== b.summary.outcome, before: a.summary.outcome, after: b.summary.outcome };
}

export interface SensitivityRow { param: string; label: string; unit: string; base: number; low: number; high: number; outcomeLow: string; outcomeHigh: string; /** d ln(output) / d ln(parameter), central difference */ elasticity: Partial<Record<keyof Outputs, number>>; strength: number }
/**
 * One-at-a-time sensitivity: each parameter is moved by ±`fraction` with everything else fixed and the mission is
 * re-simulated (routes are re-planned). Elasticity is the central log-difference. It is a local, first-order
 * measure: it says nothing about interactions between parameters.
 */
export function sensitivity(site: TwinSite, config: TwinConfig, plan: MissionPlan, keys: (NumericKey | 'payloadKg')[], fraction = 0.2, onProgress?: (done: number, total: number) => void): { base: TwinRun; rows: SensitivityRow[] } {
  const local = sweepSite(site, plan), base = runTwin(local, config, plan), profile = buildRover(config, site.body).rover, rows: SensitivityRow[] = [];
  keys.forEach((key, i) => {
    const meta = key === 'payloadKg' ? { label: 'Payload', unit: 'kg' } : PARAMS.find(p => p.key === key)!;
    const value = key === 'payloadKg' ? Math.max(config.payloadKg, profile.mass * 0.1) : (profile[key] as number);
    const vary = (v: number): TwinConfig => (key === 'payloadKg' ? { ...config, payloadKg: v } : { ...config, overrides: { ...config.overrides, [key]: v } });
    const lo = runTwin(local, vary(value * (1 - fraction)), plan), hi = runTwin(local, vary(value * (1 + fraction)), plan), elasticity: SensitivityRow['elasticity'] = {};
    for (const k of Object.keys(OUTPUT_LABEL) as (keyof Outputs)[]) { const a = lo.summary[k], b = hi.summary[k]; if (a > 0 && b > 0) elasticity[k] = Math.log(b / a) / Math.log((1 + fraction) / (1 - fraction)); }
    const strength = Math.max(0, ...Object.values(elasticity).map(Math.abs)) + (lo.summary.outcome !== base.summary.outcome || hi.summary.outcome !== base.summary.outcome ? 10 : 0);
    rows.push({ param: key, label: meta.label, unit: meta.unit, base: value, low: value * (1 - fraction), high: value * (1 + fraction), outcomeLow: lo.summary.outcome, outcomeHigh: hi.summary.outcome, elasticity, strength });
    onProgress?.(i + 1, keys.length);
  });
  return { base, rows: rows.sort((a, b) => b.strength - a.strength) };
}
/** The same vehicle, plan and measured terrain under Earth, Mars and Moon gravity. A counterfactual, not three sites. */
export function acrossBodies(site: TwinSite, config: TwinConfig, plan: MissionPlan): Record<Body, TwinRun> {
  const local = sweepSite(site, plan);
  return { earth: runTwin(local, { ...config, gravity: 'earth' }, plan), mars: runTwin(local, { ...config, gravity: 'mars' }, plan), moon: runTwin(local, { ...config, gravity: 'moon' }, plan) };
}

export interface Experiment {
  schema: 'egiz.twin_experiment'; version: string; id: string; name: string; createdUtc: string;
  site: { key: string; id: string; body: Body; postingM: number; gridSide: number; sha256: string | null; delivery: string; sunEngine: string | null; sunEpochUtc: string | null };
  config: TwinConfig; plan: MissionPlan; summary: TwinRun['summary']; explanation: string; warnings: string[]; timeline: TimelineItem[];
  routes: { objective: string; lengthM: number | null; driveEnergyWh: number | null; driveTimeS: number | null; maxSlopeDeg: number | null; riskExposure: number | null; reason: string | null }[];
  model: MissionResult['model']; fingerprint: string;
}
export function toExperiment(site: TwinSite, config: TwinConfig, plan: MissionPlan, run: TwinRun, name: string, id: string, createdUtc: string): Experiment {
  return { schema: 'egiz.twin_experiment', version: TWIN_VERSION, id, name, createdUtc,
    site: { key: site.key, id: site.id, body: site.body, postingM: site.field.posting, gridSide: site.field.side, sha256: site.sha256, delivery: site.delivery, sunEngine: site.sun?.engine ?? null, sunEpochUtc: site.sun?.epochUtc ?? null },
    config: JSON.parse(JSON.stringify(config)), plan: JSON.parse(JSON.stringify(plan)), summary: run.summary, explanation: run.result.explanation, warnings: run.warnings, timeline: run.timeline,
    routes: run.result.alternatives.map(r => (r.points ? { objective: r.objective, lengthM: r.metrics.lengthM, driveEnergyWh: r.metrics.driveEnergyWh, driveTimeS: r.metrics.driveTimeS, maxSlopeDeg: r.metrics.maxSlopeDeg, riskExposure: r.metrics.riskExposure, reason: null } : { objective: r.objective, lengthM: null, driveEnergyWh: null, driveTimeS: null, maxSlopeDeg: null, riskExposure: null, reason: r.reason })),
    model: run.result.model, fingerprint: run.fingerprint };
}
/** Re-execute a saved experiment on the loaded site and report whether the result fingerprint is reproduced. */
export function reproduce(site: TwinSite, exp: Experiment): { reproduced: boolean; reason: string; run: TwinRun | null } {
  if (exp.schema !== 'egiz.twin_experiment') return { reproduced: false, reason: 'Not a twin experiment record.', run: null };
  if (exp.site.key !== site.key) return { reproduced: false, reason: `The experiment belongs to site ${exp.site.key}; open that site to reproduce it.`, run: null };
  if (exp.site.sha256 !== site.sha256 || exp.site.postingM !== site.field.posting || exp.site.gridSide !== site.field.side) return { reproduced: false, reason: 'The terrain grid differs from the one recorded (other dataset version, posting or streamed content).', run: null };
  if (exp.version !== TWIN_VERSION) return { reproduced: false, reason: `Recorded with ${exp.version}; this build runs ${TWIN_VERSION}.`, run: null };
  const run = runTwin(site, exp.config, exp.plan);
  return run.fingerprint === exp.fingerprint ? { reproduced: true, reason: `Fingerprint ${run.fingerprint} reproduced exactly.`, run } : { reproduced: false, reason: `Fingerprint differs: recorded ${exp.fingerprint}, recomputed ${run.fingerprint}.`, run };
}
export const twinSite = (s: { key: string; id: string; body: Body; field: Field; sun: SpiceGeometry | null; provenance: { sha256: string | null; delivery: string } }): TwinSite => ({ key: s.key, id: s.id, body: s.body, field: s.field, sun: s.sun, sha256: s.provenance.sha256, delivery: s.provenance.delivery });
