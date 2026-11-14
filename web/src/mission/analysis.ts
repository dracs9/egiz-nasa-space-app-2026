import { cellPoint, slopeAt } from "./terrain.ts";
import type { MissionTerrain, RunResult } from "./types.ts";
export function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * q,
    low = Math.floor(index),
    fraction = index - low;
  return (
    sorted[low] * (1 - fraction) +
    sorted[Math.min(sorted.length - 1, low + 1)] * fraction
  );
}
export function terrainStatistics(terrain: MissionTerrain) {
  const slopes: number[] = [],
    heights = terrain.grid.elevation_m
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
  for (let i = 0; i < terrain.grid.elevation_m.length; i++) {
    const value = slopeAt(terrain, cellPoint(terrain, i));
    if (value !== null) slopes.push(value);
  }
  slopes.sort((a, b) => a - b);
  return {
    p50Slope: quantile(slopes, 0.5),
    p90Slope: quantile(slopes, 0.9),
    relief: heights.length
      ? quantile(heights, 0.95)! - quantile(heights, 0.05)!
      : null,
    slopeSamples: slopes.length,
    histogram: [0, 2, 5, 10, 15, 20, 30, 90]
      .slice(1)
      .map((upper, i) => ({
        lower: [0, 2, 5, 10, 15, 20, 30][i],
        upper,
        count: slopes.filter(
          (s) =>
            s >= [0, 2, 5, 10, 15, 20, 30][i] && (s < upper || upper === 90),
        ).length,
      })),
  };
}
export function comparableInputs(a: RunResult, b: RunResult): boolean {
  const inputs = (run: RunResult) => {
    const { terrainId: _, environment: __, kind: ___, ...rest } = run.scenario;
    return rest;
  };
  return (
    JSON.stringify(inputs(a)) === JSON.stringify(inputs(b)) &&
    a.model === b.model
  );
}
export function comparisonInsights(runs: RunResult[]): string[] {
  const notes: string[] = [];
  for (const earth of runs.filter((r) => r.scenario.kind === "earth-analog")) {
    const control = runs.find(
      (r) =>
        r.scenario.kind === "counterfactual" &&
        r.terrain.source.sha256 === earth.terrain.source.sha256 &&
        r.terrain.id === earth.terrain.id &&
        comparableInputs(r, earth),
    );
    if (!control) continue;
    if (
      earth.outcome === "route_blocked" &&
      control.outcome === "route_blocked"
    )
      notes.push(
        `${earth.terrain.name}: changing the environment did not remove the route constraint. The same regional terrain remains blocked under this slope/traction model.`,
      );
    else if (
      (earth.scenario.mode === "rover" || earth.scenario.mode === "eva") &&
      earth.outcome === "destination_reached" &&
      control.outcome === "destination_reached"
    )
      notes.push(
        `${earth.terrain.name}: the same terrain and mission require ${earth.metrics.energyWh.toFixed(1)} Wh with Earth parameters and ${control.metrics.energyWh.toFixed(1)} Wh with ${control.scenario.environment.planet} parameters. The ${Math.abs(earth.metrics.energyWh - control.metrics.energyWh).toFixed(1)} Wh difference isolates the configured environmental effect on the energy proxy.`,
      );
    else
      notes.push(
        `${earth.terrain.name}: matched inputs produce “${earth.outcome.replaceAll("_", " ")}” with Earth parameters and “${control.outcome.replaceAll("_", " ")}” with ${control.scenario.environment.planet} parameters. This is a model comparison, not evidence of physical equivalence.`,
      );
  }
  return notes;
}
