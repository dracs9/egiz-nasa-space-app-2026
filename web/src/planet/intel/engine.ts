// EGIZ Planetary Studio · intelligence layer.
// A question becomes a plan of typed tool calls; every tool executes a real engine on the live workspace state:
//   terrain analysis (planet/terrain) · Discover ranking with uncertainty (discover/engine) · ATLAS-Π transferability
//   (atlas bundle) · the digital twin (planet/twin) · the candidate-space ML (planet/intel/ml).
// Numbers in an answer come only from tool results, each tagged with its evidence class. There is no free-text
// generation here, so nothing can be invented; the price is a fixed vocabulary of question shapes.
// `TOOL_SCHEMAS` is the seam for a language-model orchestrator: it would emit the same calls through `callIntel`.
import { aspectDeg, roughness, slopeDeg, type XY } from '../../astral/world/field';
import type { AtlasBundle, Status } from '../../atlas/types';
import { callTool as callDiscover, plan as planDiscover, type Fact, type ToolContext } from '../../discover/copilot';
import { aggregate } from '../../discover/engine';
import type { LayerSet } from '../compute';
import { fieldRange } from '../../astral/world/field';
import { sunVisible, type SiteSummary } from '../terrain/derive';
import { heightAt, siteLatLon, BODY_LABEL, type Body, type Site } from '../terrain/site';
import { sunAt, TRANSMISSION_NOTE } from '../terrain/solar';
import { defaultConfig, mobilityLimits, type MissionPlan, type SensitivityRow, type TwinConfig, type TwinRun } from '../twin/twin';
import type { CandidateSpace } from './ml';

export type Evidence = 'measured' | 'derived' | 'simulated' | 'model' | 'assumed' | 'curated' | 'missing';
export interface IntelAction { label: string; kind: 'select-window' | 'open-window' | 'fly-to' | 'layer' | 'apply-plan' | 'stage' | 'run-twin'; payload?: unknown }
export interface IntelResult { tool: string; ok: boolean; title: string; summary: string; facts: Fact[]; notes: string[]; sources: string[]; actions: IntelAction[]; windows?: string[] }
export interface CompareCtx { a: { name: string; body: Body; summary: SiteSummary }; b: { name: string; body: Body; summary: SiteSummary }; commonPostingM: number; baselineM: number; slopeW1Deg: number; nativePostingsM: [number, number] }
export interface IntelContext {
  site: Site | null; layers: LayerSet | null; selection: (XY & { h: number }) | null; timeS: number;
  config: TwinConfig | null; plan: MissionPlan | null; run: TwinRun | null; sensitivity: SensitivityRow[] | null;
  discovery: ToolContext | null; atlas: AtlasBundle | null; compare: CompareCtx | null; space: CandidateSpace | null;
}
export interface Finding { code: string; severity: 'info' | 'caution' | 'reject'; title: string; detail: string }
export interface IntelAnswer { id: string; question: string; plan: { tool: string; input: Record<string, unknown> }[]; results: IntelResult[]; findings: Finding[]; verdict: 'supported' | 'conditional' | 'rejected' | 'informational'; context: string }
interface IntelTool { name: string; description: string; schema: Record<string, unknown>; needs: string; run(ctx: IntelContext, input: Record<string, unknown>): IntelResult }

const f1 = (v: number | null | undefined, d = 1, unit = '') => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(d)}${unit}`);
const pct = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(0)} %`);
const fail = (tool: string, title: string, summary: string, action?: IntelAction): IntelResult => ({ tool, ok: false, title, summary, facts: [], notes: [], sources: [], actions: action ? [action] : [] });
const fact = (label: string, value: string, evidence: Evidence): Fact => ({ label, value, evidence });
const activeWindow = (ctx: IntelContext) => ctx.discovery?.selected ?? ctx.site?.discoveryWindow ?? null;

/** Top-k window indices by score, and how the set and one window's rank move when each weight is halved or doubled. */
export function rankingStability(d: ToolContext, k = 10, windowId?: string | null) {
  const top = (weights: Record<string, number>) => { const a = aggregate(d.shard, weights), order = Array.from(a.score.keys()).filter(i => a.score[i] > 0).sort((x, y) => a.score[y] - a.score[x]); return { order, a }; };
  const base = top(d.weights), baseTop = new Set(base.order.slice(0, k)), wi = windowId ? d.bundle.windows.id.indexOf(windowId) : -1, rankOf = (order: number[]) => (wi >= 0 ? order.indexOf(wi) + 1 || null : null);
  const rows = d.shard.dims.filter(dim => (d.weights[dim] ?? 0) > 0).flatMap(dim => ([0.5, 2] as const).map(mult => {
    const t = top({ ...d.weights, [dim]: d.weights[dim] * mult }), set = new Set(t.order.slice(0, k)); let inter = 0; for (const i of set) if (baseTop.has(i)) inter++;
    return { dim, label: d.bundle.dimensions.find(x => x.id === dim)?.label ?? dim, change: mult === 0.5 ? 'halved' : 'doubled', jaccard: inter / (set.size + baseTop.size - inter || 1), rank: rankOf(t.order) };
  }));
  const a = base.a, o = base.order, overlap = o.length > 1 ? o.slice(1, 6).filter(i => a.hi[i] >= a.lo[o[0]]).length : 0;
  return { rows: rows.sort((x, y) => x.jaccard - y.jaccard), minJaccard: rows.length ? Math.min(...rows.map(r => r.jaccard)) : 1, baseRank: rankOf(o), leaders: o.slice(0, k).map(i => d.bundle.windows.id[i]), leaderOverlap: overlap, k };
}

