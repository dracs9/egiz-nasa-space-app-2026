// Quasi-static rover traverse simulation on the shared analysis terrain.
// Per 1 m step: wheel contacts sampled on the measured surface -> chassis plane (pitch, roll),
// terramechanics wheel state at that grade -> slip, sinkage, torque, power; SPICE Sun/Earth with
// terrain occultation -> panel generation and direct-to-Earth line of sight; battery integration.
// Fails explicitly on immobilization, motor stall, static instability, depletion or record exhaustion.
import type { IlluminationRecord, MapPoint } from '../core/types';
import type { World } from '../core/world';
import { bodiesAt, earthVisibleFraction, sunVisibleFraction } from '../analysis/illumination';
import { fitPlane } from '../analysis/terrain';
import { gradeTable, lateralUtilization, lookupGrade, REGOLITH, type GradeTable } from './terramechanics';
import { LUNAR_GRAVITY, ROVERS, tipAngleDeg, wheelContacts, type RoverProfile } from './rover';
import type { MissionSpec, Route } from './index';
import { rockHazard } from './rocks';

const DEG = 180 / Math.PI;
export const ASTRAL_SIM_VERSION = '1.0.0';

export interface Frame {
  t: number; s: number; x: number; y: number; h: number; headingDeg: number; pitchDeg: number; rollDeg: number;
  slip: number; sinkageM: number; speedMs: number; loadW: number; genW: number; socWh: number;
  sunFrac: number; earthVisible: boolean; torqueNm: number; stabilityMarginDeg: number; phase: 'drive' | 'science' | 'halt';
}
export interface SimEvent { t: number; s: number; x: number; y: number; kind: 'info' | 'science' | 'warning' | 'failure'; code: string; message: string }
export interface SimSummary {
  status: 'completed' | 'failed'; failure: string | null;
  distanceM: number; durationS: number; driveTimeS: number; energyUsedWh: number; energyGeneratedWh: number;
  minSocFrac: number; finalSocFrac: number; reserveBreached: boolean;
  maxSlip: number; meanSlip: number; maxSinkageM: number; maxPitchDeg: number; maxRollDeg: number; minStabilityMarginDeg: number;
  sunlitFraction: number; earthLinkFraction: number; scienceStops: number; maxSurfaceSlopeDeg: number;
  rockEncounterProbability: number | null; energySensitivityWh: { loose: number | 'immobile'; firm: number | 'immobile' };
}
export interface SimResult { version: string; spec: MissionSpec; routeId: string; rover: RoverProfile; frames: Frame[]; events: SimEvent[]; summary: SimSummary; tiles: string[] }

export function effectiveRover(spec: MissionSpec): RoverProfile {
  const base = ROVERS.find(r => r.id === spec.roverId);
  if (!base) throw new Error(`Unknown rover ${spec.roverId}`);
  return { ...base, ...Object.fromEntries(Object.entries(spec.roverOverrides).filter(([, v]) => v !== undefined)) };
}
export function tableFor(spec: MissionSpec, rover: RoverProfile, soilId = spec.soilId): GradeTable {
  const soil = REGOLITH.find(s => s.id === soilId)!;
  return gradeTable(rover.massKg, LUNAR_GRAVITY, rover.wheels, rover.wheelRadiusM, rover.wheelWidthM, soil, spec.fidelity);
}

interface Options { table?: GradeTable; frameEvery?: number; illuminationEveryS?: number }

