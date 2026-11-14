// World package loader and the single height model used by renderer, analysis, planner and simulator.
// Reproducibility rule: analysis/simulation heights come from a fixed "analysis level" per location
// (finest packaged level there), never from whatever LOD the camera happens to have loaded.
import { decodeClasses, decodeElevation, gunzip } from './codec';
import type { IlluminationRecord, MapPoint, ModelEntry, PerceptionRecord, SceneObject, TileDescriptor, WorldManifest } from './types';

export type Fetcher = (path: string, signal?: AbortSignal) => Promise<ArrayBuffer>;
export interface Tile { desc: TileDescriptor; n: number; posts: Float32Array }
export interface HorizonGrid { width: number; height: number; west: number; north: number; cell: number; values: Float32Array }
export interface ClassGrid { width: number; height: number; west: number; north: number; cell: number; values: Uint8Array }

export function browserFetcher(base: string): Fetcher {
  return async (path, signal) => {
    const response = await fetch(`${base}${path}`, { signal });
    if (!response.ok) throw new Error(`World file ${path} is unavailable (HTTP ${response.status}).`);
    return response.arrayBuffer();
  };
}

const json = async <T>(fetcher: Fetcher, path: string) => JSON.parse(new TextDecoder().decode(await gunzip(await fetcher(path)))) as T;

export class World {
  readonly half: number;
  readonly radius: number;
  private tiles = new Map<string, Tile>();
  /** Numeric index of loaded tiles per level (row * n + col) for allocation-free height queries. */
  private levelIndex: (Tile | undefined)[][] = [];
  private pending = new Map<string, Promise<Tile>>();
  private byKey = new Map<string, TileDescriptor>();
  private lru: string[] = [];
  maxCachedTiles = 420;

  constructor(
    readonly manifest: WorldManifest,
    readonly objects: SceneObject[],
    readonly illumination: IlluminationRecord,
    readonly perception: PerceptionRecord,
    readonly registry: ModelEntry[],
    readonly horizon: HorizonGrid,
    readonly units: ClassGrid,
    private fetcher: Fetcher,
  ) {
    this.half = manifest.pyramid.footprintM / 2;
    this.radius = manifest.referenceFrame.radiusM;
    for (const t of manifest.pyramid.tiles) this.byKey.set(t.key, t);
    for (let l = 0; l < manifest.pyramid.levels; l++) this.levelIndex.push(new Array(4 ** l));
  }

  static async load(fetcher: Fetcher): Promise<World> {
    const manifest = await json<WorldManifest>(fetcher, 'manifest.json');
    if (manifest.schema !== 'egiz.world_manifest' || !/^1\./.test(manifest.version) || manifest.synthetic !== false) throw new Error('Unsupported or synthetic world manifest.');
    const [objects, illumination, perception, registry, horizonBytes, unitBytes] = await Promise.all([
      json<{ objects: SceneObject[] }>(fetcher, manifest.objects.file),
      json<IlluminationRecord>(fetcher, manifest.illumination.file),
      json<PerceptionRecord>(fetcher, manifest.perception),
      json<{ models: ModelEntry[] }>(fetcher, manifest.registry),
      fetcher(manifest.layers.horizon.file).then(gunzip),
      fetcher(manifest.layers.units.file).then(gunzip),
    ]);
    if (illumination.schema !== 'egiz.world_illumination') throw new Error('Illumination record has an unsupported schema.');
    const h = decodeElevation(horizonBytes), hl = manifest.layers.horizon;
    const u = decodeClasses(unitBytes), ul = manifest.layers.units;
    return new World(manifest, objects.objects, illumination, perception, registry.models.map(m => ({ ...m, runtime: 'python-build' as const })),
      { width: h.width, height: h.height, west: hl.west, north: hl.north, cell: hl.cell, values: h.values },
      { width: u.width, height: u.height, west: ul.west, north: ul.north, cell: ul.cell, values: u.values }, fetcher);
  }

