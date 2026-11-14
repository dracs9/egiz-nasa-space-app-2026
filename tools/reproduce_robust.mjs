import fs from 'node:fs';
import assert from 'node:assert/strict';
import { simulate } from '../web/src/mission/engine.ts';
import { buildTransfer } from '../web/src/mission/transfer.ts';
import { robustCampaign } from '../web/src/mission/robustCampaign.ts';
const path=process.argv[2];if(!path)throw Error('Usage: node tools/reproduce_robust.mjs archive.json');
const archive=JSON.parse(fs.readFileSync(path));if(archive.schema!=='egiz.robust_transfer_archive')throw Error('Wrong archive schema');
const bundle=JSON.parse(fs.readFileSync(new URL('../data/pilot/mission_terrain.json',import.meta.url)));
let count=0,maxDiff=0;
const cases=archive.archives.map(c=>{
  const runs=c.runs.map(r=>{
    assert.deepEqual(r.terrain,bundle.entries.find(t=>t.id===r.terrain.id),'Measured terrain must match the canonical bundle');assert.deepEqual(r.inputs,bundle.inputs);
    const actual=simulate(r.scenario,r.terrain,r.inputs);assert.equal(actual.frames.length,r.frames.length);assert.equal(actual.outcome,r.outcome);
    for(let i=0;i<r.frames.length;i++)for(const field of ['t','x','y','speed','energyWh']){const diff=Math.abs(actual.frames[i][field]-r.frames[i][field]);maxDiff=Math.max(maxDiff,diff);assert.ok(diff<1e-8+Math.abs(r.frames[i][field])*1e-11);}
    count++;return actual;
  });
  const target=runs.find(r=>r.scenario.kind==='native');const campaign=buildTransfer(target,runs,c.campaign.budget);assert.deepEqual(campaign.selected,c.campaign.selected);assert.ok(Math.abs(campaign.score-c.campaign.score)<1e-12);return {label:c.label,campaign};
});
const result=robustCampaign(cases,archive.result.cases[0].campaign.budget);assert.deepEqual(result.selected,archive.result.selected);assert.ok(Math.abs(result.worstScore-archive.result.worstScore)<1e-12);
console.log(`Reproduced ${count} mission records, ${result.evaluatedSubsets} exact subsets; worst utility ${result.worstScore}; max state difference ${maxDiff}`);
