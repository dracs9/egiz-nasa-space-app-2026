// Natural-language → typed MissionSpec (deterministic). Every recognised clause is recorded in the
// spec's provenance notes; unrecognised text is reported, never guessed. The output still has to
// pass validateMission before planning.
import type { MapPoint } from '../core/types';
import type { World } from '../core/world';
import { cloneMission, nearestGentle, type MissionSpec, type RouteObjective, type Waypoint } from '../sim/mission';
import { ROVERS } from '../sim/rover';

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, a: 1, single: 1, couple: 2, several: 3 };
const num = (s: string) => (/^\d+(\.\d+)?$/.test(s) ? Number(s) : WORDS[s.toLowerCase()] ?? NaN);

export interface ParseContext { selection: MapPoint | null; selectionLabel?: string }
export interface ParseResult { spec: MissionSpec; recognised: string[]; ignored: string[]; scienceStrategy: 'diversity' | 'craters' | 'none'; stopCount: number }

function sidePoint(world: World, side: string): MapPoint {
  const [w, s, e, n] = world.operationalBox, cx = (w + e) / 2, cy = (s + n) / 2, inset = 500;
  const p = side.startsWith('west') ? { x: w + inset, y: cy + 600 } : side.startsWith('east') ? { x: e - inset, y: cy + 600 } : side.startsWith('north') ? { x: cx, y: n - inset } : { x: cx, y: s + inset };
  return p;
}

