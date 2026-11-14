// Node 22.18+ native TypeScript stripping. Deterministic, locally reproducible cases.
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { simulate } from "../web/src/mission/engine.ts";
import {
  defaultScenario,
  ENVIRONMENTS,
} from "../web/src/mission/environment.ts";
import { terrainStatistics } from "../web/src/mission/analysis.ts";

const bundle = JSON.parse(
  fs.readFileSync(
    new URL("../data/pilot/mission_terrain.json", import.meta.url),
    "utf8",
  ),
);
const output = new URL("../artifacts/", import.meta.url);
fs.mkdirSync(output, { recursive: true });
const records = [];
for (const id of [
  "MARS_JEZERO",
  "MOON_MONS_MOUTON",
  "PILOT_ICELAND",
  "PILOT_WADI_RUM",
]) {
  const terrain = bundle.entries.find((t) => t.id === id);
  for (const mode of ["rover", "launch", "descent", "eva"]) {
    const scenarios = [defaultScenario(terrain, mode)];
    if (terrain.body === "earth")
      scenarios.push({
        ...scenarios[0],
        kind: "counterfactual",
        environment: { ...ENVIRONMENTS.mars },
      });
    for (const scenario of scenarios) {
      const start = performance.now(),
        run = simulate(scenario, terrain, bundle.inputs),
        ms = performance.now() - start;
      records.push({
        terrain: id,
        mode,
        kind: scenario.kind,
        environment: scenario.environment,
        elapsed_ms: +ms.toFixed(3),
        outcome: run.outcome,
        metrics: run.metrics,
        frames: run.frames.length,
      });
      if (id === "MARS_JEZERO" && mode === "descent")
        fs.writeFileSync(
          new URL("mission-reproduction.json", output),
          JSON.stringify(run),
        );
    }
  }
}
const terrain = bundle.entries.find((t) => t.id === "MARS_JEZERO"),
  scenario = defaultScenario(terrain, "descent");
const convergence = [0.2, 0.1, 0.05, 0.025].map((dt) => {
  const r = simulate({ ...scenario, dt }, terrain, bundle.inputs);
  return {
    dt,
    touchdown_s: r.metrics.duration,
    touchdown_m_s: r.metrics.touchdownSpeed,
    fuel_kg: r.metrics.fuelUsed,
  };
});
const report = {
  generated_at: new Date().toISOString(),
  runtime: process.version,
  scope:
    "Single local CPU execution per scenario, includes result/terrain copying. Excludes worker transfer, rendering and data acquisition. Not a universal performance guarantee.",
  inputs: bundle.inputs,
  records,
  descent_convergence: convergence,
  terrain_statistics: bundle.entries.map((t) => ({
    id: t.id,
    ...terrainStatistics(t),
  })),
};
fs.writeFileSync(
  new URL("mission-benchmark.json", output),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      scenarios: records.length,
      slowest_ms: Math.max(...records.map((r) => r.elapsed_ms)),
      jezero: records.filter((r) => r.terrain === "MARS_JEZERO"),
      descent_convergence: convergence,
    },
    null,
    2,
  ),
);