const TOOLS: IntelTool[] = [
  { name: 'terrain_summary', description: 'Measured relief and terrain-derived slope / roughness statistics of the open 3D site.', schema: {}, needs: 'site',
    run(ctx) {
      const s = ctx.site, l = ctx.layers; if (!s || !l) return fail('terrain_summary', 'Terrain summary', 'Open a site in the 3D studio first; terrain statistics are computed from its analysis grid.', { label: 'Go to Inspect', kind: 'stage', payload: 'inspect' });
      const m = l.summary;
      return { tool: 'terrain_summary', ok: true, title: `Terrain of ${s.name}`, summary: `${BODY_LABEL[s.body]} site, ${m.extentKm.toFixed(1)} km analysis grid at ${m.postingM} m posts. Relief ${f1(m.reliefM, 0)} m; median slope ${f1(m.slope.p50)}° (90th percentile ${f1(m.slope.p90)}°) over a ${m.baselineM} m baseline; ${pct(m.fractionBelow15)} of the grid is below 15°.`,
        facts: [fact('Elevation range', `${f1(m.elevation.min, 1)} … ${f1(m.elevation.max, 1)} m`, 'measured'), fact('Relief', `${f1(m.reliefM, 1)} m`, 'measured'), fact(`Slope p50 / p90 / p95 (${m.baselineM} m baseline)`, `${f1(m.slope.p50)}° / ${f1(m.slope.p90)}° / ${f1(m.slope.p95)}°`, 'derived'), fact('Roughness p50 / p95 (detrended RMS)', `${f1(m.roughness.p50, 2)} / ${f1(m.roughness.p95, 2)} m`, 'derived'), fact('Area below 15° / above 25°', `${pct(m.fractionBelow15)} / ${pct(m.fractionAbove25)}`, 'derived'), fact('Valid posts', pct(m.validFraction), 'measured'), fact('Source', `${s.provenance.product} (${s.provenance.nativePostingM.toFixed(1)} m native)`, 'curated')],
        notes: [`Slope is scale-dependent: these values hold at a ${m.baselineM} m baseline only.`, ...s.limitations.slice(0, 2)], sources: [s.provenance.citation], actions: [{ label: 'Show slope layer', kind: 'layer', payload: 'slope' }] };
    } },
  { name: 'inspect_point', description: 'Coordinates, elevation, slope, aspect, roughness, Sun and terrain shadow at the selected point.', schema: {}, needs: 'site + selection',
    run(ctx) {
      const s = ctx.site, p = ctx.selection; if (!s || !p) return fail('inspect_point', 'Point inspection', 'Click a point on the terrain first.');
      const ll = siteLatLon(s, p), sl = slopeDeg(s.field, p), as = aspectDeg(s.field, p), ro = roughness(s.field, p, 2), sun = s.sun ? sunAt(s.sun, ctx.timeS) : null, occ = s.context ?? s.field;
      const lit = sun ? sunVisible(occ, fieldRange(occ).max, p.x, p.y, p.h, sun.sunEnu, s.radiusM) : null;
      return { tool: 'inspect_point', ok: true, title: 'Selected point', summary: `${f1(ll.lat, 5)}°, ${f1(ll.lon, 5)}° at ${f1(p.h, 1)} m; slope ${f1(sl)}° facing ${f1(as, 0)}°${lit === null ? '' : lit ? '; in direct sunlight at the scene time' : '; in terrain shadow or night at the scene time'}.`,
        facts: [fact('Local x east / y north', `${f1(p.x, 1)} / ${f1(p.y, 1)} m`, 'measured'), fact('Latitude / longitude', `${f1(ll.lat, 5)}° / ${f1(ll.lon, 5)}°`, 'derived'), fact('Elevation', `${f1(p.h, 2)} m (${s.provenance.verticalDatum})`, 'measured'), fact(`Slope (${s.field.posting} m baseline)`, `${f1(sl)}°`, 'derived'), fact('Downslope aspect', `${f1(as, 0)}° from north`, 'derived'), fact('Roughness (5×5 posts, detrended RMS)', `${f1(ro, 2)} m`, 'derived'),
          ...(sun ? [fact('Sun elevation / azimuth', `${f1(sun.elevationDeg)}° / ${f1(sun.azimuthDeg, 0)}°`, s.sun!.engine.includes('CSPICE') ? 'measured' as const : 'model' as const), fact('Direct Sun', lit ? 'visible' : 'blocked', 'derived')] : [fact('Sun', 'no record', 'missing')])],
        notes: [inAnalysisNote(s, p)], sources: [s.provenance.citation], actions: [{ label: 'Fly here', kind: 'fly-to', payload: { x: p.x, y: p.y } }] };
    } },
  { name: 'solar_access', description: 'Sun elevation over the record and the fraction of it with direct Sun at the selected point (terrain occlusion included).', schema: {}, needs: 'site',
    run(ctx) {
      const s = ctx.site; if (!s) return fail('solar_access', 'Solar access', 'Open a site first.');
      if (!s.sun) return { ...fail('solar_access', 'Solar access', 'No Sun record exists for this site, so illumination and solar energy cannot be evaluated.'), facts: [fact('Sun record', 'missing', 'missing')] };
      const occ = s.context ?? s.field, zmax = fieldRange(occ).max, n = 96, p = ctx.selection ?? { x: s.field.west + ((s.field.side - 1) * s.field.posting) / 2, y: s.field.north - ((s.field.side - 1) * s.field.posting) / 2, h: 0 };
      const h = heightAt(s, p); let up = 0, lit = 0, lo = Infinity, hi = -Infinity;
      for (let k = 0; k < n; k++) { const st = sunAt(s.sun, (s.sun.duration * (k + 0.5)) / n); lo = Math.min(lo, st.elevationDeg); hi = Math.max(hi, st.elevationDeg); if (st.elevationDeg > 0) { up++; if (h !== null && sunVisible(occ, zmax, p.x, p.y, h, st.sunEnu, s.radiusM)) lit++; } }
      return { tool: 'solar_access', ok: true, title: 'Solar access', summary: `Over the ${(s.sun.duration / 3600).toFixed(0)} h record the Sun ranges ${f1(lo)}° to ${f1(hi)}°. At ${ctx.selection ? 'the selected point' : 'the grid centre'} the Sun's centre is visible ${pct(lit / n)} of the time (above the geometric horizon ${pct(up / n)}).`,
        facts: [fact('Sun elevation range', `${f1(lo)}° … ${f1(hi)}°`, s.sun.engine.includes('CSPICE') ? 'measured' : 'model'), fact('Above geometric horizon', pct(up / n), 'derived'), fact('Direct Sun with terrain occlusion', pct(lit / n), 'derived'), fact('Lost to terrain shadow', pct((up - lit) / n), 'derived'), fact('Ephemeris', s.sun.engine, 'curated')],
        notes: [TRANSMISSION_NOTE[s.body], `Terrain outside the ${(((occ.side - 1) * occ.posting) / 1000).toFixed(1)} km occluder grid casts no shadow in this model.`, `${n} evenly spaced samples of the record; the record covers ${(s.sun.duration / 86400).toFixed(1)} days from ${s.sun.epochUtc} only.`], sources: [s.sunNote], actions: [{ label: 'Show insolation layer', kind: 'layer', payload: 'insolation' }] };
    } },
  { name: 'least_reliable', description: 'Where the current models are least reliable: unresolved scales, missing dimensions, assumed parameters, coverage gaps.', schema: {}, needs: 'any',
    run(ctx) {
      const facts: Fact[] = [], notes: string[] = [], s = ctx.site, d = ctx.discovery;
      if (s) {
        facts.push(fact('Terrain posting', `${s.field.posting} m (source ${s.provenance.nativePostingM.toFixed(1)} m)`, 'curated'));
        if (ctx.layers) { facts.push(fact('Posts without data', pct(1 - ctx.layers.summary.validFraction), 'measured')); if (ctx.layers.summary.fractionAbove25 > 0.02) notes.push(`${pct(ctx.layers.summary.fractionAbove25)} of the site is steeper than 25°: slopes there are underestimated most by the finite baseline.`); }
        notes.push(`Features smaller than about ${(s.field.posting * 3).toFixed(0)} m (≈3 posts) are not resolved: rocks, steps and small craters are absent from every layer and simulation.`);
        if (!s.sun) notes.push('No Sun record: illumination-dependent results are unavailable.'); else if (!s.sun.engine.includes('CSPICE')) notes.push('Sun geometry is analytic rather than CSPICE for this streamed site.');
        if (s.provenance.delivery === 'streamed') notes.push('Streamed composite DEM: lineage and true resolution vary by region and are not version-pinned.');
        notes.push(...s.limitations.slice(0, 3));
      }
      if (d) {
        const missing = d.bundle.dimensions.filter(x => d.target.dimension_status[x.id] !== 'measured');
        facts.push(fact('Similarity dimensions not measured for this target', `${missing.length} of ${d.bundle.dimensions.length}`, 'missing'));
        for (const x of missing.slice(0, 6)) notes.push(`${x.label}: ${d.target.dimension_status[x.id].replace('_', ' ')}${x.reason ? ` — ${x.reason}` : ''}`);
      }
      if (ctx.atlas && d) { const cells = ctx.atlas.tensor.cells.filter(c => c.target === d.target.id), limited = cells.filter(c => !c.axes.resolution_sufficient); if (cells.length) facts.push(fact('ATLAS-Π task cells limited by resolution', `${limited.length} of ${cells.length}`, 'derived')); }
      if (ctx.run) notes.push(...ctx.run.warnings.slice(0, 3));
      if (!facts.length && !notes.length) return fail('least_reliable', 'Model reliability', 'Nothing is loaded yet: open a site or choose a target to assess reliability.');
      return { tool: 'least_reliable', ok: true, title: 'Where the models are least reliable', summary: 'Reliability is limited by what the data resolve and by which quantities were never measured; the list below is specific to what is loaded now.', facts, notes, sources: [], actions: [] };
    } },
  { name: 'mission_status', description: 'Outcome, energy, slip and warnings of the last twin simulation, and which parameters it is most sensitive to.', schema: {}, needs: 'twin run',
    run(ctx) {
      const r = ctx.run; if (!r) return fail('mission_status', 'Mission simulation', 'No simulation has been run. Place a start and destination, then run the twin.', { label: 'Go to Simulate', kind: 'stage', payload: 'simulate' });
      const m = r.summary, top = ctx.sensitivity?.slice(0, 3) ?? [];
      return { tool: 'mission_status', ok: r.result.outcome === 'completed', title: `Simulated mission: ${m.outcome}`, summary: `${r.result.explanation} ${f1(m.distanceM, 0)} m in ${(m.durationS / 3600).toFixed(2)} h, ${f1(m.energyUsedWh, 0)} Wh used (${f1(m.whPerKm, 0)} Wh/km), minimum battery ${f1(m.minBatteryWh, 0)} Wh.`,
        facts: [fact('Outcome', m.outcome, 'simulated'), fact('Distance / duration', `${f1(m.distanceM, 0)} m / ${(m.durationS / 3600).toFixed(2)} h`, 'simulated'), fact('Energy used / generated', `${f1(m.energyUsedWh, 0)} / ${f1(m.energyGeneratedWh, 0)} Wh`, 'simulated'), fact('Peak slip / sinkage', `${pct(m.maxSlip)} / ${f1(m.maxSinkageM * 100, 1)} cm`, 'simulated'), fact('Peak tilt', `${f1(m.maxTiltDeg)}°`, 'simulated'), fact('Time in shadow', `${(m.shadowTimeS / 60).toFixed(0)} min`, 'simulated'), fact('Gravity', `${r.gravity} m/s² (${r.gravityBody})`, 'assumed'),
          ...top.map(t => fact(`Sensitive to ${t.label}`, `elasticity up to ${f1(Math.max(...Object.values(t.elasticity).map(v => Math.abs(v ?? 0))), 2)}`, 'simulated'))],
        notes: [...r.warnings, 'Simulated with a quasi-static terramechanics model; not validated against test-bed or flight data.'], sources: [r.result.model.terramechanics, `Fingerprint ${r.fingerprint}`], actions: top.length ? [] : [{ label: 'Run sensitivity analysis', kind: 'stage', payload: 'simulate' }] };
    } },
  { name: 'design_mission', description: 'Propose a traverse on the open site: a gentle start, up to three prominent landforms as science stops, slope limit from the vehicle.', schema: {}, needs: 'site + layers',
    run(ctx) {
      const s = ctx.site, l = ctx.layers; if (!s || !l) return fail('design_mission', 'Mission design', 'Open a site first; the proposal is computed from its slope and landform layers.');
      const lim = mobilityLimits(ctx.config ?? defaultConfig(s.body), s.body, ctx.plan?.maxSlopeDeg ?? 12), limit = Math.max(1, lim.maxSlopeDeg - 1), step = lim.maxStepM; // one degree inside the planner's limit
      const f = s.field, n = f.side, margin = Math.round(n * 0.08), minSep = (n - 1) * f.posting * 0.14, xy = (i: number) => ({ x: f.west + (i % n) * f.posting, y: f.north - Math.floor(i / n) * f.posting });
      const ok = (i: number) => l.slope.data[i] < limit && l.roughness.data[i] < step; // the same slope and step screens the route planner applies
      const centre = ctx.selection ?? xy(Math.floor(n / 2) * n + Math.floor(n / 2)); let start = -1, sd = Infinity;
      const stride = Math.max(1, Math.floor(n / 220));
      for (let r = margin; r < n - margin; r += stride) for (let c = margin; c < n - margin; c += stride) { const i = r * n + c; if (!ok(i) || !(l.slope.data[i] < 4)) continue; const p = xy(i), dd = Math.hypot(p.x - centre.x, p.y - centre.y); if (dd < sd) { sd = dd; start = i; } }
      if (start < 0) return fail('design_mission', 'Mission design', `No gentle cell under ${limit}° was found in the analysis grid; this site cannot host the default traverse.`);
      // Flood fill over 4-connected passable posts: stops are proposed only where the vehicle's screens connect them to the start.
      const reach = new Uint8Array(n * n), queue = new Int32Array(n * n); let head = 0, tail = 0; reach[start] = 1; queue[tail++] = start;
      while (head < tail) { const i = queue[head++], c = i % n; for (const j of [i - n, i + n, c > 0 ? i - 1 : -1, c < n - 1 ? i + 1 : -1]) if (j >= 0 && j < n * n && !reach[j] && ok(j)) { reach[j] = 1; queue[tail++] = j; } }
      const cand: { i: number; v: number }[] = [];
      for (let r = margin; r < n - margin; r += stride) for (let c = margin; c < n - margin; c += stride) { const i = r * n + c, t = l.tpi.data[i]; if (reach[i] && Number.isFinite(t)) cand.push({ i, v: Math.abs(t) }); }
      cand.sort((a, b) => b.v - a.v); const stops: { i: number; v: number }[] = [], sp = xy(start);
      for (const c of cand) { const p = xy(c.i); if (Math.hypot(p.x - sp.x, p.y - sp.y) < minSep || Math.hypot(p.x - sp.x, p.y - sp.y) > minSep * 4.5) continue; if (stops.every(o => Math.hypot(xy(o.i).x - p.x, xy(o.i).y - p.y) > minSep)) stops.push(c); if (stops.length === 3) break; }
      if (!stops.length) return fail('design_mission', 'Mission design', 'No sufficiently prominent landform lies within reach of a gentle start.');
      stops.sort((a, b) => Math.atan2(xy(a.i).y - sp.y, xy(a.i).x - sp.x) - Math.atan2(xy(b.i).y - sp.y, xy(b.i).x - sp.x));
      const wps = stops.slice(0, -1).map((c, k) => ({ id: `wp${k + 1}`, label: `Stop ${k + 1}`, activity: 'imaging' as const, ...xy(c.i) })), end = xy(stops.at(-1)!.i);
      const plan: Partial<MissionPlan> = { start: sp, destination: end, waypoints: wps, maxSlopeDeg: Math.max(limit + 1, ctx.plan?.maxSlopeDeg ?? 12) };
      return { tool: 'design_mission', ok: true, title: 'Proposed traverse', summary: `A ${stops.length}-stop traverse from a ${f1(l.slope.data[start])}° start. Stops are the most prominent landforms (largest |topographic position|) connected to the start through posts under ${limit}° slope and ${step} m roughness (${((tail / (n * n)) * 100).toFixed(0)} % of the grid is reachable; slope limit set by ${lim.binding}${lim.binding === 'traction' ? `: the drive model climbs at most ${lim.tractionLimitDeg}° on this soil` : ''}). A computational suggestion; the twin's contact model decides whether it is drivable.`,
        facts: [fact('Start', `${f1(sp.x, 0)}, ${f1(sp.y, 0)} m — slope ${f1(l.slope.data[start])}°`, 'derived'), ...stops.map((c, k) => fact(k === stops.length - 1 ? 'Destination' : `Stop ${k + 1}`, `${f1(xy(c.i).x, 0)}, ${f1(xy(c.i).y, 0)} m — TPI ${l.tpi.data[c.i] > 0 ? '+' : ''}${f1(l.tpi.data[c.i], 1)} m (${l.tpi.data[c.i] > 0 ? 'local high' : 'local low'})`, 'derived'))],
        notes: ['Landform prominence is a geometric measure; it carries no geological interpretation.', 'Targets are not science priorities: no composition, imagery interpretation or mission objective informed them.'], sources: [`TPI window ${l.tpi.baselineM.toFixed(0)} m; slope baseline ${l.slope.baselineM} m`], actions: [{ label: 'Apply plan and open Simulate', kind: 'apply-plan', payload: plan }] };
    } },
  { name: 'transfer_status', description: 'ATLAS-Π: per-task transferability of the active Earth site to the active target, with reasons.', schema: { window: 'string?' }, needs: 'ATLAS-Π bundle',
    run(ctx, input) {
      const a = ctx.atlas, target = ctx.discovery?.target.id, w = (input.window as string) ?? activeWindow(ctx);
      if (!a) return fail('transfer_status', 'Transferability', 'The ATLAS-Π bundle is not packaged for this data mode.');
      const cells = a.tensor.cells.filter(c => (!target || c.target === target) && (!w || c.site === w));
      if (!w || !cells.length) return { ...fail('transfer_status', 'Transferability', w ? `ATLAS-Π has no task cells for ${w}${target ? ` → ${target}` : ''}. It evaluates ${a.sites.length} catalogued sites against ${a.targets.map(t => t.id).join(' and ')}.` : 'Select an Earth candidate that ATLAS-Π evaluates.'), windows: a.sites.map(x => x.id), facts: [fact('Sites with transfer cells', a.sites.map(x => x.id).join(', '), 'curated')] };
      const order: Status[] = ['SUPPORTED', 'CONDITIONAL', 'WEAK', 'NON_TRANSFERABLE', 'UNKNOWN'], count = (st: Status) => cells.filter(c => c.status === st).length, tgt = cells[0].target;
      return { tool: 'transfer_status', ok: true, title: `Transferability: ${w} → ${tgt}`, summary: `Of ${cells.length} mission tasks, ${count('SUPPORTED')} are supported, ${count('CONDITIONAL')} conditional, ${count('WEAK')} weak, ${count('NON_TRANSFERABLE')} non-transferable and ${count('UNKNOWN')} unknown. Resemblance and transferability are judged per task, not as one score.`,
        facts: cells.sort((x, y) => order.indexOf(x.status) - order.indexOf(y.status)).map(c => fact(a.registry.tasks.tasks.find(t => t.id === c.task)?.name ?? c.task, `${c.status}${c.axes.task_match !== null ? ` · match ${f1(c.axes.task_match, 2)}` : ''}${c.reasons.length ? ` · ${c.reasons.join(', ').toLowerCase().replace(/_/g, ' ')}` : ''}`, 'derived')),
        notes: [...new Set(cells.flatMap(c => c.limitations))].slice(0, 3), sources: [`ATLAS-Π ${a.version} (${a.content_sha256.slice(0, 12)})`], actions: [{ label: 'Open ATLAS-Π', kind: 'stage', payload: 'atlas' }], windows: [w] };
    } },
  { name: 'next_measurements', description: 'ATLAS-Π measurement planner: which field or lab measurements would reduce decision uncertainty most (expected value of information).', schema: {}, needs: 'ATLAS-Π bundle',
    run(ctx) {
      const a = ctx.atlas; if (!a) return fail('next_measurements', 'Measurement planning', 'The ATLAS-Π bundle is not packaged for this data mode.');
      const body = ctx.discovery?.target.body ?? ctx.site?.body, key = Object.keys(a.planner).find(k => (body === 'mars' ? /MARS/ : /MOON/).test(k)) ?? Object.keys(a.planner)[0], p = a.planner[key];
      if (!p) return fail('next_measurements', 'Measurement planning', 'No measurement plan is available.');
      const top = [...p.measurements].sort((x, y) => y.evpi - x.evpi).slice(0, 6);
      return { tool: 'next_measurements', ok: true, title: `Measurements that would change the decision (${key.replace(/_/g, ' ').toLowerCase()})`, summary: `Ranked by expected value of perfect information over ${p.draws} draws. The top measurement would change the selected campaign in ${pct(top[0]?.decision_change_probability)} of draws.`,
        facts: top.map(m => fact(m.name, `EVPI ${f1(m.evpi, 4)} · decision change ${pct(m.decision_change_probability)}${m.instrument ? ` · ${m.instrument}` : ''}`, 'model')),
        notes: [p.method, 'EVPI is an upper bound: real measurements are imperfect.'], sources: [`ATLAS-Π ${a.version} planner`], actions: [{ label: 'Open ATLAS-Π', kind: 'stage', payload: 'atlas' }] };
    } },
  { name: 'ranking_sensitivity', description: 'Which priority weights the candidate ranking depends on most: top-10 overlap when each weight is halved or doubled.', schema: { window: 'string?' }, needs: 'discovery',
    run(ctx, input) {
      const d = ctx.discovery; if (!d) return fail('ranking_sensitivity', 'Ranking sensitivity', 'The discovery index is not loaded.');
      const w = (input.window as string) ?? activeWindow(ctx), st = rankingStability(d, 10, w);
      return { tool: 'ranking_sensitivity', ok: true, title: 'Assumptions that move the ranking', summary: `The top-10 is ${st.minJaccard > 0.8 ? 'stable' : st.minJaccard > 0.5 ? 'moderately sensitive' : 'unstable'} under single-weight changes (minimum overlap ${f1(st.minJaccard, 2)}). ${st.rows[0] ? `"${st.rows[0].label}" ${st.rows[0].change} changes it most.` : ''}${w && st.baseRank ? ` ${w} is ranked ${st.baseRank}.` : ''}`,
        facts: st.rows.slice(0, 8).map(r => fact(`${r.label} ${r.change}`, `top-10 overlap ${f1(r.jaccard, 2)}${r.rank ? ` · ${w} → rank ${r.rank}` : ''}`, 'derived')),
        notes: ['Overlap is the Jaccard index of the top-10 sets. This is sensitivity to priorities, not measurement uncertainty.', st.leaderOverlap ? `${st.leaderOverlap} of ranks 2–6 have 90 % intervals overlapping rank 1: the leader is not statistically separable from them.` : 'Rank 1 is separated from ranks 2–6 at the 90 % level.'], sources: [`Discovery ${d.bundle.version}`], actions: [], windows: st.leaders.slice(0, 5) };
    } },
  { name: 'candidate_space', description: 'Unsupervised ML: clusters, statistical outliers and a diverse shortlist in the terrain-and-climate space of the Earth candidates.', schema: {}, needs: 'discovery + fitted space',
    run(ctx) {
      const d = ctx.discovery, sp = ctx.space; if (!d || !sp) return fail('candidate_space', 'Candidate space', 'The candidate space has not been fitted yet. Fit it from the Discover stage (it runs in this browser on the measured index).', { label: 'Go to Discover', kind: 'stage', payload: 'discover' });
      const w = activeWindow(ctx), wi = w ? d.bundle.windows.id.indexOf(w) : -1, pos = wi >= 0 ? sp.rows.indexOf(wi) : -1, out = sp.outlier.filter(v => v > sp.outlierThreshold).length;
      return { tool: 'candidate_space', ok: true, title: 'Structure of the candidate space', summary: `${sp.nRows} windows form ${sp.k} groups (silhouette ${f1(sp.silhouette, 2)} — ${sp.silhouette > 0.5 ? 'distinct' : sp.silhouette > 0.25 ? 'overlapping' : 'a continuum, weak structure'}). Grouping is reproduced on geographically held-out blocks with ARI ${f1(sp.geographicHoldoutAri, 2)}.${pos >= 0 ? ` ${w} is in group ${sp.labels[pos] + 1}${sp.outlier[pos] > sp.outlierThreshold ? ' and is a statistical outlier' : ''}.` : ''}`,
        facts: [fact('Model', `${sp.model.id} ${sp.model.version}`, 'model'), fact('Features', sp.features.join(', '), 'curated'), fact('Silhouette (k chosen)', `${f1(sp.silhouette, 3)} (k = ${sp.k})`, 'model'), fact('Seed stability (ARI)', f1(sp.seedStabilityAri, 3), 'model'), fact(`Geographic hold-out (ARI, ${sp.holdout.blockDeg}° blocks)`, `${f1(sp.geographicHoldoutAri, 3)} · fit ${sp.holdout.fitRows} / test ${sp.holdout.testRows}`, 'model'), fact('Group sizes', sp.sizes.join(' / '), 'model'), fact('Statistical outliers (top 1 %)', String(out), 'model'), fact('Rows excluded for missing features', String(sp.nDropped), 'missing')],
        notes: sp.limitations, sources: ['Fitted in this session; no pretrained weights, no labels.'], actions: [] };
    } },
  { name: 'compare_sites', description: 'Quantitative comparison of the two sites in the comparison view at one common posting and baseline.', schema: {}, needs: 'comparison',
    run(ctx) {
      const c = ctx.compare; if (!c) return fail('compare_sites', 'Site comparison', 'Open two sites in Compare first.', { label: 'Go to Compare', kind: 'stage', payload: 'compare' });
      const a = c.a.summary, b = c.b.summary, r = (x: number, y: number) => (y ? x / y : NaN);
      return { tool: 'compare_sites', ok: true, title: `${c.a.name} vs ${c.b.name}`, summary: `At a common ${c.commonPostingM} m posting, slope distributions differ by ${f1(c.slopeW1Deg, 2)}° (1-Wasserstein). Median slope ${f1(a.slope.p50)}° vs ${f1(b.slope.p50)}°; relief ${f1(a.reliefM, 0)} m vs ${f1(b.reliefM, 0)} m.`,
        facts: [fact('Slope distribution distance (W1)', `${f1(c.slopeW1Deg, 2)}°`, 'derived'), fact('Slope p50', `${f1(a.slope.p50)}° vs ${f1(b.slope.p50)}°`, 'derived'), fact('Slope p90', `${f1(a.slope.p90)}° vs ${f1(b.slope.p90)}°`, 'derived'), fact('Relief', `${f1(a.reliefM, 0)} vs ${f1(b.reliefM, 0)} m (ratio ${f1(r(a.reliefM, b.reliefM), 2)})`, 'measured'), fact('Roughness p50', `${f1(a.roughness.p50, 2)} vs ${f1(b.roughness.p50, 2)} m`, 'derived'), fact('Area below 15°', `${pct(a.fractionBelow15)} vs ${pct(b.fractionBelow15)}`, 'derived'), fact('Native postings', `${c.nativePostingsM[0]} m vs ${c.nativePostingsM[1]} m → compared at ${c.commonPostingM} m`, 'curated')],
        notes: [`Both grids were block-averaged to ${c.commonPostingM} m before slope was computed over a ${c.baselineM} m baseline; comparing native grids would mostly measure the resolution difference.`, 'Geometric similarity is not functional analog suitability: gravity, soil, atmosphere and illumination are compared separately.'], sources: [], actions: [] };
    } },
];
function inAnalysisNote(s: Site, p: XY) { return heightAt(s, p) !== null && slopeDeg(s.field, p) === null ? 'This point is outside the analysis grid: only elevation from the context grid is available.' : `Values are read from the ${s.field.posting} m analysis grid (${s.field.provenance}), independent of the level of detail on screen.`; }