export function parseMissionRequest(text: string, base: MissionSpec, world: World, ctx: ParseContext): ParseResult {
  const spec = cloneMission(base), t = text.toLowerCase(), recognised: string[] = [];
  spec.waypoints = [];
  spec.provenance = { createdBy: 'local-parser', request: text, notes: [] };
  const gentle = (p: MapPoint) => nearestGentle(world, p, Math.min(8, spec.constraints.maxSlopeDeg * 0.6)) ?? p;
  let m: RegExpMatchArray | null;
  if ((m = t.match(/slopes?\s+(?:above|over|greater than|steeper than|exceeding|beyond|>)\s*(\d+(?:\.\d+)?)\s*(?:°|deg|degrees?)?/)) || (m = t.match(/max(?:imum)?\s+slope\s+(?:of\s+)?(\d+(?:\.\d+)?)/))) {
    spec.constraints.maxSlopeDeg = Number(m[1]); spec.constraints.maxCrossSlopeDeg = Math.min(Number(m[1]), spec.constraints.maxCrossSlopeDeg > Number(m[1]) ? Number(m[1]) : spec.constraints.maxCrossSlopeDeg);
    recognised.push(`maximum slope ${m[1]}°`);
  }
  if ((m = t.match(/(\d+(?:\.\d+)?)\s*%\s*(?:of\s+)?(?:energy|battery)?\s*reserve/)) || (m = t.match(/reserve\s+(?:of\s+)?(\d+(?:\.\d+)?)\s*%/))) {
    spec.constraints.minReserveFrac = Number(m[1]) / 100; recognised.push(`energy reserve ${m[1]} %`);
  }
  let stopCount = 0;
  if ((m = t.match(/(\d+|one|two|three|four|five|six|seven|eight|a|single|couple|several)\s+(?:science|scientific|sampling|observation)\s+(?:stops?|targets?|sites?|waypoints?)/))) { stopCount = Math.min(8, num(m[1])); recognised.push(`${stopCount} science stops`); }
  let scienceStrategy: ParseResult['scienceStrategy'] = stopCount ? 'diversity' : 'none';
  if (/geolog\w*\s+divers|divers\w*|different\s+(?:units|terrain)/.test(t)) { scienceStrategy = 'diversity'; if (!stopCount) stopCount = 3; recognised.push('prioritise geomorphometric diversity (unit coverage)'); }
  if (/crater\s+rims?|impact\s+ejecta|craters?\s+(?:as|for)\s+(?:science|targets)/.test(t)) { scienceStrategy = 'craters'; if (!stopCount) stopCount = 3; recognised.push('science stops at detected crater rims'); }
  const objective: [RegExp, RouteObjective, string][] = [
    [/minimi[sz]e\s+(?:terrain\s+)?risk|safest|lowest\s+risk|avoid\w*\s+hazards?/, 'safest', 'objective: lowest terrain risk'],
    [/lowest\s+energy|minimi[sz]e\s+energy|energy[-\s]efficient|save\s+energy/, 'energy', 'objective: lowest energy'],
    [/shortest|fastest|minimi[sz]e\s+distance/, 'shortest', 'objective: shortest'],
    [/(?:best|most|maximi[sz]e)\s+(?:sun|illumination|sunlight|light)|stay\s+in\s+(?:the\s+)?sun|sunlit/, 'illumination', 'objective: best illumination'],
  ];
  for (const [re, o, label] of objective) if (re.test(t)) { spec.preferred = o; recognised.push(label); break; }
  if ((m = t.match(/(?:start(?:ing)?|begin(?:ning)?|depart(?:ing)?|from)\s+(?:at\s+|from\s+)?(?:the\s+)?(west|east|north|south)(?:ern)?\s*(?:landing\s+area|landing\s+site|edge|side|area|part)?/))) {
    spec.start = gentle(sidePoint(world, m[1])); recognised.push(`start: ${m[1]}ern part of the operational box`);
  }
  if ((m = t.match(/(?:to|towards|toward|end(?:ing)?\s+at|destination)\s+(?:the\s+)?(west|east|north|south)(?:ern)?\s*(?:edge|side|area|part|plateau)?/))) {
    spec.destination = gentle(sidePoint(world, m[1])); spec.returnToStart = false; recognised.push(`destination: ${m[1]}ern part of the operational box`);
  }
  if ((m = t.match(/(?:to|towards|toward|at)\s+(crater-\d{4}|anomaly-\d{3})/))) {
    const o = world.object(m[1]);
    if (o) { const dir = Math.atan2(spec.start.y - o.y, spec.start.x - o.x); spec.destination = gentle({ x: o.x + Math.cos(dir) * o.radius * 1.25, y: o.y + Math.sin(dir) * o.radius * 1.25 }); recognised.push(`destination: outside the rim of ${o.id}`); }
  }
  if (/(?:to|towards)\s+(?:this|the\s+selected|my\s+selected)\s+(?:point|location|site|crater|target|feature|observation\s+point)/.test(t) && ctx.selection) {
    spec.destination = gentle(ctx.selection); spec.returnToStart = false; recognised.push(`destination: selected ${ctx.selectionLabel ?? 'location'}`);
  }
  if (/return(?:ing)?\s+(?:to\s+)?(?:the\s+)?(?:start|base|lander|landing)|round[-\s]trip|loop/.test(t)) { spec.returnToStart = true; spec.destination = null; recognised.push('return to start'); }
  if (/heavy|six[-\s]wheel|lr-?6/.test(t)) { spec.roverId = 'egiz-lr6'; recognised.push(`rover: ${ROVERS[1].name}`); }
  else if (/lr-?1|light|four[-\s]wheel|prospector/.test(t)) { spec.roverId = 'egiz-lr1'; recognised.push(`rover: ${ROVERS[0].name}`); }
  if (/loose|soft\s+(?:soil|regolith)|fluffy/.test(t)) { spec.soilId = 'lunar-loose'; recognised.push('regolith: loose sensitivity case'); }
  else if (/firm|compact\w*\s+(?:soil|regolith)|hard\s+(?:soil|ground)/.test(t)) { spec.soilId = 'lunar-firm'; recognised.push('regolith: compacted sensitivity case'); }
  if (/detailed|wong|high[-\s]fidelity/.test(t)) { spec.fidelity = 'detailed'; recognised.push('detailed Wong–Reece terramechanics'); }
  if ((m = t.match(/(\d+(?:\.\d+)?)\s*(?:wh|watt[-\s]?hours?)\b/))) { spec.roverOverrides.batteryWh = Number(m[1]); recognised.push(`battery ${m[1]} Wh`); }
  if ((m = t.match(/(\d+)\s*(?:min|minutes?)\s+(?:per|at\s+each|each)\s+stop/))) recognised.push(`dwell ${m[1]} min per stop`);
  const dwell = m ? Number(m[1]) * 60 : 1800;
  const drill = /drill|sample|sampling|subsurface/.test(t);
  if (stopCount > 0) {
    spec.waypoints = chooseScienceStops(world, spec, stopCount, scienceStrategy, dwell, drill);
    recognised.push(`${spec.waypoints.length} science stops selected (${scienceStrategy})`);
  }
  // Report clauses that carried content but matched nothing.
  const ignored = text.split(/[,.;]|\band\b/i).map(s => s.trim()).filter(s => s.length > 12 && !recognised.some(r => r.split(/\s+/).some(w => w.length > 4 && s.toLowerCase().includes(w.toLowerCase()))))
    .filter(s => !/^(plan|create|design|build|make)\b/i.test(s) || s.split(/\s+/).length > 6);
  spec.provenance.notes = [...recognised.map(r => `Parsed: ${r}`), ...ignored.map(s => `Not understood: “${s}”`)];
  return { spec, recognised, ignored, scienceStrategy, stopCount };
}

