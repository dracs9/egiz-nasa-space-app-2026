// ATLAS-Pi workspace: mission-conditioned transferability, constellations, counterfactuals,
// value-of-information field plans, red team and validation. Reads only the computed bundle.
// Written with AI assistance (Claude); human scientific review pending.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Download, ExternalLink, FlaskConical, TriangleAlert } from 'lucide-react';
import { t, useLanguage } from '../i18n';
import { useAppStore } from '../state/store';
import { usePlanet } from '../planet/workspace/store';
import { dataModeInfo } from '../data/modes';
import { decimal, safeUrl } from '../lib/format';
import { downloadText } from '../lib/download';
import { terramechanics } from './physics';
import type { AtlasBundle, Cell, Rover, Soil, Status } from './types';
import './atlas.css';

const MODES = [
  ['tensor', 'Operational Transferability Tensor'], ['constellation', 'Analog constellation'], ['counterfactual', 'Counterfactual physics'],
  ['planner', 'Field research plan'], ['redteam', 'Scientific red team'], ['discovery', 'Discovery (Kazakhstan)'], ['dossier', 'Dossier'], ['validation', 'Validation'],
] as const;
type Mode = typeof MODES[number][0];
export const STATUS_LABEL: Record<Status, string> = { SUPPORTED: 'Supported', CONDITIONAL: 'Conditional', WEAK: 'Weak', NON_TRANSFERABLE: 'Non-transferable', UNKNOWN: 'Unknown' };
const pct = (v: number | null | undefined) => v == null ? '—' : `${Math.round(v * 100)}%`;

export function loadAtlas(fetcher: typeof fetch, path: string, signal?: AbortSignal): Promise<AtlasBundle> {
  return fetcher(`${import.meta.env.BASE_URL}${path}/atlas_pi.json`, { cache: 'no-cache', signal }).then(async r => {
    if (!r.ok) throw new Error('ATLAS-Π bundle not found for this dataset. Run python -m pipeline.analog_transfer build.');
    const doc = await r.json() as AtlasBundle;
    if (doc.schema !== 'egiz.atlas_pi' || !/^1\./.test(doc.version) || doc.synthetic !== false || !Array.isArray(doc.tensor?.cells)) throw new Error('ATLAS-Π bundle has an unsupported format.');
    return doc;
  });
}

export default function AtlasLab() {
  useLanguage();
  const { dataMode, setDataMode } = useAppStore();
  const [doc, setDoc] = useState<AtlasBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (dataMode === 'demo') return;
    const controller = new AbortController(); setError(null);
    loadAtlas(fetch, dataModeInfo[dataMode].path, controller.signal).then(setDoc).catch(e => { if (!controller.signal.aborted) setError(String(e.message ?? e)); });
    return () => controller.abort();
  }, [dataMode]);
  if (dataMode === 'demo') return <main className="page atlas-page"><Intro /><div className="atlas-notice" role="status"><TriangleAlert size={16} /><p>{t('ATLAS-Π runs only on measured data. The synthetic demo has no transferability bundle.')}</p><button className="primary-button" onClick={() => setDataMode('pilot')}>{t('Open measured pilot')}</button></div></main>;
  if (error) return <main className="page atlas-page"><Intro /><div className="atlas-notice" role="alert"><TriangleAlert size={16} /><p>{t(error)}</p></div></main>;
  if (!doc) return <main className="page atlas-page eg-loading"><span className="eg-loading-bar" aria-hidden="true" /><h1>{t('Loading ATLAS-Π…')}</h1></main>;
  return <Workspace doc={doc} />;
}

function Intro() {
  return <div className="page-intro atlas-intro"><span className="eyebrow">ATLAS-Π · {t('Transferability')}</span>
    <h1>{t('What can this Earth site actually test?')}</h1>
    <p>{t('Each Earth site is assessed per mission task. Similarity, evidence, resolution and physics stay separate; a status is assigned by documented rules, never by a hidden blended score.')}</p></div>;
}

