// Multi-objective route planning on the shared analysis height model.
// Lattice: 10 m nodes over the operational box, heights and 5 m-baseline slopes from World.heightAt
// (the same model the simulator and inspector use). A* with objective-specific edge costs and hard
// constraints; slopes, grades and energy come from the terramechanics grade table.
import type { MapPoint, SceneObject } from '../core/types';
import type { World } from '../core/world';
import { slopeAt } from '../analysis/terrain';
import { bodiesAt, sunVisibleFraction, type HorizonModel } from '../analysis/illumination';
import type { IlluminationRecord } from '../core/types';
import { lookupGrade, type GradeTable } from './terramechanics';
import type { MissionSpec, RouteObjective } from './mission';

const DEG = 180 / Math.PI;

const CELL_PROBES = [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

export interface PlanningGrid {
  west: number; north: number; spacing: number; width: number; height: number;
  h: Float32Array; slope: Float32Array; crater: Uint8Array;
}

/** Sample the analysis model on the planning lattice. Requires ensureOperational() first. */
export function buildPlanningGrid(world: World, spacing = 10, craters: SceneObject[] = world.objects.filter(o => o.type === 'crater')): PlanningGrid {
  const [w, s, e, n] = world.operationalBox;
  const width = Math.floor((e - w) / spacing) - 1, height = Math.floor((n - s) / spacing) - 1;
  const west = w + spacing, north = n - spacing;
  const h = new Float32Array(width * height), slope = new Float32Array(width * height), crater = new Uint8Array(width * height);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
    const x = west + c * spacing, y = north - r * spacing, i = r * width + c;
    h[i] = world.requireHeight(x, y);
    // Conservative cell slope: maximum of the 5 m-baseline slope at the node and the four half-cell
    // diagonal offsets, so straight segments between nodes rarely exceed the limit at 5 m.
    let m = 0;
    for (const [dx, dy] of CELL_PROBES) m = Math.max(m, slopeAt(world, x + dx * spacing / 2, y + dy * spacing / 2)?.slopeDeg ?? 90);
    slope[i] = m;
  }
  for (const o of craters) {
    if ((o.confidence ?? 0) < 0.5) continue;
    const rad = o.radius * 0.8; // interior: inside 80 % of the fitted rim radius
    const c0 = Math.floor((o.x - rad - west) / spacing), c1 = Math.ceil((o.x + rad - west) / spacing);
    const r0 = Math.floor((north - o.y - rad) / spacing), r1 = Math.ceil((north - o.y + rad) / spacing);
    for (let r = Math.max(0, r0); r <= Math.min(height - 1, r1); r++) for (let c = Math.max(0, c0); c <= Math.min(width - 1, c1); c++)
      if (Math.hypot(west + c * spacing - o.x, north - r * spacing - o.y) <= rad) crater[r * width + c] = 1;
  }
  return { west, north, spacing, width, height, h, slope, crater };
}

export interface CostModel {
  table: GradeTable; maxSpeedMs: number; wheels: number; wheelRadiusM: number; drivetrainEfficiency: number; avionicsW: number; wheelStallTorqueNm: number;
}
/** Electrical energy per metre (J/m) at an along-track grade, from the terramechanics table; Infinity if impassable. */
export function energyPerMetre(m: CostModel, gradeDeg: number) {
  const w = lookupGrade(m.table, gradeDeg);
  if (w.immobile || w.torqueNm > m.wheelStallTorqueNm) return Infinity;
  const v = m.maxSpeedMs * (1 - w.slip);
  if (v <= 1e-6) return Infinity;
  const drive = m.wheels * Math.max(0, w.torqueNm) * (m.maxSpeedMs / m.wheelRadiusM) / m.drivetrainEfficiency;
  return (drive + m.avionicsW) / v;
}

export interface Route {
  id: string; objective: RouteObjective; points: MapPoint[]; legs: number[]; lengthM: number; cost: number; expanded: number;
  feasible: boolean; reason?: string; waypointOrder: string[];
}

interface Ctx { grid: PlanningGrid; spec: MissionSpec; model: CostModel; objective: RouteObjective; sunFrac: (i: number) => number; eMin: number }

function edgeCost(ctx: Ctx, i: number, j: number, len: number): number {
  const g = ctx.grid, c = ctx.spec.constraints;
  const sj = g.slope[j];
  if (sj > c.maxSlopeDeg) return Infinity;
  const grade = Math.atan((g.h[j] - g.h[i]) / len) * DEG;
  if (Math.abs(grade) > c.maxSlopeDeg) return Infinity;
  const tanCross2 = Math.tan(sj / DEG) ** 2 - Math.tan(Math.abs(grade) / DEG) ** 2;
  const cross = tanCross2 > 0 ? Math.atan(Math.sqrt(tanCross2)) * DEG : 0;
  if (cross > c.maxCrossSlopeDeg) return Infinity;
  if (c.avoidCraterInteriors && g.crater[j] && ctx.objective !== 'shortest') return Infinity;
  const e = energyPerMetre(ctx.model, grade);
  if (!Number.isFinite(e)) return Infinity;
  switch (ctx.objective) {
    case 'shortest': return len;
    case 'energy': return len * e;
    case 'safest': return len * (1 + 4 * (sj / c.maxSlopeDeg) ** 2 + 2 * (cross / c.maxCrossSlopeDeg) ** 2 + (g.crater[j] ? 3 : 0));
    case 'illumination': return len * (1 + 6 * (1 - ctx.sunFrac(j)));
  }
}

