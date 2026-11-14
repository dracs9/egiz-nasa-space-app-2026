// Written with AI assistance (Codex); human review pending.
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { copyDatasets } from './copy-data.mjs';

const required = ['earth_candidates', 'targets', 'mission_templates', 'sun_windows', 'results', 'validation'];
const temporary: string[] = [];
async function sandbox() {
  const directory = await mkdtemp(path.join(tmpdir(), 'egiz-mode-packaging-')); temporary.push(directory);
  for (const mode of ['fixtures', 'pilot']) {
    await mkdir(path.join(directory, 'data', mode), { recursive: true });
    for (const name of required) await copyFile(path.resolve('..', 'data', mode, `${name}.json`), path.join(directory, 'data', mode, `${name}.json`));
  }
  return directory;
}
afterEach(async () => { for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true }); });

it('packages measured and synthetic bundles in separate paths with an explicit catalog and measured-first default', async () => {
  const directory = await sandbox(); expect(await copyDatasets(directory)).toEqual(['demo', 'pilot']);
  const root = path.join(directory, 'web/public/data');
  const catalog = JSON.parse(await readFile(path.join(root, 'datasets.json'), 'utf8'));
  expect(catalog).toEqual({ version: '1.0.0', default: 'pilot', modes: ['demo', 'pilot'] });
  for (const name of required) {
    expect(JSON.parse(await readFile(path.join(root, 'demo', `${name}.json`), 'utf8')).synthetic).toBe(true);
    expect(JSON.parse(await readFile(path.join(root, 'pilot', `${name}.json`), 'utf8')).synthetic).toBe(false);
    expect(JSON.parse(await readFile(path.join(root, `${name}.json`), 'utf8')).synthetic).toBe(true);
  }
});

it('refuses incomplete or stale measured sources before publishing a replacement catalog', async () => {
  const directory = await sandbox();
  await rm(path.join(directory, 'data/pilot/validation.json'));
  await expect(copyDatasets(directory)).rejects.toThrow('pilot dataset is incomplete');
  await expect(readFile(path.join(directory, 'web/public/data/datasets.json'))).rejects.toThrow();
});

it('does not silently replace demo when complete processed observations become available', async () => {
  const directory = await sandbox();
  await mkdir(path.join(directory, 'data/processed'));
  for (const name of required) await copyFile(path.join(directory, 'data/pilot', `${name}.json`), path.join(directory, 'data/processed', `${name}.json`));
  expect(await copyDatasets(directory)).toEqual(['demo', 'pilot', 'observed']);
  const root = path.join(directory, 'web/public/data');
  expect(JSON.parse(await readFile(path.join(root, 'observed/targets.json'), 'utf8')).synthetic).toBe(false);
  expect(JSON.parse(await readFile(path.join(root, 'targets.json'), 'utf8')).synthetic).toBe(true);
  await writeFile(path.join(directory, 'data/processed/targets.json'), '{"corrupt":true}');
  await expect(copyDatasets(directory)).rejects.toThrow('observed dataset is incomplete');
});

it('rejects hidden synthetic references in an observed results envelope with correct input hashes', async () => {
  const directory = await sandbox(); const file = path.join(directory, 'data/pilot/results.json');
  const results = JSON.parse(await readFile(file, 'utf8'));
  const run = results.runs[0]; const objective = Object.keys(run.fidelity)[0];
  run.fidelity[objective].FAKE_UNFLAGGED_TILE = { F: 1, partial: false };
  await writeFile(file, JSON.stringify(results));
  await expect(copyDatasets(directory)).rejects.toThrow('pilot dataset is incomplete');
});
