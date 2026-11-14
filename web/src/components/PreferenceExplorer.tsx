import { ContextHelp } from './ContextHelp';
import { t as localizeText, useLanguage } from '../i18n';
import { useMemo, useState } from 'react';
import { ArrowRight, Download, SlidersHorizontal } from 'lucide-react';
import { useAppStore } from '../state/store';
import { preferenceEnvelope, preferenceLines, preferenceRanking } from '../lib/preference';
import { decimal, siteName } from '../lib/format';
import type { CampaignModel } from './CampaignPage';
import { downloadJson } from '../lib/download';
import './ResearchTools.css';

const colors = ['#7cdbcf', '#e6bb7a', '#a6b8f8', '#dc9ca9', '#a6cd87'];
export function PreferenceExplorer({ model }: { model: CampaignModel }) {
  useLanguage();
  const { data, lens, targetId, selectSite, setWeights, toggleObjective, enabledObjectives, setK } = useAppStore();
  const objectives = model.template?.objectives ?? [];
  const [pair, setPair] = useState([objectives[0]?.id, objectives[1]?.id]);
  const [t, setT] = useState(.5);
  const [applied, setApplied] = useState(false);
  const [a, b] = pair;
  const lines = useMemo(() => model.run && a && b ? preferenceLines(model.run, data!.candidates.tiles, a, b, lens) : [], [model.run, data, a, b, lens]);
  const envelope = useMemo(() => preferenceEnvelope(lines), [lines]);
  const ranking = useMemo(() => preferenceRanking(lines, t), [lines, t]);
  const name = (id: string) => siteName(data!.candidates.tiles.find(tile => tile.id === id)!);
  const objectiveName = (id: string) => objectives.find(o => o.id === id)?.name ?? id;
  if (objectives.length < 2) return null;
  const changeObjective = (index: number, id: string) => {
    const other = pair[1 - index];
    setPair(index === 0 ? [id, id === other ? a : other] : [id === other ? b : other, id]);
    setApplied(false);
  };
  const apply = () => {
    for (const o of objectives) if (enabledObjectives.includes(o.id) !== pair.includes(o.id)) toggleObjective(o.id);
    setWeights(Object.fromEntries(objectives.map(o => [o.id, o.id === a ? Number((3 * (1 - t)).toFixed(12)) : o.id === b ? Number((3 * t).toFixed(12)) : 0])));
    setK(1); setApplied(true);
  };
  return <section className="preference-explorer panel" aria-labelledby="preference-title">
    <div className="research-heading"><div><span className="eyebrow">{localizeText("THE DECISION BEHIND THE RANKING")}</span><h2 id="preference-title">{localizeText("When does the best site change?")}</h2><p>{localizeText("Balance two mission objectives. See the exact priority at which another Earth window becomes preferable.")}</p></div><span className="tag">{localizeText("ONE-SITE TRADE-OFF")}</span></div>
    <div className="preference-layout"><div className="preference-controls">
      <div className="preference-pair">{localizeText(pair.map((id, i) => <label key={i}><span className="eyebrow">{localizeText(i === 0 ? 'OBJECTIVE A' : 'OBJECTIVE B')}</span><select aria-label={localizeText(`Preference objective ${i === 0 ? 'A' : 'B'}`)} value={id} onChange={e => changeObjective(i, e.target.value)}>{localizeText(objectives.map(o => <option key={o.id} value={o.id}>{localizeText(o.name)}</option>))}</select></label>))}</div>
      <label className="preference-slider"><span><strong>{localizeText(Math.round((1 - t) * 100))}{localizeText("% A")}</strong><span>{localizeText("Mission priority")}</span><strong>{localizeText(Math.round(t * 100))}{localizeText("% B")}</strong></span><input type="range" aria-label={localizeText("Objective B priority percent")} aria-valuetext={`${Math.round((1 - t) * 100)} percent ${objectiveName(a)}, ${Math.round(t * 100)} percent ${objectiveName(b)}`} min="0" max="100" step="1" value={Math.round(t * 100)} onChange={e => { setT(Number(e.target.value) / 100); setApplied(false); }} /></label>
      <div className="preference-winner" aria-live="polite"><span className="eyebrow">{localizeText("PREFERRED IN THIS POOL")}</span>{localizeText(ranking[0] ? <><button className="text-button" onClick={() => selectSite(ranking[0].id)}>{localizeText(name(ranking[0].id))}<ArrowRight size={15} /></button><span className="mono">{localizeText(decimal(ranking[0].score, 3))}{localizeText(" weighted fidelity")}{localizeText(ranking[0].partial ? ' · partial evidence' : '')}</span></> : <p>{localizeText("No eligible evidence for these objectives in this geographic view.")}</p>)}</div>
      <button className="outline-button" disabled={!ranking[0] || ranking[0].score <= 0} onClick={apply}><SlidersHorizontal size={14} />{localizeText(applied ? 'Applied to one-site campaign' : 'Apply these priorities to campaign')}</button>
    </div><div className="preference-analysis">
      <div className="section-heading"><span className="eyebrow">{localizeText("EXACT PREFERENCE FRONTIER")}</span><span className="mono">{localizeText(envelope.length ? envelope.length - 1 : 0)}{localizeText(" switches")}</span></div>
      <div className="preference-band" aria-label={localizeText("Winning sites over the full objective priority range")}>{localizeText(envelope.map((interval, i) => <button key={interval.id} style={{ width: `${100 * (interval.end - interval.start)}%`, backgroundColor: colors[i % colors.length] }} title={localizeText(`${name(interval.id)}: ${(100 * interval.start).toFixed(4)}–${(100 * interval.end).toFixed(4)}% objective B priority`)} aria-label={localizeText(`Explore ${name(interval.id)} winning interval`)} onClick={() => { setT((interval.start + interval.end) / 2); setApplied(false); }}><span>{localizeText(name(interval.id))}</span></button>))}<i style={{ left: `${100 * t}%` }} /></div>
      <div className="preference-axis mono"><span>{localizeText("100% A")}</span><span>50 / 50</span><span>{localizeText("100% B")}</span></div>
      <div className="switch-list">{localizeText(envelope.slice(1).map(interval => <div key={interval.id}><span className="mono">{localizeText((interval.start * 100).toFixed(2))}{localizeText("% B")}</span><ArrowRight size={12} /><button className="text-button" onClick={() => selectSite(interval.id)}>{localizeText(name(interval.id))}</button></div>))}{localizeText(envelope.length === 1 && <p className="small-copy muted">{localizeText("The same window leads throughout this priority range. Ties at exact boundaries use site ID order.")}</p>)}</div>
      <table className="preference-table"><caption className="sr-only">{localizeText("Top five single-site alternatives at the selected priorities")}</caption><thead><tr><th>{localizeText("EARTH WINDOW")}</th><th>{localizeText("A")}</th><th>{localizeText("B")}</th><th>{localizeText("WEIGHTED")}</th></tr></thead><tbody>{localizeText(ranking.slice(0, 5).map(row => <tr key={row.id}><th><button onClick={() => selectSite(row.id)}>{localizeText(name(row.id))}</button>{localizeText(row.partial && <small>{localizeText("partial evidence")}{localizeText(row.knownWeight < 1 ? ` · ${Math.round(row.knownWeight * 100)}% weight assessed` : '')}</small>)}</th><td>{localizeText(decimal(row.left))}</td><td>{localizeText(decimal(row.right))}</td><td>{localizeText(decimal(row.score, 3))}</td></tr>))}</tbody></table>
    </div></div>
    <div className="research-footnote"><ContextHelp label="Scoring model"><p>{localizeText("Score = (1 − t) × A + t × B. Missing objectives receive no credited coverage; a dash is unavailable evidence. Breakpoints are exact for these fixed model scores. Priority ranges describe preferences, not statistical confidence or physical suitability.")}</p></ContextHelp><button className="text-button" disabled={!lines.length} onClick={() => downloadJson({ schema: 'egiz.preference_export', version: '1.0.0', data_mode: useAppStore.getState().dataMode, synthetic: data!.results.synthetic, source_inputs: data!.results.inputs, target: targetId, lens, objectives: [a, b], priority_b: t, lines, intervals: envelope, ranking, scope: 'Single-site upper envelope of fixed objective scores; missing objectives receive no credit. Not measurement uncertainty or external validation.' }, 'egiz-preference-frontier.json')}><Download size={13} />{localizeText("Export analysis")}</button></div>
  </section>;
}
