// @vitest-environment node
// Simulation: terramechanics, rover, planner, traverse, determinism and counterfactuals on real terrain.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestWorld } from './testing';
import type { World } from './core/world';
import { bekkerSinkage, gradeTable, lateralUtilization, lookupGrade, REGOLITH, solveWheel } from './sim/terramechanics';
import { LUNAR_GRAVITY, ROVERS, tipAngleDeg, validateRover, wheelContacts } from './sim/rover';
import { cloneMission, defaultMission, nearestGentle, validateMission, type MissionSpec } from './sim/mission';
import { buildPlanningGrid, energyPerMetre, orderWaypoints, planRoutes, type PlanningGrid } from './sim/planner';
import { executePlan, costModel, checkRoute } from './sim/pipeline';
import { frameAt, simulate } from './sim/traverse';
import { rockHazard, rocksPerM2Above, illustrativeRocks } from './sim/rocks';
import { simulationHashes } from './report/dossier';

let w: World, grid: PlanningGrid;
const nominal = REGOLITH[0];
beforeAll(async () => { w = await loadTestWorld(); await w.ensureOperational(); grid = buildPlanningGrid(w); }, 120000);

describe('terramechanics', () => {
  it('Bekker sinkage grows with load and falls with wheel width', () => {
    expect(bekkerSinkage(400, 0.5, 0.2, nominal)).toBeGreaterThan(bekkerSinkage(200, 0.5, 0.2, nominal));
    expect(bekkerSinkage(400, 0.5, 0.3, nominal)).toBeLessThan(bekkerSinkage(400, 0.5, 0.2, nominal));
  });
  for (const fidelity of ['fast', 'detailed'] as const) it(`${fidelity}: slip rises with grade; flat ground needs slip only for compaction resistance; braking downhill; steep grade immobilises`, () => {
    const t = gradeTable(450, LUNAR_GRAVITY, 4, 0.25, 0.2, nominal, fidelity);
    const s = [0, 5, 10, 15].map(g => lookupGrade(t, g).slip);
    expect(s[0]).toBeGreaterThan(0); expect(s[0]).toBeLessThan(0.2); // thrust must balance compaction resistance
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThan(s[i - 1]);
    expect(lookupGrade(t, 39.5).immobile).toBe(true);
    expect(lookupGrade(t, -10).slip).toBe(0);
  });
  it('detailed and fast models agree in order of magnitude but are not identical', () => {
    const W = 450 * LUNAR_GRAVITY / 4, req = 450 * LUNAR_GRAVITY * Math.sin(0.15) / 4;
    const f = solveWheel(W, req, 0.25, 0.2, nominal, 'fast'), d = solveWheel(W, req, 0.25, 0.2, nominal, 'detailed');
    expect(d.immobile).toBe(false); expect(f.immobile).toBe(false);
    expect(d.slip / f.slip).toBeGreaterThan(0.2); expect(d.slip / f.slip).toBeLessThan(5);
    expect(d.slip).not.toBeCloseTo(f.slip, 3);
    expect(d.drawbarN).toBeCloseTo(req, 0);
  });
  it('loose regolith needs more slip than firm regolith', () => {
    const W = 450 * LUNAR_GRAVITY / 4, req = 450 * LUNAR_GRAVITY * Math.sin(0.15) / 4;
    expect(solveWheel(W, req, 0.25, 0.2, REGOLITH[1], 'fast').slip).toBeGreaterThan(solveWheel(W, req, 0.25, 0.2, REGOLITH[2], 'fast').slip);
    expect(lateralUtilization(450, LUNAR_GRAVITY, 20, 0.05, nominal)).toBeGreaterThan(lateralUtilization(450, LUNAR_GRAVITY, 5, 0.05, nominal));
  });
});

describe('rover digital twin', () => {
  it('profiles are valid, hypothetical and geometrically consistent', () => {
    for (const r of ROVERS) {
      expect(validateRover(r)).toEqual([]); expect(r.evidenceClass).toBe('assumed');
      expect(wheelContacts(r)).toHaveLength(r.wheels);
      expect(tipAngleDeg(r)).toBeGreaterThan(30);
    }
    expect(validateRover({ ...ROVERS[0], massKg: -1 })).not.toEqual([]);
  });
  it('rock statistic is monotonic and illustrative rocks are deterministic', () => {
    expect(rocksPerM2Above(0.05, 0.5)).toBeGreaterThan(rocksPerM2Above(0.05, 1));
    expect(rockHazard(0.05, 0.3, 1.45, 2000).probability).toBeGreaterThan(rockHazard(0.004, 0.3, 1.45, 2000).probability);
    const a = illustrativeRocks(0.05, 7, { west: 0, south: 0, size: 100 }), b = illustrativeRocks(0.05, 7, { west: 0, south: 0, size: 100 });
    expect(a).toEqual(b); expect(a.length).toBeGreaterThan(0);
  });
});

