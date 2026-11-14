import { ContextHelp } from '../components/ContextHelp';
import { t as localizeText, useLanguage } from '../i18n';
import { DEFAULT_DESIGN, drivetrain, tipAngle } from "./mobility";
import type { Frame, RoverDesign, Scenario } from "./types";

const FIELDS: {key: keyof RoverDesign; label: string; unit: string; step: number; visual?: boolean}[] = [
  {key:"wheelRadius", label:"Wheel radius", unit:"m", step:0.01},
  {key:"wheelWidth", label:"Wheel width", unit:"m", step:0.01, visual:true},
  {key:"trackWidth", label:"Wheel track", unit:"m", step:0.05},
  {key:"wheelbase", label:"Wheelbase", unit:"m", step:0.05},
  {key:"cgHeight", label:"Centre of mass height", unit:"m", step:0.05},
  {key:"suspensionTravel", label:"Suspension travel", unit:"m", step:0.01, visual:true},
  {key:"stallTorque", label:"Stall torque / wheel", unit:"N m", step:5},
  {key:"noLoadRpm", label:"No-load wheel speed", unit:"rpm", step:5},
  {key:"motorPower", label:"Mechanical power / wheel", unit:"W", step:25},
  {key:"solarArea", label:"Horizontal solar aperture", unit:"m²", step:0.1},
  {key:"solarEfficiency", label:"Panel efficiency", unit:"fraction", step:0.01},
  {key:"transmission", label:"Surface solar transmission", unit:"fraction", step:0.05},
];

