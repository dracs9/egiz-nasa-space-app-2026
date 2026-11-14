// Worker entry for the Planetary Studio compute jobs (terrain derivation, insolation, twin simulation).
import { runJob, type ComputeSite, type JobName, type Jobs } from './compute';

let site: ComputeSite | null = null;
self.onmessage = (ev: MessageEvent<{ init?: ComputeSite; id?: number; name?: JobName; input?: Jobs[JobName]['in'] }>) => {
  const m = ev.data;
  if (m.init) { site = m.init; return; }
  if (m.id === undefined || !m.name) return;
  try {
    if (!site) throw new Error('The compute worker has no site.');
    let last = 0;
    const out = runJob(site, m.name, m.input as never, (done, total) => { const now = Date.now(); if (now - last > 120 || done === total) { last = now; self.postMessage({ id: m.id, progress: [done, total] }); } });
    self.postMessage({ id: m.id, ok: true, out });
  } catch (error) { self.postMessage({ id: m.id, ok: false, error: error instanceof Error ? error.message : String(error) }); }
};
