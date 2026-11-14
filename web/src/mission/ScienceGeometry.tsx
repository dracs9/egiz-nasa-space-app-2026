import { ContextHelp } from '../components/ContextHelp';
import { t as localizeText, useLanguage } from '../i18n';
import { useEffect, useRef, useState } from "react";
import { solarAt, validateGeometry } from "./solar";
import type { MissionTerrain, Scenario, SpiceGeometry } from "./types";

export function ScienceGeometry({ terrain, scenario, time, disabled, onChange }: {
  terrain: MissionTerrain; scenario: Scenario; time: number; disabled: boolean;
  onChange(s: Scenario): void;
}) {
  useLanguage();
  const [epoch, setEpoch] = useState("2026-11-14T00:00"),
    [status, setStatus] = useState(""), [busy, setBusy] = useState(false);
  const epochInput=useRef<HTMLInputElement>(null);
  const latest=useRef({scenario,terrain});latest.current={scenario,terrain};
  const revision=useRef(0),active=useRef(true);
  useEffect(()=>{active.current=true;return()=>{active.current=false;revision.current++;};},[]);
  useEffect(() => { revision.current++;setStatus("");setBusy(false); }, [terrain.id]);
  const apply = async (live: boolean) => {
    const request=++revision.current;
    const selectedEpoch=epochInput.current?.value??epoch;
    setEpoch(selectedEpoch);
    setBusy(true); setStatus("");
    try {
      let value: unknown;
      const epochUtc=live?new Date(`${selectedEpoch}Z`).toISOString():null;
      if (live) {
        const response = await fetch(`${import.meta.env.BASE_URL}api/science/geometry`, {
          method: "POST", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({siteId: terrain.id, epochUtc, duration: 86400}),
          signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) throw new Error("Start the optional Python SPICE service for custom epochs (see engine documentation).");
        value = await response.json();
      } else {
        const response = await fetch(`${import.meta.env.BASE_URL}data/pilot/spice_geometry.json`);
        if (!response.ok) throw new Error("The recorded SPICE geometry is not packaged.");
        const catalog = await response.json();
        value = catalog.entries?.find((g: SpiceGeometry) => g.siteId === terrain.id);
      }
      if(!active.current || request!==revision.current)return;
      const current=latest.current;
      if(current.scenario.kind==="counterfactual")throw new Error("Site-specific solar geometry cannot be substituted between bodies.");
      const solar = validateGeometry(value, current.terrain, current.scenario.duration);
      if(live && Date.parse(solar.epochUtc)!==Date.parse(epochUtc!))throw new Error("SPICE response epoch does not match the requested UTC.");
      onChange({...current.scenario, solar});
      setStatus(live ? "NASA CSPICE executed by the local service." : "Loaded genuine recorded CSPICE output. UTC 14 Nov 2026, 00:00–24:00.");
    } catch (e) { if(active.current && request===revision.current)setStatus((e as Error).message); }
    finally { if(active.current && request===revision.current)setBusy(false); }
  };
  const sample = scenario.solar ? solarAt(scenario.solar, time) : null;
  return <div className="eng-science">
    <div className="eng-kicker">{localizeText("SCIENTIFIC ENGINE / NASA NAIF")}</div>
    <h3>{localizeText("SPICE geometry")}</h3>
    <p>{localizeText("Use a real ephemeris for local sunlight, the Earth horizon and optional solar charging.")}</p>
    <fieldset disabled={disabled || busy || scenario.kind === "counterfactual"}>
      <button onClick={() => void apply(false)}>{localizeText("Use recorded SPICE geometry")}</button>
      <details><summary>{localizeText("Calculate another UTC epoch")}</summary>
        <label className="ml-field"><span>{localizeText("Mission epoch (UTC)")}</span><input ref={epochInput} type="datetime-local" aria-label={localizeText("Mission epoch (UTC)")} value={epoch} min="2000-01-01T00:00" max="2040-12-30T00:00" onInput={e=>setEpoch(e.currentTarget.value)} onChange={e => setEpoch(e.target.value)}/></label>
        <button disabled={!epoch} onClick={() => void apply(true)}>{localizeText(busy ? "Executing CSPICE…" : "Execute NASA SPICE")}</button>
        <p className="ml-tiny">{localizeText("Local optional service: ")}<code>make science-serve</code>{localizeText(". Browser-only use needs no service.")}</p>
      </details>
    </fieldset>
    {localizeText(scenario.kind === "counterfactual" && <p className="ml-tiny">{localizeText("Site geometry is not substituted between bodies. Select a physical Earth or native mission.")}</p>)}
    {localizeText(status && <p role="status">{localizeText(status)}</p>)}
    {localizeText(sample && <>
      <dl className="eng-readings">
        <div><dt>{localizeText("Sun elevation")}</dt><dd>{localizeText(sample.elevationDeg.toFixed(2))}°</dd></div>
        <div><dt>{localizeText("Solar flux · above atmosphere")}</dt><dd>{localizeText(sample.solarFluxWm2.toFixed(1))}{localizeText(" W/m²")}</dd></div>
        <div><dt>{localizeText("Earth above geometric horizon")}</dt><dd>{localizeText(sample.earthElevationDeg === null ? "Earth site" : `${sample.earthElevationDeg.toFixed(2)}°`)}</dd></div>
        <div><dt>{localizeText("Earth one-way vacuum light time")}</dt><dd>{localizeText(sample.earthRangeKm === null ? "—" : `${(sample.earthRangeKm / 299792.458).toFixed(1)} s`)}</dd></div>
      </dl>
      <p className="ml-tiny">{localizeText(scenario.solar!.epochUtc)} + {localizeText(time.toFixed(0))}{localizeText(" s · ")}{localizeText(scenario.solar!.frame)} · {localizeText(scenario.solar!.engine)}</p>
      <svg viewBox="0 0 600 90" role="img" aria-label={localizeText("SPICE solar elevation over 24 hours")}>
        <path d="M12 45H588" stroke="#64747a" strokeDasharray="3 3"/>
        <polyline fill="none" stroke="#d2b581" strokeWidth="2" points={scenario.solar!.samples.map(s => `${12+s.t/86400*576},${45-s.elevationDeg/90*36}`).join(" ")}/>
        <line x1={12+time/86400*576} x2={12+time/86400*576} y1="6" y2="82" stroke="#8bd1ba"/>
      </svg>
      <ContextHelp label="Model & assumptions"><p className="ml-tiny">{localizeText("Geometric, spherical site; text-PCK orientation. No terrain shadow, weather, refraction or communication link budget. Kernel SHA-256 fingerprints travel with the experiment.")}</p></ContextHelp>
      <button onClick={() => { const next = {...scenario}; delete next.solar; onChange(next); }}>{localizeText("Return to illustrative lighting")}</button>
    </>)}
  </div>;
}
