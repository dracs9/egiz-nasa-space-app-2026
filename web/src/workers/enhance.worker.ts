// EGIZ · on-device surface enhancement. Real-ESRGAN x4plus (RRDBNet, official weights exported 1:1 to ONNX,
// BSD-3-Clause) runs in this worker through ONNX Runtime Web, on WebGPU when the device has it and on WASM
// otherwise. The model is fetched once, verified against its published SHA-256 and kept in Cache Storage.
// Input and output are plain RGBA pixels; the caller decides where they go. The result is an illustration:
// detail the network adds is plausible texture, not measured terrain, and the UI labels it so.
import * as ort from 'onnxruntime-web/webgpu';

export const MODEL = {
  url: 'https://huggingface.co/SceneWorks/real-esrgan-onnx/resolve/main/real_esrgan_x4.onnx',
  sha256: '5c586662929cbc686c1a5c38d9c060dbdb4ea5863a1f7672b8c0761e6b89c033',
  cache: 'egiz-models-v1',
};
export type EnhanceIn = { type: 'upscale'; id: number; rgba: Uint8ClampedArray; w: number; h: number; ortBase: string; feather: number };
export type EnhanceOut =
  | { type: 'progress'; id: number; stage: 'download' | 'init' | 'run'; done: number; total: number }
  | { type: 'done'; id: number; rgba: Uint8ClampedArray; w: number; h: number; ep: string; ms: number }
  | { type: 'error'; id: number; message: string };

const post = (m: EnhanceOut, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');

async function modelBytes(id: number): Promise<ArrayBuffer> {
  const cache = await caches.open(MODEL.cache).catch(() => null);
  const hit = await cache?.match(MODEL.url);
  if (hit) return hit.arrayBuffer();
  const res = await fetch(MODEL.url); if (!res.ok || !res.body) throw new Error(`model download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || 67_000_000, reader = res.body.getReader(), parts: Uint8Array[] = []; let done = 0;
  for (;;) { const r = await reader.read(); if (r.done) break; parts.push(r.value); done += r.value.length; post({ type: 'progress', id, stage: 'download', done, total }); }
  const buf = new Uint8Array(done); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
  const sum = hex(await crypto.subtle.digest('SHA-256', buf));
  if (sum !== MODEL.sha256) throw new Error('the downloaded model does not match its published SHA-256; it was not used');
  await cache?.put(MODEL.url, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } })).catch(() => undefined);
  return buf.buffer;
}

let session: Promise<{ s: ort.InferenceSession; ep: string }> | null = null;
async function getSession(id: number, ortBase: string) {
  if (!session) session = (async () => {
    ort.env.wasm.wasmPaths = ortBase; ort.env.wasm.numThreads = (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    const hasGpu = !!gpu && !!(await gpu.requestAdapter().catch(() => null));
    const bytes = await modelBytes(id); post({ type: 'progress', id, stage: 'init', done: 0, total: 1 });
    try { return { s: await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: hasGpu ? ['webgpu'] : ['wasm'] }), ep: hasGpu ? 'webgpu' : 'wasm' }; }
    catch (e) { if (!hasGpu) throw e; return { s: await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'] }), ep: 'wasm' }; }
  })();
  try { return await session; } catch (e) { session = null; throw e; }
}

/** Upscale ×4 tile by tile (with overlap, so tile seams fall inside discarded margins), then feather the border alpha. */
async function upscale(m: EnhanceIn) {
  const t0 = performance.now(), { s, ep } = await getSession(m.id, m.ortBase), S = 4, tile = ep === 'webgpu' ? 128 : 64, pad = 8;
  const W = m.w * S, H = m.h * S, out = new Uint8ClampedArray(W * H * 4);
  const tiles: [number, number][] = []; for (let y = 0; y < m.h; y += tile) for (let x = 0; x < m.w; x += tile) tiles.push([x, y]);
  let n = 0;
  for (const [tx, ty] of tiles) {
    const x0 = Math.max(0, tx - pad), y0 = Math.max(0, ty - pad), x1 = Math.min(m.w, tx + tile + pad), y1 = Math.min(m.h, ty + tile + pad), w = x1 - x0, h = y1 - y0, plane = w * h;
    const input = new Float32Array(3 * plane);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((y0 + y) * m.w + x0 + x) * 4, j = y * w + x; input[j] = m.rgba[i] / 255; input[plane + j] = m.rgba[i + 1] / 255; input[2 * plane + j] = m.rgba[i + 2] / 255; }
    const feeds: Record<string, ort.Tensor> = { [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, h, w]) };
    const res = (await s.run(feeds))[s.outputNames[0]], o = res.data as Float32Array, ow = w * S, op = ow * h * S;
    // keep only the tile's own area (drop the overlap margins)
    const kx0 = (tx - x0) * S, ky0 = (ty - y0) * S, kw = Math.min(tile, m.w - tx) * S, kh = Math.min(tile, m.h - ty) * S;
    for (let y = 0; y < kh; y++) for (let x = 0; x < kw; x++) {
      const j = (ky0 + y) * ow + kx0 + x, k = ((ty * S + y) * W + tx * S + x) * 4;
      out[k] = o[j] * 255; out[k + 1] = o[op + j] * 255; out[k + 2] = o[2 * op + j] * 255; out[k + 3] = 255;
    }
    res.dispose?.(); post({ type: 'progress', id: m.id, stage: 'run', done: ++n, total: tiles.length });
  }
  // Soft edges: the patch melts into the globe instead of showing a rectangle.
  const f = Math.max(1, Math.round(Math.min(W, H) * m.feather));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const d = Math.min(x, y, W - 1 - x, H - 1 - y); if (d < f) { const t = d / f; out[(y * W + x) * 4 + 3] = 255 * t * t * (3 - 2 * t); } }
  post({ type: 'done', id: m.id, rgba: out, w: W, h: H, ep, ms: performance.now() - t0 }, [out.buffer]);
}

self.onmessage = (e: MessageEvent<EnhanceIn>) => {
  if (e.data?.type === 'upscale') upscale(e.data).catch(err => post({ type: 'error', id: e.data.id, message: err instanceof Error ? err.message : String(err) }));
};
