import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { BriefPage } from '../components/BriefPage';
import { pilotTestData, testData } from '../data/testData';
import { initialDataMode, MODE_STORAGE_KEY } from '../data/modes';
import { parseRoute, stateUrl, useAppStore } from './store';

beforeEach(() => { window.localStorage.clear(); window.history.replaceState(null, '', '#/campaign?data=demo'); useAppStore.setState({ dataMode: 'demo' }); vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); useAppStore.getState().initialize(testData); });
describe('URL state and mission brief', () => {
  it('defaults to Mons Mouton k3 and restores URL state', () => {
    expect(useAppStore.getState().targetId).toContain('MONS_MOUTON');
    const state = useAppStore.getState(); state.setK(2); state.setLens('kazakhstan'); state.focus(state.enabledObjectives[0]);
    expect(parseRoute(window.location.hash).query.get('lens')).toBe('kz');
    expect(parseRoute(window.location.hash).query.get('k')).toBe('2');
    expect(stateUrl(useAppStore.getState())).toBe(window.location.hash);
  });
  it('target changes clear site selection and reset objectives and weights', () => {
    const state = useAppStore.getState(); state.selectSite(testData.candidates.tiles[0].id); state.setWeights({ O1: 3 });
    state.setTarget(testData.targets.targets.find(t => t.body === 'mars')!.id);
    const next = useAppStore.getState(); expect(next.selectedSite).toBeNull(); expect(next.weights).toBeNull();
    expect(next.enabledObjectives).toEqual(testData.templates.templates.find(t => t.id === next.templateId)!.objectives.map(o => o.id));
  });
  it('preserves an intentionally empty objective list across URL restoration', async () => {
    const state = useAppStore.getState(); for (const id of state.enabledObjectives) state.toggleObjective(id);
    state.restoreUrl(); expect(useAppStore.getState().enabledObjectives).toEqual([]);
    document.body.innerHTML = '<div id="test-root"></div>';
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot(document.getElementById('test-root')!);
    await act(async () => { root.render(<BriefPage />); });
    const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'Find field sites');
    expect(button?.disabled).toBe(true);
    await act(async () => { root.unmount(); });
  });
  it('rejects unknown routes and invalid URL values without losing the app', () => {
    window.history.replaceState(null, '', '#/unknown?target=BAD&k=99&weights=O1:-4'); useAppStore.getState().restoreUrl();
    expect(useAppStore.getState().route).toBe('campaign'); expect(useAppStore.getState().k).toBe(3);
    expect(Object.values(useAppStore.getState().weights ?? {}).every(w => w >= 0 && w <= 3)).toBe(true);
  });
  it('switching sources clears stale mission state and ignores a superseded load', () => {
    const state = useAppStore.getState(); state.selectSite(testData.candidates.tiles[0].id); state.setWeights({ O1: 3 }); state.setLens('kazakhstan'); state.focus('O1');
    state.setDataMode('pilot');
    expect(useAppStore.getState()).toMatchObject({ data: null, dataMode: 'pilot', targetId: '', templateId: '', selectedSite: null, focusObjective: null, weights: null, lens: 'global' });
    expect(window.location.hash).toContain('data=pilot'); expect(window.location.hash).not.toContain('FAKE_');
    state.initialize(testData, 'demo'); expect(useAppStore.getState().data).toBeNull();
    state.initialize(pilotTestData, 'pilot');
    const next = useAppStore.getState();
    expect(next.targetId).toBe('MOON_MONS_MOUTON'); expect(next.enabledObjectives).toHaveLength(5); expect(next.data).toBe(pilotTestData);
    expect(window.localStorage.getItem(MODE_STORAGE_KEY)).toBe('pilot');
  });
  it('restores source-aware browser history and discards unknown selected sites', () => {
    useAppStore.getState().setDataMode('pilot'); useAppStore.getState().initialize(pilotTestData, 'pilot');
    window.history.replaceState(null, '', '#/matrix?data=demo&site=UNKNOWN'); useAppStore.getState().restoreUrl();
    expect(useAppStore.getState()).toMatchObject({ dataMode: 'demo', data: null, route: 'matrix' });
    useAppStore.getState().initialize(testData, 'demo'); expect(useAppStore.getState().selectedSite).toBeNull();
    window.history.replaceState(null, '', '#/evidence?data=pilot'); useAppStore.getState().restoreUrl();
    expect(useAppStore.getState()).toMatchObject({ dataMode: 'pilot', data: null, route: 'evidence' });
  });
  it('opens the measured pilot for a new visitor', () => {
    window.localStorage.clear(); window.history.replaceState(null, '', '#/campaign');
    expect(initialDataMode()).toBe('pilot');
  });
  it('prefers explicit source links over saved preference and safely rejects invalid mode links', () => {
    window.localStorage.setItem(MODE_STORAGE_KEY, 'pilot'); window.history.replaceState(null, '', '#/campaign'); expect(initialDataMode()).toBe('pilot');
    window.history.replaceState(null, '', '#/campaign?data=demo'); expect(initialDataMode()).toBe('demo');
    window.history.replaceState(null, '', '#/campaign?data=private'); expect(initialDataMode()).toBe('demo');
  });
});
