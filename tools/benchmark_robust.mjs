// Re-execute authentic measured terrain missions under declared assumption stresses.
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { simulate } from '../web/src/mission/engine.ts';
import { buildTransfer } from '../web/src/mission/transfer.ts';
import { robustCampaign } from '../web/src/mission/robustCampaign.ts';
const reference=JSON.parse(fs.readFileSync(new URL('../artifacts/transfer-reference.json',import.meta.url)));
const variants=[['Nominal',1,1,1],['Traction −20%',.8,1,1],['Rolling resistance +30%',1,1.3,1],['Efficiency −10%',1,1,.9],['Combined adverse assumptions',.8,1.3,.9]];
const start=performance.now();
const cases=variants.map(([label,traction,resistance,efficiency])=>{
  const runs=reference.runs.map(r=>simulate({...r.scenario,rover:{...r.scenario.rover,traction:r.scenario.rover.traction*traction,rollingResistance:r.scenario.rover.rollingResistance*resistance,efficiency:r.scenario.rover.efficiency*efficiency}},r.terrain,r.inputs));
  return {label,campaign:buildTransfer(runs[0],runs,2),runs};
});
const result=robustCampaign(cases,2);
fs.writeFileSync(new URL('../artifacts/robust-transfer.json',import.meta.url),JSON.stringify({schema:'egiz.robust_transfer_archive',version:'1.0.0',result,archives:cases}));
console.log(JSON.stringify({elapsedMs:performance.now()-start,runs:cases.reduce((n,c)=>n+c.runs.length,0),selected:result.selected,worstScore:result.worstScore,meanScore:result.meanScore,nominalWorst:result.nominalSelectionWorstScore,geometryWorst:result.geometrySelectionWorstScore,regret:result.regret,measurements:result.measurements},null,2));
