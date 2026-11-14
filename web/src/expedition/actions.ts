// EGIZ · journey actions shared by the landing page, the expedition and Mission Home.
import { useAppStore } from '../state/store';
import type { JourneyStep } from '../planet/workspace/investigation';
import { usePlanet, type World } from '../planet/workspace/store';
import { resumeStep } from './journey';
import { writeExpeditionUrl } from './url';
import { syncCampaignTarget } from './nav';

/** Move to a step of the expedition (pushed to history, so Back returns to the previous step). */
export function goStep(step: JourneyStep, site?: string | null) {
  const p = usePlanet.getState();
  // Entering from another route already pushed one history entry; the step then replaces it (one Back = one move).
  const entering = useAppStore.getState().route !== 'explore';
  if (entering) useAppStore.getState().navigate('explore');
  writeExpeditionUrl({ body: p.world(), step, site: site === undefined ? (step === 'explore' ? null : p.inv.target) : site }, !entering);
  window.scrollTo({ top: 0 });
}
/** Begin (or resume) a mission on a world from anywhere — the landing page's START uses this. */
export function startMission(world: World) {
  const p = usePlanet.getState(), same = p.world() === world;
  p.chooseWorld(world); syncCampaignTarget();
  const step = same ? resumeStep(usePlanet.getState()) : 'explore';
  useAppStore.getState().navigate('explore');
  writeExpeditionUrl({ body: world, step, site: step === 'explore' ? null : usePlanet.getState().inv.target });
}
