import { expect, it, vi } from 'vitest';
import { loadMapLibrary } from './maplibre';
import { setWorkerUrl } from 'maplibre-gl';
vi.mock('maplibre-gl', () => ({ setWorkerUrl: vi.fn() }));
vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?url', () => ({ default: './assets/maplibre-gl-worker-TEST.mjs' }));

it('sets the emitted same-origin module worker URL before returning MapLibre', async () => {
  await loadMapLibrary();
  expect(setWorkerUrl).toHaveBeenCalledWith(new URL('./assets/maplibre-gl-worker-TEST.mjs', document.baseURI).href);
});
