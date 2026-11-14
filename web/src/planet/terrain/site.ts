// EGIZ Planetary Studio · unified site model.
// One `Site` abstraction over every terrain package EGIZ can read, so a single renderer, analysis
// toolkit, digital twin and intelligence layer work on the Moon, Mars and Earth alike:
//   · egiz.world_scene     (Mars Jezero 1 m HiRISE, Earth GLO-30 windows)      → sceneSite
//   · egiz.world_manifest  (Mons Mouton 5 m LOLA pyramid with horizon grid)    → moonSite
//   · streamed Earth DEM   (any discovery candidate, see earthStream.ts)       → fieldSite
// Local frame everywhere: x east, y north (metres from the site origin, azimuthal equidistant on the
// body sphere), heights in metres above the source vertical datum. Nothing here is synthetic.
import { childKeys, decodeHeights, geometricError, latLonToLocal, localToLatLon, tileIndex, validateManifest, type WorldManifest as SceneManifest, type WorldTile } from '../../astral/world/core';
import { fieldRange, loadField, sample, type Field, type XY } from '../../astral/world/field';
import { browserFetcher, World } from '../../world/core/world';
import type { SpiceGeometry } from '../../mission/types';

export type Body = 'earth' | 'moon' | 'mars';
export const GRAVITY: Record<Body, number> = { earth: 9.80665, moon: 1.62, mars: 3.721 };
export const BODY_LABEL: Record<Body, string> = { earth: 'Earth', moon: 'Moon', mars: 'Mars' };

/** A renderable terrain tile, independent of the package format. */
export interface TerrainTile { key: string; level: number; west: number; north: number; size: number; posting: number; minH: number; maxH: number; error: number; image?: string }
/** Quadtree of measured posts. `heights` returns (cells+3)² values, row 0 north, with a one-post apron; NaN = no data. */
export interface TileSource { cells: number; maxLevel: number; roots: TerrainTile[]; children(t: TerrainTile): TerrainTile[]; heights(t: TerrainTile, signal?: AbortSignal): Promise<Float32Array> }

export interface SiteProvenance {
  product: string; url: string; citation: string; nativePostingM: number; verticalDatum: string; crs: string;
  sha256: string | null; method: string; delivery: 'packaged' | 'streamed'; license: string;
}
export interface SiteObject extends XY { id: string; kind: 'crater' | 'anomaly'; radiusM: number; confidence: number | null; evidence: 'model-detected' | 'computational-hypothesis' }
export interface SiteLevel { level: number; postingM: number; provenance: string }
export interface Site {
  key: string; id: string; name: string; body: Body; lat: number; lon: number; radiusM: number; gravity: number;
  extent: { west: number; east: number; south: number; north: number };
  levels: SiteLevel[]; tiles: TileSource;
  /** Analysis grid: the one height model every layer, measurement, route and simulation reads. */
  field: Field;
  /** Wider / coarser measured grid used as shadow occluder and as height fallback outside `field`. */
  context: Field | null;
  datum: number; sun: SpiceGeometry | null; sunNote: string;
  provenance: SiteProvenance; limitations: string[]; imagery: boolean; objects: SiteObject[];
  discoveryWindow: string | null;
}
export interface SiteRef { key: string; id: string; name: string; body: Body; lat: number; lon: number; format: 'scene' | 'pyramid'; discoveryWindow: string | null; postingM: number; extentM: number }

export const heightAt = (s: Site, p: XY): number | null => sample(s.field, p) ?? (s.context ? sample(s.context, p) : null);
export const siteLatLon = (s: Pick<Site, 'lat' | 'lon' | 'radiusM'>, p: XY) => localToLatLon({ lat: s.lat, lon: s.lon, radius_m: s.radiusM } as SceneManifest['site'], p.x, p.y);
export const siteLocal = (s: Pick<Site, 'lat' | 'lon' | 'radiusM'>, lat: number, lon: number) => latLonToLocal({ lat: s.lat, lon: s.lon, radius_m: s.radiusM } as SceneManifest['site'], lat, lon);
export const inAnalysis = (s: Site, p: XY) => sample(s.field, p) !== null;

const json = async <T>(url: string, signal?: AbortSignal): Promise<T> => {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`${url.split('/').slice(-2).join('/')} is unavailable (HTTP ${r.status}).`);
  return r.json() as Promise<T>;
};

