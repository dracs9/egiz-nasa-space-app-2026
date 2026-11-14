// Written with AI assistance (Codex); human review pending.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { pilotTestData, testData } from './data/testData';
import type { AppData } from './types/contracts';
import { useAppStore } from './state/store';
import { TwinPage } from './components/TwinPage';

vi.mock('./lib/useLiveCampaign', () => ({ useLiveCampaign: () => ({}) }));
vi.mock('./components/CampaignPage', () => ({ CampaignPage: () => <main><h1>Campaign</h1></main> }));
vi.mock('./components/MatrixPage', () => ({ MatrixPage: () => <main><h1>Matrix</h1></main> }));
vi.mock('./components/SiteDrawer', () => ({ SiteDrawer: () => null }));
let root: Root | null = null;
const docs = (data: AppData): Record<string, unknown> => ({ earth_candidates: data.candidates, targets: data.targets, mission_templates: data.templates, sun_windows: data.sun, results: data.results, validation: data.validation });
function fetcherFor(options: { pilotFails?: boolean; pilotGate?: Promise<void> } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('datasets.json')) return new Response(JSON.stringify({ version: '1.0.0', modes: ['demo', 'pilot'] }));
    if (url.includes('/pilot/')) {
      if (options.pilotGate) await options.pilotGate;
      if (options.pilotFails) return new Response('', { status: 404 });
    }
    const values = docs(url.includes('/pilot/') ? pilotTestData : testData);
    return new Response(JSON.stringify(values[url.split('/').pop()!.replace('.json', '')]));
  });
}
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function renderApp() { root = createRoot(document.getElementById('app-test')!); await act(async () => { root!.render(<App />); }); await flush(); }
async function chooseMode(mode: string) {
  await act(async () => {
    const select = document.querySelector<HTMLSelectElement>('select[aria-label="Dataset source"]');
    if (select) { select.value = mode; select.dispatchEvent(new Event('change', { bubbles: true })); }
    else { const disclosure = document.querySelector<HTMLDetailsElement>('.dataset-switch')!; disclosure.querySelector('summary')!.click(); disclosure.querySelector<HTMLButtonElement>(`[data-dataset-mode="${mode}"]`)!.click(); }
  });
  await flush();
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="app-test"></div>';
  window.localStorage.clear(); window.history.replaceState(null, '', '#/campaign?data=demo');
  useAppStore.setState({ data: null, dataMode: 'demo', selectedSite: null, route: 'campaign' });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener() {}, removeListener() {} })));
});
afterEach(async () => { if (root) { await act(async () => { root!.unmount(); }); root = null; } vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('explicit data source selection', () => {
  it('switches to measured terrain with a disclosure and real source state, then back to demo', async () => {
    vi.stubGlobal('fetch', fetcherFor()); await renderApp();
    expect(document.querySelector('.synthetic-banner')).not.toBeNull();
    await chooseMode('pilot');
    expect(document.querySelector('.synthetic-banner')).toBeNull();
    expect(document.querySelector('.measured-banner')?.textContent).toContain('9 Earth windows');
    expect(document.body.textContent).toContain('EXPLORATORY, UNVALIDATED');
    expect(useAppStore.getState().data?.candidates.synthetic).toBe(false);
    expect(useAppStore.getState().targetId).toBe('MOON_MONS_MOUTON');
    expect(window.location.hash).toContain('data=pilot');
    await chooseMode('demo');
    expect(document.querySelector('.synthetic-banner')).not.toBeNull();
    expect(useAppStore.getState().targetId).toContain('FAKE_');
  });
  it('shows the chosen source error and only resets to demo after an explicit action', async () => {
    vi.stubGlobal('fetch', fetcherFor({ pilotFails: true })); await renderApp(); await chooseMode('pilot');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Data failed to load');
    expect(useAppStore.getState().dataMode).toBe('pilot'); expect(useAppStore.getState().data).toBeNull();
    expect(document.querySelector('.synthetic-banner')).toBeNull();
    const reset = [...document.querySelectorAll('button')].find(button => button.textContent === 'Reset to synthetic demo')!;
    await act(async () => { reset.click(); }); await flush();
    expect(useAppStore.getState().dataMode).toBe('demo'); expect(document.querySelector('.synthetic-banner')).not.toBeNull();
  });
  it('ignores an older measured request that completes after the user returns to demo', async () => {
    let release!: () => void; const pilotGate = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal('fetch', fetcherFor({ pilotGate })); await renderApp(); await chooseMode('pilot');
    expect(useAppStore.getState().data).toBeNull();
    await chooseMode('demo'); release(); await flush();
    expect(useAppStore.getState().dataMode).toBe('demo'); expect(useAppStore.getState().data?.candidates.synthetic).toBe(true);
  });
  it('focuses a new route heading and closes the mobile menu with Escape', async () => {
    vi.stubGlobal('fetch', fetcherFor()); await renderApp();
    const toggle = document.querySelector<HTMLButtonElement>('#navigation-toggle')!;
    await act(async () => { toggle.click(); }); expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(toggle.getAttribute('aria-expanded')).toBe('false'); expect(document.activeElement).toBe(toggle);
    await act(async () => { [...document.querySelectorAll<HTMLButtonElement>('nav button')].find(button => button.textContent?.includes('Evidence'))!.click(); });
    expect(document.activeElement?.tagName).toBe('H1');
  });
});

it('never requests or displays synthetic Same-Sun assets in measured pilot mode', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  window.history.replaceState(null, '', '#/twin?data=pilot'); useAppStore.setState({ dataMode: 'pilot' });
  useAppStore.getState().initialize(pilotTestData, 'pilot');
  root = createRoot(document.getElementById('app-test')!);
  await act(async () => { root!.render(<TwinPage />); });
  expect(fetcher).not.toHaveBeenCalled(); expect(document.querySelectorAll('img')).toHaveLength(0);
  expect(document.body.textContent).toContain('Terrain renders are not loaded');
});