describe('mission specification', () => {
  it('default mission is valid; out-of-box and bad values are rejected', () => {
    const m = defaultMission(w);
    expect(validateMission(m, w)).toMatchObject({ ok: true });
    const bad = cloneMission(m); bad.start = { x: 7000, y: -7000 }; bad.constraints.maxSlopeDeg = 80; bad.departureT = 1e9;
    const v = validateMission(bad, w);
    expect(v.ok).toBe(false); expect(v.errors.length).toBeGreaterThanOrEqual(3);
  });
  it('finds gentle ground near a requested point', () => {
    const p = nearestGentle(w, { x: -1600, y: 2100 }, 8)!;
    expect(p).not.toBeNull(); expect(w.inOperational(p)).toBe(true);
  });
  it('orders waypoints to reduce tour length', () => {
    const wp = (id: string, x: number, y: number) => ({ id, x, y, dwellS: 0, instrumentIds: [], label: id });
    expect(orderWaypoints({ x: 0, y: 0 }, { x: 40, y: 0 }, [wp('c', 30, 0), wp('a', 10, 0), wp('b', 20, 0)]).map(w => w.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('planning and traverse simulation on the measured world', () => {
  let spec: MissionSpec;
  beforeAll(() => { spec = defaultMission(w); });
  it('plans four objective routes that respect the lattice constraints', () => {
    const model = costModel(spec);
    const routes = planRoutes({ grid, spec, model, horizon: w, illumination: w.illumination }, ['shortest', 'safest', 'energy', 'illumination']);
    expect(routes.every(r => r.feasible)).toBe(true);
    const shortest = routes.find(r => r.objective === 'shortest')!;
    for (const r of routes) expect(r.lengthM).toBeGreaterThanOrEqual(shortest.lengthM - 15);
    const safest = routes.find(r => r.objective === 'safest')!;
    expect(checkRoute(w, safest, spec.constraints.maxSlopeDeg).exceedM).toBeLessThanOrEqual(checkRoute(w, shortest, spec.constraints.maxSlopeDeg).exceedM + 5);
    expect(energyPerMetre(model, 10)).toBeGreaterThan(energyPerMetre(model, 0));
  });
  it('simulates deterministically with physically consistent telemetry', async () => {
    const { result } = await executePlan(w, spec, grid);
    const route = result.routes.find(r => r.objective === 'safest')!;
    const a = result.sims[route.id], b = simulate(w, spec, route, {});
    expect(a.summary).toEqual(b.summary);
    expect((await simulationHashes(w, spec, route, a)).outputHash).toBe((await simulationHashes(w, spec, route, b)).outputHash);
    expect(a.summary.status).toBe('completed');
    expect(a.summary.distanceM).toBeCloseTo(route.lengthM, -1);
    expect(a.summary.durationS).toBeGreaterThan(a.summary.distanceM / ROVERS[0].maxSpeedMs - 1);
    expect(a.summary.energyUsedWh).toBeGreaterThan(ROVERS[0].avionicsW * a.summary.durationS / 3600);
    expect(a.frames.every(f => f.socWh <= ROVERS[0].batteryWh + 1e-6 && f.socWh >= 0)).toBe(true);
    const mid = frameAt(a.frames, a.summary.durationS / 2);
    expect(mid.s).toBeGreaterThan(0); expect(mid.s).toBeLessThan(a.summary.distanceM);
    expect(a.tiles.every(k => k.startsWith('5/'))).toBe(true);
  }, 60000);
  it('counterfactuals change outcomes in the physically expected direction', async () => {
    const { result } = await executePlan(w, spec, grid);
    const route = result.routes.find(r => r.objective === 'safest')!, base = result.sims[route.id].summary;
    const small = cloneMission(spec); small.roverOverrides.batteryWh = 400;
    const s = simulate(w, small, route, {}).summary;
    expect(s.minSocFrac).toBeLessThan(base.minSocFrac);
    const loose = cloneMission(spec); loose.soilId = 'lunar-loose';
    const l = simulate(w, loose, route, {}).summary;
    expect(l.status === 'failed' || l.energyUsedWh > base.energyUsedWh).toBe(true);
    const heavy = cloneMission(spec); heavy.roverOverrides.massKg = 900;
    expect(simulate(w, heavy, route, {}).summary.energyUsedWh).toBeGreaterThan(base.energyUsedWh);
    const night = cloneMission(spec); night.departureT = w.illumination.samples.find(x => x[3] < -0.03)![0];
    expect(simulate(w, night, route, {}).summary.energyGeneratedWh).toBeLessThan(base.energyGeneratedWh);
  }, 60000);
  it('fails explicitly when the mission exceeds the SPICE record', async () => {
    const late = cloneMission(spec); late.departureT = w.illumination.duration - 600;
    const { result } = await executePlan(w, late, grid);
    const r = result.routes.find(x => x.feasible)!;
    expect(result.sims[r.id].summary.status).toBe('failed');
    expect(result.sims[r.id].summary.failure).toMatch(/SPICE/);
  }, 60000);
});