/** Quadtree over an in-memory field (used for streamed terrain). Coarser levels decimate measured posts. */
export function fieldSource(f: Field, cells = 128): TileSource {
  const span = f.side - 1, maxLevel = Math.round(Math.log2(span / cells));
  if (cells * 2 ** maxLevel !== span) throw new Error(`Field side ${f.side} does not form a ${cells}-cell quadtree.`);
  const n = cells + 3, range = fieldRange(f);
  const tile = (level: number, col: number, row: number): TerrainTile => {
    const stride = 2 ** (maxLevel - level), size = cells * stride * f.posting;
    return { key: `${level}-${col}-${row}`, level, west: f.west + col * size, north: f.north - row * size, size, posting: stride * f.posting, minH: range.min, maxH: range.max, error: level === maxLevel ? 0 : (stride * f.posting) / 2 };
  };
  return {
    cells, maxLevel, roots: [tile(0, 0, 0)],
    children: t => (t.level >= maxLevel ? [] : [0, 1, 2, 3].map(i => { const [, c, r] = t.key.split('-').map(Number); return tile(t.level + 1, c * 2 + (i & 1), r * 2 + (i >> 1)); })),
    heights: async t => {
      const [, col, row] = t.key.split('-').map(Number), stride = 2 ** (maxLevel - t.level), out = new Float32Array(n * n);
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        const fr = Math.min(span, Math.max(0, (row * cells + r - 1) * stride)), fc = Math.min(span, Math.max(0, (col * cells + c - 1) * stride));
        out[r * n + c] = f.z[fr * f.side + fc];
      }
      return out;
    },
  };
}

function sceneSource(m: SceneManifest, base: string): TileSource {
  const index = tileIndex(m), cells = m.encoding.posts;
  const map = (t: WorldTile): TerrainTile => ({ key: t.key, level: t.level, west: t.west, north: t.north, size: t.size, posting: t.posting_m, minH: t.min_m ?? m.encoding.offset_m, maxH: t.max_m ?? m.encoding.offset_m, error: geometricError(m, t.level), image: t.image_sha256 ? `${base}img/${t.key}.jpg` : undefined });
  return {
    cells, maxLevel: m.levels.length - 1, roots: m.tiles.filter(t => t.level === 0).map(map),
    children: t => { const w = index.get(t.key)!; return w.level >= m.levels.length - 1 ? [] : childKeys(w).map(k => map(index.get(k)!)); },
    heights: async (t, signal) => {
      const r = await fetch(`${base}h/${t.key}.bin`, { signal });
      if (!r.ok) throw new Error(`Terrain tile ${t.key}: HTTP ${r.status}`);
      return decodeHeights(await r.arrayBuffer(), m.encoding);
    },
  };
}

function checkSun(value: unknown, id: string): SpiceGeometry {
  const g = value as Omit<SpiceGeometry, 'schema'> & { schema: string };
  const ok = g && g.schema === 'egiz.world_illumination' && g.siteId === id && Array.isArray(g.samples) && g.samples.length > 1 && g.samples[0].t === 0
    && g.samples.every((s, i) => (!i || s.t > g.samples[i - 1].t) && Array.isArray(s.sunEnu) && Math.abs(Math.hypot(...s.sunEnu) - 1) < 1e-6 && s.solarFluxWm2 > 0);
  if (!ok) throw new Error('illumination record is not a valid CSPICE record for this site');
  return g as unknown as SpiceGeometry;
}

