import { useMemo, useRef, useState } from 'react';
import { t, useLanguage } from '../i18n';
import { downloadJson } from '../lib/download';
import { fitPowerModel, parseObservations, syntheticObservations, type Observations } from './observations';
import type { Scenario } from './types';
export function ObservationWorkbench({scenario,onApply,busy}:{scenario:Scenario;onApply(s:Scenario):void;busy:boolean}) {
  useLanguage();
  const [data,setData]=useState<Observations|null>(null),[error,setError]=useState(''),[json,setJson]=useState(false),file=useRef<HTMLInputElement>(null);
  const fit=useMemo(()=>{
    if(!data)return null;
    try{return {value:fitPowerModel(data,{efficiency:scenario.rover.efficiency,idlePowerW:scenario.rover.idlePower},scenario.rover.design),error:''};}catch(e){return {value:null,error:(e as Error).message};}
  },[data,scenario]);
  const c=fit?.value,canApply=scenario.mode==='rover'&&!!scenario.rover.design&&scenario.kind==='earth-analog'&&scenario.environment.planet==='earth';
  const importFile=async(f:File)=>{try{if(f.size>2_000_000)throw Error('Observation import exceeds 2 MB.');const value=parseObservations(await f.text());setData(value);setError('');}catch(e){setData(null);setError((e as Error).message);}};
  return <section className="observation-bench"><span className="eng-kicker">{t('03 / MEASURE → IDENTIFY → HOLD OUT')}</span><h2>{t('Electrical model calibration')}</h2><p>{t('Import known positive mechanical shaft power, bus voltage and current in SI units. Fit efficiency and idle demand on one series; evaluate residuals on a separately identified validation series. Solar input must be excluded from the bus channel.')}</p>
    <div className="study-actions"><button disabled={busy} onClick={()=>file.current?.click()}>{t('Import measurement JSON')}</button><button disabled={busy} onClick={()=>{setData(syntheticObservations());setError('');}}>{t('Load synthetic control')}</button><button onClick={()=>downloadJson(syntheticObservations(),'egiz-synthetic-power-observations.json')}>{t('Download format example')}</button></div>
    <input ref={file} type="file" hidden accept=".json,application/json" onChange={e=>{const f=e.target.files?.[0];if(f)void importFile(f);e.currentTarget.value='';}}/>
    {(error||fit?.error)&&<p role="alert">{t(error||fit?.error)}</p>}
    {c&&<><p className="observation-label">{t(data?.synthetic?'SYNTHETIC SOFTWARE CONTROL · PHYSICAL VALIDATION UNCONFIRMED':'IMPORTED OBSERVATIONS · INDEPENDENT PHYSICAL REVIEW REQUIRED')}</p>
      <dl className="eng-readings"><div><dt>{t('Fitted drivetrain efficiency')}</dt><dd>{(c.efficiency*100).toFixed(2)}%</dd></div><div><dt>{t('Fitted idle demand')}</dt><dd>{c.idlePowerW.toFixed(2)} W</dd></div><div><dt>{t('Fit residual RMSE')}</dt><dd>{c.fitRmseW.toFixed(3)} W</dd></div><div><dt>{t('Held-out residual RMSE')}</dt><dd>{c.validationRmseW.toFixed(3)} W</dd></div><div><dt>{t('Prior model · held-out RMSE')}</dt><dd>{c.priorValidationRmseW.toFixed(3)} W</dd></div></dl>
      <p>{t('Independent series identifiers are declared by the importer. The software cannot establish that measurements were physically independent. Residuals are model discrepancies, not confidence intervals.')}</p><p><code>Pbus = Pidle + Pshaft / η</code></p>
      <details><summary>{t('Observation provenance')}</summary>{Object.entries(data!.provenance).map(([k,v])=><p key={k}><b>{t(k)}</b> · {v}</p>)}{data!.series.map(s=><p key={s.id}>{s.id} · {s.role} · {s.rows.length} {t('samples')} · {s.source}</p>)}</details>
      <div className="study-actions"><button disabled={!canApply||busy} onClick={()=>onApply({...scenario,calibration:c,rover:{...scenario.rover,efficiency:c.efficiency,idlePower:c.idlePowerW}})}>{t(data?.synthetic?'Apply synthetic model to Earth experiment':'Apply model to Earth experiment')}</button><button onClick={()=>downloadJson(c,'egiz-power-calibration.json')}>{t('Export calibration and both series')}</button><button onClick={()=>setJson(v=>!v)}>{t('Review measurement JSON')}</button></div>
      {!canApply&&<p className="bench-warning">{t('Select a physical Earth rover experiment to apply this electrical model. Planetary soil, temperature, traction and rolling resistance remain unchanged and uncalibrated.')}</p>}
      {json&&<textarea className="bench-json" aria-label={t('Measurement JSON')} value={JSON.stringify(data,null,2)} readOnly/>}
    </>}
    {scenario.calibration&&<p className="observation-label">{t(scenario.calibration.observations.synthetic?'Active model: synthetic electrical control':'Active model: imported Earth electrical calibration')}</p>}
  </section>;
}
