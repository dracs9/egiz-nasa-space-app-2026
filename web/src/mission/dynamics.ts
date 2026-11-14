import type { Scenario } from './types';
export type Vec3 = [number,number,number];
export type Pose = [number,number,number,number,number,number,number]; // xyz, quaternion wxyz
export interface DynamicsRequest {
  kind:'rover'|'orbit'; body:'earth'|'moon'|'mars'; duration:number;
  mass?:number; wheelRadius?:number; wheelWidth?:number; trackWidth?:number; wheelbase?:number;
  cgHeight?:number; stallTorque?:number; noLoadRpm?:number; motorPower?:number;
  efficiency?:number; idlePower?:number; friction?:number; speed?:number; stiffness?:number;
  damping?:number; travel?:number; steerDeg?:number; course?:'flat'|'steps'|'cross-slope';
  altitudeKm?:number; inclinationDeg?:number; deltaV?:number; step?:number;
}
export interface WheelState {spin:number; omega:number; suspension:number; steering:number; normalForce:number; normalVector:Vec3; slip:number; torque:number}
export interface DynamicsState {
  t:number;position:Vec3;velocity:Vec3;speed:number;poses?:Pose[];wheels?:WheelState[];
  energyWh?:number;powerW?:number;tiltDeg?:number;altitude?:number;specificEnergy?:number;angularMomentum?:number;
}
export interface DynamicsRun {
  missionContext?:{terrainId:string;sourceSha256:string;regionalPostingM:number;scenario:Scenario};
  schema:'egiz.dynamics_experiment';version:'1.0.0';id:string;createdAt:string;request:DynamicsRequest;
  adapter:string;engine:string;fidelity:'RESEARCH';inputSha256:string;coordinates:string;
  geometry:{body:number;type:number;size:Vec3;position:Vec3;quaternion:[number,number,number,number];rgba:number[]}[];
  bodyNames?:string[];modelXml?:string;modelSha256?:string;
  states:DynamicsState[];metrics:Record<string,number>;events:{t:number;type:string;detail:string}[];assumptions:string[];
  solver:{dt:number;integrator:string};
}
export function roverRequest(s:Scenario):DynamicsRequest {
  const d=s.rover.design;
  return {kind:'rover',body:s.environment.planet,duration:30,mass:s.rover.mass,
    wheelRadius:d?.wheelRadius,wheelWidth:d?.wheelWidth,trackWidth:d?.trackWidth,wheelbase:d?.wheelbase,
    cgHeight:d?.cgHeight,stallTorque:d?.stallTorque,noLoadRpm:d?.noLoadRpm,motorPower:d?.motorPower,
    efficiency:s.rover.efficiency,idlePower:s.rover.idlePower,friction:s.rover.traction,
    speed:Math.min(2,s.rover.speed),travel:d?.suspensionTravel,stiffness:4000,damping:200,course:'steps',steerDeg:0};
}
export function recordedState(run:DynamicsRun,time:number) {
  let lo=0,hi=run.states.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(run.states[mid].t<=time)lo=mid+1;else hi=mid;}
  return run.states[Math.max(0,lo-1)];
}
export function validateDynamics(value:unknown):DynamicsRun {
  const r=value as DynamicsRun;
  if(r?.schema!=='egiz.dynamics_experiment'||r.version!=='1.0.0'||!['rover','orbit'].includes(r.request?.kind)||!Array.isArray(r.states)||r.states.length<2||r.states.length>12000||!r.engine||!r.solver||!Array.isArray(r.assumptions)||!Array.isArray(r.events))throw Error('Invalid native experiment protocol');
  let previous=-1;
  for(const s of r.states){
    if(!Number.isFinite(s.t)||s.t<=previous||!Number.isFinite(s.speed)||s.position?.length!==3||s.velocity?.length!==3||![...s.position,...s.velocity].every(Number.isFinite))throw Error('Invalid native state vector');
    if(r.request.kind==='rover'&&(!s.poses||s.poses.length!==r.bodyNames?.length||s.poses.some(p=>p.length!==7||!p.every(Number.isFinite)||Math.abs(Math.hypot(...p.slice(3))-1)>1e-5)||s.wheels?.length!==6))throw Error('Invalid native body/joint states');
    previous=s.t;
  }
  if(!/^[a-f0-9]{20}$/.test(r.id)||typeof r.adapter!=='string'||!/^egiz-native-dynamics-/.test(r.adapter)||!Number.isFinite(r.solver.dt)||r.solver.dt<=0||!r.assumptions.every(a=>typeof a==='string')||!Object.values(r.metrics).every(Number.isFinite)||!Array.isArray(r.geometry)||r.geometry.length>300||!['earth','moon','mars'].includes(r.request.body)||r.fidelity!=='RESEARCH'||!Number.isFinite(Date.parse(r.createdAt))||!/^[a-f0-9]{64}$/.test(r.inputSha256)||Math.abs(r.metrics.duration-previous)>1e-6)throw Error('Invalid native metrics/provenance');
  if(r.bodyNames&&(r.bodyNames.length>40||new Set(r.bodyNames).size!==r.bodyNames.length))throw Error('Invalid native component hierarchy');
  for(const g of r.geometry)if(![-1,...Array.from({length:r.bodyNames?.length??0},(_,i)=>i)].includes(g.body)||![0,2,3,5,6].includes(g.type)||g.size.length!==3||g.size.some(n=>n<0||n>1000)||g.quaternion.length!==4||g.position.length!==3||![...g.size,...g.position,...g.quaternion,...g.rgba].every(Number.isFinite))throw Error('Invalid native collision geometry');
  for(const s of r.states)if(s.wheels?.some(w=>![w.spin,w.omega,w.suspension,w.steering,w.normalForce,w.slip,w.torque,...(w.normalVector??[])].every(Number.isFinite)||w.normalVector?.length!==3))throw Error('Invalid native wheel telemetry');
  if(r.events.some(e=>!Number.isFinite(e.t)||e.t<0||e.t>previous+1e-6||typeof e.type!=='string'||typeof e.detail!=='string'))throw Error('Invalid native events');
  return r;
}
export async function runNative(request:DynamicsRequest,signal:AbortSignal,onStatus:(status:string)=>void):Promise<DynamicsRun> {
  const initial=await fetch('/api/science/dynamics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(5000)});
  const job=await initial.json();if(!initial.ok)throw Error(job.error??'Native service unavailable; start make science-serve');
  const cancel=()=>{void fetch(`/api/science/dynamics/${job.id}`,{method:'DELETE'}).catch(()=>{});};
  signal.addEventListener('abort',cancel,{once:true});
  if(signal.aborted){cancel();throw new DOMException('Cancelled','AbortError');}
  try {
    const deadline=Date.now()+65000;
    while(Date.now()<deadline){
      if(signal.aborted)throw new DOMException('Cancelled','AbortError');
      const response=await fetch(`/api/science/dynamics/${job.id}`,{signal});const result=await response.json();
      if(!response.ok||result.status==='failed')throw Error(result.error??'Native execution failed');
      if(result.status==='complete')return validateDynamics(result.result);
      if(result.status==='cancelled')throw new DOMException('Cancelled','AbortError');
      onStatus(`${request.kind==='rover'?'MuJoCo contact solver':'Basilisk orbit propagation'} running…`);
      await new Promise<void>(resolve=>setTimeout(resolve,350));
    }
    cancel();throw Error('Native job exceeded client time limit');
  } finally {signal.removeEventListener('abort',cancel);}
}
