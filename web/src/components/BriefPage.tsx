import { t, useLanguage } from '../i18n';
import { ArrowRight, Check, CircleHelp, Flag, Globe2, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useAppStore } from '../state/store';
import { coords } from '../lib/format';
import { DestinationArtwork } from './DestinationArtwork';
import copy from '../content/copy.json';

export function BriefPage() {
  useLanguage();
  const { data, targetId, templateId, enabledObjectives, weights, k, setTarget, toggleObjective, setWeights, setK, navigate } = useAppStore();
  const template = data!.templates.templates.find(item => item.id === templateId)!;
  const targets = data!.targets.targets.filter(item => item.kind !== 'validation_only');
  const selected = data!.targets.targets.find(item => item.id === targetId)!;
  const active = template.objectives.filter(o => enabledObjectives.includes(o.id) && (weights?.[o.id] ?? o.weight_default) > 0);
  return <main className="page brief-page">
    <div className="page-intro"><span className="eyebrow">{t(copy.brief.eyebrow)}</span><h1>{t(copy.brief.title)}</h1><p>{t(copy.brief.subtitle)}</p></div>
    <div className="brief-layout">
      <div className="brief-main">
        <section className="brief-section">
          <h2><span className="step-number">01</span>{t(copy.brief.target)}</h2>
          <div className="target-choices" role="radiogroup" aria-label={t('Mission target')}>
            {targets.map((target, index) => <button key={target.id} role="radio" aria-checked={targetId === target.id} tabIndex={targetId === target.id ? 0 : -1}
              onKeyDown={event => {
                if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
                event.preventDefault();
                const next = (index + (event.key === 'ArrowRight' ? 1 : targets.length - 1)) % targets.length;
                setTarget(targets[next].id);
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=radio]')[next]?.focus();
              }}
              onClick={() => setTarget(target.id)} className={`target-choice destination-card ${target.body} ${targetId === target.id ? 'selected' : ''}`}>
              <DestinationArtwork body={target.body} sizes="(max-width: 767px) 100vw, (max-width: 1200px) 40vw, 440px" />
              <span className="destination-shade" aria-hidden="true" />
              <div className="target-choice-top"><span className="eyebrow">{t(target.body === 'moon' ? 'LUNAR SOUTH POLE' : 'MARS SURFACE')}</span><span className="radio-mark">{targetId === target.id && <Check size={13} />}</span></div>
              <div className="destination-caption"><h3 title={t(target.name)}>{t(target.name.split(' / ')[0])}</h3><p className="mono">{coords(target.lat, target.lon)}</p></div>
            </button>)}
          </div>
        </section>
        <section className="brief-section">
          <div className="section-heading"><h2><span className="step-number">02</span>{t(copy.brief.mission)}</h2>
            <button className="icon-action" title={t('Reset')} aria-label={t('Reset')} onClick={() => { setWeights(null); template.objectives.filter(o => !enabledObjectives.includes(o.id)).forEach(o => toggleObjective(o.id)); }}><RotateCcw size={17} /></button>
          </div>
          <div className="brief-objectives">{template.objectives.map((objective, index) => <div key={objective.id} className={`brief-objective ${enabledObjectives.includes(objective.id) ? 'enabled' : ''}`}>
            <label className="objective-check"><input type="checkbox" checked={enabledObjectives.includes(objective.id)} onChange={() => toggleObjective(objective.id)} /><span className="check-box"><Check size={12} /></span><span className="objective-index mono">{String(index + 1).padStart(2, '0')}</span><span><strong>{t(objective.name)}</strong>{objective.description !== objective.name && <small>{t(objective.description)}</small>}</span></label>
            <label className="weight-control"><span title={t('Priority')}><SlidersHorizontal size={12} aria-hidden="true" /><span className="sr-only">{t('Priority')}</span><b className="mono">{weights?.[objective.id] ?? objective.weight_default}×</b></span><input type="range" min="0" max="3" step="0.5" value={weights?.[objective.id] ?? objective.weight_default} disabled={!enabledObjectives.includes(objective.id)} aria-label={`${t(objective.name)} — ${t('Priority')}`} onChange={event => setWeights({ ...Object.fromEntries(template.objectives.map(o => [o.id, o.weight_default])), ...weights, [objective.id]: Number(event.target.value) })} /></label>
          </div>)}</div>
        </section>
        <section className="brief-section"><h2><span className="step-number">03</span>{t(copy.brief.size)}</h2><div className="size-choices">{([1, 2, 3] as const).map(n => <button key={n} className={k === n ? 'selected' : ''} aria-pressed={k === n} onClick={() => setK(n)}><span className="size-dots">{Array.from({ length: n }, (_, i) => <i key={i} />)}</span><strong>{n} {t(n === 1 ? 'site' : 'sites')}</strong><small>{t(n === 1 ? 'A single rehearsal base' : n === 2 ? 'Complementary conditions' : 'A broader test campaign')}</small></button>)}</div></section>
      </div>
      <aside className="brief-summary panel destination-summary">
        <div className="brief-summary-art"><DestinationArtwork body={selected.body} sizes="(max-width: 767px) 100vw, 350px" /><span aria-hidden="true" /></div>
        <div className="brief-summary-heading"><span className="eyebrow">{t('YOUR MISSION AT A GLANCE')}</span><button className="icon-action" title={t('Understand the method')} aria-label={t('Understand the method')} onClick={() => navigate('evidence')}><CircleHelp size={18} /></button></div>
        <h2 title={t(selected.name)}>{t(selected.name.split(' / ')[0])}</h2><p>{t(template.name)}</p>
        <div className="summary-row"><span><Flag size={14} />{t(' Active objectives')}</span><strong className="mono">{active.length}</strong></div>
        <div className="summary-row"><span><Globe2 size={14} />{t(' Maximum Earth sites')}</span><strong className="mono">{k}</strong></div>
        <button className="primary-button" disabled={!active.length} title={!active.length ? t('Select at least one objective with a positive priority') : undefined} onClick={() => navigate('campaign')}>{t(copy.brief.design)}<ArrowRight size={17} /></button>
        {!active.length && <p className="warning-text" role="status">{t('Select at least one objective with a positive priority.')}</p>}
      </aside>
    </div>
  </main>;
}