const DISCOVER_TITLES: Record<string, string> = { rank_candidates: 'Ranked candidates', explain_candidate: 'Candidate dimensions', why_rank: 'Why this rank', compare_candidates: 'Candidate comparison', gap_ledger: 'Computed mismatches', uncertainty: 'Uncertainty', recommend_simulation: 'Terramechanics experiment', target_fingerprint: 'Target fingerprint', validation_summary: 'Validation against published analogs', earth_to_planet: 'Closest planetary target', find_window: 'Window search' };
export const TOOL_SCHEMAS = [...TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.schema, needs: t.needs })), ...Object.keys(DISCOVER_TITLES).map(name => ({ name, description: `Discover engine tool "${name}" (see discover/copilot.ts).`, input_schema: {}, needs: 'discovery' }))];

export function callIntel(ctx: IntelContext, name: string, input: Record<string, unknown> = {}): IntelResult {
  const own = TOOLS.find(t => t.name === name);
  try {
    if (own) return own.run(ctx, input);
    if (DISCOVER_TITLES[name]) {
      if (!ctx.discovery) return fail(name, DISCOVER_TITLES[name], 'The discovery index is not loaded.');
      const r = callDiscover(ctx.discovery, name, input);
      return { tool: name, ok: r.ok, title: DISCOVER_TITLES[name], summary: r.summary, facts: r.facts, notes: r.notes, sources: [`Discovery ${ctx.discovery.bundle.version} (${ctx.discovery.bundle.content_sha256.slice(0, 12)})`], windows: r.windows, actions: (r.windows ?? []).slice(0, 3).map(w => ({ label: `Inspect ${w}`, kind: 'select-window' as const, payload: w })) };
    }
    return fail(name, 'Unknown tool', `"${name}" is not an allowed tool.`);
  } catch (e) { return fail(name, own?.name ?? name, `The tool failed: ${e instanceof Error ? e.message : e}`); }
}

