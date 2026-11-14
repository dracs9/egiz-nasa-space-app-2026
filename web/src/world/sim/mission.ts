// Typed mission specification. Natural-language or LLM proposals must pass validateMission
// before anything is planned or simulated; opaque text never reaches the physics.
import type { MapPoint } from '../core/types';
import type { World } from '../core/world';
import type { Fidelity } from './terramechanics';
import { REGOLITH } from './terramechanics';
import { ROVERS } from './rover';
import { slopeAt } from '../analysis/terrain';

export type RouteObjective = 'shortest' | 'safest' | 'energy' | 'illumination';
export const OBJECTIVES: RouteObjective[] = ['shortest', 'safest', 'energy', 'illumination'];
export const OBJECTIVE_LABEL: Record<RouteObjective, string> = { shortest: 'Shortest', safest: 'Lowest terrain risk', energy: 'Lowest energy', illumination: 'Best illumination' };

export interface Waypoint { id: string; x: number; y: number; dwellS: number; instrumentIds: string[]; label: string; objectRef?: string; rationale?: string }

export interface MissionSpec {
  version: '1.0.0'; worldId: string; name: string;
  start: MapPoint; destination: MapPoint | null; returnToStart: boolean;
  waypoints: Waypoint[];
  roverId: string; roverOverrides: { batteryWh?: number; massKg?: number; maxSpeedMs?: number };
  soilId: string; fidelity: Fidelity;
  constraints: { maxSlopeDeg: number; maxCrossSlopeDeg: number; minReserveFrac: number; avoidCraterInteriors: boolean };
  preferred: RouteObjective;
  departureT: number;
  /** Assumed cumulative fractional area of rocks (Golombek-Rapp form); 0 disables the rock statistic. */
  rockAbundance: number;
  seed: number;
  provenance: { createdBy: 'user' | 'local-parser' | 'llm' | 'default'; request?: string; notes: string[] };
}

export interface Validation { ok: boolean; errors: string[]; warnings: string[] }

const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

export function validateMission(spec: MissionSpec, world: World): Validation {
  const errors: string[] = [], warnings: string[] = [];
  const inBox = (p: MapPoint | null | undefined, label: string) => {
    if (!p || !finite(p.x) || !finite(p.y)) { errors.push(`${label} must have finite coordinates`); return; }
    if (!world.inOperational(p)) errors.push(`${label} (${p.x.toFixed(0)}, ${p.y.toFixed(0)}) is outside the 5 m operational terrain box`);
  };
  if (spec.version !== '1.0.0') errors.push('Unsupported mission spec version');
  if (spec.worldId !== world.manifest.id) errors.push('Mission belongs to another world');
  inBox(spec.start, 'Start');
  if (spec.destination) inBox(spec.destination, 'Destination');
  if (!spec.destination && !spec.returnToStart && !spec.waypoints.length) errors.push('Mission needs a destination, waypoints or return-to-start');
  if (spec.waypoints.length > 8) errors.push('At most 8 science waypoints are supported');
  spec.waypoints.forEach((w, i) => {
    inBox(w, `Waypoint ${i + 1}`);
    if (!finite(w.dwellS) || w.dwellS < 0 || w.dwellS > 86400) errors.push(`Waypoint ${i + 1} dwell must be 0–86400 s`);
  });
  if (!ROVERS.some(r => r.id === spec.roverId)) errors.push(`Unknown rover profile ${spec.roverId}`);
  if (!REGOLITH.some(s => s.id === spec.soilId)) errors.push(`Unknown regolith profile ${spec.soilId}`);
  if (!['fast', 'detailed'].includes(spec.fidelity)) errors.push('Fidelity must be fast or detailed');
  const c = spec.constraints;
  if (!finite(c.maxSlopeDeg) || c.maxSlopeDeg < 2 || c.maxSlopeDeg > 35) errors.push('Maximum slope must be 2–35°');
  if (!finite(c.maxCrossSlopeDeg) || c.maxCrossSlopeDeg < 2 || c.maxCrossSlopeDeg > 35) errors.push('Maximum cross-slope must be 2–35°');
  if (!finite(c.minReserveFrac) || c.minReserveFrac < 0 || c.minReserveFrac > 0.9) errors.push('Energy reserve must be 0–90 %');
  const o = spec.roverOverrides;
  if (o.batteryWh !== undefined && (!finite(o.batteryWh) || o.batteryWh < 100 || o.batteryWh > 100000)) errors.push('Battery override must be 100–100 000 Wh');
  if (o.massKg !== undefined && (!finite(o.massKg) || o.massKg < 20 || o.massKg > 5000)) errors.push('Mass override must be 20–5000 kg');
  if (o.maxSpeedMs !== undefined && (!finite(o.maxSpeedMs) || o.maxSpeedMs <= 0 || o.maxSpeedMs > 2)) errors.push('Speed override must be 0–2 m/s');
  if (!finite(spec.departureT) || spec.departureT < 0 || spec.departureT >= world.illumination.duration) errors.push('Departure time must lie inside the SPICE illumination record');
  if (!finite(spec.rockAbundance) || spec.rockAbundance < 0 || spec.rockAbundance > 0.3) errors.push('Rock abundance must be 0–0.3');
  if (spec.rockAbundance > 0) warnings.push('Rock hazard uses an ASSUMED size-frequency model; rocks are not resolved by the 5 m DEM.');
  if (spec.fidelity === 'detailed') warnings.push('Detailed (Wong–Reece) fidelity uses literature soil parameters; it is not validated against wheel tests for this site.');
  if (!['shortest', 'safest', 'energy', 'illumination'].includes(spec.preferred)) errors.push('Unknown preferred objective');
  return { ok: !errors.length, errors, warnings };
}