/** Mars Jezero and the packaged Earth windows. The analysis grid is the finest level that fits 1025² posts. */
export async function loadSceneSite(key: string, base: string, signal?: AbortSignal): Promise<Site> {
  const m = validateManifest(await json(`${base}manifest.json`, signal));
  let level = m.levels.length - 1;
  while (level > 0 && m.levels[level].tiles_per_side * m.encoding.posts + 1 > 1025) level--;
  const field = await loadField(m, level, async t => { const r = await fetch(`${base}h/${t.key}.bin`, { signal }); if (!r.ok) throw new Error(`Terrain tile ${t.key}: HTTP ${r.status}`); return r.arrayBuffer(); });
  let sun: SpiceGeometry | null = null, sunNote = 'No illumination record is packaged for this site.';
  try { sun = checkSun(await json(`${base}illumination.json`, signal), m.site.id); sunNote = `${sun.engine}; epoch ${sun.epochUtc}, ${(sun.duration / 3600).toFixed(0)} h at ${sun.step} s steps, frame ${sun.frame}.`; }
  catch (e) { if (signal?.aborted) throw e; sunNote = `Illumination unavailable: ${e instanceof Error ? e.message : e}`; }
  const d = m.sources.dtm, fine = m.levels[m.levels.length - 1];
  return {
    key, id: m.site.id, name: m.site.name, body: m.site.body, lat: m.site.lat, lon: m.site.lon, radiusM: m.site.radius_m, gravity: GRAVITY[m.site.body],
    extent: m.extent, levels: m.levels.map(l => ({ level: l.level, postingM: l.posting_m, provenance: l.provenance })), tiles: sceneSource(m, base), field, context: null,
    datum: m.encoding.offset_m, sun, sunNote, imagery: !!m.sources.ortho, objects: [],
    provenance: { product: d.product, url: d.landing_page ?? d.url, citation: d.citation, nativePostingM: d.pixel_m, verticalDatum: d.vertical_datum ?? 'not stated by the source', crs: m.local_crs, sha256: d.window_sha256,
      method: `${m.method} Analysis grid: level ${level} (${m.levels[level].posting_m} m, ${m.levels[level].provenance}); finest packaged level ${fine.posting_m} m.`, delivery: 'packaged', license: 'See source landing page' },
    limitations: m.limitations, discoveryWindow: (m as SceneManifest & { discovery_window?: string }).discovery_window ?? null,
  };
}

/** Mons Mouton: 5 m analysis grid over the operational box, 20 m horizon grid (26 km) as occluder / context. */
export async function loadMoonSite(key: string, base: string, signal?: AbortSignal, onProgress?: (done: number, total: number) => void): Promise<Site> {
  const world = await World.load(browserFetcher(base)), m = world.manifest;
  await world.ensureOperational(signal, onProgress);
  const [w, s, e, n] = world.operationalBox, posting = m.pyramid.postingsM[world.maxLevel], side = Math.round((e - w) / posting) + 1;
  const z = new Float32Array(side * side);
  for (let r = 0; r < side; r++) for (let c = 0; c < side; c++)
    z[r * side + c] = world.heightOnLevel(world.maxLevel, Math.min(e - 1e-3, w + c * posting), Math.max(s + 1e-3, n - r * posting)) ?? NaN;
  const field: Field = { side, posting, west: w, north: n, z, level: world.maxLevel, provenance: 'measured' };
  const g = world.horizon, context: Field = { side: Math.min(g.width, g.height), posting: g.cell, west: g.west + g.cell / 2, north: g.north - g.cell / 2, z: g.values, level: m.pyramid.fullLevels - 1, provenance: 'measured-area-average' };
  const rec = world.illumination, deg = 180 / Math.PI;
  const samples = rec.samples.map(v => { const l = Math.hypot(v[1], v[2], v[3]), sunEnu = [v[1] / l, v[2] / l, v[3] / l], le = Math.hypot(v[5], v[6], v[7]);
    return { t: v[0], sunEnu, elevationDeg: Math.asin(sunEnu[2]) * deg, azimuthDeg: (Math.atan2(sunEnu[0], sunEnu[1]) * deg + 360) % 360, solarFluxWm2: v[4], earthElevationDeg: le > 0 ? Math.asin(v[7] / le) * deg : null, earthRangeKm: null }; });
  const sun = { schema: 'egiz.spice_geometry', version: '1.0.0', engine: rec.engine, siteId: m.siteId, body: 'moon', lat: m.referenceFrame.originLonLat[1], lon: m.referenceFrame.originLonLat[0], epochUtc: rec.epochUtc, frame: rec.frame, observer: rec.observer, aberration: 'NONE', duration: rec.duration, step: rec.step, kernels: rec.kernels, samples, limitations: rec.limitations } as unknown as SpiceGeometry;
  const half = world.half, src: TileSource = {
    cells: m.pyramid.cells, maxLevel: world.maxLevel,
    roots: [world.descriptor('0/0_0')!].map(d => ({ key: d.key, level: d.level, west: d.west, north: d.north, size: d.size, posting: d.posting, minH: d.minH, maxH: d.maxH, error: d.geometricErrorMax })),
    children: t => world.children(world.descriptor(t.key)!).map(d => ({ key: d.key, level: d.level, west: d.west, north: d.north, size: d.size, posting: d.posting, minH: d.minH, maxH: d.maxH, error: d.geometricErrorMax })),
    heights: async (t, sig) => (await world.tile(t.key, sig)).posts,
  };
  return {
    key, id: m.siteId, name: m.name, body: 'moon', lat: m.referenceFrame.originLonLat[1], lon: m.referenceFrame.originLonLat[0], radiusM: m.referenceFrame.radiusM, gravity: GRAVITY.moon,
    extent: { west: -half, east: half, south: -half, north: half }, levels: m.pyramid.postingsM.map((p, level) => ({ level, postingM: p, provenance: level === world.maxLevel ? 'measured' : 'measured-area-average' })),
    tiles: src, field, context, datum: Math.round(fieldRange(field).min), sun, sunNote: `${rec.engine}; epoch ${rec.epochUtc}, ${(rec.duration / 86400).toFixed(1)} d at ${rec.step} s steps, frame ${rec.frame}.`,
    imagery: false, objects: world.objects.filter(o => o.type === 'crater' || o.type === 'anomaly').map(o => ({ id: o.id, kind: o.type as 'crater' | 'anomaly', x: o.x, y: o.y, radiusM: o.radius, confidence: o.confidence, evidence: o.type === 'crater' ? 'model-detected' as const : 'computational-hypothesis' as const })),
    provenance: { product: m.source.product, url: m.source.url, citation: m.source.citation, nativePostingM: m.source.nativePostingM, verticalDatum: m.referenceFrame.verticalDatum, crs: m.referenceFrame.mapProjection, sha256: m.source.sha256,
      method: `${m.pyramid.method} Analysis grid: ${posting} m native posts over the ${(e - w) / 1000} km operational box; the 20 m horizon grid (${(g.width * g.cell) / 1000} km) is the shadow occluder.`, delivery: 'packaged', license: 'NASA PGDA public data' },
    limitations: m.missingData, discoveryWindow: null,
  };
}

