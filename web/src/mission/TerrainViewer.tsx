import { t as localizeText, useLanguage } from '../i18n';
// Written with AI assistance (Codex); human review pending.
import { useEffect, useRef, useState } from "react";
import {
  Camera,
  Crosshair,
  Eye,
  Focus,
  Layers3,
  LocateFixed,
  Maximize2,
  Mountain,
  Orbit,
  RotateCcw,
  Sun,
} from "lucide-react";
import { sampleTerrain, slopeAt } from "./terrain";
import { createMissionScene, type CameraMode } from "./scene/runtime";
import { terminalState } from "./scene/replay";
import type {
  Frame,
  MissionTerrain,
  Point,
  RunResult,
  Scenario,
} from "./types";

interface Props {
  terrain: MissionTerrain;
  frame: Frame | null;
  run: RunResult | null;
  scenario: Scenario;
  start: Point;
  destination: Point;
  observations: Point[];
  onPick(p: Point): void;
  onCapture?(mode: CameraMode, image: string): void;
  tool: string;
  presentation?: string;
  initialQuality?: string;
  cameraBookmark?: { mode: CameraMode; revision: number };
  exploded?: number;
}
const cameras: { id: CameraMode; label: string; icon: typeof Camera }[] = [
  { id: "close", label: "Vehicle", icon: Focus },
  { id: "follow", label: "Follow", icon: LocateFixed },
  { id: "orbit", label: "Regional", icon: Layers3 },
  { id: "overhead", label: "Overhead", icon: Crosshair },
  { id: "mast", label: "Onboard", icon: Eye },
  { id: "ground", label: "Surface", icon: Mountain },
  { id: "cinematic", label: "Cinematic", icon: Orbit },
];
export function TerrainViewer(props: Props) {
  useLanguage();
  const {
    terrain,
    run,
    scenario,
    start,
    destination,
    observations,
    tool,
    presentation = "mission",
  } = props;
  const host = useRef<HTMLDivElement>(null),
    section = useRef<HTMLElement>(null),
    live = useRef(props);
  live.current = props;
  const [layer, setLayer] = useState("surface"),
    [cameraMode, setCameraMode] = useState<CameraMode>("close"),
    [quality, setQuality] = useState(props.initialQuality ?? "auto"),
    [sun, setSun] = useState(28),
    [exaggeration, setExaggeration] = useState(1),
    [error, setError] = useState(""),
    [inspection, setInspection] = useState<Point | null>(null),
    [reset, setReset] = useState(0);
  const [vectors, setVectors] = useState(false),
    [trajectory, setTrajectory] = useState(true),
    [details, setDetails] = useState(true),
    [showSettings, setShowSettings] = useState(false),
    [profile, setProfile] = useState<{
      fps: number;
      calls: number;
      triangles: number;
      ratio: number;
      cpuMs: number;
      gpuMs: number | null;
      geometries: number;
      textures: number;
    } | null>(null);
  useEffect(() => {
    if (props.cameraBookmark) setCameraMode(props.cameraBookmark.mode);
  }, [props.cameraBookmark]);
  const settings = useRef({
    camera: cameraMode,
    vectors,
    trajectory,
    details,
    sun,
    presentation,
    exploded: props.exploded ?? 0,
  });
  settings.current = {
    camera: cameraMode,
    vectors: vectors || presentation === "scientific",
    trajectory,
    details,
    sun,
    presentation,
    exploded: props.exploded ?? 0,
  };
  useEffect(() => {
    if (
      cameraMode === "mast" &&
      scenario.mode !== "rover" &&
      scenario.mode !== "eva"
    )
      setCameraMode("close");
  }, [scenario.mode, cameraMode]);
  useEffect(() => {
    if (!host.current) return;
    try {
      setError("");
      setProfile(null);
      return createMissionScene({
        host: host.current,
        terrain,
        run,
        scenario,
        observations,
        layer,
        quality,
        exaggeration,
        getState: () => ({
          frame: live.current.frame,
          run: live.current.run,
          scenario: live.current.scenario,
          ...settings.current,
        }),
        onPick: (p) => {
          setInspection(p);
          live.current.onPick(p);
        },
        onCapture: (mode, image) => live.current.onCapture?.(mode, image),
        onError: setError,
        onProfile: setProfile,
      });
    } catch (e) {
      setError(
        `3D graphics are unavailable. The measured map and scientific calculations remain available. ${e instanceof Error ? e.message : ""}`,
      );
    }
    // Configuration changes rebuild resources; playback and camera changes never rebuild the renderer.
  }, [
    terrain,
    run,
    scenario.mode,
    scenario.rover.design,
    scenario.environment.planet,
    scenario.environment.density,
    start.x,
    start.y,
    destination.x,
    destination.y,
    observations,
    layer,
    quality,
    exaggeration,
    reset,
  ]);
  const inspect = inspection ?? start,
    elevation = sampleTerrain(terrain, inspect),
    slope = slopeAt(terrain, inspect);
  const heights = terrain.grid.elevation_m.filter(
      (z): z is number => z !== null,
    ),
    low = Math.min(...heights),
    high = Math.max(...heights);
  const regional = cameraMode === "orbit" || cameraMode === "overhead";
  const outcome = terminalState(run, props.frame?.t ?? 0);
  const nextIgnition = run?.events.find(
    (event) => event.type === "Ignition" && event.t > (props.frame?.t ?? 0),
  );
  const chooseCamera = (mode: CameraMode) => {
    setCameraMode(mode);
    if (mode !== "orbit" && mode !== "overhead") setExaggeration(1);
  };
  return (
    <section
      ref={section}
      className="ml-viewer ml-observatory"
      aria-label={localizeText("Digital terrain reconstruction")}
    >
      <div className="ml-scene-toolbar">
        <span>
          <span className="ml-live-dot" />{localizeText(" TERRAIN /")}{localizeText(" ")}
          {localizeText(terrain.body.toUpperCase())} <i />{localizeText(" ")}
          {localizeText(regional ? "REGIONAL RECONSTRUCTION" : "VEHICLE OPERATIONS")}
        </span>
        <div>
          <button
            aria-label={localizeText("Scene display settings")}
            aria-expanded={showSettings}
            onClick={() => setShowSettings((v) => !v)}
          >
            <Layers3 size={13} />{localizeText(" Display")}</button>
          <button
            aria-label={localizeText("Reset camera")}
            onClick={() => setReset((v) => v + 1)}
          >
            <RotateCcw size={13} />
          </button>
          <button
            aria-label={localizeText("Fullscreen viewport")}
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else
                void section.current
                  ?.requestFullscreen()
                  .catch(() =>
                    setError(
                      "Fullscreen is unavailable in this browser. The viewport remains interactive.",
                    ),
                  );
            }}
          >
            <Maximize2 size={14} />
          </button>
        </div>
      </div>
      <div className="ml-canvas-wrap">
        <div ref={host} className="ml-canvas" />
        {localizeText(error && (
          <div className="ml-fallback">
            <p role="status">{localizeText(error)}</p>
            <svg
              viewBox="0 0 100 100"
              role="img"
              aria-label={localizeText("Measured terrain map")}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const p = {
                  x:
                    terrain.grid.west_m +
                    ((event.clientX - rect.left) / rect.width) *
                      (terrain.grid.side - 1) *
                      terrain.grid.cell_m,
                  y:
                    terrain.grid.north_m -
                    ((event.clientY - rect.top) / rect.height) *
                      (terrain.grid.side - 1) *
                      terrain.grid.cell_m,
                };
                setInspection(p);
                live.current.onPick(p);
              }}
            >
              {localizeText(terrain.grid.elevation_m.map(
                (z, i) =>
                  z !== null && (
                    <rect
                      key={i}
                      x={((i % terrain.grid.side) * 100) / terrain.grid.side}
                      y={
                        (Math.floor(i / terrain.grid.side) * 100) /
                        terrain.grid.side
                      }
                      width={100 / terrain.grid.side + 0.05}
                      height={100 / terrain.grid.side + 0.05}
                      fill={`hsl(32 18% ${20 + (55 * (z - low)) / Math.max(1, high - low)}%)`}
                    />
                  ),
              ))}
            </svg>
            <button onClick={() => setReset((v) => v + 1)}>{localizeText("Retry 3D scene")}</button>
          </div>
        ))}
        <div className="ml-scene-title">
          <span className="ml-overline">
            {localizeText(terrain.body === "mars"
              ? "MARS EXPLORATION"
              : terrain.body === "moon"
                ? "LUNAR OPERATIONS"
                : "EARTH ANALOG FIELD")}
          </span>
          <h2>
            {localizeText(terrain.id === "MARS_JEZERO"
              ? "Jezero crater"
              : terrain.body === "moon"
                ? "Mons Mouton"
                : terrain.name.replace(" regional window", ""))}
          </h2>
          <p>
            {localizeText(Math.abs(terrain.lat).toFixed(4))}° {localizeText(terrain.lat < 0 ? "S" : "N")}{localizeText(" ")}
            <i /> {localizeText(Math.abs(terrain.lon).toFixed(4))}°{localizeText(" ")}
            {localizeText(terrain.lon < 0 ? "W" : "E")} <i /> {localizeText(terrain.grid.cell_m)}{localizeText(" m DEM")}</p>
        </div>
        <div className="ml-scene-status" data-state={outcome}>
          <span>{localizeText(run ? "RECORDED SIMULATION" : "MISSION PREVIEW")}</span>
          <strong>
            {localizeText(outcome === "pending"
              ? (props.frame?.phase ?? "Awaiting calculation")
              : run?.outcome.replaceAll("_", " "))}
          </strong>
          {localizeText(run && <small>{localizeText("T+ ")}{localizeText((props.frame?.t ?? 0).toFixed(1))}{localizeText(" s")}</small>)}
          {localizeText(nextIgnition && (
            <small>{localizeText("IGNITION IN ")}{localizeText((nextIgnition.t - (props.frame?.t ?? 0)).toFixed(1))}{localizeText(" ")}{localizeText("s")}</small>
          ))}
        </div>
        {localizeText(showSettings && (
          <div className="ml-display-panel">
            <label>{localizeText("Surface layer")}<select
                aria-label={localizeText("Terrain layer")}
                value={layer}
                onChange={(e) => setLayer(e.target.value)}
              >
                <option value="surface">{localizeText("Natural material · illustrative")}</option>
                <option value="elevation">{localizeText("Measured elevation")}</option>
                <option value="slope">{localizeText("Regional slope")}</option>
                {localizeText(scenario.rover.design && <option value="mobility">{localizeText("Configured rover constraints")}</option>)}
              </select>
            </label>
            {localizeText(layer==="mobility" && <p className="ml-tiny">{localizeText("Green: admissible · amber: motor demand &gt;70% · red: blocked. Conservative uphill screening of regional slope; no contact prediction.")}</p>)}
            <label>{localizeText("Rendering")}<select
                aria-label={localizeText("Rendering quality")}
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
              >
                <option value="auto">{localizeText("Adaptive quality")}</option>
                <option value="low">{localizeText("Low GPU")}</option>
                <option value="high">{localizeText("High quality")}</option>
              </select>
            </label>
            <label className="ml-check">
              <input
                type="checkbox"
                checked={vectors}
                onChange={(e) => setVectors(e.target.checked)}
              />{localizeText(" ")}{localizeText("Force & velocity vectors")}</label>
            <label className="ml-check">
              <input
                type="checkbox"
                checked={trajectory}
                onChange={(e) => setTrajectory(e.target.checked)}
              />{localizeText(" ")}{localizeText("Recorded trajectory")}</label>
            <label className="ml-check">
              <input
                type="checkbox"
                checked={details}
                onChange={(e) => setDetails(e.target.checked)}
              />{localizeText(" ")}{localizeText("Illustrative rocks & disturbance")}</label>
            <label>{localizeText("Relief")}<select
                aria-label={localizeText("Vertical exaggeration")}
                value={exaggeration}
                onChange={(e) => {
                  setExaggeration(Number(e.target.value));
                  if (Number(e.target.value) !== 1) setCameraMode("orbit");
                }}
              >
                <option value="1">{localizeText("True scale")}</option>
                <option value="3">{localizeText("Regional relief ×3")}</option>
              </select>
            </label>
            <label className="ml-sun">
              <Sun size={13} />
              <input
                aria-label={localizeText("Illustrative Sun elevation")}
                type="range"
                disabled={!!scenario.solar}
                min="5"
                max="80"
                value={sun}
                onChange={(e) => setSun(Number(e.target.value))}
              />
              <span>{localizeText(scenario.solar ? "SPICE" : `${sun}°`)}</span>
            </label>
            <p>
              {localizeText(scenario.solar ? "Recorded CSPICE solar direction at the selected UTC epoch. Terrain shadow and atmospheric scattering remain approximate. " : "Art-directed sunlight; not time-of-day illumination. ")}{localizeText("Rocks, dust and materials add no observations or collision hazards.")}</p>
            <output aria-label={localizeText("Rendering performance")}>
              {localizeText(profile
                ? `${profile.fps} fps active · ${profile.calls} calls · ${(profile.triangles / 1000).toFixed(0)}k triangles · DPR ${profile.ratio}. CPU submit ${profile.cpuMs.toFixed(2)} ms · GPU ${profile.gpuMs === null ? "timer unavailable" : `${profile.gpuMs.toFixed(2)} ms`} · ${profile.geometries} geometries · ${profile.textures} textures.`
                : "Profiling when scene renders…")}
            </output>
          </div>
        ))}
        {localizeText((vectors || presentation === "scientific") && !regional && (
          <div className="ml-vector-key">
            <span>{localizeText("↓ Gravity ")}{localizeText(scenario.environment.gravity)}{localizeText(" m/s²")}</span>
            <span>{localizeText("↗ Velocity ")}{localizeText(props.frame?.speed.toFixed(2) ?? "0.00")}{localizeText(" m/s")}</span>
            <span>{localizeText("↑ Thrust ")}{localizeText(((props.frame?.thrust ?? 0) / 1000).toFixed(1))}{localizeText(" kN")}</span>
            <small>{localizeText("Directions from model · vector lengths illustrative")}</small>
          </div>
        ))}
        {localizeText(!!props.exploded && !regional && <div className="ml-contact-banner" data-state="pending"><span>{localizeText("ENGINEERING INSPECTION / VISUAL ONLY")}</span><strong>{localizeText("Exploded assembly")}</strong><p>{localizeText("Components offset for inspection. This is not a simulated mechanical event.")}</p></div>)}
        {localizeText(run && !regional && !props.exploded && outcome !== "pending" && (
          <div className="ml-contact-banner" data-state={outcome}>
            <span>
              {localizeText(outcome === "success"
                ? "COMPLETION CRITERIA MET"
                : outcome === "failure"
                  ? "CONSTRAINT / CONTACT FAILURE"
                  : "MODEL RECORD ENDED")}
            </span>
            <strong>{localizeText(run.outcome.replaceAll("_", " "))}</strong>
            <p>
              {localizeText(run.metrics.touchdownSpeed !== null
                ? `${run.metrics.touchdownSpeed.toFixed(2)} m/s at contact · threshold ${run.scenario.vehicle.safeSpeed} m/s`
                : `${run.metrics.distance.toFixed(0)} m traveled · ${run.metrics.duration.toFixed(1)} s recorded`)}
            </p>
            {localizeText(run.metrics.touchdownSpeed !== null && (
              <small>{localizeText("Contact snapshot retained. Post-contact dynamics are not modeled.")}</small>
            ))}
          </div>
        ))}
        <div className="ml-camera-dock" aria-label={localizeText("Camera controls")}>
          {localizeText(cameras
            .filter(
              (c) =>
                c.id !== "mast" ||
                scenario.mode === "rover" ||
                scenario.mode === "eva",
            )
            .map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                aria-label={localizeText(`${id} camera`)}
                aria-pressed={cameraMode === id}
                onClick={() => chooseCamera(id)}
              >
                <Icon size={14} />
                <span>{localizeText(label)}</span>
              </button>
            )))}
        </div>
        <div className="ml-view-caption">
          <span>
            {localizeText(regional
              ? `20 km measured window · vertical ×${exaggeration}${run ? " · full record dashed / elapsed solid" : ""}`
              : props.exploded ? "EXPLODED ASSEMBLY · INSPECTION ONLY" : "TRUE-SCALE VEHICLE · ILLUSTRATIVE ENGINEERING DESIGN")}
          </span>
          <span>
            {localizeText(cameraMode === "ground"
              ? "Focus scene · WASD / arrows move 5 m"
              : tool === "inspect"
                ? "Drag to orbit · scroll to zoom"
                : `Click measured terrain to place ${tool}`)}
          </span>
        </div>
      </div>
      <div className="ml-scene-bottom">
        <span className="ml-provenance-dot" />
        <span>
          <b>{localizeText("Measured macroterrain")}</b> · {localizeText(terrain.grid.cell_m)}{localizeText(" m samples")}</span>
        <span>{localizeText("Vehicle mechanics, materials & rocks are illustrative.")}{localizeText(" ")}
          {localizeText(scenario.mode === "rover" || scenario.mode === "eva"
            ? "Kinematic wheel contact; no regolith dynamics."
            : "Point-mass flight; no structural damage model.")}
        </span>
        <span className="ml-inspect-coordinate">{localizeText("E ")}{localizeText(inspect.x.toFixed(0))}{localizeText(" / N ")}{localizeText(inspect.y.toFixed(0))} ·{localizeText(" ")}
          {localizeText(elevation?.toFixed(0))}{localizeText(" m · ")}{localizeText(slope?.toFixed(1))}°
        </span>
      </div>
    </section>
  );
}
