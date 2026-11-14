// EGIZ · Mission Home (#/mission). The operational centre of one mission: where it is, what was found, which Earth
// places rehearse it, what the simulations say, what is out of date, what is still unknown and what to do next —
// with every EGIZ workspace one click away, opened in the mission's context. Every line is read from the mission's
// investigation record, the loaded index or the campaign dataset; nothing here is computed for display only.
import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowRight, ArrowUpRight, BookOpen, ChevronRight, CircleHelp, ClipboardList, LayoutGrid, ListChecks, MapPin, NotebookPen, CircleAlert, Compass, Cpu, Download, Earth, Film, Flag, FolderOpen, GitCompareArrows, Globe2, Moon, Mountain, PenLine, Repeat, RotateCcw, Satellite, Search, ShieldCheck, Sun, Truck, Wrench, type LucideIcon } from 'lucide-react';
import { t, useLanguage } from '../i18n';
import { useAppStore, type Route } from '../state/store';
import { dataModeInfo } from '../data/modes';
import { downloadText } from '../lib/download';
import { aggregate } from '../discover/engine';
import { BODY_LABEL } from '../planet/terrain/site';
import { usePlanetData } from '../planet/workspace/data';
import { buildReport, JOURNEY_STEPS, serializeInvestigation } from '../planet/workspace/investigation';
import { usePlanet, type World } from '../planet/workspace/store';
import { analysisCurrent } from '../planet/journey/analysis';
import { knownUnknown } from '../planet/journey/knowledge';
import { goStep, startMission } from './actions';
import { STEP_INFO, staleItems, stepState } from './journey';
import { contextNote, openWorkspace, syncCampaignTarget, WORKSPACES } from './nav';
import { WorldChoice } from './WorldChoice';
import { fmtLat, fmtLon, short, utcShort } from './format';
import { ReliefBar, SlopeGauge, SunArc } from './Infographics';
import { More } from './More';
import { trTitle } from './trEngine';
import './expedition.css';

/** Sections of the dashboard, in page order: the bar under the header jumps to them and shows where you are. */
const SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'mh-overview', label: 'Overview', icon: LayoutGrid }, { id: 'mh-next', label: 'Next', icon: ListChecks }, { id: 'mh-site', label: 'Site', icon: MapPin },
  { id: 'mh-findings', label: 'Findings', icon: Activity }, { id: 'mh-analogs', label: 'Earth analogs', icon: Earth }, { id: 'mh-gaps', label: 'Gaps', icon: CircleHelp },
  { id: 'mh-sims', label: 'Simulations', icon: Truck }, { id: 'mh-tools', label: 'Workspaces', icon: ClipboardList }, { id: 'mh-decide', label: 'Record', icon: NotebookPen },
];
const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
const H = ({ id, children }: { id: string; children: React.ReactNode }) => { const sec = SECTIONS.find(x => x.id === id), Icon = sec?.icon; return <h2 className="mh-h2">{Icon && <Icon size={14} aria-hidden="true" />}{children}</h2>; };
const TOOL_ICON: Partial<Record<Route, LucideIcon>> = { explore: Compass, discover: Search, atlas: ShieldCheck, astral: Satellite, planet: Mountain, studio: Moon, lab: Wrench, campaign: Flag, evidence: BookOpen, twin: Sun, home: Film };

