import { cellPoint, nearestCell, sampleTerrain, slopeAt } from "./terrain.ts";
import type { MissionTerrain, Point, Scenario } from "./types.ts";
import { drivetrain, tipAngle } from "./mobility.ts";

export function traversable(
  terrain: MissionTerrain,
  a: Point,
  b: Point,
  rover: Scenario["rover"],
): boolean {
  const za = sampleTerrain(terrain, a),
    zb = sampleTerrain(terrain, b);
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  if (za === null || zb === null || !distance) return false;
  const grade = Math.abs(zb - za) / distance;
  // Check the entire interpolated segment, including transverse gradient.
  const count = Math.max(2, Math.ceil(distance / (terrain.grid.cell_m / 4)));
  for (let i = 0; i <= count; i++) {
    const slope = slopeAt(terrain, {
      x: a.x + ((b.x - a.x) * i) / count,
      y: a.y + ((b.y - a.y) * i) / count,
    });
    if (
      slope === null ||
      slope > rover.maxSlope ||
      (rover.design && slope >= tipAngle(rover.design)) ||
      Math.tan((slope * Math.PI) / 180) + rover.rollingResistance >
        rover.traction
    )
      return false;
  }
  return (Math.atan(grade) * 180) / Math.PI <= rover.maxSlope;
}
class Heap {
  items: { id: number; priority: number }[] = [];
  push(id: number, priority: number) {
    const item = { id, priority };
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.items[p].priority <= priority) break;
      this.items[i] = this.items[p];
      i = p;
    }
    this.items[i] = item;
  }
  pop() {
    const first = this.items[0],
      last = this.items.pop()!;
    if (this.items.length) {
      let i = 0;
      while (i * 2 + 1 < this.items.length) {
        let c = i * 2 + 1;
        if (
          c + 1 < this.items.length &&
          this.items[c + 1].priority < this.items[c].priority
        )
          c++;
        if (this.items[c].priority >= last.priority) break;
        this.items[i] = this.items[c];
        i = c;
      }
      this.items[i] = last;
    }
    return first.id;
  }
}
export function planRoute(
  terrain: MissionTerrain,
  scenario: Scenario,
): Point[] {
  const { start, destination, rover } = scenario;
  if (Math.hypot(start.x - destination.x, start.y - destination.y) < 0.01)
    return [start];
  if (rover.route === "direct")
    return traversable(terrain, start, destination, rover)
      ? [start, destination]
      : [];
  const first = nearestCell(terrain, start),
    last = nearestCell(terrain, destination),
    side = terrain.grid.side;
  if (first < 0 || last < 0) return [];
  const connect = (a: Point, b: Point) =>
    Math.hypot(a.x - b.x, a.y - b.y) < 0.01 ||
    traversable(terrain, a, b, rover);
  if (
    !connect(start, cellPoint(terrain, first)) ||
    !connect(cellPoint(terrain, last), destination)
  )
    return [];
  const cost = new Float64Array(side * side).fill(Infinity),
    parent = new Int32Array(side * side).fill(-1),
    closed = new Uint8Array(side * side);
  const open = new Heap();
  cost[first] = 0;
  open.push(first, 0);
  while (open.items.length) {
    const id = open.pop();
    if (closed[id]) continue;
    closed[id] = 1;
    if (id === last) {
      const path: Point[] = [destination];
      let current = last;
      while (current !== first) {
        path.push(cellPoint(terrain, current));
        current = parent[current];
      }
      path.push(cellPoint(terrain, first), start);
      return path
        .reverse()
        .filter(
          (p, i, all) =>
            !i || Math.hypot(p.x - all[i - 1].x, p.y - all[i - 1].y) > 0.01,
        );
    }
    const a = cellPoint(terrain, id),
      r = Math.floor(id / side),
      c = id % side;
    for (const [dr, dc] of [
      [-1, -1],
      [-1, 0],
      [-1, 1],
      [0, -1],
      [0, 1],
      [1, -1],
      [1, 0],
      [1, 1],
    ]) {
      const nr = r + dr,
        nc = c + dc;
      if (nr < 1 || nc < 1 || nr >= side - 1 || nc >= side - 1) continue;
      const next = nr * side + nc;
      if (closed[next]) continue;
      const b = cellPoint(terrain, next);
      if (!traversable(terrain, a, b, rover)) continue;
      const dz = sampleTerrain(terrain, b)! - sampleTerrain(terrain, a)!;
      const length = Math.hypot(a.x - b.x, a.y - b.y, dz);
      const drive = rover.design ? drivetrain(scenario, Math.atan2(dz, Math.hypot(a.x-b.x, a.y-b.y)), 0) : null;
      if (drive && !drive.admissible) continue;
      const edge = rover.route === "astar-energy" && drive
        ? drive.electricalPowerW * length / drive.speed / 3600 : length;
      const candidate = cost[id] + edge;
      if (candidate < cost[next]) {
        cost[next] = candidate;
        parent[next] = id;
        open.push(
          next,
          candidate + (rover.route === "astar-energy" ? 0 : Math.hypot(b.x - destination.x, b.y - destination.y)),
        );
      }
    }
  }
  return [];
}
