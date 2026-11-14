// EGIZ ASTRAL · traversability and multi-objective route planning on the shared site field.
import { roughness, sample, slopeDeg, type Field, type XY } from "../world/field.ts";
import { drive, SOILS, type RoverProfile, type Soil } from "./terramechanics.ts";

export interface Obstacle extends XY { id: string; radius: number; height: number | null }
export type Objective = "shortest" | "safest" | "energy";
export const BLOCK = { none: 0, slope: 1, obstacle: 2, nodata: 3, rough: 4, traction: 5 } as const;
export const BLOCK_LABEL = ["traversable", "slope limit", "obstacle keep-out", "no elevation data", "roughness limit", "traction / torque limit"];

export interface NavGrid {
  side: number; posting: number; west: number; north: number;
  slope: Float32Array; rough: Float32Array; blocked: Uint8Array; soil: Uint8Array; soils: Soil[];
  maxSlopeDeg: number; rover: RoverProfile; gravity: number;
  /** per soil, per 1° grade bin −40…40: electrical drive W, mean slip, ground speed (0 = inadmissible) */
  lut: { power: Float32Array; slip: Float32Array; speed: Float32Array }[];
}
export interface NavOptions { maxSlopeDeg: number; gravity: number; soilId: string; soilAt?(p: XY): string; obstacles?: Obstacle[]; clearanceMargin?: number }

const GRADES = 81;
export function buildNavGrid(f: Field, rover: RoverProfile, o: NavOptions): NavGrid {
  const n = f.side * f.side, slope = new Float32Array(n), rough = new Float32Array(n), blocked = new Uint8Array(n), soil = new Uint8Array(n);
  const ids = [o.soilId], soils = [SOILS[o.soilId]];
  if (!soils[0]) throw new Error(`Unknown surface profile: ${o.soilId}`);
  const limit = Math.min(o.maxSlopeDeg, rover.maxTiltDeg);
  for (let r = 0; r < f.side; r++) for (let c = 0; c < f.side; c++) {
    const i = r * f.side + c, p = { x: f.west + c * f.posting, y: f.north - r * f.posting };
    const s = slopeDeg(f, p), q = roughness(f, p, 2);
    if (s === null || q === null) { blocked[i] = BLOCK.nodata; slope[i] = NaN; rough[i] = NaN; continue; }
    slope[i] = s; rough[i] = q;
    if (o.soilAt) { const id = o.soilAt(p); let k = ids.indexOf(id); if (k < 0) { if (!SOILS[id]) throw new Error(`Unknown surface profile: ${id}`); k = ids.push(id) - 1; soils.push(SOILS[id]); } soil[i] = k; }
    if (s > limit) blocked[i] = BLOCK.slope;
    else if (q > rover.maxObstacle) blocked[i] = BLOCK.rough;
  }
  const keepOut = rover.track / 2 + (o.clearanceMargin ?? 0.5);
  for (const rock of o.obstacles ?? []) {
    // Rocks without a height estimate are treated as hazards when wider than twice the climbable step.
    if (rock.height !== null ? rock.height < rover.maxObstacle : rock.radius * 2 < rover.maxObstacle * 2) continue;
    const reach = rock.radius + keepOut, k = Math.ceil(reach / f.posting);
    const c0 = Math.round((rock.x - f.west) / f.posting), r0 = Math.round((f.north - rock.y) / f.posting);
    for (let r = Math.max(0, r0 - k); r <= Math.min(f.side - 1, r0 + k); r++) for (let c = Math.max(0, c0 - k); c <= Math.min(f.side - 1, c0 + k); c++)
      if (Math.hypot(f.west + c * f.posting - rock.x, f.north - r * f.posting - rock.y) <= reach && !blocked[r * f.side + c]) blocked[r * f.side + c] = BLOCK.obstacle;
  }
  const lut = soils.map(s => {
    const power = new Float32Array(GRADES), slip = new Float32Array(GRADES), speed = new Float32Array(GRADES);
    for (let g = 0; g < GRADES; g++) { const d = drive(rover, s, o.gravity, ((g - 40) * Math.PI) / 180, 0); power[g] = d.electricalW; slip[g] = d.meanSlip; speed[g] = d.speed; }
    return { power, slip, speed };
  });
  return { side: f.side, posting: f.posting, west: f.west, north: f.north, slope, rough, blocked, soil, soils, maxSlopeDeg: limit, rover, gravity: o.gravity, lut };
}
export const cellOf = (g: NavGrid, p: XY) => {
  const c = Math.round((p.x - g.west) / g.posting), r = Math.round((g.north - p.y) / g.posting);
  return c >= 0 && r >= 0 && c < g.side && r < g.side ? r * g.side + c : -1;
};
export const pointOf = (g: NavGrid, i: number): XY => ({ x: g.west + (i % g.side) * g.posting, y: g.north - Math.floor(i / g.side) * g.posting });

