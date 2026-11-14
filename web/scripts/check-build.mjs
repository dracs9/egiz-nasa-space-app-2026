// Regression check for MapLibre's separately distributed module worker.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const assets = fileURLToPath(new URL('../dist/assets/', import.meta.url));
const names = await readdir(assets);
const worker = names.find(name => /^maplibre-gl-worker-.+\.mjs$/.test(name));
if (!worker) throw new Error('Production build is missing the MapLibre module worker. GeoJSON map layers will fail.');
const code = await readFile(path.join(assets, worker), 'utf8');
if (/^\s*<!doctype|^\s*<html/i.test(code) || !code.includes('self')) throw new Error('MapLibre worker asset is not executable worker JavaScript.');
const chunks = await Promise.all(names.filter(name => name.endsWith('.js')).map(name => readFile(path.join(assets, name), 'utf8')));
if (!chunks.some(chunk => chunk.includes(worker))) throw new Error('Production client does not reference its emitted MapLibre worker.');
console.log(`Egiz: verified same-origin map worker ${worker}.`);
const dataRoot = fileURLToPath(new URL('../dist/data/', import.meta.url));
const catalog = JSON.parse(await readFile(path.join(dataRoot, 'datasets.json'), 'utf8'));
if (catalog.default !== (catalog.modes?.includes('pilot') ? 'pilot' : 'demo') || !Array.isArray(catalog.modes) || !catalog.modes.includes('demo')) throw new Error('Explicit dataset catalog with measured-first default is missing.');
for (const mode of catalog.modes) {
  if (!['demo', 'pilot', 'observed'].includes(mode)) throw new Error('Unknown packaged data mode.');
  for (const name of ['earth_candidates', 'targets', 'mission_templates', 'sun_windows', 'results', 'validation']) {
    const document = JSON.parse(await readFile(path.join(dataRoot, mode, `${name}.json`), 'utf8'));
    if (document.synthetic !== (mode === 'demo')) throw new Error(`Incorrect source flag in ${mode}/${name}.json`);
  }
}
console.log(`Egiz: verified separated dataset modes: ${catalog.modes.join(', ')}.`);

const missionWorker = names.find(name => /^mission\.worker-.+\.js$/.test(name));
if (!missionWorker || !chunks.some(chunk => chunk.includes(missionWorker))) throw new Error('Mission Lab is missing its emitted worker reference.');
if (catalog.modes.includes('pilot')) {
  const terrain = JSON.parse(await readFile(path.join(dataRoot, 'pilot/mission_terrain.json'), 'utf8'));
  if (terrain.schema !== 'egiz.mission_terrain' || terrain.synthetic !== false || terrain.entries.length !== 11) throw new Error('Measured Mission Lab terrain was not packaged.');
}
console.log(`Egiz: verified Mission Lab worker ${missionWorker} and measured terrain.`);
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const mct = await readFile(path.join(dist, 'vendor/openmct/openmct.js'), 'utf8');
if (!mct.includes('openmct') || !(await readFile(path.join(dist,'vendor/openmct/openmct.css'),'utf8')).length) throw new Error('Official Open MCT distribution is missing.');
for (const asset of ['control.html','vendor/openmct/LICENSE.md','vendor/openmct/copyright-notice.html']) await readFile(path.join(dist,asset));
if (!names.some(n=>/^control-.+\.js$/.test(n))) throw new Error('Open MCT adapter is missing.');
const geometry = JSON.parse(await readFile(path.join(dataRoot,'pilot/spice_geometry.json'),'utf8'));
if (geometry.schema !== 'egiz.spice_catalog' || geometry.entries.length !== 11 || !geometry.entries.every(g=>g.engine.includes('CSPICE')&&g.kernels.length===(g.body==='moon'?5:3))) throw new Error('Recorded genuine CSPICE catalog is missing.');
console.log('Egiz: verified packaged Open MCT runtime, adapter, licenses and 11-site CSPICE catalog.');
// Native records and measured geometric LOD are required parts of this increment.
const { createHash } = await import('node:crypto');
const native = JSON.parse(await readFile(path.join(dist,'dynamics/references.json'),'utf8'));
if(native.schema!=='egiz.dynamics_catalog'||native.runs?.length!==4||!native.runs.every(r=>r.schema==='egiz.dynamics_experiment'&&r.fidelity==='RESEARCH'&&r.states.length>100&&/^(MuJoCo|Basilisk) /.test(r.engine)))throw Error('Authentic native reference catalog is missing or malformed');
for(const r of native.runs.filter(r=>r.request.kind==='rover'))if(createHash('sha256').update(r.modelXml).digest('hex')!==r.modelSha256)throw Error('Packaged native model fingerprint changed');
const atlas=JSON.parse(await readFile(path.join(dist,'terrain/moon-mouton/manifest.json'),'utf8'));
if(atlas.synthetic!==false||atlas.tiles.length!==21||atlas.sourcePostingM!==5||atlas.sourceSha256!==atlas.site.source.sha256)throw Error('Measured mesh atlas provenance is missing');
for(const tile of atlas.tiles){const bytes=await readFile(path.join(dist,`terrain/moon-mouton/${tile.key}.json`));if(createHash('sha256').update(bytes).digest('hex')!==tile.sha256)throw Error(`Measured mesh fingerprint changed: ${tile.key}`);}
const robustWorker=names.find(name=>/^robust\.worker-.+\.js$/.test(name));if(!robustWorker||!chunks.some(c=>c.includes(robustWorker)))throw Error('Robust experiment worker missing');
console.log('Egiz: verified 4 native executions, model fingerprints, 21 measured mesh tiles and robust worker.');
for (const body of ['moon', 'mars']) for (const suffix of ['', '-768']) {
  const bytes = await readFile(path.join(dist, `artwork/${body}-destination${suffix}.jpg`));
  if (bytes.length < 10000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw Error(`Destination artwork is missing or invalid: ${body}${suffix}`);
}
console.log('Egiz: verified responsive Moon and Mars destination artwork.');
const modelCredits=JSON.parse(await readFile(path.join(dist,'models/credits.json'),'utf8'));
let modelCount=0;
for(const [file,credit]of Object.entries(modelCredits).filter(([name])=>name.endsWith('.glb'))){
  const model=await readFile(path.join(dist,'models',file));
  if(model.readUInt32LE(0)!==0x46546c67||model.readUInt32LE(4)!==2||model.readUInt32LE(8)!==model.length||model.length!==credit.bytes||createHash('sha256').update(model).digest('hex')!==credit.sha256)throw Error(`NASA reference fingerprint changed: ${file}`);
  const gltf=JSON.parse(model.subarray(20,20+model.readUInt32LE(12)).toString());
  if(gltf.meshes.length!==credit.meshes||(gltf.images?.length??0)!==credit.images||gltf.images?.some(image=>image.uri)||gltf.buffers?.some(buffer=>buffer.uri)||!credit.source.startsWith('https://science.nasa.gov/3d-resources/'))throw Error(`NASA reference geometry, source or embedded assets missing: ${file}`);
  modelCount++;
}
if(modelCount!==6)throw Error('NASA equipment catalog is incomplete');
for(const asset of ['vendor/draco/draco_decoder.js','vendor/draco/LICENSE.txt'])if(!(await readFile(path.join(dist,asset))).length)throw Error(`Missing Draco asset: ${asset}`);
if(!names.some(n=>/^ModelInspector-.+\.js$/.test(n)))throw Error('Equipment studio is not emitted as a lazy module');
console.log('Egiz: verified 6 original NASA GLBs, embedded assets, fingerprints, local Draco decoder and credits.');
