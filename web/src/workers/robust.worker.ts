import { simulate } from '../mission/engine';
import { buildTransfer } from '../mission/transfer';
import { robustCampaign } from '../mission/robustCampaign';
import type { RunResult } from '../mission/types';
self.onmessage=(event:MessageEvent<{runs:RunResult[];budget:number}>)=>{
  try{
    const {runs,budget}=event.data;if(runs.length>25||runs.length<3)throw Error('Stress study requires a bounded matched campaign');
    if(runs.reduce((n,r)=>n+r.frames.length,0)>50000)throw Error('Stress ensemble exceeds 50,000 baseline state budget; shorten the regional experiment');
    const variants=[{label:'Nominal',traction:1,resistance:1,efficiency:1},{label:'Traction −20%',traction:.8,resistance:1,efficiency:1},{label:'Rolling resistance +30%',traction:1,resistance:1.3,efficiency:1},{label:'Efficiency −10%',traction:1,resistance:1,efficiency:.9},{label:'Combined adverse assumptions',traction:.8,resistance:1.3,efficiency:.9}];
    const cases=variants.map((v,i)=>{
      const records=i===0?runs:runs.map(r=>simulate({...r.scenario,rover:{...r.scenario.rover,traction:r.scenario.rover.traction*v.traction,rollingResistance:r.scenario.rover.rollingResistance*v.resistance,efficiency:r.scenario.rover.efficiency*v.efficiency}},r.terrain,r.inputs));
      const target=records.find(r=>r.scenario.kind==='native')!;const campaign=buildTransfer(target,records,budget);
      self.postMessage({progress:`Stress case ${i+1}/${variants.length} · ${records.length} actual mission records`});return {label:v.label,campaign,runs:records};
    });
    self.postMessage({result:robustCampaign(cases,budget),archives:cases});
  }catch(e){self.postMessage({error:(e as Error).message});}
};
