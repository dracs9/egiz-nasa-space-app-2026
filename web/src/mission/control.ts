// Runs only inside the optional same-origin Open MCT frame; no independent simulation clock.
import { CHANNELS, telemetryEpoch, telemetryRows, recordFrames, type TelemetryRecord } from "./openmctAdapter";


// Open MCT's official UMD distribution is packaged verbatim, outside the main app bundle.
// The boundary is deliberately small; underlying APIs are verified against 4.3.1 sources.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mct:any;
let run:TelemetryRecord|null=null,time=0,started=false;
let strictCsp=false;
const subscribers=new Map<string,Set<(datum:unknown)=>void>>();
const status=document.querySelector<HTMLOutputElement>("#clock-status")!;
function channelObject(key:string) {
  const channel=CHANNELS.find(c=>c.key===key)!;
  return {identifier:{namespace:"egiz",key},name:channel.name,type:"egiz.recorded",location:"egiz:mission",
    telemetry:{values:[{key:"utc",name:"Recorded simulation time",format:"utc",hints:{domain:1}},
      {key:"value",name:channel.name,unit:channel.unit,format:"float",hints:{range:1}}]}};
}
function start() {
  mct.setAssetPath(`${import.meta.env.BASE_URL}vendor/openmct/`);
  mct.install(mct.plugins.UTCTimeSystem());
  mct.install(mct.plugins.Espresso());
  mct.types.addType("egiz.recorded",{name:"EGIZ recorded telemetry",cssClass:"icon-telemetry",description:"Actual deterministic mission states; EGIZ owns the clock."});
  mct.objects.addRoot({namespace:"egiz",key:"mission"});
  mct.objects.addProvider("egiz",{get:async (identifier:{key:string})=>identifier.key==="mission"?
    {identifier:{namespace:"egiz",key:"mission"},name:"EGIZ / recorded mission",type:"folder",location:"ROOT",composition:CHANNELS.filter(c=>recordFrames(run!).some(f=>c.value(f)!==undefined)).map(c=>({namespace:"egiz",key:c.key}))}:
    channelObject(identifier.key)});
  mct.telemetry.addProvider({
    supportsRequest:(obj:{identifier:{namespace:string};type:string})=>obj.identifier.namespace==="egiz"&&obj.type==="egiz.recorded",
    request:async (obj:{identifier:{key:string}},options:{start:number;end:number})=>telemetryRows(run!,obj.identifier.key,time,options.start,options.end),
    supportsSubscribe:(obj:{identifier:{namespace:string};type:string})=>obj.identifier.namespace==="egiz"&&obj.type==="egiz.recorded",
    subscribe:(obj:{identifier:{key:string}},callback:(datum:unknown)=>void)=>{
      const set=subscribers.get(obj.identifier.key)??new Set();set.add(callback);subscribers.set(obj.identifier.key,set);
      return ()=>set.delete(callback);
    },
  });
  // Open MCT's stock plot wrapper compiles a Vue template at runtime. Provide an
  // explicit original view for strict CSP, consuming NASA's actual telemetry API.
  // The official distribution stays unmodified and the offline policy stays strict.
  mct.objectViews.addProvider({
    key:"egiz-recorded-plot",name:"EGIZ recorded plot · strict CSP",cssClass:"icon-telemetry",
    canView:(obj:{identifier:{namespace:string}})=>obj.identifier.namespace==="egiz",
    priority:()=>strictCsp?mct.priority.HIGH:mct.priority.LOW,
    view:(obj:{identifier:{key:string};name:string})=>{
      let host:HTMLElement,alive=true,revision=0;
      const draw=async()=>{
        const request=++revision;
        const key=obj.identifier.key==="mission"?"speed":obj.identifier.key;
        const channel=CHANNELS.find(c=>c.key===key)!;
        const rows=await mct.telemetry.request(channelObject(key),{...mct.time.getBounds(),strategy:"minmax",size:1200}) as {value:number;met:number}[];
        if(!alive||request!==revision)return;
        host.replaceChildren();
        const nav=document.createElement("div");nav.style.cssText="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:18px";
        for(const c of CHANNELS.filter(c=>recordFrames(run!).some(f=>c.value(f)!==undefined))) {
          const button=document.createElement("button");button.textContent=c.name;button.style.cssText="padding:7px 9px;border:1px solid #466059;color:#c8d5c8;background:#172923;font-size:11px;cursor:pointer";
          button.onclick=()=>location.hash=`/browse/egiz:mission/egiz:${c.key}?view=egiz-recorded-plot`;nav.append(button);
        }
        host.append(nav);
        const title=document.createElement("h2");title.textContent=`${channel.name} · ${rows.at(-1)?.value.toFixed(3)??"—"} ${channel.unit}`;title.style.cssText="font:20px monospace;color:#dac49a";host.append(title);
        const description=document.createElement("p");description.textContent=`${rows.length} authentic recorded samples · EGIZ plot through NASA Open MCT telemetry API · T+${time.toFixed(1)} s`;description.style.cssText="color:#a9b9af;font:11px monospace";host.append(description);
        const ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg");svg.setAttribute("viewBox","0 0 800 330");svg.setAttribute("role","img");svg.setAttribute("aria-label",`${channel.name} recorded telemetry plot`);svg.style.cssText="width:100%;height:330px;background:#101d1a";
        const high=Math.max(0,...rows.map(r=>r.value)),low=Math.min(0,...rows.map(r=>r.value)),span=Math.max(1,high-low),bottom=low-span*.05,top=high+span*.05,end=Math.max(1,time);
        const stride=Math.max(1,Math.floor(rows.length/1000));
        const line=document.createElementNS(ns,"polyline");line.setAttribute("points",rows.filter((_,i)=>i%stride===0||i===rows.length-1).map(r=>`${45+r.met/end*730},${280-(r.value-bottom)/(top-bottom)*240}`).join(" "));line.setAttribute("fill","none");line.setAttribute("stroke","#a9c5aa");line.setAttribute("stroke-width","2");svg.append(line);
        for(const [x,y,value] of [[8,25,`${top.toPrecision(5)} ${channel.unit}`],[10,282,`${bottom.toPrecision(5)}`],[45,310,"T+0 s"],[650,310,`T+${end.toFixed(1)} s`]] as const) {
          const text=document.createElementNS(ns,"text");text.setAttribute("x",String(x));text.setAttribute("y",String(y));text.setAttribute("fill","#c0c4ae");text.setAttribute("font-size","11");text.textContent=value;svg.append(text);
        }
        host.append(svg);
      };
      return {show:(element:HTMLElement)=>{host=document.createElement("div");host.style.cssText="padding:20px;overflow:auto;height:100%;box-sizing:border-box;background:#101917";element.append(host);mct.time.on("boundsChanged",draw);void draw();},destroy:()=>{alive=false;mct.time.off("boundsChanged",draw);host?.remove();}};
    },
  });
  const epoch=telemetryEpoch(run!);
  mct.time.setTimeSystem("utc",{start:epoch,end:epoch+Math.max(1,time)*1000});
  location.hash=`/browse/egiz:mission/egiz:speed?view=${strictCsp?"egiz-recorded-plot":"plot-single"}`;
  mct.start(document.querySelector("#mct"));
  started=true;
}
window.addEventListener("message",event=>{
  if(event.origin!==location.origin || event.source!==window.parent) return;
  if(event.data?.type==="egiz-record") {
    const value=event.data.run as TelemetryRecord;
    if(!["egiz.experiment","egiz.dynamics_experiment"].includes(value?.schema)||!Array.isArray(recordFrames(value)))return;
    run=value;time=Number(event.data.time)||0;
    try {if(!started)start();}
    catch(e){status.textContent=`Open MCT failed: ${(e as Error).message}`;window.parent.postMessage({type:"egiz-mct-error",error:status.textContent},location.origin);return;}
  } else if(event.data?.type==="egiz-clock" && run) {
    const next=Math.max(0,Math.min(run.metrics.duration,Number(event.data.time)||0));
    if(next===time)return;
    time=next;
  } else return;
  if(!run)return;
  const epoch=telemetryEpoch(run);
  mct.time.setBounds({start:epoch,end:epoch+Math.max(1,time)*1000});
  // Real-time subscribers receive the last recorded sample; no invented interpolated values.
  for(const [key,callbacks] of subscribers) {
    const last=telemetryRows(run,key,time).at(-1);
    if(last) callbacks.forEach(cb=>cb(last));
  }
  status.textContent=`EGIZ clock T+${time.toFixed(1)} s · recorded states only`;
});
const css=document.createElement("link");css.rel="stylesheet";css.href=`${import.meta.env.BASE_URL}vendor/openmct/openmct.css`;document.head.append(css);
const script=document.createElement("script");script.src=`${import.meta.env.BASE_URL}vendor/openmct/openmct.js`;
script.onload=async()=>{mct=(window as unknown as {openmct:unknown}).openmct;
  const response=await fetch(location.pathname,{method:"HEAD"});
  const policy=response.headers.get("Content-Security-Policy");
  strictCsp=!!policy?.includes("script-src")&&!policy.includes("'unsafe-eval'");
  window.parent.postMessage({type:"egiz-mct-ready"},location.origin);
};
script.onerror=()=>{status.textContent="The packaged Open MCT distribution could not load.";window.parent.postMessage({type:"egiz-mct-error",error:status.textContent},location.origin);};
document.head.append(script);
