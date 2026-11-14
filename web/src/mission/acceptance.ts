import type { RunResult, Scenario } from './types';

export interface TestRequirements {
  maxDurationS: number;
  maxEnergyWh: number;
  minReserveWh: number;
  minAltitudeM: number;
  maxTouchdownMS: number;
}
export interface TestGate {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'unresolved';
  value: number | string | null;
  limit: number | null;
  unit: string;
  operator?: '≤' | '≥';
}
export function defaultRequirements(s: Scenario): TestRequirements {
  return { maxDurationS: s.duration, maxEnergyWh: s.rover.batteryWh, minReserveWh: 0,
    minAltitudeM: 1000, maxTouchdownMS: s.vehicle.safeSpeed };
}
export function requirementsValid(r: TestRequirements) {
  return Object.values(r).every(n => Number.isFinite(n) && n >= 0);
}
/** Acceptance screening of recorded model output, never a flight certification. */
export function assessRun(run: RunResult, r: TestRequirements): TestGate[] {
  const gate = (id: string, label: string, value: number | null, limit: number, unit: string, operator: '≤' | '≥' = '≤'): TestGate => ({
    id, label, value, limit, unit, operator,
    status: value === null || !Number.isFinite(value) || !Number.isFinite(limit) || limit < 0 ? 'unresolved' : (operator === '≤' ? value <= limit + 1e-8 : value + 1e-8 >= limit) ? 'pass' : 'fail',
  });
  const mode = run.scenario.mode;
  const gates: TestGate[] = [gate('time', 'Operation time', run.metrics.duration, r.maxDurationS, 's')];
  if (mode === 'rover' || mode === 'eva') {
    gates.unshift({ id: 'arrival', label: 'Destination reached', value: run.outcome, limit: null, unit: '', status: run.outcome === 'destination_reached' ? 'pass' : 'fail' });
    gates.push(gate('energy', 'Electrical energy', run.metrics.energyWh, r.maxEnergyWh, 'Wh'));
    const reserve = run.frames.at(-1)?.mobility?.batteryRemainingWh ?? run.scenario.rover.batteryWh - run.metrics.energyWh;
    gates.push(gate('reserve', 'Final battery reserve', reserve, r.minReserveWh, 'Wh', '≥'));
    if (run.scenario.rover.design) {
      const samples = run.frames.map(f => f.mobility?.stabilityMarginDeg);
      const minimum = samples.length && samples.every(n => n !== undefined && Number.isFinite(n)) ? samples.reduce<number>((minimum, n) => Math.min(minimum, n!), Infinity) : null;
      gates.push(gate('stability', 'Static stability margin', minimum, 0, '°', '≥'));
    }
  } else if (mode === 'descent') {
    gates.unshift({ id: 'landing', label: 'Landing constraints', value: run.outcome, limit: null, unit: '', status: run.outcome === 'soft_landing' ? 'pass' : 'fail' });
    gates.push(gate('contact', 'Touchdown speed', run.metrics.touchdownSpeed, r.maxTouchdownMS, 'm/s'));
  } else {
    gates.unshift({ id: 'liftoff', label: 'Liftoff recorded', value: run.outcome, limit: null, unit: '', status: run.events.some(e => e.type === 'Liftoff') ? 'pass' : 'fail' });
    gates.push(gate('altitude', 'Target altitude', run.metrics.maxAltitude, r.minAltitudeM, 'm', '≥'));
    gates.push({ id: 'bounds', label: 'Model boundaries', value: run.outcome, limit: null, unit: '', status: ['model_limit', 'integration_limit', 'terrain_boundary'].includes(run.outcome) ? 'fail' : 'pass' });
  }
  return gates;
}

export interface InputChange { path: string; before: unknown; after: unknown }
/** Scalar inputs only: geometry records are identified by their site/epoch and kernel hashes. */
export function scenarioChanges(before: Scenario, after: Scenario): InputChange[] {
  function scalars(value: unknown, path = '', output: Record<string, unknown> = {}) {
    if (value === null || typeof value !== 'object') { output[path] = value; return output; }
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'samples') continue;
      scalars(entry, path ? `${path}.${key}` : key, output);
    }
    return output;
  }
  const a = scalars(before), b = scalars(after);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().filter(key => a[key] !== b[key]).map(path => ({ path, before: a[path] ?? null, after: b[path] ?? null }));
}
export function baselineCompatibility(a: RunResult, b: RunResult) {
  const reasons: string[] = [];
  if (a.model !== b.model || a.integrator !== b.integrator) reasons.push('Different numerical models');
  if (a.scenario.mode !== b.scenario.mode) reasons.push('Different mission types');
  if (a.terrain.id !== b.terrain.id || a.terrain.source.sha256 !== b.terrain.source.sha256 || JSON.stringify(a.terrain.grid) !== JSON.stringify(b.terrain.grid)) reasons.push('Different terrain geometry');
  if (a.scenario.kind !== b.scenario.kind || JSON.stringify(a.scenario.environment) !== JSON.stringify(b.scenario.environment)) reasons.push('Different physical environments');
  const sameRoute = JSON.stringify([a.scenario.start, a.scenario.destination, a.scenario.rover.route]) === JSON.stringify([b.scenario.start, b.scenario.destination, b.scenario.rover.route]);
  return { comparable: reasons.length === 0, reasons, sameRoute };
}

export function acceptanceReport(current: RunResult, baseline: RunResult | null, requirements: TestRequirements) {
  if (!requirementsValid(requirements)) throw Error('Invalid acceptance requirements');
  return { schema: 'egiz.acceptance_report' as const, version: '1.0.0' as const,
    interpretation: 'User-defined screening of recorded EGIZ model outputs, not flight qualification or mission-success probability.',
    requirements, gates: assessRun(current, requirements),
    comparison: baseline ? { ...baselineCompatibility(baseline, current), changes: scenarioChanges(baseline.scenario, current.scenario) } : null,
    current, baseline };
}
