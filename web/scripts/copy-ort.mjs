// Copy the ONNX Runtime Web WebGPU/WASM binaries next to the site (public/vendor/ort/), so the in-browser
// Real-ESRGAN surface enhancer loads them from the same origin. The package does not export these files, and
// pointing ONNX Runtime at a fixed folder works the same in the dev server and in the production build.
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(web, 'node_modules/onnxruntime-web/dist'), dst = path.join(web, 'public/vendor/ort');
const FILES = ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm'];
await mkdir(dst, { recursive: true });
for (const f of FILES) await copyFile(path.join(src, f), path.join(dst, f));
console.log(`Egiz: copied ONNX Runtime Web (${FILES.length} files) to public/vendor/ort.`);
