// Typed, allowlisted copilot tools. Both the local intent parser and the optional LLM provider can only
// act through these functions; every argument is validated and every quantitative statement comes
// from a deterministic computation over the shared world model.
import type { MapPoint, SceneObject } from '../core/types';
import type { World } from '../core/world';
import { aeqdToLonLat } from '../core/coordinates';
import { lineOfSight, profile, roughnessAt, slopeAt } from '../analysis/terrain';
import { bodiesAt, earthVisibleFraction, epochPlus, nextLocalNoon, sunVisibleFraction } from '../analysis/illumination';
import { cloneMission, OBJECTIVE_LABEL, validateMission, type MissionSpec, type RouteObjective, type Validation } from '../sim/mission';
import type { Route } from '../sim/planner';
import type { SimResult } from '../sim/traverse';
import { REGOLITH } from '../sim/terramechanics';
import { ROVERS } from '../sim/rover';
import { parseMissionRequest } from './nlMission';
import { runQualityChecks } from './quality';
import { searchKnowledge } from './knowledge';
import type { OverlayMode } from '../render/worldView';
import type { AtlasBundle } from '../../atlas/types';

export type Selection = { kind: 'object'; id: string } | { kind: 'point'; x: number; y: number };
export type FactClass = 'measured' | 'derived' | 'model' | 'simulated' | 'assumed' | 'unknown' | 'retrieved' | 'hypothesis';
export interface Fact { label: string; value: string; cls: FactClass; note?: string }
export interface Citation { kind: 'object' | 'source' | 'model' | 'result' | 'knowledge' | 'atlas'; id: string; label: string; url?: string }
export interface ToolResult { ok: boolean; summary: string; facts: Fact[]; notes: string[]; citations: Citation[]; data?: unknown }
export interface PlanState { spec: MissionSpec; validation: Validation; routes: Route[]; sims: Record<string, SimResult>; checks: Record<string, { maxSlope5m: number; exceedM: number }> }
export type StudioAction =
  | { type: 'flyTo'; x: number; y: number; distance?: number }
  | { type: 'overlay'; mode: OverlayMode; slopeLimit?: number }
  | { type: 'select'; selection: Selection | null }
  | { type: 'highlight'; ids: string[]; label: string }
  | { type: 'time'; t: number }
  | { type: 'mission'; spec: MissionSpec }
  | { type: 'activeRoute'; id: string }
  | { type: 'play' }
  | { type: 'panel'; panel: 'explore' | 'intelligence' | 'mission' | 'simulate' | 'compare' | 'evidence' }
  | { type: 'download'; name: string; text: string; mime: string };

export interface ToolContext {
  world: World; selection: Selection | null; mission: MissionSpec; plan: PlanState | null; activeRouteId: string | null;
  time: number; viewTarget: MapPoint; atlas: AtlasBundle | null; slopeLimit: number;
  apply(a: StudioAction): void;
  planMission(spec: MissionSpec): Promise<PlanState>;
  simulateVariant(spec: MissionSpec, route: Route): SimResult;
  dossier(): Promise<{ markdown: string; json: Record<string, unknown> }>;
  fetchTileRaw?: (key: string) => Promise<ArrayBuffer>;
}

export interface JsonSchema { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean }
export interface ToolDef<A = Record<string, unknown>> { name: string; description: string; schema: JsonSchema; parse(raw: unknown): A; run(ctx: ToolContext, args: A): Promise<ToolResult> }

export class ToolArgumentError extends Error {}
const obj = (raw: unknown) => { if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ToolArgumentError('arguments must be an object'); return raw as Record<string, unknown>; };
const optNum = (o: Record<string, unknown>, k: string, lo: number, hi: number) => {
  if (o[k] === undefined || o[k] === null) return undefined;
  const v = Number(o[k]); if (!Number.isFinite(v) || v < lo || v > hi) throw new ToolArgumentError(`${k} must be a number in [${lo}, ${hi}]`); return v;
};
const optEnum = <T extends string>(o: Record<string, unknown>, k: string, values: readonly T[]) => {
  if (o[k] === undefined || o[k] === null) return undefined;
  if (!values.includes(o[k] as T)) throw new ToolArgumentError(`${k} must be one of ${values.join(', ')}`); return o[k] as T;
};
const optStr = (o: Record<string, unknown>, k: string, max = 600) => { if (o[k] === undefined || o[k] === null) return undefined; if (typeof o[k] !== 'string' || (o[k] as string).length > max) throw new ToolArgumentError(`${k} must be a string ≤ ${max} chars`); return o[k] as string; };
const ID = /^(crater-\d{4}|anomaly-\d{3}|target-site-centre|wp-\d+)$/;
const optId = (o: Record<string, unknown>, k: string) => { const s = optStr(o, k, 40); if (s !== undefined && !ID.test(s)) throw new ToolArgumentError(`${k} is not a valid world object id`); return s; };

const LABEL = (o: RouteObjective) => OBJECTIVE_LABEL[o];
const f1 = (v: number) => v.toFixed(1), f0 = (v: number) => v.toFixed(0), pct = (v: number) => `${(v * 100).toFixed(0)} %`;
const SRC: Citation = { kind: 'source', id: 'pgda-site20v2', label: 'PGDA LOLA 5 m Site20v2 (Barker et al. 2021)', url: 'https://pgda.gsfc.nasa.gov/products/78' };
const objCite = (o: SceneObject): Citation => ({ kind: 'object', id: o.id, label: `${o.id} (${o.evidenceClass})` });
const modelCite = (id: string): Citation => ({ kind: 'model', id, label: id });
const ok = (summary: string, facts: Fact[] = [], notes: string[] = [], citations: Citation[] = [], data?: unknown): ToolResult => ({ ok: true, summary, facts, notes, citations, data });
const fail = (summary: string, notes: string[] = []): ToolResult => ({ ok: false, summary, facts: [], notes, citations: [] });

function selectionPoint(ctx: ToolContext): (MapPoint & { label: string; object?: SceneObject }) | null {
  if (!ctx.selection) return null;
  if (ctx.selection.kind === 'point') return { x: ctx.selection.x, y: ctx.selection.y, label: `point (${f0(ctx.selection.x)}, ${f0(ctx.selection.y)}) m` };
  const o = ctx.world.object(ctx.selection.id) ?? ctx.mission.waypoints.map(w => ({ id: w.id, x: w.x, y: w.y } as SceneObject)).find(w => w.id === (ctx.selection as { id: string }).id);
  return o ? { x: o.x, y: o.y, label: o.id, object: ctx.world.object(o.id) ?? undefined } : null;
}

function regionBox(ctx: ToolContext, region: string) {
  const [w, s, e, n] = ctx.world.operationalBox, half = ctx.world.half;
  if (region === 'operational') return { west: w, south: s, east: e, north: n, label: 'the 5 m operational box' };
  if (region === 'site') return { west: -half, south: -half, east: half, north: half, label: 'the whole 15.4 km site' };
  const c = region === 'selection' ? selectionPoint(ctx) ?? ctx.viewTarget : ctx.viewTarget, r = region === 'selection' ? 600 : 1500;
  return { west: c.x - r, south: c.y - r, east: c.x + r, north: c.y + r, label: region === 'selection' ? `600 m around the selection` : 'the current view (±1.5 km of the view centre)' };
}

