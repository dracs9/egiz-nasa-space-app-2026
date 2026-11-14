import { ContextHelp } from '../components/ContextHelp';
import { t as localizeText, useLanguage } from '../i18n';
import { useMemo } from "react";
import { comparisonInsights, terrainStatistics } from "./analysis";
import type { RunResult } from "./types";
export function ComparisonEvidence({ runs }: { runs: RunResult[] }) {
  useLanguage();
  const evidence = useMemo(() => {
    const unique = [
      ...new Map(runs.map((run) => [run.terrain.id, run.terrain])).values(),
    ];
    return unique.map((terrain) => ({
      terrain,
      stats: terrainStatistics(terrain),
    }));
  }, [runs]);
  const insights = useMemo(() => comparisonInsights(runs), [runs]);
  const surface = runs.every(
    (r) => r.scenario.mode === "rover" || r.scenario.mode === "eva",
  );
  const metric = (r: RunResult) =>
    surface ? r.metrics.energyWh : r.metrics.maxAltitude;
  const maximum = Math.max(1, ...runs.map(metric));
  return (
    <div className="ml-compare-evidence">
      <div className="ml-compare-bars">
        <h3>{localizeText(surface ? "Calculated energy proxy" : "Maximum altitude AGL")}</h3>
        <p>{localizeText("Compare complete runs with matching objectives; blocked runs have no traversal cost.")}</p>
        {localizeText(runs.map((r, i) => (
          <div key={r.id}>
            <span title={localizeText(`${r.terrain.name} · ${r.scenario.kind}`)}>
              {localizeText(i + 1)}.{localizeText(" ")}
              {localizeText(r.terrain.body === "earth"
                ? r.terrain.name.split(" regional")[0]
                : r.terrain.body)}{localizeText(" ")}
              <small>{localizeText(r.scenario.environment.planet)}{localizeText(" physics")}</small>
            </span>
            <i>
              <b
                style={{
                  width: `${(metric(r) / maximum) * 100}%`,
                  background:
                    r.scenario.kind === "counterfactual"
                      ? "#d9b480"
                      : "#75c9b5",
                }}
              />
            </i>
            <strong>
              {localizeText(metric(r).toFixed(0))} {localizeText(surface ? "Wh" : "m")}
            </strong>
          </div>
        )))}
      </div>
      <div className="ml-terrain-stats">
        <h3>{localizeText("Measured regional geometry")}</h3>
        <p>{localizeText("Common 200 m grids; 400 m central-difference stencil. Source resolution and vertical error differ.")}</p>
        <table>
          <thead>
            <tr>
              <th>{localizeText("Terrain")}</th>
              <th>{localizeText("Slope P50")}</th>
              <th>{localizeText("Slope P90")}</th>
              <th>{localizeText("P95−P5 relief")}</th>
            </tr>
          </thead>
          <tbody>
            {localizeText(evidence.map(({ terrain, stats }) => (
              <tr key={terrain.id}>
                <td>{localizeText(terrain.name)}</td>
                <td>{localizeText(stats.p50Slope?.toFixed(2) ?? "—")}°</td>
                <td>{localizeText(stats.p90Slope?.toFixed(2) ?? "—")}°</td>
                <td>{localizeText(stats.relief?.toFixed(0) ?? "—")}{localizeText(" m")}</td>
              </tr>
            )))}
          </tbody>
        </table>
        <ContextHelp label="Model & assumptions"><p>{localizeText("Computed over the 20 km reconstruction; these are distinct from the campaign’s 10 km fine-core scores. Absolute elevations use different datums and are not compared.")}</p></ContextHelp>
      </div>
      {localizeText(insights.length > 0 && (
        <div className="ml-data-insights">
          <h3>{localizeText("What this experiment shows")}</h3>
          {localizeText(insights.map((note) => (
            <p key={note}>{localizeText(note)}</p>
          )))}
          <ContextHelp label="Model & assumptions"><p className="ml-tiny">{localizeText("No geological, atmospheric or operational equivalence is established. These explanations use the recorded results without an AI service.")}</p></ContextHelp>
        </div>
      ))}
    </div>
  );
}
