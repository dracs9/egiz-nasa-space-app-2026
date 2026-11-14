import { describe, expect, it } from 'vitest';
import bundle from '../../../data/pilot/mission_terrain.json';
import { calibrationError, fitPowerModel, parseObservations, syntheticObservations, validateObservations } from './observations';
import { defaultScenario } from './environment';
import { simulate } from './engine';
import { parseExperiment } from './storage';
import { candidateWindows, fieldTestContract } from './fieldWindows';
import type { MissionTerrain } from './types';
const earth=bundle.entries.find(t=>t.body==='earth'&&t.id==='PILOT_ICELAND') as MissionTerrain;
const s=defaultScenario(earth);
describe('identifiable electrical calibration and independent series',()=>{
  it('identifies eta and idle load using mechanical power; keeps held-out data out of fitting',()=>{
    const o=syntheticObservations(),c=fitPowerModel(o,{efficiency:.7,idlePowerW:80},s.rover.design);
    expect(c.efficiency).toBeCloseTo(.76,12);expect(c.idlePowerW).toBeCloseTo(65,12);expect(c.validationRmseW).toBeLessThan(1e-10);expect(c.priorValidationRmseW).toBeGreaterThan(10);
    const separate=structuredClone(o);separate.series[1].rows.forEach(r=>r.bus_current_a+=.5);
    const holdout=fitPowerModel(separate,c.prior,s.rover.design);expect(holdout.efficiency).toBe(c.efficiency);expect(holdout.validationRmseW).toBeCloseTo(14,9);
  });
  it('fails closed on units, missing channels, gaps, duplicate series and unidentifiable excitation',()=>{
    const badUnits=structuredClone(syntheticObservations()) as unknown as {units:{bus_current_a:string}};badUnits.units.bus_current_a='mA';expect(()=>validateObservations(badUnits)).toThrow(/units/);
    const missing=syntheticObservations();delete (missing.series[0].rows[0] as Partial<typeof missing.series[0]['rows'][0]>).mechanical_power_w;expect(()=>validateObservations(missing)).toThrow(/channel/);
    const gap=syntheticObservations();gap.series[0].rows[1].t_s=20;expect(()=>validateObservations(gap)).toThrow(/gaps/);
    const duplicate=syntheticObservations();duplicate.series[1].source=duplicate.series[0].source;expect(()=>validateObservations(duplicate)).toThrow(/distinct/);
    const flat=syntheticObservations();flat.series[0].rows.forEach(r=>r.mechanical_power_w=100);expect(()=>fitPowerModel(flat,{efficiency:.7,idlePowerW:80},s.rover.design)).toThrow(/insufficient/);
    expect(()=>parseObservations('x'.repeat(2_000_001))).toThrow(/2 MB/);
  });
  it('archives raw series with the updated Earth model, reexecutes and rejects planetary or hardware transfer',()=>{
    const c=fitPowerModel(syntheticObservations(),{efficiency:s.rover.efficiency,idlePowerW:s.rover.idlePower},s.rover.design);
    const next={...structuredClone(s),calibration:c};next.rover.efficiency=c.efficiency;next.rover.idlePower=c.idlePowerW;
    expect(calibrationError(next)).toBeNull();const run=simulate(next,earth,bundle.inputs),parsed=parseExperiment(JSON.stringify(run));
    expect(simulate(parsed.scenario,parsed.terrain,parsed.inputs).metrics).toEqual(run.metrics);expect(parsed.scenario.calibration?.observations.synthetic).toBe(true);
    next.kind='counterfactual';expect(calibrationError(next)).toMatch(/Earth/);next.kind='earth-analog';next.rover.design!.stallTorque++;expect(calibrationError(next)).toMatch(/hardware/);
  });
  it('enumerates reproducible measured survey windows and attaches a bounded test contract',()=>{
    const targetTerrain=bundle.entries.find(t=>t.id==='MOON_MONS_MOUTON') as MissionTerrain;
    const target=simulate(defaultScenario(targetTerrain),targetTerrain),run=simulate(s,earth),windows=candidateWindows(run,target);
    expect(windows).toHaveLength(3);expect(candidateWindows(run,target)).toEqual(windows);
    expect(windows.every(w=>w.support>=.9&&w.match>=0&&w.match<=1&&w.sourceSha256===earth.source.sha256)).toBe(true);
    expect(fieldTestContract(target).every(c=>c.test&&c.unknown&&c.measurement&&c.conclusion&&c.excluded)).toBe(true);
  });
});