class MinHeap {
  ids = new Int32Array(1024); pr = new Float64Array(1024); size = 0;
  push(id: number, p: number) {
    if (this.size === this.ids.length) { const a = new Int32Array(this.size * 2); a.set(this.ids); this.ids = a; const b = new Float64Array(this.size * 2); b.set(this.pr); this.pr = b; }
    let i = this.size++;
    while (i > 0) { const q = (i - 1) >> 1; if (this.pr[q] <= p) break; this.ids[i] = this.ids[q]; this.pr[i] = this.pr[q]; i = q; }
    this.ids[i] = id; this.pr[i] = p;
  }
  pop() {
    const top = this.ids[0], lastId = this.ids[--this.size], lastP = this.pr[this.size];
    let i = 0;
    while (true) {
      let c = 2 * i + 1; if (c >= this.size) break;
      if (c + 1 < this.size && this.pr[c + 1] < this.pr[c]) c++;
      if (this.pr[c] >= lastP) break;
      this.ids[i] = this.ids[c]; this.pr[i] = this.pr[c]; i = c;
    }
    this.ids[i] = lastId; this.pr[i] = lastP;
    return top;
  }
}

const NEIGHBOURS: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

function nodeOf(g: PlanningGrid, p: MapPoint) {
  const c = Math.round((p.x - g.west) / g.spacing), r = Math.round((g.north - p.y) / g.spacing);
  return c < 0 || r < 0 || c >= g.width || r >= g.height ? -1 : r * g.width + c;
}
function pointOf(g: PlanningGrid, i: number): MapPoint { return { x: g.west + (i % g.width) * g.spacing, y: g.north - Math.floor(i / g.width) * g.spacing }; }

function astar(ctx: Ctx, from: number, to: number) {
  const g = ctx.grid, n = g.width * g.height;
  const cost = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), closed = new Uint8Array(n);
  const heur = (i: number) => {
    const d = Math.hypot((i % g.width) - (to % g.width), Math.floor(i / g.width) - Math.floor(to / g.width)) * g.spacing;
    return ctx.objective === 'energy' ? d * ctx.eMin : d;
  };
  const heap = new MinHeap(); cost[from] = 0; heap.push(from, heur(from));
  let expanded = 0;
  while (heap.size) {
    const i = heap.pop();
    if (closed[i]) continue;
    closed[i] = 1; expanded++;
    if (i === to) break;
    const r = Math.floor(i / g.width), c = i % g.width;
    for (const [dc, dr, k] of NEIGHBOURS) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= g.width || rr >= g.height) continue;
      const j = rr * g.width + cc;
      if (closed[j]) continue;
      const step = edgeCost(ctx, i, j, k * g.spacing);
      if (!Number.isFinite(step)) continue;
      const v = cost[i] + step;
      if (v < cost[j]) { cost[j] = v; prev[j] = i; heap.push(j, v + heur(j)); }
    }
  }
  if (!Number.isFinite(cost[to])) return { path: null as number[] | null, cost: Infinity, expanded };
  const path: number[] = [];
  for (let i = to; i !== -1; i = prev[i]) path.push(i);
  return { path: path.reverse(), cost: cost[to], expanded };
}

/** Straight-segment cost along the lattice, used to accept shortcuts that do not increase cost. */
function segmentCost(ctx: Ctx, a: number, b: number) {
  const g = ctx.grid, pa = pointOf(g, a), pb = pointOf(g, b);
  const len = Math.hypot(pb.x - pa.x, pb.y - pa.y), count = Math.max(1, Math.ceil(len / (g.spacing / 2)));
  let total = 0, prevNode = a;
  for (let k = 1; k <= count; k++) {
    const f = k / count, node = nodeOf(g, { x: pa.x + (pb.x - pa.x) * f, y: pa.y + (pb.y - pa.y) * f });
    if (node < 0) return Infinity;
    if (node === prevNode) continue;
    const pp = pointOf(g, prevNode), pn = pointOf(g, node);
    const step = edgeCost(ctx, prevNode, node, Math.hypot(pn.x - pp.x, pn.y - pp.y));
    if (!Number.isFinite(step)) return Infinity;
    total += step; prevNode = node;
  }
  return total;
}
function smooth(ctx: Ctx, path: number[]) {
  const out = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let best = i + 1;
    for (let j = Math.min(path.length - 1, i + 60); j > i + 1; j--) {
      let sub = 0;
      for (let k = i; k < j; k++) { const a = pointOf(ctx.grid, path[k]), b = pointOf(ctx.grid, path[k + 1]); sub += edgeCost(ctx, path[k], path[k + 1], Math.hypot(b.x - a.x, b.y - a.y)); }
      if (segmentCost(ctx, path[i], path[j]) <= sub * 1.0001) { best = j; break; }
    }
    out.push(path[best]); i = best;
  }
  return out;
}