  get operationalBox() { return this.manifest.pyramid.operationalBox; }
  get maxLevel() { return this.manifest.pyramid.levels - 1; }

  inFootprint(p: MapPoint) { return Math.abs(p.x) < this.half && Math.abs(p.y) < this.half; }
  inOperational(p: MapPoint) { const [w, s, e, n] = this.operationalBox; return p.x >= w && p.x < e && p.y > s && p.y <= n; }
  /** Finest packaged level at a point: the level used by every analysis and simulation query. */
  analysisLevel(p: MapPoint) { return this.inOperational(p) ? this.maxLevel : this.manifest.pyramid.fullLevels - 1; }
  postingAt(p: MapPoint) { return this.manifest.pyramid.postingsM[this.analysisLevel(p)]; }

  tileKeyAt(level: number, x: number, y: number) {
    const size = this.manifest.pyramid.footprintM / 2 ** level;
    const n = 2 ** level;
    const col = Math.min(n - 1, Math.max(0, Math.floor((x + this.half) / size)));
    const row = Math.min(n - 1, Math.max(0, Math.floor((this.half - y) / size)));
    return `${level}/${col}_${row}`;
  }
  descriptor(key: string) { return this.byKey.get(key); }
  children(desc: TileDescriptor): TileDescriptor[] {
    const out: TileDescriptor[] = [];
    for (const [dc, dr] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const child = this.byKey.get(`${desc.level + 1}/${desc.col * 2 + dc}_${desc.row * 2 + dr}`);
      if (child) out.push(child);
    }
    return out.length === 4 ? out : [];
  }
  loadedTile(key: string) { return this.tiles.get(key); }