/** Greedy science-stop selection: maximise newly visited terrain units (or crater rims) near the start→end corridor. */
export function chooseScienceStops(world: World, spec: MissionSpec, count: number, strategy: 'diversity' | 'craters' | 'none', dwellS: number, drill: boolean): Waypoint[] {
  const start = spec.start, end = spec.destination ?? spec.start;
  const [w, s, e, n] = world.operationalBox;
  const corridor = (p: MapPoint) => {
    const vx = end.x - start.x, vy = end.y - start.y, L2 = vx * vx + vy * vy;
    const f = L2 ? Math.max(0, Math.min(1, ((p.x - start.x) * vx + (p.y - start.y) * vy) / L2)) : 0;
    return Math.hypot(p.x - (start.x + f * vx), p.y - (start.y + f * vy));
  };
  const limit = Math.min(10, spec.constraints.maxSlopeDeg * 0.6);
  type Cand = { p: MapPoint; unit: number | null; label: string; ref?: string; why: string };
  const cands: Cand[] = [];
  if (strategy === 'craters') {
    for (const o of world.objects) if (o.type === 'crater' && (o.confidence ?? 0) >= 0.5 && o.x > w + 200 && o.x < e - 200 && o.y > s + 200 && o.y < n - 200) {
      const dir = Math.atan2((start.y + end.y) / 2 - o.y, (start.x + end.x) / 2 - o.x);
      const p = nearestGentle(world, { x: o.x + Math.cos(dir) * o.radius * 1.15, y: o.y + Math.sin(dir) * o.radius * 1.15 }, limit, 120);
      if (p) cands.push({ p, unit: world.unitAt(p.x, p.y)?.id ?? null, label: `Rim of ${o.id}`, ref: o.id, why: `outside the rim of ${o.id} (D ≈ ${Math.round(Number(o.properties.diameter_m))} m, score ${o.confidence}) — ejecta access, model-detected crater` });
    }
  } else {
    for (let x = w + 250; x < e - 200; x += 240) for (let y = s + 250; y < n - 200; y += 240) {
      const u = world.unitAt(x, y);
      if (!u) continue;
      cands.push({ p: { x, y }, unit: u.id, label: `${u.label} sample`, why: `terrain unit ${u.label} (${u.descriptor}; unsupervised geomorphometric class)` });
    }
  }
  const chosen: Cand[] = [], seen = new Set<number>();
  const width = Math.max(600, Math.hypot(end.x - start.x, end.y - start.y) * 0.35);
  for (let k = 0; k < count; k++) {
    let best: Cand | null = null, bestScore = -Infinity;
    for (const c of cands) {
      const d = corridor(c.p);
      if (d > width || chosen.includes(c) || chosen.some(q => Math.hypot(q.p.x - c.p.x, q.p.y - c.p.y) < 300) || Math.hypot(c.p.x - start.x, c.p.y - start.y) < 200) continue;
      const novelty = c.unit !== null && !seen.has(c.unit) ? 1 : 0.15;
      const score = novelty * 2 - d / width;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (!best) break;
    const p = strategy === 'craters' ? best.p : nearestGentle(world, best.p, limit, 150);
    if (!p) { cands.splice(cands.indexOf(best), 1); k--; continue; }
    best.p = p; chosen.push(best); if (best.unit !== null) seen.add(best.unit);
  }
  return chosen.map((c, i) => ({ id: `wp-${i + 1}`, x: c.p.x, y: c.p.y, dwellS, label: `S${i + 1} · ${c.label}`, instrumentIds: drill ? ['nss', 'nirvss', 'drill', 'cams'] : ['nss', 'nirvss', 'cams'], objectRef: c.ref, rationale: `Selected because: ${c.why}; ${Math.round(corridor(c.p))} m from the start–destination corridor.` }));
}
