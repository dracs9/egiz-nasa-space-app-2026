import type { MissionTerrain, Point, TerrainBundle } from "./types.ts";

export function validateTerrain(
  value: unknown,
  inputs: Record<string, string>,
): TerrainBundle {
  const data = value as TerrainBundle;
  const fail = () => {
    throw new Error(
      "Mission terrain is missing, invalid, or stale. Rebuild the measured terrain bundle.",
    );
  };
  if (
    !data ||
    data.schema !== "egiz.mission_terrain" ||
    data.version !== "1.0.0" ||
    data.synthetic !== false ||
    !Array.isArray(data.entries) ||
    !data.entries.length
  )
    fail();
  for (const key of ["earth_candidates_sha256", "targets_sha256"])
    if (
      !data.inputs ||
      !/^[a-f0-9]{64}$/.test(data.inputs[key] ?? "") ||
      data.inputs[key] !== inputs[key]
    )
      fail();
  const ids = new Set<string>();
  for (const e of data.entries) {
    const g = e?.grid;
    if (
      !e ||
      typeof e.id !== "string" ||
      ids.has(e.id) ||
      typeof e.name !== "string" ||
      !["earth", "moon", "mars"].includes(e.body) ||
      !Number.isFinite(e.lon) ||
      !Number.isFinite(e.lat) ||
      !e.source ||
      !/^[a-f0-9]{64}$/.test(e.source.sha256) ||
      !/^https:\/\//.test(e.source.url) ||
      typeof e.local_crs !== "string" ||
      !g ||
      !Number.isInteger(g.side) ||
      g.side < 3 ||
      g.side > 200 ||
      !Number.isFinite(g.cell_m) ||
      g.cell_m <= 0 ||
      !Number.isFinite(g.west_m) ||
      !Number.isFinite(g.north_m) ||
      !Array.isArray(g.elevation_m) ||
      g.elevation_m.length !== g.side ** 2 ||
      g.elevation_m.some(
        (n) => n !== null && (typeof n !== "number" || !Number.isFinite(n)),
      )
    )
      fail();
    ids.add(e.id);
  }
  return data;
}
export function cellPoint(terrain: MissionTerrain, index: number): Point {
  const g = terrain.grid;
  return {
    x: g.west_m + (index % g.side) * g.cell_m,
    y: g.north_m - Math.floor(index / g.side) * g.cell_m,
  };
}
export function nearestCell(terrain: MissionTerrain, p: Point): number {
  const g = terrain.grid,
    col = Math.round((p.x - g.west_m) / g.cell_m),
    row = Math.round((g.north_m - p.y) / g.cell_m);
  return col >= 0 && row >= 0 && col < g.side && row < g.side
    ? row * g.side + col
    : -1;
}
export function sampleTerrain(
  terrain: MissionTerrain,
  p: Point,
): number | null {
  const g = terrain.grid,
    col = (p.x - g.west_m) / g.cell_m,
    row = (g.north_m - p.y) / g.cell_m;
  if (col < 0 || row < 0 || col > g.side - 1 || row > g.side - 1) return null;
  const c = Math.min(g.side - 2, Math.floor(col)),
    r = Math.min(g.side - 2, Math.floor(row));
  const z = [
    g.elevation_m[r * g.side + c],
    g.elevation_m[r * g.side + c + 1],
    g.elevation_m[(r + 1) * g.side + c],
    g.elevation_m[(r + 1) * g.side + c + 1],
  ];
  if (z.some((v) => v === null)) return null;
  const u = col - c,
    v = row - r;
  return (
    z[0]! * (1 - u) * (1 - v) +
    z[1]! * u * (1 - v) +
    z[2]! * (1 - u) * v +
    z[3]! * u * v
  );
}
export function slopeAt(terrain: MissionTerrain, p: Point): number | null {
  const g = terrain.grid,
    d = g.cell_m;
  const w = sampleTerrain(terrain, { x: p.x - d, y: p.y }),
    e = sampleTerrain(terrain, { x: p.x + d, y: p.y });
  const n = sampleTerrain(terrain, { x: p.x, y: p.y + d }),
    s = sampleTerrain(terrain, { x: p.x, y: p.y - d });
  if (w === null || e === null || n === null || s === null) return null;
  return (
    (Math.atan(Math.hypot((e - w) / (2 * d), (n - s) / (2 * d))) * 180) /
    Math.PI
  );
}
export function crossSection(
  terrain: MissionTerrain,
  from: Point,
  to: Point,
  count = 61,
) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  return Array.from({ length: count }, (_, i) => ({
    distance: (distance * i) / (count - 1),
    elevation: sampleTerrain(terrain, {
      x: from.x + ((to.x - from.x) * i) / (count - 1),
      y: from.y + ((to.y - from.y) * i) / (count - 1),
    }),
  }));
}
export function lineOfSight(
  terrain: MissionTerrain,
  from: Point,
  to: Point,
  height = 2,
): "clear" | "blocked" | "unknown" {
  const a = sampleTerrain(terrain, from),
    b = sampleTerrain(terrain, to);
  if (a === null || b === null) return "unknown";
  const count = Math.max(
    2,
    Math.ceil(
      Math.hypot(to.x - from.x, to.y - from.y) / (terrain.grid.cell_m / 4),
    ),
  );
  let unknown = false;
  for (let i = 1; i < count; i++) {
    const f = i / count,
      z = sampleTerrain(terrain, {
        x: from.x + (to.x - from.x) * f,
        y: from.y + (to.y - from.y) * f,
      });
    if (z === null) unknown = true;
    else if (z > a + (b - a) * f + height) return "blocked";
  }
  return unknown ? "unknown" : "clear";
}
