// EGIZ Planetary Studio · on-demand Earth terrain.
// Any Earth coordinate (every discovery candidate) can be opened in 3D by streaming real elevation from the
// public "Terrain Tiles" open dataset on AWS (Mapzen terrarium PNG: elevation = R·256 + G + B/256 − 32768 m).
// The tiles are Web-Mercator; each analysis post is located by inverse azimuthal-equidistant projection and
// sampled bilinearly, so the resulting grid is in the same local metric frame as every packaged site.
// This is measured data of mixed lineage (SRTM, GMTED2010, national DEMs, ETOPO1 — see attribution), delivered
// at request time: it is labelled "streamed", its bytes are hashed, and it needs a network connection.
import { localToLatLon, type WorldManifest } from '../../astral/world/core';
import type { Field } from '../../astral/world/field';
import { fieldSource, GRAVITY, type Site } from './site';
import { analyticEarthRecord } from './solar';

export const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
export const TERRARIUM_ATTRIBUTION = 'Terrain Tiles (Mapzen / Tilezen, hosted by AWS Open Data): SRTM, GMTED2010, NED/3DEP, ETOPO1 and national sources. https://github.com/tilezen/joerd/blob/master/docs/attribution.md';
const EARTH_R = 6371008.8, TILE = 256;
export type TileFetcher = (z: number, x: number, y: number, signal?: AbortSignal) => Promise<Float32Array>;

export const mercatorPixel = (lat: number, lon: number, z: number) => {
  const n = TILE * 2 ** z, s = Math.sin((lat * Math.PI) / 180);
  return { px: ((lon + 180) / 360) * n, py: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
};
/** Zoom whose ground resolution at this latitude is at or finer than the requested posting (capped at 13). */
export const zoomFor = (lat: number, postingM: number) => Math.max(5, Math.min(13, Math.ceil(Math.log2((156543.03392 * Math.cos((lat * Math.PI) / 180)) / postingM))));
export const decodeTerrarium = (rgba: Uint8ClampedArray | Uint8Array): Float32Array => {
  const out = new Float32Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4] * 256 + rgba[i * 4 + 1] + rgba[i * 4 + 2] / 256 - 32768;
  return out;
};
const browserTile: TileFetcher = async (z, x, y, signal) => {
  const r = await fetch(`${TERRARIUM_URL}/${z}/${x}/${y}.png`, { signal, mode: 'cors' });
  if (!r.ok) throw new Error(`Elevation tile ${z}/${x}/${y}: HTTP ${r.status}`);
  const bitmap = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = TILE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
  return decodeTerrarium(ctx.getImageData(0, 0, TILE, TILE).data);
};

