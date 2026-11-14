import { assessRun, type TestRequirements } from './acceptance.ts';
import type { Frame, RunResult } from './types';
export interface ChronographEvent { t:number; type:string; detail:string; gate?:string; x:number; y:number; severity:'event'|'fail'|'unresolved' }
/** Localizes threshold crossings within recorded piecewise-linear telemetry, not a new physical event solver. */
export function chronographEvents(run:RunResult, requirements:TestRequirements):ChronographEvent[] {
  const frames=run.frames;
  const at=(t:number)=>frames.find(f=>f.t>=t)??frames.at(-1)!;
  const result:ChronographEvent[]=run.events.map(e=>({...e,x:at(e.t).x,y:at(e.t).y,severity:'event'}));
  const add=(gate:string,label:string,value:(f:Frame)=>number|undefined,limit:number,less=false)=>{
    const violates=(n:number)=>less?n<limit-1e-8:n>limit+1e-8;
    const i=frames.findIndex(f=>{const n=value(f);return n!==undefined&&Number.isFinite(n)&&violates(n);});
    if(i<0)return;
    const b=frames[i],a=frames[Math.max(0,i-1)],av=value(a),bv=value(b)!;
    const fraction=av===undefined||av===bv?1:Math.max(0,Math.min(1,(limit-av)/(bv-av)));
    result.push({gate,type:label,detail:'Threshold crossing interpolated between recorded samples; inspect the corresponding segment and model assumptions.',t:a.t+(b.t-a.t)*fraction,x:a.x+(b.x-a.x)*fraction,y:a.y+(b.y-a.y)*fraction,severity:'fail'});
  };
  add('energy','Energy ceiling',f=>f.energyWh,requirements.maxEnergyWh);
  add('time','Maximum operation time',f=>f.t,requirements.maxDurationS);
  if(run.scenario.rover.design){add('reserve','Final reserve threshold crossed',f=>f.mobility?.batteryRemainingWh,requirements.minReserveWh,true);add('stability','Static stability margin',f=>f.mobility?.stabilityMarginDeg,0,true);}
  const finalReserve=assessRun(run,requirements).find(g=>g.id==='reserve');
  for(const e of result.filter(e=>e.gate==='reserve')){e.detail='The recorded battery crosses the requested final reserve. Final acceptance is determined at the end; later charging may recover reserve.';if(finalReserve?.status==='pass')e.severity='event';}
  for(const g of assessRun(run,requirements).filter(g=>g.status!=='pass'&&!result.some(e=>e.gate===g.id))) {
    const f=frames.at(-1)!;
    result.push({gate:g.id,type:g.id==="arrival" && g.status==="fail" ? "Destination not reached" : g.label,detail:g.status==='unresolved'?'No recorded value':run.explanation,t:f.t,x:f.x,y:f.y,severity:g.status==='fail'?'fail':'unresolved'});
  }
  return result.sort((a,b)=>a.t-b.t||Number(!!a.gate)-Number(!!b.gate));
}
export const gateLevers:Record<string,string[]>={
  energy:['Commanded speed','Route objective','Electrical bus load','Rolling resistance and drivetrain efficiency require measurements'],
  time:['Commanded speed','Route objective','Motor torque-speed envelope'],
  reserve:['Commanded speed','Route objective','Measured bus demand and solar assumptions'],
  arrival:['Regional slope and traction screens','Route objective','Motor torque-speed envelope','Time and battery budgets'],
  stability:['Loaded centre of mass and support polygon require a physical design change'],
};