function Workspace({ doc }: { doc: AtlasBundle }) {
  const missions = doc.registry.tasks.missions;
  // Start from the mission's site when ATLAS-Π covers it, else from a mission on the same world.
  const [missionId, setMissionId] = useState(() => { const p = usePlanet.getState(), site = p.inv.target, w = p.world(); return (missions.find(m => m.target === site) ?? (w ? missions.find(m => doc.targets.find(x => x.id === m.target)?.body === w) : undefined) ?? missions.find(m => m.target === 'MARS_JEZERO') ?? missions[0]).id; });
  const [mode, setMode] = useState<Mode>('tensor');
  const mission = missions.find(m => m.id === missionId)!;
  const target = doc.targets.find(x => x.id === mission.target)!;
  const [selected, setSelected] = useState<{ site: string; task: string } | null>(null);
  const [dossierSite, setDossierSite] = useState(doc.constellations[missionId]['3'].selected[0] ?? doc.sites[0].id);
  useEffect(() => { setSelected(null); setDossierSite(doc.constellations[missionId]['3'].selected[0] ?? doc.sites[0].id); }, [missionId, doc]);
  const open = (site: string) => { setDossierSite(site); setMode('dossier'); };
  return <main className="page atlas-page">
    <Intro />
    <div className="atlas-toolbar">
      <label className="atlas-field"><span>{t('Mission')}</span>
        <select value={missionId} onChange={e => setMissionId(e.target.value)}>{missions.map(m => <option key={m.id} value={m.id}>{t(m.name)} — {doc.targets.find(x => x.id === m.target)?.name}</option>)}</select></label>
      <div className="atlas-meta"><span className={`atlas-body body-${target.body}`}>{target.body === 'moon' ? t('Moon') : t('Mars')}</span>
        <span>{target.dem_product}</span><span title={doc.content_sha256}>{doc.engine} · {doc.content_sha256.slice(0, 10)}</span></div>
    </div>
    <nav className="atlas-tabs" aria-label={t('Transferability workspace')}>{MODES.map(([id, label]) =>
      <button key={id} aria-current={mode === id ? 'page' : undefined} className={mode === id ? 'active' : ''} onClick={() => setMode(id)}>{t(label)}</button>)}</nav>
    {mode === 'tensor' && <TensorView doc={doc} target={target.id} selected={selected} onSelect={setSelected} onDossier={open} />}
    {mode === 'constellation' && <ConstellationView doc={doc} missionId={missionId} onDossier={open} />}
    {mode === 'counterfactual' && <CounterfactualView doc={doc} body={target.body} target={target.id} />}
    {mode === 'planner' && <PlannerView doc={doc} missionId={missionId} />}
    {mode === 'redteam' && <RedTeamView doc={doc} missionId={missionId} onDossier={open} />}
    {mode === 'discovery' && <DiscoveryView doc={doc} />}
    {mode === 'dossier' && <DossierView doc={doc} target={target.id} site={dossierSite} setSite={setDossierSite} />}
    {mode === 'validation' && <ValidationView doc={doc} />}
    <footer className="atlas-limits"><h2>{t('Limitations')}</h2><ul>{doc.limitations.map(l => <li key={l}>{t(l)}</li>)}</ul></footer>
  </main>;
}

const siteLabel = (doc: AtlasBundle, id: string) => doc.sites.find(s => s.id === id)?.name ?? id;
export function StatusChip({ status }: { status: Status }) { return <span className={`atlas-status s-${status.toLowerCase()}`}>{t(STATUS_LABEL[status])}</span>; }
function Meter({ label, value, ci, note }: { label: string; value: number | null; ci?: [number, number] | null; note?: ReactNode }) {
  return <div className="atlas-meter"><div className="atlas-meter-head"><span>{t(label)}</span><strong>{decimal(value)}</strong></div>
    <div className="atlas-meter-track" aria-hidden="true">{ci && <span className="atlas-meter-ci" style={{ left: `${ci[0] * 100}%`, width: `${Math.max(0.5, (ci[1] - ci[0]) * 100)}%` }} />}
      {value != null && <span className="atlas-meter-dot" style={{ left: `${value * 100}%` }} />}
      <span className="atlas-meter-tick" style={{ left: '13.53%' }} /><span className="atlas-meter-tick" style={{ left: '60.65%' }} /></div>
    {note && <small>{note}</small>}</div>;
}

// ------------------------------------------------------------------ tensor
function TensorView({ doc, target, selected, onSelect, onDossier }: { doc: AtlasBundle; target: string; selected: { site: string; task: string } | null; onSelect: (s: { site: string; task: string } | null) => void; onDossier: (site: string) => void }) {
  const body = doc.targets.find(x => x.id === target)!.body;
  const tasks = doc.registry.tasks.tasks.filter(x => x.bodies.includes(body));
  const cells = useMemo(() => new Map(doc.tensor.cells.filter(c => c.target === target).map(c => [`${c.site}|${c.task}`, c])), [doc, target]);
  const cell = selected ? cells.get(`${selected.site}|${selected.task}`) : undefined;
  const counts = Object.fromEntries((Object.keys(STATUS_LABEL) as Status[]).map(s => [s, [...cells.values()].filter(c => c.status === s).length]));
  return <section className="atlas-section">
    <div className="atlas-legend">{(Object.keys(STATUS_LABEL) as Status[]).map(s => <span key={s}><StatusChip status={s} /> {counts[s]}</span>)}
      <span className="muted">{t('Number in a cell: task match (0–1). Ticks mark one and two declared tolerances.')}</span></div>
    <div className="atlas-matrix" role="region" aria-label={t('Operational Transferability Tensor')} tabIndex={0}>
      <table><thead><tr><th scope="col">{t('Earth site')}</th><th scope="col" title={t('Unconditioned baseline: equal-weight geometric mean of terrain matches')}>{t('General similarity')}</th>
        {tasks.map(task => <th key={task.id} scope="col" title={t(task.description)}>{t(task.name)}</th>)}</tr></thead>
        <tbody>{doc.sites.map(site => <tr key={site.id}><th scope="row"><button className="link-button" onClick={() => onDossier(site.id)}>{site.name ?? site.id}</button><small>{site.country} · {site.process?.tags.join(', ')} ({t('grade')} {site.process?.grade})</small></th>
          <td className="atlas-general">{decimal(doc.tensor.general_similarity[`${site.id}|${target}`])}</td>
          {tasks.map(task => { const c = cells.get(`${site.id}|${task.id}`)!; const active = selected?.site === site.id && selected.task === task.id;
            const stable = doc.stability[`${site.id}|${target}|${task.id}`]?.stable;
            return <td key={task.id}><button className={`atlas-cell s-${c.status.toLowerCase()} ${active ? 'active' : ''}`} aria-pressed={active}
              aria-label={`${site.name ?? site.id}, ${task.name}: ${STATUS_LABEL[c.status]}, ${t('task match')} ${decimal(c.axes.task_match)}`} onClick={() => onSelect(active ? null : { site: site.id, task: task.id })}>
              <span>{decimal(c.axes.task_match)}</span>{!stable && <i title={t('Status changes when tolerances are halved or doubled')}>~</i>}</button></td>; })}
        </tr>)}</tbody></table></div>
    {cell ? <CellDetail doc={doc} cell={cell} /> : <p className="atlas-hint">{t('Select a cell to open its certificate, factor evidence, physics and evidence trace.')}</p>}
  </section>;
}