export function RoverEngineering({scenario, frame, onChange, busy, exploded, onExplode, onInspect, onRun, onSweep, validationErrors=[]}: {
  scenario: Scenario; frame: Frame | null; onChange(s: Scenario): void; busy: boolean;
  exploded: number; onExplode(n: number): void; onInspect(): void; onRun(): void; onSweep(): void;
  validationErrors?:string[];
}) {
  useLanguage();
  const d = scenario.rover.design ?? DEFAULT_DESIGN;
  const flat = drivetrain({...scenario, rover:{...scenario.rover, design:d}}, 0, 0);
  const freeSpeed = d.noLoadRpm * 2*Math.PI*d.wheelRadius/60;
  const envelope=Array.from({length:61},(_,i)=>{
    const rpm=d.noLoadRpm*i/60;
    const torque=Math.min(d.stallTorque*(1-i/60),rpm>0?d.motorPower/(rpm*2*Math.PI/60):d.stallTorque);
    return `${30+i/60*290},${140-torque/d.stallTorque*120}`;
  }).join(" ");
  return <div className="eng-workbench">
    <div className="eng-title"><div><span className="eng-kicker">{localizeText("R–01 / SIX-WHEEL ENGINEERING LAB")}</span><h2>{localizeText("Rover engineering")}</h2><p>{localizeText("One configuration drives route feasibility, electrical demand, telemetry and the mechanical 3D assembly.")}</p></div>
      <button onClick={onInspect}>{localizeText("Inspect in 3D ↗")}</button></div>
    <div className="eng-layout">
      <div><fieldset disabled={busy}>
        <label className="eng-enable"><input type="checkbox" checked={!!scenario.rover.design} onChange={e => {const rover={...scenario.rover}; if(e.target.checked) rover.design={...DEFAULT_DESIGN};else {delete rover.design; if(rover.route==="astar-energy") rover.route="astar";} onChange({...scenario,rover});}}/>{localizeText(" Use drivetrain & static stability model")}</label>
        <div className="eng-presets">{localizeText(["Reference rover", "Heavy payload", "Low power"].map((preset,i) => <button key={preset} onClick={() => onChange({...scenario, rover:{...scenario.rover, mass:i===1?1600:900, design:{...DEFAULT_DESIGN, ...(i===2?{stallTorque:20,motorPower:35}: {})}}})}>{localizeText(preset)}</button>))}</div>
        <div className="eng-fields">{localizeText(([
          ["mass","Vehicle mass (kg)",10],["speed","Commanded speed (m/s)",.1],["batteryWh","Battery capacity (Wh)",100],["maxSlope","Regional slope limit (°)",1],
        ] as const).map(([key,label,step])=><label className="ml-field" key={key}><span>{localizeText(label)}</span><input type="number" data-guide-field={key} aria-label={localizeText(label)} value={Number.isFinite(scenario.rover[key])?scenario.rover[key]:""} step={step} onChange={e=>onChange({...scenario,rover:{...scenario.rover,[key]:e.target.value===""?NaN:Number(e.target.value)}})}/></label>))}
          <label className="ml-field"><span>{localizeText("Route objective")}</span><select aria-label={localizeText("Engineering route objective")} value={scenario.rover.route} onChange={e=>onChange({...scenario,rover:{...scenario.rover,route:e.target.value as Scenario["rover"]["route"]}})}><option value="astar">{localizeText("Shortest admissible route")}</option><option value="astar-energy" disabled={!scenario.rover.design}>{localizeText("Minimum gross electrical energy")}</option><option value="direct">{localizeText("Direct route feasibility")}</option></select></label>
        </div>
        <div className="eng-fields">{localizeText(FIELDS.map(f => <label key={f.key} className="ml-field"><span>{localizeText(f.label)} <small>{localizeText(f.visual?"visual only":f.unit)}</small></span><input data-guide-field={f.key} aria-label={`${localizeText(f.label)} (${f.unit})`} type="number" step={f.step} value={Number.isFinite(d[f.key])?d[f.key]:""} onChange={e => onChange({...scenario,rover:{...scenario.rover,design:{...d,[f.key]:e.target.value===""?NaN:Number(e.target.value)}}})}/></label>))}</div>
      </fieldset></div>
      <div className="eng-diagnostics">
        <span className="eng-kicker">{localizeText("CALCULATED DESIGN ENVELOPE")}</span>
        <dl className="eng-readings"><div><dt>{localizeText("Conservative static tip angle")}</dt><dd>{localizeText(tipAngle(d).toFixed(1))}°</dd></div><div><dt>{localizeText("No-load ground speed")}</dt><dd>{localizeText(freeSpeed.toFixed(2))}{localizeText(" m/s")}</dd></div><div><dt>{localizeText("Level-ground commanded speed")}</dt><dd>{localizeText(flat.speed.toFixed(2))}{localizeText(" m/s")}</dd></div><div><dt>{localizeText("Level-ground electrical load")}</dt><dd>{localizeText(flat.electricalPowerW.toFixed(1))}{localizeText(" W")}</dd></div></dl>
        <svg viewBox="0 0 340 170" role="img" aria-label={localizeText("Configured per-wheel DC torque-speed envelope with mechanical power cap")}><path d="M30 12V140H326" stroke="#465659" fill="none"/><polyline points={envelope} fill="none" stroke="#d2b581" strokeWidth="2"/><text x="34" y="15">{localizeText(d.stallTorque)}{localizeText(" N m")}</text><text x="208" y="160">{localizeText(d.noLoadRpm)}{localizeText(" rpm")}</text><text x="35" y="159">0</text></svg>
        <label className="ml-field"><span>{localizeText("Exploded assembly · inspection only")}</span><input aria-label={localizeText("Exploded assembly")} type="range" min="0" max="1" step="0.01" value={exploded} onChange={e => {onExplode(Number(e.target.value)); onInspect();}}/></label>
        <ContextHelp label="Model & assumptions"><p>{localizeText("Six equal-load wheels. Linear DC torque-speed curve at the wheel shaft. Ideal dissipative braking, no regeneration. Static tip screening uses the smaller support span.")}</p></ContextHelp>
        <ContextHelp label="Model & assumptions"><p className="ml-tiny">{localizeText("200 m regional terrain cannot resolve wheel contact or rocks. Width and suspension travel affect the illustration only. Panel aperture is an electrical assumption, not a CAD area measurement.")}</p></ContextHelp>
        {localizeText(frame?.mobility && <p className="eng-live">{localizeText("Recorded state · ")}{localizeText(frame.mobility.motorRpm.toFixed(2))}{localizeText(" rpm · ")}{localizeText(frame.mobility.wheelTorqueNm.toFixed(2))}{localizeText(" N m/wheel · ")}{localizeText(frame.mobility.batteryRemainingWh.toFixed(1))}{localizeText(" Wh remaining")}</p>)}
        {localizeText(validationErrors.length>0 && <div className="ml-error" role="alert">{localizeText(validationErrors.map(e=><p key={e}>{localizeText(e)}</p>))}</div>)}
        <div className="eng-presets"><button disabled={busy || validationErrors.length>0} onClick={onRun}>{localizeText("Calculate this design →")}</button><button disabled={busy || !scenario.rover.design || validationErrors.length>0} onClick={onSweep}>{localizeText("Run 9-design trade study")}</button></div>
      </div>
    </div>
  </div>;
}
