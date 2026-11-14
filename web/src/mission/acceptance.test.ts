import { describe, expect, it } from 'vitest';
import bundle from '../../../data/pilot/mission_terrain.json';
import { defaultScenario } from './environment';
import { simulate } from './engine';
import { assessRun, baselineCompatibility, defaultRequirements, requirementsValid, scenarioChanges } from './acceptance';
import type { MissionTerrain } from './types';

const terrain = bundle.entries.find(t => t.id === 'MARS_JEZERO') as MissionTerrain;
const scenario = defaultScenario(terrain);

describe('recorded experiment acceptance', () => {
  it('checks actual outputs and responds to user-defined budgets', () => {
    const run = simulate(scenario, terrain);
    const limits = defaultRequirements(scenario);
    const gates = assessRun(run, limits);
    expect(gates.find(g => g.id === 'arrival')?.status).toBe(run.outcome === 'destination_reached' ? 'pass' : 'fail');
    expect(gates.find(g => g.id === 'energy')?.value).toBe(run.metrics.energyWh);
    expect(assessRun(run, { ...limits, maxEnergyWh: Math.max(0, run.metrics.energyWh - .01) }).find(g => g.id === 'energy')?.status).toBe('fail');
    expect(assessRun(run, { ...limits, maxEnergyWh: run.metrics.energyWh }).find(g => g.id === 'energy')?.status).toBe('pass');
    const unknown = structuredClone(run); delete unknown.frames[0].mobility;
    expect(assessRun(unknown, limits).find(g => g.id === 'stability')?.status).toBe('unresolved');
    expect(requirementsValid({ ...limits, maxEnergyWh: NaN })).toBe(false);
  });
  it('does not treat a missing touchdown as zero velocity or a successful landing', () => {
    const descent = defaultScenario(terrain, 'descent'); descent.duration = 1;
    const run = simulate(descent, terrain);
    expect(run.metrics.touchdownSpeed).toBeNull();
    const gates = assessRun(run, defaultRequirements(descent));
    expect(gates.find(g => g.id === 'contact')?.status).toBe('unresolved');
    expect(gates.find(g => g.id === 'landing')?.status).toBe('fail');
  });
  it('compares controlled designs but blocks incompatible geometry, environments and solvers', () => {
    const base = simulate(scenario, terrain), changed = structuredClone(scenario);
    changed.rover.mass += 100;
    const next = simulate(changed, terrain);
    expect(baselineCompatibility(base, next)).toEqual({ comparable: true, reasons: [], sameRoute: true });
    expect(scenarioChanges(scenario, changed)).toEqual([{ path: 'rover.mass', before: scenario.rover.mass, after: changed.rover.mass }]);
    const mismatch = structuredClone(next); mismatch.terrain.grid.elevation_m[0]! += 1;
    expect(baselineCompatibility(base, mismatch).comparable).toBe(false);
    mismatch.terrain = base.terrain; mismatch.scenario.environment.gravity *= 2;
    expect(baselineCompatibility(base, mismatch).reasons).toContain('Different physical environments');
    mismatch.scenario.environment = base.scenario.environment; mismatch.model = 'different';
    expect(baselineCompatibility(base, mismatch).reasons).toContain('Different numerical models');
    const route = structuredClone(next); route.scenario.destination.x += 200;
    expect(baselineCompatibility(base, route)).toMatchObject({ comparable: true, sameRoute: false });
  });
});
