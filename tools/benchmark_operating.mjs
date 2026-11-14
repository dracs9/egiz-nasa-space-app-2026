// Runs the displayed constraint example on both measured targets; no predetermined outcome.
import fs from 'node:fs';
import {defaultScenario} from '../web/src/mission/environment.ts';
import {executeStudy,executeDecisionMap} from '../web/src/mission/search.ts';
import {syntheticObservations} from '../web/src/mission/observations.ts';
const bundle=JSON.parse(fs.readFileSync(new URL('../data/pilot/mission_terrain.json',import.meta.url)));
const records=[];
for(const id of ['MOON_MONS_MOUTON','MARS_JEZERO']) {
  const terrain=bundle.entries.find(t=>t.id===id),scenario=defaultScenario(terrain);scenario.rover.speed=.2;
  const requirements={maxDurationS:7200,maxEnergyWh:400,minReserveWh:2500,minAltitudeM:1000,maxTouchdownMS:3};
  const study=executeStudy(scenario,terrain,bundle.inputs,requirements,{varySpeed:true,minSpeed:.3,maxSpeed:1.2,samples:5,routes:['astar','astar-energy']});
  const map=executeDecisionMap(study),best=study.options.filter(o=>o.feasible).sort((a,b)=>a.run.metrics.energyWh-b.run.metrics.energyWh)[0];
  fs.mkdirSync(new URL('../artifacts/',import.meta.url),{recursive:true});
  fs.writeFileSync(new URL(`../artifacts/next-${id}.json`,import.meta.url),JSON.stringify({schema:'egiz.engineering_session',version:'1.0.0',study,map}));
  records.push({target:id,baseline:{outcome:study.baseline.run.outcome,metrics:study.baseline.run.metrics,gates:study.baseline.gates},feasible:study.options.filter(o=>o.feasible).length,evaluated:study.options.length,pareto:study.options.filter(o=>o.pareto).map(o=>({speed:o.run.scenario.rover.speed,route:o.run.scenario.rover.route,metrics:o.run.metrics,margin:o.margin})),best:best?{speed:best.run.scenario.rover.speed,route:best.run.scenario.rover.route,metrics:best.run.metrics}:null,elapsedMs:study.elapsedMs,map:{records:map.cells.reduce((n,c)=>n+c.runs.length,0),elapsedMs:map.elapsedMs,distinctWinners:new Set(map.cells.map(c=>c.winnerId)).size,status:map.status}});
}
fs.writeFileSync(new URL('../artifacts/next-operating-benchmark.json',import.meta.url),JSON.stringify({generatedAt:new Date().toISOString(),runtime:process.version,records},null,2));
fs.writeFileSync(new URL('../contracts/examples/power_observations.json',import.meta.url),JSON.stringify(syntheticObservations(),null,2)+'\n');
console.log(JSON.stringify(records,null,2));
