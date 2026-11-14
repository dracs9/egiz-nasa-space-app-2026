// One sentence per screen: which question it answers and on which data. Reconciles screens that
// would otherwise appear to disagree (pilot 9-window views vs. the Earth-wide Discover ranking).
import { t } from '../i18n';
import type { Route } from '../state/store';

const SCOPE: Partial<Record<Route, { pilot: boolean; text: string }>> = {
  discover: { pilot: false, text: 'Answers: which places on Earth are most similar to a chosen lunar or Martian site, and where does the analogy break? Data: the Earth-wide index of measured 22 km windows (Copernicus DEM, ESA WorldCover, NASA POWER, Macrostrat).' },
  campaign: { pilot: true, text: 'Answers: which few pilot windows together cover a mission’s objectives? Data: the 9-window pilot set only — not the Earth-wide ranking in Discover, so the answers can differ.' },
  matrix: { pilot: true, text: 'Answers: how well each pilot window fits each mission objective. Data: the 9-window pilot set only.' },
  twin: { pilot: true, text: 'Answers: how sunlight at a target compares with a pilot window on the same dates. Data: solar geometry for the 9-window pilot set.' },
  atlas: { pilot: true, text: 'Answers: which field tasks would transfer from each pilot window to the target. Data: the same 9 pilot windows, so its picks (e.g. Boszhira, Wadi Rum, SP Crater) can differ from Discover’s Earth-wide ranking.' },
  lab: { pilot: false, text: 'Answers: how would a rover, lander or EVA perform on this terrain? Data: measured 200 m terrain grids of the pilot windows and two targets; all performance numbers are model estimates.' },
  studio: { pilot: false, text: 'Answers: what does a traverse look like on real lunar terrain? Data: the measured 5 m LOLA world around Mons Mouton with SPICE lighting; models are estimates.' },
  evidence: { pilot: true, text: 'Answers: where each pilot number comes from and what it cannot tell you. Data: source records and limits of the pilot set.' },
  brief: { pilot: false, text: 'Answers: what the mission needs. Data: mission objectives and their stated conditions (research parameters, not validated requirements).' },
};

export function ScopeNote({ route }: { route: Route }) {
  const s = SCOPE[route];
  if (!s) return null;
  return <p className="eg-scope">{s.pilot && <span className="eg-pilot">{t('pilot')}</span>}{t(s.text)}</p>;
}
