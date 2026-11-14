// Decoders for the EGT1 (quantized elevation) and EGR1 (uint8 class) binaries
// produced by pipeline/world/codec.py. Input is the gunzipped byte buffer.

export interface DecodedGrid { width: number; height: number; offset: number; scale: number; values: Float32Array }
export interface DecodedClasses { width: number; height: number; values: Uint8Array }
const HEADER = 24;

function header(bytes: Uint8Array, magic: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const m = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (m !== magic) throw new Error(`Expected ${magic} binary, found ${JSON.stringify(m)}`);
  return { width: view.getUint16(4, true), height: view.getUint16(6, true), offset: view.getFloat64(8, true), scale: view.getFloat64(16, true) };
}

export function decodeElevation(bytes: Uint8Array): DecodedGrid {
  const h = header(bytes, 'EGT1');
  const n = h.width * h.height;
  if (bytes.byteLength < HEADER + 2 * n) throw new Error('Truncated EGT1 tile');
  const lo = bytes.subarray(HEADER, HEADER + n), hi = bytes.subarray(HEADER + n, HEADER + 2 * n);
  const q = new Uint16Array(n);
  for (let r = 0; r < h.height; r++) {
    const s = r * h.width;
    q[s] = ((lo[s] | (hi[s] << 8)) + (r ? q[s - h.width] : 0)) & 0xffff;
    for (let c = 1; c < h.width; c++) q[s + c] = (q[s + c - 1] + (lo[s + c] | (hi[s + c] << 8))) & 0xffff;
  }
  const values = new Float32Array(n);
  for (let i = 0; i < n; i++) values[i] = q[i] === 65535 ? NaN : h.offset + q[i] * h.scale;
  return { ...h, values };
}

export function decodeClasses(bytes: Uint8Array): DecodedClasses {
  const h = header(bytes, 'EGR1');
  const n = h.width * h.height;
  if (bytes.byteLength < HEADER + n) throw new Error('Truncated EGR1 raster');
  return { width: h.width, height: h.height, values: bytes.slice(HEADER, HEADER + n) };
}

export async function gunzip(buffer: ArrayBuffer): Promise<Uint8Array> {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes; // already decompressed by the transport
  const stream = new Response(bytes as BufferSource).body!.pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
