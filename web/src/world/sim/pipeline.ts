// End-to-end mission pipeline shared by Mission Studio, the copilot and the integration tests:
// validate → planning lattice → multi-objective A* → 5 m route check → terramechanics traverse simulation.
import type { World } from '../core/world';
import { profile } from '../analysis/terrain';
import { OBJECTIVES, validateMission, type MissionSpec } from './mission';
import { buildPlanningGrid, energyPerMetre, planRoutes, type CostModel, type PlanningGrid, type Route } from './planner';
import { effectiveRover, simulate, tableFor, type SimResult } from './traverse';

export interface PlanResult { spec: MissionSpec; validation: ReturnType<typeof validateMission>; routes: Route[]; sims: Record<string, SimResult>; checks: Record<string, { maxSlope5m: number; exceedM: number }>; timings: Record<string, number> }

export function costModel(spec: MissionSpec): CostModel {
  const rover = effectiveRover(spec);
  return { table: tableFor(spec, rover), maxSpeedMs: rover.maxSpeedMs, wheels: rover.wheels, wheelRadiusM: rover.wheelRadiusM, drivetrainEfficiency: rover.drivetrainEfficiency, avionicsW: rover.avionicsW, wheelStallTorqueNm: rover.wheelStallTorqueNm };
}

/** Re-check a planned route on the 5 m analysis surface: maximum slope and length above the limit. */
export function checkRoute(world: World, route: Route, maxSlopeDeg: number) {
  const pr = profile(world, route.points, 5);
  let exceed = 0, max = 0;
  for (const p of pr.points) { if (p.slopeDeg === null) continue; max = Math.max(max, p.slopeDeg); if (p.slopeDeg > maxSlopeDeg) exceed += 5; }
  return { maxSlope5m: Math.round(max * 100) / 100, exceedM: exceed };
}

export type Progress = (stage: string) => Promise<void> | void;

export async function executePlan(world: World, spec: MissionSpec, grid: PlanningGrid | null, progress: Progress = () => undefined): Promise<{ result: PlanResult; grid: PlanningGrid }> {
  const timings: Record<string, number> = {};
  const time = async <T>(label: string, f: () => T) => { await progress(label); const t0 = performance.now(); const v = f(); timings[label] = Math.round(performance.now() - t0); return v; };
  const validation = validateMission(spec, world);
  if (!validation.ok) return { result: { spec, validation, routes: [], sims: {}, checks: {}, timings }, grid: grid! };
  await world.ensureOperational();
  const g = grid ?? await time('Building the 10 m planning lattice', () => buildPlanningGrid(world));
  const model = await time('Solving terramechanics grade tables', () => costModel(spec));
  const routes = await time('Planning four objective routes (A*)', () => planRoutes({ grid: g, spec, model, horizon: world, illumination: world.illumination }, OBJECTIVES));
  const sims: Record<string, SimResult> = {}, checks: PlanResult['checks'] = {};
  await time('Simulating each route on the 5 m terrain', () => {
    for (const r of routes) if (r.feasible) { sims[r.id] = simulate(world, spec, r, { table: model.table }); checks[r.id] = checkRoute(world, r, spec.constraints.maxSlopeDeg); }
  });
  return { result: { spec, validation, routes, sims, checks, timings }, grid: g };
}

/** RGBA traversability texture (row 0 = north) from the planning lattice and cost model. */
export function traversabilityTexture(grid: PlanningGrid, spec: MissionSpec, model: CostModel) {
  const rgba = new Uint8Array(grid.width * grid.height * 4), limit = spec.constraints.maxSlopeDeg;
  let eMin = Infinity, eMax = 0;
  const flatE = energyPerMetre(model, 0);
  for (let g = 0; g <= limit; g += 1) { const e = energyPerMetre(model, g); if (Number.isFinite(e)) { eMin = Math.min(eMin, e); eMax = Math.max(eMax, e); } }
  for (let i = 0; i < grid.width * grid.height; i++) {
    const s = grid.slope[i], k = i * 4;
    if (s > limit) { rgba[k] = 205; rgba[k + 1] = 64; rgba[k + 2] = 52; rgba[k + 3] = 200; continue; }
    if (grid.crater[i] && spec.constraints.avoidCraterInteriors) { rgba[k] = 150; rgba[k + 1] = 90; rgba[k + 2] = 190; rgba[k + 3] = 170; continue; }
    // Colour by uphill energy at this local slope relative to flat ground (green → amber).
    const e = energyPerMetre(model, s), f = Number.isFinite(e) && eMax > eMin ? Math.min(1, Math.max(0, (e - flatE) / (eMax - flatE))) : 1;
    rgba[k] = Math.round(70 + 160 * f); rgba[k + 1] = Math.round(170 - 40 * f); rgba[k + 2] = Math.round(110 - 60 * f); rgba[k + 3] = 120;
  }
  return { rgba, width: grid.width, height: grid.height, geo: { west: grid.west - grid.spacing / 2, north: grid.north + grid.spacing / 2, size: grid.width * grid.spacing } };
}
