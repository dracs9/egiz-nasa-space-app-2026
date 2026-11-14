// EGIZ ASTRAL · mission specification, validation and deterministic rover mission simulation.
// The simulator reads the same site field, obstacles, surface assignment and SPICE record as the 3D view.
import { gradient, inShadow, inside, sample, type Field, type XY } from "../world/field.ts";
import { solarAt } from "../../mission/solar.ts";
import type { SpiceGeometry } from "../../mission/types.ts";
import { axleOffsets, drive, ROVERS, SOILS, type RoverProfile } from "./terramechanics.ts";
import { buildNavGrid, planRoute, type NavGrid, type Objective, type Obstacle, type Route, type RouteFailure } from "./traverse.ts";

export type Fidelity = "fast" | "detailed";
export interface Waypoint extends XY { id: string; label: string; activity: "imaging" | "sampling" | "observation" }
export interface MissionSpec {
  version: "1.0.0"; siteId: string; roverId: string;
  /** a soil id, or "classified" to use the terrain-unit surface assignment */ surface: string;
  start: XY; destination: XY; waypoints: Waypoint[];
  objective: Objective; maxSlopeDeg: number; reserveFraction: number;
  /** seconds after the SPICE record epoch */ startTimeS: number; requireDaylight: boolean; fidelity: Fidelity;
}
export interface SimWorld {
  siteId: string; gravity: number; field: Field; obstacles: Obstacle[]; solar: SpiceGeometry | null;
  /** surface profile per location when spec.surface === "classified" */ soilAt?(p: XY): string;
  /** atmosphere-free bodies have full direct flux; otherwise a declared transmission applies to solar arrays */
}
export const OBJECTIVES: Objective[] = ["safest", "energy", "shortest"];

export function validateSpec(spec: MissionSpec, world: SimWorld, rovers: Record<string, RoverProfile> = ROVERS): string[] {
  const errors: string[] = [], f = world.field;
  if (spec.version !== "1.0.0") errors.push("Unsupported mission specification version.");
  if (spec.siteId !== world.siteId) errors.push("Mission specification belongs to another site.");
  if (!rovers[spec.roverId]) errors.push(`Unknown rover profile: ${spec.roverId}.`);
  if (spec.surface !== "classified" && !SOILS[spec.surface]) errors.push(`Unknown surface profile: ${spec.surface}.`);
  if (spec.surface === "classified" && !world.soilAt) errors.push("Classified surface requires a terrain-unit analysis; run scene analysis first or choose a uniform surface.");
  for (const [name, p] of [["Start", spec.start], ["Destination", spec.destination], ...spec.waypoints.map(w => [w.label, w] as [string, XY])] as [string, XY][]) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) errors.push(`${name} has invalid coordinates.`);
    else if (!inside(f, p) || sample(f, p) === null) errors.push(`${name} is outside measured terrain.`);
  }
  if (!OBJECTIVES.includes(spec.objective)) errors.push("Unknown routing objective.");
  if (!(spec.maxSlopeDeg > 0 && spec.maxSlopeDeg <= 45)) errors.push("Slope limit must be between 0 and 45 degrees.");
  if (!(spec.reserveFraction >= 0 && spec.reserveFraction < 1)) errors.push("Energy reserve must be between 0 and 100%.");
  if (!(spec.startTimeS >= 0) || (world.solar && spec.startTimeS > world.solar.duration)) errors.push("Start time is outside the SPICE geometry record.");
  if (!["fast", "detailed"].includes(spec.fidelity)) errors.push("Unknown simulation fidelity.");
  if (new Set(spec.waypoints.map(w => w.id)).size !== spec.waypoints.length) errors.push("Waypoint identifiers must be unique.");
  return errors;
}

