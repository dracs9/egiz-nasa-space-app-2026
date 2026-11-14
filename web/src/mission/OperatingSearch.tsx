import { useEffect, useRef, useState } from 'react';
import { t, useLanguage } from '../i18n';
import { downloadJson } from '../lib/download';
import { savedEngineeringSessions, saveEngineeringSession, type EngineeringSession, parseExperiment, verifyImportedTerrain } from './storage';
import { requirementsValid, type TestRequirements } from './acceptance';
import { chronographEvents, gateLevers } from './chronograph';
import { searchScenarios, type DecisionMap, type DesignStudy, type SearchSpace } from './search';
import { verifyImportedGeometry } from './solar';
import type { MissionTerrain, RunResult, Scenario, TerrainBundle } from './types';
function manifestScenario(s:Scenario) {
  const {solar,calibration,...fixed}=s;
  return {...fixed,solar:solar?{...solar,samples:undefined,recordedSamples:solar.samples.length}:undefined,calibration:calibration?{schema:calibration.schema,version:calibration.version,efficiency:calibration.efficiency,idlePowerW:calibration.idlePowerW,scope:calibration.scope,synthetic:calibration.observations.synthetic,provenance:calibration.observations.provenance,series:calibration.observations.series.map(s=>({id:s.id,role:s.role,source:s.source,samples:s.rows.length}))}:undefined};
}
export interface SearchRecord {study:DesignStudy;map:DecisionMap|null}
export function OperatingSearch({scenario,terrain,bundle,inputs,requirements,record,onRecord,onOpen,onCompare,onDemo,onEarth,busy,onSeek}: {
  scenario:Scenario;terrain:MissionTerrain;bundle:TerrainBundle;inputs:Record<string,string>;requirements:TestRequirements;record:SearchRecord|null;
  onRecord(r:SearchRecord):void;onOpen(r:RunResult,limits:TestRequirements):void;onCompare(runs:RunResult[]):void;onDemo():void;onEarth():void;busy:boolean;onSeek(t:number):void;
}) {
  useLanguage();
  const [space,setSpace]=useState<SearchSpace>({varySpeed:true,minSpeed:.3,maxSpeed:1.2,samples:5,routes:['astar','astar-energy']}),[pending,setPending]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState(''),[json,setJson]=useState(false),[preference,setPreference]=useState<'energy'|'time'|'margin'>('energy'),[saved,setSaved]=useState<EngineeringSession[]>([]),[storageStatus,setStorageStatus]=useState('');
  const worker=useRef<Worker|null>(null),revision=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),file=useRef<HTMLInputElement>(null);
  const cancel=()=>{revision.current++;worker.current?.terminate();worker.current=null;clearTimeout(timer.current);setPending(false);setProgress('Study cancelled. No partial recommendation was accepted.');};
  useEffect(()=>{let alive=true;savedEngineeringSessions().then(s=>{if(alive)setSaved(s);}).catch(()=>{if(alive)setStorageStatus("Local study storage is unavailable. Complete JSON export remains available.");});return ()=>{alive=false;};},[]);
  useEffect(()=>()=>{revision.current++;worker.current?.terminate();clearTimeout(timer.current);},[]);
  useEffect(()=>{cancel();setProgress('');},[scenario,requirements]);
  const dispatch=(payload:unknown,done:(result:DesignStudy|DecisionMap)=>void)=>{
    const id=++revision.current;worker.current?.terminate();clearTimeout(timer.current);setPending(true);setError('');setProgress('Calculating recorded alternatives…');
    let w:Worker;
    try{w=new Worker(new URL('../workers/search.worker.ts',import.meta.url),{type:'module'});}catch(e){setPending(false);setError((e as Error).message);return;}
    worker.current=w;
    const finish=()=>{w.terminate();clearTimeout(timer.current);worker.current=null;setPending(false);};
    timer.current=setTimeout(()=>{if(id!==revision.current)return;finish();setError('Study exceeded 30 seconds. Reduce the search space.');},30000);
    w.onmessage=e=>{if(id!==revision.current)return;if(e.data.progress){setProgress(`${e.data.progress.done} / ${e.data.progress.total}`);return;}finish();if(e.data.error){setError(e.data.error);return;}setProgress('');done(e.data.result);};
    w.onerror=()=>{if(id!==revision.current)return;finish();setError('Search worker failed. Reload or check packaged worker assets.');};w.postMessage(payload);
  };
  const start=()=>dispatch({kind:'search',scenario,terrain,inputs,requirements,space},r=>onRecord({study:r as DesignStudy,map:null}));
  async function recomputeSession(value:EngineeringSession, importRevision=revision.current) {
    try {
      if(value.schema!=='egiz.engineering_session'||value.version!=='1.0.0'||value.study?.schema!=='egiz.operating_study'||value.study?.version!=='1.0.0'||!requirementsValid(value.study.requirements))throw Error('Unsupported study archive.');
      const base=parseExperiment(JSON.stringify(value.study.baseline.run));verifyImportedTerrain(base,bundle);searchScenarios(base.scenario,value.study.space);
      if(base.scenario.solar)base.scenario.solar=await verifyImportedGeometry(base.scenario.solar,base.terrain);
      if(importRevision!==revision.current)return;
      setSpace(value.study.space);
      dispatch({kind:'search',scenario:base.scenario,terrain:base.terrain,inputs:base.inputs,requirements:value.study.requirements,space:value.study.space},r=>{
        const study=r as DesignStudy;onRecord({study,map:null});
        if(value.map)dispatch({kind:'map',study},m=>onRecord({study,map:m as DecisionMap}));
      });
    }catch(e){if(importRevision===revision.current)setError((e as Error).message);}
  }
  async function importStudy(f:File) {
    const importRevision=revision.current;
    try {if(f.size>256_000_000)throw Error('Study import exceeds 256 MB.');const value=JSON.parse(await f.text());if(importRevision===revision.current)await recomputeSession(value,importRevision);}
    catch(e){if(importRevision===revision.current)setError((e as Error).message);}
  }
  async function saveSession(){
    if(!record)return;
    try{await saveEngineeringSession({schema:'egiz.engineering_session',version:'1.0.0',...record});setSaved(await savedEngineeringSessions());setStorageStatus('Complete study saved on this device, including all solver and stress records.');}
    catch(e){setStorageStatus((e as Error).message);}
  }
  const study=record?.study,map=record?.map;
  const options=study?.options??[],feasible=options.filter(o=>o.feasible),failureCounts=new Map<string,number>();
  for(const o of options)for(const g of o.gates.filter(g=>g.status!=='pass'))failureCounts.set(g.id,(failureCounts.get(g.id)??0)+1);
  const limiting=[...failureCounts].sort((a,b)=>b[1]-a[1]);
  const recommended=[...feasible].sort((a,b)=>preference==='time'?a.run.metrics.duration-b.run.metrics.duration:preference==='margin'?(b.margin??-Infinity)-(a.margin??-Infinity):a.run.metrics.energyWh-b.run.metrics.energyWh)[0];
  const snapshot=study&&JSON.stringify([study.baseline.run.scenario,study.requirements,study.space])!==JSON.stringify([scenario,requirements,space]);
  let invalid='';try{searchScenarios(scenario,space);}catch(e){invalid=(e as Error).message;}
  const exported=record?{schema:'egiz.engineering_session',version:'1.0.0',...record}:null;
  const manifest=study?{schema:'egiz.engineering_manifest',version:'1.0.0',studyId:study.id,requirements:study.requirements,space:study.space,status:study.status,planned:study.planned,elapsedMs:study.elapsedMs,terrain:study.baseline.run.terrain.source,inputs:study.baseline.run.inputs,records:[study.baseline,...study.options].map(o=>({id:o.run.id,scenario:manifestScenario(o.run.scenario),outcome:o.run.outcome,metrics:o.run.metrics,gates:o.gates,feasible:o.feasible,pareto:o.pareto,margin:o.margin,states:o.run.frames.length})),decisionMap:map?{candidateIds:map.candidateIds,status:map.status,cells:map.cells.map(c=>({rollingFactor:c.rollingFactor,efficiencyFactor:c.efficiencyFactor,winnerId:c.winnerId,records:c.runs.map(o=>({id:o.run.id,metrics:o.run.metrics,gates:o.gates,states:o.run.frames.length}))}))}:null,note:'Manifest only. Export complete study for all terrain and telemetry samples.'}:null;
  return <section className="operating-search">
    <span className="eng-kicker">{t('01 / CONSTRAINED OPERATING STUDY')}</span><h3>{t('Find a feasible operating mode')}</h3>
    <p>{t('Mass, payload, battery, drivetrain, terrain and requirements stay fixed. Search changes commanded speed and permitted route objectives. This is an operating parameter study, not a hardware design.')}</p>
    <button className="study-demo" disabled={pending||busy} onClick={onDemo}>{t('Load the mission constraint example')}</button>
    <details><summary>{t('Allowed parameters and ranges')}</summary><fieldset disabled={pending||busy}>
      <label className="study-check"><input type="checkbox" checked={space.varySpeed} onChange={e=>setSpace({...space,varySpeed:e.target.checked})}/>{t('Vary commanded speed')}</label>
      <div className="study-bounds">{([['minSpeed','Minimum speed'],['maxSpeed','Maximum speed'],['samples','Speed samples']] as const).map(([key,label])=><label className="ml-field" key={key}><span>{t(label)} {key==='samples'?'':'m/s'}</span><input type="number" aria-label={t(label)} step={key==='samples'?1:.1} min={key==='samples'?2:.01} max={key==='samples'?7:5} value={Number.isFinite(space[key])?space[key]:''} onChange={e=>setSpace({...space,[key]:e.target.value===''?NaN:Number(e.target.value)})}/></label>)}</div>
      {(['astar','astar-energy','direct'] as const).map(route=><label key={route} className="study-check"><input type="checkbox" checked={space.routes.includes(route)} onChange={e=>setSpace({...space,routes:e.target.checked?[...space.routes,route]:space.routes.filter(r=>r!==route)})}/>{t(route==='astar'?'Shortest admissible route':route==='astar-energy'?'Minimum gross electrical energy':'Direct route feasibility')}</label>)}
    </fieldset></details>
    <div className="study-actions"><button className="ml-primary" disabled={pending||busy||!!invalid||!requirementsValid(requirements)} onClick={start}>{t('Search fixed requirements')}</button>{pending&&<button onClick={cancel}>{t('Cancel study')}</button>}</div>
    <p className="ml-tiny">{t('12 s compute budget; at most 21 alternatives. Each result contains a complete solver record. Unfinished routes never count as resource savings.')}</p>
    <p role="status">{t(progress)}</p>{error&&<p role="alert" className="bench-warning">{t(error)}</p>}
    <input hidden ref={file} type="file" accept="application/json,.json" onChange={e=>{const f=e.target.files?.[0];if(f)void importStudy(f);e.currentTarget.value='';}}/>
    <button disabled={pending||busy} onClick={()=>file.current?.click()}>{t('Import & recompute study')}</button>
    <p className="ml-tiny" role="status">{t(storageStatus)}</p>
    {saved.length>0&&<details><summary>{t('Saved complete studies on this device')} · {saved.length}</summary>{saved.map(s=><button className="study-event" key={s.study.id} disabled={pending||busy} onClick={()=>void recomputeSession(s)}>{t('Recompute saved study')} · {s.study.createdAt.slice(0,16).replace('T',' ')} UTC · {s.study.baseline.run.terrain.name.split(' / ')[0]}</button>)}</details>}
    {study&&<>
      <div className="study-summary"><span>{t('Feasible modes')}<b>{feasible.length} / {options.length}</b></span><span>{t('Actual computation')}<b>{(study.elapsedMs/1000).toFixed(2)} s</b></span><span>{t('Fixed energy ceiling')}<b>{study.requirements.maxEnergyWh} Wh</b></span></div>
      {snapshot&&<p className="bench-warning">{t('Archived study snapshot. The current configuration or requirements differ. Open a record to restore its inputs and fixed requirements.')}</p>}
      {study.status!=='complete'&&<p className="bench-warning">{t('Compute budget reached. The evaluated subset is shown; the remaining search space is unknown.')}</p>}
      {!feasible.length&&<p className="bench-warning">{t('No feasible option in the evaluated set. The fixed requirements have not been relaxed.')}</p>}
      {recommended&&<article className="study-recommendation"><span className="eng-kicker">{t("RECOMMENDED WITHIN EVALUATED SET")}</span><label className="ml-field"><span>{t("Decision priority")}</span><select aria-label={t("Decision priority")} value={preference} onChange={e=>setPreference(e.target.value as typeof preference)}><option value="energy">{t("Lowest energy")}</option><option value="time">{t("Shortest time")}</option><option value="margin">{t("Largest supported resource slack")}</option></select></label><b>{recommended.run.scenario.rover.speed.toFixed(2)} m/s · {recommended.run.scenario.rover.route}</b><p>{recommended.run.metrics.energyWh.toFixed(2)} Wh · {recommended.run.metrics.duration.toFixed(2)} s · {t("All fixed requirements pass in the declared model.")}</p><div className="study-actions"><button onClick={()=>onOpen(recommended.run,study.requirements)}>{t("Open recommended record")}</button><button onClick={()=>onCompare([study.baseline.run,recommended.run])}>{t("Compare A/B")}</button></div></article>}
      <article className="study-baseline"><b>{t('Computed starting configuration')}</b><p>{t(study.baseline.run.outcome.replaceAll('_',' '))} · {study.baseline.run.metrics.duration.toFixed(0)} s · {study.baseline.run.metrics.energyWh.toFixed(1)} Wh</p><button onClick={()=>onOpen(study.baseline.run,study.requirements)}>{t('Open baseline record')}</button></article>
      <div className="study-trade" role="img" aria-label={t('Calculated energy and duration trade-off')}><svg viewBox="0 0 280 160"><path d="M30 10V135H270"/><text x="32" y="156">{t('Time')} / s</text><text x="32" y="12">Wh</text>{options.map((o,i)=>{const x=34+o.run.metrics.duration/Math.max(1,...options.map(r=>r.run.metrics.duration))*222,y=130-o.run.metrics.energyWh/Math.max(1,...options.map(r=>r.run.metrics.energyWh))*105;return <g key={o.run.id}><circle cx={x} cy={y} r={o.pareto?5:3} data-feasible={o.feasible}><title>{i+1} · {o.run.metrics.duration.toFixed(1)} s / {o.run.metrics.energyWh.toFixed(1)} Wh</title></circle></g>;})}</svg><small>{t('Gold: feasible · hollow: failed task or requirement · larger: Pareto option')}</small></div>
      <details><summary>{t("All calculated alternatives")} · {options.length}</summary><div className="study-options">{options.map((o,i)=><article key={o.run.id} data-feasible={o.feasible}><div><b>{String(i+1).padStart(2,'0')} / {o.run.scenario.rover.speed.toFixed(2)} m/s</b><span>{o.run.scenario.rover.route} · {t(o.feasible?'Pass':'Fail')}{o.pareto?' · P':''}</span></div><p>{o.run.metrics.energyWh.toFixed(1)} Wh · {o.run.metrics.duration.toFixed(0)} s · {t('Resource slack')} {o.margin===null?'—':`${(o.margin*100).toFixed(1)}%`}</p><small>{o.gates.filter(g=>g.status!=='pass').map(g=>t(g.label)).join(' · ')}</small><div className="study-actions"><button onClick={()=>onOpen(o.run,study.requirements)}>{t('Open record')}</button><button onClick={()=>onCompare([study.baseline.run,o.run])}>{t('Compare A/B')}</button></div></article>)}</div></details>
      <h4>{t('What limits the result?')}</h4>{limiting.map(([id,count])=><div className="study-cause" key={id}><b>{t(options[0]?.gates.find(g=>g.id===id)?.label??id)} · {count}/{options.length}</b><p>{(gateLevers[id]??[]).map(t).join(' · ')}</p></div>)}
      <h4>{t('Locate the starting violation')}</h4>{chronographEvents(study.baseline.run,study.requirements).filter(e=>e.gate).map((e,i)=><button className="study-event" key={i} onClick={()=>{onOpen(study.baseline.run,study.requirements);onSeek(e.t);}}>{t(e.type)} · T+{e.t.toFixed(1)} s · E {e.x.toFixed(0)} / N {e.y.toFixed(0)}</button>)}
      <button disabled={pending||busy||!options.length} onClick={()=>dispatch({kind:'map',study},m=>onRecord({study,map:m as DecisionMap}))}>{t('Calculate decision switch map')}</button>
      {map&&<div className="decision-map"><p>{t('Efficiency is capped at 1.')} </p><p>{t('Finite stress cases: rolling resistance × drivetrain efficiency. Choose the lowest-energy feasible record among the displayed candidates. These are assumptions, not measurement errors or success probabilities.')}</p><div className="decision-grid"><span> Crr / η </span>{[.85,1,1.05].map(f=><b key={f}>{f}× η</b>)}{[.8,1,1.3].map(r=><div className="decision-row" key={r}><b>{r}× Crr</b>{[.85,1,1.05].map(f=>{const c=map.cells.find(c=>c.rollingFactor===r&&c.efficiencyFactor===f),winner=c?.winnerId?options.findIndex(o=>o.run.id===c.winnerId)+1:null;return <button key={f} disabled={!c} onClick={()=>{if(c)onCompare(c.runs.map(o=>o.run));}} title={t('Open actual stress records')}>{c?winner?`#${winner}`:'∅':'—'}</button>;})}</div>)}</div><p className="ml-tiny">{map.candidateIds.map(id=>`#${options.findIndex(o=>o.run.id===id)+1}`).join(' / ')} · {map.cells.reduce((a,c)=>a+c.runs.length,0)} {t('actual records')} · {(map.elapsedMs/1000).toFixed(2)} s · {t(map.status==='complete'?'Complete finite grid':'Partial finite grid')}</p></div>}
      <div className="study-actions"><button disabled={pending||busy} onClick={()=>void saveSession()}>{t('Save complete study on this device')}</button><button onClick={()=>downloadJson(exported,'egiz-engineering-session.json')}>{t('Export complete study')}</button><button aria-pressed={json} onClick={()=>setJson(v=>!v)}>{t('Review study manifest')}</button><button onClick={onEarth}>{t('Prepare Earth verification →')}</button></div>
      {json&&<textarea className="bench-json" readOnly aria-label={t('Study manifest JSON')} value={JSON.stringify(manifest,null,2)}/>}
    </>}
  </section>;
}
