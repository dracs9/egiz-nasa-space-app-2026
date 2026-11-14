// EGIZ ASTRAL · Planetary World Core. Pure data contracts and tile mathematics (no renderer imports).
// Local frame: x east, y north (metres from the site origin), z up (metres above the source vertical datum).

export type Body = "earth" | "moon" | "mars";
/** How a displayed element relates to observation. Shown in the UI for every layer and object. */
export type Provenance =
  | "measured" // direct source product sample
  | "measured-area-average" // coarser LOD averaged from measured samples
  | "image-derived" // detected in imagery by a stated algorithm
  | "terrain-derived" // computed from measured elevation by a stated algorithm
  | "model-inferred" // statistical/ML output
  | "assumed" // declared parameter, not measured at this site
  | "illustrative" // visual aid only
  | "hypothetical"; // user scenario

export interface WorldTile {
  key: string; level: number; col: number; row: number;
  west: number; north: number; size: number; posting_m: number;
  valid_fraction: number; min_m: number | null; max_m: number | null;
  height_sha256: string; height_bytes: number;
  image_px_m?: number; image_sha256?: string; image_bytes?: number;
}
export interface WorldSource {
  product: string; url: string; landing_page: string; citation: string; pixel_m: number; kind: string;
  vertical_datum?: string; window_sha256: string;
  source_window_px: { col: number; row: number; width: number; height: number };
}
export interface WorldManifest {
  schema: "egiz.world_scene"; version: "1.0.0"; synthetic: false;
  site: { id: string; name: string; body: Body; lat: number; lon: number; radius_m: number; frame: string };
  local_crs: string; local_axes: string;
  extent: { west: number; east: number; south: number; north: number };
  encoding: { posts: number; apron: number; side: number; dtype: "int16-le"; scale_m: number; offset_m: number; nodata: number; image_px: number | null; row_order: string; note: string };
  levels: { level: number; tiles_per_side: number; tile_size_m: number; posting_m: number; image_px_m: number | null; provenance: Provenance }[];
  tiles: WorldTile[];
  sources: { dtm: WorldSource; ortho?: WorldSource };
  illumination: { engine: string; record: string; site_id: string };
  method: string; limitations: string[];
}

