// Regression checks for incomplete evidence and blocked clipboard access.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { MatrixPage } from './MatrixPage';
import { SiteDrawer } from './SiteDrawer';
import type { CampaignModel } from './CampaignPage';
import { testData } from '../data/testData';
import { useAppStore } from '../state/store';

let root: Root | null = null;
afterEach(async () => {
  if (root) { await act(async () => root!.unmount()); root = null; }
  vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = '';
});

function setup() {
  localStorage.clear(); window.history.replaceState(null, '', '#/matrix?data=demo');
  const data = structuredClone(testData);
  const tiles = data.candidates.tiles.filter(t => t.pool !== 'control').slice(0, 4);
  data.candidates.tiles = tiles;
  useAppStore.getState().initialize(data);
  const state = useAppStore.getState();
  const run = data.results.runs.find(r => r.target === state.targetId && r.template === state.templateId)!;
  const template = data.templates.templates.find(t => t.id === state.templateId)!;
  for (const objective of template.objectives) {
    const parts = Object.fromEntries(objective.attributes.map(a => [a.attr, .5]));
    run.fidelity[objective.id] = {
      [tiles[0].id]: { F: .5, partial: false, parts },
      [tiles[1].id]: { F: .5, partial: true, parts },
      [tiles[2].id]: { F: null, reason: 'missing' },
      [tiles[3].id]: { F: .5, partial: false },
    };
  }
  run.campaigns.forEach(c => { c.sites = []; });
  const model: CampaignModel = { run, template, campaigns: run.campaigns, globalCampaigns: run.campaigns, pending: false, error: null, live: false, ms: 0 };
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<button id="origin">Open dossier</button><div id="test-root"></div>';
  root = createRoot(document.getElementById('test-root')!);
  return { model, tiles };
}

it('hides both partial and missing rows when full evidence is requested, and focuses opened cell evidence', async () => {
  const { model } = setup();
  await act(async () => root!.render(<MatrixPage model={model} />));
  expect(document.querySelectorAll('tbody tr')).toHaveLength(4);
  await act(async () => (document.querySelector('input[type=checkbox]') as HTMLInputElement).click());
  expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
  const cell = document.querySelector('.matrix-cell') as HTMLButtonElement;
  await act(async () => cell.click());
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Selected attribute evidence');
  expect(document.querySelector('[aria-label="Scrollable attribute fidelity matrix"]')?.getAttribute('tabindex')).toBe('0');
  await act(async () => (document.querySelector('[aria-label="Close cell evidence"]') as HTMLButtonElement).click());
  expect(document.activeElement).toBe(cell);
});

it('offers a copyable URL when clipboard permission is denied, and restores focus after Escape', async () => {
  const { model, tiles } = setup();
  useAppStore.getState().selectSite(tiles[0].id);
  const origin = document.getElementById('origin')!; origin.focus();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new DOMException('Blocked', 'NotAllowedError')) } });
  await act(async () => root!.render(<SiteDrawer model={model} />));
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Close site dossier');
  expect(document.body.style.overflow).toBe('hidden');
  const copy = [...document.querySelectorAll('button')].find(b => b.textContent === 'Copy site link')!;
  await act(async () => copy.click());
  const fallback = document.querySelector('.copy-link-fallback input') as HTMLInputElement;
  expect(fallback.readOnly).toBe(true); expect(fallback.value).toBe(window.location.href);
  expect(document.querySelector('[role=status]')?.textContent).toContain('Clipboard access is unavailable');
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(useAppStore.getState().selectedSite).toBeNull();
  await act(async () => root!.unmount()); root = null;
  expect(document.body.style.overflow).toBe(''); expect(document.activeElement).toBe(origin);
});

it('highlights the scored low-Sun month rather than the month with the longest window', async () => {
  const { model, tiles } = setup();
  const state = useAppStore.getState();
  const tile = tiles[0]; state.selectSite(tile.id);
  const objective = model.template!.objectives.find(o => o.attributes.some(a => a.fn === 'light'))!;
  const cell = model.run!.fidelity[objective.id][tile.id];
  if (cell.F !== null) cell.best_month = 9;
  const sun = state.data!.sun!;
  const bin = Math.min(sun.lat_bins.length - 1, Math.max(0, Math.floor((tile.lat - sun.lat_bins[0] + sun.model.lat_step_deg / 2) / sun.model.lat_step_deg)));
  const hours = sun.targets.find(t => t.target === state.targetId)!.hours_low[bin];
  hours.fill(1); hours[11] = 10;
  await act(async () => root!.render(<SiteDrawer model={model} />));
  expect(document.querySelector('.best-month th')?.textContent).toBe('September');
  expect(document.querySelector('.best-month')?.textContent).not.toContain('December');
  expect(document.querySelector('.drawer-content')?.textContent).toContain('including hours and azimuth sweep');
  const lightRow = [...document.querySelectorAll('.attribute-row')].find(row => row.textContent?.includes('Low-Sun window'))!;
  expect(lightRow.querySelector('.attribute-source')?.textContent).toContain(state.data!.sun!.provenance[0].dataset);
  expect(lightRow.querySelector('.attribute-source')?.textContent).not.toContain('Copernicus');
});
