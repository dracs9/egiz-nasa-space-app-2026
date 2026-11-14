import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import bundle from '../../../data/pilot/mission_terrain.json';
import * as storage from './storage';
import { OperatingSearch } from './OperatingSearch';
import { defaultScenario } from './environment';
import { defaultRequirements } from './acceptance';
import { executeStudy } from './search';
import { setLanguage } from '../i18n';
import type { MissionTerrain, TerrainBundle } from './types';
const terrain=bundle.entries.find(t=>t.id==='MARS_JEZERO') as MissionTerrain;
const scenario=defaultScenario(terrain),requirements=defaultRequirements(scenario);
const workers:WorkerStub[]=[];
class WorkerStub {onmessage:((e:{data:unknown})=>void)|null=null;onerror:(()=>void)|null=null;terminate=vi.fn();payload:unknown;constructor(){workers.push(this);}postMessage(payload:unknown){this.payload=payload;}}
let root:ReturnType<typeof createRoot>,host:HTMLDivElement;
beforeEach(()=>{(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;setLanguage('en',false);vi.stubGlobal('Worker',WorkerStub);workers.length=0;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.restoreAllMocks();});
it('terminates a cancelled worker and ignores its late result, then accepts only a new study',async()=>{
  const onRecord=vi.fn(),props={scenario,terrain,bundle:bundle as TerrainBundle,inputs:bundle.inputs,requirements,record:null,onRecord,onOpen:vi.fn(),onCompare:vi.fn(),onDemo:vi.fn(),onEarth:vi.fn(),busy:false,onSeek:vi.fn()};
  await act(async()=>root.render(<OperatingSearch {...props}/>));
  const click=async(text:string)=>act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent===text)!.click();});
  await click('Search fixed requirements');const first=workers[0],deliver=first.onmessage!;
  await click('Cancel study');expect(first.terminate).toHaveBeenCalled();
  await act(async()=>deliver({data:{result:{fake:true}}}));expect(onRecord).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Study cancelled');
  await click('Search fixed requirements');const second=workers[1];
  const result=executeStudy(scenario,terrain,bundle.inputs,requirements,{varySpeed:true,minSpeed:.3,maxSpeed:1.2,samples:5,routes:['astar','astar-energy']});
  await act(async()=>second.onmessage!({data:{result}}));expect(onRecord).toHaveBeenCalledWith({study:result,map:null});
  await click('Search fixed requirements');const third=workers[2],late=third.onmessage!;
  await act(async()=>root.render(<OperatingSearch {...props} requirements={{...requirements,maxDurationS:1}}/>));
  expect(third.terminate).toHaveBeenCalled();await act(async()=>late({data:{result}}));expect(onRecord).toHaveBeenCalledTimes(1);
});
it('reports worker loading failure without accepting a recommendation',async()=>{
  const onRecord=vi.fn();
  await act(async()=>root.render(<OperatingSearch scenario={scenario} terrain={terrain} bundle={bundle as TerrainBundle} inputs={bundle.inputs} requirements={requirements} record={null} onRecord={onRecord} onOpen={()=>{}} onCompare={()=>{}} onDemo={()=>{}} onEarth={()=>{}} busy={false} onSeek={()=>{}}/>));
  await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent==='Search fixed requirements')!.click();});
  await act(async()=>workers[0].onerror!());expect(host.querySelector('[role="alert"]')?.textContent).toContain('Search worker failed');expect(onRecord).not.toHaveBeenCalled();
});

it('reexecutes a saved complete study with its frozen inputs after a new component session',async()=>{
  const storedScenario=structuredClone(scenario);storedScenario.rover.speed=.2;
  const fixed={...requirements,maxEnergyWh:400,maxDurationS:7200,minReserveWh:2500};
  const study=executeStudy(storedScenario,terrain,bundle.inputs,fixed,{varySpeed:true,minSpeed:.3,maxSpeed:1.2,samples:5,routes:['astar','astar-energy']});
  vi.spyOn(storage,'savedEngineeringSessions').mockResolvedValue([{schema:'egiz.engineering_session',version:'1.0.0',study,map:null}]);
  await act(async()=>root.render(<OperatingSearch scenario={scenario} terrain={terrain} bundle={bundle as TerrainBundle} inputs={bundle.inputs} requirements={requirements} record={null} onRecord={()=>{}} onOpen={()=>{}} onCompare={()=>{}} onDemo={()=>{}} onEarth={()=>{}} busy={false} onSeek={()=>{}}/>));
  const savedButton=[...host.querySelectorAll('button')].find(b=>b.textContent?.startsWith('Recompute saved study'))!;
  expect(savedButton).toBeDefined();await act(async()=>savedButton.click());
  const payload=workers[0].payload as {kind:string;scenario:typeof scenario;requirements:typeof requirements};
  expect(payload.kind).toBe('search');expect(payload.scenario.rover.speed).toBe(.2);expect(payload.requirements).toEqual(fixed);expect(scenario.rover.speed).toBe(.8);
});