function CellDetail({ doc, cell }: { doc: AtlasBundle; cell: Cell }) {
  const task = doc.registry.tasks.tasks.find(x => x.id === cell.task)!;
  const cert = doc.certificates[cell.certificate];
  const stab = doc.stability[`${cell.site}|${cell.target}|${cell.task}`];
  const nodes = useMemo(() => new Map(doc.evidence_graph.nodes.map(n => [n.id, n])), [doc]);
  const datasets = cert.evidence.filter(id => id.startsWith('DS:')).map(id => nodes.get(id)!).filter(Boolean);
  const refs = cert.evidence.filter(id => id.startsWith('REF:') || id.startsWith('LIT:')).map(id => nodes.get(id)!).filter(Boolean);
  const a = cell.axes;
  return <article className="atlas-detail" aria-label={t('Certificate')}>
    <header><div><span className="eyebrow">{cert.id}</span><h2>{siteLabel(doc, cell.site)} → {t(task.name)}</h2><p>{t(cert.claim)}</p></div><StatusChip status={cell.status} /></header>
    <div className="atlas-axes">
      <Meter label="Task match" value={a.task_match} ci={a.task_match_ci90} note={<>{t('90% block-bootstrap interval')}: {a.task_match_ci90 ? `${decimal(a.task_match_ci90[0])}–${decimal(a.task_match_ci90[1])}` : '—'}</>} />
      <Meter label="Evidence coverage" value={a.evidence_coverage} note={t('Share of task factor weight with any value')} />
      <Meter label="Evidence quality" value={a.evidence_quality} note={t('Observed 1 · derived 0.9 · model 0.7 · assumed 0.5 · curated by grade')} />
      <Meter label="Operational relevance" value={a.operational_relevance} note={t('Primary factor weight within one tolerance')} />
      <div className="atlas-axis-text"><span>{t('Resolution')}</span><strong>{a.resolution_sufficient ? t('sufficient') : `${t('limited')}: ${a.resolution_limited_factors.join(', ')}`}</strong><small>{t('Required')}: {task.required_resolution_m} m</small></div>
      <div className="atlas-axis-text"><span>{t('Tolerance stability')}</span><strong>{stab?.stable ? t('stable') : `${t('changes')}: ×0.5 → ${t(STATUS_LABEL[stab['x0.5']])}, ×2 → ${t(STATUS_LABEL[stab.x2])}`}</strong></div>
    </div>
    <div className="atlas-columns">
      <section><h3>{t('Explanation')}</h3><ul>{cell.explanation.map(l => <li key={l}>{t(l)}</li>)}</ul>
        <h3>{t('Counter-evidence')}</h3><ul className="atlas-counter">{cell.counter_evidence.length ? cell.counter_evidence.map(l => <li key={l}>{t(l)}</li>) : <li>{t('None recorded.')}</li>}</ul></section>
      <section><h3>{t('Physical mismatch')}</h3>{cell.physics.length ? <ul>{cell.physics.map(p => <li key={p.factor}><strong>{t(p.name)}</strong> ({t(p.role)}) — {t('reproducible in field')}: {t(p.reproducible_in_field)}{p.corrections.length ? `; ${t('correction')}: ${p.corrections.join(', ')}` : ''}<br /><small>{p.lab_alternatives.join(' · ')}</small></li>)}</ul> : <p>{t('No physical dependency declared for this task.')}</p>}
        {cell.limitations.length > 0 && <><h3>{t('Limitations')}</h3><ul>{cell.limitations.map(l => <li key={l}>{t(l)}</li>)}</ul></>}</section>
    </div>
    <h3>{t('Factor evidence')}</h3>
    <div className="atlas-table-wrap"><table className="atlas-table"><thead><tr><th>{t('Factor')}</th><th>{t('Role')}</th><th>{t('Earth')}</th><th>{t('Target')}</th><th>{t('Match')}</th><th>90% CI</th><th>{t('Kind')}</th><th>{t('Resolution')}</th></tr></thead>
      <tbody>{cell.factors.map(f => <tr key={f.factor} className={f.match == null ? 'missing' : ''}><th scope="row" title={f.metric}>{t(f.name)}</th><td>{t(f.role)} ×{f.weight}</td>
        <td title={f.earth?.source}>{fmtValue(f.earth?.value)} <small>{f.earth?.unit}</small></td><td title={f.target?.source}>{fmtValue(f.target?.value)} <small>{f.target?.unit}</small></td>
        <td>{decimal(f.match)}</td><td>{f.ci ? `${decimal(f.ci[0])}–${decimal(f.ci[1])}` : '—'}</td><td><span className={`atlas-kind k-${f.kind}`}>{t(f.kind)}</span></td><td>{f.effective_resolution_m ? `${f.effective_resolution_m} m` : '—'}</td></tr>)}</tbody></table></div>
    <h3>{t('Evidence trace')}</h3>
    <ul className="atlas-trace">{datasets.map(n => <li key={n.id}><code>{n.id}</code> {safeUrl(String(n.url)) ? <a href={safeUrl(String(n.url))} target="_blank" rel="noreferrer">{n.label} <ExternalLink size={12} /></a> : n.label}{n.sha256 && <small> sha256 {String(n.sha256).slice(0, 16)}…</small>}</li>)}
      {refs.map(n => <li key={n.id}><code>{n.id}</code> {n.grade ? `[${t('grade')} ${n.grade}] ` : ''}{n.citation}</li>)}</ul>
    {cert.assumptions.length > 0 && <details><summary>{t('Assumptions')} ({cert.assumptions.length})</summary><ul>{cert.assumptions.map(l => <li key={l}>{l}</li>)}</ul></details>}
    <p className="muted small-copy">{t(cert.uncertainty)} {t('Reproduce')}: <code>{cert.reproducibility.command}</code></p>
  </article>;
}
function fmtValue(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number') return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(Math.abs(v) < 1 ? 3 : 2);
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}=${x}`).join(' ');
  return String(v);
}

// ------------------------------------------------------------------ constellation
function ConstellationView({ doc, missionId, onDossier }: { doc: AtlasBundle; missionId: string; onDossier: (s: string) => void }) {
  const [k, setK] = useState<'1' | '2' | '3'>('3');
  const c = doc.constellations[missionId][k];
  const sens = doc.sensitivity[missionId];
  const rows = [['Optimised constellation', c.selected, c.objective, c.covered, c.strong], ['Top-K individual sites', c.baseline_topk_individual.selected, c.baseline_topk_individual.objective, c.baseline_topk_individual.covered, c.baseline_topk_individual.strong],
    ['Top-K by general similarity', c.baseline_general_similarity.selected, c.baseline_general_similarity.objective, c.baseline_general_similarity.covered, c.baseline_general_similarity.strong]] as const;
  return <section className="atlas-section">
    <div className="atlas-toolbar"><div className="segmented" role="group" aria-label={t('Site budget')}>{(['1', '2', '3'] as const).map(v => <button key={v} aria-pressed={k === v} onClick={() => setK(v)}>K = {v}</button>)}</div>
      <p className="muted">{t('Objective: covered requirement weight (lower bootstrap bound) minus a redundancy penalty; exact enumeration of')} {String(c.parameters.subsets_evaluated)} {t('subsets')}.</p></div>
    <div className="atlas-columns">
      <section><h2>{t('Selected sites')}</h2>
        <ol className="atlas-portfolio">{c.contributions.map(x => <li key={x.site}><button className="link-button" onClick={() => onDossier(x.site)}><strong>{siteLabel(doc, x.site)}</strong></button>
          <span>{t('marginal value')} {decimal(x.marginal_J, 3)}</span><small>{x.requirements_won.map(r => r.replace(':', ' · ')).join('; ')}</small></li>)}</ol>
        <WorldPlot doc={doc} selected={c.selected} frequency={sens.dirichlet.selection_frequency} />
      </section>
      <section><h2>{t('Why not the top individual sites?')}</h2>
        <div className="atlas-table-wrap"><table className="atlas-table"><thead><tr><th>{t('Portfolio')}</th><th>{t('Sites')}</th><th>{t('Covered')}</th><th>{t('Strong')}</th><th>J</th></tr></thead>
          <tbody>{rows.map(([label, sites, obj, cov, strong]) => <tr key={label}><th scope="row">{t(label)}</th><td>{sites.map(s => siteLabel(doc, s)).join(', ')}</td><td>{cov}/{c.per_requirement.length}</td><td>{strong}</td><td>{decimal(obj.J, 3)}</td></tr>)}</tbody></table></div>
        <p className="muted small-copy">{t('Covered: a selected site is Supported/Conditional for the task and the factor lower bound is within two tolerances. Strong: Supported and within one tolerance. The count is not the optimised quantity.')}</p>
        <h3>{t('Uncovered requirements')} ({c.uncovered.length})</h3>
        <ul className="atlas-uncovered">{c.uncovered.map(u => <li key={u.id}>{u.task} · {t(u.name)}</li>)}</ul>
        <h3>{t('Lab-only tasks')}</h3>
        <ul>{c.lab_only_tasks.map(l => <li key={l.task}><strong>{l.task}</strong> — {l.blocking.map(b => t(b)).join(', ')}<br /><small>{l.alternatives.join(' · ')}</small></li>)}</ul>
      </section>
    </div>
    <h3>{t('Pareto alternatives')}</h3>
    <div className="atlas-table-wrap"><table className="atlas-table"><thead><tr><th>{t('Sites')}</th><th>{t('Coverage')}</th><th>{t('Evidence quality')}</th><th>{t('Mean CI width')}</th><th>{t('Process tags')}</th></tr></thead>
      <tbody>{c.pareto.map(p => <tr key={p.selected.join()}><td>{p.selected.map(s => siteLabel(doc, s)).join(', ')}</td><td>{decimal(p.coverage, 3)}</td><td>{decimal(p.evidence_quality)}</td><td>{decimal(p.uncertainty)}</td><td>{p.process_diversity}</td></tr>)}</tbody></table></div>
    <h3>{t('Sensitivity to mission priorities')}</h3>
    <p className="muted">{t('Selection frequency across')} {sens.dirichlet.draws} {t('random task-weight draws; median Jaccard to nominal')} {decimal(sens.dirichlet.median_jaccard)}.</p>
    <ul className="atlas-bars">{Object.entries(sens.dirichlet.selection_frequency).sort((a, b) => b[1] - a[1]).map(([s, f]) => <li key={s}><span>{siteLabel(doc, s)}</span><span className="bar"><i style={{ width: `${f * 100}%` }} /></span><strong>{pct(f)}</strong></li>)}</ul>
  </section>;
}

function WorldPlot({ doc, selected, frequency }: { doc: AtlasBundle; selected: string[]; frequency: Record<string, number> }) {
  const x = (lon: number) => (lon + 180) / 360 * 360, y = (lat: number) => (90 - lat) / 180 * 180;
  return <svg className="atlas-world" viewBox="0 0 360 180" role="img" aria-label={t('Earth sites; selected sites are filled')}>
    <rect x="0" y="0" width="360" height="180" className="frame" />
    {[-60, -30, 0, 30, 60].map(l => <line key={l} x1="0" x2="360" y1={y(l)} y2={y(l)} className="grat" />)}
    {[-120, -60, 0, 60, 120].map(l => <line key={l} y1="0" y2="180" x1={x(l)} x2={x(l)} className="grat" />)}
    {doc.sites.map(s => { const on = selected.includes(s.id); return <g key={s.id}><circle cx={x(s.lon)} cy={y(s.lat)} r={2 + 4 * (frequency[s.id] ?? 0)} className={on ? 'on' : 'off'} /><title>{s.name}</title>
      {on && <text x={x(s.lon) + 6} y={y(s.lat) + 3}>{(s.name ?? s.id).replace(' regional window', '')}</text>}</g>; })}
  </svg>;
}

// ------------------------------------------------------------------ counterfactual
function CounterfactualView({ doc, body, target }: { doc: AtlasBundle; body: 'moon' | 'mars'; target: string }) {
  const ref = doc.counterfactual.terramechanics[body];
  const [rover, setRover] = useState<Rover>(ref.inputs.rover);
  const [soil, setSoil] = useState<Soil>(ref.inputs.soil);
  useEffect(() => { setRover(ref.inputs.rover); setSoil(ref.inputs.soil); }, [ref]);
  let result: ReturnType<typeof terramechanics> | null = null, error: string | null = null;
  try { result = terramechanics(body, rover, soil); } catch (e) { error = (e as Error).message; }
  const [site, setSite] = useState(doc.sites.find(s => s.pool !== 'kazakhstan' || s.id === 'PILOT_BOSZHIRA')!.id);
  const solar = doc.counterfactual.solar[`${site}|${target}`];
  const num = (label: string, value: number, set: (v: number) => void, step = 1, unit = '') => <label className="atlas-field small"><span>{t(label)}{unit && ` (${unit})`}</span><input type="number" step={step} value={value} onChange={e => set(Number(e.target.value))} /></label>;
  return <section className="atlas-section">
    <div className="atlas-columns">
      <section><h2>{t('Wheel–soil transfer under gravity (CF_TERRAMECHANICS)')}</h2>
        <p className="atlas-warning"><TriangleAlert size={14} /> {t('Model estimate, contested: the Bekker model has no gravity-dependent soil strength, which reduced-gravity experiments report.')}</p>
        <div className="atlas-form">{num('Rover mass', rover.mass_kg, v => setRover({ ...rover, mass_kg: v }), 10, 'kg')}{num('Wheels', rover.wheels, v => setRover({ ...rover, wheels: v }), 1)}
          {num('Wheel diameter', rover.wheel_diameter_m, v => setRover({ ...rover, wheel_diameter_m: v }), 0.01, 'm')}{num('Wheel width', rover.wheel_width_m, v => setRover({ ...rover, wheel_width_m: v }), 0.01, 'm')}
          {num('Friction angle', soil.phi_deg, v => setSoil({ ...soil, phi_deg: v }), 1, '°')}{num('Cohesion', soil.c_pa, v => setSoil({ ...soil, c_pa: v }), 50, 'Pa')}</div>
        <p className="muted small-copy">{t('All inputs are declared assumptions. Soil: rough Apollo-era lunar estimate k_c = 1400 N/m², k_φ = 820 000 N/m³, n = 1; no Earth field soil or Jezero soil was measured.')}</p>
        {error ? <p role="alert" className="atlas-warning">{error}</p> : result && <div className="atlas-table-wrap"><table className="atlas-table"><thead><tr><th>{t('Case')}</th><th>{t('Test mass')}</th><th>{t('Wheel load')}</th><th>{t('Sinkage')}</th><th>R<sub>c</sub>/W</th><th>{t('Slope limit')}</th><th>{t('vs target')}</th></tr></thead>
          <tbody>{(['target', 'earth_load_matched', 'earth_mass_matched'] as const).map(key => { const r = result![key]; return <tr key={key}><th scope="row">{t(r.label)}</th><td>{r.test_mass_kg.toFixed(0)} kg</td><td>{r.wheel_load_n.toFixed(0)} N</td><td>{(r.sinkage_m * 1000).toFixed(1)} mm</td><td>{r.resistance_to_load.toFixed(3)}</td><td>{r.slope_limit_deg.toFixed(1)}°</td>
            <td>{r.sinkage_ratio_vs_target != null ? `×${r.sinkage_ratio_vs_target.toFixed(2)} ${t('sinkage')}, ${r.slope_limit_error_deg! >= 0 ? '+' : ''}${r.slope_limit_error_deg!.toFixed(1)}°` : '—'}</td></tr>; })}</tbody></table></div>}
        <details><summary>{t('Equations and limitations')}</summary><ul>{ref.equations.map(e => <li key={e}><code>{e}</code></li>)}</ul><ul>{ref.limitations.map(l => <li key={l}>{t(l)}</li>)}</ul></details>
      </section>
      <section><h2>{t('Same Sun, decomposed (CF_SOLAR)')}</h2>
        <label className="atlas-field"><span>{t('Earth site')}</span><select value={site} onChange={e => setSite(e.target.value)}>{doc.sites.map(s => <option key={s.id} value={s.id}>{s.name ?? s.id}</option>)}</select></label>
        {solar && <><div className="atlas-table-wrap"><table className="atlas-table"><thead><tr><th /><th>{t('Earth')}</th><th>{t('Target')}</th></tr></thead><tbody>
          <tr><th scope="row">{t('Median daylight solar elevation')}</th><td>{decimal(solar.earth.elevation_daylight_quantiles?.[1], 1)}°</td><td>{decimal(solar.target.elevation_daylight_quantiles?.[1], 1)}°</td></tr>
          <tr><th scope="row">{t('Daylight fraction')}</th><td>{pct(solar.earth.daylight_fraction)}</td><td>{pct(solar.target.daylight_fraction)}</td></tr>
          <tr><th scope="row">{t('Mean Sun-tracking direct irradiance')}</th><td>{solar.earth.mean_tracking_irradiance_wm2.toFixed(0)} W/m²</td><td>{solar.target.mean_tracking_irradiance_wm2.toFixed(0)} W/m²</td></tr>
          <tr><th scope="row">{t('Atmosphere model')}</th><td><small>{t(solar.earth.atmosphere)}</small></td><td><small>{t(solar.target.atmosphere)}</small></td></tr></tbody></table></div>
          <p>{t('Similar geometry does not mean similar energy:')} {t('irradiance ratio Earth/target')} <strong>{decimal(solar.components.irradiance_tracking_ratio)}</strong>.</p>
          <ul className="muted small-copy">{solar.limitations.map(l => <li key={l}>{t(l)}</li>)}</ul></>}
      </section>
    </div>
  </section>;
}

// ------------------------------------------------------------------ planner
function PlannerView({ doc, missionId }: { doc: AtlasBundle; missionId: string }) {
  const plan = doc.planner[missionId];
  const max = Math.max(...plan.measurements.map(m => m.evpi), 1e-9);
  return <section className="atlas-section">
    <p className="muted">{t('Expected value of perfect information over the constellation decision (Monte Carlo,')} {plan.draws} {t('draws; declared priors). Units: coverage objective; no monetary cost is claimed.')}</p>
    <ol className="atlas-plan">{plan.measurements.map(m => <li key={m.id} className={m.evpi > 0 ? '' : 'zero'}>
      <div className="atlas-plan-head"><strong>{t(m.name)}</strong><span className="bar"><i style={{ width: `${m.evpi / max * 100}%` }} /></span>
        <span>EVPI {m.evpi.toFixed(4)} {m.evpi_relative != null && `(${(m.evpi_relative * 100).toFixed(1)}%)`}</span><span>{t('decision change')} {pct(m.decision_change_probability)}</span></div>
      <p>{m.instrument && <>{t(m.instrument)} · </>}{m.scale} · {t(m.sampling ?? '')}{m.pair && <> · {t('combined')}: {m.pair.join(' + ')}</>}</p>
      {m.per_site.length > 0 && <p className="small-copy">{t('Best placements')}: {m.per_site.filter(p => p.evpi > 0).slice(0, 3).map(p => `${siteLabel(doc, p.site)} (${p.evpi.toFixed(4)})`).join(', ') || '—'}</p>}
      {m.evpi === 0 && <p className="small-copy muted">{m.touched ? t('Resolves evidence but cannot change the portfolio decision under the current model (for example, the other side of the comparison is still unmeasured).') : t('Cannot change any field status: the factor it resolves is not used by a field-transferable task.')}</p>}
      {m.limitations && <p className="small-copy muted">{t(m.limitations)}</p>}</li>)}</ol>
  </section>;
}

// ------------------------------------------------------------------ red team
const REVIEW_KEYS = [['A_supporting', 'Strongest supporting evidence'], ['B_counter_evidence', 'Strongest counter-evidence'], ['C_hidden_assumptions', 'Hidden assumptions'], ['D_scale_mismatch', 'Scale mismatch'],
  ['E_physical_mismatch', 'Physical mismatch'], ['F_alternative_explanation', 'Alternative explanation'], ['G_sensitivity', 'Sensitivity'], ['H_next_evidence', 'Additional evidence required']] as const;
function RedTeamView({ doc, missionId, onDossier }: { doc: AtlasBundle; missionId: string; onDossier: (s: string) => void }) {
  return <section className="atlas-section"><p className="muted">{t('Deterministic adversarial review of the selected constellation and the general-similarity favourites, built only from computed records.')}</p>
    {doc.redteam[missionId].map(r => <article key={r.site} className="atlas-review"><h2><button className="link-button" onClick={() => onDossier(r.site)}>{r.site_name}</button></h2>
      <dl>{REVIEW_KEYS.map(([key, label]) => <div key={key}><dt>{t(label)}</dt><dd><ul>{r[key].map(l => <li key={l}>{t(l)}</li>)}</ul></dd></div>)}</dl></article>)}
  </section>;
}

// ------------------------------------------------------------------ discovery
function DiscoveryView({ doc }: { doc: AtlasBundle }) {
  const d = doc.discovery;
  if (!d) return <p className="atlas-notice">{t('No discovery run is packaged. Run python -m pipeline.analog_transfer discover (network access to Copernicus public COGs).')}</p>;
  const [lon0, lon1] = d.region.lon, [lat0, lat1] = d.region.lat;
  const W = 600, H = Math.round(W * (lat1 - lat0) / ((lon1 - lon0) * Math.cos((lat0 + lat1) / 2 * Math.PI / 180)));
  const px = (lon: number) => (lon - lon0) / (lon1 - lon0) * W, py = (lat: number) => (lat1 - lat) / (lat1 - lat0) * H;
  const cw = 0.25 / (lon1 - lon0) * W, ch = 0.25 / (lat1 - lat0) * H;
  const targets = Object.keys(d.candidates[0]?.cells ?? {});
  const a = d.screen_agreement;
  return <section className="atlas-section">
    <p className="muted">{t(d.region.name)} · {t('Level 1')}: {d.performance.level1_tiles} {t('GLO-90 tiles')}, {d.performance.level1_blocks} {t('blocks')} ({d.performance.level1_s}s) · {t('Level 2')}: {d.performance.level2_windows} {t('GLO-30 windows')} ({d.performance.level2_s}s) · {t('screen target')} {d.screen_target}</p>
    <div className="atlas-columns">
      <section><h2>{t('Level 1 screen')}</h2>
        <svg className="atlas-region" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('Level 1 blocks coloured by coarse match; hollow blocks are flagged flat or water')}>
          {d.level1_blocks.filter(b => b.usable).map(b => <rect key={b.id} x={px(b.lon) - cw / 2} y={py(b.lat) - ch / 2} width={cw - 1} height={ch - 1}
            className={b.flag ? 'flat' : 'land'} style={b.flag ? undefined : { fillOpacity: 0.12 + 0.85 * (b.coarse_match ?? 0) }}><title>{`${b.id} coarse match ${decimal(b.coarse_match)}${b.flag ? ' · ' + b.flag : ''}`}</title></rect>)}
          {d.candidates.map((c, i) => <g key={c.id}><circle cx={px(c.lon)} cy={py(c.lat)} r="9" className="cand" /><text x={px(c.lon)} y={py(c.lat) + 3.5} textAnchor="middle">{i + 1}</text></g>)}
          {doc.sites.filter(s => s.lon >= lon0 && s.lon <= lon1 && s.lat >= lat0 && s.lat <= lat1).map(s => <g key={s.id}><rect x={px(s.lon) - 5} y={py(s.lat) - 5} width="10" height="10" className="catalog" /><text x={px(s.lon) + 8} y={py(s.lat) + 4} className="catalog-label">{s.name}</text></g>)}
        </svg>
        <p className="small-copy muted">{t('Shade: coarse slope-distribution match to the target (~370 m). Hollow: >60% of cells flatter than 0.3° (probable water, playa or sand sheet; unverified). Squares: existing EGIZ catalog windows.')}</p>
        {a && <p className="small-copy">{t('Screen vs detailed agreement')}: Spearman ρ = <strong>{a.spearman_coarse_vs_level2_route_match.toFixed(2)}</strong> (n = {a.n}); {t('mean coarse match')} {a.mean_coarse_match.toFixed(2)} {t('vs detailed route-planning match')} {a.mean_level2_route_match.toFixed(2)}. {t('Level 1 ranks usefully but overstates absolute similarity.')}</p>}
      </section>
      <section><h2>{t('Discovery is not proof')}</h2><ul>{d.limitations.map(l => <li key={l}>{t(l)}</li>)}</ul>
        {d.failures.length > 0 && <><h3>{t('Failed windows')}</h3><ul>{d.failures.map(f => <li key={f.id}>{f.id}: {f.reason}</li>)}</ul></>}</section>
    </div>
    <h2>{t('Level 2 candidates')}</h2>
    <div className="atlas-table-wrap"><table className="atlas-table"><thead><tr><th>#</th><th>{t('Window')}</th><th>{t('Category')}</th><th>{t('Nearest catalog site')}</th><th>{t('Coarse')}</th>
      {targets.flatMap(tg => (d.candidates[0].cells[tg] ?? []).map(x => <th key={tg + x.task}>{tg.split('_')[0]} · {x.task.replace('_', ' ').toLowerCase()}</th>))}<th>{t('Relief')}</th><th>{t('Missing')}</th></tr></thead>
      <tbody>{d.candidates.map((c, i) => <tr key={c.id}><td>{i + 1}</td><td><code>{c.id}</code><br /><small>{c.lat.toFixed(3)}°N {c.lon.toFixed(3)}°E{c.recentred_deg > 0 ? ` · ${t('recentred')} ${c.recentred_deg}°` : ''}</small></td>
        <td>{t(c.category)}</td><td>{siteLabel(doc, c.nearest_catalog_site)} ({c.nearest_catalog_km} km)</td><td>{decimal(c.coarse_match)}</td>
        {targets.flatMap(tg => c.cells[tg].map(x => <td key={tg + x.task}><StatusChip status={x.status} /> {decimal(x.axes.task_match)}</td>))}
        <td>{c.terrain.relief_m.toFixed(0)} m</td><td><small>{c.missing.join('; ')}</small></td></tr>)}</tbody></table></div>
    <p className="small-copy muted">{t('Next measurements for every candidate')}: {d.candidates[0]?.next_measurements.join(' · ')}</p>
  </section>;
}

// ------------------------------------------------------------------ dossier
export function markdownToBlocks(md: string): ReactNode[] {
  const out: ReactNode[] = []; const lines = md.split('\n'); let i = 0, key = 0;
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, j) => p.startsWith('**') ? <strong key={j}>{p.slice(2, -2)}</strong> : p.startsWith('`') ? <code key={j}>{p.slice(1, -1)}</code> : p);
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) { const body = []; i++; while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]); out.push(<pre key={key++}>{body.join('\n')}</pre>); i++; continue; }
    if (line.startsWith('|')) { const rows = []; while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]); const cells = rows.filter(r => !/^\|[-| ]+\|$/.test(r)).map(r => r.slice(1, -1).split(' | '));
      out.push(<div className="atlas-table-wrap" key={key++}><table className="atlas-table"><thead><tr>{cells[0].map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead><tbody>{cells.slice(1).map((r, j) => <tr key={j}>{r.map((c, n) => <td key={n}>{inline(c)}</td>)}</tr>)}</tbody></table></div>); continue; }
    if (line.startsWith('- ')) { const items = []; while (i < lines.length && lines[i].startsWith('- ')) items.push(lines[i++].slice(2)); out.push(<ul key={key++}>{items.map((x, j) => <li key={j}>{inline(x)}</li>)}</ul>); continue; }
    if (line.startsWith('## ')) out.push(<h2 key={key++}>{line.slice(3)}</h2>);
    else if (line.startsWith('# ')) out.push(<h1 key={key++} className="atlas-dossier-title">{line.slice(2)}</h1>);
    else if (line.trim()) out.push(<p key={key++}>{inline(line)}</p>);
    i++;
  }
  return out;
}
function DossierView({ doc, target, site, setSite }: { doc: AtlasBundle; target: string; site: string; setSite: (s: string) => void }) {
  const md = doc.dossiers[`${site}|${target}`];
  return <section className="atlas-section">
    <div className="atlas-toolbar"><label className="atlas-field"><span>{t('Earth site')}</span><select value={site} onChange={e => setSite(e.target.value)}>{doc.sites.map(s => <option key={s.id} value={s.id}>{s.name ?? s.id}</option>)}</select></label>
      <button className="outline-button" onClick={() => downloadText(md, `atlas-pi-dossier-${site}-${target}.md`)}><Download size={14} /> {t('Download dossier (Markdown)')}</button></div>
    <article className="atlas-dossier">{md ? markdownToBlocks(md) : <p>{t('No dossier for this pair.')}</p>}</article>
  </section>;
}

