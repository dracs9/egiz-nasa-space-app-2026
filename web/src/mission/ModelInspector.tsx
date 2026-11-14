import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, Boxes, Check, Focus, Layers3, LoaderCircle, RotateCcw, Search, X } from 'lucide-react';
import { t, useLanguage } from '../i18n';
import { EQUIPMENT_ASSETS,equipmentAsset,configuredParts,referenceForMode,type EquipmentPartId,type EquipmentId } from './modelCatalog';
import { createModelStudio } from './scene/modelStudio';
import type { Scenario } from './types';
import './studio.css';

export default function ModelInspector({scenario,onClose,initialModel}:{scenario:Scenario;onClose():void;initialModel?:EquipmentId}) {
  useLanguage();
  const [assetId,setAssetId]=useState<EquipmentId>(initialModel??referenceForMode(scenario.mode));
  const asset=equipmentAsset(assetId);
  const [source,setSource]=useState<'nasa'|'egiz'>('nasa'),[part,setPart]=useState<EquipmentPartId>('chassis'),[mesh,setMesh]=useState(''),[query,setQuery]=useState(''),[parts,setParts]=useState<{name:string;part:EquipmentPartId}[]>([]),[ready,setReady]=useState(false),[error,setError]=useState(''),[explode,setExplode]=useState(0),[xray,setXray]=useState(false),[hotspots,setHotspots]=useState(true),[points,setPoints]=useState<{id:EquipmentPartId;x:number;y:number;visible:boolean}[]>([]);
  const host=useRef<HTMLDivElement>(null),dialog=useRef<HTMLDialogElement>(null),studio=useRef<ReturnType<typeof createModelStudio>|null>(null);
  const selection=useRef({part,mesh});selection.current={part,mesh};
  const components=source==='nasa'?asset.parts:configuredParts(scenario.mode);
  const current=components.find(p=>p.id===part)??components[0];
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const modal=dialog.current!;modal.showModal();const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
    const cancel=(e:Event)=>{e.preventDefault();onClose();};modal.addEventListener('cancel',cancel);
    return()=>{modal.removeEventListener('cancel',cancel);document.body.style.overflow=overflow;previous?.focus({preventScroll:true});};
  },[onClose]);
  useEffect(()=>{
    let active=true;setReady(false);setError('');setParts([]);setPoints([]);setExplode(0);setXray(false);setMesh('');setQuery('');setPart((source==='nasa'?asset.parts:configuredParts(scenario.mode))[0].id);
    try {studio.current=createModelStudio({host:host.current!,source,scenario,asset:assetId,onReady:values=>{if(!active)return;setParts(values);setReady(true);studio.current?.select(selection.current.part);},onPick:(id,name)=>{setPart(id);setMesh(name??'');},onProject:values=>{if(active)setPoints(values);},onError:message=>{if(active)setError(message);}});}catch(e){setError((e as Error).message);}
    return()=>{active=false;studio.current?.dispose();studio.current=null;};
  },[source,scenario,assetId]);
  useEffect(()=>{studio.current?.select(part,mesh);},[part,mesh,ready]);
  const select=(id:EquipmentPartId,name='')=>{setPart(id);setMesh(name);studio.current?.select(id,name,true);};
  const available=components.filter(p=>parts.some(m=>m.part===p.id));
  const move=(delta:number)=>{const i=available.findIndex(p=>p.id===part);select(available[(i+delta+available.length)%available.length].id);};
  return createPortal(<dialog ref={dialog} className="model-dialog" aria-labelledby="model-studio-title">
    <header className="studio-header"><div><Boxes size={21}/><h2 id="model-studio-title">{t('Equipment studio')}</h2></div><button className="studio-close" aria-label={t('Close equipment studio')} onClick={onClose}><X size={20}/></button></header>
    <div className="studio-source" role="group" aria-label={t('Equipment model')}>
      <button aria-pressed={source==='nasa'} onClick={()=>setSource('nasa')}>{t('NASA reference')}</button>
      <button aria-pressed={source==='egiz'} onClick={()=>setSource('egiz')}>{t('Your configured vehicle')}<span>EGIZ</span></button>
    {source==='nasa'&&<label className="studio-asset-picker"><span className="sr-only">{t('Reference equipment')}</span><select aria-label={t('Reference equipment')} value={assetId} onChange={e=>setAssetId(e.target.value as EquipmentId)}>{EQUIPMENT_ASSETS.map(item=><option key={item.id} value={item.id}>{t(item.title)}</option>)}</select></label>}
    </div>
    <div className="studio-layout"><section className="studio-world" aria-label={t('Mechanical model inspection')}>
      <div ref={host} className="studio-canvas"/>
      {hotspots&&ready&&points.filter(p=>components.some(c=>c.id===p.id)).map(p=><button key={p.id} className={`studio-hotspot ${part===p.id?'active':''}`} style={{left:p.x,top:p.y,visibility:p.visible?'visible':'hidden'}} aria-label={t(components.find(x=>x.id===p.id)!.label)} title={t(components.find(x=>x.id===p.id)!.label)} onClick={()=>select(p.id)}>{components.findIndex(x=>x.id===p.id)+1}</button>)}
      {!ready&&!error&&<div className="studio-loading" role="status"><LoaderCircle className="loading-spinner" size={25}/>{t('Loading detailed model…')}</div>}
      {error&&<div className="studio-loading" role="alert"><p>{t('Model could not be loaded.')}</p><small>{error}</small><button onClick={()=>setSource('egiz')}>{t('Open configured vehicle')}</button></div>}
      <div className="studio-view-tools"><button title={t('Reset model camera')} aria-label={t('Reset model camera')} onClick={()=>studio.current?.reset()}><RotateCcw size={17}/></button><button title={t('Focus selected component')} aria-label={t('Focus selected component')} onClick={()=>studio.current?.select(part,mesh,true)}><Focus size={17}/></button><button title={t('Component guide')} aria-label={t('Component guide')} aria-pressed={hotspots} onClick={()=>setHotspots(!hotspots)}><span>01</span></button><button title={t('Isolate component')} aria-label={t('Isolate component')} aria-pressed={xray} onClick={()=>{setXray(!xray);studio.current?.xray(!xray);}}><Layers3 size={17}/></button></div>
      <div className="studio-source-credit">{source==='nasa'?<>{asset.credit} · <a href={asset.source} target="_blank" rel="noreferrer">{t('Model source')}</a></>:t('Configured EGIZ assembly')}<span>{t('Drag to orbit · scroll to zoom')}</span></div>
    </section><aside className="studio-guide" aria-label={t('Component guide')}>
      <div className="studio-guide-heading"><span>{t('COMPONENT GUIDE')}</span><b>{String(components.findIndex(p=>p.id===current.id)+1).padStart(2,'0')}</b></div>
      <h3>{t(current.label)}</h3><p>{t(current.description)}</p>
      {source==='nasa'&&asset.inspectionRegions&&<details className="studio-region-note"><summary>{t('About inspection regions')}</summary><p>{t('Parts are grouped by geometric regions for inspection. These are approximate display boundaries, not separate flight CAD components. Source geometry and materials are preserved.')}</p></details>}
      {source==='egiz'&&<div className="studio-model-connection"><Check size={15}/><p>{t(current.connection)}</p></div>}
      {mesh&&<div className="studio-selected-mesh"><span>{t('Selected part')}</span><code>{mesh}</code></div>}
      <div className="studio-guide-nav"><button disabled={!available.length} aria-label={t('Previous component')} onClick={()=>move(-1)}><ArrowLeft size={17}/></button><div>{t('Select a part in 3D')}</div><button disabled={!available.length} aria-label={t('Next component')} onClick={()=>move(1)}><ArrowRight size={17}/></button></div>
      <div className="studio-parts">{components.map((p,i)=><button key={p.id} aria-pressed={part===p.id} disabled={ready&&!parts.some(m=>m.part===p.id)} onClick={()=>select(p.id)}><span>{String(i+1).padStart(2,'0')}</span>{t(p.label)}<ArrowRight size={12}/></button>)}</div>
      <details className="studio-detail-tree"><summary>{t('All model parts')} <b>{parts.length}</b></summary><label><Search size={14}/><input aria-label={t('Find a model part')} placeholder={t('Find a model part')} value={query} onChange={e=>setQuery(e.target.value)}/></label><div>{parts.filter(p=>p.name.toLowerCase().includes(query.toLowerCase())).map((p,i)=><button key={`${p.name}-${i}`} aria-pressed={mesh===p.name} onClick={()=>select(p.part,p.name)}>{p.name}</button>)}</div></details>
    </aside></div>
    <footer className="studio-footer"><label><Boxes size={17}/><span>{t('Exploded inspection')}</span><input aria-label={t('Studio exploded assembly')} type="range" min="0" max="1" step=".01" value={explode} onChange={e=>{const value=Number(e.target.value);setExplode(value);studio.current?.explode(value);}}/></label><span>{source==='nasa'?t('NASA reference · visual inspection'):t('Your design · shared simulation geometry')}</span></footer>
  </dialog>,document.body);
}
