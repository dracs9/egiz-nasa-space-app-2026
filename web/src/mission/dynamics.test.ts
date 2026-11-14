import { describe,it,expect } from 'vitest';
import catalogData from '../../../data/dynamics/references.json';
import { validateDynamics,recordedState,roverRequest } from './dynamics';
import { CHANNELS,telemetryRows } from './openmctAdapter';
import { defaultScenario } from './environment';
import type { MissionTerrain } from './types';
const catalog=catalogData;
describe('genuine native records',()=>{
 it('accepts all actual engine records and seeks recorded states only',()=>{for(const record of catalog.runs){const r=validateDynamics(record);expect(recordedState(r,-1)).toBe(r.states[0]);expect(recordedState(r,1e9)).toBe(r.states.at(-1));const s=recordedState(r,1.23);expect(s.t).toBeLessThanOrEqual(1.23);}});
 it('rejects invalid or mislabeled poses',()=>{const r=structuredClone(validateDynamics(catalog.runs[0]));r.states[2].poses![0][3]=99;expect(()=>validateDynamics(r)).toThrow('joint states');});
 it('publishes actual native forces and orbital invariants through Open MCT',()=>{const rover=validateDynamics(catalog.runs[0]),orbit=validateDynamics(catalog.runs[2]);const t=rover.states[50].t;expect(telemetryRows(rover,'contact0',t).at(-1)?.value).toBe(rover.states[50].wheels![0].normalForce);expect(telemetryRows(rover,'fuel',t)).toEqual([]);expect(telemetryRows(orbit,'specificEnergy',7200).at(-1)?.value).toBe(orbit.states.at(-1)!.specificEnergy);expect(CHANNELS.some(c=>c.key==='joint5')).toBe(true);});
 it('copies engineering inputs instead of disconnected defaults',()=>{const terrain={id:'test',body:'mars'} as MissionTerrain;const s=defaultScenario(terrain,'rover');s.rover.mass=1200;s.rover.design!.stallTorque=145;const p=roverRequest(s);expect(p.mass).toBe(1200);expect(p.stallTorque).toBe(145);expect(p.body).toBe('mars');});
});