export interface StreamMeta { zoom: number; groundResolutionM: number; tiles: string[]; sha256: string }
/** Build a local analysis grid centred on (lat, lon). `side − 1` must be 128·2^k so the grid forms a tile quadtree. */
export async function streamEarthField(lat: number, lon: number, o: { postingM?: number; side?: number; fetchTile?: TileFetcher; signal?: AbortSignal } = {}): Promise<{ field: Field; meta: StreamMeta }> {
  if (!(Math.abs(lat) < 84)) throw new Error('Streamed terrain is unavailable poleward of 84° (Web-Mercator tile limit).');
  const posting = o.postingM ?? 32, side = o.side ?? 513, half = ((side - 1) * posting) / 2, z = zoomFor(lat, posting), fetchTile = o.fetchTile ?? browserTile;
  const site = { lat, lon, radius_m: EARTH_R } as WorldManifest['site'], px = new Float64Array(side * side), py = new Float64Array(side * side), wanted = new Set<string>(), n = 2 ** z;
  for (let r = 0; r < side; r++) for (let c = 0; c < side; c++) {
    const ll = localToLatLon(site, -half + c * posting, half - r * posting), p = mercatorPixel(ll.lat, ll.lon, z), i = r * side + c;
    // Sample at pixel centres: pixel k covers [k, k+1).
    px[i] = p.px - 0.5; py[i] = p.py - 0.5;
    for (const dx of [0, 1]) for (const dy of [0, 1]) wanted.add(`${(((Math.floor(px[i]) + dx) >> 8) % n + n) % n}/${Math.min(n - 1, Math.max(0, (Math.floor(py[i]) + dy) >> 8))}`);
  }
  const tiles = new Map<string, Float32Array>(), keys = [...wanted].sort();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, keys.length) }, async () => { while (next < keys.length) { const k = keys[next++], [x, y] = k.split('/').map(Number); tiles.set(k, await fetchTile(z, x, y, o.signal)); } }));
  const pixel = (gx: number, gy: number) => { const x = ((gx % (n * TILE)) + n * TILE) % (n * TILE), y = Math.min(n * TILE - 1, Math.max(0, gy)); return tiles.get(`${x >> 8}/${y >> 8}`)![(y & 255) * TILE + (x & 255)]; };
  const zz = new Float32Array(side * side);
  for (let i = 0; i < zz.length; i++) {
    const x0 = Math.floor(px[i]), y0 = Math.floor(py[i]), u = px[i] - x0, v = py[i] - y0;
    zz[i] = pixel(x0, y0) * (1 - u) * (1 - v) + pixel(x0 + 1, y0) * u * (1 - v) + pixel(x0, y0 + 1) * (1 - u) * v + pixel(x0 + 1, y0 + 1) * u * v;
  }
  let sha256 = 'unavailable';
  try { const d = await crypto.subtle.digest('SHA-256', zz.buffer as ArrayBuffer); sha256 = [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join(''); } catch { /* no WebCrypto: hash stays unavailable */ }
  return { field: { side, posting, west: -half, north: half, z: zz, level: 0, provenance: 'measured' }, meta: { zoom: z, groundResolutionM: (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z, tiles: keys.map(k => `${z}/${k}`), sha256 } };
}

/** A full Site for a streamed Earth location (16.4 km window at 32 m posts). */
export async function streamEarthSite(id: string, name: string, lat: number, lon: number, o: { fetchTile?: TileFetcher; signal?: AbortSignal; epochUtc?: string } = {}): Promise<Site> {
  const { field, meta } = await streamEarthField(lat, lon, o), half = ((field.side - 1) * field.posting) / 2;
  let min = Infinity; for (const v of field.z) if (v < min) min = v;
  const epoch = o.epochUtc ?? `${new Date().toISOString().slice(0, 10)}T00:00:00Z`;
  return {
    key: `stream:${id}`, id, name, body: 'earth', lat, lon, radiusM: EARTH_R, gravity: GRAVITY.earth, extent: { west: -half, east: half, south: -half, north: half },
    levels: [128, 64, 32].map((p, level) => ({ level, postingM: p, provenance: level === 2 ? 'measured (streamed, resampled)' : 'decimated' })), tiles: fieldSource(field), field, context: null,
    datum: Math.floor(min), sun: analyticEarthRecord(id, lat, lon, epoch), sunNote: `Analytic solar ephemeris from ${epoch} (48 h, 600 s) — not CSPICE; no SPICE record is packaged for streamed sites.`, imagery: false, objects: [],
    provenance: { product: `Terrain Tiles (terrarium) zoom ${meta.zoom}, ${meta.groundResolutionM.toFixed(1)} m/px at this latitude`, url: 'https://registry.opendata.aws/terrain-tiles/', citation: TERRARIUM_ATTRIBUTION, nativePostingM: meta.groundResolutionM,
      verticalDatum: 'Mixed by source (mostly EGM96 orthometric heights)', crs: `+proj=aeqd +lat_0=${lat} +lon_0=${lon} +R=${EARTH_R} +units=m`, sha256: meta.sha256,
      method: `${meta.tiles.length} Web-Mercator tiles fetched at request time, decoded and bilinearly resampled to ${field.posting} m posts on a local azimuthal-equidistant grid. SHA-256 is of the resampled grid.`, delivery: 'streamed', license: 'Open data; source-specific terms in the attribution document' },
    limitations: ['Streamed composite DEM: lineage and true resolution vary by region (often SRTM 30 m; coarser at high latitude).', 'Surface model in places: vegetation and buildings may be included.', '32 m posting: rover-scale obstacles are not resolved.', 'Not a packaged, version-pinned product; the grid hash identifies exactly what was analysed.', 'No orthoimage, geology or soil property is attached.'],
    discoveryWindow: id,
  };
}
