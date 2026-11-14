import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { MapPanel } from './MapPanel';
import { useAppStore } from '../state/store';
import { testData } from '../data/testData';
import { coords, fidelityColor, siteName } from '../lib/format';

vi.mock('../lib/maplibre', () => ({ loadMapLibrary: () => Promise.reject(new Error('WebGL unavailable in this test')) }));
let root: Root | null = null;
afterEach(async () => { if (root) { await act(async () => { root!.unmount(); }); root = null; } vi.restoreAllMocks(); document.body.innerHTML = ''; });

it('renders the all-null Kazakhstan site as not eligible in both offline map and candidate table', async () => {
  window.history.replaceState(null, '', '#/campaign?lens=kz'); useAppStore.getState().initialize(testData);
  const run = testData.results.runs.find(r => r.target === useAppStore.getState().targetId)!;
  const unknown = testData.candidates.tiles.find(t => t.id === 'FAKE_KZ_020')!;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="map-test"></div>'; root = createRoot(document.getElementById('map-test')!);
  await act(async () => { root!.render(<MapPanel run={run} />); });
  const point = [...document.querySelectorAll<HTMLButtonElement>('.fallback-point')].find(button => button.getAttribute('aria-label') === `Open ${siteName(unknown)}, not eligible`);
  expect(point).toBeDefined(); expect(point!.title).toContain('no known objective fidelity');
  expect(document.querySelector<HTMLButtonElement>('[aria-label="Fit campaign"]')!.disabled).toBe(true);
  const normalizedColor = document.createElement('span'); normalizedColor.style.background = fidelityColor(null);
  expect(point!.style.background).toBe(normalizedColor.style.background);
  const tableButton = [...document.querySelectorAll<HTMLButtonElement>('.map-toolbar button')].find(button => button.textContent === 'All candidates')!;
  await act(async () => { tableButton.click(); });
  expect(tableButton.getAttribute('aria-pressed')).toBe('true');
  const row = [...document.querySelectorAll('.candidate-table tbody tr')].find(item => item.querySelector('button')?.textContent?.includes(coords(unknown.lat, unknown.lon)));
  expect(row).toBeDefined(); expect(row!.children[1].textContent).toBe('Not eligible');
});
