import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLiveCampaign } from './useLiveCampaign';
import { useAppStore } from '../state/store';
import { testData } from '../data/testData';
import { designCampaigns } from './campaign';

let root: Root | null = null;
let current: ReturnType<typeof useLiveCampaign>;
function Probe() { current = useLiveCampaign(); return <output>{current.pending ? 'pending' : current.campaigns.length}</output>; }
beforeEach(() => {
  window.history.replaceState(null, '', '#/campaign'); useAppStore.getState().initialize(testData);
  const state = useAppStore.getState(); state.toggleObjective(state.enabledObjectives[0]);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="worker-test"></div>';
});
afterEach(async () => {
  if (root) { await act(async () => { root!.unmount(); }); root = null; }
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); document.body.innerHTML = '';
});
async function renderProbe() { root = createRoot(document.getElementById('worker-test')!); await act(async () => { root!.render(<Probe />); }); }
function expectedCampaigns(lens: 'global' | 'kazakhstan') {
  const state = useAppStore.getState(); const run = state.data!.results.runs.find(r => r.target === state.targetId && r.template === state.templateId)!; const template = state.data!.templates.templates.find(t => t.id === state.templateId)!;
  return designCampaigns(run, template, state.data!.candidates.tiles, state.enabledObjectives, state.weights, lens);
}

it('recovers from a synchronous Worker constructor rejection using the same selected objectives', async () => {
  vi.stubGlobal('Worker', class { constructor() { throw new DOMException('Worker blocked by policy', 'SecurityError'); } });
  await renderProbe();
  expect(current.pending).toBe(false); expect(current.campaigns).toEqual(expectedCampaigns('global'));
  expect(current.error).toContain('could not start');
  const state = useAppStore.getState();
  await act(async () => { state.toggleObjective(current.template!.objectives[0].id); });
  expect(current.live).toBe(false); expect(current.error).toBeNull(); expect(current.campaigns).toEqual(current.run!.campaigns);
});
it('cleans up and recovers from synchronous postMessage rejection without losing the Kazakhstan lens', async () => {
  vi.useFakeTimers(); const terminate = vi.fn(); const postMessage = vi.fn(() => { throw new DOMException('Could not clone data', 'DataCloneError'); });
  vi.stubGlobal('Worker', class { onmessage = null; onerror = null; terminate = terminate; postMessage = postMessage; });
  useAppStore.getState().setLens('kazakhstan');
  await renderProbe();
  expect(postMessage).toHaveBeenCalledOnce(); expect(terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  expect(current.pending).toBe(false); expect(current.campaigns).toEqual(expectedCampaigns('kazakhstan'));
  expect(current.globalCampaigns).toEqual(expectedCampaigns('global')); expect(current.error).toContain('could not receive');
  await act(async () => { vi.advanceTimersByTime(3000); }); expect(terminate).toHaveBeenCalledOnce();
});
it('falls back after a worker timeout and clears its resources', async () => {
  vi.useFakeTimers(); const terminate = vi.fn();
  vi.stubGlobal('Worker', class { onmessage = null; onerror = null; terminate = terminate; postMessage() {} });
  await renderProbe(); expect(current.pending).toBe(true);
  await act(async () => { vi.advanceTimersByTime(2000); });
  expect(current.pending).toBe(false); expect(current.campaigns).toEqual(expectedCampaigns('global')); expect(current.error).toContain('timed out'); expect(terminate).toHaveBeenCalledOnce();
});
it('discards an old worker response when the loaded dataset changes with the same selection', async () => {
  const workers: ControlledWorker[] = [];
  class ControlledWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror = null; terminate = vi.fn(); postMessage() {}
    constructor() { workers.push(this); }
  }
  vi.stubGlobal('Worker', ControlledWorker);
  await renderProbe(); const previous = workers[0]; const staleResponse = previous.onmessage!;
  const replacement = { ...testData, results: { ...testData.results, engine_version: 'changed-test-data', runs: testData.results.runs.map(run => ({ ...run })) } };
  await act(async () => { useAppStore.getState().initialize(replacement); });
  expect(previous.terminate).toHaveBeenCalledOnce(); expect(previous.onmessage).toBeNull(); expect(workers).toHaveLength(2);
  await act(async () => { staleResponse(new MessageEvent('message', { data: { type: 'campaigns', campaigns: testData.results.runs[0].campaigns, globalCampaigns: [], ms: 0 } })); });
  expect(current.pending).toBe(true); expect(current.campaigns).toEqual([]);
  const expected = expectedCampaigns('global');
  await act(async () => { workers[1].onmessage!(new MessageEvent('message', { data: { type: 'campaigns', campaigns: expected, globalCampaigns: expected, ms: 3 } })); });
  expect(current.pending).toBe(false); expect(current.campaigns).toEqual(expected); expect(current.run).toBe(replacement.results.runs.find(run => run.target === useAppStore.getState().targetId));
});
