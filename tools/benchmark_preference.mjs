// Node 22.18+ native TypeScript stripping. Timing inputs are synthetic software workloads.
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { preferenceEnvelope, preferenceLines } from '../web/src/lib/preference.ts';
let seed = 20261017;
const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const timings = [100, 1000, 3000].map(n => {
  const lines = Array.from({ length: n }, (_, i) => ({ id: String(i).padStart(5, '0'), left: random(), right: random(), partial: false }));
  for (let i = 0; i < 10; i++) preferenceEnvelope(lines);
  const samples = Array.from({ length: 100 }, () => { const start = performance.now(); preferenceEnvelope(lines); return performance.now() - start; }).sort((a, b) => a - b);
  return { candidates: n, runs: 100, median_ms: samples[50], p95_ms: samples[95], intervals: preferenceEnvelope(lines).length };
});
const base = new URL('../data/pilot/', import.meta.url);
const read = name => JSON.parse(fs.readFileSync(new URL(`${name}.json`, base), 'utf8'));
const candidates = read('earth_candidates'), templates = read('mission_templates'), results = read('results');
const analyses = results.runs.map(run => {
  const template = templates.templates.find(t => t.id === run.template);
  const [a, b] = template.objectives;
  const lines = preferenceLines(run, candidates.tiles, a.id, b.id, 'global');
  return { target: run.target, objectives: [a.id, b.id], lines, intervals: preferenceEnvelope(lines) };
});
const report = { generated_at: new Date().toISOString(), runtime: process.version, benchmark_scope: 'Synthetic software timing workloads; no pre-change benchmark is available.', timings, measured_pilot: { synthetic: false, inputs: results.inputs, analyses } };
fs.mkdirSync(new URL('../artifacts/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../artifacts/preference-benchmark.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
