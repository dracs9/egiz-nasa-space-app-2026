// EGIZ · the guided expedition (#/explore). The first investigation of a mission runs step by step —
// Explore → Investigate → Analysis → Alternatives → Earth analogs → Mission Home — but every step stays one
// click away afterwards, and the rail shows what is done and what went out of date. All work is saved in the
// mission's investigation record, the same one the Planetary Studio and Mission Home read.
import { useEffect, useMemo } from 'react';
import { ArrowLeft, ArrowRight, Check, House } from 'lucide-react';
import { t } from '../i18n';
import { useAppStore } from '../state/store';
import { BODY_LABEL } from '../planet/terrain/site';
import { usePlanetData } from '../planet/workspace/data';
import { JOURNEY_STEPS, type JourneyStep } from '../planet/workspace/investigation';
import { usePlanet, type World } from '../planet/workspace/store';
import { nextStep, prevStep, resumeStep, STEP_INFO, stepState } from './journey';
import { goStep, startMission } from './actions';
import { openWorkspace } from './nav';
import { useExpeditionUrl, writeExpeditionUrl } from './url';
import { WorldChoice } from './WorldChoice';
import { ExploreStep } from './steps/ExploreStep';
import { SiteStep } from './steps/SiteStep';
import { AnalysisStep } from './steps/AnalysisStep';
import { AlternativesStep } from './steps/AlternativesStep';
import { AnalogsStep } from './steps/AnalogsStep';
import './expedition.css';

export { goStep, startMission };

export default function ExpeditionPage() {
  const dataMode = useAppStore(a => a.dataMode); usePlanetData(dataMode);
  const url = useExpeditionUrl(), s = usePlanet(), world = s.world();
  // A link or Back/Forward naming another world reopens that world's mission (the current one stays saved).
  useEffect(() => { if (url.body && url.body !== usePlanet.getState().world()) usePlanet.getState().chooseWorld(url.body); }, [url.body]);
  const step: JourneyStep = useMemo(() => {
    const want = url.step ?? (world ? resumeStep(s) : 'explore');
    return want !== 'explore' && !s.inv.target ? 'explore' : want;
  }, [url.step, world, s.inv.target]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (world) { usePlanet.getState().reach(step); if (!url.step || !url.body) writeExpeditionUrl({ body: world, step }); } }, [world, step]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { document.documentElement.dataset.journey = step; return () => { delete document.documentElement.dataset.journey; }; }, [step]);

  if (!world) return <WorldChoice />;
  const target = s.inv.target ? s.target() : null;
  return <div className={`xp xp-step-${step}`}>
    <JourneyRail step={step} world={world} siteName={target?.name.split(' (')[0] ?? null} />
    <div className="xp-stage">
      {step === 'explore' && <ExploreStep world={world} focusId={url.site} />}
      {step === 'site' && <SiteStep />}
      {step === 'analysis' && <AnalysisStep />}
      {step === 'alternatives' && <AlternativesStep />}
      {step === 'analogs' && <AnalogsStep />}
    </div>
  </div>;
}

function JourneyRail({ step, world, siteName }: { step: JourneyStep; world: World; siteName: string | null }) {
  const s = usePlanet(), idx = JOURNEY_STEPS.indexOf(step), home = !!s.inv.journey?.homeUtc;
  return <nav className="xp-rail" aria-label={t('Expedition steps')}>
    <p className="xp-rail-ctx"><span className={`xp-body-dot b-${world}`} aria-hidden="true" />{t(BODY_LABEL[world])}{siteName && <><i aria-hidden="true">/</i><b>{siteName}</b></>}</p>
    <ol>{JOURNEY_STEPS.map((id, i) => { const st = stepState(id, s), locked = id !== 'explore' && !s.inv.target; return <li key={id} className={`${id === step ? 'on' : ''} st-${st}`}>
      <button disabled={locked} aria-current={id === step ? 'step' : undefined} onClick={() => goStep(id)} title={`${t(STEP_INFO[id].question)}${st === 'stale' ? ` — ${t('needs a re-run: the site or priorities changed')}` : ''}`}>
        <b aria-hidden="true">{st === 'done' && id !== step ? <Check size={11} strokeWidth={2.4} /> : String(i + 1).padStart(2, '0')}</b><span>{t(STEP_INFO[id].label)}</span>{st === 'stale' && <i className="xp-stale" aria-label={t('needs a re-run')} />}
      </button></li>; })}
      <li className={`xp-rail-home ${home ? 'st-done' : ''}`}><button disabled={!s.inv.target} onClick={() => { usePlanet.getState().enterHome(); openWorkspace('mission'); }}><House size={13} aria-hidden="true" /><span>{t('Mission Home')}</span></button></li>
    </ol>
    <span className="xp-rail-mobile" aria-hidden="true">{String(idx + 1).padStart(2, '0')}/{String(JOURNEY_STEPS.length).padStart(2, '0')} · {t(STEP_INFO[step].label)}</span>
  </nav>;
}

/** The hand-off at the end of a step: back, and what comes next and why. */
export function StepFooter({ step, why, ready = true, children }: { step: JourneyStep; why: string; ready?: boolean; children?: React.ReactNode }) {
  const next = nextStep(step), prev = prevStep(step);
  return <footer className="xp-next">
    <p>{t(why)}</p>
    <div className="xp-next-row">
      {prev && <button className="eg-button quiet" onClick={() => goStep(prev)}><ArrowLeft size={15} /><span>{t(STEP_INFO[prev].label)}</span></button>}
      {children}
      {next ? <button className="eg-button" disabled={!ready} onClick={() => goStep(next)}>{t('Next')}: {t(STEP_INFO[next].label)}<ArrowRight size={16} strokeWidth={1.6} /></button>
        : <button className="eg-button" onClick={() => { usePlanet.getState().enterHome(); openWorkspace('mission'); }}>{t('Enter Mission Home')}<ArrowRight size={16} strokeWidth={1.6} /></button>}
    </div>
  </footer>;
}
/** Step heading: number, question, one line of guidance. */
export function StepHead({ step, title, children }: { step: JourneyStep; title?: string; children?: React.ReactNode }) {
  return <header className="xp-head">
    <p className="eg-eyebrow">{String(JOURNEY_STEPS.indexOf(step) + 1).padStart(2, '0')} / {t(STEP_INFO[step].label)}</p>
    <h1 className="eg-display">{title ?? t(STEP_INFO[step].question)}</h1>
    {children && <div className="xp-lede">{children}</div>}
  </header>;
}
