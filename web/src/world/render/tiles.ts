// Terrain tile geometry and screen-space-error LOD selection (pure; unit-tested).
import { aeqdToEnu } from '../core/coordinates';
import type { TileDescriptor } from '../core/types';
import type { Tile, World } from '../core/world';

export interface TileGeometryData { positions: Float32Array; normals: Float32Array; map: Float32Array; index: Uint16Array; vertexCount: number }

/** ENU -> three.js (X east, Y up, Z south). */
export const toThree = (e: number, n: number, u: number): [number, number, number] => [e, u, -n];

/** Build a curvature-correct mesh from measured posts. Normals use the 1-post apron so they are continuous across same-level seams. */
export function buildTileGeometry(world: World, tile: Tile, skirtDepth: number): TileGeometryData {
  const { n, posts, desc } = tile, cells = n - 3, side = cells + 1, R = world.radius;
  const P = new Float64Array(n * n * 3);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const x = desc.west + (c - 1) * desc.posting, y = desc.north - (r - 1) * desc.posting, h = posts[r * n + c];
    const p = aeqdToEnu(x, y, h, R), i = (r * n + c) * 3;
    P[i] = p.e; P[i + 1] = p.u; P[i + 2] = -p.n;
  }
  const edge = 4 * cells, vertexCount = side * side + edge;
  const positions = new Float32Array(vertexCount * 3), normals = new Float32Array(vertexCount * 3), map = new Float32Array(vertexCount * 3);
  for (let r = 0; r < side; r++) for (let c = 0; c < side; c++) {
    const src = ((r + 1) * n + (c + 1)) * 3, dst = (r * side + c) * 3;
    positions[dst] = P[src]; positions[dst + 1] = P[src + 1]; positions[dst + 2] = P[src + 2];
    const e = ((r + 1) * n + c + 2) * 3, w = ((r + 1) * n + c) * 3, s = ((r + 2) * n + c + 1) * 3, no = (r * n + c + 1) * 3;
    const tx = [P[e] - P[w], P[e + 1] - P[w + 1], P[e + 2] - P[w + 2]], tz = [P[s] - P[no], P[s + 1] - P[no + 1], P[s + 2] - P[no + 2]];
    let nx = tz[1] * tx[2] - tz[2] * tx[1], ny = tz[2] * tx[0] - tz[0] * tx[2], nz = tz[0] * tx[1] - tz[1] * tx[0];
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    normals[dst] = nx; normals[dst + 1] = ny; normals[dst + 2] = nz;
    map[dst] = desc.west + c * desc.posting; map[dst + 1] = desc.north - r * desc.posting; map[dst + 2] = posts[(r + 1) * n + c + 1];
  }
  // Skirt ring (clockwise around the border) hides cracks between neighbours at different levels.
  const ring: number[] = [];
  for (let c = 0; c < cells; c++) ring.push(c);
  for (let r = 0; r < cells; r++) ring.push(r * side + cells);
  for (let c = cells; c > 0; c--) ring.push(cells * side + c);
  for (let r = cells; r > 0; r--) ring.push(r * side);
  ring.forEach((v, k) => {
    const dst = (side * side + k) * 3, src = v * 3;
    positions[dst] = positions[src]; positions[dst + 1] = positions[src + 1] - skirtDepth; positions[dst + 2] = positions[src + 2];
    normals[dst] = normals[src]; normals[dst + 1] = normals[src + 1]; normals[dst + 2] = normals[src + 2];
    map[dst] = map[src]; map[dst + 1] = map[src + 1]; map[dst + 2] = map[src + 2] - skirtDepth;
  });
  const index: number[] = [];
  for (let r = 0; r < cells; r++) for (let c = 0; c < cells; c++) {
    const a = r * side + c, b = a + 1, d = a + side, e = d + 1;
    index.push(a, d, b, b, d, e);
  }
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k], b = ring[(k + 1) % ring.length], sa = side * side + k, sb = side * side + (k + 1) % ring.length;
    index.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa); // both windings: skirts are seen from either side
  }
  return { positions, normals, map, index: new Uint16Array(index), vertexCount };
}

export interface LodView { position: [number, number, number]; fovYRad: number; viewportHeightPx: number; visible?: (minT: [number, number, number], maxT: [number, number, number]) => boolean; focus?: { x: number; y: number; radius: number } | null }
export interface LodSelection { render: TileDescriptor[]; request: TileDescriptor[]; maxLevel: number }

/** Bounds of a tile in three.js coordinates, including curvature and the tile's height range. */
export function tileBounds(world: World, d: TileDescriptor): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const fx of [0, 0.5, 1]) for (const fy of [0, 0.5, 1]) for (const h of [d.minH, d.maxH]) {
    const p = aeqdToEnu(d.west + fx * d.size, d.north - fy * d.size, h, world.radius), t = toThree(p.e, p.n, p.u);
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], t[k]); max[k] = Math.max(max[k], t[k]); }
  }
  return { min, max };
}

export function screenSpaceError(geometricError: number, distance: number, view: LodView) {
  return geometricError * view.viewportHeightPx / (2 * Math.max(1e-3, distance) * Math.tan(view.fovYRad / 2));
}

/**
 * Quadtree refinement: refine while SSE exceeds the threshold and children exist. A parent stays
 * rendered until all four children are loaded (no holes during streaming).
 */
export function selectTiles(world: World, view: LodView, threshold: number, isLoaded: (key: string) => boolean): LodSelection {
  const render: TileDescriptor[] = [], request: TileDescriptor[] = [];
  let maxLevel = 0;
  const root = world.descriptor('0/0_0')!;
  const visit = (d: TileDescriptor) => {
    const b = tileBounds(world, d);
    if (view.visible && !view.visible(b.min, b.max)) return;
    const dx = Math.max(b.min[0] - view.position[0], 0, view.position[0] - b.max[0]);
    const dy = Math.max(b.min[1] - view.position[1], 0, view.position[1] - b.max[1]);
    const dz = Math.max(b.min[2] - view.position[2], 0, view.position[2] - b.max[2]);
    const dist = Math.hypot(dx, dy, dz);
    const kids = world.children(d);
    const focused = !!view.focus && Math.abs(view.focus.x - (d.west + d.size / 2)) < d.size / 2 + view.focus.radius && Math.abs(view.focus.y - (d.north - d.size / 2)) < d.size / 2 + view.focus.radius;
    const refine = kids.length > 0 && (screenSpaceError(d.geometricErrorMax, dist, view) > threshold || focused);
    if (refine) {
      if (kids.every(k => isLoaded(k.key))) { kids.forEach(visit); return; }
      kids.forEach(k => { if (!isLoaded(k.key)) request.push(k); });
    }
    if (!isLoaded(d.key)) { request.push(d); return; }
    render.push(d); maxLevel = Math.max(maxLevel, d.level);
  };
  visit(root);
  return { render, request, maxLevel };
}