/** Deterministic intent parser (English and Russian keywords) → tool calls. Unmatched questions fall back to the Discover planner or to context. */
export function planQuestion(question: string, ctx: IntelContext): { tool: string; input: Record<string, unknown> }[] {
  const q = ` ${question.toLowerCase()} `, has = (...k: string[]) => k.some(x => q.includes(x)), call = (tool: string, input: Record<string, unknown> = {}) => ({ tool, input });
  if (has('least reliable', 'unreliable', 'ненад', 'limitation', 'огранич', 'trust', 'доверять')) return [call('least_reliable')];
  if (has('measurement', 'измерен', 'reduce uncertainty', 'снизит', 'what evidence is missing', 'missing evidence', 'не хватает', 'data gap')) return [call('next_measurements'), call('least_reliable')];
  if (has('assumption', 'допущен', 'influence', 'влия', 'sensitiv', 'чувствит', 'stable', 'устойчив')) return ctx.run && has('rover', 'mission', 'vehicle', 'ровер', 'мисси') ? [call('mission_status')] : [call('ranking_sensitivity')];
  if (has('rejected', 'reject', 'отклон', 'non-transfer', 'transfer', 'перенос', 'atlas')) return [call('transfer_status'), ...(ctx.discovery && activeWindow(ctx) ? [call('why_rank', { window: activeWindow(ctx) })] : [])];
  if (has('design a mission', 'design mission', 'plan a mission', 'mission scenario', 'спланир', 'сценарий мисс', 'propose a traverse', 'маршрут')) return [call('design_mission')];
  if (has('cluster', 'кластер', 'anomal', 'аномал', 'outlier', 'divers', 'разнообраз', 'group', 'групп')) return [call('candidate_space')];
  if (has('solar', 'солнеч', 'sun', 'солнц', 'illuminat', 'освещ', 'shadow', 'тень', 'energy', 'энерг') && ctx.site && !has('candidate', 'кандидат', 'rank')) return [call('solar_access')];
  if (has('simulat', 'симул', 'battery', 'батар', 'slip', 'пробукс', 'traverse result', 'what happened', 'что произошло') && ctx.run) return [call('mission_status')];
  if (has('compare', 'сравн', ' vs ', 'difference', 'разниц') && ctx.compare && !has('candidate', 'кандидат')) return [call('compare_sites')];
  if (has('this point', 'here', 'здесь', 'эта точка', 'selected point', 'coordinates', 'координат') && ctx.selection) return [call('inspect_point')];
  if (has('terrain', 'рельеф', 'slope', 'уклон', 'relief', 'rough', 'шерохов', 'elevation', 'высот') && ctx.site && !has('candidate', 'кандидат', 'find', 'найди', 'similar', 'похож', 'analog', 'аналог')) return [call('terrain_summary')];
  if (ctx.discovery) {
    const calls = planDiscover(question, ctx.discovery).map(c => call(c.name, c.input));
    if (has('mobility', 'мобильн', 'rover', 'ровер') && has('kazakh', 'казах')) return [call('rank_candidates', { country: 'KAZ', k: 5 }), call('ranking_sensitivity')];
    if (has('best combination', 'лучшее сочетание', 'solar accessib')) return [...calls, call('ranking_sensitivity')];
    return calls;
  }
  return ctx.site ? [call('terrain_summary')] : [call('least_reliable')];
}

