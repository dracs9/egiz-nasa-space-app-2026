import { t as localizeText, useLanguage } from '../i18n';
import type { Scenario } from "./types";

export function LaunchProgram({
  scenario,
  onChange,
}: {
  scenario: Scenario;
  onChange(scenario: Scenario): void;
}) {
  useLanguage();
  const steps = scenario.thrustProgram ?? [{ time: 0, throttle: 1 }];
  const change = (index: number, key: "time" | "throttle", value: number) =>
    onChange({
      ...scenario,
      thrustProgram: steps.map((s, i) =>
        i === index ? { ...s, [key]: value } : s,
      ),
    });
  return (
    <details className="ml-throttle">
      <summary>{localizeText("Launch throttle program")}</summary>
      <p>{localizeText("Hold each command until the next time. Integration splits at every change; fuel limits still apply.")}</p>
      {localizeText(steps.map((step, i) => (
        <div className="ml-throttle-step" key={i}>
          <label className="ml-field">
            <span>{localizeText("Time ")}{localizeText(i + 1)}{localizeText(" (s)")}</span>
            <input
              type="number"
              aria-label={localizeText(`Throttle time ${i + 1} (s)`)}
              min={0}
              max={scenario.duration}
              step={0.1}
              disabled={i === 0}
              value={Number.isFinite(step.time) ? step.time : ""}
              onChange={(e) =>
                change(
                  i,
                  "time",
                  e.target.value === "" ? NaN : Number(e.target.value),
                )
              }
            />
          </label>
          <label className="ml-field">
            <span>{localizeText("Throttle ")}{localizeText(i + 1)} (%)</span>
            <input
              type="number"
              aria-label={localizeText(`Throttle ${i + 1} (%)`)}
              min={0}
              max={100}
              value={Number.isFinite(step.throttle) ? step.throttle * 100 : ""}
              onChange={(e) =>
                change(
                  i,
                  "throttle",
                  e.target.value === "" ? NaN : Number(e.target.value) / 100,
                )
              }
            />
          </label>
          <button
            type="button"
            aria-label={localizeText(`Remove throttle step ${i + 1}`)}
            disabled={i === 0}
            onClick={() =>
              onChange({
                ...scenario,
                thrustProgram: steps.filter((_, j) => j !== i),
              })
            }
          >
            ×
          </button>
        </div>
      )))}
      <button
        type="button"
        disabled={steps.length >= 16 || steps.at(-1)!.time >= scenario.duration}
        onClick={() =>
          onChange({
            ...scenario,
            thrustProgram: [
              ...steps,
              {
                time: Math.min(scenario.duration, steps.at(-1)!.time + 10),
                throttle: 0,
              },
            ],
          })
        }
      >{localizeText("+ Add throttle change")}</button>
    </details>
  );
}