export interface RouteMetrics { lengthM: number; driveTimeS: number; driveEnergyWh: number; maxSlopeDeg: number; meanSlopeDeg: number; meanSlip: number; maxSlip: number; riskExposure: number; ascentM: number }
export interface Route { objective: Objective; points: XY[]; metrics: RouteMetrics; why: string }
export interface RouteFailure { objective: Objective; points: null; reason: string }

class Heap {
  private ids: number[] = []; private keys: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, key: number) { let i = this.ids.length; this.ids.push(id); this.keys.push(key); while (i > 0) { const p = (i - 1) >> 1; if (this.keys[p] <= key) break; this.ids[i] = this.ids[p]; this.keys[i] = this.keys[p]; i = p; } this.ids[i] = id; this.keys[i] = key; }
  pop() { const top = this.ids[0], id = this.ids.pop()!, key = this.keys.pop()!; const n = this.ids.length; if (n) { let i = 0; for (;;) { let c = i * 2 + 1; if (c >= n) break; if (c + 1 < n && this.keys[c + 1] < this.keys[c]) c++; if (this.keys[c] >= key) break; this.ids[i] = this.ids[c]; this.keys[i] = this.keys[c]; i = c; } this.ids[i] = id; this.keys[i] = key; } return top; }
}
const NEIGHBOURS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

