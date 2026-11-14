import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { SkipLink } from './SkipLink';
import { useAppStore } from '../state/store';
import { testData } from '../data/testData';
it('moves focus without changing the mission route or selected objectives', async () => {
  const mars = testData.targets.targets.find(t => t.body === 'mars')!;
  window.history.replaceState(null, '', `#/brief?target=${mars.id}&enabled=M2&k=2`);
  useAppStore.getState().initialize(testData); const originalHash = window.location.hash;
  document.body.innerHTML = '<div id="skip-test"></div><main id="main-content" tabindex="-1"></main>';
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.getElementById('skip-test')!);
  await act(async () => { root.render(<SkipLink />); });
  document.querySelector<HTMLAnchorElement>('.skip-link')!.click();
  expect(window.location.hash).toBe(originalHash); expect(useAppStore.getState().route).toBe('brief');
  expect(useAppStore.getState().enabledObjectives).toEqual(['M2']); expect(document.activeElement?.id).toBe('main-content');
  await act(async () => { root.unmount(); });
});
