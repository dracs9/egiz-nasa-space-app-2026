// Narrow, identifiable electrical model: bus W = idle W + measured mechanical W / eta.
import type { Scenario } from './types.ts';
export interface ObservationRow { t_s:number; mechanical_power_w:number; bus_voltage_v:number; bus_current_a:number }
export interface ObservationSeries { id:string; role:'fit'|'validation'; source:string; recordedAt:string; maxGapS:number; rows:ObservationRow[] }
export interface Observations {
  schema:'egiz.power_observations'; version:'1.0.0'; synthetic:boolean;
  provenance:{ source:string; instrument:string; operator:string; hardwareId:string; conditions:string; uncertainty:string };
  units:{ t_s:'s'; mechanical_power_w:'W'; bus_voltage_v:'V'; bus_current_a:'A' };
  series:ObservationSeries[];
}
export interface PowerCalibration {
  schema:'egiz.power_calibration'; version:'1.0.0'; observations:Observations;
  efficiency:number; idlePowerW:number; fitRmseW:number; validationRmseW:number; priorValidationRmseW:number;
  prior:{efficiency:number;idlePowerW:number}; hardware:Scenario['rover']['design']; scope:'Earth electrical bench only';
}
export const OBSERVATION_UNITS={t_s:'s',mechanical_power_w:'W',bus_voltage_v:'V',bus_current_a:'A'} as const;
export function validateObservations(value:unknown):Observations {
  const o=value as Observations;
  if(!o||o.schema!=='egiz.power_observations'||o.version!=='1.0.0'||typeof o.synthetic!=='boolean'||!o.provenance||Object.keys(o.provenance).some(k=>!['source','instrument','operator','hardwareId','conditions','uncertainty'].includes(k))||Object.values(o.provenance).some(v=>typeof v!=='string'||!v.trim())||!['source','instrument','operator','hardwareId','conditions','uncertainty'].every(k=>typeof o.provenance[k as keyof Observations['provenance']]==='string')||!o.units||Object.keys(o.units).some(k=>!(k in OBSERVATION_UNITS))||Object.entries(OBSERVATION_UNITS).some(([k,v])=>o.units[k as keyof typeof OBSERVATION_UNITS]!==v)) throw Error('Invalid observation provenance or SI channel units.');
  if(!Array.isArray(o.series)||o.series.length!==2||o.series.filter(s=>s.role==='fit').length!==1||o.series.filter(s=>s.role==='validation').length!==1||o.series[0].id===o.series[1].id||o.series[0].source===o.series[1].source) throw Error('Provide distinct fit and held-out validation series with independent source identifiers.');
  for(const s of o.series) {
    if(typeof s.id!=='string'||!s.id.trim()||typeof s.source!=='string'||!s.source.trim()||!Number.isFinite(Date.parse(s.recordedAt))||!Number.isFinite(s.maxGapS)||s.maxGapS<=0||s.maxGapS>3600||!Array.isArray(s.rows)||s.rows.length<4||s.rows.length>5000) throw Error('Each observation series needs provenance, a sample-gap bound and 4–5000 rows.');
    s.rows.forEach((r,i)=>{
      if(!r||Object.keys(r).some(k=>!(k in OBSERVATION_UNITS))||Object.keys(OBSERVATION_UNITS).some(k=>!Number.isFinite(r[k as keyof ObservationRow]))||r.t_s<0||r.mechanical_power_w<0||r.bus_voltage_v<=0||r.bus_current_a<0||r.mechanical_power_w>1e6||r.bus_voltage_v>1000||r.bus_current_a>1e4) throw Error('Missing, nonfinite or out-of-range observation channel.');
      if(i && (r.t_s<=s.rows[i-1].t_s || r.t_s-s.rows[i-1].t_s>s.maxGapS+1e-8)) throw Error('Observation time must increase without undeclared gaps.');
    });
  }
  return o;
}
export function parseObservations(text:string) { if(text.length>2_000_000)throw Error('Observation import exceeds 2 MB.');return validateObservations(JSON.parse(text)); }
export function fitPowerModel(observations:Observations, prior:{efficiency:number;idlePowerW:number}, hardware:Scenario['rover']['design']):PowerCalibration {
  const o=validateObservations(observations),train=o.series.find(s=>s.role==='fit')!.rows,held=o.series.find(s=>s.role==='validation')!.rows;
  if(!hardware||!Number.isFinite(prior.efficiency)||prior.efficiency<=0||prior.efficiency>1||!Number.isFinite(prior.idlePowerW)||prior.idlePowerW<0)throw Error('A known drivetrain and finite prior electrical model are required.');
  const meanX=train.reduce((a,r)=>a+r.mechanical_power_w,0)/train.length,meanY=train.reduce((a,r)=>a+r.bus_voltage_v*r.bus_current_a,0)/train.length;
  const variance=train.reduce((a,r)=>a+(r.mechanical_power_w-meanX)**2,0),range=Math.max(...train.map(r=>r.mechanical_power_w))-Math.min(...train.map(r=>r.mechanical_power_w));
  if(range<20||variance/train.length<25)throw Error('Mechanical power excitation is insufficient to identify efficiency and idle demand.');
  const slope=train.reduce((a,r)=>a+(r.mechanical_power_w-meanX)*(r.bus_voltage_v*r.bus_current_a-meanY),0)/variance;
  const efficiency=1/slope,idlePowerW=meanY-slope*meanX;
  if(!Number.isFinite(efficiency)||efficiency<.05||efficiency>1||idlePowerW<0||idlePowerW>10000)throw Error('Fitted parameters are outside the supported electrical model. Check channels and units.');
  const rmse=(rows:ObservationRow[],eta:number,idle:number)=>Math.sqrt(rows.reduce((a,r)=>a+(idle+r.mechanical_power_w/eta-r.bus_voltage_v*r.bus_current_a)**2,0)/rows.length);
  return {schema:'egiz.power_calibration',version:'1.0.0',observations:structuredClone(o),efficiency,idlePowerW,fitRmseW:rmse(train,efficiency,idlePowerW),validationRmseW:rmse(held,efficiency,idlePowerW),priorValidationRmseW:rmse(held,prior.efficiency,prior.idlePowerW),prior,hardware:structuredClone(hardware),scope:'Earth electrical bench only'};
}
export function calibrationError(s:Scenario):string|null {
  if(!s.calibration)return null;
  try {
    const c=s.calibration;
    if(c.schema!=='egiz.power_calibration'||c.version!=='1.0.0'||c.scope!=='Earth electrical bench only'||s.kind!=='earth-analog'||s.environment.planet!=='earth'||s.mode!=='rover'||JSON.stringify(s.rover.design)!==JSON.stringify(c.hardware))throw Error('Calibration applies only to the recorded hardware in a physical Earth rover experiment.');
    const fit=fitPowerModel(c.observations,c.prior,c.hardware);
    for(const k of ['efficiency','idlePowerW','fitRmseW','validationRmseW','priorValidationRmseW'] as const)if(!Number.isFinite(c[k])||Math.abs(c[k]-fit[k])>1e-8)throw Error('Calibration does not reproduce its observation series.');
    if(Math.abs(s.rover.efficiency-fit.efficiency)>1e-8||Math.abs(s.rover.idlePower-fit.idlePowerW)>1e-8)throw Error('Electrical inputs differ from the archived calibration.');
    return null;
  }catch(e){return (e as Error).message;}
}
export function syntheticObservations():Observations {
  return {schema:'egiz.power_observations',version:'1.0.0',synthetic:true,
    provenance:{source:'EGIZ synthetic software control; no field measurements',instrument:'Exact algebraic generator',operator:'EGIZ software fixture',hardwareId:'EGIZ declared drivetrain under test',conditions:'Positive shaft work, no solar input, no regeneration or stall-loss model',uncertainty:'No noise distribution; exact synthetic values are not instrument accuracy'},units:{...OBSERVATION_UNITS},
    series:([['fit',[0,40,100,180,280,400]],['validation',[20,70,140,240,360]]] as const).map(([role,levels])=>({id:`synthetic-${role}`,role,source:`synthetic-independent-input-${role}`,recordedAt:'2026-10-22T00:00:00Z',maxGapS:2,rows:levels.map((p,i)=>({t_s:i*2,mechanical_power_w:p,bus_voltage_v:28,bus_current_a:(65+p/.76)/28}))}))};
}
