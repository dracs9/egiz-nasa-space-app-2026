// EGIZ · the guided expedition: its steps, what each one has produced, and which results went out of date when
// the visitor changed the site or the mission priorities. Read by the journey rail, each step and Mission Home.
import { analysisCurrent } from '../planet/journey/analysis';
import { JOURNEY_STEPS, type JourneyStep } from '../planet/workspace/investigation';
import type { PlanetState } from '../planet/workspace/store';

export const STEP_INFO: Record<JourneyStep, { label: string; question: string; hint: string }> = {
  explore: { label: 'Explore', question: 'Where will you look?', hint: 'Rotate the planet, find its measured sites and choose one to investigate.' },
  site: { label: 'Investigate', question: 'What is this place?', hint: 'Context, terrain, light and environment, what is measured and what is missing.' },
  analysis: { label: 'Analysis', question: 'What does the evidence say?', hint: 'EGIZ runs its engines on the site; inspect every step, statistic and finding.' },
  alternatives: { label: 'Alternatives', question: 'Is there a better place to look?', hint: 'Compare the site with every other measured site on this world.' },
  analogs: { label: 'Earth analogs', question: 'Where on Earth can we rehearse it?', hint: 'Explore ranked Earth places, their statistics, transferability and limits.' },
};
export const nextStep = (s: JourneyStep): JourneyStep | null => JOURNEY_STEPS[JOURNEY_STEPS.indexOf(s) + 1] ?? null;
export const prevStep = (s: JourneyStep): JourneyStep | null => JOURNEY_STEPS[JOURNEY_STEPS.indexOf(s) - 1] ?? null;

export type StepState = 'done' | 'stale' | 'open';
export function stepState(id: JourneyStep, s: PlanetState): StepState {
  const inv = s.inv, reached = inv.journey?.reached ?? [];
  switch (id) {
    case 'explore': return inv.target ? 'done' : 'open';
    case 'site': return inv.target && reached.includes('site') ? 'done' : 'open';
    case 'analysis': return analysisCurrent(inv.analysis, inv.target, s.weights()) ? 'done' : inv.analysis ? 'stale' : 'open';
    case 'alternatives': return reached.includes('alternatives') || (inv.trail ?? []).some(t => t.kind === 'switch') ? 'done' : 'open';
    case 'analogs': return !inv.candidates.length ? 'open' : inv.analogsFor && inv.analogsFor !== inv.target ? 'stale' : 'done';
  }
}

export interface StaleItem { what: string; why: string; fix: { label: string; step?: JourneyStep; route?: 'planet' } }
/** Downstream results that no longer match the current site or priorities, each with the action that refreshes it. */
export function staleItems(s: PlanetState): StaleItem[] {
  const inv = s.inv, out: StaleItem[] = [], name = (id: string | null | undefined) => s.bundle?.targets.find(t => t.id === id)?.name.split(' (')[0] ?? id ?? '—';
  const a = inv.analysis;
  if (a && !analysisCurrent(a, inv.target, s.weights())) out.push({ what: 'Site analysis', why: a.target !== inv.target ? `It was run for ${name(a.target)}; the mission site is now ${name(inv.target)}.` : 'The mission priorities changed after it was run.', fix: { label: 'Re-run the analysis', step: 'analysis' } });
  if (inv.candidates.length && inv.analogsFor && inv.analogsFor !== inv.target) out.push({ what: `${inv.candidates.length} kept Earth analog${inv.candidates.length > 1 ? 's' : ''}`, why: `They were ranked for ${name(inv.analogsFor)}, not ${name(inv.target)}.`, fix: { label: 'Review Earth analogs', step: 'analogs' } });
  const off = inv.experiments.filter(e => e.site.id !== inv.target && !inv.candidates.includes(e.site.id));
  if (off.length && inv.target) out.push({ what: `${off.length} saved simulation${off.length > 1 ? 's' : ''}`, why: `Run on ${[...new Set(off.map(e => e.site.id))].join(', ')} — not the mission site or a kept analog. They stay valid for that terrain.`, fix: { label: 'Open the simulator', route: 'planet' } });
  return out;
}
/** The step a returning visitor should resume at: the first unfinished one, else the last visited. */
export function resumeStep(s: PlanetState): JourneyStep {
  if (!s.inv.target) return 'explore';
  return JOURNEY_STEPS.find(id => stepState(id, s) !== 'done') ?? s.inv.journey?.step ?? 'analogs';
}
