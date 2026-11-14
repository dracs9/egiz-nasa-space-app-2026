import { useMemo } from "react";
import { chronographEvents } from "./chronograph";
import type { TestRequirements } from "./acceptance";
import { message } from '../i18n/messages';
import { t as localizeText, useLanguage } from '../i18n';
import {
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Globe2,
  Mountain,
  Focus,
  LocateFixed,
  ScanLine,
  ChartNoAxesCombined,
} from "lucide-react";
import { replayFrame } from "./scene/replay";
import type { MissionTerrain, RunResult } from "./types";
export type ExplorerView =
  "planet" | "region" | "vehicle" | "follow" | "scientific" | "outcome";
export const missionClock = (seconds: number) => {
  const t = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(t / 3600)).padStart(2, "0")}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};
export function MissionTimeline({
  run,
  time,
  playing,
  speed,
  onSeek,
  onPlay,
  onSpeed,
  terrain,
  view,
  onView,
  snapshots,
  requirements,
  onEvent,
}: {
  run: RunResult | null;
  requirements: TestRequirements;
  onEvent(): void;
  time: number;
  playing: boolean;
  speed: number;
  onSeek(t: number): void;
  onPlay(): void;
  onSpeed(s: number): void;
  terrain: MissionTerrain;
  view: ExplorerView;
  onView(v: ExplorerView): void;
  snapshots: Partial<Record<ExplorerView, string>>;
}) {
  useLanguage();
  const end = run?.metrics.duration ?? 0,
    events = useMemo(() => run ? chronographEvents(run, requirements) : [], [run, requirements]);
  const seekEvent = (t: number) => { onSeek(t); onEvent(); };
  const energyTrace = useMemo(() => {
    if(!run || !["rover","eva"].includes(run.scenario.mode)) return null;
    const max = Math.max(1,run.metrics.energyWh,requirements.maxEnergyWh);
    const stride = Math.max(1,Math.ceil(run.frames.length/300));
    return {points:run.frames.filter((_,i)=>i%stride===0||i===run.frames.length-1).map(f=>`${f.t/Math.max(1,end)*1000},${43-f.energyWh/max*36}`).join(" "), ceiling:43-requirements.maxEnergyWh/max*36};
  },[run,requirements.maxEnergyWh]);
  const bookmarks = [
    ["planet", "The planet", Globe2],
    ["region", "The region", Mountain],
    ["vehicle", "The vehicle", Focus],
    ["follow", "Mission tracking", LocateFixed],
    ["scientific", "Scientific view", ScanLine],
    ["outcome", "The outcome", ChartNoAxesCombined],
  ] as const;
  const profile = useMemo(() => {
    const sampled = terrain.grid.elevation_m.filter(
      (v): v is number => v !== null,
    ),
    low = Math.min(...sampled),
    high = Math.max(...sampled);
  const row = terrain.grid.elevation_m.slice(
    Math.floor(terrain.grid.side / 2) * terrain.grid.side,
    Math.floor(terrain.grid.side / 2 + 1) * terrain.grid.side,
  );
  const profile = row
    .map(
      (v, i) =>
        `${(i / (row.length - 1)) * 180},${48 - (v === null ? 0 : (v - low) / Math.max(1, high - low)) * 38}`,
    )
    .join(" ");
    return profile;
  }, [terrain]);
  const current = events.filter((e) => e.t <= time).at(-1);
  return (
    <section className="ex-timeline" aria-label={localizeText("Mission playback")}>
      <div className="ex-transport">
        <div className="ex-transport-buttons">
          <button
            aria-label={localizeText("Restart replay")}
            disabled={!end}
            onClick={() => onSeek(0)}
          >
            <SkipBack size={15} />
          </button>
          <button
            className="ex-play"
            aria-label={
              localizeText(playing
                ? "Pause replay"
                : time >= end && run
                  ? "Replay experiment"
                  : "Play replay")
            }
            disabled={!end}
            onClick={onPlay}
          >
            {localizeText(playing ? (
              <Pause size={16} />
            ) : (
              <Play size={16} fill="currentColor" />
            ))}
          </button>
          <button
            aria-label={localizeText("Next mission event")}
            disabled={!events.some((e) => e.t > time)}
            onClick={() => seekEvent(events.find((e) => e.t > time)!.t)}
          >
            <SkipForward size={15} />
          </button>
        </div>
        <label className="ex-rate">
          <span>{localizeText("SPEED")}</span>
          <select
            aria-label={localizeText("Replay speed")}
            value={speed}
            onChange={(e) => onSpeed(Number(e.target.value))}
          >
            {localizeText([1, 5, 30, 60, 120, 600].map((n) => (
              <option key={n} value={n}>
                {localizeText(n)}×
              </option>
            )))}
          </select>
        </label>
        <div className="ex-mission-clock">
          <span>{localizeText("MISSION ELAPSED")}</span>
          <strong>{localizeText("T+")}{localizeText(missionClock(time))}</strong>
        </div>
        <div className="ex-time-track">
          <div className="chrono-identity"><b>{localizeText("EGIZ / MISSION CHRONOGRAPH")}</b><span>{localizeText("RECORDED TIME · REQUIREMENT EVENTS")}</span></div>
          {energyTrace && <svg className="chrono-energy" viewBox="0 0 1000 50" preserveAspectRatio="none" role="img" aria-label={localizeText("Recorded energy and fixed ceiling over mission time")}><path d="M0 43H1000 M0 25H1000 M0 7H1000" className="chrono-grid"/><line x1="0" x2="1000" y1={energyTrace.ceiling} y2={energyTrace.ceiling} className="chrono-ceiling"/><polyline points={energyTrace.points}/><line x1={Math.min(1,time/Math.max(1,end))*1000} x2={Math.min(1,time/Math.max(1,end))*1000} y1="0" y2="50" className="chrono-cursor"/></svg>}
          <div className="ex-time-labels">
            <span>
              {localizeText(current?.type.replaceAll("_", " ") ??
                (run ? replayFrame(run, time).phase : "Awaiting simulation"))}
            </span>
            <span>
              {localizeText(run
                ? `${run.frames.length.toLocaleString()} RECORDED STATES`
                : "RUN A MISSION TO BEGIN")}
            </span>
            {localizeText(events.length > 0 && (
              <select
                aria-label={localizeText("Jump to mission event")}
                value=""
                onChange={(e) => {
                  if (e.target.value !== "")
                    seekEvent(events[Number(e.target.value)].t);
                }}
              >
                <option value="">{localizeText("EVENTS / ")}{localizeText(events.length)}</option>
                {localizeText(events.map((e, i) => (
                  <option key={i} value={i}>
                    {localizeText(e.type)} · {localizeText(e.t.toFixed(1))}{localizeText(" s")}</option>
                )))}
              </select>
            ))}
          </div>
          <div className="ex-track-events">
            {localizeText(events.map((e, i) => (
              <button
                key={i}
                data-severity={e.severity}
                aria-current={Math.abs(e.t-time)<.1?"step":undefined}
                className={e.t <= time ? "passed" : ""}
                style={{ left: `${end ? (e.t / end) * 100 : 0}%` }}
                title={localizeText(`${e.type} · ${e.t.toFixed(1)} s — ${e.detail}`)}
                aria-label={localizeText(`Timeline event: ${e.type} at ${e.t.toFixed(1)} seconds`)}
                onClick={() => seekEvent(e.t)}
              />
            )))}
          </div>
          <input
            id="mission-replay-time"
            aria-label={localizeText("Simulation timeline")}
            type="range"
            min="0"
            max={end || 1}
            step="any"
            value={Math.min(time, end || 1)}
            disabled={!end}
            onChange={(e) => {
              const t = Number(e.target.value);
              onSeek(end - t < 1e-7 ? end : t);
            }}
            style={
              {
                "--progress": `${end ? (time / end) * 100 : 0}%`,
              } as React.CSSProperties
            }
          />
          <div className="ex-time-ticks">
            {localizeText([0, 0.25, 0.5, 0.75, 1].map((f) => (
              <span key={f}>{localizeText(missionClock(end * f))}</span>
            )))}
          </div>
        </div>
      </div>
      {run && <div className="chrono-explanation" data-severity={current?.severity}><span>{current?.gate ? localizeText("REQUIREMENT") : localizeText("RECORDED EVENT")}</span><b>{localizeText(current?.type ?? "Awaiting simulation")}</b><p>{localizeText(current?.detail ?? run.explanation)}</p>{current && <code>T+{current.t.toFixed(1)} s · E {current.x.toFixed(0)} / N {current.y.toFixed(0)} m</code>}</div>}
      <div className="ex-bookmarks">
        <div className="ex-bookmark-label">{localizeText("MISSION VIEWS")}<strong>
            06 <span>{localizeText("BOOKMARKS")}</span>
          </strong>
        </div>
        {localizeText(bookmarks.map(([id, title, Icon], i) => (
          <button
            key={id}
            aria-label={message('View: {view}', 'Вид: {view}', {view:title})}
            className={`ex-bookmark ex-bookmark-${id}`}
            aria-pressed={view === id}
            disabled={id === "outcome" && !run}
            onClick={() => onView(id)}
          >
            <div className="ex-bookmark-art">
              {localizeText(snapshots[id] ? (
                <img
                  src={snapshots[id]}
                  alt={message('{view} captured from the 3D scene', '{view} — снимок 3D-сцены', {view:title})}
                />
              ) : id === "planet" ? (
                <div
                  className={`ex-mini-planet ${terrain.body}`}
                  style={{
                    backgroundImage: `url(${import.meta.env.BASE_URL}textures/${terrain.body}-preview.jpg)`,
                  }}
                />
              ) : id === "region" || id === "scientific" ? (
                <svg viewBox="0 0 180 55" aria-hidden="true">
                  <polyline
                    points={profile}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth=".7"
                  />
                  <polyline
                    points={profile}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth=".5"
                    transform="translate(0,5)"
                  />
                  <polyline
                    points={profile}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth=".3"
                    transform="translate(0,10)"
                  />
                </svg>
              ) : (
                <Icon size={30} strokeWidth={0.7} />
              ))}
            </div>
            <div>
              <span>0{localizeText(i + 1)}</span>
              <strong>{localizeText(title)}</strong>
              <Icon size={12} />
            </div>
          </button>
        )))}
      </div>
    </section>
  );
}
