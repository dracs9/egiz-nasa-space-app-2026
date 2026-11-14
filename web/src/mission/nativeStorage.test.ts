import {it,expect} from 'vitest';
import catalog from '../../../data/dynamics/references.json';
import {validateDynamics} from './dynamics';
import {compareNativeArchive} from './nativeStorage';
it('checks native forces, events and joints during archive reproduction',()=>{
 const a=validateDynamics(catalog.runs[0]),b=structuredClone(a);expect(compareNativeArchive(a,b)).toBe(0);
 b.states[30].wheels![0].normalForce+=1;expect(()=>compareNativeArchive(a,b)).toThrow('numerical state');
});
it('rejects changed engine identity before numerical comparisons',()=>{
 const a=validateDynamics(catalog.runs[2]),b=structuredClone(a);b.engine='fake';expect(()=>compareNativeArchive(a,b)).toThrow('Engine version');
});
