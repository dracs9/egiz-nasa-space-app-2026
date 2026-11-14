// @vitest-environment node
// Intelligence: copilot grammar, tool validation, grounded answers, NL mission parsing, registry, retrieval,
// data quality, and the end-to-end mission rehearsal workflow with a reproducible dossier.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadTestWorld, WORLD_DIR } from './testing';
import type { World } from './core/world';
import { askLocal, planCalls } from './intelligence/copilot';
import { callTool, type StudioAction, type ToolCallLog, type ToolContext, type PlanState } from './intelligence/tools';
import { parseMissionRequest } from './intelligence/nlMission';
import { searchKnowledge, KNOWLEDGE } from './intelligence/knowledge';
import { BROWSER_MODELS, mergeRegistry } from './intelligence/registry';
import { runQualityChecks } from './intelligence/quality';
import { defaultMission, validateMission, type MissionSpec } from './sim/mission';
import { executePlan } from './sim/pipeline';
import { simulate } from './sim/traverse';
import { buildDossier, simulationHashes } from './report/dossier';
import type { PlanningGrid } from './sim/planner';

let w: World;
beforeAll(async () => { w = await loadTestWorld(); await w.ensureOperational(); }, 60000);

function makeCtx(over: Partial<ToolContext> = {}) {
  const actions: StudioAction[] = [];
  let grid: PlanningGrid | null = null;
  const state: { mission: MissionSpec; plan: PlanState | null; activeRouteId: string | null; time: number } = { mission: defaultMission(w), plan: null, activeRouteId: null, time: 543600 };
  const ctx: ToolContext = {
    world: w, selection: null, get mission() { return state.mission; }, get plan() { return state.plan; }, get activeRouteId() { return state.activeRouteId; }, get time() { return state.time; },
    viewTarget: { x: -1500, y: 2000 }, atlas: null, slopeLimit: 15,
    apply: a => { actions.push(a); if (a.type === 'mission') state.mission = a.spec; if (a.type === 'activeRoute') state.activeRouteId = a.id; if (a.type === 'time') state.time = a.t; },
    planMission: async spec => { const r = await executePlan(w, spec, grid); grid = r.grid; state.plan = r.result; state.activeRouteId = r.result.routes.find(x => x.feasible)?.id ?? null; return r.result; },
    simulateVariant: (spec, route) => simulate(w, spec, route, {}),
    dossier: async () => buildDossier({ world: w, spec: state.plan!.spec, validation: state.plan!.validation, routes: state.plan!.routes, sims: state.plan!.sims, activeRouteId: state.activeRouteId, copilotLog: [], routeChecks: state.plan!.checks }),
    fetchTileRaw: async key => { const b = await readFile(join(WORLD_DIR, `tiles/${key}.egt`)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; },
    ...over,
  };
  return { ctx, actions, state };
}

describe('copilot grammar → typed tool calls', () => {
  const plan = (t: string, sel: ToolContext['selection'] = null) => planCalls(t, { selection: sel, plan: null }).map(c => c.tool);
  it.each([
    ['Fly to crater-0005', ['set_view']],
    ['Show all terrain slopes above 20 degrees', ['set_view', 'find_features']],
    ['Highlight possible boulder fields', ['find_features']],
    ['Identify the most interesting geological structures in this area and highlight potential rover hazards', ['find_features']],
    ['Plan a rover survey starting at the western landing area, avoiding slopes above 18 degrees, prioritizing geological diversity, and preserving 25% energy reserve', ['propose_mission', 'plan_routes']],
    ['Start a rover simulation', ['run_simulation']],
    ['Change the solar time to local noon', ['set_time']],
    ['What changes if the rover has a smaller energy budget?', ['what_if']],
    ['Find evidence contradicting this assessment', ['red_team']],
    ['What measurements are missing?', ['data_quality']],
    ['Compare this area with Boszhira', ['compare_analog']],
    ['Generate a report', ['generate_dossier']],
  ])('%s', (text, tools) => { expect(plan(text)).toEqual(tools); });
  it('uses the selection as context', () => {
    expect(plan('Explain the geological structure of this area', { kind: 'object', id: 'crater-0005' })).toEqual(['describe_object']);
    expect(plan('Explain this location', { kind: 'point', x: 0, y: 0 })).toEqual(['describe_location']);
  });
  it('declines unknown requests and unsupported targets instead of guessing', async () => {
    const { ctx } = makeCtx();
    const a = await askLocal('Write me a poem about the sea', ctx);
    expect(a.declined).toBeTruthy(); expect(a.tools).toHaveLength(0);
    const j = await askLocal('Fly to Jezero', ctx);
    expect(j.declined).toMatch(/Jezero/);
  });
});

describe('tool validation and grounding', () => {
  it('rejects non-allowlisted tools and invalid arguments', async () => {
    const { ctx } = makeCtx(); const log: ToolCallLog[] = [];
    expect((await callTool(ctx, 'run_shell', { cmd: 'rm -rf /' }, log)).ok).toBe(false);
    expect((await callTool(ctx, 'describe_object', { id: '../../etc/passwd' }, log)).summary).toMatch(/Invalid arguments/);
    expect((await callTool(ctx, 'describe_location', { x: 1e9, y: 0 }, log)).ok).toBe(false);
    expect(log).toHaveLength(3); expect(log.every(l => !l.ok)).toBe(true);
  });
  it('reports measured elevation identical to the world model and labels unknowns', async () => {
    const { ctx } = makeCtx(); const log: ToolCallLog[] = [];
    const r = await callTool(ctx, 'describe_location', { x: -1600, y: 2100 }, log);
    const elev = r.facts.find(f => f.label === 'Elevation')!;
    expect(elev.cls).toBe('measured'); expect(elev.value).toContain(w.heightAt(-1600, 2100)!.toFixed(1));
    expect(r.facts.find(f => f.label.startsWith('Geologic'))!.cls).toBe('unknown');
  });
  it('never claims boulder detection from a 5 m DEM', async () => {
    const { ctx } = makeCtx();
    const r = await callTool(ctx, 'find_features', { kind: 'boulders' }, []);
    expect(r.facts[0].cls).toBe('unknown'); expect(r.facts[0].value).toMatch(/not possible/);
  });
  it('lists detections with model labels and highlights them', async () => {
    const { ctx, actions } = makeCtx();
    const r = await callTool(ctx, 'find_features', { kind: 'craters', region: 'operational' }, []);
    expect(r.ok).toBe(true); expect(r.facts.every(f => f.cls === 'model')).toBe(true);
    expect(actions.some(a => a.type === 'highlight')).toBe(true);
  });
  it('produces structured, falsifiable hypotheses (not discoveries)', async () => {
    const { ctx } = makeCtx(); const id = w.objects.find(o => o.type === 'anomaly')!.id;
    const r = await callTool(ctx, 'hypothesis', { id }, []);
    expect(r.summary).toMatch(/HYPOTHESIS/);
    for (const k of ['Observation', 'Interpretation', 'Counter-evidence', 'Alternative explanation', 'Testable prediction', 'Falsification condition', 'Required measurement']) expect(r.facts.some(f => f.label === k)).toBe(true);
  });
});

describe('natural language → validated mission', () => {
  it('parses the reference request into a valid specification', () => {
    const r = parseMissionRequest('Plan a rover survey starting at the western landing area, avoiding slopes above 18 degrees, prioritizing geological diversity, and preserving 25% energy reserve', defaultMission(w), w, { selection: null });
    expect(r.spec.constraints.maxSlopeDeg).toBe(18); expect(r.spec.constraints.minReserveFrac).toBe(0.25);
    expect(r.spec.waypoints.length).toBe(3); expect(r.spec.start.x).toBeLessThan(w.operationalBox[0] + 1000);
    expect(new Set(r.spec.waypoints.map(p => w.unitAt(p.x, p.y)?.id)).size).toBeGreaterThan(1);
    expect(validateMission(r.spec, w).ok).toBe(true);
    expect(r.spec.provenance.createdBy).toBe('local-parser');
  });
  it('reports what it did not understand', () => {
    const r = parseMissionRequest('Survey with three science stops and also bring back a llama for the museum display', defaultMission(w), w, { selection: null });
    expect(r.spec.provenance.notes.some(n => n.startsWith('Not understood'))).toBe(true);
  });
});

describe('registry, retrieval and data quality', () => {
  it('registers models honestly', () => {
    const all = mergeRegistry(w.registry, false);
    expect(all.find(m => m.id === 'ibm-nasa.prithvi-eo-2.0')!.status).toContain('incompatible');
    expect(all.find(m => m.id === 'remote.llm.anthropic')!.status).toEqual(['unavailable']);
    expect(mergeRegistry(w.registry, true).find(m => m.id === 'remote.llm.anthropic')!.status).toContain('inference_ready');
    for (const m of [...w.registry, ...BROWSER_MODELS]) { expect(m.evaluation.length).toBeGreaterThan(10); expect(m.limitations.length).toBeGreaterThan(0); }
  });
  it('retrieves only curated sources', () => {
    expect(searchKnowledge('wheel slip drawbar terramechanics')[0].entry.id).toMatch(/wongreece1967|janosi1961|bekker1969/);
    expect(searchKnowledge('polar illumination shadow horizon')[0].entry.id).toBe('mazarico2011');
    expect(searchKnowledge('quantum chromodynamics lattice gauge')).toEqual([]);
    expect(KNOWLEDGE.every(k => k.citation.length > 10)).toBe(true);
  });
  it('passes automated data-quality checks on the packaged world', async () => {
    const { ctx } = makeCtx();
    const checks = await runQualityChecks(w, ctx.fetchTileRaw);
    for (const id of ['tile-hash', 'seams', 'range', 'spice']) expect(checks.find(c => c.id === id)!.status).toBe('pass');
    expect(checks.find(c => c.id === 'horizon')!.status).toBe('warn');
  });
});

describe('end-to-end mission rehearsal (Section 8 workflow)', () => {
  it('ask → mission → plan → simulate → what-if → explain → dossier → reproduce', async () => {
    const { ctx, actions, state } = makeCtx();
    const interp = await askLocal('Identify the most interesting geological structures in this area and highlight potential rover hazards', ctx);
    expect(interp.sections[0].ok).toBe(true);
    const mission = await askLocal('Plan a rover survey starting at the western landing area, avoiding slopes above 18 degrees, prioritizing geological diversity, and preserving 25% energy reserve', ctx);
    expect(mission.tools.map(t => t.tool)).toEqual(['propose_mission', 'plan_routes']);
    expect(mission.tools.every(t => t.ok)).toBe(true);
    expect(state.plan!.spec.constraints.maxSlopeDeg).toBe(18);
    expect(state.plan!.routes.filter(r => r.feasible).length).toBeGreaterThanOrEqual(3);
    const sim = await askLocal('Start a rover simulation', ctx);
    expect(sim.sections[0].ok).toBe(true); expect(actions.some(a => a.type === 'play')).toBe(true);
    const whatIf = await askLocal('What changes if the rover has a smaller energy budget?', ctx);
    expect(whatIf.sections[0].facts.find(f => f.label === 'Minimum SoC')!.value).toMatch(/→/);
    expect((await askLocal('Why was this route selected?', ctx)).sections[0].ok).toBe(true);
    expect((await askLocal('Find evidence contradicting this assessment', ctx)).sections[0].facts.length).toBeGreaterThan(3);
    const noon = await askLocal('Change the solar time to local noon', ctx);
    expect(noon.sections[0].ok).toBe(true);
    const dossier = await ctx.dossier();
    expect(dossier.markdown).toMatch(/Reproducibility/);
    const repro = dossier.json.reproducibility as { inputHash: string; outputHash: string };
    expect(repro.inputHash).toMatch(/^[a-f0-9]{64}$/);
    const plan = state.plan!, route = plan.routes.find(r => r.id === state.activeRouteId)!;
    const again = simulate(w, plan.spec, route, {});
    expect((await simulationHashes(w, plan.spec, route, again)).outputHash).toBe(repro.outputHash);
  }, 120000);
});