export function simulate(world: World, spec: MissionSpec, route: Route, opts: Options = {}): SimResult {
  if (!route.feasible || route.points.length < 2) throw new Error('Route is not feasible; nothing to simulate.');
  const rover = effectiveRover(spec), rec: IlluminationRecord = world.illumination;
  const soil = REGOLITH.find(s => s.id === spec.soilId)!;
  const table = opts.table ?? tableFor(spec, rover);
  const contacts = wheelContacts(rover), tip = tipAngleDeg(rover);
  const contactArea = rover.wheels * rover.wheelWidthM * Math.sqrt(2 * rover.wheelRadiusM * 0.02);
  const capacity = rover.batteryWh, reserve = spec.constraints.minReserveFrac * capacity;
  const frames: Frame[] = [], events: SimEvent[] = [], tiles = new Set<string>();
  const ev = (kind: SimEvent['kind'], code: string, message: string) => events.push({ t: round(t, 1), s: round(s, 2), x: round(pos.x, 2), y: round(pos.y, 2), kind, code, message });
  // Precompute route stations at 1 m spacing with stop flags at leg ends.
  const stations = stationsOf(route.points, route.legs, 1.0);
  const stopIds = route.waypointOrder;
  let t = 0, s = 0, soc = capacity, pos: MapPoint = { ...route.points[0] }, failure: string | null = null;
  let driveTime = 0, used = 0, generated = 0, sunlitT = 0, linkT = 0, totalT = 0, slipSum = 0, slipN = 0;
  let maxSlip = 0, maxSink = 0, maxPitch = 0, maxRoll = 0, minMargin = Infinity, minSoc = capacity, reserveBreached = false, scienceStops = 0, maxSurfaceSlope = 0;
  let lastIllum = -Infinity, sunFrac = 0, earthVis = false, sunVec: [number, number, number] = [0, 0, 1], flux = 0;
  const illumEvery = opts.illuminationEveryS ?? 300, frameEvery = opts.frameEvery ?? 5;
  const gradeLog: number[] = [], distLog: number[] = [];

  const refreshIllumination = (h: number) => {
    if (spec.departureT + t > rec.duration) { failure = 'SPICE illumination record exhausted (mission exceeds the 30-day record)'; return; }
    const b = bodiesAt(rec, spec.departureT + t);
    sunVec = b.sun; flux = b.fluxWm2;
    sunFrac = sunVisibleFraction(world, pos.x, pos.y, h + rover.panelCentreHeightM, b.sun);
    earthVis = earthVisibleFraction(world, pos.x, pos.y, h + rover.mastHeightM, b.earth) > 0.5;
    lastIllum = t;
  };
  const generation = (headingRad: number) => {
    if (sunFrac <= 0) return 0;
    let g = 0;
    for (const p of rover.panels) {
      const yaw = headingRad + p.normalYawDeg / DEG; // heading measured from north towards east
      const nE = Math.sin(yaw), nN = Math.cos(yaw);
      g += flux * p.areaM2 * rover.panelEfficiency * sunFrac * Math.max(0, nE * sunVec[0] + nN * sunVec[1]);
    }
    return g;
  };
  const integrate = (dt: number, load: number, gen: number, phase: Frame['phase']) => {
    soc = Math.min(capacity, soc + (gen - load) * dt / 3600);
    used += load * dt / 3600; generated += gen * dt / 3600;
    totalT += dt; if (sunFrac > 0.5) sunlitT += dt; if (earthVis) linkT += dt;
    t += dt; minSoc = Math.min(minSoc, soc);
    if (!reserveBreached && soc < reserve) { reserveBreached = true; ev('warning', 'reserve', `Battery fell below the ${Math.round(spec.constraints.minReserveFrac * 100)} % reserve (${soc.toFixed(0)} Wh).`); }
    if (soc <= 0) { failure = 'Battery depleted'; soc = 0; }
    void phase;
  };

  ev('info', 'start', `Departure at T+${(spec.departureT / 3600).toFixed(1)} h after ${rec.epochUtc}; ${rover.name}; ${soil.name}; ${spec.fidelity} terramechanics.`);
  let lastHeading = 0;
  for (let k = 0; k < stations.length - 1 && !failure; k++) {
    const a = stations[k], b = stations[k + 1];
    const ds = Math.hypot(b.x - a.x, b.y - a.y);
    if (ds < 1e-9) continue;
    const heading = Math.atan2(b.x - a.x, b.y - a.y); lastHeading = heading;
    pos = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // Wheel contacts on the measured surface -> chassis plane.
    const pts: [number, number, number][] = [];
    for (const [fx, fy] of contacts) {
      const ex = pos.x + fx * Math.sin(heading) - fy * Math.cos(heading);
      const ny = pos.y + fx * Math.cos(heading) + fy * Math.sin(heading);
      tiles.add(world.tileKeyAt(world.analysisLevel({ x: ex, y: ny }), ex, ny));
      pts.push([ex - pos.x, ny - pos.y, world.requireHeight(ex, ny)]);
    }
    const plane = fitPlane(pts);
    const h = plane.c;
    const along = plane.a * Math.sin(heading) + plane.b * Math.cos(heading);
    const across = plane.a * -Math.cos(heading) + plane.b * Math.sin(heading); // positive = left side higher
    const pitch = Math.atan(along) * DEG, roll = Math.atan(across) * DEG;
    const surface = Math.atan(Math.hypot(plane.a, plane.b)) * DEG;
    maxSurfaceSlope = Math.max(maxSurfaceSlope, surface);
    const centre = world.requireHeight(pos.x, pos.y);
    if (centre - h > rover.groundClearanceM) ev('warning', 'high-centre', `Terrain under the chassis is ${(centre - h).toFixed(2)} m above the wheel plane (clearance ${rover.groundClearanceM} m) at 5 m DEM resolution.`);
    const wheel = lookupGrade(table, pitch);
    const margin = tip - Math.max(Math.abs(roll), Math.abs(pitch));
    minMargin = Math.min(minMargin, margin);
    if (wheel.immobile) { failure = `Immobilized: soil cannot develop the drawbar pull required on a ${pitch.toFixed(1)}° grade`; break; }
    if (wheel.torqueNm > rover.wheelStallTorqueNm) { failure = `Motor stall: ${wheel.torqueNm.toFixed(0)} N·m required per wheel exceeds ${rover.wheelStallTorqueNm} N·m`; break; }
    if (margin <= 0) { failure = `Static stability exceeded (pitch ${pitch.toFixed(1)}°, roll ${roll.toFixed(1)}°, tip angle ${tip.toFixed(1)}°)`; break; }
    if (margin < 5 && !events.some(e => e.code === 'stability' && s - e.s < 50)) ev('warning', 'stability', `Stability margin ${margin.toFixed(1)}° (roll ${roll.toFixed(1)}°).`);
    const lat = lateralUtilization(rover.massKg, LUNAR_GRAVITY, roll, contactArea, soil);
    if (lat > 0.8 && !events.some(e => e.code === 'lateral' && s - e.s < 50)) ev('warning', 'lateral', `Lateral traction utilization ${(lat * 100).toFixed(0)} % on ${Math.abs(roll).toFixed(1)}° cross-slope.`);
    const v = rover.maxSpeedMs * (1 - wheel.slip);
    const dt = ds / v;
    if (t - lastIllum >= illumEvery || k === 0) { refreshIllumination(h); if (failure) break; }
    const drive = rover.wheels * Math.max(0, wheel.torqueNm) * (rover.maxSpeedMs / rover.wheelRadiusM) / rover.drivetrainEfficiency;
    const load = drive + rover.avionicsW, gen = generation(heading);
    integrate(dt, load, gen, 'drive');
    driveTime += dt; s += ds;
    gradeLog.push(pitch); distLog.push(ds);
    maxSlip = Math.max(maxSlip, wheel.slip); slipSum += wheel.slip; slipN++;
    maxSink = Math.max(maxSink, wheel.sinkageM); maxPitch = Math.max(maxPitch, Math.abs(pitch)); maxRoll = Math.max(maxRoll, Math.abs(roll));
    if (k % frameEvery === 0) frames.push(frame('drive', h, heading, pitch, roll, wheel.slip, wheel.sinkageM, v, load, gen, wheel.torqueNm, margin));
    // Science stop at a leg end (except the final destination).
    const legIndex = route.legs.indexOf(b.node);
    if (b.stop && legIndex >= 0 && legIndex < stopIds.length) {
      const wp = spec.waypoints.find(w => w.id === stopIds[legIndex]);
      if (wp) {
        scienceStops++;
        const instruments = rover.instruments.filter(i => wp.instrumentIds.includes(i.id));
        const instrumentW = instruments.reduce((a, i) => a + i.powerW, 0);
        ev('science', 'stop', `Science stop ${wp.label}: ${(wp.dwellS / 60).toFixed(0)} min, ${instruments.map(i => i.name).join(', ') || 'imaging only'} (${instrumentW} W).`);
        let left = wp.dwellS;
        while (left > 0 && !failure) {
          const dts = Math.min(60, left);
          if (t - lastIllum >= illumEvery) { refreshIllumination(h); if (failure) break; }
          integrate(dts, rover.avionicsW + instrumentW, generation(heading), 'science');
          left -= dts;
        }
        frames.push(frame('science', h, heading, pitch, roll, 0, wheel.sinkageM, 0, rover.avionicsW + instrumentW, generation(heading), 0, margin));
      }
    }
  }
  if (failure) ev('failure', 'halt', failure);
  else ev('info', 'arrive', `Arrived after ${(s / 1000).toFixed(2)} km in ${(t / 3600).toFixed(2)} h.`);
  const last = stations[Math.min(stations.length - 1, Math.max(0, frames.length ? stations.length - 1 : 0))];
  if (!failure) pos = { x: last.x, y: last.y };
  frames.push(frame(failure ? 'halt' : 'drive', world.heightAt(pos.x, pos.y) ?? 0, lastHeading, 0, 0, 0, 0, 0, rover.avionicsW, 0, 0, minMargin));

  // Energy sensitivity to the soil assumption: same kinematics, alternative grade tables.
  const sens = (id: string) => {
    const tb = tableFor(spec, rover, id);
    let wh = 0;
    for (let i = 0; i < gradeLog.length; i++) {
      const w = lookupGrade(tb, gradeLog[i]);
      if (w.immobile) return 'immobile' as const;
      const v = rover.maxSpeedMs * (1 - w.slip);
      wh += (rover.wheels * Math.max(0, w.torqueNm) * (rover.maxSpeedMs / rover.wheelRadiusM) / rover.drivetrainEfficiency + rover.avionicsW) * (distLog[i] / v) / 3600;
    }
    return round(wh, 1);
  };
  const rocks = spec.rockAbundance > 0 ? rockHazard(spec.rockAbundance, rover.groundClearanceM, rover.trackWidthM, s) : null;
  const summary: SimSummary = {
    status: failure ? 'failed' : 'completed', failure,
    distanceM: round(s, 1), durationS: round(t, 0), driveTimeS: round(driveTime, 0), energyUsedWh: round(used, 1), energyGeneratedWh: round(generated, 1),
    minSocFrac: round(minSoc / capacity, 4), finalSocFrac: round(soc / capacity, 4), reserveBreached,
    maxSlip: round(maxSlip, 4), meanSlip: round(slipN ? slipSum / slipN : 0, 4), maxSinkageM: round(maxSink, 4), maxPitchDeg: round(maxPitch, 2), maxRollDeg: round(maxRoll, 2),
    minStabilityMarginDeg: round(minMargin, 2), sunlitFraction: round(totalT ? sunlitT / totalT : 0, 4), earthLinkFraction: round(totalT ? linkT / totalT : 0, 4),
    scienceStops, maxSurfaceSlopeDeg: round(maxSurfaceSlope, 2), rockEncounterProbability: rocks ? round(rocks.probability, 4) : null,
    energySensitivityWh: { loose: sens('lunar-loose'), firm: sens('lunar-firm') },
  };
  return { version: ASTRAL_SIM_VERSION, spec, routeId: route.id, rover, frames, events, summary, tiles: [...tiles].sort() };

  function frame(phase: Frame['phase'], h: number, heading: number, pitch: number, roll: number, slip: number, sink: number, v: number, load: number, gen: number, torque: number, margin: number): Frame {
    return { t: round(t, 1), s: round(s, 2), x: round(pos.x, 2), y: round(pos.y, 2), h: round(h, 2), headingDeg: round(((heading * DEG) + 360) % 360, 1), pitchDeg: round(pitch, 2), rollDeg: round(roll, 2),
      slip: round(slip, 4), sinkageM: round(sink, 4), speedMs: round(v, 4), loadW: round(load, 1), genW: round(gen, 1), socWh: round(soc, 1), sunFrac: round(sunFrac, 3), earthVisible: earthVis,
      torqueNm: round(torque, 2), stabilityMarginDeg: round(margin, 2), phase };
  }
}

