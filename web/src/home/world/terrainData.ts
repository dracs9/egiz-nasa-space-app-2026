// Measured terrain for the landing world. Everything here is read from packaged NASA / Copernicus
// derived grids; nothing is invented. Missing products degrade to a smaller stage, never to fake data.
// AI-assisted implementation; human review pending.

export const WORLD_KEYS = ['moon', 'mars', 'earthMoon', 'earthMars'] as const;
export type WorldKey = typeof WORLD_KEYS[number];

export interface StageWorld { id: string; name: string; body: 'moon' | 'mars' | 'earth'; center: number; min: number; max: number; peak: [number, number, number] }
export interface HiRes { side: number; size: number; data: Float32Array; offset: number }
export interface StageData {
  side: number; cell: number; half: number;          // 100 posts, 200 m, ±9 900 m
  grids: Float32Array[];                             // four worlds, metres relative to each centre
  worlds: Record<WorldKey, StageWorld>;
  hiMoon: HiRes | null; hiMars: HiRes | null;
  marsAlbedo: HTMLCanvasElement | null;
}

interface TerrainEntry { id: string; name: string; body: 'moon' | 'mars' | 'earth'; grid: { side: number; cell_m: number; west_m: number; north_m: number; elevation_m: (number | null)[] } }

const base = () => (import.meta.env?.BASE_URL ?? '/');

function fillNulls(values: (number | null)[], side: number): Float32Array {
  const out = new Float32Array(side * side); const known = new Uint8Array(side * side);
  values.forEach((v, i) => { if (v != null && Number.isFinite(v)) { out[i] = v; known[i] = 1; } });
  // Grow known values into gaps (a few passes is enough for the small nodata corners in these grids).
  for (let pass = 0; pass < 64; pass++) {
    let changed = false;
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      const i = y * side + x; if (known[i]) continue;
      let sum = 0, n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= side || yy >= side) continue;
        const j = yy * side + xx; if (known[j] === 1) { sum += out[j]; n++; }
      }
      if (n) { out[i] = sum / n; known[i] = 2; changed = true; }
    }
    for (let i = 0; i < known.length; i++) if (known[i] === 2) known[i] = 1;
    if (!changed) break;
  }
  return out;
}

