// Independent development, 2026-10-18. Node 22.18+ native TypeScript support.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { simulate } from "../web/src/mission/engine.ts";
import {
  parseExperiment,
  verifyImportedTerrain,
  report,
} from "../web/src/mission/storage.ts";

const input = process.argv[2];
if (!input)
  throw new Error(
    "Usage: node tools/reproduce_mission.mjs path/to/experiment.json",
  );
const archived = parseExperiment(fs.readFileSync(input, "utf8"));
const bundle = JSON.parse(
  fs.readFileSync(
    new URL("../data/pilot/mission_terrain.json", import.meta.url),
    "utf8",
  ),
);
verifyImportedTerrain(archived, bundle);
if(archived.scenario.solar) {
  const root=fileURLToPath(new URL('../',import.meta.url));
  const interpreter=path.join(root,'.venv/bin/python');
  execFileSync(fs.existsSync(interpreter)?interpreter:'python3', ['-m','pipeline.science.spice','verify','--archive',path.resolve(input)],{cwd:root,stdio:'inherit'});
}
const calculated = simulate(
  archived.scenario,
  archived.terrain,
  archived.inputs,
);
const differences = [];
let maximumNumericDifference = 0;
function compare(a, b, location) {
  if (typeof a === "number" && typeof b === "number") {
    const difference = Math.abs(a - b);
    maximumNumericDifference = Math.max(maximumNumericDifference, difference);
    if (
      !Number.isFinite(a) ||
      !Number.isFinite(b) ||
      difference > 1e-9 + 1e-12 * Math.max(Math.abs(a), Math.abs(b))
    )
      differences.push(location);
  } else if (a && b && typeof a === "object" && typeof b === "object") {
    if (
      Array.isArray(a) !== Array.isArray(b) ||
      Object.keys(a).length !== Object.keys(b).length
    )
      differences.push(location);
    for (const key of Object.keys(b))
      compare(a[key], b[key], `${location}.${key}`);
  } else if (a !== b) differences.push(location);
}
for (const key of [
  "frames",
  "events",
  "route",
  "metrics",
  "outcome",
  "explanation",
])
  compare(archived[key], calculated[key], key);
const verification = {
  archive: path.basename(input),
  model: calculated.model,
  runtime: process.version,
  frames: calculated.frames.length,
  outcome: calculated.outcome,
  tolerance:
    "absolute 1e-9 + relative 1e-12 per numeric field; this is numerical reproducibility, not scientific accuracy",
  maximum_numeric_difference: maximumNumericDifference,
  discrepancies: differences.slice(0, 20),
  passed: differences.length === 0,
};
fs.mkdirSync(new URL("../artifacts/", import.meta.url), { recursive: true });
fs.writeFileSync(
  new URL("../artifacts/mission-reproduction-check.json", import.meta.url),
  JSON.stringify(verification, null, 2) + "\n",
);
if (differences.length)
  throw new Error(
    `Archive differs from recalculation: ${differences.slice(0, 10).join(", ")}`,
  );
fs.writeFileSync(
  new URL("../artifacts/mission-browser-export-report.md", import.meta.url),
  report(calculated),
);
console.log(JSON.stringify(verification, null, 2));