export function locationFacts(ctx: Pick<ToolContext, 'world' | 'time'>, p: MapPoint): { facts: Fact[]; notes: string[] } {
  const w = ctx.world, h = w.heightAt(p.x, p.y);
  if (h === null) return { facts: [{ label: 'Elevation', value: 'not loaded / outside the measured footprint', cls: 'unknown' }], notes: [] };
  const level = w.analysisLevel(p), posting = w.manifest.pyramid.postingsM[level];
  const ll = aeqdToLonLat(p.x, p.y, w.manifest.referenceFrame.originLonLat[0], w.manifest.referenceFrame.originLonLat[1], w.radius);
  const s = slopeAt(w, p.x, p.y), rough = roughnessAt(w, p.x, p.y, 30), unit = w.unitAt(p.x, p.y);
  const b = bodiesAt(w.illumination, ctx.time);
  const sun = sunVisibleFraction(w, p.x, p.y, h + 1, b.sun), earth = earthVisibleFraction(w, p.x, p.y, h + 2, b.earth);
  const inside = w.objects.filter(o => o.type === 'crater' && Math.hypot(o.x - p.x, o.y - p.y) <= o.radius);
  const facts: Fact[] = [
    { label: 'Elevation', value: `${f1(h)} m above the 1 737.4 km sphere`, cls: 'measured', note: `level ${level} posts, ${posting} m posting (bilinear)` },
    { label: 'Coordinates', value: `${ll.lat.toFixed(5)}°, ${ll.lon.toFixed(5)}° (MOON_ME) · map (${f0(p.x)}, ${f0(p.y)}) m`, cls: 'derived' },
    { label: 'Slope', value: s ? `${f1(s.slopeDeg)}° toward ${f0(s.aspectDeg)}° (downslope azimuth)` : 'n/a', cls: 'derived', note: `central differences, ${s?.baselineM ?? posting} m baseline` },
    { label: 'Roughness', value: rough !== null ? `${rough.toFixed(2)} m RMS from best-fit plane over 30 m` : 'n/a', cls: 'derived' },
    { label: 'Terrain unit', value: unit ? `${unit.label}: ${unit.descriptor}` : 'none', cls: 'model', note: 'unsupervised k-means geomorphometric class; not a geologic unit' },
    { label: 'Crater context', value: inside.length ? `inside ${inside.map(o => `${o.id} (D ≈ ${Math.round(Number(o.properties.diameter_m))} m, score ${o.confidence})`).join(', ')}` : 'not inside a detected crater', cls: 'model' },
    { label: 'Sun now', value: `${pct(sun)} of the solar disk visible (Sun elevation ${f1(b.sunElevationDeg)}°, azimuth ${f0(b.sunAzimuthDeg)}°)`, cls: 'simulated', note: 'SPICE + terrain ray march on the 20 m horizon grid' },
    { label: 'Earth line of sight', value: `${pct(earth)} of Earth’s disk above the local horizon (Earth elevation ${f1(b.earthElevationDeg)}°)`, cls: 'simulated' },
    { label: 'Geologic unit / composition', value: 'not available — no geologic, spectral or compositional map is packaged', cls: 'unknown' },
  ];
  const notes = posting > 5 ? [`Outside the operational box the analysis posting is ${posting} m; slopes are smoothed accordingly.`] : [];
  return { facts, notes };
}