export interface Telemetry extends XY {
  t: number; z: number; distance: number; headingDeg: number; pitchDeg: number; rollDeg: number; speed: number;
  slip: number; sinkageM: number; drivePowerW: number; loadPowerW: number; generationW: number; batteryWh: number;
  sunElevationDeg: number | null; shadowed: boolean | null; phase: "drive" | "science" | "hold"; soil: string;
  /** vertical offset of each wheel contact from the body plane, metres (FL, FR, ML, MR, RL, RR) */ wheelDz: number[];
}
export interface MissionEvent { t: number; type: string; detail: string; x: number; y: number }
export interface MissionResult {
  schema: "egiz.astral_mission"; version: "1.0.0"; spec: MissionSpec; rover: RoverProfile;
  alternatives: (Route | RouteFailure)[]; route: Route | null;
  frames: Telemetry[]; events: MissionEvent[];
  outcome: "completed" | "no-route" | "immobilized" | "reserve-violated" | "ephemeris-ended" | "daylight-ended" | "invalid";
  explanation: string;
  metrics: { distanceM: number; durationS: number; driveTimeS: number; energyUsedWh: number; energyGeneratedWh: number; minBatteryWh: number; finalBatteryWh: number; maxSlip: number; meanSlip: number; maxSinkageM: number; maxTiltDeg: number; shadowTimeS: number; scienceStops: number };
  model: { fidelity: Fidelity; stepM: number; terrainPostingM: number; terramechanics: string; assumptions: string[] };
}

const WHEEL_ORDER = (r: RoverProfile) => axleOffsets(r).flatMap(x => [{ x, y: r.track / 2 }, { x, y: -r.track / 2 }]);
/** Body attitude from the measured surface: fast = gradient at the body centre; detailed = plane through six wheel contacts. */
export function pose(f: Field, rover: RoverProfile, p: XY, heading: number, fidelity: Fidelity) {
  const fx = Math.sin(heading), fy = Math.cos(heading), lx = -fy, ly = fx; // forward and left unit vectors (east, north)
  const contacts = WHEEL_ORDER(rover).map(w => sample(f, { x: p.x + fx * w.x + lx * w.y, y: p.y + fy * w.x + ly * w.y }));
  const z0 = sample(f, p);
  if (z0 === null) return null;
  let pitch: number, roll: number;
  if (fidelity === "detailed" && contacts.every(c => c !== null)) {
    const z = contacts as number[], wheels = WHEEL_ORDER(rover);
    const sxx = wheels.reduce((s, w) => s + w.x * w.x, 0), syy = wheels.reduce((s, w) => s + w.y * w.y, 0), mean = z.reduce((a, b) => a + b, 0) / z.length;
    pitch = Math.atan(wheels.reduce((s, w, i) => s + w.x * (z[i] - mean), 0) / sxx);
    roll = Math.atan(wheels.reduce((s, w, i) => s + w.y * (z[i] - mean), 0) / syy);
  } else {
    const g = gradient(f, p, Math.max(f.posting, rover.wheelbase / 2));
    if (!g) return null;
    pitch = Math.atan(g.gx * fx + g.gy * fy); roll = Math.atan(g.gx * lx + g.gy * ly);
  }
  const wheels = WHEEL_ORDER(rover);
  const wheelDz = contacts.map((c, i) => (c === null ? 0 : c - (z0 + Math.tan(pitch) * wheels[i].x + Math.tan(roll) * wheels[i].y)));
  return { z: z0, pitch, roll, wheelDz };
}

