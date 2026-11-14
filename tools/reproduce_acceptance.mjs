// Re-execute both embedded runs, then rebuild every declared gate and input comparison.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { acceptanceReport, requirementsValid } from '../web/src/mission/acceptance.ts';

const input = process.argv[2];
if (!input) throw Error('Usage: node tools/reproduce_acceptance.mjs path/to/test-report.json');
const archived = JSON.parse(fs.readFileSync(input, 'utf8'));
if (archived.schema !== 'egiz.acceptance_report' || archived.version !== '1.0.0' || !requirementsValid(archived.requirements)) throw Error('Invalid acceptance report');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'egiz-acceptance-'));
try {
  for (const [label, run] of [['current', archived.current], ['baseline', archived.baseline]]) {
    if (!run) { if (label === 'current') throw Error('Missing current experiment'); continue; }
    const file = path.join(temp, `${label}.json`);
    fs.writeFileSync(file, JSON.stringify(run));
    execFileSync(process.execPath, [fileURLToPath(new URL('./reproduce_mission.mjs', import.meta.url)), file], { stdio: 'inherit' });
  }
  const rebuilt = acceptanceReport(archived.current, archived.baseline, archived.requirements);
  assert.deepEqual(archived.gates, rebuilt.gates, 'Acceptance gates disagree with the declared requirements');
  assert.deepEqual(archived.comparison, rebuilt.comparison, 'Baseline comparison disagrees with the recorded inputs');
  console.log(`PASS: ${rebuilt.gates.length} acceptance gates and ${rebuilt.comparison?.changes.length ?? 0} changed inputs; ${archived.baseline ? 'both' : 'current'} experiment(s) reproduced. Numerical reproducibility, not flight qualification.`);
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
