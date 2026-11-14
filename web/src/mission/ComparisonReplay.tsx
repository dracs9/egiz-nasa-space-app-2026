import { baselineCompatibility, acceptanceAtTime, defaultRequirements } from "./acceptance";
import { chronographEvents } from "./chronograph";
import { ContextHelp } from '../components/ContextHelp';
import { t as localizeText, useLanguage } from '../i18n';
// Written with AI assistance (Codex); human review pending.
import { useEffect, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { TerrainViewer } from "./TerrainViewer";
import { replayFrame } from "./scene/replay";
import type { RunResult } from "./types";
const empty: never[] = [];
const noPick = () => {};
export function ComparisonReplay({ runs, initiallyOpen = false }: { runs: RunResult[]; initiallyOpen?: boolean }) {
  useLanguage();
  const [open, setOpen] = useState(initiallyOpen),
    [left, setLeft] = useState(0),
    [right, setRight] = useState(1),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(60);
  const a = runs[left] ?? runs[0],
    b = runs[right] ?? runs[1],
    end = Math.max(a.metrics.duration, b.metrics.duration);
  useEffect(() => {
    setTime(0);
    setPlaying(false);
  }, [runs, left, right]);
  useEffect(() => {
    if (!open || !playing) return;
    let id = 0,
      last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.2, (now - last) / 1000);
      last = now;
      setTime((t) => Math.min(end, t + dt * speed));
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [open, playing, speed, end]);
  useEffect(() => {
    if (time >= end) setPlaying(false);
  }, [time, end]);
  const label = (r: RunResult) =>
    `${r.id.slice(0,6)} · ${r.terrain.name} · ${r.scenario.rover.speed.toFixed(2)} m/s · ${r.scenario.rover.route} · ${r.scenario.environment.planet}`;
  return (
    <section className="ml-dual-replay">
      <button
        className="ml-dual-heading"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setPlaying(false);
        }}
      >
        <span>{localizeText("02 / SYNCHRONIZED OBSERVATION")}</span>
        <strong>{localizeText(open ? "Close" : "Open")}{localizeText(" 3D comparison")}</strong>
        <small>{localizeText("Two computed runs · one elapsed-time clock")}</small>
      </button>
      {localizeText(open && (
        <>
          <div className="ml-dual-controls">
            <button
              aria-label={localizeText(playing ? "Pause comparison" : "Play comparison")}
              disabled={end <= 0}
              onClick={() => {
                if (time >= end) setTime(0);
                setPlaying(!playing);
              }}
            >
              {localizeText(playing ? <Pause size={16} /> : <Play size={16} />)}
            </button>
            <button
              aria-label={localizeText("Restart comparison")}
              onClick={() => {
                setTime(0);
                setPlaying(false);
              }}
            >
              <RotateCcw size={15} />
            </button>
            <b>{localizeText("T+ ")}{localizeText(time.toFixed(1))}{localizeText(" s")}</b>
            <input
              aria-label={localizeText("Comparison timeline")}
              disabled={end <= 0}
              type="range"
              min="0"
              max={end || 1}
              step=".1"
              value={time}
              onChange={(e) => {
                setPlaying(false);
                setTime(Number(e.target.value));
              }}
            />
            <select
              aria-label={localizeText("Comparison replay speed")}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            >
              {localizeText([1, 5, 60, 120, 600].map((s) => (
                <option key={s} value={s}>
                  {localizeText(s)}×
                </option>
              )))}
            </select>
          </div>
          <p className="comparison-contract">{localizeText(baselineCompatibility(a,b).comparable ? "Matching model, physical environment and route. Inspect changed inputs and fixed requirements." : "Direct deltas unavailable. The experiments differ in route, model, physical environment or solar geometry.")}</p>
          <div className="ml-dual-scenes">
            {localizeText([a, b].map((r, i) => {
              const f = replayFrame(r, time);
              return (
                <div key={`${i}-${r.id}`}>
                  <label className="ml-dual-select">
                    <span>{localizeText("EXPERIMENT ")}{localizeText(i === 0 ? "A" : "B")}</span>
                    <select
                      aria-label={localizeText(`Comparison experiment ${i === 0 ? "A" : "B"}`)}
                      value={i === 0 ? left : right}
                      onChange={(e) =>
                        i === 0
                          ? setLeft(Number(e.target.value))
                          : setRight(Number(e.target.value))
                      }
                    >
                      {localizeText(runs.map((r, j) => (
                        <option key={r.id} value={j}>
                          {localizeText(label(r))}
                        </option>
                      )))}
                    </select>
                  </label>
                  <select aria-label={localizeText(`Recorded events ${i===0?"A":"B"}`)} value="" onChange={e=>{if(e.target.value!==""){setTime(Number(e.target.value));setPlaying(false);}}}><option value="">{localizeText("Jump to mission event")}</option>{chronographEvents(r,r.requirements??defaultRequirements(r.scenario)).map((e,j)=><option key={j} value={e.t}>{localizeText(e.type)} · {e.t.toFixed(1)} s</option>)}</select>
                  <TerrainViewer
                    terrain={r.terrain}
                    frame={f}
                    run={r}
                    scenario={r.scenario}
                    start={r.scenario.start}
                    destination={r.scenario.destination}
                    observations={empty}
                    tool="inspect"
                    onPick={noPick}
                    initialQuality="auto"
                  />
                  <svg className="comparison-energy" viewBox="0 0 500 80" role="img" aria-label={localizeText("Recorded energy and synchronized cursor")}><polyline points={r.frames.filter((_,i)=>i%Math.max(1,Math.ceil(r.frames.length/300))===0||i===r.frames.length-1).map(f=>`${f.t/Math.max(1,end)*500},${75-f.energyWh/Math.max(1,a.metrics.energyWh,b.metrics.energyWh)*65}`).join(" ")}/><line x1={time/Math.max(1,end)*500} x2={time/Math.max(1,end)*500} y1="0" y2="80"/></svg>
                  <div className="comparison-gates">{acceptanceAtTime(r,r.requirements??defaultRequirements(r.scenario),time).map(g=><span key={g.id} data-state={g.status}>{localizeText(g.label)} {typeof g.value==='number'?`${g.value.toFixed(1)} ${g.unit}`:''} · {localizeText(g.status==='pass'?'Pass':g.status==='fail'?'Fail':g.status==='pending'?'Pending':'Unresolved')}</span>)}</div>
                  <div className="ml-dual-readout">
                    <span>
                      {localizeText(time >= r.metrics.duration
                        ? r.outcome.replaceAll("_", " ")
                        : f.phase)}
                    </span>
                    <b>{localizeText(f.distance.toFixed(0))}{localizeText(" m")}</b>
                    <b>{localizeText(f.speed.toFixed(2))}{localizeText(" m/s")}</b>
                    <b>{localizeText(f.energyWh.toFixed(1))}{localizeText(" Wh")}</b>
                    <small>
                      {localizeText(r.scenario.environment.gravity)}{localizeText(" m/s² ·")}{localizeText(" ")}
                      {localizeText(r.scenario.environment.planet)}
                    </small>
                  </div>
                </div>
              );
            }))}
          </div>
          <ContextHelp label="Model & assumptions"><p>{localizeText("Both scenes use the same elapsed simulation time. Each holds its final recorded state when its run ends. Camera movement and vehicle mechanics are illustrative; calculated terrain, forces and outcomes remain independent.")}</p></ContextHelp>
        </>
      ))}
    </section>
  );
}
