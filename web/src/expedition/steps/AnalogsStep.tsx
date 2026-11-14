// EGIZ · step 5, Earth analogs. Where on Earth does the ground resemble the mission site? Every window of the
// Earth-wide discovery index is scored for the site under the mission's priorities (discover/engine, the same code
// as the Discover Index), shown on the map, shortlisted with geographic diversity, and opened with its statistics,
// ATLAS-Π task transferability, the computed mismatches and the data gaps that limit the analogy.
import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Box, Check, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { t } from '../../i18n';
import type { Status } from '../../atlas/types';
import { DiscoverMap } from '../../discover/DiscoverMap';
import { aggregate, col, diverseTop, gapLedger, text } from '../../discover/engine';
import { usePlanet } from '../../planet/workspace/store';
import { openWorkspace } from '../nav';
import { More } from '../More';
import { StepFooter, StepHead } from '../ExpeditionPage';
import { short } from '../format';

const STATUS_LABEL: Record<Status, string> = { SUPPORTED: 'Supported', CONDITIONAL: 'Conditional', WEAK: 'Weak', NON_TRANSFERABLE: 'Non-transferable', UNKNOWN: 'Unknown' };
const n = (v: number | null | undefined, d = 1, u = '') => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(d)}${u}`);
const Bar = ({ lo, mid, hi, max }: { lo: number; mid: number; hi: number; max: number }) => <span className="xp-int" aria-hidden="true"><i style={{ left: `${(lo / max) * 100}%`, width: `${Math.max(1, ((hi - lo) / max) * 100)}%` }} /><b style={{ left: `${(mid / max) * 100}%` }} /></span>;

export function AnalogsStep() {
  const s = usePlanet(), b = s.bundle, shard = s.shard, x = s.inv.target ? s.target() : null, weights = s.weights();
  const [selected, setSelected] = useState<string | null>(s.inv.analogsFor === s.inv.target ? s.inv.candidates.at(-1) ?? null : null), [onlyKz, setOnlyKz] = useState(false), [strong, setStrong] = useState(false);
  const agg = useMemo(() => (shard && x && shard.target === x.id ? aggregate(shard, weights) : null), [shard, x?.id, JSON.stringify(weights)]); // eslint-disable-line react-hooks/exhaustive-deps
  const view = useMemo(() => {
    if (!b || !agg) return null;
    const ids = b.windows.id, visible = ids.map((_, i) => agg.score[i] > 0 && (!onlyKz || b.windows.country[i] === 'KAZ') && (!strong || agg.category[i] === 'strong'));
    const order = ids.map((_, i) => i).filter(i => visible[i]).sort((p, q) => agg.score[q] - agg.score[p]);
    let max = 0; for (const i of order) if (agg.score[i] > max) max = agg.score[i];
    return { visible, order: diverseTop(order, agg.score, b.windows.lon, b.windows.lat, 20, 150), max: max || 1 };
  }, [b, agg, onlyKz, strong]);
  if (!b || !x) return <div className="xp-msg" role="status">{s.discoveryError ?? t('Loading the measured site index…')}</div>;
  const kept = s.inv.analogsFor && s.inv.analogsFor !== x.id ? [] : s.inv.candidates, staleKept = s.inv.analogsFor && s.inv.analogsFor !== x.id ? s.inv.candidates : [];
  const i = selected ? b.windows.id.indexOf(selected) : -1;
  const atlasCells = s.atlas && selected ? s.atlas.tensor.cells.filter(c => c.site === selected && c.target === x.id) : [];
  const gaps = i >= 0 && shard ? gapLedger(b, x.body, x.lat, i, shard.w1_deg[i]).slice(0, 8) : [];
  const ref = selected ? s.refs.find(r => r.discoveryWindow === selected) : undefined;
  const fmax = view ? Math.max(0.05, ...view.order.map(k => agg!.hi[k])) : 1;
  const order = view?.order ?? [], pos = i >= 0 ? order.indexOf(i) : -1, step = (d: number) => { if (pos < 0 || !order.length) return; setSelected(b.windows.id[order[(pos + d + order.length) % order.length]]); };
  const supported = atlasCells.filter(c => c.status === 'SUPPORTED').length;
  const Tile = ({ label, value, ev }: { label: string; value: string; ev?: string }) => <div className="xp-tile"><span>{t(label)}</span><b>{value}</b>{ev && <em className={`xp-ev ev-${ev}`}>{ev}</em>}</div>;
  return <div className="xp-analogs">
    <div className="xp-map xp-analogs-map">{agg && view ? <DiscoverMap ids={b.windows.id} lon={b.windows.lon} lat={b.windows.lat} score={agg.score} visible={view.visible} maxScore={view.max} shortlist={view.order.map(k => b.windows.id[k])} selected={selected} established={b.benchmark_sites} onSelect={setSelected} />
      : <div className="xp-msg" role="status"><span className="eg-loading-bar" aria-hidden="true" /><p>{t('Scoring Earth for')} {short(x.name)}…</p></div>}</div>
    <div className="xp-analogs-main">
      {i < 0 || !agg || !shard ? <>
        {/* ── list view ── */}
        <StepHead step="analogs">{t('Places on Earth whose ground resembles')} <b>{short(x.name)}</b>.</StepHead>
        <More label="How the ranking works"><p>{t('Every place on Earth in the index is compared with')} {short(x.name)} {t('dimension by dimension, under your mission priorities. The map shows all of them; the list is a shortlist at least 150 km apart.')}</p><p>{t('Ordered by score = fidelity × coverage. Fidelity: weighted similarity with its 90 % interval (bar). Category: how much of the weighted evidence exists for that window.')}</p></More>
        {staleKept.length > 0 && <p className="xp-warn">{staleKept.length} {t('kept analogs were ranked for another site')} ({s.bundle?.targets.find(z => z.id === s.inv.analogsFor)?.name.split(' (')[0]}). {t('Review them below or keep new ones for this site.')}</p>}
        {kept.length > 0 && <section className="xp-kept-strip" aria-label={t('Your Earth analogs')}>
          <h2 className="xp-label">{t('Your Earth analogs')} · {kept.length}</h2>
          <div>{kept.map(id => { const k = b.windows.id.indexOf(id); return k < 0 ? null : <button key={id} onClick={() => setSelected(id)}><Check size={13} />{b.windows.name[k]}{agg && <em>{agg.fidelity[k].toFixed(2)}</em>}</button>; })}</div>
          {agg && kept.length > 1 && <More label="Compare them side by side"><div className="xp-table-wrap"><table className="xp-delta"><thead><tr><th /><th>{t('Fidelity')}</th><th>{t('Coverage')}</th><th>{t('Slope p50')}</th><th>{t('Relief')}</th><th>{t('Precipitation')}</th><th>{t('ATLAS-Π supported tasks')}</th></tr></thead>
            <tbody>{kept.map(id => { const k = b.windows.id.indexOf(id); if (k < 0) return null; const cells = s.atlas?.tensor.cells.filter(c => c.site === id && c.target === x.id) ?? []; return <tr key={id}><th>{b.windows.name[k]}</th><td>{agg.fidelity[k].toFixed(3)}</td><td>{(agg.coverage[k] * 100).toFixed(0)} %</td><td>{n(col(b, 'slope_f100_p50_deg', k))}°</td><td>{n(col(b, 'relief_m', k), 0)} m</td><td>{n(col(b, 'precip_annual_mm', k), 0)} mm</td><td>{cells.length ? `${cells.filter(c => c.status === 'SUPPORTED').length} / ${cells.length}` : '—'}</td></tr>; })}</tbody></table></div></More>}
        </section>}
        <div className="xp-chips-row xp-filters" role="group" aria-label={t('Filters')}>
          <button className={onlyKz ? 'on' : ''} aria-pressed={onlyKz} onClick={() => setOnlyKz(!onlyKz)}>{t('Kazakhstan only')}</button>
          <button className={strong ? 'on' : ''} aria-pressed={strong} onClick={() => setStrong(!strong)}>{t('Strong evidence only')}</button>
        </div>
        <ol className="xp-rank">{view && agg && view.order.map((k, r) => { const id = b.windows.id[k]; return <li key={id}><button onClick={() => setSelected(id)}>
          <span className="xp-rank-n">{String(r + 1).padStart(2, '0')}</span><span className="xp-rank-id"><b>{b.windows.name[k]}</b><em>{b.windows.country[k] ?? '—'}</em></span>
          <span className="xp-rank-v">{agg.fidelity[k].toFixed(3)}<Bar lo={agg.lo[k]} mid={agg.fidelity[k]} hi={agg.hi[k]} max={fmax} /></span>
          <span className={`xp-cat c-${agg.category[k]}`}>{t(agg.category[k].replace('_', ' '))}</span>{s.inv.candidates.includes(id) ? <Check size={13} className="xp-kept" aria-label={t('kept')} /> : <ChevronRight size={14} className="xp-dim" aria-hidden="true" />}</button></li>; })}</ol>
        {view && !view.order.length && <p className="xp-dim">{t('No window passes these filters.')}</p>}
      </> : <section className="xp-cand-view" aria-label={b.windows.name[i]}>
        {/* ── detail view ── */}
        <nav className="xp-cand-nav">
          <button className="xp-back" onClick={() => setSelected(null)}><ArrowLeft size={15} />{t('All places')}</button>
          {pos >= 0 && <span className="xp-dim xp-small">{t('Rank')} {pos + 1} / {order.length}</span>}
          <span className="xp-cand-pn"><button onClick={() => step(-1)} aria-label={t('Previous')} disabled={pos < 0}><ChevronLeft size={16} /></button><button onClick={() => step(1)} aria-label={t('Next')} disabled={pos < 0}><ChevronRight size={16} /></button></span>
        </nav>
        <p className="eg-eyebrow">{b.windows.country[i] ?? '—'} · {b.windows.lat[i].toFixed(2)}°, {b.windows.lon[i].toFixed(2)}°</p>
        <h2 className="xp-h2">{b.windows.name[i]}</h2>
        <div className="xp-cand-kpis">
          <div><span className="xp-label">{t('Fidelity')}</span><b>{agg.fidelity[i].toFixed(3)}</b><Bar lo={agg.lo[i]} mid={agg.fidelity[i]} hi={agg.hi[i]} max={Math.max(fmax, agg.hi[i])} /><em>90 %: {agg.lo[i].toFixed(2)}–{agg.hi[i].toFixed(2)}</em></div>
          <div><span className="xp-label">{t('Coverage')}</span><b>{(agg.coverage[i] * 100).toFixed(0)}<small> %</small></b><span className="mh-mini-bar wide"><i style={{ width: `${agg.coverage[i] * 100}%` }} /></span><em className={`xp-cat c-${agg.category[i]}`}>{t(agg.category[i].replace('_', ' '))}</em></div>
          <div><span className="xp-label">ATLAS-Π</span><b>{atlasCells.length ? `${supported}/${atlasCells.length}` : '—'}</b><em>{atlasCells.length ? t('tasks supported') : t('not assessed')}</em></div>
        </div>
        <div className="xp-row">
          <button className="eg-button" onClick={() => s.toggleCandidate(selected!)}>{s.inv.candidates.includes(selected!) ? <><Check size={15} />{t('Kept as mission analog')}</> : <><Plus size={15} />{t('Keep as mission analog')}</>}</button>
          <button className="mh-chip-btn" onClick={() => openWorkspace('discover', { window: selected! })}><ArrowUpRight size={14} />{t('Open in Discover Index')}</button>
          <button className="mh-chip-btn" onClick={() => { const st = usePlanet.getState(); if (ref) st.setSiteRef(ref.key, null); else st.setSiteRef(null, { id: selected!, name: b.windows.name[i], lat: b.windows.lat[i], lon: b.windows.lon[i] }); st.setStage('inspect'); openWorkspace('planet'); }}><Box size={14} />{t('Terrain in 3D')}</button>
        </div>
        <div className="xp-tiles">
          <Tile label="Slope p50 / p90" value={`${n(col(b, 'slope_f100_p50_deg', i))}° / ${n(col(b, 'slope_f100_p90_deg', i))}°`} ev="derived" />
          <Tile label="Relief" value={`${n(col(b, 'relief_m', i), 0)} m`} ev="derived" />
          <Tile label="Bare ground" value={col(b, 'bare_frac', i) === null ? '—' : `${(col(b, 'bare_frac', i)! * 100).toFixed(0)} %`} ev={col(b, 'bare_frac', i) === null ? 'missing' : 'measured'} />
          <Tile label="Precipitation" value={`${n(col(b, 'precip_annual_mm', i), 0)} mm/yr`} ev="measured" />
          <Tile label="Mean temperature" value={`${n(col(b, 't2m_mean_annual_c', i))} °C`} ev="measured" />
          <Tile label="Lithology (map)" value={text(b, 'geo_lith_label', i) ?? '—'} ev={text(b, 'geo_lith_label', i) ? 'curated' : 'missing'} />
        </div>
        {atlasCells.length > 0 && <section className="xp-cand-sec"><h3 className="xp-label">{t('What an Earth rehearsal here can tell us (ATLAS-Π)')}</h3>
          <ul className="xp-chips">{atlasCells.map(c => <li key={c.task} className={`s-${c.status.toLowerCase()}`} title={c.reasons.join(', ')}>{s.atlas!.registry.tasks.tasks.find(z => z.id === c.task)?.name ?? c.task}: <b>{t(STATUS_LABEL[c.status])}</b></li>)}</ul></section>}
        <More label="Where the analogy breaks" aside={`${gaps.length + b.dimensions.filter(d => x.dimension_status[d.id] !== 'measured').length}`}>
          <ul className="xp-limits">{gaps.map(g => <li key={g.key}><b>{g.parameter}</b>: {t('Earth')} {String(g.earth_value)} {t('vs')} {short(x.name)} {String(g.target_value)} {g.unit}{g.alternative ? ` — ${g.alternative}` : ''}</li>)}
            {b.dimensions.filter(d => x.dimension_status[d.id] !== 'measured').map(d => <li key={d.id}><b>{d.label}</b>: {t(x.dimension_status[d.id].replace('_', ' '))}{d.integration_path ? ` — ${d.integration_path}` : ''}</li>)}</ul>
        </More>
        <More label="Similarity by dimension" aside={`${shard.dims.length}`}>
          <div className="xp-table-wrap"><table className="xp-dims"><tbody>{shard.dims.map((d, k) => { const st = shard.status_codes[shard.status[k][i]], v = shard.s50[k][i]; return <tr key={d}><th>{b.dimensions.find(z => z.id === d)?.label ?? d}</th>{st === 'measured' && v !== null ? <><td>{v.toFixed(2)}</td><td><Bar lo={shard.lo[k][i] ?? v} mid={v} hi={shard.hi[k][i] ?? v} max={1} /></td></> : <td colSpan={2}><em className="xp-ev ev-missing">{t(st.replace('_', ' '))}</em></td>}</tr>; })}</tbody></table></div>
        </More>
        <More label="More about this place">
          <dl className="xp-facts">
            <div><dt>{t('Nearest established analog')}</dt><dd>{text(b, 'nearest_established', i) ?? '—'} · {n(col(b, 'novelty_km', i), 0)} km</dd></div>
            <div><dt>{t('Relief / ruggedness')}</dt><dd>{n(col(b, 'relief_m', i), 0)} m / {n(col(b, 'tri_f100_m', i), 2)} m</dd></div>
            <div><dt>{t('Window')}</dt><dd>{selected}</dd></div>
          </dl>
          {!atlasCells.length && <p className="xp-dim">{t('ATLAS-Π has no task-level assessment for this window')}. {t('Resemblance is not a statement of functional suitability.')} <button className="xp-link" onClick={() => openWorkspace('atlas')}>{t('Open ATLAS-Π')}</button></p>}
        </More>
      </section>}
      <StepFooter step="analogs" why="You have a site, the evidence, its alternatives and its Earth analogs. Mission Home brings them together, with every EGIZ workspace one click away." />
    </div>
  </div>;
}
