// EGIZ ASTRAL · reproducible mission dossier. Records inputs, methods, outputs, uncertainty and limits.
import { MODELS } from "../intelligence/registry";
import { TERRAIN_CLASSES, type Rock } from "../intelligence/perception";
import { REFERENCES } from "../intelligence/discovery";
import type { ToolLog } from "../intelligence/copilot";
import { SOILS } from "../sim/terramechanics";
import type { MissionResult } from "../sim/mission";
import type { SceneAnalysis, WorldSession } from "./session";

export interface DossierInput { session: WorldSession; analysis: SceneAnalysis | null; result: MissionResult | null; baseline: MissionResult | null; rocks: Rock[]; toolLog: ToolLog[]; render: { quality: string; stats: unknown } }
const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const mission = (r: MissionResult) => ({ spec: r.spec, rover: r.rover, outcome: r.outcome, explanation: r.explanation, metrics: r.metrics, model: r.model, events: r.events,
  alternatives: r.alternatives.map(a => (a.points ? { objective: a.objective, why: a.why, metrics: a.metrics, vertices: a.points.length } : { objective: a.objective, failed: a.reason })),
  route: r.route ? r.route.points.map(p => [round(p.x, 1), round(p.y, 1)]) : null,
  telemetry: { samples: r.frames.length, columns: ["t_s", "x_m", "y_m", "z_m", "battery_Wh", "slip", "drive_W", "generation_W", "pitch_deg", "roll_deg"],
    rows: r.frames.filter((_, i) => i % Math.max(1, Math.ceil(r.frames.length / 400)) === 0).map(f => [round(f.t, 0), round(f.x, 1), round(f.y, 1), round(f.z, 2), round(f.batteryWh, 1), round(f.slip), round(f.drivePowerW, 1), round(f.generationW, 1), round(f.pitchDeg, 2), round(f.rollDeg, 2)]) } });

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
/** The dossier body is deterministic for identical inputs; only `generatedAt` and the tool-log timestamps vary. */
export async function buildDossier(d: DossierInput) {
  const m = d.session.manifest, a = d.analysis;
  const body = {
    schema: "egiz.astral_dossier", version: "1.0.0",
    world: { site: m.site, localCrs: m.local_crs, axes: m.local_axes, extent: m.extent, levels: m.levels, sources: m.sources, method: m.method,
      tileFingerprint: await sha256Hex(m.tiles.map(t => t.height_sha256 + (t.image_sha256 ?? "")).join("")), simulationTerrain: { level: d.session.field.level, postingM: d.session.field.posting, provenance: d.session.field.provenance } },
    illumination: d.session.solar ? { engine: d.session.solar.engine, epochUtc: d.session.solar.epochUtc, durationS: d.session.solar.duration, frame: d.session.solar.frame, kernels: d.session.solar.kernels, limitations: d.session.solar.limitations } : { unavailable: d.session.solarNote },
    interpretation: a ? {
      classes: TERRAIN_CLASSES.slice(1).map(c => ({ class: c.label, rule: c.rule, areaFraction: round(a.classShare[c.id], 4) })),
      terrainUnits: { model: a.units.id, k: a.units.k, seed: a.units.seed, features: a.units.features, trainedCells: a.units.trainedCells, centroids: a.units.centroids.map(c => c.map(v => round(v))), sizes: a.units.sizes },
      craters: a.craters.map(c => ({ id: c.id, x: c.x, y: c.y, diameterM: c.radiusM * 2, depthM: round(c.depthM, 2), confidence: round(c.confidence, 2), status: "model-detected candidate" })),
      outlierCells: a.outliers.length, shading: a.shading, dataQuality: a.quality,
      rocks: { detected: d.rocks.length, largestM: round(d.rocks.reduce((b, r) => Math.max(b, r.diameterM), 0), 2), tiles: [...new Set(d.rocks.map(r => r.tileKey))].sort(), status: "image-derived candidates" },
    } : { unavailable: "Scene analysis was not run." },
    mission: d.result ? mission(d.result) : null, baseline: d.baseline ? mission(d.baseline) : null,
    surfaceProfiles: Object.values(SOILS), models: MODELS.map(({ id, name, status, evaluation, limitations }) => ({ id, name, status, evaluation, limitations })),
    references: REFERENCES.map(({ id, citation, url }) => ({ id, citation, url })), limitations: m.limitations, render: d.render,
    reproduce: ["python -m pipeline.world.scene " + d.session.dir, "npm --prefix web run build", "Load the mission specification in Mission Studio and run the simulation; routes and metrics are deterministic."],
  };
  const sha256 = await sha256Hex(JSON.stringify(body));
  return { document: { ...body, contentSha256: sha256, generatedAt: new Date().toISOString(), toolLog: d.toolLog }, sha256 };
}
export function dossierMarkdown(doc: Awaited<ReturnType<typeof buildDossier>>["document"]): string {
  const L: string[] = [], w = doc.world, r = doc.mission;
  L.push(`# EGIZ ASTRAL mission dossier`, ``, `Site: **${w.site.name}** (${w.site.body}, ${w.site.lat}°N ${w.site.lon}°E) · generated ${doc.generatedAt}`, `Content fingerprint: \`${doc.contentSha256}\``, ``);
  L.push(`## Terrain and imagery`, `- ${w.sources.dtm.product} — ${w.sources.dtm.citation}`, ...(w.sources.ortho ? [`- ${w.sources.ortho.product} — ${w.sources.ortho.citation}`] : []), `- Simulation terrain: ${w.simulationTerrain.postingM} m posts (${w.simulationTerrain.provenance}). ${w.method}`, ``);
  if (r) {
    L.push(`## Mission`, `- Rover: ${r.rover.name} (${r.rover.kind}). ${r.rover.note}`, `- Objective ${r.spec.objective}; slope limit ${r.spec.maxSlopeDeg}°; reserve ${(r.spec.reserveFraction * 100).toFixed(0)}%; surface ${r.spec.surface}; fidelity ${r.model.fidelity}.`, `- **Outcome: ${r.outcome}.** ${r.explanation}`,
      `- Distance ${r.metrics.distanceM.toFixed(0)} m; duration ${(r.metrics.durationS / 3600).toFixed(2)} h; energy used ${r.metrics.energyUsedWh.toFixed(0)} Wh; battery minimum ${r.metrics.minBatteryWh.toFixed(0)} Wh; peak slip ${(r.metrics.maxSlip * 100).toFixed(0)}%; peak tilt ${r.metrics.maxTiltDeg.toFixed(1)}°.`, ``,
      `| Route | Length m | Drive h | Energy Wh | Max slope ° | Mean slip % |`, `|---|---|---|---|---|---|`,
      ...r.alternatives.map(x => ("metrics" in x && x.metrics ? `| ${x.objective} | ${x.metrics.lengthM.toFixed(0)} | ${(x.metrics.driveTimeS / 3600).toFixed(2)} | ${x.metrics.driveEnergyWh.toFixed(0)} | ${x.metrics.maxSlopeDeg.toFixed(1)} | ${(x.metrics.meanSlip * 100).toFixed(0)} |` : `| ${x.objective} | no route | | | | |`)), ``,
      `### Events`, ...r.events.map(e => `- T+${(e.t / 60).toFixed(0)} min · ${e.type}: ${e.detail}`), ``, `### Model assumptions`, ...r.model.assumptions.map(x => `- ${x}`), ``);
  } else L.push(`## Mission`, `No mission was simulated.`, ``);
  if ("classes" in doc.interpretation) { const i = doc.interpretation; L.push(`## Interpretation layers (model output, unvalidated)`, ...i.classes!.map(c => `- ${c.class}: ${(c.areaFraction * 100).toFixed(1)}% — ${c.rule}`), `- ${i.craters!.length} crater candidates; ${i.outlierCells} outlier cells; ${i.rocks!.detected} rock candidates.`, ``, `### Data quality`, ...i.dataQuality!.map(q => `- [${q.status}] ${q.check}: ${q.detail}`), ``); }
  L.push(`## Limitations`, ...doc.limitations.map(x => `- ${x}`), ``, `## References`, ...doc.references.map(x => `- ${x.citation}${x.url ? ` ${x.url}` : ""}`), ``, `## Reproduce`, ...doc.reproduce.map(x => `- ${x}`), ``);
  return L.join("\n");
}