// ------------------------------------------------------------------ validation
function ValidationView({ doc }: { doc: AtlasBundle }) {
  const ev = doc.evaluation;
  if (!ev) return <p className="atlas-notice">{t('Evaluation was not run for this bundle.')}</p>;
  const stab = ev.robustness['tolerance_x0.5_x2'];
  return <section className="atlas-section">
    <h2><FlaskConical size={16} /> {t('Hypotheses')}</h2>
    <div className="atlas-table-wrap"><table className="atlas-table"><thead><tr><th>{t('Hypothesis')}</th><th>{t('Verdict')}</th><th>{t('Criterion')}</th><th>{t('Caveat')}</th></tr></thead>
      <tbody>{ev.hypotheses.map(h => <tr key={h.id}><th scope="row">{h.id}</th><td><span className={`atlas-verdict v-${h.verdict}`}>{t(h.verdict.replace('_', ' '))}</span></td><td>{t(String(h.criterion ?? h.reason ?? ''))}</td><td>{t(String(h.caveat ?? ''))}</td></tr>)}</tbody></table></div>
    <h2>{t('Negative and positive controls')}</h2>
    <ul>{ev.controls.map(c => <li key={c.id}><strong>{c.id}</strong> <span className={`atlas-verdict v-${c.verdict}`}>{t(c.verdict)}</span> — {t(String(c.description))}</li>)}</ul>
    <h2>{t('Ablations')}</h2>
    <div className="atlas-table-wrap"><table className="atlas-table"><thead><tr><th>{t('Variant')}</th><th>{t('Status changes')}</th>{Object.keys(ev.ablations.nominal_selected_k3).map(m => <th key={m}>{m} K=3</th>)}</tr></thead>
      <tbody><tr><th scope="row">{t('nominal')}</th><td>—</td>{Object.values(ev.ablations.nominal_selected_k3).map((s, i) => <td key={i}>{s.map(x => siteLabel(doc, x)).join(', ')}</td>)}</tr>
        {Object.entries(ev.ablations.variants).map(([name, v]) => <tr key={name}><th scope="row">{t(name.replaceAll('_', ' '))}</th><td>{v.status_changes ?? '—'}</td>{Object.entries(v.selected_k3).map(([m, s]) => <td key={m} className={v.selection_differs_from_nominal[m] ? 'changed' : ''}>{s.map(x => siteLabel(doc, x)).join(', ')}</td>)}</tr>)}</tbody></table></div>
    <h2>{t('Robustness')}</h2>
    <p>{t('Statuses unchanged when every declared tolerance is halved and doubled')}: <strong>{stab.stable}/{stab.cells}</strong> ({pct(stab.fraction_stable)}).</p>
    <h2>{t('Measured performance')}</h2>
    <ul className="atlas-perf">{Object.entries(doc.performance).map(([k, v]) => <li key={k}><span>{k}</span><strong>{v.toFixed(k.includes('mb') ? 0 : 2)}</strong></li>)}</ul>
    <h2>{t('Inputs (SHA-256)')}</h2>
    <ul className="atlas-hashes">{Object.entries(doc.inputs).map(([k, v]) => <li key={k}><span>{k}</span><code>{v}</code></li>)}</ul>
  </section>;
}
