// Reproducible mission dossier: canonical inputs, outputs, hashes, provenance, uncertainty, limits.
import { sha256Hex } from '../core/codec';
import type { World } from '../core/world';
import { OBJECTIVE_LABEL, type MissionSpec, type Validation } from '../sim/mission';
import type { Route } from '../sim/planner';
import { REGOLITH } from '../sim/terramechanics';
import { ASTRAL_SIM_VERSION, type SimResult } from '../sim/traverse';
import { KNOWLEDGE } from '../intelligence/knowledge';
import { epochPlus } from '../analysis/illumination';

export const ASTRAL_VERSION = '1.0.0';

export interface DossierInput { world: World; spec: MissionSpec; validation: Validation; routes: Route[]; sims: Record<string, SimResult>; activeRouteId: string | null; copilotLog: { at: string; tool: string; args: unknown; summary: string }[]; routeChecks: Record<string, { maxSlope5m: number; exceedM: number }> }
export interface Dossier { json: Record<string, unknown>; markdown: string; inputHash: string; outputHash: string }

/** Stable JSON: sorted keys, finite numbers only. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(typeof value === 'number' && !Number.isFinite(value) ? null : value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).filter(k => (value as Record<string, unknown>)[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

export async function simulationHashes(world: World, spec: MissionSpec, route: Route, sim: SimResult) {
  const tiles = sim.tiles.map(k => ({ key: k, sha256: world.descriptor(k)?.sha256 }));
  const inputHash = await sha256Hex(canonical({ astral: ASTRAL_VERSION, sim: ASTRAL_SIM_VERSION, world: world.manifest.id, source: world.manifest.source.sha256, spice: world.illumination.epochUtc, spec, route: route.points, tiles }));
  const outputHash = await sha256Hex(canonical({ summary: sim.summary, frames: sim.frames, events: sim.events }));
  return { inputHash, outputHash, tiles };
}

export async function buildDossier(d: DossierInput): Promise<Dossier> {
  const { world, spec } = d, m = world.manifest;
  const active = d.routes.find(r => r.id === d.activeRouteId) ?? d.routes.find(r => r.feasible) ?? null;
  const sim = active ? d.sims[active.id] : undefined;
  const hashes = active && sim ? await simulationHashes(world, spec, active, sim) : null;
  const soil = REGOLITH.find(s => s.id === spec.soilId)!;
  const json = {
    schema: 'egiz.astral_dossier', version: '1.0.0', generatedAt: new Date().toISOString(), software: { astral: ASTRAL_VERSION, simulator: ASTRAL_SIM_VERSION },
    world: { id: m.id, name: m.name, body: m.body, referenceFrame: m.referenceFrame, source: m.source, postingsM: m.pyramid.postingsM, operationalBox: m.pyramid.operationalBox },
    illumination: { epochUtc: world.illumination.epochUtc, engine: world.illumination.engine, kernels: world.illumination.kernels.map(k => ({ name: k.name, sha256: k.sha256 })) },
    mission: spec, validation: d.validation,
    routes: d.routes.map(r => ({ id: r.id, objective: r.objective, feasible: r.feasible, reason: r.reason ?? null, lengthM: Math.round(r.lengthM), plannerCost: Number.isFinite(r.cost) ? r.cost : null, check5m: d.routeChecks[r.id] ?? null, summary: d.sims[r.id]?.summary ?? null })),
    activeRoute: active?.id ?? null, simulation: sim ? { summary: sim.summary, events: sim.events, frameCount: sim.frames.length } : null,
    reproducibility: hashes, aiModels: world.registry.filter(r => r.status.includes('inference_ready')).map(r => ({ id: r.id, version: r.version, evaluation: r.evaluation })),
    copilotToolLog: d.copilotLog, limitations: limitations(world), assumptions: assumptions(spec),
  };
  const md: string[] = [];
  const pct = (v: number) => `${(v * 100).toFixed(1)} %`;
  md.push(`# EGIZ ASTRAL mission dossier — ${spec.name}`, '', `Generated ${json.generatedAt} · EGIZ ASTRAL ${ASTRAL_VERSION} / simulator ${ASTRAL_SIM_VERSION}`, '');
  md.push('## 1. World and data', `- Site: ${m.name} (${m.body}), origin ${m.referenceFrame.originLonLat[1].toFixed(4)}°, ${m.referenceFrame.originLonLat[0].toFixed(4)}°`, `- Source DEM: ${m.source.product} — ${m.source.citation}; SHA-256 \`${m.source.sha256}\``, `- Vertical datum: ${m.referenceFrame.verticalDatum}; map frame ${m.referenceFrame.mapProjection}`, `- Resolution: native 5 m posts inside the operational box, 20 m analysis elsewhere; pyramid postings ${m.pyramid.postingsM.join(' / ')} m`, `- Illumination: ${world.illumination.engine}, epoch ${world.illumination.epochUtc}, ${world.illumination.samples.length} hourly samples`, '');
  md.push('## 2. Mission configuration', `- Created by: ${spec.provenance.createdBy}${spec.provenance.request ? ` — request “${spec.provenance.request}”` : ''}`, `- Rover profile: ${spec.roverId} ${JSON.stringify(spec.roverOverrides)} (EGIZ scenario vehicle, hypothetical)`, `- Regolith: ${soil.name} — ${soil.source}`, `- Terramechanics fidelity: ${spec.fidelity}`, `- Constraints: max slope ${spec.constraints.maxSlopeDeg}°, max cross-slope ${spec.constraints.maxCrossSlopeDeg}°, reserve ${pct(spec.constraints.minReserveFrac)}, avoid crater interiors ${spec.constraints.avoidCraterInteriors}`, `- Departure: ${epochPlus(world.illumination, spec.departureT).toISOString()} (T+${(spec.departureT / 3600).toFixed(1)} h)`, ...spec.waypoints.map(w => `- Science stop ${w.label} at (${w.x.toFixed(0)}, ${w.y.toFixed(0)}) m, ${(w.dwellS / 60).toFixed(0)} min — ${w.rationale ?? ''}`), ...spec.provenance.notes.map(n => `- ${n}`), '');
  md.push('## 3. Routes', '| Route | Feasible | Length | Duration | Energy used | Min SoC | Max slope (5 m check) | Sunlit | Outcome |', '|---|---|---|---|---|---|---|---|---|');
  for (const r of d.routes) {
    const s = d.sims[r.id]?.summary, c = d.routeChecks[r.id];
    md.push(`| ${OBJECTIVE_LABEL[r.objective]} | ${r.feasible ? 'yes' : `no — ${r.reason}`} | ${r.feasible ? `${(r.lengthM / 1000).toFixed(2)} km` : '—'} | ${s ? `${(s.durationS / 3600).toFixed(2)} h` : '—'} | ${s ? `${s.energyUsedWh} Wh` : '—'} | ${s ? pct(s.minSocFrac) : '—'} | ${c ? `${c.maxSlope5m.toFixed(1)}° (${c.exceedM.toFixed(0)} m over limit)` : '—'} | ${s ? pct(s.sunlitFraction) : '—'} | ${s ? (s.status === 'completed' ? 'completed' : `failed: ${s.failure}`) : '—'} |`);
  }
  md.push('');
  if (sim && active) {
    const s = sim.summary;
    md.push(`## 4. Simulation of the selected route (${OBJECTIVE_LABEL[active.objective]})`, `- Status: **${s.status}**${s.failure ? ` — ${s.failure}` : ''}`, `- Distance ${s.distanceM} m in ${(s.durationS / 3600).toFixed(2)} h (driving ${(s.driveTimeS / 3600).toFixed(2)} h), ${s.scienceStops} science stops`, `- Energy: used ${s.energyUsedWh} Wh, generated ${s.energyGeneratedWh} Wh, minimum SoC ${pct(s.minSocFrac)}, final ${pct(s.finalSocFrac)}; reserve breached: ${s.reserveBreached}`, `- Soil sensitivity of drive energy: loose ${s.energySensitivityWh.loose} Wh, firm ${s.energySensitivityWh.firm} Wh (same kinematics)`, `- Mobility: max slip ${pct(s.maxSlip)}, mean slip ${pct(s.meanSlip)}, max sinkage ${(s.maxSinkageM * 100).toFixed(1)} cm, max pitch ${s.maxPitchDeg}°, max roll ${s.maxRollDeg}°, min stability margin ${s.minStabilityMarginDeg}°`, `- Environment: sunlit ${pct(s.sunlitFraction)} of mission time, direct-to-Earth line of sight ${pct(s.earthLinkFraction)}`, `- Rock hazard (ASSUMED model): ${s.rockEncounterProbability === null ? 'disabled' : `P(≥1 rock above clearance) = ${pct(s.rockEncounterProbability)}`}`, '', '### Event log', ...sim.events.map(e => `- T+${(e.t / 3600).toFixed(2)} h, ${e.s.toFixed(0)} m — [${e.kind}] ${e.message}`), '');
  }
  if (hashes) md.push('## 5. Reproducibility', `- Input hash: \`${hashes.inputHash}\``, `- Output hash: \`${hashes.outputHash}\``, `- Terrain tiles used: ${hashes.tiles.length} (keys and SHA-256 in the JSON dossier)`, '- Re-run: load the JSON in Mission Studio (Evidence → Reproduce) or run the vitest integration test; identical inputs on the same JavaScript engine reproduce the output hash.', '');
  md.push('## 6. AI components used', ...world.registry.filter(r => r.status.includes('inference_ready')).map(r => `- ${r.name} (${r.id} v${r.version}) — evaluation: ${r.evaluation}`), '');
  if (d.copilotLog.length) md.push('### Copilot tool log', ...d.copilotLog.map(l => `- ${l.at} \`${l.tool}\` ${JSON.stringify(l.args)} → ${l.summary}`), '');
  md.push('## 7. Assumptions', ...json.assumptions.map(a => `- ${a}`), '', '## 8. Limitations', ...json.limitations.map(a => `- ${a}`), '');
  md.push('## 9. References', ...KNOWLEDGE.filter(k => k.kind !== 'internal').map(k => `- ${k.citation}`), '');
  const markdown = md.join('\n');
  return { json, markdown, inputHash: hashes?.inputHash ?? '', outputHash: hashes?.outputHash ?? '' };
}

export function assumptions(spec: MissionSpec) {
  return [
    'Rover profiles are hypothetical EGIZ scenario vehicles; no real vehicle is represented.',
    `Regolith mechanical parameters (${spec.soilId}) are literature/sensitivity values, not measurements at this site.`,
    'Equal static wheel loads; quasi-static traverse (no dynamic suspension, inertia or wheel–obstacle impacts).',
    'Vertical solar panels with a fixed efficiency; no thermal, dust or degradation model; batteries ideal.',
    'Uniform surface albedo for rendering (no orthoimage is packaged).',
    spec.rockAbundance > 0 ? `Rock hazard: Golombek–Rapp exponential form with k = ${spec.rockAbundance} (Mars-derived form applied to the Moon; value of order of the Diviner mean).` : 'Rock hazard statistic disabled.',
  ];
}
export function limitations(world: World) {
  return [
    ...world.manifest.missingData,
    'Slopes, pitch and roll are resolved at the 5 m DEM posting; sub-5 m roughness, rocks and small craters are not represented.',
    'Crater detections and terrain units are model outputs on DEM shape alone; they are not geologic interpretations and are unvalidated against labels.',
    'Shadows come from a 20 m horizon grid; near-field occlusion by features below 20 m is approximated by surface shading only.',
    'No reference (experimental) terramechanics validation is packaged; detailed fidelity is a model comparison, not a validation.',
  ];
}
