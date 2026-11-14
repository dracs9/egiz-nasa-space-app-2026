// EGIZ ASTRAL · tool implementations behind the copilot and command bar. Each tool reads the live studio state,
// calls the deterministic engines and reports what it measured, computed, assumed and could not determine.
import { localRelief, lineOfSight, pathLength, profile, sample, slopeDeg, type XY } from "../world/field";
import { cellAt, CLASSIFIER, CRATER_DETECTOR, ROCK_DETECTOR, TERRAIN_CLASSES, type Rock } from "../intelligence/perception";
import { hypothesesAt, REFERENCES, retrieve, scienceTargets } from "../intelligence/discovery";
import { isPoint, type PlaceRef, type Section, type ToolCall, type ToolResult } from "../intelligence/copilot";
import { BLOCK_LABEL, cellOf, pointOf, traversabilitySummary, type NavGrid, type Route } from "../sim/traverse";
import { SOILS, type RoverProfile } from "../sim/terramechanics";
import type { MissionResult, MissionSpec, Waypoint } from "../sim/mission";
import { solarAt } from "../../mission/solar";
import type { LayerId, SceneAnalysis, WorldSession } from "./session";
import type { CameraMode } from "../view/worldView";

export interface StudioHost {
  session: WorldSession; analysis: SceneAnalysis | null; selection: XY | null; roverAt: XY | null; spec: MissionSpec; result: MissionResult | null;
  rocks: Rock[]; rovers: Record<string, RoverProfile>; timeS: number;
  flyTo(p: XY, range?: number): void; setLayer(id: LayerId, slopeAbove?: number | null): void; setTime(s: number): void; setCamera(mode: CameraMode): void;
  select(p: XY): void; setSpec(spec: MissionSpec): void; setRovers(r: Record<string, RoverProfile>): void;
  navGrid(spec: MissionSpec, rovers?: Record<string, RoverProfile>, rocks?: Rock[]): NavGrid;
  runMission(spec: MissionSpec, options?: { rovers?: Record<string, RoverProfile>; rocks?: Rock[]; commit?: boolean; keepBaseline?: boolean }): MissionResult;
  detectRocks(centre: XY, radius: number): Promise<{ rocks: Rock[]; tiles: string[]; added: number }>;
  resetMission(): void; exportDossier(): Promise<{ file: string; sha256: string }>; openAnalogs(): void;
}
const fmt = (n: number | null | undefined, d = 1, unit = "") => (n === null || n === undefined || Number.isNaN(n) ? "not available" : `${n.toFixed(d)}${unit}`);
const dur = (s: number) => (s >= 3600 ? `${(s / 3600).toFixed(2)} h` : `${(s / 60).toFixed(0)} min`);
const sec = (kind: Section["kind"], text: string): Section => ({ kind, text });
const fail = (title: string, text: string): ToolResult => ({ ok: false, title, sections: [sec("limit", text)] });

