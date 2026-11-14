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
    `${r.terrain.name} · ${r.scenario.environment.planet} physics · ${r.scenario.kind}`;
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
