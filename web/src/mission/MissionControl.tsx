import { ContextHelp } from '../components/ContextHelp';
import { t as localizeText, useLanguage } from '../i18n';
import { useEffect, useRef, useState } from "react";
import type { DynamicsRun } from "./dynamics";
import type { RunResult } from "./types";
export function MissionControl({run,time}:{run:RunResult|DynamicsRun|null;time:number}) {
  useLanguage();
  const iframe=useRef<HTMLIFrameElement>(null),[ready,setReady]=useState(false),[error,setError]=useState("");
  const latestTime=useRef(time);latestTime.current=time;
  useEffect(()=>{
    const receive=(event:MessageEvent)=>{
      if(event.origin!==location.origin||event.source!==iframe.current?.contentWindow)return;
      if(event.data?.type==="egiz-mct-ready")setReady(true);
      if(event.data?.type==="egiz-mct-error")setError(String(event.data.error));
    };
    window.addEventListener("message",receive);return()=>window.removeEventListener("message",receive);
  },[]);
  useEffect(()=>{if(ready&&run)iframe.current?.contentWindow?.postMessage({type:"egiz-record",run,time},location.origin);},[ready,run]);
  useEffect(()=>{
    if(!ready)return;
    // Batch delivery only; this interval never advances or generates mission time.
    const send=()=>iframe.current?.contentWindow?.postMessage({type:"egiz-clock",time:latestTime.current},location.origin);
    send();const id=window.setInterval(send,100);return()=>window.clearInterval(id);
  },[ready]);
  return <div className="eng-workbench"><div className="eng-title"><div><span className="eng-kicker">{localizeText("NASA OPEN MCT 4.3.1 / AUTHENTIC RECORDED TELEMETRY")}</span><h2>{localizeText("Mission Control")}</h2><ContextHelp label="Model & assumptions"><p>{localizeText("NASA's telemetry application consumes this EGIZ run. Seek or play the active experiment timeline to change the data horizon. No second simulation clock runs here.")}</p></ContextHelp></div></div>
    {localizeText(!run?<p>{localizeText("Run a mission to inspect its actual telemetry in Open MCT.")}</p>:<>
      <ContextHelp label="Model & assumptions"><p className="ml-tiny">{localizeText("Plot UTC is ")}{localizeText((run.schema==="egiz.experiment" && run.scenario.solar)?"the SPICE mission epoch":"archive creation UTC used only as an elapsed-time origin")}{localizeText(". T+")}{localizeText(time.toFixed(1))}{localizeText(" s · ")}{localizeText(run.schema==="egiz.experiment"?run.frames.length:run.states.length)}{localizeText(" recorded states. Open MCT's axis controls inspect this data; EGIZ owns replay time.")}</p></ContextHelp>
      {localizeText(error&&<p role="alert">{localizeText(error)}</p>)}
      <iframe key={run.id} ref={iframe} title={localizeText("NASA Open MCT recorded mission telemetry")} src={`${import.meta.env.BASE_URL}control.html`} className="eng-mct-frame"/>
    </>)}
  </div>;
}