const HASH = /^[a-f0-9]{64}$/;
/** Rejects anything that is not a complete, non-synthetic, fingerprinted world package. */
export function validateManifest(value: unknown): WorldManifest {
  const m = value as WorldManifest;
  const fail = (why: string): never => { throw new Error(`World package is invalid: ${why}. Rebuild it with python -m pipeline.world.scene <site>.`); };
  if (!m || m.schema !== "egiz.world_scene" || m.version !== "1.0.0") fail("unknown schema");
  if (m.synthetic !== false) fail("synthetic terrain is not accepted");
  if (!["earth", "moon", "mars"].includes(m.site?.body) || !Number.isFinite(m.site.lat) || !Number.isFinite(m.site.lon) || !(m.site.radius_m > 0)) fail("site");
  const e = m.encoding;
  if (!e || e.dtype !== "int16-le" || e.side !== e.posts + 1 + 2 * e.apron || !(e.scale_m > 0) || !Number.isFinite(e.offset_m)) fail("encoding");
  if (!Array.isArray(m.levels) || !m.levels.length || !Array.isArray(m.tiles)) fail("levels");
  if (m.tiles.length !== m.levels.reduce((n, l) => n + l.tiles_per_side ** 2, 0)) fail("tile count");
  const keys = new Set<string>();
  for (const t of m.tiles) {
    if (t.key !== tileKey(t.level, t.col, t.row) || keys.has(t.key) || !HASH.test(t.height_sha256) || t.height_bytes !== e.side * e.side * 2) fail(`tile ${t?.key}`);
    keys.add(t.key);
  }
  if (!m.sources?.dtm || !HASH.test(m.sources.dtm.window_sha256) || !/^https:\/\//.test(m.sources.dtm.url)) fail("source provenance");
  return m;
}

export const tileKey = (level: number, col: number, row: number) => `${level}-${col}-${row}`;
export function tileIndex(m: WorldManifest): Map<string, WorldTile> { return new Map(m.tiles.map(t => [t.key, t])); }
export function childKeys(t: Pick<WorldTile, "level" | "col" | "row">): string[] {
  return [0, 1, 2, 3].map(i => tileKey(t.level + 1, t.col * 2 + (i & 1), t.row * 2 + (i >> 1)));
}

/** Decode a height tile to metres; nodata becomes NaN. Includes the one-post apron. */
export function decodeHeights(buffer: ArrayBuffer, e: WorldManifest["encoding"]): Float32Array {
  if (buffer.byteLength !== e.side * e.side * 2) throw new Error("Height tile has an unexpected size");
  const view = new DataView(buffer), out = new Float32Array(e.side * e.side);
  for (let i = 0; i < out.length; i++) {
    const q = view.getInt16(i * 2, true);
    out[i] = q === e.nodata ? NaN : q * e.scale_m + e.offset_m;
  }
  return out;
}

/** Local metres → planetocentric lat/lon (degrees) on the site's sphere (inverse azimuthal equidistant). */
export function localToLatLon(site: WorldManifest["site"], x: number, y: number): { lat: number; lon: number } {
  const rho = Math.hypot(x, y), lat0 = (site.lat * Math.PI) / 180;
  if (rho < 1e-9) return { lat: site.lat, lon: site.lon };
  const c = rho / site.radius_m;
  const lat = Math.asin(Math.cos(c) * Math.sin(lat0) + (y * Math.sin(c) * Math.cos(lat0)) / rho);
  const lon = Math.atan2(x * Math.sin(c), rho * Math.cos(lat0) * Math.cos(c) - y * Math.sin(lat0) * Math.sin(c));
  return { lat: (lat * 180) / Math.PI, lon: site.lon + (lon * 180) / Math.PI };
}
/** Forward azimuthal equidistant projection; inverse of localToLatLon. */
export function latLonToLocal(site: WorldManifest["site"], lat: number, lon: number): { x: number; y: number } {
  const p = (lat * Math.PI) / 180, p0 = (site.lat * Math.PI) / 180, dl = ((lon - site.lon) * Math.PI) / 180;
  const cosc = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(dl);
  const c = Math.acos(Math.max(-1, Math.min(1, cosc))), k = c < 1e-12 ? 1 : c / Math.sin(c);
  return { x: site.radius_m * k * Math.cos(p) * Math.sin(dl), y: site.radius_m * k * (Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(dl)) };
}

export interface LodView { eye: [number, number, number]; viewportHeightPx: number; fovDeg: number; maxErrorPx: number; visible?(t: WorldTile): boolean }
/** Geometric error of a level: half its posting (finer structure is averaged away); zero at the finest level. */
export function geometricError(m: WorldManifest, level: number): number {
  return level >= m.levels.length - 1 ? 0 : m.levels[level].posting_m / 2;
}
export function distanceToTile(t: WorldTile, eye: [number, number, number], fallbackZ: number): number {
  const dx = Math.max(t.west - eye[0], 0, eye[0] - (t.west + t.size));
  const dy = Math.max(t.north - t.size - eye[1], 0, eye[1] - t.north);
  const lo = t.min_m ?? fallbackZ, hi = t.max_m ?? fallbackZ;
  const dz = Math.max(lo - eye[2], 0, eye[2] - hi);
  return Math.hypot(dx, dy, dz);
}
/** Quadtree refinement by projected screen-space error. Returns the tiles a view wants, coarse to fine. */
export function selectTiles(m: WorldManifest, index: Map<string, WorldTile>, view: LodView): WorldTile[] {
  const k = view.viewportHeightPx / (2 * Math.tan((view.fovDeg * Math.PI) / 360));
  const out: WorldTile[] = [];
  const visit = (t: WorldTile) => {
    if (view.visible && !view.visible(t)) return;
    const d = Math.max(1, distanceToTile(t, view.eye, m.encoding.offset_m));
    const error = (geometricError(m, t.level) * k) / d;
    if (error > view.maxErrorPx && t.level < m.levels.length - 1) for (const key of childKeys(t)) visit(index.get(key)!);
    else out.push(t);
  };
  for (const t of m.tiles) if (t.level === 0) visit(t);
  return out;
}

export type TileState<T> = { tile: WorldTile; data?: T; pending?: AbortController; lastUsed: number };
/** Streaming cache: bounded concurrency, cancellation of tiles no longer wanted, LRU eviction. */
export class TileCache<T> {
  readonly entries = new Map<string, TileState<T>>();
  private active = 0; private clock = 0;
  constructor(private load: (t: WorldTile, signal: AbortSignal) => Promise<T>, private dispose: (data: T) => void,
    private options: { maxConcurrent: number; maxTiles: number; onChange?(): void; onError?(t: WorldTile, e: unknown): void }) {}
  get(key: string): T | undefined { const e = this.entries.get(key); if (e) e.lastUsed = this.clock; return e?.data; }
  get pendingCount() { return this.active; }
  /** Request tiles in priority order; anything pending and not requested is cancelled. */
  request(wanted: WorldTile[], pinned: Set<string> = new Set()) {
    this.clock++;
    const keys = new Set(wanted.map(t => t.key));
    for (const [key, e] of this.entries) if (e.pending && !keys.has(key)) { e.pending.abort(); this.entries.delete(key); this.active--; }
    for (const t of wanted) {
      const existing = this.entries.get(t.key);
      if (existing) { existing.lastUsed = this.clock; continue; }
      if (this.active >= this.options.maxConcurrent) continue;
      const pending = new AbortController(), entry: TileState<T> = { tile: t, pending, lastUsed: this.clock };
      this.entries.set(t.key, entry); this.active++;
      this.load(t, pending.signal).then(data => {
        if (this.entries.get(t.key) !== entry) { this.dispose(data); return; }
        entry.data = data; entry.pending = undefined; this.active--; this.options.onChange?.();
      }).catch(error => {
        if (this.entries.get(t.key) === entry) { this.entries.delete(t.key); this.active--; }
        if (!pending.signal.aborted) this.options.onError?.(t, error);
      });
    }
    const loaded = [...this.entries.values()].filter(e => e.data !== undefined && !keys.has(e.tile.key) && !pinned.has(e.tile.key));
    const excess = this.entries.size - this.options.maxTiles;
    if (excess > 0) for (const e of loaded.sort((a, b) => a.lastUsed - b.lastUsed).slice(0, excess)) { this.dispose(e.data!); this.entries.delete(e.tile.key); }
  }
  clear() { for (const e of this.entries.values()) { e.pending?.abort(); if (e.data !== undefined) this.dispose(e.data); } this.entries.clear(); this.active = 0; }
}

/** Every ancestor of the wanted tiles, coarse first. Loading these gives progressive refinement while leaves stream in. */
export function ancestorsOf(index: Map<string, WorldTile>, wanted: WorldTile[]): WorldTile[] {
  const out = new Map<string, WorldTile>();
  for (const t of wanted) for (let level = t.level - 1, col = t.col >> 1, row = t.row >> 1; level >= 0; level--, col >>= 1, row >>= 1) { const a = index.get(tileKey(level, col, row))!; if (out.has(a.key)) break; out.set(a.key, a); }
  return [...out.values()].sort((a, b) => a.level - b.level);
}
/** Tiles to draw: each wanted tile if loaded, otherwise the finest loaded ancestor that covers it. Draws never overlap. */
export function resolveDrawSet(m: WorldManifest, index: Map<string, WorldTile>, wanted: WorldTile[], loaded: (key: string) => boolean): string[] {
  const want = new Set(wanted.map(t => t.key)), cover = new Set(want), draw: string[] = [];
  for (const a of ancestorsOf(index, wanted)) cover.add(a.key);
  const visit = (t: WorldTile): boolean => {
    if (!cover.has(t.key)) return true; // nothing visible is wanted below this tile
    if (want.has(t.key)) { if (loaded(t.key)) { draw.push(t.key); return true; } return false; }
    const mark = draw.length;
    let complete = true;
    for (const k of childKeys(t)) if (!visit(index.get(k)!)) complete = false;
    if (complete) return true;
    draw.length = mark; // a descendant is still loading: show this tile instead, if it has arrived
    if (loaded(t.key)) { draw.push(t.key); return true; }
    return false;
  };
  for (const t of m.tiles) if (t.level === 0) visit(t);
  return draw;
}
