import { message } from '../i18n/messages';
import { t as localizeText, useLanguage } from '../i18n';
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownRight,
  Crosshair,
  Globe2,
  Grid2X2,
  Maximize2,
  RotateCcw,
} from "lucide-react";
import type { MissionTerrain, SpiceGeometry } from "./types";
import { solarAt } from "./solar";
import { createPlanetScene, type PlanetProfile } from "./scene/planet";

export function PlanetView({
  terrain,
  onEnter,
  focusTarget = false,
  onCapture,
  solar,
  time=0,
}: {
  terrain: MissionTerrain;
  onEnter(): void;
  focusTarget?: boolean;
  onCapture?(image: string): void;
  solar?: SpiceGeometry;
  time?: number;
}) {
  useLanguage();
  const geometry=useRef({solar,time});geometry.current={solar,time};
  const host = useRef<HTMLDivElement>(null),
    label = useRef<HTMLButtonElement>(null),
    section = useRef<HTMLElement>(null);
  const scene = useRef<ReturnType<typeof createPlanetScene> | null>(null);
  const [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [grid, setGrid] = useState(true),
    [entering, setEntering] = useState(false),
    [reset, setReset] = useState(0),
    [profile, setProfile] = useState<PlanetProfile | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [focused, setFocused] = useState(focusTarget);
  const focus = (target: boolean) => {
    setFocused(target);
    scene.current?.focus(target ? "target" : "planet");
  };
  useEffect(() => {
    setReady(false);
    setError("");
    setEntering(false);
    setProfile(null);
    setFocused(focusTarget);
    try {
      scene.current = createPlanetScene(
        host.current!,
        terrain,
        label.current!,
        () => setReady(true),
        setError,
        setProfile,
        onCapture,
        ()=>geometry.current.solar?solarAt(geometry.current.solar,geometry.current.time).sunEnu:null,
      );
      scene.current.grid(grid);
      if (focusTarget) scene.current.focus("target");
    } catch (e) {
      setError(
        `Planetary graphics unavailable: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return () => {
      scene.current?.dispose();
      scene.current = null;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [terrain, reset]);
  useEffect(() => {
    focus(focusTarget);
  }, [focusTarget]);
  const enter = () => {
    if (entering) return;
    setEntering(true);
    focus(true);
    timer.current = setTimeout(
      onEnter,
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? 0
        : 1100,
    );
  };
  return (
    <section
      className={`ex-planet ${entering ? "is-entering" : ""}`}
      ref={section}
      aria-label={localizeText("Planetary context")}
    >
      <div className="ex-planet-canvas" ref={host} />
      <div className="ex-orbit-heading">

        <h2>
          {localizeText(terrain.body === "moon"
            ? "The Moon"
            : terrain.body === "mars"
              ? "Mars"
              : "Earth")}
        </h2>
      </div>
      <div className="ex-orbit-phase">
        <span className="ex-overline">{localizeText("VIEWPOINT")}</span>
        <strong>
          {localizeText(entering
            ? "REGIONAL APPROACH"
            : focused
              ? "TARGET ACQUISITION"
              : "PLANETARY OVERVIEW")}
        </strong>
      </div>
      <button
        className="ex-planet-label"
        ref={label}
        onClick={enter}
        aria-label={message('Explore {region}', 'Изучить {region}', {region:terrain.name})}
      >
        <i />
        <span>
          {localizeText(terrain.name.split(" / ")[0])}
          <small>{localizeText("RESEARCH TARGET ↗")}</small>
        </span>
      </button>
      {localizeText(!ready && !error && (
        <div className="ex-asset-loading">{localizeText("Loading planetary imagery…")}</div>
      ))}
      {localizeText(error && (
        <div className="ex-asset-loading" role="status">
          {localizeText(error)}
          <button onClick={() => setReset((v) => v + 1)}>{localizeText("Retry planetary view")}</button>
        </div>
      ))}
      <div className="ex-planet-tools">
        <button
          aria-label={localizeText("Reset planetary camera")}
          onClick={() => focus(false)}
        >
          <RotateCcw size={16} />
        </button>
        <button aria-label={localizeText("Focus research target")} onClick={() => focus(true)}>
          <Crosshair size={16} />
        </button>
        <button
          aria-label={localizeText("Geographic grid")}
          aria-pressed={grid}
          onClick={() => {
            setGrid(!grid);
            scene.current?.grid(!grid);
          }}
        >
          <Grid2X2 size={16} />
        </button>
        <button
          aria-label={localizeText("Fullscreen planet")}
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else
              void section.current
                ?.requestFullscreen()
                .catch(() =>
                  setError(
                    "Fullscreen is unavailable. The planetary view remains interactive.",
                  ),
                );
          }}
        >
          <Maximize2 size={16} />
        </button>
      </div>
      <div className="ex-target-card">
        <span className="ex-overline">
          <i />{localizeText(" SELECTED RESEARCH REGION")}</span>
        <h3>{localizeText(terrain.name.split(" / ")[0])}</h3>
        <p>
          {localizeText(Math.abs(terrain.lat).toFixed(4))}° {localizeText(terrain.lat < 0 ? "S" : "N")}{localizeText(" ")}
          <b>/</b> {localizeText(Math.abs(terrain.lon).toFixed(4))}°{localizeText(" ")}
          {localizeText(terrain.lon < 0 ? "W" : "E")}
        </p>
        <div className="ex-target-facts">
          <span>{localizeText("GRID SPACING")}<strong>
              {localizeText(terrain.grid.cell_m)} <small>{localizeText("m")}</small>
            </strong>
          </span>
          <span>{localizeText("VALID SAMPLES")}<strong>
              {localizeText((terrain.grid.valid_fraction * 100).toFixed(1))}
              <small>%</small>
            </strong>
          </span>
        </div>
        <button onClick={enter} disabled={entering}>
          {localizeText(entering ? "Switching to local terrain" : "Explore measured terrain")}
          <ArrowDownRight size={17} />
        </button>
      </div>
      {localizeText(entering && (
        <div className="ex-frame-handoff">
          <Globe2 size={18} />
          <span>{localizeText("PLANET FIXED → LOCAL EAST / NORTH")}<strong>{localizeText("Loading the measured regional elevation grid")}</strong>
          </span>
        </div>
      ))}
      <div className="ex-orbit-footer">
        <span>{localizeText("DRAG TO ORBIT ")}<b>·</b>{localizeText(" SCROLL TO ZOOM")}</span>
        <span>{localizeText("VISUAL CONTEXT · ART-DIRECTED SUN")}</span>
      </div>
      <details className="ex-image-credit">
        <summary>{localizeText("Imagery & rendering")}</summary>
        <p>{localizeText("Solar System Scope / INOVE ·")}{localizeText(" ")}
          <a
            href="https://www.solarsystemscope.com/textures/"
            target="_blank"
            rel="noreferrer"
          >{localizeText("CC BY 4.0")}</a>{localizeText(". Color-adjusted global mosaic, not a local terrain measurement. Geographic grid; no orbital trajectory is implied.")}</p>
        <output aria-label={localizeText("Planet rendering performance")}>
          {localizeText(profile
            ? `${profile.calls} draws · ${(profile.triangles / 1000).toFixed(0)}k triangles · ${profile.textures} textures · ~${profile.textureMiB} MiB uncompressed · DPR ${profile.ratio} · renders on demand`
            : "Renderer warming up")}
        </output>
      </details>
    </section>
  );
}