  async tile(key: string, signal?: AbortSignal): Promise<Tile> {
    const cached = this.tiles.get(key);
    if (cached) { this.touch(key); return cached; }
    const inflight = this.pending.get(key);
    if (inflight) return inflight;
    const desc = this.byKey.get(key);
    if (!desc) throw new Error(`Tile ${key} is not in the world package.`);
    const promise = this.fetcher(`tiles/${key}.egt`, signal).then(gunzip).then(bytes => {
      const grid = decodeElevation(bytes);
      const n = this.manifest.pyramid.cells + 1 + 2 * this.manifest.pyramid.apron;
      if (grid.width !== n || grid.height !== n) throw new Error(`Tile ${key} has unexpected dimensions.`);
      const tile = { desc, n, posts: grid.values };
      this.tiles.set(key, tile); this.levelIndex[desc.level][desc.row * 2 ** desc.level + desc.col] = tile; this.touch(key); this.evict();
      return tile;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
  private touch(key: string) { const i = this.lru.indexOf(key); if (i >= 0) this.lru.splice(i, 1); this.lru.push(key); }
  private evict() {
    // Never evict analysis-level tiles (they are small and keep simulation deterministic and fast).
    while (this.tiles.size > this.maxCachedTiles) {
      const victim = this.lru.find(k => { const d = this.byKey.get(k)!; return d.level < this.maxLevel && d.level !== this.manifest.pyramid.fullLevels - 1; });
      if (!victim) break;
      const d = this.byKey.get(victim)!;
      this.tiles.delete(victim); this.levelIndex[d.level][d.row * 2 ** d.level + d.col] = undefined; this.lru.splice(this.lru.indexOf(victim), 1);
    }
  }
  get cachedTileCount() { return this.tiles.size; }
  get cachedBytes() { let b = 0; for (const t of this.tiles.values()) b += t.posts.byteLength; return b; }

  /** Load every analysis-level tile intersecting a box so height queries inside it are exact. */
  async ensureAnalysis(box: { west: number; south: number; east: number; north: number }, signal?: AbortSignal, onProgress?: (done: number, total: number) => void) {
    const keys = new Set<string>();
    const step = 200;
    for (let x = box.west; x <= box.east + step; x += step) for (let y = box.south; y <= box.north + step; y += step) {
      const p = { x: Math.min(box.east, x), y: Math.min(box.north, y) };
      if (!this.inFootprint(p)) continue;
      keys.add(this.tileKeyAt(this.analysisLevel(p), p.x, p.y));
    }
    let done = 0;
    await Promise.all([...keys].map(k => this.tile(k, signal).then(t => { onProgress?.(++done, keys.size); return t; })));
    return keys.size;
  }
  async ensureOperational(signal?: AbortSignal, onProgress?: (done: number, total: number) => void) {
    const [w, s, e, n] = this.operationalBox;
    return this.ensureAnalysis({ west: w, south: s, east: e - 0.01, north: n }, signal, onProgress);
  }

  /** Bilinear height on a specific level's posts; null when the tile is not loaded or outside the package. */
  heightOnLevel(level: number, x: number, y: number): number | null {
    const half = this.half;
    if (!(x > -half && x < half && y > -half && y < half)) return null;
    const side = 1 << level, size = 2 * half / side;
    const col = Math.min(side - 1, Math.floor((x + half) / size)), row = Math.min(side - 1, Math.floor((half - y) / size));
    const tile = this.levelIndex[level][row * side + col];
    if (!tile) return null;
    const d = tile.desc, a = this.manifest.pyramid.apron;
    const fc = (x - d.west) / d.posting + a, fr = (d.north - y) / d.posting + a;
    const c0 = Math.min(tile.n - 2, Math.max(0, Math.floor(fc))), r0 = Math.min(tile.n - 2, Math.max(0, Math.floor(fr)));
    const tx = fc - c0, ty = fr - r0, p = tile.posts, n = tile.n, i = r0 * n + c0;
    return (p[i] * (1 - tx) + p[i + 1] * tx) * (1 - ty) + (p[i + n] * (1 - tx) + p[i + n + 1] * tx) * ty;
  }
  /** The analysis height model. */
  heightAt(x: number, y: number): number | null {
    const [w, s, e, n] = this.manifest.pyramid.operationalBox;
    return this.heightOnLevel(x >= w && x < e && y > s && y <= n ? this.maxLevel : this.manifest.pyramid.fullLevels - 1, x, y);
  }
  requireHeight(x: number, y: number): number {
    const h = this.heightAt(x, y);
    if (h === null || !Number.isFinite(h)) throw new Error(`No analysis height at (${x.toFixed(1)}, ${y.toFixed(1)}); load the analysis tiles first.`);
    return h;
  }

  /** Horizon grid (20 m, whole source raster) used for shadows and line-of-sight. NaN = unknown, no occluder. */
  horizonHeight(x: number, y: number): number {
    const g = this.horizon;
    const fc = (x - g.west) / g.cell - 0.5, fr = (g.north - y) / g.cell - 0.5;
    const c0 = Math.floor(fc), r0 = Math.floor(fr);
    if (c0 < 0 || r0 < 0 || c0 >= g.width - 1 || r0 >= g.height - 1) return NaN;
    const tx = fc - c0, ty = fr - r0, v = g.values, i = r0 * g.width + c0;
    return (v[i] * (1 - tx) + v[i + 1] * tx) * (1 - ty) + (v[i + g.width] * (1 - tx) + v[i + g.width + 1] * tx) * ty;
  }

  unitAt(x: number, y: number) {
    const g = this.units;
    const c = Math.floor((x - g.west) / g.cell), r = Math.floor((g.north - y) / g.cell);
    if (c < 0 || r < 0 || c >= g.width || r >= g.height) return null;
    const id = g.values[r * g.width + c];
    return id === 255 ? null : this.perception.units.classes.find(u => u.id === id) ?? null;
  }

  object(id: string) { return this.objects.find(o => o.id === id) ?? null; }
}
