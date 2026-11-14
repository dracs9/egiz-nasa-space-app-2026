import type { Frame, RunResult } from './types.ts';
import type { DynamicsRun, DynamicsState } from './dynamics.ts';
export type TelemetryRecord=RunResult|DynamicsRun;
type Sample=Frame|DynamicsState;
const native=(f:Sample):f is DynamicsState=>'position' in f;
export function recordFrames(run:TelemetryRecord):Sample[]{return run.schema==='egiz.experiment'?run.frames:run.states;}
export const CHANNELS = [
  {key:'speed',name:'Recorded speed',unit:'m/s',value:(f:Sample)=>f.speed},
  {key:'altitude',name:'Altitude above model reference',unit:'m',value:(f:Sample)=>f.altitude},
  {key:'energy',name:'Gross electrical energy estimate',unit:'Wh',value:(f:Sample)=>f.energyWh},
  {key:'battery',name:'Battery remaining',unit:'Wh',value:(f:Sample)=>native(f)?undefined:f.mobility?.batteryRemainingWh},
  {key:'power',name:'Electrical bus load estimate',unit:'W',value:(f:Sample)=>native(f)?f.powerW:f.mobility?.electricalPowerW},
  {key:'solar',name:'Solar power',unit:'W',value:(f:Sample)=>native(f)?undefined:f.mobility?.solarPowerW},
  {key:'torque',name:'Wheel-shaft torque / wheel 1',unit:'N m',value:(f:Sample)=>native(f)?f.wheels?.[0].torque:f.mobility?.wheelTorqueNm},
  {key:'rpm',name:'Wheel shaft speed / wheel 1',unit:'rpm',value:(f:Sample)=>native(f)?f.wheels?.[0].omega===undefined?undefined:f.wheels[0].omega*30/Math.PI:f.mobility?.motorRpm},
  {key:'thrust',name:'Engine thrust',unit:'N',value:(f:Sample)=>native(f)?undefined:f.thrust},
  {key:'fuel',name:'Propellant remaining',unit:'kg',value:(f:Sample)=>native(f)?undefined:f.propellant},
  {key:'normalLoad',name:'Total wheel normal load',unit:'N',value:(f:Sample)=>native(f)&&f.wheels?f.wheels.reduce((s,w)=>s+w.normalForce,0):undefined},
  {key:'tilt',name:'Chassis tilt from vertical',unit:'deg',value:(f:Sample)=>native(f)?f.tiltDeg:undefined},
  {key:'specificEnergy',name:'Orbital specific energy',unit:'J/kg',value:(f:Sample)=>native(f)?f.specificEnergy:undefined},
  {key:'angularMomentum',name:'Specific angular momentum',unit:'m²/s',value:(f:Sample)=>native(f)?f.angularMomentum:undefined},
  ...Array.from({length:6},(_,i)=>({key:`contact${i}`,name:`Wheel ${i+1} normal force`,unit:'N',value:(f:Sample)=>native(f)?f.wheels?.[i].normalForce:undefined})),
  ...Array.from({length:6},(_,i)=>({key:`slip${i}`,name:`Wheel ${i+1} signed kinematic slip`,unit:'ratio',value:(f:Sample)=>native(f)?f.wheels?.[i].slip:undefined})),
  ...Array.from({length:6},(_,i)=>({key:`joint${i}`,name:`Suspension ${i+1} hinge`,unit:'rad',value:(f:Sample)=>native(f)?f.wheels?.[i].suspension:undefined})),
];
export function telemetryEpoch(run:TelemetryRecord){return Date.parse((run.schema==='egiz.experiment'?run.scenario.solar?.epochUtc:undefined)??run.createdAt);}
export function telemetryRows(run:TelemetryRecord,key:string,time:number,start=-Infinity,end=Infinity){
  const channel=CHANNELS.find(c=>c.key===key);if(!channel)throw Error('Unknown EGIZ telemetry channel');const epoch=telemetryEpoch(run);
  return recordFrames(run).filter(f=>f.t<=time+1e-9&&epoch+f.t*1000>=start&&epoch+f.t*1000<=end&&channel.value(f)!==undefined).map(f=>({utc:epoch+f.t*1000,value:channel.value(f)!,met:f.t}));
}
