// EGIZ · "The Moon or Mars?" — the choice that starts a mission. Shown by the landing page's final chapter and by
// a direct link to the expedition when no mission exists yet. Counts are read from the loaded index.
import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { t } from '../i18n';
import { usePlanet, type World } from '../planet/workspace/store';
import { WORLD } from '../planet/journey/knowledge';
import { GlobeView } from './GlobeView';
import { startMission } from './actions';
import './expedition.css';

const LINE: Record<World, string> = { moon: 'Steep polar massifs, a Sun on the horizon, and the next place people will walk.', mars: 'Ancient lakes and deltas, thin air, and rovers that are rehearsed on Earth first.' };
export function WorldChoice({ compact = false }: { compact?: boolean }) {
  const [pick, setPick] = useState<World | null>(usePlanet.getState().world());
  const b = usePlanet(s => s.bundle), current = usePlanet(s => s.world()), target = usePlanet(s => (s.inv.target ? s.target() : null));
  return <section className={`xp-choice ${compact ? 'compact' : ''}`} aria-labelledby="xp-choice-title">
    <header>
      <p className="eg-eyebrow">{t('New mission')}</p>
      <h2 id="xp-choice-title" className="eg-display">{t('The Moon or Mars?')}</h2>
      <p className="xp-lede">{t('Choose a destination. You will explore its surface, pick a place, see what EGIZ’s engines find there, and where on Earth it can be rehearsed.')}</p>
    </header>
    <div className="xp-choice-worlds" role="radiogroup" aria-label={t('Destination')}>
      {(['moon', 'mars'] as const).map(w => { const n = b?.targets.filter(x => x.body === w).length; return <button key={w} role="radio" aria-checked={pick === w} className={`xp-dest d-${w} ${pick === w ? 'on' : ''}`} onClick={() => setPick(w)} onDoubleClick={() => startMission(w)}>
        <span className="xp-dest-globe" aria-hidden="true"><GlobeView body={w} interactive={false} spin graticule={false} /></span>
        <span className="xp-dest-name eg-display">{t(w === 'moon' ? 'The Moon' : 'Mars')}</span>
        <span className="xp-dest-line">{t(LINE[w])}</span>
        <span className="xp-dest-facts"><span>{t('Gravity')} · {WORLD[w].gravity.split(' · ')[0]}</span>{n ? <span>{n} {t('measured sites')}</span> : null}</span>
      </button>; })}
    </div>
    <div className="xp-choice-go">
      <button className="eg-button" disabled={!pick} onClick={() => pick && startMission(pick)}>{t('Start')}{pick ? ` · ${t(pick === 'moon' ? 'The Moon' : 'Mars')}` : ''}<ArrowRight size={16} strokeWidth={1.6} /></button>
      {current && <p className="xp-choice-resume">{t('Your mission in progress')}: <b>{t(current === 'moon' ? 'The Moon' : 'Mars')}{target ? ` · ${target.name.split(' (')[0]}` : ''}</b>. {t('Choosing it again continues where you stopped; the other world starts a new mission and keeps this one saved.')}</p>}
    </div>
  </section>;
}