/** Per-edge physical quantities from the drive look-up; null when the vehicle cannot make the move. */
function edge(g: NavGrid, f: Field, a: number, b: number) {
  const za = f.z[a], zb = f.z[b], dc = (b % g.side) - (a % g.side), dr = Math.floor(b / g.side) - Math.floor(a / g.side);
  const plan = Math.hypot(dc, dr) * g.posting, length = Math.hypot(plan, zb - za), gradeDeg = (Math.atan2(zb - za, plan) * 180) / Math.PI;
  const bin = Math.max(0, Math.min(GRADES - 1, Math.round(gradeDeg) + 40)), lut = g.lut[g.soil[b]];
  if (lut.speed[bin] <= 0) return null;
  const time = length / lut.speed[bin], energyWh = ((lut.power[bin] + g.rover.idlePowerW) * time) / 3600;
  const risk = length * (0.5 * (g.slope[b] / g.maxSlopeDeg) ** 2 + 2 * lut.slip[bin] ** 2 + g.rough[b] / g.rover.maxObstacle);
  return { length, time, energyWh, slip: lut.slip[bin], risk, climb: Math.max(0, zb - za) };
}
const WHY: Record<Objective, string> = {
  shortest: "Minimises surface distance among admissible cells.",
  safest: "Minimises distance weighted by slope margin, predicted slip and roughness exposure.",
  energy: "Minimises predicted electrical energy (drive plus idle load over drive time).",
};
/** A* between two points for one objective. Deterministic; ties resolve by insertion order. */
export function planLeg(g: NavGrid, f: Field, from: XY, to: XY, objective: Objective): Route | RouteFailure {
  const start = cellOf(g, from), goal = cellOf(g, to);
  const fail = (reason: string): RouteFailure => ({ objective, points: null, reason });
  if (start < 0 || goal < 0) return fail("Start or destination is outside the measured site.");
  if (g.blocked[start]) return fail(`Start is not traversable: ${BLOCK_LABEL[g.blocked[start]]}.`);
  if (g.blocked[goal]) return fail(`Destination is not traversable: ${BLOCK_LABEL[g.blocked[goal]]}.`);
  let minEnergyPerM = Infinity;
  for (const l of g.lut) for (let i = 0; i < GRADES; i++) if (l.speed[i] > 0) minEnergyPerM = Math.min(minEnergyPerM, (l.power[i] + g.rover.idlePowerW) / l.speed[i] / 3600);
  const perMetre = objective === "energy" ? minEnergyPerM * Math.cos((40 * Math.PI) / 180) : 1;
  const cost = new Float64Array(g.side * g.side).fill(Infinity), parent = new Int32Array(g.side * g.side).fill(-1), closed = new Uint8Array(g.side * g.side);
  const gc = goal % g.side, gr = Math.floor(goal / g.side), open = new Heap();
  cost[start] = 0; open.push(start, 0);
  while (open.size) {
    const id = open.pop();
    if (closed[id]) continue;
    closed[id] = 1;
    if (id === goal) break;
    const r = Math.floor(id / g.side), c = id % g.side;
    for (const [dr, dc] of NEIGHBOURS) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= g.side || nc >= g.side) continue;
      const next = nr * g.side + nc;
      if (closed[next] || g.blocked[next]) continue;
      if (dr && dc && (g.blocked[r * g.side + nc] || g.blocked[nr * g.side + c])) continue; // no corner cutting past keep-outs
      const e = edge(g, f, id, next);
      if (!e) continue;
      const step = objective === "shortest" ? e.length : objective === "energy" ? e.energyWh : e.length + 6 * e.risk;
      if (cost[id] + step < cost[next]) { cost[next] = cost[id] + step; parent[next] = id; open.push(next, cost[next] + perMetre * Math.hypot(nc - gc, nr - gr) * g.posting); }
    }
  }
  if (!closed[goal]) return fail("No admissible path: slope, obstacle, roughness or traction limits separate the two points.");
  const cells = [goal];
  while (cells[cells.length - 1] !== start) cells.push(parent[cells[cells.length - 1]]);
  cells.reverse();
  return { objective, points: cells.map(i => pointOf(g, i)), metrics: measure(g, f, cells), why: WHY[objective] };
}
export function measure(g: NavGrid, f: Field, cells: number[]): RouteMetrics {
  const m: RouteMetrics = { lengthM: 0, driveTimeS: 0, driveEnergyWh: 0, maxSlopeDeg: 0, meanSlopeDeg: 0, meanSlip: 0, maxSlip: 0, riskExposure: 0, ascentM: 0 };
  for (let i = 1; i < cells.length; i++) {
    const e = edge(g, f, cells[i - 1], cells[i]);
    if (!e) continue;
    m.lengthM += e.length; m.driveTimeS += e.time; m.driveEnergyWh += e.energyWh; m.riskExposure += e.risk; m.ascentM += e.climb;
    m.meanSlip += e.slip * e.length; m.maxSlip = Math.max(m.maxSlip, e.slip);
    m.meanSlopeDeg += g.slope[cells[i]] * e.length; m.maxSlopeDeg = Math.max(m.maxSlopeDeg, g.slope[cells[i]]);
  }
  if (m.lengthM > 0) { m.meanSlip /= m.lengthM; m.meanSlopeDeg /= m.lengthM; }
  return m;
}
/** Plan through ordered stops; fails as a whole when any leg fails. */
export function planRoute(g: NavGrid, f: Field, stops: XY[], objective: Objective): Route | RouteFailure {
  const points: XY[] = [], total: RouteMetrics = { lengthM: 0, driveTimeS: 0, driveEnergyWh: 0, maxSlopeDeg: 0, meanSlopeDeg: 0, meanSlip: 0, maxSlip: 0, riskExposure: 0, ascentM: 0 };
  for (let i = 1; i < stops.length; i++) {
    const leg = planLeg(g, f, stops[i - 1], stops[i], objective);
    if (!leg.points) return { ...leg, reason: `Leg ${i} of ${stops.length - 1}: ${leg.reason}` };
    points.push(...(i > 1 ? leg.points.slice(1) : leg.points));
    const a = leg.metrics, w = a.lengthM;
    total.meanSlip += a.meanSlip * w; total.meanSlopeDeg += a.meanSlopeDeg * w;
    total.lengthM += a.lengthM; total.driveTimeS += a.driveTimeS; total.driveEnergyWh += a.driveEnergyWh; total.riskExposure += a.riskExposure; total.ascentM += a.ascentM;
    total.maxSlopeDeg = Math.max(total.maxSlopeDeg, a.maxSlopeDeg); total.maxSlip = Math.max(total.maxSlip, a.maxSlip);
  }
  if (total.lengthM > 0) { total.meanSlip /= total.lengthM; total.meanSlopeDeg /= total.lengthM; }
  return { objective, points, metrics: total, why: WHY[objective] };
}
/** Fraction of valid cells the configured vehicle may enter, and the breakdown of what blocks the rest. */
export function traversabilitySummary(g: NavGrid) {
  const counts = new Array(BLOCK_LABEL.length).fill(0);
  for (const b of g.blocked) counts[b]++;
  const valid = g.blocked.length - counts[BLOCK.nodata];
  return { traversableFraction: counts[0] / Math.max(1, valid), blockedBy: Object.fromEntries(BLOCK_LABEL.map((label, i) => [label, counts[i] / Math.max(1, valid)]).slice(1)) };
}
export const heightAt = (f: Field, p: XY) => sample(f, p);
