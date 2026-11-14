// AI-assisted implementation; human review pending.
import { designCampaigns, exactBest } from '../lib/campaign';
import type { EarthTile, MissionTemplate, Run, WorkerRequest, WorkerResponse } from '../types/contracts';

export type DesignRequest = { type: 'design'; run: Run; template: MissionTemplate; tiles: EarthTile[]; enabled: string[]; weights: Record<string, number> | null; lens: 'global' | 'kazakhstan'; shortlistSize: number };
self.onmessage = (event: MessageEvent<WorkerRequest | DesignRequest>) => {
  const start = performance.now();
  try {
    const request = event.data;
    if (request.type === 'design') {
      const campaigns = designCampaigns(request.run, request.template, request.tiles, request.enabled, request.weights, request.lens, request.shortlistSize);
      const globalCampaigns = request.lens === 'kazakhstan' ? designCampaigns(request.run, request.template, request.tiles, request.enabled, request.weights, 'global', request.shortlistSize) : campaigns;
      self.postMessage({ type: 'campaigns', campaigns, globalCampaigns, ms: performance.now() - start });
    } else {
      const F = Array.from({ length: request.nSites }, (_, s) => Array.from({ length: request.nObj }, (_, o) => request.F[s * request.nObj + o]));
      const result = exactBest(F, request.W, request.k, request.shortlist);
      const response: WorkerResponse = { type: 'result', sites: result.sites, coverage: result.coverage, ms: performance.now() - start };
      self.postMessage(response);
    }
  } catch (error) {
    const response: WorkerResponse = { type: 'error', kind: 'exception', message: error instanceof Error ? error.message : 'Optimization failed' };
    self.postMessage(response);
  }
};
