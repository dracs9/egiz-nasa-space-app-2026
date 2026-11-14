// Written with AI assistance (Codex); human review pending.
import { readFile, mkdir, copyFile, readdir, rm, writeFile, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const required = ['earth_candidates', 'targets', 'mission_templates', 'sun_windows', 'results', 'validation'];
function containsSyntheticReference(value) {
  if (typeof value === 'string') return value.startsWith('FAKE_');
  if (Array.isArray(value)) return value.some(containsSyntheticReference);
  if (value && typeof value === 'object') return Object.entries(value).some(([key, child]) => key.startsWith('FAKE_') || containsSyntheticReference(child));
  return false;
}
async function complete(directory, expectedSynthetic) {
  try {
    const documents = {};
    const bytes = {};
    for (const name of required) {
      const text = await readFile(path.join(directory, `${name}.json`), 'utf8');
      const data = JSON.parse(text);
      if (data.schema !== `egiz.${name}` || !/^1\.\d+\.\d+$/.test(data.version) || data.synthetic !== expectedSynthetic || !Number.isFinite(Date.parse(data.generated_at)) || !Array.isArray(data.provenance) || !data.provenance.length) return false;
      if (!expectedSynthetic && containsSyntheticReference(data)) return false;
      documents[name] = data; bytes[name] = text;
    }
    for (const name of ['earth_candidates', 'targets', 'mission_templates', 'sun_windows']) {
      const key = `${name === 'mission_templates' ? 'templates' : name}_sha256`;
      if (documents.results.inputs?.[key] !== createHash('sha256').update(bytes[name]).digest('hex')) return false;
    }
    return true;
  } catch { return false; }
}
export async function copyDatasets(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')) {
  const destination = path.join(root, 'web/public/data');
  const sources = { demo: path.join(root, 'data/fixtures'), pilot: path.join(root, 'data/pilot'), observed: path.join(root, 'data/processed') };
  const modes = [];
  for (const mode of ['demo', 'pilot', 'observed']) {
    const source = sources[mode];
    const present = (await readdir(source).catch(() => [])).some(file => required.some(name => file === `${name}.json`));
    const valid = await complete(source, mode === 'demo');
    if ((present || mode === 'demo') && !valid) {
      throw new Error(`${mode} dataset is incomplete, stale, invalid, or has incorrect synthetic flags. Refusing to mix or substitute datasets. Rebuild and validate ${path.relative(root, source)}.`);
    }
    if (valid) modes.push(mode);
  }
  for (const mode of ['demo', 'pilot', 'observed']) {
    const target = path.join(destination, mode);
    if (!modes.includes(mode)) { await rm(target, { recursive: true, force: true }); continue; }
    await mkdir(target, { recursive: true });
    for (const name of required) await copyFile(path.join(sources[mode], `${name}.json`), path.join(target, `${name}.json`));
    const evidencePath = path.join(sources[mode], 'terrain_evidence.json');
    const evidence = await readFile(evidencePath, 'utf8').catch(() => null);
    if (evidence) {
      const doc = JSON.parse(evidence);
      const results = JSON.parse(await readFile(path.join(sources[mode], 'results.json'), 'utf8'));
      if (doc.synthetic !== false || mode === 'demo' || ['earth_candidates_sha256', 'targets_sha256'].some(key => doc.inputs?.[key] !== results.inputs[key])) throw new Error(`${mode} terrain evidence is stale or synthetic.`);
      await copyFile(evidencePath, path.join(target, 'terrain_evidence.json'));
    } else await rm(path.join(target, 'terrain_evidence.json'), { force: true });
    const missionPath = path.join(sources[mode], 'mission_terrain.json');
    const mission = await readFile(missionPath, 'utf8').catch(() => null);
    if (mission) {
      const doc = JSON.parse(mission);
      const results = JSON.parse(await readFile(path.join(sources[mode], 'results.json'), 'utf8'));
      if (doc.schema !== 'egiz.mission_terrain' || doc.version !== '1.0.0' || doc.synthetic !== false || mode === 'demo' || ['earth_candidates_sha256', 'targets_sha256'].some(key => doc.inputs?.[key] !== results.inputs[key])) throw new Error(`${mode} mission terrain is stale or synthetic.`);
      await copyFile(missionPath, path.join(target, 'mission_terrain.json'));
    } else await rm(path.join(target, 'mission_terrain.json'), { force: true });
    const geometryPath = path.join(sources[mode], 'spice_geometry.json');
    const geometry = await readFile(geometryPath, 'utf8').catch(() => null);
    if (geometry && mode !== 'demo') {
      const doc = JSON.parse(geometry);
      if (doc.schema !== 'egiz.spice_catalog' || doc.version !== '1.0.0' || !doc.entries?.length) throw new Error('Invalid SPICE catalog.');
      await copyFile(geometryPath, path.join(target, 'spice_geometry.json'));
    } else await rm(path.join(target, 'spice_geometry.json'), { force: true });
    // ATLAS-Pi transferability bundle (optional, measured modes only). Refuse stale bundles:
    // its recorded input hashes must match the files packaged for this mode.
    const atlasPath = path.join(sources[mode], 'atlas_pi.json');
    const atlas = mode === 'demo' ? null : await readFile(atlasPath, 'utf8').catch(() => null);
    if (atlas) {
      const doc = JSON.parse(atlas);
      const stale = [];
      for (const name of ['earth_candidates.json', 'targets.json', 'results.json', 'mission_terrain.json']) {
        const bytes = await readFile(path.join(sources[mode], name)).catch(() => null);
        if (!bytes || doc.inputs?.[name] !== createHash('sha256').update(bytes).digest('hex')) stale.push(name);
      }
      if (doc.schema !== 'egiz.atlas_pi' || !/^1\.\d+\.\d+$/.test(doc.version) || doc.synthetic !== false || stale.length) throw new Error(`${mode} ATLAS-Pi bundle is stale or invalid (${stale.join(', ') || 'schema'}). Run python -m pipeline.analog_transfer build.`);
      await copyFile(atlasPath, path.join(target, 'atlas_pi.json'));
    } else await rm(path.join(target, 'atlas_pi.json'), { force: true });
    console.log(`Egiz: packaged explicit ${mode} source (${required.length} files).`);
  }
  // Legacy direct data links remain the explicitly labelled demo. Observed data is
  // available only in its own mode directory; it never silently replaces the demo.
  await mkdir(destination, { recursive: true });
  for (const name of required) await copyFile(path.join(sources.demo, `${name}.json`), path.join(destination, `${name}.json`));
  await writeFile(path.join(destination, 'datasets.json'), `${JSON.stringify({ version: '1.0.0', default: modes.includes('pilot') ? 'pilot' : 'demo', modes }, null, 2)}\n`);

  for (const name of ['dynamics','terrain','world']) {
    const source = path.join(root,'data',name);
    if ((await readdir(source).catch(()=>[])).length) await cp(source,path.join(root,'web/public',name),{recursive:true});
  }
  // Discovery bundle (pipeline/discovery): compact index, per-target score shards and validation.
  // The CSV index stays out of the browser; the bundle carries its checksum.
  const discovery = path.join(root, 'data/discovery');
  const discoveryOut = path.join(root, 'web/public/discovery');
  await rm(discoveryOut, { recursive: true, force: true });
  const bundleText = await readFile(path.join(discovery, 'discovery.json'), 'utf8').catch(() => null);
  if (bundleText) {
    const bundle = JSON.parse(bundleText);
    if (bundle.schema !== 'egiz.discovery' || bundle.synthetic !== false) throw new Error('data/discovery/discovery.json is not a measured discovery bundle.');
    await mkdir(path.join(discoveryOut, 'scores'), { recursive: true });
    await writeFile(path.join(discoveryOut, 'discovery.json'), bundleText);
    for (const t of bundle.targets) await copyFile(path.join(discovery, t.shard), path.join(discoveryOut, t.shard));
    await copyFile(path.join(discovery, 'validation.json'), path.join(discoveryOut, 'validation.json')).catch(() => {});
    console.log(`Egiz: packaged discovery bundle (${bundle.windows.id.length} windows, ${bundle.targets.length} targets).`);
  } else console.log('Egiz: no discovery bundle in data/discovery; the Discover workspace will report it as not built.');
  return modes;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await copyDatasets(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
