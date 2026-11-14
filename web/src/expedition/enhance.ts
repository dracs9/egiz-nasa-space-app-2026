// EGIZ · enhance the globe's surface around a selected place. A window of the same equirectangular colour mosaic
// the globe already shows is cut out by latitude and longitude, upscaled ×4 by Real-ESRGAN on this device (see
// workers/enhance.worker.ts) and handed back with its exact geographic box, so the globe can lay it over the same
// spot. Results are cached per place for the session. Visual only: never an input to any calculation.
import type { EnhanceIn, EnhanceOut } from '../workers/enhance.worker';

export interface GeoBox { latMin: number; latMax: number; lonMin: number; lonMax: number }
export interface Enhanced { canvas: HTMLCanvasElement; box: GeoBox; ep: string; ms: number }
export type EnhanceStatus = { stage: 'download' | 'init' | 'run'; done: number; total: number } | { stage: 'error'; message: string } | null;

const BASE = import.meta.env.BASE_URL;
let worker: Worker | null = null, nextId = 1;
const pending = new Map<number, { resolve(v: { rgba: Uint8ClampedArray; w: number; h: number; ep: string; ms: number }): void; reject(e: Error): void; progress?: (s: EnhanceStatus) => void }>();
const results = new Map<string, Promise<Enhanced>>();
const sources = new Map<string, Promise<ImageBitmap>>();

export const enhanceSupported = () => typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof caches !== 'undefined' && !!globalThis.crypto?.subtle;
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/enhance.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<EnhanceOut>) => {
    const m = e.data, p = pending.get(m.id); if (!p) return;
    if (m.type === 'progress') p.progress?.({ stage: m.stage, done: m.done, total: m.total });
    else if (m.type === 'done') { pending.delete(m.id); p.resolve(m); }
    else { pending.delete(m.id); p.reject(new Error(m.message)); }
  };
  return worker;
}
let adapter: Promise<boolean> | null = null;
const gpuAdapter = () => (adapter ??= ((navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu?.requestAdapter().then(a => !!a).catch(() => false) ?? Promise.resolve(false)));
const source = (body: 'moon' | 'mars') => {
  if (!sources.has(body)) sources.set(body, fetch(`${BASE}textures/${body}.jpg`).then(r => (r.ok ? r.blob() : Promise.reject(new Error(`texture HTTP ${r.status}`)))).then(b => createImageBitmap(b)));
  return sources.get(body)!;
};

/** The geographic window around a place, sized in source pixels; longitude widens toward the poles (capped). */
export function windowFor(lat: number, lon: number, srcW: number, srcH: number, rows: number): { box: GeoBox; w: number; h: number } {
  const degPerPx = 180 / srcH, latSpan = rows * degPerPx, cosLat = Math.max(0.12, Math.cos((lat * Math.PI) / 180));
  const lonSpan = Math.min(120, latSpan / cosLat);
  let latMin = lat - latSpan / 2, latMax = lat + latSpan / 2;
  if (latMax > 90) { latMin -= latMax - 90; latMax = 90; } if (latMin < -90) { latMax += -90 - latMin; latMin = -90; }
  const srcCols = Math.round((lonSpan / 360) * srcW), w = Math.min(srcCols, rows * 2);
  return { box: { latMin, latMax, lonMin: lon - lonSpan / 2, lonMax: lon + lonSpan / 2 }, w, h: rows };
}

/** Enhance the window around (lat, lon) on `body`. Rows of source pixels: more on WebGPU-capable devices. */
export function enhancePlace(body: 'moon' | 'mars', lat: number, lon: number, progress?: (s: EnhanceStatus) => void): Promise<Enhanced> {
  const key = `${body}:${lat.toFixed(3)}:${lon.toFixed(3)}`;
  if (!results.has(key)) {
    const p = (async () => {
      // A real GPU adapter gets a 4× larger window (WebGPU); WASM-only devices get a lighter one.
      const rows = (await gpuAdapter()) ? 128 : 64, img = await source(body), { box, w, h } = windowFor(lat, lon, img.width, img.height, rows);
      // Cut the window (wrapping across ±180°) into a w×h canvas.
      const c = new OffscreenCanvas(w, h), g = c.getContext('2d')!, x0 = ((box.lonMin + 180) / 360) * img.width, x1 = ((box.lonMax + 180) / 360) * img.width;
      const y0 = ((90 - box.latMax) / 180) * img.height, sh = ((box.latMax - box.latMin) / 180) * img.height, sx = w / (x1 - x0);
      for (const shift of [-img.width, 0, img.width]) { const a = Math.max(x0, shift), b = Math.min(x1, shift + img.width); if (b > a) g.drawImage(img, a - shift, y0, b - a, sh, (a - x0) * sx, 0, (b - a) * sx, h); }
      const rgba = g.getImageData(0, 0, w, h).data, id = nextId++;
      const out = await new Promise<{ rgba: Uint8ClampedArray; w: number; h: number; ep: string; ms: number }>((resolve, reject) => {
        pending.set(id, { resolve, reject, progress });
        const msg: EnhanceIn = { type: 'upscale', id, rgba, w, h, ortBase: new URL(`${BASE}vendor/ort/`, window.location.href).href, feather: 0.12 };
        getWorker().postMessage(msg, [rgba.buffer]);
      });
      const canvas = document.createElement('canvas'); canvas.width = out.w; canvas.height = out.h;
      canvas.getContext('2d')!.putImageData(new ImageData(out.rgba as Uint8ClampedArray<ArrayBuffer>, out.w, out.h), 0, 0);
      return { canvas, box, ep: out.ep, ms: out.ms };
    })();
    p.catch(() => results.delete(key));
    results.set(key, p);
  } else if (progress) progress(null);
  return results.get(key)!;
}
