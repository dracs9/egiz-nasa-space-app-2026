// Distinct source windows must remain discoverable even within one dataset version.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { EvidencePage } from './EvidencePage';
import { testData } from '../data/testData';
import { useAppStore } from '../state/store';

it('keeps every distinct source URL and deduplicates only identical source records', async () => {
  const data = structuredClone(testData);
  const sources = [1, 2, 3].map(id => ({ dataset: 'Software test terrain', provider: 'Test fixture', version: '1', role: 'terrain', url: `https://example.org/window-${id}.tif` }));
  data.candidates.provenance = [...sources, sources[0]];
  window.history.replaceState(null, '', '#/evidence?data=demo');
  useAppStore.getState().setDataMode('demo'); useAppStore.getState().initialize(data, 'demo');
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<EvidencePage />));
    for (const source of sources) {
      const links = host.querySelectorAll(`a[href="${source.url}"]`);
      expect(links).toHaveLength(1);
      expect(links[0].getAttribute('aria-label')).toContain(source.url);
      expect(host.textContent).toContain(source.url);
    }
  } finally { await act(async () => root.unmount()); host.remove(); }
});
