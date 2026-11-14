// EGIZ · the expedition's place in the shared hash URL (#/explore?body=mars&step=analysis&site=MARS_JEZERO).
// Steps are pushed to history, so Back and Forward walk the journey and a copied link reopens the same step.
import { useEffect, useState } from 'react';
import { isJourneyStep, type JourneyStep } from '../planet/workspace/investigation';
import { isWorld, type World } from '../planet/workspace/store';

export interface ExpeditionUrl { body: World | null; step: JourneyStep | null; site: string | null }
const EVT = 'egiz-hash';
export function readExpeditionUrl(): ExpeditionUrl {
  const q = new URLSearchParams(window.location.hash.split('?')[1] ?? ''), b = q.get('body'), s = q.get('step');
  return { body: isWorld(b) ? b : null, step: isJourneyStep(s) ? s : null, site: q.get('site') };
}
export function writeExpeditionUrl(p: Partial<Record<keyof ExpeditionUrl, string | null>>, push = false) {
  const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  for (const [k, v] of Object.entries(p)) if (v) q.set(k, v); else q.delete(k);
  const url = `#/explore?${q.toString()}`; if (url === window.location.hash) return;
  if (push) window.history.pushState(null, '', url); else window.history.replaceState(null, '', url);
  window.dispatchEvent(new Event(EVT));
}
export function useExpeditionUrl(): ExpeditionUrl {
  const [v, setV] = useState(readExpeditionUrl);
  useEffect(() => {
    const f = () => setV(prev => { const n = readExpeditionUrl(); return n.body === prev.body && n.step === prev.step && n.site === prev.site ? prev : n; });
    window.addEventListener('popstate', f); window.addEventListener('hashchange', f); window.addEventListener(EVT, f);
    return () => { window.removeEventListener('popstate', f); window.removeEventListener('hashchange', f); window.removeEventListener(EVT, f); };
  }, []);
  return v;
}