interface Action { label: string; why: string; go(): void }
/** Each next action shows where it leads, with an icon, so it reads as a destination rather than a sentence. */
const ACTION_META: Record<string, { icon: LucideIcon; where: string }> = {
  'Choose a site': { icon: Globe2, where: 'Expedition' }, 'Run the site analysis': { icon: Cpu, where: 'Analysis' }, 'Re-run the site analysis': { icon: Cpu, where: 'Analysis' },
  'Choose Earth analogs': { icon: Earth, where: 'Earth analogs' }, 'Compare alternative sites': { icon: GitCompareArrows, where: 'Alternatives' },
  'Inspect the terrain in 3D': { icon: Mountain, where: 'Planetary Studio' }, 'Simulate a rover traverse': { icon: Truck, where: 'Planetary Studio' },
  'Check what the analogs can rehearse': { icon: ShieldCheck, where: 'ATLAS-Π' }, 'Plan the field campaign': { icon: Flag, where: 'Field Campaign' }, 'Record your conclusion': { icon: PenLine, where: 'Below' },
};
export default function MissionHome() {
  useLanguage();
  const dataMode = useAppStore(a => a.dataMode), data = useAppStore(a => a.data); usePlanetData(dataMode);
  const s = usePlanet(), world = s.world(), b = s.bundle, x = s.inv.target ? s.target() : null, weights = s.weights();
  useEffect(() => { if (world && x) usePlanet.getState().enterHome(); }, [world, x?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { syncCampaignTarget(); }, [data, world]); // a data-mode switch reloads the campaign dataset
  const agg = useMemo(() => (s.shard && x && s.shard.target === x.id ? aggregate(s.shard, weights) : null), [s.shard, x?.id, JSON.stringify(weights)]); // eslint-disable-line react-hooks/exhaustive-deps
  const [here, setHere] = useState('mh-overview');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(es => { const v = es.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (v) setHere(v.target.id); }, { rootMargin: '-120px 0px -55% 0px' });
    for (const sec of SECTIONS) { const el = document.getElementById(sec.id); if (el) io.observe(el); }
    return () => io.disconnect();
  });
  const [draft, setDraft] = useState(s.inv.decision?.text ?? ''); useEffect(() => setDraft(s.inv.decision?.text ?? ''), [s.inv.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!world) return <main className="mh mh-empty"><WorldChoice /></main>;
  const a = s.inv.analysis, current = analysisCurrent(a, x?.id, weights), stale = staleItems(s), ref = x ? s.refs.find(r => r.id === x.id) : undefined;
  const kept = s.inv.candidates, missing = b && x ? knownUnknown(b, x).filter(d => d.status !== 'measured' && d.status !== 'not_applicable') : [];
  const done = JOURNEY_STEPS.filter(id => stepState(id, s) === 'done').length;
  const appTarget = data?.targets.targets.find(z => z.body === world), template = appTarget ? data?.templates.templates.find(tp => appTarget.templates.includes(tp.id)) : undefined;
  const run = appTarget ? data?.results.runs.find(r => r.target === appTarget.id) : undefined, campaign = run?.campaigns.reduce((p, q) => (q.k > p.k ? q : p), run.campaigns[0]);
  const siteName = (id: string) => data?.candidates.tiles.find(tl => tl.id === id)?.name ?? id;
  const other: World = world === 'moon' ? 'mars' : 'moon';

  // What to do next: derived from what the record does and does not yet contain.
  const actions: Action[] = [];
  if (!x) actions.push({ label: 'Choose a site', why: 'Explore the planet and pick a measured site to investigate.', go: () => goStep('explore') });
  else {
    if (!current) actions.push({ label: a ? 'Re-run the site analysis' : 'Run the site analysis', why: a ? 'The site or priorities changed since the last run.' : 'Put EGIZ’s engines to work on the site.', go: () => goStep('analysis') });
    if (!kept.length || (s.inv.analogsFor && s.inv.analogsFor !== x.id)) actions.push({ label: 'Choose Earth analogs', why: 'Keep the Earth places that could rehearse this mission.', go: () => goStep('analogs') });
    if (stepState('alternatives', s) !== 'done') actions.push({ label: 'Compare alternative sites', why: 'See whether another measured site would serve the mission better.', go: () => goStep('alternatives') });
    if (ref && !s.inv.marks.length && !s.inv.measurements.length) actions.push({ label: 'Inspect the terrain in 3D', why: `${t('Measured terrain is packaged for this site')} (${ref.postingM} m): ${t('mark landing zones, hazards and science targets.')}`, go: () => openWorkspace('planet') });
    if (!s.inv.experiments.length) actions.push({ label: 'Simulate a rover traverse', why: ref ? 'Drive the rover digital twin across the measured terrain and save the experiment.' : 'Rover simulation needs packaged terrain; the Engineering Lab runs traverse, launch, descent and EVA models.', go: () => openWorkspace(ref ? 'planet' : 'lab') });
    if (kept.length) actions.push({ label: 'Check what the analogs can rehearse', why: 'ATLAS-Π assesses each mission task for Earth sites, with certificates and a field-measurement plan.', go: () => openWorkspace('atlas') });
    actions.push({ label: 'Plan the field campaign', why: 'Choose objectives and the fewest Earth sites that cover them.', go: () => openWorkspace('campaign') });
    if (!s.inv.decision?.text) actions.push({ label: 'Record your conclusion', why: 'Write what you conclude and what must be measured next.', go: () => document.getElementById('mh-decide')?.scrollIntoView({ behavior: 'smooth', block: 'center' }) });
  }
  const report = () => downloadText(buildReport(s.inv, { site: s.site, layers: s.layers, discovery: b && x && s.shard?.target === x.id ? { bundle: b, target: x, shard: s.shard, weights, selected: kept.at(-1) ?? null, compare: kept.slice(-4), validation: s.validation } : null, atlasVersion: s.atlas?.version ?? null, generatedUtc: new Date().toISOString() }), `${s.inv.id}-report.md`);

  const findings = a?.findings ?? [], nCaution = findings.filter(f => f.severity === 'caution').length, nReject = findings.filter(f => f.severity === 'reject').length;
  const bestFid = agg && kept.length && (!s.inv.analogsFor || s.inv.analogsFor === x?.id) ? Math.max(...kept.map(id => { const k = b!.windows.id.indexOf(id); return k >= 0 ? agg.fidelity[k] : 0; })) : null;
  const fmax = agg ? Math.max(0.05, ...kept.map(id => { const k = b!.windows.id.indexOf(id); return k >= 0 ? agg.hi[k] : 0; })) : 1;
  const peers = b && x ? b.targets.filter(p => p.body === x.body && p.id !== x.id) : [];

  return <main className="mh mh-dash" aria-labelledby="mh-title">
    <header className="mh-top">
      <div className="mh-top-id">
        <p className="eg-eyebrow"><span className={`xp-body-dot b-${world}`} aria-hidden="true" />{t('Mission Home')} · {t(BODY_LABEL[world])}</p>
        <h1 id="mh-title" className="eg-display">{x ? short(x.name) : t('No site yet')}</h1>
        {x && <p className="mh-coord">{fmtLat(x.lat)} · {fmtLon(x.lon)} · {x.dem}</p>}
      </div>
      <div className="mh-top-side">
        <label className="mh-title-edit"><span>{t('Mission')}</span><input value={s.inv.title} onChange={e => s.patchInv({ title: e.target.value })} aria-label={t('Mission name')} /></label>
        <div className="mh-head-actions">
          <button className="mh-chip-btn" onClick={() => goStep('explore', null)}><Repeat size={14} />{t('Change site')}</button>
          <button className="mh-chip-btn" onClick={() => startMission(other)}><Globe2 size={14} />{t(other === 'moon' ? 'Start a Moon mission' : 'Start a Mars mission')}</button>
        </div>
      </div>
    </header>

    <nav className="mh-nav" aria-label={t('Mission Home sections')}>
      <span className="mh-nav-ctx"><span className={`xp-body-dot b-${world}`} aria-hidden="true" />{x ? short(x.name) : t(BODY_LABEL[world])}</span>
      <ol>{SECTIONS.map(sec => { const Icon = sec.icon; return <li key={sec.id}><button className={here === sec.id ? 'on' : ''} aria-current={here === sec.id ? 'location' : undefined} onClick={() => jump(sec.id)}><Icon size={13} aria-hidden="true" /><span>{t(sec.label)}</span></button></li>; })}</ol>
    </nav>

    {/* KPI strip: one number and one small picture each */}
    <section id="mh-overview" className="mh-kpis" aria-label={t('Mission status')}>
      <button className="mh-kpi" onClick={() => goStep(JOURNEY_STEPS.find(id => stepState(id, s) !== 'done') ?? 'analogs')}>
        <span className="mh-kpi-l">{t('Investigation')}</span>
        <span className="mh-ring" style={{ '--p': done / JOURNEY_STEPS.length } as React.CSSProperties}><b>{done}<em>/{JOURNEY_STEPS.length}</em></b></span>
        <span className="mh-steps-mini">{JOURNEY_STEPS.map(id => <i key={id} className={`st-${stepState(id, s)}`} title={t(STEP_INFO[id].label)} />)}</span>
      </button>
      <button className={`mh-kpi ${a ? (current ? '' : 'warn') : 'empty'}`} onClick={() => goStep('analysis')}>
        <span className="mh-kpi-l">{t('Analysis')}</span>
        <b className="mh-kpi-v">{a ? t(a.verdict) : '—'}</b>
        <span className="mh-kpi-s">{a ? <>{nReject > 0 && <i className="sev r">{nReject}</i>}{nCaution > 0 && <i className="sev c">{nCaution}</i>}{current ? utcShort(a.ranUtc).slice(5) : t('out of date')}</> : t('not run')}</span>
      </button>
      <button className={`mh-kpi ${kept.length ? '' : 'empty'}`} onClick={() => goStep('analogs')}>
        <span className="mh-kpi-l">{t('Earth analogs')}</span>
        <b className="mh-kpi-v">{kept.length}</b>
        <span className="mh-kpi-s">{bestFid !== null ? <><span className="mh-mini-bar"><i style={{ width: `${Math.min(100, bestFid * 100)}%` }} /></span>{t('best')} {bestFid.toFixed(2)}</> : t('none kept')}</span>
      </button>
      <div className="mh-kpi">
        <span className="mh-kpi-l">{t('Evidence')}</span>
        <b className="mh-kpi-v">{b && x ? b.dimensions.length - missing.length : '—'}<em>/{b?.dimensions.length ?? '—'}</em></b>
        <span className="mh-dots">{b && x && b.dimensions.map(d => <i key={d.id} className={`st-${x.dimension_status[d.id] ?? 'not_assessed'}`} title={d.label} />)}</span>
      </div>
      <button className={`mh-kpi ${s.inv.experiments.length ? '' : 'empty'}`} onClick={() => openWorkspace(ref ? 'planet' : 'lab')}>
        <span className="mh-kpi-l">{t('Simulations')}</span>
        <b className="mh-kpi-v">{s.inv.experiments.length}</b>
        <span className="mh-kpi-s">{campaign ? `${t('campaign')} ${Math.round(campaign.coverage * 100)} %` : t('none saved')}</span>
      </button>
      <button className={`mh-kpi ${stale.length ? 'warn' : ''}`} onClick={() => jump('mh-gaps')}>
        <span className="mh-kpi-l">{t('Open issues')}</span>
        <b className="mh-kpi-v">{missing.length + stale.length}</b>
        <span className="mh-kpi-s">{stale.length ? `${stale.length} ${t('to recalculate')}` : `${missing.length} ${t('data gaps')}`}</span>
      </button>
    </section>

    {stale.length > 0 && <section className="mh-stale" aria-label={t('Needs recalculation')}>
      <CircleAlert size={16} />
      <ul>{stale.map(z => <li key={z.what}><b>{t(z.what)}</b><span>{z.why}</span><button className="mh-chip-btn" onClick={() => (z.fix.step ? goStep(z.fix.step) : openWorkspace(z.fix.route ?? 'planet'))}>{t(z.fix.label)}<ArrowRight size={13} /></button></li>)}</ul>
    </section>}

    <div className="mh-board">
      <section id="mh-next" className="mh-panel mh-next" aria-label={t('Next actions')}>
        <H id="mh-next">{t('Next actions')}</H>
        <ol>{actions.slice(0, 4).map((z, i) => { const m = ACTION_META[z.label], Icon = m?.icon ?? ArrowRight, where = z.label === 'Simulate a rover traverse' && !ref ? 'Engineering Lab' : m?.where; return <li key={z.label} className={i === 0 ? 'first' : ''}><button onClick={z.go}><span className="mh-ico" aria-hidden="true"><Icon size={20} strokeWidth={1.5} /></span><span className="mh-act"><b>{t(z.label)}</b><em>{t(z.why)}</em></span><span className="mh-go">{where && <span>{t(where)}</span>}<ArrowRight size={16} strokeWidth={1.8} /></span></button></li>; })}</ol>
      </section>

      <section id="mh-site" className="mh-panel mh-site" aria-label={t('The site')}>
        <H id="mh-site">{t('The site')}</H>
        {x && b ? <div className="ig-grid ig-grid-1"><SlopeGauge x={x} /><SunArc x={x} /><ReliefBar x={x} peers={peers} /></div> : <p className="mh-dim">{t('Choose a site to see its measured terrain.')}</p>}
        {ref && <button className="mh-chip-btn" onClick={() => openWorkspace('planet')}><Mountain size={14} />{t('Open measured 3D terrain')} · {ref.postingM} m</button>}
      </section>

      <section id="mh-findings" className="mh-panel mh-findings" aria-label={t('Scientific findings')}>
        <H id="mh-findings">{t('Scientific findings')}</H>
        {a ? <ul className="mh-sev">{findings.slice(0, 6).map(f => <li key={f.title} className={`f-${f.severity}`}><details><summary><i aria-hidden="true" /><b>{trTitle(f.title)}</b><ChevronRight size={13} className="xp-more-arrow" aria-hidden="true" /></summary><p>{f.detail}</p></details></li>)}</ul> : <p className="mh-dim">{t('No analysis has been run for this mission yet.')}</p>}
        {a && <button className="mh-link" onClick={() => goStep('analysis')}>{t('Inspect every step and statistic')}<ArrowUpRight size={12} /></button>}
      </section>

      <section id="mh-analogs" className="mh-panel mh-analogs" aria-label={t('Earth analogs')}>
        <H id="mh-analogs">{t('Earth analogs')}</H>
        {kept.length ? <ol className="mh-bars">{kept.map(id => { const k = b ? b.windows.id.indexOf(id) : -1; return <li key={id}><span className="mh-bars-l"><b>{k >= 0 ? b!.windows.name[k] : id}</b><em>{k >= 0 ? b!.windows.country[k] ?? '' : ''}</em></span>
          {agg && k >= 0 ? <span className="mh-bars-v"><span className="xp-int"><i style={{ left: `${(agg.lo[k] / fmax) * 100}%`, width: `${((agg.hi[k] - agg.lo[k]) / fmax) * 100}%` }} /><b style={{ left: `${(agg.fidelity[k] / fmax) * 100}%` }} /></span><em>{agg.fidelity[k].toFixed(2)}</em></span> : <span />}</li>; })}</ol>
          : <p className="mh-dim">{t('No Earth analog kept yet.')}</p>}
        {s.inv.analogsFor && x && s.inv.analogsFor !== x.id && <p className="mh-warn">{t('Ranked for a previous site — review them.')}</p>}
        <button className="mh-link" onClick={() => goStep('analogs')}>{t('Explore Earth analogs on the map')}<ArrowUpRight size={12} /></button>
      </section>

      <section id="mh-gaps" className="mh-panel mh-gaps" aria-label={t('Open questions and data gaps')}>
        <H id="mh-gaps">{t('Open questions and data gaps')}</H>
        <ul className="mh-tags">{missing.map(d => <li key={d.id} className={`st-${d.status}`}>{d.label}</li>)}<li>{t('Vehicle-scale terrain')}</li><li>{t('Soil mechanics')}</li></ul>
        <More label="How each gap would be closed"><ul className="xp-limits">{missing.map(d => <li key={d.id}><b>{d.label}</b>: {d.next || t(d.status.replace('_', ' '))}</li>)}<li><b>{t('Vehicle-scale terrain')}</b>: {t('Slope and roughness below the elevation-model baseline are not resolved; field verification is needed along any route.')}</li><li><b>{t('Soil mechanics')}</b>: {t('Simulated slip and sinkage are not validated without in-situ bearing and shear tests.')}</li></ul></More>
      </section>

      <section id="mh-sims" className="mh-panel mh-sims" aria-label={t('Simulation results')}>
        <H id="mh-sims">{t('Simulation results')}</H>
        {s.inv.experiments.length ? <ul className="mh-list">{s.inv.experiments.slice(-3).map(e => <li key={e.id}><b>{e.name}</b><span>{e.summary.outcome} · {(e.summary.distanceM / 1000).toFixed(2)} km · {Math.round(e.summary.energyUsedWh)} Wh <em className="xp-ev ev-simulated">simulated</em></span></li>)}</ul> : <p className="mh-dim">{t('No saved rover experiment yet.')}</p>}
        {campaign && <div className="mh-camp"><span className="mh-kpi-l">{t('Field campaign')} · k = {campaign.k}</span><span className="mh-mini-bar wide"><i style={{ width: `${campaign.coverage * 100}%` }} /></span><b>{Math.round(campaign.coverage * 100)} %</b><span className="mh-dim">{campaign.sites.map(z => t(siteName(z.id))).join(' · ')} ({t(dataModeInfo[dataMode].label)})</span></div>}
        {template && <ul className="mh-tags obj">{template.objectives.map(o => <li key={o.id}>{t(o.name)}</li>)}</ul>}
      </section>
    </div>

    <section id="mh-tools" className="mh-tools" aria-label={t('Workspaces')}>
      <H id="mh-tools">{t('Every EGIZ workspace, in this mission’s context')}</H>
      <ul className="mh-tiles">{WORKSPACES.filter(w => w.route !== 'mission').map(w => { const Icon = TOOL_ICON[w.route] ?? ArrowUpRight, note = contextNote(w.route); return <li key={w.route}><button onClick={() => openWorkspace(w.route as Route)} title={t(w.text)}>
        <Icon size={20} strokeWidth={1.5} aria-hidden="true" /><b>{t(w.title)}</b><em>{t(note ?? w.text)}</em></button></li>; })}</ul>
    </section>

    <div className="mh-foot">
      <section id="mh-decide" className="mh-panel mh-decide" aria-label={t('Your conclusion')}>
        <H id="mh-decide">{t('Your conclusion')}</H>
        <textarea rows={3} value={draft} onChange={e => setDraft(e.target.value)} placeholder={t('What do you conclude, and what is the next investigation?')} aria-label={t('Conclusion')} />
        <div className="xp-row"><button className="eg-button" disabled={!draft.trim() || draft === s.inv.decision?.text} onClick={() => { s.patchInv({ decision: { text: draft.trim(), utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z') } }); s.log('decision', `Recorded the conclusion: “${draft.trim().slice(0, 140)}”`); }}>{t('Record conclusion')}</button>
          {s.inv.decision && <span className="mh-dim">{t('Recorded')} {utcShort(s.inv.decision.utc)}</span>}
          <button className="mh-chip-btn" onClick={report}><Download size={14} />{t('Report (Markdown)')}</button>
          <button className="mh-chip-btn" onClick={() => downloadText(serializeInvestigation(s.inv), `${s.inv.id}.json`, 'application/json')}><Download size={14} />{t('Mission record (JSON)')}</button></div>
      </section>
      <section className="mh-panel mh-records" aria-labelledby="mh-records">
        <h2 id="mh-records" className="mh-h2">{t('Saved missions')}</h2>
        <ul className="mh-list">{s.saved.slice(0, 5).map(e => <li key={e.id} className={e.id === s.inv.id ? 'on' : ''}><b>{e.title}</b><span>{utcShort(e.updatedUtc)}{e.id === s.inv.id ? ` · ${t('open')}` : ''}</span>{e.id !== s.inv.id && <button className="mh-link" onClick={() => { const err = usePlanet.getState().openInvestigation(e.id); if (err) alert(err); }}><FolderOpen size={12} />{t('Open')}</button>}</li>)}</ul>
        {(s.inv.trail?.length ?? 0) > 0 && <details className="mh-trail"><summary>{t('Investigation trail')} ({s.inv.trail!.length})</summary><ol>{s.inv.trail!.slice(-40).reverse().map((e, i) => <li key={i}><time>{e.utc.slice(5, 16).replace('T', ' ')}</time>{e.text}</li>)}</ol></details>}
        <More label="About the data"><p className="mh-dim mh-small">{t('The guided expedition, Earth analogs and 3D terrain always use the measured index. The data source')} ({t(dataModeInfo[dataMode].label)}) {t('applies to Field Campaign, Engineering Lab and ATLAS-Π.')} <button className="mh-link" onClick={() => { usePlanet.getState().newInvestigation(); }}><RotateCcw size={12} />{t('Start over')}</button></p></More>
      </section>
    </div>
  </main>;
}