function hypothesisFor(o: SceneObject) {
  if (o.type === 'crater') {
    const dD = Number(o.properties.depth_to_diameter), D = Number(o.properties.diameter_m);
    return {
      observation: `Circular depression D ≈ ${f0(D)} m, depth ≈ ${f1(Number(o.properties.depth_m))} m (d/D ${dD.toFixed(3)}), rim closure ${pct(Number(o.properties.rim_completeness))}.`,
      interpretation: dD > 0.1 ? 'A relatively fresh simple impact crater (higher d/D).' : 'A degraded or infilled simple impact crater (low d/D).',
      support: ['Radial profile rises to a rim around most azimuths.', `d/D is within the range of lunar simple craters (fresh ≈ 0.2; Pike 1977).`],
      counter: ['The 5 m DEM smooths small craters, lowering d/D artificially.', 'No imagery confirms a raised rim or ejecta.'],
      alternative: 'A non-impact depression (e.g., drainage pit or a gap between hummocks) of similar shape.',
      prediction: 'Higher-resolution imagery (LROC NAC) would show a raised rim, ejecta blanket and possibly boulders on the rim if fresh.',
      falsification: 'NAC imagery or a higher-resolution DTM shows no rim or a non-circular planform.',
      measurement: 'LROC NAC image and NAC stereo DTM at ≤ 2 m posting over the feature.',
    };
  }
  const drivers = (o.properties.drivers as { feature: string; zScore: number }[] | undefined) ?? [];
  return {
    observation: `Region of ~${f0(Number(o.properties.area_m2) / 1e4)} ha whose terrain features are statistically unusual for this site (mean Mahalanobis ${o.properties.meanMahalanobis}); drivers: ${drivers.map(d => `${d.feature} z=${d.zScore}`).join(', ')}.`,
    interpretation: 'A geomorphic structure differing from the surrounding plateau (e.g., a steep scarp, a fresh crater cluster or a rough block field).',
    support: ['The outlier score is computed over the same measured DEM as all other layers.'],
    counter: ['Outliers include DEM interpolation artefacts at track gaps.', 'Gaussian outlier scoring over-flags heavy-tailed slopes.'],
    alternative: 'An artefact of LOLA track interpolation or simply the steepest part of a common slope.',
    prediction: 'If real, the anomaly persists in independent elevation data and shows a distinct appearance in imagery.',
    falsification: 'An independent DTM or imagery shows ordinary terrain at the location.',
    measurement: 'Independent LROC NAC DTM; LROC NAC imagery; Diviner rock abundance at the location.',
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TOOLS: ToolDef<any>[] = [
  {
    name: 'describe_location', description: 'Measured and derived properties of a map point (elevation, slope, roughness, unit, crater context, illumination). Coordinates are local map metres east (x) / north (y) of the site centre; omit to use the current selection.',
    schema: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, additionalProperties: false },
    parse: raw => { const o = obj(raw); return { x: optNum(o, 'x', -8000, 8000), y: optNum(o, 'y', -8000, 8000) }; },
    async run(ctx, a) {
      const p = a.x !== undefined && a.y !== undefined ? { x: a.x, y: a.y, label: 'requested point' } : selectionPoint(ctx);
      if (!p) return fail('Nothing is selected. Click the terrain or name coordinates.');
      const { facts, notes } = locationFacts(ctx, p);
      return ok(`Inspection of ${p.label}.`, facts, notes, [SRC, modelCite('egiz.units.kmeans-geomorph')]);
    },
  },
  {
    name: 'describe_object', description: 'Properties, provenance and confidence of a world object (crater-NNNN, anomaly-NNN).',
    schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    parse: raw => { const o = obj(raw); const id = optId(o, 'id'); if (!id) throw new ToolArgumentError('id is required'); return { id }; },
    async run(ctx, a) {
      const o = ctx.world.object(a.id);
      if (!o) return fail(`No object ${a.id} exists in this world.`);
      const props = Object.entries(o.properties).filter(([k]) => k !== 'drivers' && k !== 'name').map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: String(v), cls: 'model' as FactClass }));
      const loc = locationFacts(ctx, o);
      return ok(`${o.id}: ${o.type} (${o.evidenceClass}).`, [
        { label: 'Evidence class', value: o.evidenceClass, cls: o.evidenceClass === 'model-detected' ? 'model' : o.evidenceClass === 'computational-hypothesis' ? 'hypothesis' : 'derived' },
        { label: 'Confidence', value: o.confidence === null ? 'none (statistical candidate)' : `${o.confidence} heuristic score — not a probability`, cls: 'model' },
        ...props, ...loc.facts.slice(0, 4)], [`Produced by ${o.provenance.modelId} from ${o.provenance.input}.`], [objCite(o), modelCite(o.provenance.modelId ?? ''), SRC]);
    },
  },
  {
    name: 'find_features', description: 'Find detected craters, anomaly candidates, terrain hazards, terrain units, or the most investigation-worthy structures in a region. Boulders are not resolvable and are reported as such.',
    schema: { type: 'object', properties: { kind: { enum: ['craters', 'anomalies', 'hazards', 'units', 'interesting', 'boulders'] }, region: { enum: ['view', 'operational', 'selection', 'site'] }, minConfidence: { type: 'number' }, slopeAboveDeg: { type: 'number' } }, required: ['kind'], additionalProperties: false },
    parse: raw => { const o = obj(raw); const kind = optEnum(o, 'kind', ['craters', 'anomalies', 'hazards', 'units', 'interesting', 'boulders'] as const); if (!kind) throw new ToolArgumentError('kind is required'); return { kind, region: optEnum(o, 'region', ['view', 'operational', 'selection', 'site'] as const) ?? 'view', minConfidence: optNum(o, 'minConfidence', 0, 1) ?? 0, slopeAboveDeg: optNum(o, 'slopeAboveDeg', 1, 45) }; },
    async run(ctx, a) {
      const w = ctx.world, box = regionBox(ctx, a.region);
      const inBox = (o: { x: number; y: number }) => o.x >= box.west && o.x <= box.east && o.y >= box.south && o.y <= box.north;
      if (a.kind === 'boulders') {
        const k = ctx.mission.rockAbundance;
        return ok('Boulders cannot be detected here.', [
          { label: 'Detection', value: 'not possible — individual boulders (< 5 m) are below the 5 m DEM posting and no orthoimage is packaged', cls: 'unknown' },
          { label: 'Statistical estimate', value: k > 0 ? `assumed rock abundance k = ${k} (Golombek–Rapp form) → used as an expected-encounter statistic in simulations` : 'disabled', cls: 'assumed' }],
          ['Visualization mode can draw illustrative rocks from the same assumed distribution; they are never used by analysis.', 'LROC NAC imagery (0.5–1.5 m/px) would be required for boulder detection.'],
          [{ kind: 'knowledge', id: 'bandfield2011', label: 'Bandfield et al. 2011' }, { kind: 'knowledge', id: 'golombek1997', label: 'Golombek & Rapp 1997' }]);
      }
      if (a.kind === 'craters' || a.kind === 'anomalies') {
        const type = a.kind === 'craters' ? 'crater' : 'anomaly';
        const list = w.objects.filter(o => o.type === type && inBox(o) && (o.confidence ?? 1) >= a.minConfidence).sort((p, q) => (q.confidence ?? 0) - (p.confidence ?? 0) || q.radius - p.radius);
        ctx.apply({ type: 'highlight', ids: list.map(o => o.id), label: `${list.length} ${a.kind} in ${box.label}` });
        return ok(`${list.length} ${a.kind} in ${box.label}.`, list.slice(0, 8).map(o => ({ label: o.id, value: type === 'crater' ? `D ≈ ${Math.round(Number(o.properties.diameter_m))} m, depth ${o.properties.depth_m} m, score ${o.confidence}` : `${Math.round(Number(o.properties.area_m2) / 1e4 * 10) / 10} ha, Mahalanobis ${o.properties.meanMahalanobis}`, cls: type === 'crater' ? 'model' : 'hypothesis' as FactClass })),
          [type === 'crater' ? 'Classical DEM detector (LoG + rim fit); scores are heuristic, recall below ~45 m diameter is poor.' : 'Statistical outliers — unverified computational hypotheses, not discoveries.'], [modelCite(type === 'crater' ? 'egiz.craters.dem-log' : 'egiz.anomaly.mahalanobis'), SRC], { ids: list.map(o => o.id) });
      }
      // Lattice statistics (hazards / units / interesting) on the analysis model.
      const limit = a.slopeAboveDeg ?? ctx.slopeLimit;
      const step = Math.max(20, Math.round((box.east - box.west) / 120));
      const b = bodiesAt(w.illumination, ctx.time);
      let n = 0, steep = 0, shadow = 0, crater = 0, maxSlope = 0;
      const units = new Map<number, number>();
      for (let x = box.west; x <= box.east; x += step) for (let y = box.south; y <= box.north; y += step) {
        const s = slopeAt(w, x, y); const h = w.heightAt(x, y);
        if (!s || h === null) continue;
        n++; maxSlope = Math.max(maxSlope, s.slopeDeg);
        if (s.slopeDeg > limit) steep++;
        if (a.kind === 'hazards' && (x / step + y / step) % 3 === 0 && sunVisibleFraction(w, x, y, h + 1, b.sun) < 0.5) shadow += 3;
        if (w.objects.some(o => o.type === 'crater' && (o.confidence ?? 0) >= 0.5 && Math.hypot(o.x - x, o.y - y) < o.radius * 0.8)) crater++;
        const u = w.unitAt(x, y); if (u) units.set(u.id, (units.get(u.id) ?? 0) + 1);
      }
      if (!n) return fail(`No analysis heights are loaded for ${box.label}. Move the view onto the site or load the operational box.`);
      if (a.kind === 'hazards') {
        ctx.apply({ type: 'overlay', mode: 'hazard', slopeLimit: limit });
        return ok(`Hazard screen of ${box.label} (${n} samples at ${step} m).`, [
          { label: `Slopes > ${limit}°`, value: `${pct(steep / n)} of the area (max ${f1(maxSlope)}°)`, cls: 'derived' },
          { label: 'Detected crater interiors', value: `${pct(crater / n)} of the area`, cls: 'model' },
          { label: 'In shadow now', value: `${pct(Math.min(1, shadow / n))} of the area (Sun elevation ${f1(b.sunElevationDeg)}°)`, cls: 'simulated' },
          { label: 'Boulders / small rocks', value: 'not resolved (statistical only)', cls: 'unknown' }],
          ['Overlay: red = slope above the limit, blue = shadowed now.', 'Slopes use the analysis posting (5 m inside the operational box, 20 m outside).'], [SRC, modelCite('egiz.craters.dem-log')]);
      }
      const classes = w.perception.units.classes;
      if (a.kind === 'units') {
        ctx.apply({ type: 'overlay', mode: 'units' });
        return ok(`Terrain-unit composition of ${box.label}.`, [...units.entries()].sort((p, q) => q[1] - p[1]).map(([id, c]) => ({ label: classes[id].label, value: `${pct(c / n)} — ${classes[id].descriptor}`, cls: 'model' as FactClass })),
          ['Unsupervised geomorphometric clusters (slope, roughness, TPI, curvature). Not geologic units.'], [modelCite('egiz.units.kmeans-geomorph')]);
      }
      // interesting: rank structures worth investigation, clearly labelled.
      const craters = w.objects.filter(o => o.type === 'crater' && inBox(o)).map(o => ({ o, score: (o.confidence ?? 0) * Math.min(1, Number(o.properties.depth_to_diameter) / 0.12) }));
      const anomalies = w.objects.filter(o => o.type === 'anomaly' && inBox(o)).map(o => ({ o, score: Math.min(1, Number(o.properties.meanMahalanobis) / 12) }));
      const rare = [...units.entries()].map(([id, c]) => ({ id, frac: c / n })).filter(u => u.frac > 0 && classes[u.id].areaFraction < 0.05);
      const ranked = [...craters, ...anomalies].sort((p, q) => q.score - p.score).slice(0, 6);
      ctx.apply({ type: 'highlight', ids: ranked.map(r => r.o.id), label: 'Investigation candidates' });
      ctx.apply({ type: 'overlay', mode: 'hazard', slopeLimit: limit });
      return ok(`Investigation candidates in ${box.label}, and rover hazards.`, [
        ...ranked.map(r => ({ label: r.o.id, value: r.o.type === 'crater' ? `fresh-looking crater candidate: D ≈ ${Math.round(Number(r.o.properties.diameter_m))} m, d/D ${r.o.properties.depth_to_diameter} (score ${r.o.confidence})` : `geomorphometric outlier, drivers ${(r.o.properties.drivers as { feature: string }[]).map(d => d.feature).join(', ')}`, cls: (r.o.type === 'crater' ? 'model' : 'hypothesis') as FactClass })),
        ...rare.map(u => ({ label: `Rare unit ${classes[u.id].label}`, value: `${classes[u.id].descriptor} (${pct(classes[u.id].areaFraction)} of site)`, cls: 'model' as FactClass })),
        { label: `Hazard: slopes > ${limit}°`, value: `${pct(steep / n)} of ${box.label}`, cls: 'derived' },
        { label: 'Hazard: crater interiors', value: `${pct(crater / n)} of ${box.label}`, cls: 'model' }],
        ['Ranking = model score × depth-to-diameter (craters) or outlier strength (anomalies). It is a computational prioritisation, not a geological judgement.', 'Imagery and spectra would be needed to interpret composition; none is packaged.'],
        [modelCite('egiz.craters.dem-log'), modelCite('egiz.anomaly.mahalanobis'), modelCite('egiz.units.kmeans-geomorph'), SRC], { ids: ranked.map(r => r.o.id) });
    },
  },
  {
    name: 'set_view', description: 'Change the 3D view: overlay layer, slope limit, and/or fly to the site centre, a world object, the mission start/destination or map coordinates.',
    schema: { type: 'object', properties: { overlay: { enum: ['none', 'slope', 'units', 'hazard', 'traversability', 'illumination'] }, slopeLimitDeg: { type: 'number' }, target: { type: 'string', description: "'site', 'start', 'destination', 'selection' or an object id" }, x: { type: 'number' }, y: { type: 'number' }, distanceM: { type: 'number' } }, additionalProperties: false },
    parse: raw => { const o = obj(raw); const target = optStr(o, 'target', 40); if (target && !['site', 'start', 'destination', 'selection'].includes(target) && !ID.test(target)) throw new ToolArgumentError('unknown target'); return { overlay: optEnum(o, 'overlay', ['none', 'slope', 'units', 'hazard', 'traversability', 'illumination'] as const), slopeLimitDeg: optNum(o, 'slopeLimitDeg', 1, 45), target, x: optNum(o, 'x', -8000, 8000), y: optNum(o, 'y', -8000, 8000), distanceM: optNum(o, 'distanceM', 20, 40000) }; },
    async run(ctx, a) {
      const done: string[] = [];
      if (a.overlay) { ctx.apply({ type: 'overlay', mode: a.overlay, slopeLimit: a.slopeLimitDeg }); done.push(`overlay ${a.overlay}${a.slopeLimitDeg ? ` (limit ${a.slopeLimitDeg}°)` : ''}`); }
      let p: MapPoint | null = null;
      if (a.x !== undefined && a.y !== undefined) p = { x: a.x, y: a.y };
      else if (a.target === 'site') p = { x: 0, y: 0 };
      else if (a.target === 'start') p = ctx.mission.start;
      else if (a.target === 'destination') p = ctx.mission.destination ?? ctx.mission.start;
      else if (a.target === 'selection') p = selectionPoint(ctx);
      else if (a.target) { const o = ctx.world.object(a.target); if (!o) return fail(`Unknown object ${a.target}.`); p = o; ctx.apply({ type: 'select', selection: { kind: 'object', id: o.id } }); }
      if (p) { ctx.apply({ type: 'flyTo', x: p.x, y: p.y, distance: a.distanceM ?? (a.target && ID.test(a.target) ? Math.max(150, (ctx.world.object(a.target)?.radius ?? 50) * 4) : 2500) }); done.push(`camera to (${f0(p.x)}, ${f0(p.y)}) m`); }
      return done.length ? ok(`View updated: ${done.join('; ')}.`) : fail('No view change was requested.');
    },
  },
  {
    name: 'terrain_profile', description: 'Elevation profile and grades between two map points (default: mission start → destination).',
    schema: { type: 'object', properties: { x0: { type: 'number' }, y0: { type: 'number' }, x1: { type: 'number' }, y1: { type: 'number' } }, additionalProperties: false },
    parse: raw => { const o = obj(raw); return { x0: optNum(o, 'x0', -8000, 8000), y0: optNum(o, 'y0', -8000, 8000), x1: optNum(o, 'x1', -8000, 8000), y1: optNum(o, 'y1', -8000, 8000) }; },
    async run(ctx, a) {
      const from = a.x0 !== undefined && a.y0 !== undefined ? { x: a.x0, y: a.y0 } : ctx.mission.start;
      const to = a.x1 !== undefined && a.y1 !== undefined ? { x: a.x1, y: a.y1 } : ctx.mission.destination ?? selectionPoint(ctx);
      if (!to) return fail('No end point: select a location or set a destination.');
      const pr = profile(ctx.world, [from, to]);
      if (pr.points.length < 2) return fail('Analysis heights are not loaded along this line.');
      const los = lineOfSight(ctx.world, from, to, 2, 2);
      return ok(`Straight-line profile over ${f0(pr.length)} m.`, [
        { label: 'Length', value: `${f0(pr.length)} m`, cls: 'derived' }, { label: 'Ascent / descent', value: `${f0(pr.ascent)} m / ${f0(pr.descent)} m`, cls: 'derived' },
        { label: 'Max grade along the line', value: `${f1(pr.maxGradeDeg)}°`, cls: 'derived' }, { label: 'Max surface slope', value: `${f1(pr.maxSlopeDeg)}°`, cls: 'derived' },
        { label: 'Line of sight (2 m masts)', value: los ? (los.visible ? 'clear' : `blocked at ${f0(los.blockedAtM ?? 0)} m`) : 'n/a', cls: 'derived' }],
        [`Sampled every ${pr.postingM} m on the analysis surface.`], [SRC], pr);
    },
  },
  {
    name: 'propose_mission', description: 'Convert a natural-language mission request into a validated mission specification (start, destination, science stops, constraints, objective, rover, soil). Does not plan routes.',
    schema: { type: 'object', properties: { request: { type: 'string' } }, required: ['request'], additionalProperties: false },
    parse: raw => { const o = obj(raw); const request = optStr(o, 'request', 600); if (!request) throw new ToolArgumentError('request is required'); return { request }; },
    async run(ctx, a) {
      await ctx.world.ensureOperational();
      const sel = selectionPoint(ctx);
      const parsed = parseMissionRequest(a.request, ctx.mission, ctx.world, { selection: sel, selectionLabel: sel?.label });
      const v = validateMission(parsed.spec, ctx.world);
      if (!v.ok) return { ...fail('The request produced an invalid mission specification.', v.errors), data: parsed };
      ctx.apply({ type: 'mission', spec: parsed.spec });
      return ok(`Mission specification created (${parsed.recognised.length} clauses understood).`, [
        ...parsed.recognised.map(r => ({ label: 'Understood', value: r, cls: 'derived' as FactClass })),
        ...parsed.spec.waypoints.map(w => ({ label: w.label, value: w.rationale ?? '', cls: 'model' as FactClass })),
        { label: 'Constraints', value: `slope ≤ ${parsed.spec.constraints.maxSlopeDeg}°, cross-slope ≤ ${parsed.spec.constraints.maxCrossSlopeDeg}°, reserve ≥ ${pct(parsed.spec.constraints.minReserveFrac)}`, cls: 'derived' }],
        [...parsed.ignored.map(s => `Not understood (ignored): “${s}”`), ...v.warnings], [], parsed);
    },
  },
  {
    name: 'plan_routes', description: 'Plan shortest, lowest-risk, lowest-energy and best-illumination routes for the current mission and simulate each on the shared terrain.',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    parse: () => ({}),
    async run(ctx) {
      const plan = await ctx.planMission(ctx.mission);
      if (!plan.validation.ok) return fail('Mission specification is invalid.', plan.validation.errors);
      const facts: Fact[] = plan.routes.map(r => {
        const s = plan.sims[r.id]?.summary, c = plan.checks[r.id];
        return { label: LABEL(r.objective), value: r.feasible ? `${(r.lengthM / 1000).toFixed(2)} km, ${s ? `${(s.durationS / 3600).toFixed(1)} h, ${s.energyUsedWh} Wh used, min SoC ${pct(s.minSocFrac)}, max slip ${pct(s.maxSlip)}, ${s.status}` : 'not simulated'}${c && c.exceedM > 0 ? `; ${f0(c.exceedM)} m above the slope limit at 5 m` : ''}` : `infeasible — ${r.reason}`, cls: 'simulated' };
      });
      return ok(`Planned ${plan.routes.filter(r => r.feasible).length}/${plan.routes.length} feasible routes and simulated them.`, facts, ['Routes are computed by A* on a 10 m lattice of the analysis surface, then re-checked at 5 m and simulated with terramechanics, SPICE illumination and battery integration.'], [SRC, { kind: 'result', id: 'plan', label: 'Route plan (this session)' }]);
    },
  },
  {
    name: 'run_simulation', description: 'Select a planned route and start the playback of its simulation.',
    schema: { type: 'object', properties: { objective: { enum: ['shortest', 'safest', 'energy', 'illumination'] } }, additionalProperties: false },
    parse: raw => ({ objective: optEnum(obj(raw ?? {}), 'objective', ['shortest', 'safest', 'energy', 'illumination'] as const) }),
    async run(ctx, a) {
      let plan = ctx.plan;
      if (!plan) plan = await ctx.planMission(ctx.mission);
      const route = plan.routes.find(r => r.feasible && r.objective === (a.objective ?? plan!.spec.preferred)) ?? plan.routes.find(r => r.feasible);
      if (!route) return fail('No feasible route to simulate.', plan.routes.map(r => `${r.objective}: ${r.reason}`));
      ctx.apply({ type: 'activeRoute', id: route.id }); ctx.apply({ type: 'play' }); ctx.apply({ type: 'panel', panel: 'simulate' });
      const s = plan.sims[route.id].summary;
      return ok(`Playing the ${LABEL(route.objective).toLowerCase()} route.`, [
        { label: 'Outcome', value: s.status === 'completed' ? 'completed' : `failed — ${s.failure}`, cls: 'simulated' }, { label: 'Duration', value: `${(s.durationS / 3600).toFixed(2)} h`, cls: 'simulated' },
        { label: 'Energy', value: `${s.energyUsedWh} Wh used, ${s.energyGeneratedWh} Wh generated`, cls: 'simulated' }], [], [{ kind: 'result', id: route.id, label: `Simulation ${route.id}` }]);
    },
  },
  {
    name: 'set_time', description: 'Set the scene/mission time: next local noon (highest Sun), or hours after the SPICE record epoch.',
    schema: { type: 'object', properties: { mode: { enum: ['local_noon', 'hours_from_epoch', 'hours_from_now'] }, hours: { type: 'number' } }, required: ['mode'], additionalProperties: false },
    parse: raw => { const o = obj(raw); const mode = optEnum(o, 'mode', ['local_noon', 'hours_from_epoch', 'hours_from_now'] as const); if (!mode) throw new ToolArgumentError('mode is required'); return { mode, hours: optNum(o, 'hours', -720, 720) }; },
    async run(ctx, a) {
      const rec = ctx.world.illumination;
      const t = a.mode === 'local_noon' ? nextLocalNoon(rec, Math.max(0, ctx.time - 12 * 3600), 30 * 86400) : a.mode === 'hours_from_epoch' ? (a.hours ?? 0) * 3600 : ctx.time + (a.hours ?? 0) * 3600;
      if (t < 0 || t > rec.duration) return fail(`That time is outside the 30-day SPICE record (${rec.epochUtc} + ${rec.duration / 86400} days).`);
      ctx.apply({ type: 'time', t });
      const b = bodiesAt(rec, t);
      return ok(`Time set to ${epochPlus(rec, t).toISOString().slice(0, 16)}Z.`, [{ label: 'Sun', value: `elevation ${f1(b.sunElevationDeg)}°, azimuth ${f0(b.sunAzimuthDeg)}°`, cls: 'simulated' }, { label: 'Earth', value: `elevation ${f1(b.earthElevationDeg)}°`, cls: 'simulated' }], a.mode === 'local_noon' ? ['“Local noon” = time of maximum Sun elevation at the site centre in the record (south polar site: Sun due north).'] : [], [{ kind: 'model', id: 'spice', label: rec.engine }]);
    },
  },
  {
    name: 'what_if', description: 'Re-simulate the active route with one changed parameter (battery, mass, speed, soil, rover, fidelity) and report the differences.',
    schema: { type: 'object', properties: { parameter: { enum: ['battery', 'mass', 'speed', 'soil', 'rover', 'fidelity', 'departure'] }, factor: { type: 'number' }, value: { type: 'string' } }, required: ['parameter'], additionalProperties: false },
    parse: raw => { const o = obj(raw); const parameter = optEnum(o, 'parameter', ['battery', 'mass', 'speed', 'soil', 'rover', 'fidelity', 'departure'] as const); if (!parameter) throw new ToolArgumentError('parameter is required'); return { parameter, factor: optNum(o, 'factor', 0.05, 20), value: optStr(o, 'value', 40) }; },
    async run(ctx, a) {
      const plan = ctx.plan;
      const route = plan?.routes.find(r => r.id === ctx.activeRouteId && r.feasible) ?? plan?.routes.find(r => r.feasible);
      if (!plan || !route) return fail('Plan routes first; a what-if needs a simulated baseline route.');
      const base = plan.sims[route.id], rover = base.rover, v = cloneMission(plan.spec), fct = a.factor ?? 0.5;
      let change = '';
      if (a.parameter === 'battery') { v.roverOverrides.batteryWh = Math.round(rover.batteryWh * fct); change = `battery ${rover.batteryWh} → ${v.roverOverrides.batteryWh} Wh`; }
      if (a.parameter === 'mass') { v.roverOverrides.massKg = Math.round(rover.massKg * fct); change = `mass ${rover.massKg} → ${v.roverOverrides.massKg} kg`; }
      if (a.parameter === 'speed') { v.roverOverrides.maxSpeedMs = +(rover.maxSpeedMs * fct).toFixed(3); change = `speed ${rover.maxSpeedMs} → ${v.roverOverrides.maxSpeedMs} m/s`; }
      if (a.parameter === 'soil') { v.soilId = REGOLITH.some(s => s.id === a.value) ? a.value! : v.soilId === 'lunar-loose' ? 'lunar-nominal' : 'lunar-loose'; change = `regolith ${plan.spec.soilId} → ${v.soilId}`; }
      if (a.parameter === 'rover') { v.roverId = ROVERS.some(r => r.id === a.value) ? a.value! : v.roverId === 'egiz-lr1' ? 'egiz-lr6' : 'egiz-lr1'; v.roverOverrides = {}; change = `rover ${plan.spec.roverId} → ${v.roverId}`; }
      if (a.parameter === 'fidelity') { v.fidelity = v.fidelity === 'fast' ? 'detailed' : 'fast'; change = `terramechanics ${plan.spec.fidelity} → ${v.fidelity}`; }
      if (a.parameter === 'departure') { v.departureT = Math.max(0, Math.min(ctx.world.illumination.duration - 3600, v.departureT + (fct - 1) * 24 * 3600)); change = `departure shifted by ${f1((fct - 1) * 24)} h`; }
      const val = validateMission(v, ctx.world);
      if (!val.ok) return fail('The varied scenario is invalid.', val.errors);
      const alt = ctx.simulateVariant(v, route), b = base.summary, c = alt.summary;
      const d = (x: number, y: number, unit: string, digits = 1) => `${x.toFixed(digits)} → ${y.toFixed(digits)} ${unit} (${y - x >= 0 ? '+' : ''}${(y - x).toFixed(digits)})`;
      return ok(`What-if on the ${LABEL(route.objective).toLowerCase()} route: ${change}.`, [
        { label: 'Outcome', value: `${b.status} → ${c.status}${c.failure ? ` (${c.failure})` : ''}`, cls: 'simulated' },
        { label: 'Duration', value: d(b.durationS / 3600, c.durationS / 3600, 'h', 2), cls: 'simulated' },
        { label: 'Energy used', value: d(b.energyUsedWh, c.energyUsedWh, 'Wh'), cls: 'simulated' },
        { label: 'Minimum SoC', value: d(b.minSocFrac * 100, c.minSocFrac * 100, '%'), cls: 'simulated' },
        { label: 'Reserve breached', value: `${b.reserveBreached} → ${c.reserveBreached}`, cls: 'simulated' },
        { label: 'Max slip', value: d(b.maxSlip * 100, c.maxSlip * 100, '%'), cls: 'simulated' }],
        ['Same route geometry; only the stated parameter changed. Re-plan if the change should alter the route itself.'], [{ kind: 'result', id: route.id, label: `Baseline ${route.id}` }], { variant: v, result: alt });
    },
  },
  {
    name: 'explain_route', description: 'Explain why a route is preferred, using the computed metrics of all candidate routes and Pareto dominance.',
    schema: { type: 'object', properties: { objective: { enum: ['shortest', 'safest', 'energy', 'illumination'] } }, additionalProperties: false },
    parse: raw => ({ objective: optEnum(obj(raw ?? {}), 'objective', ['shortest', 'safest', 'energy', 'illumination'] as const) }),
    async run(ctx, a) {
      const plan = ctx.plan;
      if (!plan) return fail('No routes have been planned yet.');
      const feas = plan.routes.filter(r => r.feasible && plan.sims[r.id]);
      const target = feas.find(r => r.objective === (a.objective ?? feas.find(x => x.id === ctx.activeRouteId)?.objective ?? plan.spec.preferred)) ?? feas[0];
      if (!target) return fail('No feasible routes.');
      const metric = (r: Route) => { const s = plan.sims[r.id].summary; return { len: r.lengthM, energy: s.energyUsedWh, risk: s.maxRollDeg + s.maxPitchDeg + (plan.checks[r.id]?.exceedM ?? 0) / 10, dark: 1 - s.sunlitFraction, time: s.durationS }; };
      const mt = metric(target);
      const dominated = feas.filter(r => r !== target).filter(r => { const m = metric(r); return m.len <= mt.len && m.energy <= mt.energy && m.risk <= mt.risk && m.dark <= mt.dark && (m.len < mt.len || m.energy < mt.energy || m.risk < mt.risk || m.dark < mt.dark); });
      const best = (k: keyof ReturnType<typeof metric>) => feas.reduce((p, q) => (metric(q)[k] < metric(p)[k] ? q : p));
      return ok(`${LABEL(target.objective)} route explained.`, [
        { label: 'Objective', value: `${LABEL(target.objective)} — A* minimised ${target.objective === 'safest' ? 'length weighted by slope, cross-slope and crater-interior penalties' : target.objective === 'energy' ? 'terramechanics electrical energy per metre at each grade' : target.objective === 'illumination' ? 'length weighted by shadow at departure' : 'length'} under hard slope limits`, cls: 'derived' },
        { label: 'Its metrics', value: `${(mt.len / 1000).toFixed(2)} km, ${f0(mt.energy)} Wh, ${(mt.time / 3600).toFixed(2)} h, sunlit ${pct(1 - mt.dark)}`, cls: 'simulated' },
        { label: 'Shortest overall', value: LABEL(best('len').objective), cls: 'simulated' }, { label: 'Lowest energy overall', value: LABEL(best('energy').objective), cls: 'simulated' },
        { label: 'Lowest attitude/slope exposure', value: LABEL(best('risk').objective), cls: 'simulated' },
        { label: 'Pareto status', value: dominated.length ? `dominated by ${dominated.map(r => LABEL(r.objective)).join(', ')}` : 'not dominated on length, energy, attitude exposure and darkness', cls: 'derived' }],
        [], [{ kind: 'result', id: target.id, label: `Simulation ${target.id}` }]);
    },
  },
  {
    name: 'evidence', description: 'Show the evidence chain behind an object or the current selection: source data, tiles, model, parameters and outputs.',
    schema: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false },
    parse: raw => ({ id: optId(obj(raw ?? {}), 'id') }),
    async run(ctx, a) {
      const o = a.id ? ctx.world.object(a.id) : selectionPoint(ctx)?.object ?? null;
      const m = ctx.world.manifest;
      const p = o ?? selectionPoint(ctx);
      if (!p) return fail('Select an object or location first.');
      const tile = ctx.world.tileKeyAt(ctx.world.analysisLevel(p), p.x, p.y), td = ctx.world.descriptor(tile);
      const facts: Fact[] = [
        { label: '1 · Source', value: `${m.source.product}, SHA-256 ${m.source.sha256.slice(0, 16)}…`, cls: 'measured' },
        { label: '2 · Processing', value: 'All-valid area-average reprojection to local AEQD at 5 m; level pyramid by Gaussian prefilter + decimation', cls: 'derived' },
        { label: '3 · Tile', value: `${tile} (${td?.posting} m posting, geometric error max ${td?.geometricErrorMax} m), SHA-256 ${td?.sha256.slice(0, 16)}…`, cls: 'derived' },
      ];
      if (o) {
        const model = ctx.world.registry.find(r => r.id === o.provenance.modelId);
        facts.push({ label: '4 · Model', value: model ? `${model.name} v${model.version} — ${model.architecture}` : 'none', cls: 'model' },
          { label: '5 · Output', value: `${o.id}: ${JSON.stringify(Object.fromEntries(Object.entries(o.properties).filter(([k]) => k !== 'drivers')))}`, cls: 'model' },
          { label: '6 · Confidence', value: o.confidence === null ? 'statistical candidate (no score)' : `${o.confidence} (heuristic)`, cls: 'model' },
          { label: '7 · Evaluation', value: model?.evaluation ?? 'n/a', cls: 'unknown' });
      }
      ctx.apply({ type: 'panel', panel: 'evidence' });
      return ok(`Evidence chain for ${o ? o.id : 'the selected location'}.`, facts, [], [SRC, ...(o ? [objCite(o), modelCite(o.provenance.modelId ?? '')] : [])]);
    },
  },
  {
    name: 'red_team', description: 'Look for evidence and assumptions that contradict or weaken the current assessment (route, simulation, detections).',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    parse: () => ({}),
    async run(ctx) {
      const facts: Fact[] = [];
      const plan = ctx.plan, w = ctx.world;
      if (plan) {
        for (const r of plan.routes) {
          const s = plan.sims[r.id]?.summary, c = plan.checks[r.id];
          if (c && c.exceedM > 0) facts.push({ label: `${LABEL(r.objective)}: slope check`, value: `${f0(c.exceedM)} m of the route exceed ${plan.spec.constraints.maxSlopeDeg}° at the 5 m posting (max ${f1(c.maxSlope5m)}°) although the 10 m planner accepted it`, cls: 'derived' });
          if (s && s.energySensitivityWh.loose === 'immobile') facts.push({ label: `${LABEL(r.objective)}: soil sensitivity`, value: 'the rover would be immobilised under the loose-regolith sensitivity case', cls: 'simulated' });
          else if (s && typeof s.energySensitivityWh.loose === 'number' && s.energyUsedWh > 0) facts.push({ label: `${LABEL(r.objective)}: soil sensitivity`, value: `drive energy ranges ${s.energySensitivityWh.firm}–${s.energySensitivityWh.loose} Wh across firm/loose assumptions`, cls: 'simulated' });
          if (s && s.minStabilityMarginDeg < 8) facts.push({ label: `${LABEL(r.objective)}: stability`, value: `minimum static stability margin only ${s.minStabilityMarginDeg}°`, cls: 'simulated' });
        }
      } else facts.push({ label: 'Routes', value: 'no plan exists yet — nothing to challenge', cls: 'unknown' });
      facts.push({ label: 'Resolution', value: 'all slopes are at ≥ 5 m posting; rocks and sub-5 m craters that dominate rover hazards are invisible to this analysis', cls: 'unknown' },
        { label: 'Illumination edges', value: `horizon grid covers ${pct(w.manifest.layers.horizon.validFraction ?? 0)} of its extent; distant terrain beyond the raster can cast shadows that are not modelled`, cls: 'unknown' },
        { label: 'Detections', value: 'crater scores and terrain units have no labelled validation for this site', cls: 'model' },
        { label: 'Soil', value: 'no in-situ regolith measurements exist; mechanical parameters are literature values', cls: 'assumed' });
      return ok('Counter-evidence and weak points of the current assessment.', facts, ['A red-team list is a prompt for verification, not a verdict.'], [{ kind: 'knowledge', id: 'barker2021', label: 'Barker et al. 2021' }, { kind: 'knowledge', id: 'mazarico2011', label: 'Mazarico et al. 2011' }]);
    },
  },
  {
    name: 'data_quality', description: 'Run automated data-quality checks (hashes, seams, ranges, coverage, SPICE integrity, model domain) and list missing measurements.',
    schema: { type: 'object', properties: {}, additionalProperties: false }, parse: () => ({}),
    async run(ctx) {
      const checks = await runQualityChecks(ctx.world, ctx.fetchTileRaw);
      return ok(`${checks.filter(c => c.status === 'pass').length} checks passed, ${checks.filter(c => c.status === 'warn').length} warnings, ${checks.filter(c => c.status === 'fail').length} failures.`,
        checks.map(c => ({ label: `${c.status.toUpperCase()} · ${c.label}`, value: c.detail, cls: (c.status === 'pass' ? 'derived' : c.label === 'Missing data' ? 'unknown' : 'derived') as FactClass })), ['The ATLAS-Π field plan ranks which measurements would most change analog decisions (value of information).'], [SRC]);
    },
  },
  {
    name: 'compare_analog', description: 'Compare this lunar site with an Earth analog window using the deterministic ATLAS-Π transferability engine (authoritative statuses per mission task).',
    schema: { type: 'object', properties: { earthSite: { type: 'string' } }, required: ['earthSite'], additionalProperties: false },
    parse: raw => { const o = obj(raw); const earthSite = optStr(o, 'earthSite', 60); if (!earthSite) throw new ToolArgumentError('earthSite is required'); return { earthSite }; },
    async run(ctx, a) {
      const atlas = ctx.atlas;
      if (!atlas) return fail('The ATLAS-Π bundle is not loaded (measured pilot dataset required).');
      const q = a.earthSite.toLowerCase().replace(/bozjyra|bozzhira|boszhyra/g, 'boszhira');
      const site = atlas.sites.find(s => (s.name ?? '').toLowerCase().includes(q) || s.id.toLowerCase().includes(q.replace(/\s+/g, '_')));
      if (!site) return fail(`No ATLAS-Π Earth window matches “${a.earthSite}”.`, [`Available: ${atlas.sites.map(s => s.name ?? s.id).join('; ')}`]);
      const cells = atlas.tensor.cells.filter(c => c.site === site.id && c.target === ctx.world.manifest.siteId);
      if (!cells.length) return fail(`ATLAS-Π has no cells for ${site.name} × ${ctx.world.manifest.siteId}.`);
      return ok(`ATLAS-Π: ${site.name ?? site.id} vs Mons Mouton, per mission task.`, cells.map(c => ({ label: c.task.replace(/_/g, ' ').toLowerCase(), value: `${c.status}${c.axes.task_match !== null ? ` (task match ${c.axes.task_match.toFixed(2)})` : ''}${c.reasons.length ? ` — ${c.reasons.join(', ')}` : ''}`, cls: 'derived' as FactClass })),
        ['Statuses are computed by the deterministic ATLAS-Π engine (authoritative); this copilot only retrieves them.', 'Open Transferability (#/atlas) for certificates, counterfactual physics and the field plan.'], [{ kind: 'atlas', id: site.id, label: `ATLAS-Π certificate cells for ${site.id}` }]);
    },
  },
  {
    name: 'hypothesis', description: 'Generate a structured, falsifiable research hypothesis for a detected crater or anomaly candidate (observation, interpretation, evidence, counter-evidence, alternative, prediction, falsification, measurement).',
    schema: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false },
    parse: raw => ({ id: optId(obj(raw ?? {}), 'id') }),
    async run(ctx, a) {
      const o = a.id ? ctx.world.object(a.id) : selectionPoint(ctx)?.object ?? null;
      if (!o || (o.type !== 'crater' && o.type !== 'anomaly')) return fail('Select a crater or anomaly candidate first.');
      const h = hypothesisFor(o);
      return ok(`HYPOTHESIS (not a discovery) for ${o.id}.`, [
        { label: 'Observation', value: h.observation, cls: 'model' }, { label: 'Interpretation', value: h.interpretation, cls: 'hypothesis' },
        { label: 'Supporting evidence', value: h.support.join(' '), cls: 'model' }, { label: 'Counter-evidence', value: h.counter.join(' '), cls: 'unknown' },
        { label: 'Alternative explanation', value: h.alternative, cls: 'hypothesis' }, { label: 'Testable prediction', value: h.prediction, cls: 'hypothesis' },
        { label: 'Falsification condition', value: h.falsification, cls: 'hypothesis' }, { label: 'Required measurement', value: h.measurement, cls: 'unknown' }],
        ['Generated from the object’s measured/model properties by documented templates; no language model is involved.'], [objCite(o), { kind: 'knowledge', id: 'pike1977', label: 'Pike 1977' }]);
    },
  },
  {
    name: 'generate_dossier', description: 'Generate the reproducible mission dossier (Markdown + JSON) from the current mission, routes and simulations.',
    schema: { type: 'object', properties: {}, additionalProperties: false }, parse: () => ({}),
    async run(ctx) {
      if (!ctx.plan) return fail('Plan and simulate a mission first; the dossier reports real results only.');
      const d = await ctx.dossier();
      ctx.apply({ type: 'download', name: `egiz-astral-dossier-${ctx.world.manifest.id}.md`, text: d.markdown, mime: 'text/markdown' });
      const rep = d.json.reproducibility as { inputHash: string; outputHash: string } | null;
      return ok('Dossier generated and downloaded.', rep ? [{ label: 'Input hash', value: rep.inputHash, cls: 'derived' }, { label: 'Output hash', value: rep.outputHash, cls: 'derived' }] : [], [], []);
    },
  },
  {
    name: 'search_knowledge', description: 'Retrieve cited background from the curated EGIZ knowledge base (papers, datasets, methods).',
    schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
    parse: raw => { const o = obj(raw); const query = optStr(o, 'query', 300); if (!query) throw new ToolArgumentError('query is required'); return { query }; },
    async run(_ctx, a) {
      const hits = searchKnowledge(a.query, 4, 0.8);
      if (!hits.length) return fail('No entry in the curated knowledge base matches; EGIZ will not invent a source.');
      return ok(`${hits.length} sources retrieved.`, hits.map(h => ({ label: h.entry.title, value: h.entry.text, cls: 'retrieved' as FactClass, note: h.entry.citation })), [], hits.map(h => ({ kind: 'knowledge' as const, id: h.entry.id, label: h.entry.citation, url: h.entry.url })));
    },
  },
];

export const TOOL_INDEX = new Map(TOOLS.map(t => [t.name, t]));
export interface ToolCallLog { at: string; tool: string; args: unknown; ok: boolean; summary: string; ms: number }

/** Validate and execute one tool call; never throws (errors become failed results). */
export async function callTool(ctx: ToolContext, name: string, raw: unknown, log: ToolCallLog[]): Promise<ToolResult> {
  const t0 = performance.now(), tool = TOOL_INDEX.get(name);
  let result: ToolResult;
  if (!tool) result = fail(`Tool ${name} is not allowlisted.`);
  else {
    try { result = await tool.run(ctx, tool.parse(raw)); }
    catch (e) { result = fail(e instanceof ToolArgumentError ? `Invalid arguments: ${e.message}` : `Tool failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
  log.push({ at: new Date().toISOString(), tool: name, args: raw, ok: result.ok, summary: result.summary, ms: Math.round(performance.now() - t0) });
  return result;
}
export type ObjectiveName = RouteObjective;
