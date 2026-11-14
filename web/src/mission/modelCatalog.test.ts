import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { nasaPart } from './modelCatalog';
import { makeWheelVisual, disposeObject } from './scene/mechanical';
import { makeVehicle } from './scene/vehicles';
import { DEFAULT_DESIGN } from './mobility';

describe('shared detailed equipment',()=>{
  it('keeps the rendered wheel inside its configured contact envelope with an X axle',()=>{
    for(const [radius,width] of [[.22,.18],[.41,.33],[.65,.5]]){
      const wheel=makeWheelVisual(radius,width);wheel.updateMatrixWorld(true);
      const bounds=new T.Box3().setFromObject(wheel),size=bounds.getSize(new T.Vector3());
      expect(size.y).toBeCloseTo(radius*2,2);expect(size.z).toBeCloseTo(radius*2,2);
      expect(size.x).toBeGreaterThan(width);expect(size.x).toBeLessThan(width*1.4);
      expect(wheel.userData.axle).toEqual([1,0,0]);disposeObject(wheel);
    }
  });
  it('preserves semantic picking and connected articulated details after batching the configured rig',()=>{
    const rig=makeVehicle('rover',{...DEFAULT_DESIGN,wheelRadius:.53,trackWidth:3.1,wheelbase:2.8});
    const components=new Set<string>();rig.root.traverse(o=>{if(o instanceof T.Mesh)components.add(o.userData.component);});
    for(const key of ['chassis','mobility','suspension','mast','science','power','communications','sensors','avionics'])expect(components.has(key)).toBe(true);
    for(const wheel of rig.wheels){expect(wheel.steer.parent).toBe(rig.root);expect(Math.abs(wheel.x)).toBeCloseTo(1.55);expect(wheel.steer.position.y).toBeCloseTo(.53);}
    for(const arm of rig.arms.filter((_,i)=>i%2===0))expect(arm.mesh.children.length).toBeGreaterThan(0);
    disposeObject(rig.root);
  });
  it('distinguishes NASA nuclear power and rocker-bogie assemblies from EGIZ solar and trailing arms',()=>{
    expect(nasaPart('rtg')).toBe('power');expect(nasaPart('suspension')).toBe('suspension');expect(nasaPart('Wheels_objs')).toBe('mobility');expect(nasaPart('Mastcam_Z_cams')).toBe('mast');expect(nasaPart('PIXL')).toBe('science');expect(nasaPart('antenna_hg')).toBe('communications');expect(nasaPart('hazcams_front')).toBe('sensors');
  });
});
