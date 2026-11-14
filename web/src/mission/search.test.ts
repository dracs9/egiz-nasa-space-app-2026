import { describe, expect, it } from 'vitest';
import bundle from '../../../data/pilot/mission_terrain.json';
import { defaultScenario } from './environment';
import { executeDecisionMap, executeStudy, searchScenarios } from './search';
import { assessRun, baselineCompatibility, defaultRequirements } from './acceptance';
import { chronographEvents } from './chronograph';
import { parseExperiment, verifyImportedTerrain } from './storage';
import type { MissionTerrain, TerrainBundle } from './types';
const terrain=bundle.entries.find(t=>t.id==='MOON_MONS_MOUTON') as MissionTerrain;
const s=defaultScenario(terrain);s.rover.speed=.2;
const limits={...defaultRequirements(s),maxDurationS:7200,maxEnergyWh:400,minReserveWh:2500};
const space={varySpeed:true,minSpeed:.3,maxSpeed:1.2,samples:5,routes:['astar','astar-energy'] as ('astar'|'astar-energy')[]};
describe('constrained operating study on measured terrain',()=>{
  it('executes genuine failures and feasible alternatives without changing task, payload, hardware or requirements',()=>{
    const original=structuredClone(s),study=executeStudy(s,terrain,bundle.inputs,limits,space);
    expect(s).toEqual(original);expect(study.baseline.feasible).toBe(false);expect(study.baseline.run.outcome).not.toBe('destination_reached');
    expect(study.options).toHaveLength(10);expect(study.options.some(o=>o.feasible)).toBe(true);
    for(const o of study.options){
      const {speed:_,route:__,...hardware}=o.run.scenario.rover;
      const {speed:___,route:____,...fixed}=s.rover;
      expect(hardware).toEqual(fixed);expect(o.run.scenario.destination).toEqual(s.destination);expect(o.run.scenario.start).toEqual(s.start);
      expect(o.run.requirements).toEqual(limits);expect(o.feasible).toBe(assessRun(o.run,limits).every(g=>g.status==='pass'));
      if(o.feasible)expect(o.run.outcome).toBe('destination_reached');
    }
    const map=executeDecisionMap(study);
    expect(map.cells).toHaveLength(9);expect(map.cells.reduce((n,c)=>n+c.runs.length,0)).toBeLessThanOrEqual(18);
    for(const c of map.cells){const feasible=c.runs.filter(r=>r.feasible);expect(c.winnerId===null).toBe(feasible.length===0);for(const r of c.runs)expect(r.run.requirements).toEqual(limits);}
    const archive=parseExperiment(JSON.stringify(study.options[0].run));verifyImportedTerrain(archive,bundle as TerrainBundle);
    const legacy=structuredClone(archive);delete legacy.requirements;expect(parseExperiment(JSON.stringify(legacy)).requirements).toBeUndefined();
  });
  it('reports infeasibility with unchanged impossible requirements and rejects unsupported/free hardware search axes',()=>{
    const impossible={...limits,maxEnergyWh:0};const study=executeStudy(s,terrain,bundle.inputs,impossible,space);
    expect(study.options.every(o=>!o.feasible&&!o.pareto)).toBe(true);expect(study.requirements).toEqual(impossible);
    expect(()=>searchScenarios(s,{...space,maxSpeed:Infinity})).toThrow();expect(()=>searchScenarios(s,{...space,samples:100})).toThrow();
    expect(()=>executeStudy(s,terrain,{},limits,space,Infinity)).toThrow();
  });
  it('locates a real energy threshold on the recorded segment and blocks mismatched route deltas',()=>{
    const study=executeStudy(s,terrain,bundle.inputs,limits,space),r=study.baseline.run;
    const energy=chronographEvents(r,limits).find(e=>e.gate==='energy')!;
    expect(energy.t).toBeGreaterThan(0);expect(energy.t).toBeLessThan(r.metrics.duration);
    const next=r.frames.findIndex(f=>f.t>=energy.t),a=r.frames[next-1],b=r.frames[next];
    const energyAt=a.energyWh+(b.energyWh-a.energyWh)*(energy.t-a.t)/(b.t-a.t);expect(energyAt).toBeCloseTo(400,8);
    const changed=structuredClone(r);changed.route.push({x:42,y:42});expect(baselineCompatibility(r,changed).comparable).toBe(false);
    const unknown=structuredClone(r);delete unknown.frames.at(-1)!.mobility;
    expect(assessRun(unknown,limits).find(g=>g.id==='reserve')?.status).toBe('unresolved');
  });
});