/** Order science waypoints: nearest-neighbour tour from the start, improved by 2-opt (Euclidean). */
export function orderWaypoints(start: MapPoint, end: MapPoint | null, wps: MissionSpec['waypoints']) {
  const left = [...wps], order: typeof wps = [];
  let cur = start;
  while (left.length) {
    let k = 0;
    for (let i = 1; i < left.length; i++) if (Math.hypot(left[i].x - cur.x, left[i].y - cur.y) < Math.hypot(left[k].x - cur.x, left[k].y - cur.y)) k = i;
    cur = left[k]; order.push(left.splice(k, 1)[0]);
  }
  const len = (seq: MapPoint[]) => { let s = 0; for (let i = 0; i < seq.length - 1; i++) s += Math.hypot(seq[i + 1].x - seq[i].x, seq[i + 1].y - seq[i].y); return s; };
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) for (let j = i + 1; j < order.length; j++) {
      const cand = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
      const full = (o: typeof wps) => [start, ...o, ...(end ? [end] : [])];
      if (len(full(cand)) + 1e-6 < len(full(order))) { order.splice(0, order.length, ...cand); improved = true; }
    }
  }
  return order;
}

export interface PlanInputs { grid: PlanningGrid; spec: MissionSpec; model: CostModel; horizon: HorizonModel; illumination: IlluminationRecord }

/** Plan one route per objective through the ordered waypoints. Deterministic. */
export function planRoutes(inp: PlanInputs, objectives: RouteObjective[]): Route[] {
  const { grid, spec } = inp;
  const end = spec.returnToStart ? spec.start : spec.destination;
  const order = orderWaypoints(spec.start, end, spec.waypoints);
  const stops: MapPoint[] = [spec.start, ...order, ...(end ? [end] : [])];
  // Illumination at departure on a 40 m sub-lattice, computed lazily.
  const sun = bodiesAt(inp.illumination, spec.departureT).sun;
  const sunCache = new Float32Array(grid.width * grid.height).fill(NaN);
  const sunFrac = (i: number) => {
    const c = Math.floor((i % grid.width) / 4) * 4, r = Math.floor(Math.floor(i / grid.width) / 4) * 4, k = r * grid.width + c;
    if (Number.isNaN(sunCache[k])) { const p = pointOf(grid, k); sunCache[k] = sunVisibleFraction(inp.horizon, p.x, p.y, grid.h[k] + 1, sun); }
    return sunCache[k];
  };
  let eMin = Infinity;
  for (let gdeg = -spec.constraints.maxSlopeDeg; gdeg <= spec.constraints.maxSlopeDeg; gdeg += 0.5) eMin = Math.min(eMin, energyPerMetre(inp.model, gdeg));
  return objectives.map(objective => {
    const ctx: Ctx = { grid, spec, model: inp.model, objective, sunFrac, eMin: Number.isFinite(eMin) ? eMin : 0 };
    const nodes: number[] = [], legs: number[] = [];
    let cost = 0, expanded = 0;
    for (let k = 0; k < stops.length - 1; k++) {
      const a = nodeOf(grid, stops[k]), b = nodeOf(grid, stops[k + 1]);
      if (a < 0 || b < 0) return infeasible(objective, `Stop ${k} lies outside the planning lattice`, order);
      if (grid.slope[a] > spec.constraints.maxSlopeDeg || grid.slope[b] > spec.constraints.maxSlopeDeg)
        return infeasible(objective, `A stop sits on terrain steeper than ${spec.constraints.maxSlopeDeg}°`, order);
      const res = astar(ctx, a, b);
      expanded += res.expanded;
      if (!res.path) return infeasible(objective, `No route satisfies the constraints between stops ${k} and ${k + 1}`, order);
      const sm = smooth(ctx, res.path);
      cost += res.cost;
      nodes.push(...(nodes.length ? sm.slice(1) : sm));
      legs.push(nodes.length - 1);
    }
    const points = nodes.map(i => pointOf(grid, i));
    points[0] = { ...spec.start };
    let lengthM = 0;
    for (let i = 0; i < points.length - 1; i++) lengthM += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    return { id: `route-${objective}`, objective, points, legs, lengthM, cost, expanded, feasible: true, waypointOrder: order.map(w => w.id) };
  });
}

function infeasible(objective: RouteObjective, reason: string, order: MissionSpec['waypoints']): Route {
  return { id: `route-${objective}`, objective, points: [], legs: [], lengthM: 0, cost: Infinity, expanded: 0, feasible: false, reason, waypointOrder: order.map(w => w.id) };
}
