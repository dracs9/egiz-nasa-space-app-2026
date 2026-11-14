// Actual measured runs and reproducible original-algorithm benchmarks. Node >=22.18.
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { simulate } from '../web/src/mission/engine.ts';
import { defaultScenario, ENVIRONMENTS } from '../web/src/mission/environment.ts';
import { buildTransfer, transferPlan } from '../web/src/mission/transfer.ts';
const read=name=>JSON.parse(fs.readFileSync(new URL(`../data/pilot/${name}.json`,import.meta.url)));
const bundle=read('mission_terrain'),candidates=read('earth_candidates');
const target=bundle.entries.find(t=>t.id==='MARS_JEZERO');
const earth=bundle.entries.filter(t=>t.body==='earth'&&candidates.tiles.some(c=>c.id===t.id&&c.pool!=='control'&&(c.context.water_frac??1)<=.5));
const output=new URL('../artifacts/',import.meta.url);fs.mkdirSync(output,{recursive:true});
const records=[];
for(const variant of ['reference','low-torque','slope-1deg','heavy-payload','energy-routing']) {
  const s=defaultScenario(target);
  if(variant==='low-torque')s.rover.design.stallTorque=5;
  if(variant==='slope-1deg')s.rover.maxSlope=1;
  if(variant==='heavy-payload')s.rover.mass=1600;
  if(variant==='energy-routing')s.rover.route='astar-energy';
  const start=performance.now(),runs=[simulate(s,target,bundle.inputs)];
  for(const terrain of earth)for(const kind of ['earth-analog','counterfactual'])
    runs.push(simulate({...s,terrainId:terrain.id,kind,environment:{...ENVIRONMENTS[kind==='earth-analog'?'earth':'mars']}},terrain,bundle.inputs));
  const campaign=buildTransfer(runs[0],runs,2),elapsedMs=performance.now()-start;
  records.push({variant,elapsedMs,runs:runs.length,targetOutcome:runs[0].outcome,targetMetrics:runs[0].metrics,selected:campaign.selected,score:campaign.score,baselines:campaign.baselines,subsets:campaign.evaluatedCombinations});
  if(variant==='reference') {
    fs.writeFileSync(new URL('transfer-reference.json',output),JSON.stringify({schema:'egiz.transfer_archive',version:'1.0.0',campaign,runs}));
    fs.writeFileSync(new URL('transfer-field-plan.md',output),transferPlan(campaign,runs[0]));
    fs.writeFileSync(new URL('rover-reference.json',output),JSON.stringify(runs[0]));
  }
}
const report={generatedAt:new Date().toISOString(),runtime:process.version,scope:'One local execution per case, includes solver/state copies, route search and transfer analysis. No rendering or field validation.',inputs:bundle.inputs,records};
fs.writeFileSync(new URL('transfer-benchmark.json',output),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