/** Plan all objectives, then execute the chosen route. Same inputs always produce the same record. */
export function simulateMission(spec: MissionSpec, world: SimWorld, rovers: Record<string, RoverProfile> = ROVERS, sharedGrid?: NavGrid): MissionResult {
  const rover = rovers[spec.roverId] ?? ROVERS["m2020-class"], f = world.field;
  const stepM = spec.fidelity === "detailed" ? 0.25 : 1;
  const base: MissionResult = {
    schema: "egiz.astral_mission", version: "1.0.0", spec, rover, alternatives: [], route: null, frames: [], events: [], outcome: "invalid", explanation: "",
    metrics: { distanceM: 0, durationS: 0, driveTimeS: 0, energyUsedWh: 0, energyGeneratedWh: 0, minBatteryWh: rover.batteryWh, finalBatteryWh: rover.batteryWh, maxSlip: 0, meanSlip: 0, maxSinkageM: 0, maxTiltDeg: 0, shadowTimeS: 0, scienceStops: 0 },
    model: { fidelity: spec.fidelity, stepM, terrainPostingM: f.posting,
      terramechanics: "Bekker pressure–sinkage with Janosi–Hanamoto shear, quasi-static, six independent wheels with static load transfer",
      assumptions: [
        `Terrain: ${f.posting} m measured posts, bilinear between posts; relief below this scale is absent from the vehicle model.`,
        spec.fidelity === "detailed" ? "Attitude from a least-squares plane through six wheel contacts, 0.25 m steps." : "Attitude from the surface gradient at the body centre, 1 m steps.",
        "No dynamics: no inertia, suspension compliance, slip-sinkage, steering scrub or wheel wear.",
        "Soil parameters are declared profiles, not site measurements.",
        rover.generation.kind === "rtg" ? "Constant RTG electrical output; no thermal or degradation model." : "Solar array normal follows the rover body; direct beam only, declared atmospheric transmission, terrain shadow from the site field only.",
        "Battery is an ideal energy store without temperature, rate or ageing effects.",
      ] },
  };
  const errors = validateSpec(spec, world, rovers);
  if (errors.length) return { ...base, explanation: errors.join(" ") };
  const soilAt = spec.surface === "classified" ? world.soilAt : undefined;
  const grid = sharedGrid ?? buildNavGrid(f, rover, { maxSlopeDeg: spec.maxSlopeDeg, gravity: world.gravity, soilId: spec.surface === "classified" ? "dry-sand" : spec.surface, soilAt, obstacles: world.obstacles });
  const stops = [spec.start, ...spec.waypoints, spec.destination];
  base.alternatives = OBJECTIVES.map(o => planRoute(grid, f, stops, o));
  const chosen = base.alternatives.find(r => r.objective === spec.objective)!;
  if (!chosen.points) return { ...base, outcome: "no-route", explanation: chosen.reason };
  base.route = chosen;

  const line = chosen.points, frames = base.frames, events = base.events, m = base.metrics;
  const reserveWh = rover.batteryWh * spec.reserveFraction;
  let t = spec.startTimeS, battery = rover.batteryWh, distance = 0, slipLength = 0, lastShadow: boolean | null = null, heading = 0, lastFrameT = -Infinity;
  const event = (type: string, detail: string, p: XY) => events.push({ t: t - spec.startTimeS, type, detail, x: p.x, y: p.y });
  const sunAt = (time: number) => (world.solar && time <= world.solar.duration ? solarAt(world.solar, time) : null);
  const generation = (p: XY, pitch: number, roll: number, hd: number) => {
    const sun = sunAt(t), shadowed = sun ? inShadow(f, p, sun.sunEnu, 1) : null;
    if (rover.generation.kind === "rtg") return { w: rover.generation.powerW, sun, shadowed };
    if (!sun || shadowed) return { w: 0, sun, shadowed };
    // Body-up unit vector in ENU from heading, pitch and roll (small-angle composition).
    const fx = Math.sin(hd), fy = Math.cos(hd), up = [-Math.tan(pitch) * fx + Math.tan(roll) * fy, -Math.tan(pitch) * fy - Math.tan(roll) * fx, 1];
    const norm = Math.hypot(...up), cos = Math.max(0, (up[0] * sun.sunEnu[0] + up[1] * sun.sunEnu[1] + up[2] * sun.sunEnu[2]) / norm);
    return { w: sun.solarFluxWm2 * rover.generation.transmission * rover.generation.areaM2 * rover.generation.efficiency * cos, sun, shadowed };
  };
  const record = (p: XY, ps: NonNullable<ReturnType<typeof pose>>, phase: Telemetry["phase"], speed: number, slip: number, sink: number, driveW: number, loadW: number, gen: ReturnType<typeof generation>, soil: string, force = false) => {
    if (!force && t - lastFrameT < 20) return;
    lastFrameT = t;
    frames.push({ x: p.x, y: p.y, z: ps.z, t: t - spec.startTimeS, distance, headingDeg: ((heading * 180) / Math.PI + 360) % 360, pitchDeg: (ps.pitch * 180) / Math.PI, rollDeg: (ps.roll * 180) / Math.PI,
      speed, slip, sinkageM: sink, drivePowerW: driveW, loadPowerW: loadW, generationW: gen.w, batteryWh: battery, sunElevationDeg: gen.sun?.elevationDeg ?? null, shadowed: gen.shadowed, phase, soil, wheelDz: ps.wheelDz });
  };
  const spend = (loadW: number, genW: number, dt: number) => {
    battery = Math.min(rover.batteryWh, battery + ((genW - loadW) * dt) / 3600);
    m.energyUsedWh += (loadW * dt) / 3600; m.energyGeneratedWh += (genW * dt) / 3600; m.minBatteryWh = Math.min(m.minBatteryWh, battery);
  };
  const finish = (outcome: MissionResult["outcome"], explanation: string): MissionResult => {
    m.durationS = t - spec.startTimeS; m.finalBatteryWh = battery; m.distanceM = distance; m.meanSlip = distance > 0 ? slipLength / distance : 0;
    return { ...base, outcome, explanation };
  };
  const pending = [...spec.waypoints];
  event("start", `${rover.name} departs with ${battery.toFixed(0)} Wh; reserve ${reserveWh.toFixed(0)} Wh.`, line[0]);
  if (!world.solar) event("data-gap", "No SPICE geometry record for this site: illumination, shadow and solar generation are unavailable.", line[0]);

  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], length = Math.hypot(b.x - a.x, b.y - a.y), count = Math.max(1, Math.round(length / stepM));
    heading = Math.atan2(b.x - a.x, b.y - a.y);
    for (let k = 1; k <= count; k++) {
      const p = { x: a.x + ((b.x - a.x) * k) / count, y: a.y + ((b.y - a.y) * k) / count }, ds = length / count;
      const ps = pose(f, rover, p, heading, spec.fidelity);
      if (!ps) return finish("immobilized", "The route left measured terrain; simulation stopped rather than extrapolate.");
      const soilId = soilAt ? soilAt(p) : spec.surface, d = drive(rover, SOILS[soilId], world.gravity, ps.pitch, ps.roll);
      const gen = generation(p, ps.pitch, ps.roll, heading);
      if (world.solar && !gen.sun) return finish("ephemeris-ended", "Mission time ran past the recorded SPICE geometry; no illumination is assumed beyond it.");
      if (!d.admissible) {
        event("immobilized", `${d.reason} on ${SOILS[soilId].name} at pitch ${((ps.pitch * 180) / Math.PI).toFixed(1)}°, roll ${((ps.roll * 180) / Math.PI).toFixed(1)}°.`, p);
        record(p, ps, "hold", 0, d.maxSlip, d.maxSinkage, 0, rover.idlePowerW, gen, soilId, true);
        return finish("immobilized", `The planner's cell-scale screen passed this route, but the ${spec.fidelity} contact model stops here: ${d.reason}.`);
      }
      const dt = ds / Math.cos(ps.pitch) / d.speed, loadW = d.electricalW + rover.idlePowerW;
      t += dt; distance += ds / Math.cos(ps.pitch); slipLength += d.meanSlip * (ds / Math.cos(ps.pitch)); m.driveTimeS += dt;
      spend(loadW, gen.w, dt);
      m.maxSlip = Math.max(m.maxSlip, d.maxSlip); m.maxSinkageM = Math.max(m.maxSinkageM, d.maxSinkage);
      m.maxTiltDeg = Math.max(m.maxTiltDeg, (Math.acos(Math.cos(ps.pitch) * Math.cos(ps.roll)) * 180) / Math.PI);
      if (gen.shadowed) m.shadowTimeS += dt;
      if (gen.shadowed !== null && gen.shadowed !== lastShadow) { if (lastShadow !== null || gen.shadowed) event(gen.shadowed ? "shadow-entry" : "shadow-exit", gen.sun!.elevationDeg <= 0 ? "Sun below the geometric horizon." : `Terrain ${gen.shadowed ? "blocks" : "clears"} the Sun (elevation ${gen.sun!.elevationDeg.toFixed(1)}°).`, p); lastShadow = gen.shadowed; }
      if (d.maxSlip > 0.6 && (events.at(-1)?.type !== "high-slip" || t - spec.startTimeS - events.at(-1)!.t > 600)) event("high-slip", `Wheel slip ${(d.maxSlip * 100).toFixed(0)}% on ${SOILS[soilId].name}.`, p);
      record(p, ps, "drive", d.speed, d.meanSlip, d.maxSinkage, d.electricalW, loadW, gen, soilId);
      if (spec.requireDaylight && gen.sun && gen.sun.elevationDeg <= 0) { record(p, ps, "hold", 0, 0, 0, 0, rover.idlePowerW, gen, soilId, true); event("darkness", "Daylight-only constraint: the Sun set during the traverse.", p); return finish("daylight-ended", "The traverse did not finish before sunset under the daylight-only constraint."); }
      if (battery < reserveWh) { record(p, ps, "hold", 0, 0, 0, 0, rover.idlePowerW, gen, soilId, true); event("reserve", `Battery ${battery.toFixed(0)} Wh fell below the ${reserveWh.toFixed(0)} Wh reserve.`, p); return finish("reserve-violated", `Energy reserve violated after ${distance.toFixed(0)} m.`); }
    }
    const stop = pending[0];
    if (stop && Math.hypot(stop.x - b.x, stop.y - b.y) <= f.posting) {
      pending.shift();
      const ps = pose(f, rover, b, heading, spec.fidelity)!;
      event("science", `${stop.label}: ${stop.activity} for ${(rover.scienceStopS / 60).toFixed(0)} min at ${rover.sciencePowerW} W (declared activity load).`, b);
      for (let s = 0; s < rover.scienceStopS; s += 60) {
        const gen = generation(b, ps.pitch, ps.roll, heading), dt = Math.min(60, rover.scienceStopS - s);
        if (world.solar && !gen.sun) return finish("ephemeris-ended", "Mission time ran past the recorded SPICE geometry during a science stop.");
        t += dt; spend(rover.sciencePowerW + rover.idlePowerW, gen.w, dt);
        if (gen.shadowed) m.shadowTimeS += dt;
        record(b, ps, "science", 0, 0, 0, 0, rover.sciencePowerW + rover.idlePowerW, gen, soilAt ? soilAt(b) : spec.surface, s === 0);
        if (battery < reserveWh) { event("reserve", `Battery fell below reserve during ${stop.label}.`, b); return finish("reserve-violated", `Energy reserve violated during the science stop at ${stop.label}.`); }
      }
      m.scienceStops++;
    }
  }
  const end = line[line.length - 1], ps = pose(f, rover, end, heading, spec.fidelity)!;
  record(end, ps, "hold", 0, 0, 0, 0, rover.idlePowerW, generation(end, ps.pitch, ps.roll, heading), soilAt ? soilAt(end) : spec.surface, true);
  event("complete", `Arrived with ${battery.toFixed(0)} Wh after ${distance.toFixed(0)} m.`, end);
  return finish("completed", `Route completed within the slope, traction, torque and energy-reserve screens of the ${spec.fidelity} model.`);
}

/** Linear interpolation of the telemetry record for replay. */
export function telemetryAt(result: MissionResult, t: number): Telemetry | null {
  const fr = result.frames;
  if (!fr.length) return null;
  if (t <= fr[0].t) return fr[0];
  if (t >= fr[fr.length - 1].t) return fr[fr.length - 1];
  let lo = 0, hi = fr.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (fr[mid].t <= t) lo = mid; else hi = mid; }
  const a = fr[lo], b = fr[hi], k = (t - a.t) / (b.t - a.t), mix = (u: number, v: number) => u + (v - u) * k;
  const turn = ((b.headingDeg - a.headingDeg + 540) % 360) - 180;
  return { ...a, t, x: mix(a.x, b.x), y: mix(a.y, b.y), z: mix(a.z, b.z), distance: mix(a.distance, b.distance), headingDeg: (a.headingDeg + turn * k + 360) % 360,
    pitchDeg: mix(a.pitchDeg, b.pitchDeg), rollDeg: mix(a.rollDeg, b.rollDeg), batteryWh: mix(a.batteryWh, b.batteryWh), wheelDz: a.wheelDz.map((v, i) => mix(v, b.wheelDz[i])) };
}
