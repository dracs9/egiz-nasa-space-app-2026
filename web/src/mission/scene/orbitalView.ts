import { Vector3,Quaternion } from 'three';
import type { Vec3 } from '../dynamics';
/** Native inertial Z-up → display Y-up, in reference-body radii. Never mutates the record. */
export function orbitalDisplayPosition(position:Vec3,radius:number):Vector3 {
  if(!Number.isFinite(radius)||radius<=0)throw Error('Invalid central body radius');
  return new Vector3(position[0],position[2],-position[1]).divideScalar(radius);
}
/** Start outside the reference sphere, looking back toward the enlarged reference model. */
export function spacecraftCameraOffset(position:Vector3):Vector3 {
  const radial=position.clone().normalize(),side=new Vector3().crossVectors(radial,new Vector3(0,1,0));
  if(side.lengthSq()<1e-8)side.set(1,0,0);else side.normalize();
  return radial.multiplyScalar(.23).addScaledVector(side,.16).add(new Vector3(0,.13,0));
}
/** Carry the camera around the body with the recorded radial frame, retaining user orbit offsets. */
export function transportCameraOffset(offset:Vector3,previous:Vector3,next:Vector3):Vector3 {
  if(previous.lengthSq()<1e-12||next.lengthSq()<1e-12)return offset.clone();
  return offset.clone().applyQuaternion(new Quaternion().setFromUnitVectors(previous.clone().normalize(),next.clone().normalize()));
}
