// Exercises the real export button and download helper with synthetic fixtures.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { CampaignPage, type CampaignModel } from './CampaignPage';
import { useAppStore } from '../state/store';
import { testData } from '../data/testData';

vi.mock('./MapPanel', () => ({ MapPanel: () => <div aria-label="Map omitted from export test" /> }));
let root: Root | null = null;
afterEach(async () => {
  if (root) { await act(async () => { root!.unmount(); }); root = null; }
  vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = '';
});

it('downloads the displayed fixture campaign with disclosure, correct roles and fidelity, then revokes its Blob URL', async () => {
  window.history.replaceState(null, '', '#/campaign?data=demo'); useAppStore.setState({ dataMode: 'demo' }); useAppStore.getState().initialize(testData, 'demo');
  const state = useAppStore.getState();
  const target = testData.targets.targets.find(t => t.id === state.targetId)!;
  const run = testData.results.runs.find(r => r.target === state.targetId && r.template === state.templateId)!;
  const template = testData.templates.templates.find(t => t.id === state.templateId)!;
  const campaign = run.campaigns.find(c => c.k === state.k)!;
  const model: CampaignModel = { run, template, campaigns: run.campaigns, globalCampaigns: run.campaigns, pending: false, error: null, live: false, ms: 0 };
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:egiz-export-test'); const revokeObjectURL = vi.fn();
  const NativeURL = URL;
  class ExportURL extends NativeURL { static createObjectURL = createObjectURL; static revokeObjectURL = revokeObjectURL; }
  vi.stubGlobal('URL', ExportURL);
  const connectedDuringClick: boolean[] = [];
  const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { connectedDuringClick.push(this.isConnected); });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="export-test"></div>';
  root = createRoot(document.getElementById('export-test')!);
  await act(async () => { root!.render(<CampaignPage model={model} />); });
  const exportButton = [...document.querySelectorAll('button')].find(button => button.textContent === 'Export campaign JSON')!;
  expect(exportButton.disabled).toBe(false);
  const timeout = vi.spyOn(window, 'setTimeout').mockImplementation(() => 123);
  exportButton.click();
  expect(createObjectURL).toHaveBeenCalledOnce();
  const blob = createObjectURL.mock.calls[0][0] as unknown as Blob;
  expect(blob.type).toBe('application/json');
  expect(anchorClick).toHaveBeenCalledOnce();
  expect(connectedDuringClick).toEqual([true]);
  const anchor = anchorClick.mock.instances[0] as HTMLAnchorElement;
  expect(anchor.href).toBe('blob:egiz-export-test');
  expect(anchor.download).toBe(`egiz-${target.body}-${state.k}-site-campaign.json`);
  expect(anchor.isConnected).toBe(false);
  expect(timeout).toHaveBeenCalledWith(expect.any(Function), 1000);
  const revoke = timeout.mock.calls[0][0] as () => void; timeout.mockRestore();
  const text = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(blob);
  });
  const payload = JSON.parse(text);
  expect(payload.schema).toBe('egiz.campaign_export'); expect(payload.version).toBe('1.0.0'); expect(payload.synthetic).toBe(true);
  expect(payload.data_mode).toBe('demo'); expect(payload.source_inputs).toEqual(testData.results.inputs);
  expect(payload.provenance).toContainEqual(testData.candidates.provenance[0]);
  expect(payload.validation_status).toEqual(testData.validation!.experiments.map(e => ({ id: e.id, status: e.status })));
  expect(payload.target).toEqual(target); expect(payload.template).toBe(template.id); expect(payload.enabled_objectives).toEqual(state.enabledObjectives); expect(payload.lens).toBe('global');
  expect(payload.campaign).toEqual(campaign);
  for (const site of payload.campaign.sites) expect(site.roles).toEqual(campaign.per_objective.filter(o => o.site === site.id).map(o => o.objective));
  for (const objective of payload.campaign.per_objective) if (objective.site) expect(objective.F).toBe(run.fidelity[objective.objective][objective.site].F);
  expect(payload.limitations).toContain('Suitability not assessed: access, permits, safety.');
  expect(revokeObjectURL).not.toHaveBeenCalled(); revoke(); expect(revokeObjectURL).toHaveBeenCalledWith('blob:egiz-export-test');
});
