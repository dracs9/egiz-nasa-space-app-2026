// EGIZ Planetary Studio · workspace state shared by every stage (Discover → Inspect → Simulate → Compare → Report).
// The investigation is persisted to localStorage on every change and can be exported, imported and reopened.
import { create } from 'zustand';
import type { XY } from '../../astral/world/field';
import type { AtlasBundle } from '../../atlas/types';
import type { DiscoveryBundle, ScoreShard, TargetEntry, ValidationDoc } from '../../discover/types';
import type { LayerSet } from '../compute';
import type { CompareCtx, IntelAnswer } from '../intel/engine';
import type { CandidateSpace } from '../intel/ml';
import type { Site, SiteRef } from '../terrain/site';
import { defaultConfig, type Experiment, type MissionPlan, type SensitivityRow, type TwinConfig, type TwinRun } from '../twin/twin';
import { newInvestigation, parseInvestigation, serializeInvestigation, type Investigation, type MarkRecord, type MeasureRecord, type SavedView, type StreamRef, type TrailKind, type JourneyStep, JOURNEY_STEPS } from './investigation';

export type Stage = 'discover' | 'inspect' | 'simulate' | 'compare' | 'report';
export const STAGES: { id: Stage; label: string; hint: string }[] = [
  { id: 'discover', label: 'Discover', hint: 'Find and rank Earth candidates for a planetary target' }, { id: 'inspect', label: 'Inspect', hint: 'Explore measured terrain, layers, light and measurements' },
  { id: 'simulate', label: 'Simulate', hint: 'Configure a rover, plan a traverse, run the digital twin' }, { id: 'compare', label: 'Compare', hint: 'Two sites side by side, quantified at a common resolution' },
  { id: 'report', label: 'Decide', hint: 'Evidence review, reproducible report, saved investigations' },
];
export type World = 'moon' | 'mars';
export const isWorld = (v: unknown): v is World => v === 'moon' || v === 'mars';
/** Default investigation site per world: the target with a packaged measured 3D terrain. */
export const DEFAULT_TARGET: Record<World, string> = { moon: 'MOON_MONS_MOUTON', mars: 'MARS_JEZERO' };
const missionTitle = (w: World) => (w === 'moon' ? 'Moon mission' : 'Mars mission');
export type Tool = 'inspect' | 'distance' | 'profile' | 'area' | 'mark-landing' | 'mark-science' | 'mark-hazard' | 'plan-start' | 'plan-destination' | 'plan-waypoint' | 'plan-hazard';
const KEY = 'egiz:planet:investigation:', INDEX = 'egiz:planet:index', LAST = 'egiz:planet:last';
const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const storage = { get(k: string) { try { return localStorage.getItem(k); } catch { return null; } }, set(k: string, v: string) { try { localStorage.setItem(k, v); return true; } catch { return false; } }, del(k: string) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } } };
export interface SavedEntry { id: string; title: string; updatedUtc: string }
function readIndex(): SavedEntry[] { try { const v = JSON.parse(storage.get(INDEX) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
function initial(): Investigation { const last = storage.get(LAST), text = last ? storage.get(KEY + last) : null; if (text) try { return parseInvestigation(text); } catch { /* fall through to a new record */ } return newInvestigation('Untitled investigation', now()); }

export interface PlanetState {
  stage: Stage; inv: Investigation; saved: SavedEntry[]; persisted: boolean;
  bundle: DiscoveryBundle | null; shard: ScoreShard | null; validation: ValidationDoc | null; atlas: AtlasBundle | null; discoveryError: string | null; space: CandidateSpace | null;
  refs: SiteRef[]; site: Site | null; siteStatus: 'idle' | 'loading' | 'ready' | 'error'; siteMessage: string; layers: LayerSet | null;
  selection: (XY & { h: number }) | null; tool: Tool; draft: XY[]; timeS: number;
  config: TwinConfig; plan: MissionPlan | null; run: TwinRun | null; baseline: TwinRun | null; sensitivity: SensitivityRow[] | null; running: string | null;
  compare: CompareCtx | null; intelOpen: boolean; panelOpen: boolean; notesOn: boolean; answers: IntelAnswer[];
  set(patch: Partial<PlanetState>): void; setStage(stage: Stage): void; patchInv(patch: Partial<Investigation>): void;
  target(): TargetEntry | null; weights(): Record<string, number>;
  /** The mission's world: chosen explicitly, or implied by the investigated target. */
  world(): World | null;
  /** Start (or continue) a mission on a world. A different world with work in progress opens a new record; the old one stays saved. */
  chooseWorld(world: World): void;
  /** Make a planetary target the investigated site (logged; the previous one is kept as an alternative considered). */
  investigate(targetId: string, how?: 'chosen' | 'switch'): void;
  log(kind: TrailKind, text: string, ref?: string): void;
  /** Record progress through the guided journey. */
  reach(step: JourneyStep): void; enterHome(): void;
  addMark(m: MarkRecord): void; removeMark(id: string): void; addMeasure(m: MeasureRecord): void; removeMeasure(id: string): void; addView(v: SavedView): void; removeView(id: string): void;
  toggleCandidate(id: string): void; saveExperiment(e: Experiment): void; removeExperiment(id: string): void; keepAnswer(a: IntelAnswer): void;
  setSiteRef(key: string | null, streamed: StreamRef | null): void; newInvestigation(title?: string): void; openInvestigation(id: string): string | null; importInvestigation(text: string): void; deleteInvestigation(id: string): void;
}
export const usePlanet = create<PlanetState>((set, get) => {
  const persist = (inv: Investigation) => {
    const ok = storage.set(KEY + inv.id, serializeInvestigation(inv));
    const index = [{ id: inv.id, title: inv.title, updatedUtc: inv.updatedUtc }, ...readIndex().filter(e => e.id !== inv.id)].slice(0, 30);
    if (ok) { storage.set(INDEX, JSON.stringify(index)); storage.set(LAST, inv.id); }
    return { saved: ok ? index : get().saved, persisted: ok };
  };
  const commit = (patch: Partial<Investigation>) => { const inv = { ...get().inv, ...patch, updatedUtc: now() }; set({ inv, ...persist(inv) }); };
  const load = (inv: Investigation) => set({ inv, ...persist(inv), run: null, baseline: null, sensitivity: null, plan: null, selection: null, draft: [], answers: inv.answers, compare: null });
  const first = initial();
  return {
    stage: 'discover', inv: first, saved: readIndex(), persisted: true,
    bundle: null, shard: null, validation: null, atlas: null, discoveryError: null, space: null,
    refs: [], site: null, siteStatus: 'idle', siteMessage: '', layers: null, selection: null, tool: 'inspect', draft: [], timeS: 0,
    config: defaultConfig('mars'), plan: null, run: null, baseline: null, sensitivity: null, running: null, compare: null, intelOpen: false, panelOpen: true, notesOn: false, answers: first.answers,
    set: patch => set(patch), setStage: stage => set({ stage, tool: 'inspect', draft: [] }), patchInv: commit,
    target() { const { bundle, inv } = get(), w = inv.world; return bundle?.targets.find(t => t.id === inv.target) ?? (w ? bundle?.targets.find(t => t.id === DEFAULT_TARGET[w]) : null) ?? bundle?.targets.find(t => t.id === 'MARS_JEZERO') ?? bundle?.targets[0] ?? null; },
    world() { const { inv, bundle } = get(); if (inv.world) return inv.world; const t = bundle?.targets.find(x => x.id === inv.target); return t ? t.body : null; },
    log(kind, text, ref) { commit({ trail: [...(get().inv.trail ?? []), { utc: now(), kind, text, ...(ref ? { ref } : {}) }].slice(-200) }); },
    chooseWorld(world) {
      const cur = get().inv; if (cur.world === world) return;
      const started = !!cur.target || cur.candidates.length > 0 || cur.experiments.length > 0 || !!cur.analysis;
      const body = cur.world ?? get().bundle?.targets.find(t => t.id === cur.target)?.body ?? null;
      // Another world is another mission: the current record stays saved and a new one begins.
      if (started && body !== world) load(newInvestigation(missionTitle(world), now(), uid('inv')));
      if (get().inv.title === 'Untitled investigation') commit({ title: missionTitle(world) });
      commit({ world }); get().log('world', `Chose ${world === 'moon' ? 'the Moon' : 'Mars'}`);
    },
    investigate(targetId, how = 'chosen') {
      const { inv, bundle } = get(), t = bundle?.targets.find(x => x.id === targetId); if (!t || inv.target === targetId) return;
      const prev = inv.target, considered = [...new Set([...(inv.considered ?? []), ...(prev ? [prev] : []), targetId])];
      commit({ target: targetId, world: t.body, weights: null, considered, siteName: t.name.split(' (')[0] });
      get().log(how === 'switch' ? 'switch' : 'target', how === 'switch' && prev ? `Switched the site from ${prev} to ${t.id} (${t.name})` : `Chose ${t.name} (${t.id}) as the mission site`, t.id);
    },
    reach(step) {
      const j = get().inv.journey, reached = [...new Set([...(j?.reached ?? []), step])].sort((a, b) => JOURNEY_STEPS.indexOf(a) - JOURNEY_STEPS.indexOf(b));
      if (j?.step === step && j.reached.length === reached.length) return;
      commit({ journey: { step, reached, homeUtc: j?.homeUtc ?? null } });
    },
    enterHome() { const j = get().inv.journey; if (j?.homeUtc) return; commit({ journey: { step: j?.step ?? 'analogs', reached: j?.reached ?? [], homeUtc: now() } }); get().log('decision', 'Opened Mission Home'); },
    weights() { const { bundle, inv } = get(); return inv.weights ?? { ...(bundle?.profiles[inv.profile]?.weights ?? bundle?.profiles.general?.weights ?? {}) }; },
    addMark: m => commit({ marks: [...get().inv.marks, m] }), removeMark: id => commit({ marks: get().inv.marks.filter(m => m.id !== id) }),
    addMeasure: m => commit({ measurements: [...get().inv.measurements, m] }), removeMeasure: id => commit({ measurements: get().inv.measurements.filter(m => m.id !== id) }),
    addView: v => commit({ views: [...get().inv.views, v] }), removeView: id => commit({ views: get().inv.views.filter(v => v.id !== id) }),
    toggleCandidate: id => { const c = get().inv.candidates, had = c.includes(id); commit({ candidates: had ? c.filter(x => x !== id) : [...c, id].slice(-8), analogsFor: get().inv.target }); get().log('candidate', had ? `Removed Earth analog ${id}` : `Kept Earth analog ${id}`, id); },
    saveExperiment: e => { commit({ experiments: [...get().inv.experiments.filter(x => x.id !== e.id), e] }); get().log('experiment', `Saved simulation “${e.name}” on ${e.site.id}: ${e.summary.outcome}`, e.id); }, removeExperiment: id => commit({ experiments: get().inv.experiments.filter(e => e.id !== id) }),
    keepAnswer: a => { if (!get().inv.answers.some(x => x.id === a.id && x.question === a.question)) commit({ answers: [...get().inv.answers, a].slice(-20) }); },
    setSiteRef: (siteKey, streamed) => commit({ siteKey, streamed }),
    newInvestigation: title => load(newInvestigation(title ?? 'Untitled investigation', now(), uid('inv'))),
    openInvestigation: id => { const text = storage.get(KEY + id); if (!text) return 'That investigation is no longer in this browser\'s storage.'; try { load(parseInvestigation(text)); return null; } catch (e) { return e instanceof Error ? e.message : String(e); } },
    importInvestigation: text => load(parseInvestigation(text)),
    deleteInvestigation: id => { storage.del(KEY + id); const index = readIndex().filter(e => e.id !== id); storage.set(INDEX, JSON.stringify(index)); set({ saved: index }); },
  };
});
export const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