/** Packaged sites available to this build. */
export async function listSites(baseUrl: string, signal?: AbortSignal): Promise<SiteRef[]> {
  const out: SiteRef[] = [];
  const index = await json<{ sites: { dir: string }[] }>(`${baseUrl}world/index.json`, signal).catch(() => ({ sites: [] }));
  await Promise.all(index.sites.map(async s => {
    try {
      const m = validateManifest(await json(`${baseUrl}world/${s.dir}/manifest.json`, signal));
      out.push({ key: s.dir, id: m.site.id, name: m.site.name, body: m.site.body, lat: m.site.lat, lon: m.site.lon, format: 'scene', discoveryWindow: (m as SceneManifest & { discovery_window?: string }).discovery_window ?? null, postingM: m.levels[m.levels.length - 1].posting_m, extentM: m.extent.east - m.extent.west });
    } catch { /* a broken package is reported when opened, not hidden here */ }
  }));
  try {
    const raw = await fetch(`${baseUrl}world/moon-mons-mouton/manifest.json`, { signal });
    if (raw.ok) {
      const { gunzip } = await import('../../world/core/codec');
      const m = JSON.parse(new TextDecoder().decode(await gunzip(await raw.arrayBuffer())));
      if (m.schema === 'egiz.world_manifest') out.push({ key: 'moon-mons-mouton', id: m.siteId, name: m.name, body: 'moon', lat: m.referenceFrame.originLonLat[1], lon: m.referenceFrame.originLonLat[0], format: 'pyramid', discoveryWindow: null, postingM: m.source.nativePostingM, extentM: m.pyramid.footprintM });
    }
  } catch (e) { if (signal?.aborted) throw e; }
  const order: Body[] = ['moon', 'mars', 'earth'];
  return out.sort((a, b) => order.indexOf(a.body) - order.indexOf(b.body) || a.name.localeCompare(b.name));
}

export function loadSite(ref: Pick<SiteRef, 'key' | 'format'>, baseUrl: string, signal?: AbortSignal, onProgress?: (done: number, total: number) => void): Promise<Site> {
  const base = `${baseUrl}world/${ref.key}/`;
  return ref.format === 'pyramid' ? loadMoonSite(ref.key, base, signal, onProgress) : loadSceneSite(ref.key, base, signal);
}
