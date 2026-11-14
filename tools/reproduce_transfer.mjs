import fs from 'node:fs';
import { parseExperiment, verifyImportedTerrain } from '../web/src/mission/storage.ts';
import { simulate } from '../web/src/mission/engine.ts';
import { buildTransfer } from '../web/src/mission/transfer.ts';
const file=process.argv[2];if(!file)throw new Error('Usage: node tools/reproduce_transfer.mjs campaign.json');
const archive=JSON.parse(fs.readFileSync(file,'utf8'));
if(archive.schema!=='egiz.transfer_archive'||archive.version!=='1.0.0'||!Array.isArray(archive.runs)||archive.runs.length>25)throw new Error('Invalid transfer archive');
const bundle=JSON.parse(fs.readFileSync(new URL('../data/pilot/mission_terrain.json',import.meta.url)));
const runs=archive.runs.map(raw=>{
  const r=parseExperiment(JSON.stringify(raw));verifyImportedTerrain(r,bundle);
  if(r.scenario.solar)throw new Error('Transfer protocol excludes solar charging');
  const calculated=simulate(r.scenario,r.terrain,r.inputs);
  if(calculated.outcome!==r.outcome)throw new Error('Recalculated outcome differs');
  for(const key of Object.keys(calculated.metrics)) {
    const a=calculated.metrics[key],b=r.metrics[key];
    if(typeof a==='number' && (typeof b!=='number'||Math.abs(a-b)>1e-9+1e-12*Math.abs(a)))throw new Error(`Metric differs: ${key}`);
  }
  return calculated;
});
const c=buildTransfer(runs.find(r=>r.scenario.kind==='native'),runs,archive.campaign.budget);
if(JSON.stringify(c.selected)!==JSON.stringify(archive.campaign.selected)||Math.abs(c.score-archive.campaign.score)>1e-12)throw new Error('Campaign differs from actual recalculation');
console.log(JSON.stringify({passed:true,runs:runs.length,selected:c.selected,score:c.score,subsets:c.evaluatedCombinations,model:c.model},null,2));
