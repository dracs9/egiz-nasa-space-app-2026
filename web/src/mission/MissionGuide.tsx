import { t as localizeText, useLanguage } from '../i18n';
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Boxes, Check, Play, X } from "lucide-react";
import type { Mode, Planet, RunResult } from "./types";
import "./guide.css";

export const GUIDE_SEEN_KEY = "egiz.mission-guide.v1";
export type GuideStep = 0 | 1 | 2 | 3 | 4;
const steps = ["World", "Terrain", "Mission", "Replay", "Results"];

export function useMissionGuide() {
  const [welcome, setWelcome] = useState(() => {
    try {
      return localStorage.getItem(GUIDE_SEEN_KEY) !== "seen";
    } catch {
      return true;
    }
  });
  const [step, setStep] = useState<GuideStep | null>(null);
  const dismissWelcome = () => {
    setWelcome(false);
    try {
      localStorage.setItem(GUIDE_SEEN_KEY, "seen");
    } catch {
      /* The guide still works when browser storage is unavailable. */
    }
  };
  return { welcome, step, setStep, dismissWelcome };
}

export function MissionWelcome({
  onStart,
  onDismiss,
}: {
  onStart(): void;
  onDismiss(): void;
}) {
  useLanguage();
  return (
    <section className="ex-welcome" aria-labelledby="welcome-title">
      <div className="ex-welcome-intro">
        <h2 id="welcome-title">{localizeText("Explore. Simulate. Compare.")}</h2>
        <p>{localizeText("Try rover, launch and landing missions on Mars, the Moon or Earth.")}</p>
      </div>
      <div className="ex-welcome-actions">
        <button className="ex-guide-primary" onClick={onStart}>{localizeText("Start guide ")}<ArrowRight size={15} />
        </button>
        <button className="ex-guide-skip" onClick={onDismiss}>{localizeText("Explore freely")}</button>
      </div>
    </section>
  );
}

export function MissionGuide({
  step,
  onGo,
  onRun,
  onClose,
  onCompare,
  onPlayback,
  onWorld,
  onInspect,
  body,
  region,
  cellSize,
  mode,
  run,
  busy,
  validationError,
}: {
  step: GuideStep;
  onGo(step: GuideStep): void;
  onRun(): void;
  onClose(): void;
  onCompare(): void;
  onPlayback(): void;
  onWorld(body: Planet): void;
  onInspect?():void;
  body: Planet;
  region: string;
  cellSize: number;
  mode: Mode;
  run: RunResult | null;
  busy: boolean;
  validationError?: string;
}) {
  useLanguage();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current
      ?.closest("section")
      ?.scrollIntoView?.({ block: "nearest", behavior: "instant" });
  }, [step]);
  const mission = {
    rover: "Drive across the terrain and estimate energy use.",
    launch: "Test a rocket’s flight under the selected conditions.",
    descent: "See whether the lander can touch down safely.",
    eva: "Plan a route for surface exploration.",
  }[mode];
  const titles = [
    "Choose a world",
    `Explore ${region}`,
    "Run a mission",
    "Replay your mission",
    "Your results",
  ];
  const descriptions = [
    `${region} is selected.`,
    "Drag to rotate. Scroll or pinch to zoom.",
    mission,
    "Pause, change speed or drag the timeline.",
    "Review the outcome below or compare with Earth.",
  ];
  const hint =
    step === 1
      ? `${cellSize} m terrain samples · Small hazards aren’t resolved.`
      : step === 2 && validationError
        ? `Check Mission configuration: ${validationError}`
        : "";
  const next = () => {
    if (step === 2 && !run) onRun();
    else if (step === 4) onClose();
    else onGo((step + 1) as GuideStep);
  };
  return (
    <section className="ex-guide" aria-label={localizeText("Step-by-step mission guide")}>
      <div className="ex-guide-top">
        <span className="ex-guide-eyebrow">
          <BookOpen size={13} />{localizeText(" QUICK GUIDE")}{localizeText(" ")}
          <b>
            {localizeText(step + 1)} / {localizeText(steps.length)}
          </b>
        </span>
        <button
          className="ex-guide-close"
          onClick={onClose}
          aria-label={localizeText("Close guide")}
        >
          <X size={16} />
        </button>
      </div>
      <ol className="ex-guide-steps" aria-label={localizeText("Guide steps")}>
        {localizeText(steps.map((label, i) => (
          <li key={label}>
            <button
              aria-current={i === step ? "step" : undefined}
              disabled={busy || (i >= 3 && !run)}
              title={
                localizeText(i >= 3 && !run ? "Run a mission to unlock this step" : label)
              }
              onClick={() => onGo(i as GuideStep)}
            >
              <span>{localizeText(i < step ? <Check size={12} /> : `0${i + 1}`)}</span>
              {localizeText(label)}
            </button>
          </li>
        )))}
      </ol>
      <div className="ex-guide-body">
        <div className="ex-guide-copy">
          <h2 ref={heading} tabIndex={-1}>
            {localizeText(titles[step])}
          </h2>
          <p>{localizeText(descriptions[step])}</p>
          {localizeText(step === 0 && (
            <div
              className="ex-guide-worlds"
              aria-label={localizeText("Choose a world for the guide")}
            >
              {localizeText((["mars", "moon", "earth"] as const).map((world) => (
                <button
                  key={world}
                  aria-pressed={body === world}
                  disabled={busy}
                  onClick={() => onWorld(world)}
                >
                  <span className={`ex-world-dot ${world}`} />
                  {localizeText(world === "mars"
                    ? "Mars"
                    : world === "moon"
                      ? "Moon"
                      : "Earth")}
                </button>
              )))}
            </div>
          ))}
          {localizeText(hint && <p className="ex-guide-hint">{localizeText(hint)}</p>)}
        </div>
        <div className="ex-guide-actions">
          {onInspect&&<button onClick={onInspect}><Boxes size={15}/>{localizeText("Equipment & component guide")}</button>}
          <button
            className="ex-guide-primary"
            onClick={next}
            disabled={busy || (step === 2 && !!validationError)}
          >
            {localizeText(busy
              ? "Calculating…"
              : [
                  "Explore terrain",
                  "Choose mission",
                  run ? "Watch replay" : "Run mission",
                  "View results",
                  "Finish guide",
                ][step])}
            {localizeText(step === 2 && !run ? (
              <Play size={14} />
            ) : step === 4 ? (
              <Check size={14} />
            ) : (
              <ArrowRight size={14} />
            ))}
          </button>
          {localizeText(step === 4 && (
            <button onClick={onCompare}>{localizeText("Compare with Earth ")}<ArrowRight size={13} />
            </button>
          ))}
          {localizeText(step === 3 && (
            <button onClick={onPlayback}>{localizeText("Playback controls ")}<Play size={13} />
            </button>
          ))}
          {localizeText(step > 0 && (
            <button
              onClick={() => onGo((step - 1) as GuideStep)}
              disabled={busy}
            >
              <ArrowLeft size={13} />{localizeText(" Back")}</button>
          ))}
        </div>
      </div>
    </section>
  );
}