/** Nearest point (ring search) whose 5 m slope and 10 m neighbourhood stay below `limitDeg`. Requires loaded analysis tiles. */
export function nearestGentle(world: World, p: MapPoint, limitDeg: number, maxRadius = 800): MapPoint | null {
  const ok = (q: MapPoint) => {
    if (!world.inOperational(q)) return false;
    for (const [dx, dy] of [[0, 0], [10, 0], [-10, 0], [0, 10], [0, -10]]) {
      const s = slopeAt(world, q.x + dx, q.y + dy);
      if (!s || s.slopeDeg > limitDeg) return false;
    }
    return true;
  };
  for (let r = 0; r <= maxRadius; r += 10) {
    const count = r === 0 ? 1 : Math.max(8, Math.round(2 * Math.PI * r / 15));
    for (let k = 0; k < count; k++) {
      const a = (k / count) * 2 * Math.PI, q = { x: Math.round(p.x + r * Math.cos(a)), y: Math.round(p.y + r * Math.sin(a)) };
      if (ok(q)) return q;
    }
  }
  return null;
}

export function defaultMission(world: World): MissionSpec {
  const [w, s, e, n] = world.operationalBox;
  const cy = (s + n) / 2;
  const gentle = (p: MapPoint) => nearestGentle(world, p, 8) ?? p;
  return {
    version: '1.0.0', worldId: world.manifest.id, name: 'Mons Mouton plateau survey',
    start: gentle({ x: w + 700, y: cy + 900 }), destination: gentle({ x: e - 900, y: cy + 1100 }), returnToStart: false, waypoints: [],
    roverId: 'egiz-lr1', roverOverrides: {}, soilId: 'lunar-nominal', fidelity: 'fast',
    constraints: { maxSlopeDeg: 15, maxCrossSlopeDeg: 12, minReserveFrac: 0.2, avoidCraterInteriors: true },
    preferred: 'safest', departureT: Math.round(world.manifest.illumination.maxElevationTime - 36 * 3600), rockAbundance: 0.004, seed: 2026,
    provenance: { createdBy: 'default', notes: ['Default start/destination on the plateau inside the 5 m operational box.'] },
  };
}

export function cloneMission(spec: MissionSpec): MissionSpec { return JSON.parse(JSON.stringify(spec)); }
