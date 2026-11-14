// EGIZ · one product, many workspaces. The registry every navigation surface reads (header index, Mission Home,
// the switcher inside full-screen studios), and `openWorkspace`, which carries the mission context — world, site,
// priorities, Earth analogs — into the tool being opened. Each tool keeps its own state; this only sets where it
// starts, and says honestly when a tool's dataset does not cover the mission's site.
import { t } from '../i18n';
import { useAppStore, type Route } from '../state/store';
import { usePlanet, type World } from '../planet/workspace/store';
import type { JourneyStep } from '../planet/workspace/investigation';

export type Group = 'mission' | 'workspace' | 'reference';
export interface Workspace { route: Route; title: string; short: string; group: Group; text: string; worlds?: World[] }
export const WORKSPACES: Workspace[] = [
  { route: 'mission', title: 'Mission Home', short: 'Home', group: 'mission', text: 'Your mission at a glance: site, findings, analogs, open questions and what to do next.' },
  { route: 'explore', title: 'Expedition', short: 'Expedition', group: 'mission', text: 'The guided investigation: explore the planet, choose a site, analyse it, compare alternatives, find Earth analogs.' },
  { route: 'discover', title: 'Discover Index', short: 'Discover', group: 'workspace', text: 'Earth-wide analog search, ranked candidates, measurements, comparisons and the research assistant.' },
  { route: 'atlas', title: 'ATLAS-Π', short: 'ATLAS-Π', group: 'workspace', text: 'Task-by-task transferability: how much an Earth rehearsal can tell us about the real mission.' },
  { route: 'astral', title: 'Mission Studio', short: 'Mission Studio', group: 'workspace', text: 'Measured terrain at the highest resolution: terrain units, science targets and rover planning.' },
  { route: 'planet', title: 'Planetary Studio', short: '3D terrain', group: 'workspace', text: 'Measured 3D terrain: layers, light, measurements, the rover digital twin and side-by-side comparison.' },
  { route: 'studio', title: 'Lunar World', short: 'Lunar World', group: 'workspace', text: 'The measured lunar south-pole world with its intelligence and simulation tools.', worlds: ['moon'] },
  { route: 'lab', title: 'Engineering Lab', short: 'Engineering', group: 'workspace', text: 'Rover and vehicle configuration, launch, descent, EVA, telemetry, replay, validation and experiments.' },
  { route: 'campaign', title: 'Field Campaign', short: 'Campaign', group: 'workspace', text: 'Mission objectives, Earth site selection, campaign optimisation and fidelity analysis.' },
  { route: 'evidence', title: 'Sources & Limits', short: 'Sources', group: 'reference', text: 'Methodology, datasets, provenance, validation, uncertainty and limitations.' },
  { route: 'twin', title: 'Same Sun', short: 'Same Sun', group: 'reference', text: 'A target and its Earth stand-in side by side, under the same sunlight.' },
  { route: 'home', title: 'The EGIZ film', short: 'Film', group: 'reference', text: 'The cinematic introduction to what EGIZ does.' },
];
export const workspace = (r: Route) => WORKSPACES.find(w => w.route === r) ?? null;
/** Routes that belong to the same workspace (Field Campaign's brief and matrix views). */
export const SECTION_OF: Partial<Record<Route, Route>> = { brief: 'campaign', matrix: 'campaign' };

/** Packaged measured world directory per body, for Mission Studio. */
const ASTRAL_WORLD: Record<World, string> = { moon: 'moon-mons-mouton', mars: 'mars-jezero' };

/** Whether a mission exists in this browser: a world has been chosen. */
export const hasMission = () => !!usePlanet.getState().world();

function setHashParams(route: Route, params: Record<string, string | null | undefined>) {
  const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v); else q.delete(k);
  window.history.replaceState(null, '', `#/${route}?${q.toString()}`);
}

/** Align the campaign dataset (Field Campaign, Engineering Lab, Same Sun, Mission Brief) with the mission's world.
 *  That dataset holds one target per world; the nearest on the same body is chosen. */
export function syncCampaignTarget() {
  const app = useAppStore.getState(), w = usePlanet.getState().world(); if (!w || !app.data) return;
  const cur = app.data.targets.targets.find(t => t.id === app.targetId);
  if (cur?.body === w) return;
  const site = usePlanet.getState().inv.target ? usePlanet.getState().target() : null;
  const same = app.data.targets.targets.filter(t => t.body === w);
  const best = site ? same.sort((a, b) => Math.hypot(a.lat - site.lat, a.lon - site.lon) - Math.hypot(b.lat - site.lat, b.lon - site.lon))[0] : same[0];
  if (best) app.setTarget(best.id);
}

/** Open a workspace starting from the mission context. */
export function openWorkspace(route: Route, opts: { step?: JourneyStep; window?: string } = {}) {
  const p = usePlanet.getState(), w = p.world(), site = p.inv.target, app = useAppStore.getState();
  syncCampaignTarget();
  if (route === 'planet' && site) { const ref = p.refs.find(r => r.id === site); if (ref && p.inv.siteKey !== ref.key && !p.inv.streamed) p.setSiteRef(ref.key, null); if (ref && (p.stage === 'discover' || !p.site)) p.setStage('inspect'); }
  app.navigate(route);
  if (route === 'discover' && site) setHashParams('discover', { target: site, profile: p.inv.profile, window: opts.window ?? null });
  if (route === 'astral' && w) setHashParams('astral', { world: ASTRAL_WORLD[w] });
  if (route === 'explore') setHashParams('explore', { body: w, step: opts.step ?? p.inv.journey?.step ?? 'explore', site: p.inv.target });
}

/** What a workspace can do with the current mission, in one line (shown next to it in Mission Home and the index).
 *  Uses only the mission record and already-loaded lists, so it never claims something it has not checked. */
export function contextNote(route: Route): string | null {
  const p = usePlanet.getState(), w = p.world(), id = p.inv.target, app = useAppStore.getState();
  if (!w) return null;
  const name = p.inv.siteName ?? (id ? p.target()?.name.split(' (')[0] : null) ?? null, packaged = w === 'moon' ? 'Mons Mouton' : 'Jezero';
  switch (route) {
    case 'discover': return name ? `${t('Opens ranked Earth analogs for')} ${name}` : null;
    case 'atlas': return t('Opens the task transferability of this world’s mission');
    case 'astral': return t(w === 'mars' ? 'Measured Jezero world (1 m HiRISE)' : 'Measured Mons Mouton world');
    case 'planet': { if (!id || !p.refs.length) return null; const ref = p.refs.find(r => r.id === id); return ref ? `${t('Opens the measured 3D terrain of')} ${name}` : `${t('No 3D package for this site; packaged terrain is available for')} ${packaged}`; }
    case 'studio': return t(w === 'moon' ? 'Measured lunar south-pole world' : 'Moon only — your mission is on Mars');
    case 'lab': case 'campaign': case 'twin': { const c = app.data?.targets.targets.find(x => x.body === w); return c ? `${t('Uses the campaign dataset for')} ${t(c.name.split(/[/,(]/)[0].trim())}` : null; }
    default: return null;
  }
}