/** Resolve a spoken place to site coordinates, or explain what is known. */
export function resolvePlace(ref: PlaceRef | undefined, h: StudioHost): XY | string | null {
  if (!ref) return null;
  if (isPoint(ref)) return ref;
  const name = ref.name.toLowerCase(), e = h.session.manifest.extent, half = (e.east - e.west) / 2;
  if (/^(selection|selected|here|this|it|current)?$/.test(name) || /select|cursor|here|\bthis\b/.test(name)) return h.selection ?? "Nothing is selected: click the terrain first.";
  if (/rover|vehicle/.test(name)) return h.roverAt ?? h.spec.start;
  if (/landing|octavia|origin|lander|touchdown/.test(name) && !/north|south|east|west/.test(name)) return { x: 0, y: 0 };
  if (/^(start|a|point a)$/.test(name)) return h.spec.start;
  if (/^(destination|goal|end|b|point b|target)$/.test(name)) return h.spec.destination;
  if (/crater/.test(name) && h.analysis?.craters.length) {
    const from = h.selection ?? { x: 0, y: 0 }, list = h.analysis.craters;
    const c = /larg|big/.test(name) ? [...list].sort((a, b) => b.radiusM - a.radiusM)[0] : /deep/.test(name) ? [...list].sort((a, b) => b.depthM - a.depthM)[0] : [...list].sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))[0];
    return { x: c.x + c.radiusM * 1.3, y: c.y };
  }
  let x = 0, y = 0, matched = false;
  if (/north/.test(name)) { y = 0.6 * half; matched = true; } if (/south/.test(name)) { y = -0.6 * half; matched = true; }
  if (/east/.test(name)) { x = 0.6 * half; matched = true; } if (/west/.test(name)) { x = -0.6 * half; matched = true; }
  if (/cent(er|re)|middle/.test(name)) matched = true;
  if (matched) return { x, y };
  return `I do not know a place called “${ref.name}”. Known places: landing site, selection, rover, start, destination, nearest/largest crater, compass areas (north-west …), or coordinates “x, y” in metres.`;
}
const nearestOpen = (g: NavGrid, p: XY): XY | null => {
  const i = cellOf(g, p);
  if (i < 0) return null;
  if (!g.blocked[i]) return pointOf(g, i);
  const c0 = i % g.side, r0 = Math.floor(i / g.side);
  for (let k = 1; k < 30; k++) for (let r = r0 - k; r <= r0 + k; r++) for (let c = c0 - k; c <= c0 + k; c++) if ((Math.abs(r - r0) === k || Math.abs(c - c0) === k) && r >= 0 && c >= 0 && r < g.side && c < g.side && !g.blocked[r * g.side + c]) return pointOf(g, r * g.side + c);
  return null;
};
const routeLine = (r: Route) => `${r.objective}: ${fmt(r.metrics.lengthM, 0, " m")}, drive ${dur(r.metrics.driveTimeS)}, ${fmt(r.metrics.driveEnergyWh, 0, " Wh")}, max slope ${fmt(r.metrics.maxSlopeDeg, 1, "°")}, mean slip ${(r.metrics.meanSlip * 100).toFixed(0)}%, risk exposure ${fmt(r.metrics.riskExposure, 0)}`;
function missionSections(result: MissionResult): Section[] {
  const m = result.metrics, out: Section[] = [];
  for (const alt of result.alternatives) out.push(sec("derived", alt.points ? `Route ${routeLine(alt)}.` : `Route ${alt.objective}: none — ${alt.reason}`));
  if (result.route) out.push(sec("derived", `Chosen route (${result.route.objective}): ${result.route.why}`));
  out.push(sec("derived", `Outcome: ${result.outcome}. ${result.explanation}`));
  if (result.frames.length) out.push(sec("derived", `Simulated ${fmt(m.distanceM, 0, " m")} in ${dur(m.durationS)} (${dur(m.driveTimeS)} driving, ${m.scienceStops} science stops). Energy used ${fmt(m.energyUsedWh, 0, " Wh")}, generated ${fmt(m.energyGeneratedWh, 0, " Wh")}; battery minimum ${fmt(m.minBatteryWh, 0, " Wh")} of ${result.rover.batteryWh} Wh. Peak wheel slip ${(m.maxSlip * 100).toFixed(0)}%, peak sinkage ${(m.maxSinkageM * 100).toFixed(1)} cm, peak tilt ${fmt(m.maxTiltDeg, 1, "°")}, ${dur(m.shadowTimeS)} in terrain shadow.`));
  const soil = result.spec.surface === "classified" ? "class-dependent surface profiles (bedrock on rough cells, weak drift on lineated cells, dry sand elsewhere)" : SOILS[result.spec.surface].name;
  out.push(sec("assumption", `Surface: ${soil}. ${result.spec.surface === "classified" ? "The class-to-soil mapping is an assumption." : SOILS[result.spec.surface].source}`));
  out.push(sec("assumption", `${result.rover.name}: ${result.rover.note}`));
  out.push(sec("limit", `${result.model.terramechanics}; ${result.model.fidelity} fidelity on ${result.model.terrainPostingM} m terrain. No dynamics, slip-sinkage or sub-post obstacles.`));
  return out;
}