export function round(v: number, d: number) { const f = 10 ** d; return Math.round(v * f) / f; }

interface Station { x: number; y: number; stop: boolean; node: number }
function stationsOf(points: MapPoint[], legs: number[], spacing: number): Station[] {
  const out: Station[] = [{ ...points[0], stop: false, node: 0 }];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(len / spacing));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n, stop: k === n && legs.includes(i + 1), node: k === n ? i + 1 : -1 });
  }
  return out;
}

/** Interpolated replay state at time t (seconds since departure). */
export function frameAt(frames: Frame[], t: number): Frame {
  if (t <= frames[0].t) return frames[0];
  if (t >= frames[frames.length - 1].t) return frames[frames.length - 1];
  let lo = 0, hi = frames.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (frames[m].t <= t) lo = m; else hi = m; }
  const a = frames[lo], b = frames[hi], f = (t - a.t) / Math.max(1e-9, b.t - a.t);
  const mix = (u: number, v: number) => u + (v - u) * f;
  let dh = b.headingDeg - a.headingDeg; if (dh > 180) dh -= 360; if (dh < -180) dh += 360;
  return { ...a, t, s: mix(a.s, b.s), x: mix(a.x, b.x), y: mix(a.y, b.y), h: mix(a.h, b.h), headingDeg: (a.headingDeg + dh * f + 360) % 360, pitchDeg: mix(a.pitchDeg, b.pitchDeg), rollDeg: mix(a.rollDeg, b.rollDeg), socWh: mix(a.socWh, b.socWh) };
}
