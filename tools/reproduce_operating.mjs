// Re-executes every archived solver record and verifies finite-set decisions.
import fs from 'node:fs';
import {simulate} from '../web/src/mission/engine.ts';
import {parseExperiment,verifyImportedTerrain} from '../web/src/mission/storage.ts';
import {evaluateOption,markPareto,searchScenarios} from '../web/src/mission/search.ts';
const file=process.argv[2];if(!file)throw Error('Usage: node tools/reproduce_operating.mjs <session.json>');
const value=JSON.parse(fs.readFileSync(file)),bundle=JSON.parse(fs.readFileSync(new URL('../data/pilot/mission_terrain.json',import.meta.url)));
if(value.schema!=='egiz.engineering_session'||value.version!=='1.0.0'||value.study.schema!=='egiz.operating_study'||value.study.version!=='1.0.0')throw Error('Unsupported session');
const study=value.study;searchScenarios(study.baseline.run.scenario,study.space);
let records=0,maxDifference=0;
function compare(a,b,path=''){
  if(typeof a==='number'&&typeof b==='number') {const d=Math.abs(a-b);maxDifference=Math.max(maxDifference,d);if(!Number.isFinite(d)||d>1e-9+1e-12*Math.abs(a))throw Error(`Numerical mismatch: ${path}`);}
  else if(Array.isArray(a)&&Array.isArray(b)){if(a.length!==b.length)throw Error(`Shape mismatch: ${path}`);a.forEach((v,i)=>compare(v,b[i],`${path}[${i}]`));}
  else if(a&&b&&typeof a==='object'&&typeof b==='object'){if(JSON.stringify(Object.keys(a).sort())!==JSON.stringify(Object.keys(b).sort()))throw Error(`Fields differ: ${path}`);for(const k of Object.keys(a))compare(a[k],b[k],`${path}.${k}`);}
  else if(a!==b)throw Error(`Value mismatch: ${path}`);
}
function reproduce(option){const archived=parseExperiment(JSON.stringify(option.run));verifyImportedTerrain(archived,bundle);const run=simulate(archived.scenario,archived.terrain,archived.inputs);for(const k of ['frames','events','route','metrics','outcome','model','integrator'])compare(archived[k],run[k],k);const checked=evaluateOption(run,study.requirements);compare(option.gates,checked.gates,'gates');compare(option.feasible,checked.feasible,'feasible');compare(option.margin,checked.margin,'margin');records++;return {...checked,run:archived};}
reproduce(study.baseline);const options=study.options.map(reproduce);markPareto(options);options.forEach((o,i)=>compare(study.options[i].pareto,o.pareto,'pareto'));
const allowed=searchScenarios(study.baseline.run.scenario,study.space).map(s=>JSON.stringify(s));for(const o of study.options)if(!allowed.includes(JSON.stringify(o.run.scenario)))throw Error('Candidate changed a fixed input');
if(value.map){const map=value.map;if(map.studyId!==study.id)throw Error('Decision map belongs to another study');for(const cell of map.cells){const options=cell.runs.map(reproduce);const feasible=options.map((r,i)=>({r,i})).filter(o=>o.r.feasible).sort((a,b)=>a.r.run.metrics.energyWh-b.r.run.metrics.energyWh||a.r.run.metrics.duration-b.r.run.metrics.duration);compare(cell.winnerId,feasible.length?map.candidateIds[feasible[0].i]:null,'winner');for(let i=0;i<options.length;i++){const original=study.options.find(o=>o.run.id===map.candidateIds[i]).run.scenario,expected=structuredClone(original);delete expected.calibration;expected.rover.rollingResistance*=cell.rollingFactor;expected.rover.efficiency=Math.min(1,expected.rover.efficiency*cell.efficiencyFactor);compare(expected,options[i].run.scenario,'stress scenario');}}}
console.log(JSON.stringify({verified:true,records,maxDifference,scope:'Recorded model reproduction; no physical validation'},null,2));