export async function runTool(call: ToolCall, h: StudioHost): Promise<ToolResult> {
  const a = call.args, s = h.session, f = s.field, an = h.analysis;
  const at = (ref: unknown, fallback?: XY | null): XY | string => { const p = resolvePlace(ref as PlaceRef | undefined, h); return p ?? fallback ?? h.selection ?? "Select a point on the terrain first, or name a place."; };
  switch (call.tool) {
    case "fly_to": { const p = at(a.place); if (typeof p === "string") return fail("Place not found", p); if (sample(f, p) === null) return fail("Outside the site", "That location is outside the measured high-resolution site."); h.flyTo(p); h.select(p); return { ok: true, title: "Camera moved", sections: [sec("action", `Flying to (${p.x.toFixed(0)}, ${p.y.toFixed(0)}) m; elevation ${fmt(sample(f, p), 1, " m")}.`)] }; }
    case "set_camera": h.setCamera(a.mode as CameraMode); return { ok: true, title: "Camera mode", sections: [sec("action", `Camera set to ${a.mode}.`)] };
    case "show_layer": {
      const id = a.layer as LayerId;
      if (["classes", "units", "anomaly", "similar"].includes(id) && !an) return fail("Layer unavailable", "Scene analysis has not finished yet.");
      if (id === "similar" && !h.selection) return fail("Layer unavailable", "Select a reference point first.");
      if (id === "shadow-hours" && !s.solar) return fail("Layer unavailable", s.solarNote);
      h.setLayer(id, (a.slopeAbove as number | undefined) ?? null);
      if (id === "slope" && a.slopeAbove !== undefined) { let n = 0, total = 0; for (let r = 0; r < f.side; r += 2) for (let c = 0; c < f.side; c += 2) { const v = slopeDeg(f, { x: f.west + c * f.posting, y: f.north - r * f.posting }); if (v === null) continue; total++; if (v >= (a.slopeAbove as number)) n++; }
        return { ok: true, title: `Slopes above ${a.slopeAbove}°`, sections: [sec("derived", `${((n / total) * 100).toFixed(1)}% of the site (${((n / total) * (s.manifest.extent.east - s.manifest.extent.west) * (s.manifest.extent.north - s.manifest.extent.south) / 1e6).toFixed(2)} km²) is steeper than ${a.slopeAbove}° over a ${2 * f.posting} m baseline.`), sec("source", "Slope from the HiRISE stereo terrain model; see Evidence.")], evidence: ["src:dtm"] }; }
      return { ok: true, title: "Layer shown", sections: [sec("action", `Showing ${id === "none" ? "the orthoimage only" : id}.`)] };
    }
    case "set_time": {
      if (!s.solar) return fail("No illumination record", s.solarNote);
      const g = s.solar, noon = g.samples.find((x, i, all) => i > 0 && i < all.length - 1 && x.elevationDeg > 0 && x.elevationDeg >= all[i - 1].elevationDeg && x.elevationDeg > all[i + 1].elevationDeg) ?? g.samples.reduce((b, x) => (x.elevationDeg > b.elevationDeg ? x : b)), hour = s.manifest.site.body === "mars" ? 88775.244 / 24 : 3600;
      let t: number | undefined;
      if (a.moment === "noon") t = noon.t;
      else if (a.moment === "sunrise" || a.moment === "sunset") { for (let i = 1; i < g.samples.length; i++) { const p = g.samples[i - 1], q = g.samples[i]; if (a.moment === "sunrise" ? p.elevationDeg <= 0 && q.elevationDeg > 0 : p.elevationDeg > 0 && q.elevationDeg <= 0) { t = p.t + ((0 - p.elevationDeg) / (q.elevationDeg - p.elevationDeg)) * (q.t - p.t); break; } } if (t === undefined) return fail("Not in the record", `No ${a.moment} occurs within the ${g.duration / 3600} h SPICE record.`); }
      else if (a.localHour !== undefined) { t = noon.t + ((a.localHour as number) - 12) * hour; if (t < 0) t += 24 * hour; if (t > g.duration) t -= 24 * hour; if (t < 0 || t > g.duration) return fail("Not in the record", "That local time falls outside the recorded SPICE interval."); }
      else return fail("Time not understood", "Say noon, sunrise, sunset or a local hour (0–24).");
      h.setTime(t); const sun = solarAt(g, t);
      return { ok: true, title: "Scene time set", sections: [sec("derived", `T+${dur(t)} after ${g.epochUtc}: Sun elevation ${fmt(sun.elevationDeg, 1, "°")}, azimuth ${fmt(sun.azimuthDeg, 0, "°")}, top-of-atmosphere flux ${fmt(sun.solarFluxWm2, 0, " W/m²")}.`), sec("source", `${g.engine}. Local solar hours are approximated around the recorded solar noon.`)], evidence: ["ref:spice"] };
    }
    case "explain_area": {
      const p = at(a.place); if (typeof p === "string") return fail("No location", p); if (!an) return fail("Analysis pending", "Scene analysis has not finished yet.");
      const radius = (a.radius as number | undefined) ?? 80, g = an.features, counts = new Array(TERRAIN_CLASSES.length).fill(0), units = new Array(an.units.k).fill(0);
      let n = 0, slopeSum = 0, slopeMax = 0, roughSum = 0;
      for (let k = 0; k < g.side * g.side; k++) { const cx = g.west + ((k % g.side) + 0.5) * g.cellM, cy = g.north - (Math.floor(k / g.side) + 0.5) * g.cellM; if (Math.hypot(cx - p.x, cy - p.y) > radius || !an.classes[k]) continue; n++; counts[an.classes[k]]++; if (an.units.assignment[k] >= 0) units[an.units.assignment[k]]++; slopeSum += g.values[0][k]; slopeMax = Math.max(slopeMax, g.values[0][k]); roughSum += g.values[1][k]; }
      if (!n) return fail("No data", "No valid terrain cells within that radius.");
      const top = counts.map((c, i) => ({ c, i })).filter(x => x.c).sort((x, y) => y.c - x.c).slice(0, 4), craters = an.craters.filter(c => Math.hypot(c.x - p.x, c.y - p.y) <= radius + c.radiusM), outliers = an.outliers.filter(o => Math.hypot(o.x - p.x, o.y - p.y) <= radius).length, rocks = h.rocks.filter(r => Math.hypot(r.x - p.x, r.y - p.y) <= radius);
      h.select(p); h.setLayer("classes");
      return { ok: true, title: `Terrain within ${radius} m of (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`, evidence: ["src:dtm", "src:ortho", `model:${CLASSIFIER.id}`], sections: [
        sec("measured", `Elevation ${fmt(sample(f, p), 1, " m")} above the areoid; local relief ${fmt(localRelief(f, p, radius), 1, " m")} (HiRISE stereo terrain, ${f.posting} m posts).`),
        sec("derived", `Mean slope ${fmt(slopeSum / n, 1, "°")}, steepest 8 m cell ${fmt(slopeMax, 1, "°")}, mean 10 m relief RMS ${fmt(roughSum / n, 2, " m")}.`),
        sec("model", `Shape/texture classes (${CLASSIFIER.id}): ${top.map(x => `${TERRAIN_CLASSES[x.i].label.toLowerCase()} ${((x.c / n) * 100).toFixed(0)}%`).join(", ")}.`),
        sec("model", `${craters.length ? `${craters.length} crater candidate${craters.length > 1 ? "s" : ""} (${craters.slice(0, 3).map(c => `${(c.radiusM * 2).toFixed(0)} m wide, ${c.depthM.toFixed(1)} m deep`).join("; ")})` : "No crater candidates"}; ${outliers} descriptor-outlier cells; ${rocks.length ? `${rocks.length} rock candidates detected` : "rock detection not yet run here"}.`),
        sec("limit", "These classes describe shape and image texture. Lithology, mineralogy and geological unit names are not determined: no geological map or spectral data is in this world package."),
      ] };
    }
    case "find_hazards": {
      const p = at(a.place); if (typeof p === "string") return fail("No location", p);
      const radius = (a.radius as number | undefined) ?? 120, found = await h.detectRocks(p, radius), grid = h.navGrid(h.spec), rover = h.rovers[h.spec.roverId];
      const counts = new Array(BLOCK_LABEL.length).fill(0); let n = 0;
      for (let i = 0; i < grid.blocked.length; i++) { const q = pointOf(grid, i); if (Math.hypot(q.x - p.x, q.y - p.y) <= radius) { n++; counts[grid.blocked[i]]++; } }
      const hazards = found.rocks.filter(r => r.diameterM >= 2 * rover.maxObstacle), largest = found.rocks.reduce((b, r) => Math.max(b, r.diameterM), 0);
      h.select(p); h.setLayer("traversability");
      return { ok: true, title: `Hazards within ${radius} m`, evidence: ["src:dtm", "src:ortho", `model:${ROCK_DETECTOR.id}`, "ref:golombek2008"], sections: [
        sec("derived", `${((counts[0] / Math.max(1, n)) * 100).toFixed(0)}% of cells are enterable by the ${rover.name} at a ${grid.maxSlopeDeg}° limit. Blocked: slope ${((counts[1] / n) * 100).toFixed(1)}%, roughness ${((counts[4] / n) * 100).toFixed(1)}%, rock keep-outs ${((counts[2] / n) * 100).toFixed(1)}%.`),
        sec("model", `${found.rocks.length} rock candidates in ${found.tiles.length} image tiles at 0.25 m/px (largest ${fmt(largest, 1, " m")}); ${hazards.length} exceed the ${(2 * rover.maxObstacle).toFixed(1)} m diameter treated as non-climbable (height ≈ half diameter).`),
        sec("limit", ROCK_DETECTOR.note), sec("limit", "Slope and roughness come from 2 m terrain posts; steps and rocks smaller than the detection limit are invisible to this screen."),
      ] };
    }
    case "find_science_targets": {
      if (!an) return fail("Analysis pending", "Scene analysis has not finished yet.");
      const grid = h.navGrid(h.spec), targets = scienceTargets(an.features, an.units, an.craters, p => { const i = cellOf(grid, p); return i >= 0 && !grid.blocked[i]; }, (a.count as number | undefined) ?? 6);
      if (!targets.length) return fail("No targets", "No reachable candidate targets were found.");
      h.setLayer("units");
      return { ok: true, title: `${targets.length} candidate science targets`, evidence: targets.map(t => t.id), sections: [...targets.map((t, i) => sec("model", `${i + 1}. (${t.x.toFixed(0)}, ${t.y.toFixed(0)}) m — ${t.reason} Score ${t.score.toFixed(2)}.`)),
        sec("limit", "Ranking is a computational suggestion from shape and texture statistics. It contains no mineralogical or astrobiological evidence and has not been reviewed by a geologist.")] };
    }
    case "hypotheses": {
      const p = at(a.place); if (typeof p === "string") return fail("No location", p); if (!an) return fail("Analysis pending", "Scene analysis has not finished yet.");
      const list = hypothesesAt(an.features, an.classes, an.units, an.craters, p);
      if (!list.length) return { ok: true, title: "No hypothesis generated", sections: [sec("limit", "The descriptors at this location match none of the hypothesis templates (crater, aligned texture, blocky surface, outlier). That is not evidence that the location is uninteresting.")] };
      return { ok: true, title: `${list.length} computational hypothes${list.length > 1 ? "es" : "is"}`, evidence: list.flatMap(x => x.refs), sections: list.flatMap(x => [sec("measured", `Observation: ${x.observation}`), sec("model", `Hypothesis (unverified): ${x.interpretation} Alternative: ${x.alternative}`), sec("derived", `Supports: ${x.support.join(" ")} Against: ${x.counter.join(" ")}`), sec("action", `Test: ${x.prediction} Falsified if: ${x.falsification} Measurement needed: ${x.measurement}`)]) };
    }
    case "set_rover": {
      let rovers = h.rovers, spec = h.spec; const notes: string[] = [];
      if (a.rover) { spec = { ...spec, roverId: a.rover as string }; notes.push(`Rover: ${rovers[spec.roverId].name}.`); }
      if (a.surface) { if (a.surface === "classified" && !an) return fail("Unavailable", "Classified surface needs the scene analysis."); spec = { ...spec, surface: a.surface as string }; notes.push(`Surface assumption: ${a.surface}.`); }
      if (a.batteryScale) { const r = rovers[spec.roverId]; rovers = { ...rovers, [r.id]: { ...r, batteryWh: Math.round(r.batteryWh * (a.batteryScale as number)) } }; h.setRovers(rovers); notes.push(`Battery set to ${rovers[r.id].batteryWh} Wh (hypothetical change).`); }
      if (!notes.length) return fail("Nothing changed", "Name a rover (Mars 2020-class, Scout), a surface or a battery change.");
      h.setSpec(spec); return { ok: true, title: "Vehicle configuration", sections: notes.map(n => sec("action", n)) };
    }
    case "plan_mission": {
      const from = a.from ? resolvePlace(a.from as PlaceRef, h) : h.spec.start, to = a.to ? resolvePlace(a.to as PlaceRef, h) : (h.selection && Math.hypot(h.selection.x - h.spec.start.x, h.selection.y - h.spec.start.y) > 5 ? h.selection : h.spec.destination);
      if (typeof from === "string" || typeof to === "string") return fail("Place not found", (typeof from === "string" ? from : to) as string);
      if (!from || !to || Math.hypot(from.x - to.x, from.y - to.y) < 4) return fail("Destination needed", "I need a destination distinct from the start. Click the terrain to select one, or name a place (for example “to the largest crater”).");
      let spec: MissionSpec = { ...h.spec, start: from, destination: to, waypoints: [], maxSlopeDeg: (a.maxSlopeDeg as number | undefined) ?? h.spec.maxSlopeDeg, reserveFraction: a.reservePercent !== undefined ? (a.reservePercent as number) / 100 : h.spec.reserveFraction, objective: (a.objective as MissionSpec["objective"] | undefined) ?? h.spec.objective };
      const grid = h.navGrid(spec), start = nearestOpen(grid, from), end = nearestOpen(grid, to), notes: Section[] = [];
      if (!start || !end) return fail("Not traversable", "No enterable terrain near the start or destination under the current limits.");
      if (Math.hypot(start.x - from.x, start.y - from.y) > grid.posting) notes.push(sec("action", `Start moved ${Math.hypot(start.x - from.x, start.y - from.y).toFixed(0)} m to the nearest enterable cell.`));
      if (Math.hypot(end.x - to.x, end.y - to.y) > grid.posting) notes.push(sec("action", `Destination moved ${Math.hypot(end.x - to.x, end.y - to.y).toFixed(0)} m to the nearest enterable cell (${BLOCK_LABEL[grid.blocked[cellOf(grid, to)]]} at the requested point).`));
      spec = { ...spec, start, destination: end };
      const stops = (a.scienceStops as number | undefined) ?? 0;
      if (stops > 0) {
        if (!an) return fail("Analysis pending", "Science stops need the scene analysis.");
        const dx = end.x - start.x, dy = end.y - start.y, len2 = dx * dx + dy * dy, corridor = Math.max(120, 0.35 * Math.sqrt(len2));
        const along = (p: XY) => ((p.x - start.x) * dx + (p.y - start.y) * dy) / len2, off = (p: XY) => Math.abs((p.x - start.x) * dy - (p.y - start.y) * dx) / Math.sqrt(len2);
        const picked = scienceTargets(an.features, an.units, an.craters, p => { const i = cellOf(grid, p), k = along(p); return i >= 0 && !grid.blocked[i] && k > 0.08 && k < 0.92 && off(p) <= corridor; }, stops, Math.max(40, Math.sqrt(len2) / (stops + 2)));
        const waypoints: Waypoint[] = picked.sort((p, q) => along(p) - along(q)).map((t, i) => ({ ...pointOf(grid, cellOf(grid, t)), id: `wp${i + 1}`, label: `S${i + 1}`, activity: t.kind === "crater-rim" ? "imaging" as const : t.kind === "unit-contact" ? "sampling" as const : "observation" as const }));
        spec = { ...spec, waypoints };
        notes.push(sec("model", waypoints.length ? `Science stops chosen within ${corridor.toFixed(0)} m of the direct line: ${picked.map((t, i) => `S${i + 1} ${t.kind.replace("-", " ")}`).join(", ")} (computational suggestions).` : "No reachable science candidates lie near this corridor; the route has no science stops."));
      }
      h.setSpec(spec); const result = h.runMission(spec, { commit: true });
      return { ok: result.outcome !== "invalid" && result.outcome !== "no-route", title: `Mission ${result.outcome}`, evidence: ["src:dtm", "ref:bekker", "ref:janosi", "ref:m2020"], sections: [
        sec("action", `Validated specification: ${result.rover.name}, ${spec.objective} routing, slope limit ${spec.maxSlopeDeg}°, reserve ${(spec.reserveFraction * 100).toFixed(0)}%, ${spec.waypoints.length} science stops, departing T+${dur(spec.startTimeS)}.`), ...notes, ...missionSections(result)] };
    }
    case "run_simulation": { const spec = a.fidelity ? { ...h.spec, fidelity: a.fidelity as MissionSpec["fidelity"] } : h.spec; if (a.fidelity) h.setSpec(spec); const result = h.runMission(spec, { commit: true }); return { ok: result.outcome === "completed", title: `Simulation ${result.outcome}`, sections: missionSections(result), evidence: ["ref:bekker", "ref:janosi"] }; }
    case "what_if": {
      if (!h.result) return fail("No baseline", "Plan or run a mission first so there is something to compare against.");
      let rovers = h.rovers, spec = h.spec; const change: string[] = [];
      if (a.rover) { spec = { ...spec, roverId: a.rover as string }; change.push(`rover ${rovers[spec.roverId].name}`); }
      if (a.surface) { spec = { ...spec, surface: a.surface as string }; change.push(`surface ${a.surface}`); }
      if (a.batteryScale) { const r = rovers[spec.roverId]; rovers = { ...rovers, [r.id]: { ...r, batteryWh: Math.round(r.batteryWh * (a.batteryScale as number)) } }; change.push(`battery ${rovers[r.id].batteryWh} Wh (×${a.batteryScale})`); }
      if (!change.length) return fail("Change not understood", "Say what to change: energy budget (for example “20% smaller”), surface or rover.");
      const before = h.result, after = h.runMission(spec, { rovers, commit: true, keepBaseline: true }); h.setSpec(spec); h.setRovers(rovers);
      const d = (x: number, y: number, digits = 0, unit = "") => `${x.toFixed(digits)} → ${y.toFixed(digits)}${unit}`;
      return { ok: true, title: `What if: ${change.join(", ")}`, sections: [
        sec("derived", `Outcome: ${before.outcome} → ${after.outcome}. ${after.explanation}`),
        sec("derived", `Duration ${d(before.metrics.durationS / 3600, after.metrics.durationS / 3600, 2, " h")}; distance ${d(before.metrics.distanceM, after.metrics.distanceM, 0, " m")}; energy used ${d(before.metrics.energyUsedWh, after.metrics.energyUsedWh, 0, " Wh")}; battery minimum ${d(before.metrics.minBatteryWh, after.metrics.minBatteryWh, 0, " Wh")} against reserves ${d(before.rover.batteryWh * before.spec.reserveFraction, after.rover.batteryWh * after.spec.reserveFraction, 0, " Wh")}; peak slip ${d(before.metrics.maxSlip * 100, after.metrics.maxSlip * 100, 0, "%")}.`),
        sec("action", "The previous run is pinned as baseline A in the Compare panel."), sec("assumption", "The change is a hypothetical scenario; all other inputs are identical."),
      ] };
    }
    case "stress_test": {
      const base = h.result; if (!base || !base.route) return fail("Nothing to test", "Plan a mission first.");
      const out: Section[] = [], line = base.route.points, grid = h.navGrid(base.spec);
      let near = 0, worst = 0; for (const p of line) { const i = cellOf(grid, p), v = grid.slope[i]; worst = Math.max(worst, v); if (v > grid.maxSlopeDeg - 3) near++; }
      out.push(sec("derived", `Slope margin: steepest route cell ${fmt(worst, 1, "°")} against the ${grid.maxSlopeDeg}° limit; ${near} of ${line.length} route cells are within 3° of it. ${near ? "A terrain error of a few degrees would invalidate those cells." : "No cell is close to the limit."}`));
      const detailed = h.runMission({ ...base.spec, fidelity: "detailed" }, { commit: false });
      out.push(sec("derived", `Wheel-contact re-run (detailed fidelity): ${detailed.outcome}${detailed.outcome !== base.outcome ? " — this contradicts the baseline outcome." : ", consistent with the baseline"}; peak slip ${(detailed.metrics.maxSlip * 100).toFixed(0)}%, peak tilt ${fmt(detailed.metrics.maxTiltDeg, 1, "°")}.`));
      if (base.spec.surface !== "mars-drift") { const weak = h.runMission({ ...base.spec, surface: "mars-drift" }, { commit: false }); out.push(sec("derived", `Weaker surface (${SOILS["mars-drift"].name}): ${weak.outcome}${weak.outcome !== base.outcome ? " — the assessment depends on the soil assumption." : ""}; peak slip ${(weak.metrics.maxSlip * 100).toFixed(0)}%, energy ${fmt(weak.metrics.energyUsedWh, 0, " Wh")} versus ${fmt(base.metrics.energyUsedWh, 0, " Wh")}.`)); }
      const before = h.rocks.length; let added = 0;
      for (let i = 0; i < line.length; i += Math.max(1, Math.round(100 / grid.posting))) added += (await h.detectRocks(line[i], 70)).added;
      const again = h.runMission(base.spec, { commit: false });
      const changed = again.route ? Math.abs(again.route.metrics.lengthM - base.route.metrics.lengthM) > 2 * grid.posting : true;
      out.push(sec("model", `Rock check along the corridor: ${added} new candidates (${before + added} known). Re-planning with them ${again.outcome === "no-route" ? "finds no route — the baseline is contradicted" : changed ? `changes the route length to ${fmt(again.route!.metrics.lengthM, 0, " m")}` : "leaves the route unchanged"}.`));
      const reserve = base.rover.batteryWh * base.spec.reserveFraction; out.push(sec("derived", `Energy margin: battery minimum ${fmt(base.metrics.minBatteryWh, 0, " Wh")}, ${fmt(base.metrics.minBatteryWh - reserve, 0, " Wh")} above the reserve. Idle load and drive efficiency are assumptions that scale this directly.`));
      for (const q of an?.quality.filter(q => q.status === "warning" || q.status === "fail") ?? []) out.push(sec("limit", `Data quality — ${q.check}: ${q.detail}`));
      out.push(sec("limit", "Untested: rocks below about 1.5 m, soil strength at the site, wheel dynamics, thermal limits and communication windows."));
      return { ok: true, title: "Evidence against the current assessment", sections: out, evidence: ["src:dtm", "src:ortho", "ref:moore1987"] };
    }
    case "measure": {
      const p = resolvePlace(a.from as PlaceRef, h), q = resolvePlace(a.to as PlaceRef, h); if (!p || !q || typeof p === "string" || typeof q === "string") return fail("Place not found", String(typeof p === "string" ? p : q));
      const len = pathLength(f, [p, q]), pts = profile(f, [p, q]), zs = pts.map(x => x.elevation).filter((z): z is number => z !== null);
      if (!zs.length) return fail("Outside the site", "The line leaves the measured site.");
      return { ok: true, title: "Measurement", evidence: ["src:dtm"], sections: [sec("measured", `Plan distance ${fmt(len.plan, 1, " m")}, along-surface ${fmt(len.surface, 1, " m")}; elevation change ${fmt((sample(f, q) ?? NaN) - (sample(f, p) ?? NaN), 1, " m")}; lowest ${fmt(Math.min(...zs), 1)} m, highest ${fmt(Math.max(...zs), 1)} m; steepest sampled grade ${fmt(Math.max(...pts.map(x => Math.abs(x.gradeDeg ?? 0))), 1, "°")}.`), sec("derived", `Line of sight from 2 m above the first point: ${lineOfSight(f, p, q, 2)}.`), sec("limit", `Sampled every ${f.posting} m on the 2 m site field.`)] };
    }
    case "missing_data": {
      const out: Section[] = [
        sec("limit", "Geological units: no geologic map is loaded (Stack et al. 2020 exists but is not packaged), so no unit names or ages are shown."),
        sec("limit", "Composition: no spectral data (CRISM, rover instruments); lithology and mineralogy are undetermined."),
        sec("limit", "Soil mechanics: no measured bearing or shear parameters for this site; the simulator uses declared analog profiles."),
        sec("limit", "Rocks below about 1.5 m and all sub-metre relief: unresolved by the 0.25 m image and 1 m terrain model."),
        sec("limit", "Terrain error: the DTM has no per-pixel uncertainty layer, so slope errors are not propagated."),
        sec("limit", s.solar ? `Illumination: one ${s.solar.duration / 3600} h SPICE record starting ${s.solar.epochUtc}; no seasonal coverage, dust opacity or far-horizon shadowing from the crater rim.` : `Illumination: ${s.solarNote}`),
        sec("limit", "Thermal environment, communications geometry and rover thermal limits are not modelled here."),
      ];
      for (const q of an?.quality ?? []) if (q.status !== "ok") out.push(sec("derived", `${q.check}: ${q.detail}`));
      if (!h.rocks.length) out.push(sec("action", "Rock detection has not been run: ask for hazards around a point."));
      return { ok: true, title: "What this assessment lacks", sections: out, evidence: ["ref:stack2020"] };
    }
    case "evidence": {
      const topic = (a.topic as string | undefined) ?? "selection", m = s.manifest, out: Section[] = [];
      out.push(sec("source", `Terrain: ${m.sources.dtm.product}. ${m.sources.dtm.citation}. Window sha256 ${m.sources.dtm.window_sha256.slice(0, 12)}…; ${m.sources.dtm.vertical_datum}.`));
      if (m.sources.ortho) out.push(sec("source", `Imagery: ${m.sources.ortho.product}. ${m.sources.ortho.citation}. ${m.sources.ortho.kind}.`));
      if (topic === "mission" || topic === "method") for (const r of retrieve("sinkage slip traction rover power sun")) out.push(sec("source", `${r.title}: ${r.statement} — ${r.citation}`));
      if (topic === "mission" && h.result?.route) out.push(sec("derived", `The ${h.result.route.objective} route was selected because: ${h.result.route.why} Alternatives — ${h.result.alternatives.filter((r): r is Route => !!r.points).map(routeLine).join(" | ")}.`));
      if (topic === "terrain" || topic === "selection") { out.push(sec("model", `${CLASSIFIER.id}: ${CLASSIFIER.note}`)); out.push(sec("model", `${CRATER_DETECTOR.id}: ${CRATER_DETECTOR.note}`)); if (h.selection && an) { const k = cellAt(an.features, h.selection); if (k >= 0) out.push(sec("derived", `Selected 8 m cell: ${an.features.names.map((nm, i) => `${nm} ${fmt(an.features.values[i][k], 2)}`).join(", ")}; class rule “${TERRAIN_CLASSES[an.classes[k]].rule}”.`)); } }
      out.push(sec("limit", m.limitations.join(" ")));
      return { ok: true, title: "Evidence and provenance", sections: out, evidence: ["src:dtm", "src:ortho", ...REFERENCES.slice(0, 3).map(r => r.id)] };
    }
    case "open_analogs": h.openAnalogs(); return { ok: true, title: "Earth-analog comparison", sections: [sec("action", "Opened the existing EGIZ analog-fidelity workspace for this target."), sec("limit", "Analog ranking is computed by the existing deterministic engine on 200 m regional terrain, not by this studio. The ATLAS-Π transferability modules are not present in this branch.")] };
    case "generate_dossier": { const d = await h.exportDossier(); return { ok: true, title: "Mission dossier exported", sections: [sec("action", `Saved ${d.file} (content sha256 ${d.sha256.slice(0, 16)}…). It contains the specification, routes, telemetry summary, interpretation layers, tool log, sources and limitations.`)] }; }
    case "reset_mission": h.resetMission(); return { ok: true, title: "Mission cleared", sections: [sec("action", "Waypoints and the simulation record were cleared.")] };
    case "run": default: return fail("Unknown tool", `No tool named ${call.tool}.`);
  }
}
export { traversabilitySummary };
