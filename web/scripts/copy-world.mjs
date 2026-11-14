// Package measured world tiles (EGIZ ASTRAL). Every tile is re-hashed against its manifest;
// a mismatch aborts the build instead of shipping terrain that differs from its provenance record.
import { readFile, mkdir, readdir, rm, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export async function copyWorlds(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')) {
  const source = path.join(root, 'data/world'), destination = path.join(root, 'web/public/world');
  // Only egiz.world_scene packages are (re)packaged here. Other world formats in data/world
  // (e.g. the ASTRAL lunar pyramid, copied verbatim by copy-data.mjs) are left untouched.
  await mkdir(destination, { recursive: true });
  const sites = [];
  for (const dir of (await readdir(source, { withFileTypes: true }).catch(() => [])).filter(d => d.isDirectory()).map(d => d.name).sort()) {
    const text = await readFile(path.join(source, dir, 'manifest.json'), 'utf8').catch(() => null);
    if (!text) continue;
    const manifest = JSON.parse(text);
    if (manifest.schema !== 'egiz.world_scene') continue;
    if (manifest.synthetic !== false) throw new Error(`World ${dir}: not a measured world package.`);
    await rm(path.join(destination, dir), { recursive: true, force: true });
    await mkdir(path.join(destination, dir, 'h'), { recursive: true });
    await mkdir(path.join(destination, dir, 'img'), { recursive: true });
    for (const tile of manifest.tiles) {
      for (const [folder, ext, hash] of [['h', 'bin', tile.height_sha256], ['img', 'jpg', tile.image_sha256]]) {
        if (!hash) continue;
        const file = path.join(source, dir, folder, `${tile.key}.${ext}`), bytes = await readFile(file);
        if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error(`World ${dir}: tile ${folder}/${tile.key} differs from its manifest fingerprint.`);
        await copyFile(file, path.join(destination, dir, folder, `${tile.key}.${ext}`));
      }
    }
    await writeFile(path.join(destination, dir, 'manifest.json'), text);
    await copyFile(path.join(source, dir, 'illumination.json'), path.join(destination, dir, 'illumination.json')).catch(() => {});
    sites.push({ dir, id: manifest.site.id, name: manifest.site.name, body: manifest.site.body, tiles: manifest.tiles.length });
    console.log(`Egiz: packaged measured world ${dir} (${manifest.tiles.length} verified tiles).`);
  }
  await writeFile(path.join(destination, 'index.json'), `${JSON.stringify({ schema: 'egiz.world_index', version: '1.0.0', sites }, null, 2)}\n`);
  if (!sites.length) console.log('Egiz: no world package in data/world; Mission Studio will report it as not built.');
  return sites;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await copyWorlds();