/** Bilinear sample of a north-up grid whose post (0,0) sits at (-half, -half) in x/z (z = south). */
export function sampleGrid(grid: Float32Array, side: number, half: number, x: number, z: number) {
  const span = half * 2; const fx = Math.min(side - 1.001, Math.max(0, ((x + half) / span) * (side - 1)));
  const fz = Math.min(side - 1.001, Math.max(0, ((z + half) / span) * (side - 1)));
  const x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0;
  const i = z0 * side + x0;
  const a = grid[i], b = grid[i + 1], c = grid[i + side], d = grid[i + side + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

async function json<T>(path: string, signal?: AbortSignal): Promise<T | null> {
  try { const r = await fetch(`${base()}${path}`, { signal }); if (!r.ok) return null; return await r.json() as T; } catch { return null; }
}

async function loadHiMoon(signal?: AbortSignal): Promise<{ side: number; size: number; data: Float32Array } | null> {
  const side = 401, size = 4000, data = new Float32Array(side * side);
  const keys: string[] = []; for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) keys.push(`2-${c}-${r}`);
  const tiles = await Promise.all(keys.map(k => json<{ side: number; west: number; north: number; size: number; elevations: number[] }>(`terrain/moon-mouton/${k}.json`, signal)));
  if (tiles.some(t => !t)) return null;
  for (const t of tiles) {
    const ox = Math.round((t!.west + 2000) / 10), oy = Math.round((2000 - t!.north) / 10);
    for (let i = 0; i < t!.side; i++) for (let j = 0; j < t!.side; j++) {
      const gx = ox + j, gy = oy + i; if (gx >= side || gy >= side) continue;
      data[gy * side + gx] = t!.elevations[i * t!.side + j];
    }
  }
  return { side, size, data };
}

async function loadHiMars(signal?: AbortSignal): Promise<{ hi: { side: number; size: number; data: Float32Array }; albedo: HTMLCanvasElement | null } | null> {
  const manifest = await json<{ encoding: { posts: number; apron: number; side: number; scale_m: number; offset_m: number; nodata: number; image_px: number }; tiles: { key: string; level: number; west: number; north: number; size: number }[] }>('world/mars-jezero/manifest.json', signal);
  if (!manifest) return null;
  const enc = manifest.encoding; const tiles = manifest.tiles.filter(t => t.level === 1);
  if (tiles.length !== 4) return null;
  const posts = enc.posts, side = posts * 2, size = 2048, data = new Float32Array(side * side).fill(NaN);
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const ctx = canvas?.getContext('2d') ?? null; if (canvas) { canvas.width = canvas.height = enc.image_px * 2; }
  await Promise.all(tiles.map(async t => {
    try {
      const r = await fetch(`${base()}world/mars-jezero/h/${t.key}.bin`, { signal }); if (!r.ok) return;
      const raw = new Int16Array(await r.arrayBuffer());
      const ox = Math.round((t.west + 1024) / t.size) * posts, oy = Math.round((1024 - t.north) / t.size) * posts;
      for (let i = 0; i < posts; i++) for (let j = 0; j < posts; j++) {
        const v = raw[(i + enc.apron) * enc.side + (j + enc.apron)];
        data[(oy + i) * side + ox + j] = v === enc.nodata ? NaN : v * enc.scale_m + enc.offset_m;
      }
      if (ctx) {
        const img = new Image();
        await new Promise<void>(resolve => { const done = () => resolve(); img.onload = done; img.onerror = done; setTimeout(done, 5000); img.src = `${base()}world/mars-jezero/img/${t.key}.jpg`; });
        if (img.naturalWidth) ctx.drawImage(img, Math.round((t.west + 1024) / t.size) * enc.image_px, Math.round((1024 - t.north) / t.size) * enc.image_px, enc.image_px, enc.image_px);
      }
    } catch { /* missing tile: stage keeps the regional grid there */ }
  }));
  let mean = 0, n = 0; for (const v of data) if (Number.isFinite(v)) { mean += v; n++; }
  if (n < data.length * .5) return null;
  mean /= n; for (let i = 0; i < data.length; i++) if (!Number.isFinite(data[i])) data[i] = mean;
  return { hi: { side, size, data }, albedo: ctx ? canvas : null };
}

/** Hi-res heights are aligned to the regional grid by their mean difference (datum or averaging offsets). */
function align(hi: { side: number; size: number; data: Float32Array }, grid: Float32Array, side: number, half: number, center: number): HiRes {
  let diff = 0, n = 0; const step = Math.max(1, Math.floor(hi.side / 40));
  for (let y = 0; y < hi.side; y += step) for (let x = 0; x < hi.side; x += step) {
    const wx = (x / (hi.side - 1) - .5) * hi.size, wz = (y / (hi.side - 1) - .5) * hi.size;
    diff += hi.data[y * hi.side + x] - (sampleGrid(grid, side, half, wx, wz) + center); n++;
  }
  return { ...hi, offset: diff / n };
}

export async function loadStage(analogues: { moon?: string; mars?: string }, signal?: AbortSignal): Promise<StageData | null> {
  const terrain = await json<{ entries: TerrainEntry[] }>('data/pilot/mission_terrain.json', signal);
  if (!terrain) return null;
  const byId = (id?: string) => terrain.entries.find(e => e.id === id);
  const moon = terrain.entries.find(e => e.body === 'moon'), mars = terrain.entries.find(e => e.body === 'mars');
  const earthMoon = byId(analogues.moon) ?? byId('GL_W116.820_N36.240') ?? terrain.entries.find(e => e.body === 'earth');
  const earthMars = byId(analogues.mars) ?? byId('PILOT_ICELAND') ?? terrain.entries.find(e => e.body === 'earth');
  if (!moon || !mars || !earthMoon || !earthMars) return null;
  const entries = [moon, mars, earthMoon, earthMars];
  const side = moon.grid.side, cell = moon.grid.cell_m, half = (side - 1) * cell / 2;
  const grids: Float32Array[] = []; const worlds = {} as Record<WorldKey, StageWorld>;
  entries.forEach((e, k) => {
    const g = fillNulls(e.grid.elevation_m, side);
    const center = sampleGrid(g, side, half, 0, 0);
    let min = Infinity, max = -Infinity, peak: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < g.length; i++) {
      const v = g[i]; if (v < min) min = v;
      if (v > max) { max = v; const x = i % side, y = Math.floor(i / side); peak = [x * cell - half, v - center, y * cell - half]; }
    }
    for (let i = 0; i < g.length; i++) g[i] -= center;
    grids.push(g);
    worlds[WORLD_KEYS[k]] = { id: e.id, name: e.name, body: e.body, center, min, max, peak };
  });
  const [hiMoonRaw, hiMarsRaw] = await Promise.all([loadHiMoon(signal), loadHiMars(signal)]);
  return {
    side, cell, half, grids, worlds,
    hiMoon: hiMoonRaw ? align(hiMoonRaw, grids[0], side, half, worlds.moon.center) : null,
    hiMars: hiMarsRaw ? align(hiMarsRaw.hi, grids[1], side, half, worlds.mars.center) : null,
    marsAlbedo: hiMarsRaw?.albedo ?? null,
  };
}