/**
 * Independent review of an answer. The critic re-derives its findings from the workspace state, not from the answer's
 * wording, and may reject a recommendation whose support is insufficient.
 */
export function review(results: IntelResult[], ctx: IntelContext): { findings: Finding[]; verdict: IntelAnswer['verdict'] } {
  const out: Finding[] = [], used = new Set(results.map(r => r.tool)), d = ctx.discovery, s = ctx.site, add = (code: string, severity: Finding['severity'], title: string, detail: string) => { if (!out.some(f => f.code === code)) out.push({ code, severity, title, detail }); };
  const recommends = ['rank_candidates', 'explain_candidate', 'why_rank', 'compare_candidates', 'earth_to_planet', 'ranking_sensitivity'].some(t => used.has(t));
  for (const r of results) if (!r.ok) add(`unanswered:${r.tool}`, 'caution', 'A step could not be computed', r.summary);
  if (d && recommends) {
    const st = rankingStability(d, 10, activeWindow(ctx)), missing = d.bundle.dimensions.filter(x => d.target.dimension_status[x.id] !== 'measured'), measuredW = d.bundle.dimensions.filter(x => d.target.dimension_status[x.id] === 'measured').reduce((a, x) => a + (d.weights[x.id] ?? 0), 0), totalW = d.bundle.dimensions.reduce((a, x) => a + (d.weights[x.id] ?? 0), 0);
    if (st.leaderOverlap >= 3) add('inseparable', 'reject', 'No unique best candidate', `${st.leaderOverlap} of ranks 2–6 have 90 % intervals overlapping rank 1. The data support a tied group of leaders, not a single winner; a claim that rank 1 is "the best analog" is rejected.`);
    else if (st.leaderOverlap) add('inseparable', 'caution', 'Leader is not clearly separated', `${st.leaderOverlap} of ranks 2–6 overlap rank 1 at the 90 % level.`);
    if (st.minJaccard < 0.4) add('unstable', 'reject', 'Ranking is unstable under priority changes', `Halving or doubling a single weight keeps only ${(st.minJaccard * 100).toFixed(0)} % of the top-10. A recommendation that depends on the exact weights is not robust.`);
    else if (st.minJaccard < 0.7) add('unstable', 'caution', 'Ranking is sensitive to priorities', `Minimum top-10 overlap ${(st.minJaccard * 100).toFixed(0)} % under single-weight changes.`);
    if (missing.length) add('missing-dims', totalW > 0 && measuredW / totalW < 0.6 ? 'reject' : 'caution', 'Dimensions without evidence', `${missing.length} of ${d.bundle.dimensions.length} dimensions are not measured for ${d.target.id} (${missing.map(x => x.label).slice(0, 4).join('; ')}${missing.length > 4 ? '…' : ''}). ${pct(totalW ? measuredW / totalW : 0)} of the active weight rests on measured dimensions.`);
    if (d.target.dimension_status.geology !== 'measured' || d.target.dimension_status.mineralogy !== 'measured') add('geology', 'caution', 'Geology and mineralogy are not verified', 'Similarity here is geometric and climatic. No field-verified lithology or mineralogy supports a geological analog claim.');
    const v = d.validation?.targets.find(t => t.target === d.target.id), ci = v?.metrics.auc_90ci as number[] | undefined;
    if (v && typeof v.metrics.auc === 'number') add('validation', v.metrics.auc < 0.6 ? 'caution' : 'info', 'Validation against published analog sites', `AUC ${v.metrics.auc.toFixed(2)}${ci ? ` (90 % CI ${ci[0].toFixed(2)}–${ci[1].toFixed(2)})` : ''} on ${v.metrics.n_positive} positive sites. Labels reflect where campaigns were run, so this bounds neither error nor skill tightly.`);
    const w = activeWindow(ctx), wi = w ? d.bundle.windows.id.indexOf(w) : -1;
    if (wi >= 0 && !d.bundle.windows.in_population[wi]) add('population', 'info', 'Candidate is outside the reference population', `${w} is not part of the equal-area population used for percentiles; its percentile is an extrapolation.`);
    if (ctx.space && wi >= 0) { const p = ctx.space.rows.indexOf(wi); if (p >= 0 && ctx.space.outlier[p] > ctx.space.outlierThreshold) add('extrapolation', 'caution', 'Unusual feature combination', `${w} lies in the top 1 % of Mahalanobis distance in the candidate space: similarity models are least tested there.`); }
    if (s && s.body === 'earth') { const fine = d.target.fine_baseline_m; if (s.field.posting > fine / 2) add('resolution', 'caution', 'Resolution mismatch', `The target fingerprint uses a ${fine} m slope baseline; the open Earth terrain has ${s.field.posting} m posts. Fine-scale similarity cannot be checked visually at this resolution.`); }
  }
  if (used.has('mission_status') || used.has('design_mission')) {
    add('unvalidated-sim', 'caution', 'Simulation is not validated', 'Results come from a quasi-static terramechanics model with declared soil profiles. They are scenario outputs, not predictions; no test-bed or flight comparison exists.');
    if (ctx.run && s && s.field.posting > ctx.run.rover.wheelbase) add('scale', ctx.run.result.outcome === 'completed' ? 'reject' : 'caution', 'Vehicle is smaller than the terrain posting', `A "completed" traverse on ${s.field.posting} m posts cannot certify drivability for a ${ctx.run.rover.wheelbase.toFixed(1)} m vehicle: obstacles at the vehicle's scale are absent from the data. The feasibility claim is rejected; the energy and slope-exposure estimates stand as regional screens.`);
    if (ctx.run && ctx.run.gravityBody !== s?.body) add('counterfactual', 'info', 'Counterfactual gravity', `Terrain of ${s?.body} under ${ctx.run.gravityBody} gravity: a controlled what-if, not a site on ${ctx.run.gravityBody}.`);
  }
  if (used.has('compare_sites') && ctx.compare && Math.max(...ctx.compare.nativePostingsM) / Math.min(...ctx.compare.nativePostingsM) > 4) add('compare-resolution', 'caution', 'Sites differ strongly in native resolution', `${ctx.compare.nativePostingsM[0]} m vs ${ctx.compare.nativePostingsM[1]} m. The comparison was made at ${ctx.compare.commonPostingM} m; anything finer exists for one site only.`);
  if (used.has('solar_access') && s?.sun && s.sun.duration < 86400 * 20 && s.body !== 'earth') add('sun-window', 'info', 'Short illumination record', `The Sun record covers ${(s.sun.duration / 86400).toFixed(1)} days; seasonal variation is not represented.`);
  if (used.has('candidate_space') && ctx.space && ctx.space.silhouette < 0.25) add('weak-clusters', 'caution', 'Weak cluster structure', `Silhouette ${ctx.space.silhouette.toFixed(2)}: the candidates form a continuum, so group labels are a convenience, not types.`);
  if (used.has('transfer_status') && ctx.atlas) add('atlas-scope', 'info', 'Scope of transferability', `ATLAS-Π evaluates ${ctx.atlas.sites.length} catalogued sites; other candidates have no task-level assessment.`);
  const verdict = out.some(f => f.severity === 'reject') ? 'rejected' : out.some(f => f.severity === 'caution') ? 'conditional' : recommends || used.has('mission_status') ? 'supported' : 'informational';
  return { findings: out.sort((a, b) => ['reject', 'caution', 'info'].indexOf(a.severity) - ['reject', 'caution', 'info'].indexOf(b.severity)), verdict };
}

