import { ContextHelp } from './ContextHelp';
import { t as localizeText, useLanguage } from '../i18n';
// AI-assisted implementation; human review pending.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, Info, X } from 'lucide-react';
import { useAppStore } from '../state/store';
import type { AttributeSpec } from '../types/contracts';
import type { CampaignModel } from './CampaignPage';
import { AttributeEvidence } from './SiteDrawer';
import { attrLabels, decimal, fidelityColor, siteName } from '../lib/format';
import copy from '../content/copy.json';

function compactAttribute(attr: string) {
  if (attr.startsWith('slope_')) return attr.includes('p90') ? 'Slope P90' : 'Slope P50';
  if (attr.startsWith('frac_lt10')) return 'Under 10°';
  if (attr.startsWith('frac_lt20')) return 'Under 20°';
  if (attr.startsWith('tri_')) return 'Roughness';
  return ({relief_m:'Relief',elev_min_m:'Elevation',precip_mm:'Precipitation',bare_frac:'Bare ground',t_min_c:'Min temperature',t_max_c:'Max temperature',light:'Low Sun',shadow:'Shadows',geology:'Geology'} as Record<string,string>)[attr] ?? attrLabels[attr] ?? attr;
}

export function MatrixPage({ model }: { model: CampaignModel }) {
  useLanguage();
  const { data, targetId, k, lens, selectSite, navigate } = useAppStore(); const [sort, setSort] = useState<string>(''); const [showPartial, setShowPartial] = useState(true); const [selected, setSelected] = useState<{ id: string; objective: string; spec: AttributeSpec } | null>(null);
  const evidence = useRef<HTMLElement>(null); const originCell = useRef<HTMLButtonElement>(null); const matrix = useRef<HTMLDivElement>(null);
  useEffect(() => { if (selected) evidence.current?.focus(); }, [selected]);
  const campaign = model.campaigns.find(c => c.k === k); const run = model.run; const template = model.template; const target = data!.targets.targets.find(t => t.id === targetId)!;
  const columns = template?.objectives.flatMap(o => o.attributes.map(spec => ({ objective: o.id, name: o.name, spec, key: `${o.id}:${spec.attr}` }))) ?? [];
  const rows = useMemo(() => {
    if (!run) return [];
    const value = (id: string) => sort ? (() => { const [o, attr] = sort.split(':'); const c = run.fidelity[o]?.[id]; return c?.F != null ? c.parts?.[attr] ?? -1 : -1; })() : Math.max(0, ...Object.values(run.fidelity).map(cells => cells[id]?.F ?? 0));
    const pool = data!.candidates.tiles.filter(t => t.pool !== 'control' && (lens === 'global' || t.pool === 'kazakhstan') && (showPartial || columns.every(column => { const c = run.fidelity[column.objective]?.[t.id]; return c?.F != null && !c.partial && c.parts?.[column.spec.attr] != null; })));
    return pool.sort((a, b) => (sort ? 0 : Number(!!campaign?.sites.some(s => s.id === b.id)) - Number(!!campaign?.sites.some(s => s.id === a.id))) || value(b.id) - value(a.id) || a.id.localeCompare(b.id)).slice(0, 10 + (campaign?.sites.length ?? 0));
  }, [data, run, campaign, sort, lens, showPartial]);
  const tile = selected ? data!.candidates.tiles.find(t => t.id === selected.id) : null;
  return <main className="page matrix-page"><div className="page-intro"><span className="eyebrow">{localizeText("CONDITIONS / ATTRIBUTES / ALTERNATIVES")}</span><h1>{localizeText(copy.matrix.title)}</h1><p>{localizeText(copy.matrix.subtitle)}</p></div><div className="matrix-topline"><div><strong>{localizeText(target.name.split(" / ")[0])}</strong><span className="muted"> / {localizeText(rows.length)}{localizeText(" candidate sites · ")}{localizeText(columns.length)}{localizeText(" attributes")}</span></div><div className="matrix-scale" aria-label={localizeText("Attribute fidelity from zero to one")}><span>0</span><i aria-hidden="true" style={{background:`linear-gradient(90deg,${[0,.25,.5,.75,1].map(fidelityColor).join(",")})`}}/><span>1</span></div><label className="inline-check"><input type="checkbox" checked={showPartial} onChange={e => setShowPartial(e.target.checked)} />{localizeText("Show partial / missing")}</label></div>{localizeText(!run ? <p className="empty-note">{localizeText("No fidelity data available.")}</p> : <><div ref={matrix} className="matrix-scroll panel" role="region" aria-label={localizeText("Scrollable attribute fidelity matrix")} tabIndex={0}><table className="matrix-table"><caption className="sr-only">{localizeText("Attribute fidelity. Column buttons sort by fidelity, cell buttons open evidence.")}</caption><thead><tr><th className="matrix-site-head">{localizeText("SITE / LOCATION")}</th>{localizeText(columns.map(c => <th key={c.key} aria-sort={sort === c.key ? 'descending' : 'none'}><button className={sort === c.key ? 'active' : ''} onClick={() => setSort(sort === c.key ? '' : c.key)} title={localizeText(`Sort by ${c.name}, ${attrLabels[c.spec.attr]}`)}><small>{localizeText(c.objective)}</small><span>{localizeText(compactAttribute(c.spec.attr))}</span><em>{c.spec.attr.includes("f100")?"100 m":c.spec.attr.includes("f400")?"400 m":c.spec.attr.includes("_r")?"2 km":""}</em>{localizeText(sort === c.key && <ArrowDown size={12} />)}</button></th>))}</tr></thead><tbody>{localizeText(rows.map(tile => <tr key={tile.id}><th><button className="text-button" onClick={() => selectSite(tile.id)}>{localizeText(campaign?.sites.some(s => s.id === tile.id) && <span className="tiny-number">{localizeText(campaign.sites.findIndex(s => s.id === tile.id) + 1)}</span>)}{localizeText(siteName(tile))}<small>{localizeText(tile.pool)}</small></button></th>{localizeText(columns.map(c => {
    const cell = run.fidelity[c.objective]?.[tile.id]; const f = cell?.F != null ? cell.parts?.[c.spec.attr] : null;
    return <td key={c.key}><button className={`matrix-cell ${f == null ? 'missing-cell' : ''}`} style={{ background: fidelityColor(f), color: f != null && f > .55 ? '#10151b' : '#edf3f8' }} aria-label={localizeText(`${siteName(tile)}, ${c.name}, ${attrLabels[c.spec.attr]}: ${f == null ? 'missing' : decimal(f)}`)} onClick={event => { originCell.current = event.currentTarget; setSelected({ id: tile.id, objective: c.objective, spec: c.spec }); }}>{localizeText(decimal(f))}{localizeText(cell?.F != null && cell.partial && <span className="partial-cell-dot" title={localizeText("Partial objective data")} />)}</button></td>;
  }))}</tr>))}</tbody></table>{localizeText(!rows.length && <p className="empty-note" role="status">{localizeText("No fully assessed sites match this view. Enable “Show partial / missing” to inspect the available evidence, or change the geographic view in Campaign.")}</p>)}</div><div className="matrix-footer"><ContextHelp label="Reading the matrix"><span><Info size={13} />{localizeText(" Dashes mean unavailable evidence. They are never treated as a measured zero.")}</span></ContextHelp><button className="text-button" onClick={() => navigate('campaign')}>{localizeText("Back to campaign")}<ArrowRight size={13} /></button></div>{localizeText(selected && tile && <section className="matrix-evidence panel" ref={evidence} tabIndex={-1} aria-label={localizeText("Selected attribute evidence")}><div className="panel-heading"><div><span className="eyebrow">{localizeText("CELL EVIDENCE")}</span><h2>{localizeText(siteName(tile))} · {localizeText(attrLabels[selected.spec.attr])}</h2></div><button className="icon-button" aria-label={localizeText("Close cell evidence")} onClick={() => { setSelected(null); (originCell.current?.isConnected ? originCell.current : matrix.current)?.focus(); }}><X size={17} /></button></div><AttributeEvidence spec={selected.spec} tile={tile} target={target} cell={run.fidelity[selected.objective]?.[tile.id]} /></section>)}</>)}</main>;
}
