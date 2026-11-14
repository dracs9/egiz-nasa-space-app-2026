// AI-assisted implementation; human review pending.
import { useEffect, useState } from 'react';
import { useAppStore } from '../state/store';
import type { AppData, Campaign } from '../types/contracts';
import { designCampaigns } from './campaign';

export function useLiveCampaign() {
  const { data, targetId, templateId, enabledObjectives, weights, lens } = useAppStore();
  const run = data?.results.runs.find(r => r.target === targetId && r.template === templateId);
  const template = data?.templates.templates.find(t => t.id === templateId);
  const [result, setResult] = useState<{ key: string; source: AppData | null; campaigns: Campaign[]; globalCampaigns?: Campaign[]; pending: boolean; error: string | null; ms: number }>({ key: '', source: null, campaigns: [], pending: false, error: null, ms: 0 });
  const key = JSON.stringify([targetId, templateId, enabledObjectives, weights, lens]);
  const defaults = template?.objectives.every(o => enabledObjectives.includes(o.id) && (weights?.[o.id] ?? o.weight_default) === o.weight_default) && lens === 'global';
  useEffect(() => {
    if (!data || !run || !template || defaults) return;
    let active = true;
    let worker: Worker | null = null;
    let timer: number | null = null;
    const stopWorker = () => {
      if (timer !== null) { window.clearTimeout(timer); timer = null; }
      if (worker) { worker.onmessage = null; worker.onerror = null; worker.terminate(); worker = null; }
    };
    // Use the same inputs when a Worker is unavailable. Showing an unrelated
    // precomputed result under custom objectives or Kazakhstan would be misleading.
    const recomputeLocally = (notice: string | null) => {
      stopWorker();
      if (!active) return;
      const start = performance.now();
      try {
        const campaigns = designCampaigns(run, template, data.candidates.tiles, enabledObjectives, weights, lens, data.templates.params.shortlist_per_objective);
        const globalCampaigns = lens === 'kazakhstan' ? designCampaigns(run, template, data.candidates.tiles, enabledObjectives, weights, 'global', data.templates.params.shortlist_per_objective) : campaigns;
        setResult({ key, source: data, campaigns, globalCampaigns, pending: false, error: notice, ms: performance.now() - start });
      } catch {
        setResult({ key, source: data, campaigns: [], pending: false, error: 'Re-optimization could not complete. Restore default objectives to view the precomputed campaign.', ms: 0 });
      }
    };
    setResult({ key, source: data, campaigns: [], pending: true, error: null, ms: 0 });
    if (typeof Worker === 'undefined') recomputeLocally(null);
    else {
      let started = false;
      try {
        worker = new Worker(new URL('../workers/campaign.worker.ts', import.meta.url), { type: 'module' });
        started = true;
        timer = window.setTimeout(() => recomputeLocally('Background re-optimization timed out; campaign recomputed in this tab.'), 2000);
        worker.onmessage = ({ data: response }) => {
          if (!active) return;
          if (response.type === 'campaigns') {
            stopWorker();
            setResult({ key, source: data, campaigns: response.campaigns, globalCampaigns: response.globalCampaigns, pending: false, error: null, ms: response.ms });
          } else recomputeLocally('Background re-optimization failed; campaign recomputed in this tab.');
        };
        worker.onerror = event => { event.preventDefault(); recomputeLocally('Background re-optimization unavailable; campaign recomputed in this tab.'); };
        worker.postMessage({ type: 'design', run, template, tiles: data.candidates.tiles, enabled: enabledObjectives, weights, lens, shortlistSize: data.templates.params.shortlist_per_objective });
      } catch {
        recomputeLocally(started ? 'Background worker could not receive the request; campaign recomputed in this tab.' : 'Background worker could not start; campaign recomputed in this tab.');
      }
    }
    return () => { active = false; stopWorker(); };
  }, [data, run, template, defaults, key, enabledObjectives, weights, lens]);
  const current = result.key === key && result.source === data;
  return { run, template, campaigns: defaults ? run?.campaigns ?? [] : current ? result.campaigns : [], globalCampaigns: defaults ? run?.campaigns ?? [] : current ? result.globalCampaigns ?? [] : [], pending: !defaults && (!current || result.pending), error: !defaults && current ? result.error : null, live: !defaults, ms: result.ms };
}
