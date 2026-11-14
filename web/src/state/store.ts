// Written with AI assistance (Codex); human review pending.
import { create } from 'zustand';
import type { AppData } from '../types/contracts';
import { initialDataMode, isDataMode, rememberDataMode, type DataMode } from '../data/modes';

export type Route = 'brief' | 'campaign' | 'matrix' | 'evidence' | 'twin' | 'lab';
export interface AppState {
  data: AppData | null; dataMode: DataMode; route: Route; targetId: string; templateId: string;
  enabledObjectives: string[]; weights: Record<string, number> | null;
  k: 1 | 2 | 3; focusObjective: string | null; selectedSite: string | null; lens: 'global' | 'kazakhstan';
  initialize(data: AppData, mode?: DataMode): void; restoreUrl(): void; navigate(route: Route): void;
  setDataMode(mode: DataMode): void;
  setTarget(id: string): void; toggleObjective(id: string): void; setWeights(weights: Record<string, number> | null): void;
  setK(k: 1 | 2 | 3): void; focus(id: string | null): void; selectSite(id: string | null): void; setLens(lens: 'global' | 'kazakhstan'): void;
}
const routes = ['brief', 'campaign', 'matrix', 'evidence', 'twin', 'lab'];
export function parseRoute(hash: string): { route: Route; query: URLSearchParams } {
  const [raw, query = ''] = hash.replace(/^#\/?/, '').split('?');
  return { route: (routes.includes(raw) ? raw : raw === '' ? 'lab' : 'campaign') as Route, query: new URLSearchParams(query) };
}
function urlState(data: AppData): Partial<AppState> {
  const { route, query } = parseRoute(window.location.hash);
  const target = data.targets.targets.find(t => t.id === query.get('target')) ?? data.targets.targets.find(t => t.name.includes('Mons Mouton')) ?? data.targets.targets[0];
  const template = data.templates.templates.find(t => t.id === query.get('template') && t.body === target.body) ?? data.templates.templates.find(t => target.templates.includes(t.id)) ?? data.templates.templates.find(t => t.body === target.body)!;
  const objectives = template.objectives.map(o => o.id);
  const enabled = query.has('enabled') ? (query.get('enabled') ?? '').split(',').filter(o => objectives.includes(o)) : objectives;
  const k = Number(query.get('k'));
  const weights = Object.fromEntries(template.objectives.map(o => [o.id, o.weight_default]));
  if (query.has('weights')) for (const pair of query.get('weights')!.split(',')) {
    const [id, value] = pair.split(':'); const n = Number(value);
    if (objectives.includes(id) && Number.isFinite(n) && n >= 0 && n <= 3) weights[id] = n;
  }
  const site = query.get('site');
  return { route, targetId: target.id, templateId: template.id, enabledObjectives: enabled, weights: query.has('weights') ? weights : null, k: [1, 2, 3].includes(k) ? k as 1 | 2 | 3 : 3, focusObjective: objectives.includes(query.get('obj') ?? '') ? query.get('obj') : null, selectedSite: data.candidates.tiles.some(tile => tile.id === site) ? site : null, lens: query.get('lens') === 'kz' ? 'kazakhstan' : 'global' };
}
export function stateUrl(state: AppState): string {
  const q = new URLSearchParams({ data: state.dataMode, k: String(state.k) });
  if (state.targetId) q.set('target', state.targetId);
  if (state.templateId) { q.set('template', state.templateId); q.set('enabled', state.enabledObjectives.join(',')); }
  if (state.weights) q.set('weights', Object.entries(state.weights).map(([id, w]) => `${id}:${w}`).join(','));
  if (state.focusObjective) q.set('obj', state.focusObjective);
  if (state.selectedSite) q.set('site', state.selectedSite);
  if (state.lens === 'kazakhstan') q.set('lens', 'kz');
  return `#/${state.route}?${q.toString()}`;
}
const clearedMission = { data: null, targetId: '', templateId: '', enabledObjectives: [] as string[], weights: null, k: 3 as const, focusObjective: null, selectedSite: null, lens: 'global' as const };
export const useAppStore = create<AppState>((set, get) => {
  const update = (patch: Partial<AppState>, push = false) => {
    set(patch); const url = stateUrl(get());
    if (push) window.history.pushState(null, '', url); else window.history.replaceState(null, '', url);
  };
  return {
    ...clearedMission, dataMode: initialDataMode(), route: 'lab',
    initialize(data, mode = get().dataMode) {
      if (mode !== get().dataMode) return; // A slower, superseded request cannot restore old observations.
      set({ data, ...urlState(data) }); rememberDataMode(mode); window.history.replaceState(null, '', stateUrl(get()));
    },
    setDataMode(mode) {
      if (!isDataMode(mode) || mode === get().dataMode) return;
      rememberDataMode(mode); update({ ...clearedMission, dataMode: mode }, true);
    },
    restoreUrl() {
      const { query, route } = parseRoute(window.location.hash);
      const mode = isDataMode(query.get('data')) ? query.get('data') as DataMode : query.has('data') ? 'demo' : 'pilot';
      if (mode !== get().dataMode) { rememberDataMode(mode); set({ ...clearedMission, dataMode: mode, route }); return; }
      const data = get().data; if (data) set(urlState(data));
    },
    navigate(route) { update({ route }, true); window.scrollTo({ top: 0 }); },
    setTarget(id) {
      const data = get().data; const target = data?.targets.targets.find(t => t.id === id); if (!data || !target) return;
      const template = data.templates.templates.find(t => target.templates.includes(t.id)) ?? data.templates.templates.find(t => t.body === target.body)!;
      update({ targetId: id, templateId: template.id, enabledObjectives: template.objectives.map(o => o.id), weights: null, focusObjective: null, selectedSite: null });
    },
    toggleObjective(id) { const current = get().enabledObjectives; update({ enabledObjectives: current.includes(id) ? current.filter(o => o !== id) : [...current, id] }); },
    setWeights(weights) { update({ weights }); }, setK(k) { update({ k }); },
    focus(id) { update({ focusObjective: id }); }, selectSite(id) { update({ selectedSite: id }); }, setLens(lens) { update({ lens, selectedSite: null }); },
  };
});
