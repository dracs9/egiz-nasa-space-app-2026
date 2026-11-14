import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { TerrainEvidence } from './TerrainEvidence';
import { useAppStore } from '../state/store';
import { pilotTestData, testData } from '../data/testData';
import evidence from '../../../data/pilot/terrain_evidence.json';
let root: Root | null = null;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; vi.unstubAllGlobals(); document.body.innerHTML = ''; });
async function render(synthetic = false) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useAppStore.setState({ dataMode: synthetic ? 'demo' : 'pilot', data: synthetic ? testData : pilotTestData });
  document.body.innerHTML = '<div id="terrain-test"></div>'; root = createRoot(document.getElementById('terrain-test')!);
  await act(async () => root!.render(<TerrainEvidence siteId="PILOT_ICELAND" targetId="MARS_JEZERO" />));
}
it('recovers an unavailable measured product through an explicit retry', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('Dataset service unavailable')).mockResolvedValue({ ok: true, json: async () => evidence });
  vi.stubGlobal('fetch', fetcher); await render();
  expect(document.body.textContent).toContain('Dataset service unavailable');
  await act(async () => document.querySelector<HTMLButtonElement>('button')!.click());
  expect(document.querySelectorAll('.terrain-patch')).toHaveLength(2);
  expect(document.body.textContent).toContain('400 m slope baseline');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0][0]).toBe(`${import.meta.env.BASE_URL}data/pilot/terrain_evidence.json`);
});
it('never requests or displays measured terrain under synthetic fixtures', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); await render(true);
  expect(fetcher).not.toHaveBeenCalled(); expect(document.querySelector('.terrain-evidence')).toBeNull();
});