export function describeContext(ctx: IntelContext): string {
  const parts: string[] = [];
  if (ctx.discovery) parts.push(`target ${ctx.discovery.target.id}`);
  if (activeWindow(ctx)) parts.push(`candidate ${activeWindow(ctx)}`);
  if (ctx.site) parts.push(`3D site ${ctx.site.id} (${ctx.site.field.posting} m)`);
  if (ctx.selection) parts.push(`point ${ctx.selection.x.toFixed(0)}, ${ctx.selection.y.toFixed(0)} m`);
  if (ctx.run) parts.push(`twin run ${ctx.run.fingerprint}`);
  if (ctx.compare) parts.push(`comparison ${ctx.compare.a.name} / ${ctx.compare.b.name}`);
  return parts.join(' · ') || 'nothing selected';
}
let counter = 0;
/** Plan → execute → review. Deterministic for a given question and workspace state. */
export function ask(question: string, ctx: IntelContext): IntelAnswer {
  const plan = planQuestion(question, ctx), results = plan.map(p => callIntel(ctx, p.tool, p.input)), { findings, verdict } = review(results, ctx);
  return { id: `q${++counter}`, question, plan, results, findings, verdict, context: describeContext(ctx) };
}
export const SUGGESTIONS = ['Which Kazakhstan regions are promising for rover mobility?', 'Why is this candidate ranked here?', 'Which assumptions influence this ranking the most?', 'What measurements would reduce uncertainty?', 'Describe the terrain of this site', 'How much direct Sun does this point get?', 'Design a mission scenario for this region', 'Where are the models least reliable?'];
