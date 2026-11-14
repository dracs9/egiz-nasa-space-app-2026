// EGIZ Discover: Earth-wide analog search for lunar and Martian targets.
// Flow: target -> mission objective -> search scope -> ranked, explained candidates -> compare ->
// simulate -> dossier. Reads only the measured discovery bundle (pipeline/discovery).
// Written with AI assistance (Claude); human scientific review pending.
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Info, Search, TriangleAlert } from 'lucide-react';
import { t, useLanguage } from '../i18n';
import { aggregate, diverseTop, isWeakMatch, percentileFn } from './engine';
import { DiscoverMap } from './DiscoverMap';
import { CandidateDetail, ComparePanel } from './CandidateDetail';
import { CopilotPanel } from './CopilotPanel';
import { IntervalBar } from './charts';
import { KazakhstanPanel } from './KazakhstanPanel';
import type { DiscoveryBundle, ScoreShard, TargetEntry, ValidationDoc, ValidationTarget } from './types';
import './discover.css';

const base = () => `${import.meta.env.BASE_URL}discovery/`;
export async function loadBundle(fetcher: typeof fetch = fetch): Promise<DiscoveryBundle> {
  const r = await fetcher(`${base()}discovery.json`, { cache: 'no-cache' });
  if (!r.ok) throw new Error('Discovery bundle not found. Run python -m pipeline.discovery build.');
  const b = await r.json() as DiscoveryBundle;
  if (b.schema !== 'egiz.discovery' || !/^egiz-discovery-1\./.test(b.version) || b.synthetic !== false || !Array.isArray(b.windows?.id)) throw new Error('Discovery bundle has an unsupported format.');
  return b;
}
async function loadShard(t: TargetEntry): Promise<ScoreShard> {
  const r = await fetch(`${base()}${t.shard}`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`Score shard for ${t.id} missing.`);
  const s = await r.json() as ScoreShard;
  if (s.schema !== 'egiz.discovery_scores' || s.target !== t.id) throw new Error('Score shard has an unsupported format.');
  return s;
}

const REGIONS: { id: string; label: string; test(lon: number, lat: number, country: string | null): boolean }[] = [
  { id: 'world', label: 'Whole Earth', test: () => true },
  { id: 'kaz', label: 'Kazakhstan', test: (_, __, c) => c === 'KAZ' },
  { id: 'casia', label: 'Central Asia', test: (lon, lat) => lon >= 45 && lon <= 90 && lat >= 35 && lat <= 56 },
  { id: 'americas', label: 'Americas', test: lon => lon < -30 },
  { id: 'africa_me', label: 'Africa and Middle East', test: (lon, lat) => lon >= -20 && lon <= 63 && lat >= -36 && lat < 38 },
  { id: 'europe', label: 'Europe', test: (lon, lat) => lon >= -25 && lon <= 45 && lat >= 35 && lat <= 72 },
  { id: 'asia_pac', label: 'Asia-Pacific', test: lon => lon > 63 },
  { id: 'polar', label: 'Polar (|lat| ≥ 60°)', test: (_, lat) => Math.abs(lat) >= 60 },
];
const RANK_BY = [['score', 'Score (fidelity × coverage)'], ['fidelity', 'Fidelity (measured dimensions only)'], ['conservative', 'Conservative (lower 90 % bound × coverage)']] as const;
const STEPS = ['Target', 'Objective', 'Search', 'Candidates', 'Compare', 'Simulate', 'Dossier'];

export default function DiscoverPage() {
  useLanguage();
  const [bundle, setBundle] = useState<DiscoveryBundle | null>(null);
  const [validation, setValidation] = useState<ValidationDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadBundle().then(setBundle).catch(e => setError(String((e as Error).message ?? e)));
    fetch(`${base()}validation.json`, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(v => setValidation(v)).catch(() => setValidation(null));
  }, []);
  if (error) return <main className="page dc-page"><Intro /><div className="dc-notice" role="alert"><TriangleAlert size={16} /><p>{t(error)}</p></div></main>;
  if (!bundle) return <main className="page dc-page eg-loading"><span className="eg-loading-bar" aria-hidden="true" /><h1>{t('Loading the Earth-wide index…')}</h1></main>;
  return <Workspace bundle={bundle} validation={validation} />;
}

function Intro({ bundle }: { bundle?: DiscoveryBundle }) {
  return <div className="dc-intro">
    <p className="eg-eyebrow">EGIZ · {t('Discover')} · {t('Earth-wide analog search')}</p>
    <h1>{t('Where on Earth is the Moon or Mars — and where does the analogy break?')}</h1>
    <p>{t('Every Earth window is compared with the planetary target dimension by dimension, with uncertainty, Earth-wide rarity and the gaps no field site can close. Nothing is hand-picked: the ranking comes from measured data.')}</p>
    {bundle && <p className="dc-meta">{bundle.windows.id.length.toLocaleString()} {t('Earth windows')} · {t('population')}: {t(bundle.population.definition)} · {bundle.targets.length} {t('targets')} · {t('bundle')} {bundle.version} <code>{bundle.content_sha256.slice(0, 12)}</code></p>}
  </div>;
}

function readHash() {
  const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  return { target: q.get('target'), window: q.get('window'), profile: q.get('profile'), region: q.get('region') };
}
function writeHash(p: Record<string, string | null>) {
  const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  for (const [k, v] of Object.entries(p)) if (v) q.set(k, v); else q.delete(k);
  window.history.replaceState(null, '', `#/discover?${q.toString()}`);
}

function Workspace({ bundle, validation }: { bundle: DiscoveryBundle; validation: ValidationDoc | null }) {
  const init = useMemo(readHash, []);
  const [targetId, setTargetId] = useState(bundle.targets.find(x => x.id === init.target)?.id ?? bundle.targets.find(x => x.id === 'MARS_JEZERO')?.id ?? bundle.targets[0].id);
  const [profile, setProfile] = useState(init.profile && bundle.profiles[init.profile] ? init.profile : 'general');
  const [weights, setWeights] = useState<Record<string, number>>(() => ({ ...bundle.profiles[profile].weights }));
  const initRegion = init.region === 'kz' ? 'kaz' : init.region;  // #/discover?region=kz
  const [region, setRegion] = useState(REGIONS.some(r => r.id === initRegion) ? initRegion! : 'world');
  const [rankBy, setRankBy] = useState<typeof RANK_BY[number][0]>('score');
  const [evidence, setEvidence] = useState<'all' | 'strong' | 'no_missing'>('all');
  const [diverse, setDiverse] = useState(true);
  const [selected, setSelected] = useState<string | null>(init.window);
  const [compare, setCompare] = useState<string[]>([]);
  const [shard, setShard] = useState<ScoreShard | null>(null);
  const [shardError, setShardError] = useState<string | null>(null);
  const [showWeights, setShowWeights] = useState(false);
  const target = bundle.targets.find(x => x.id === targetId)!;

  useEffect(() => { setShard(null); setShardError(null); loadShard(target).then(setShard).catch(e => setShardError(String((e as Error).message))); }, [target]);
  useEffect(() => { writeHash({ target: targetId, profile, region, window: selected }); }, [targetId, profile, region, selected]);
  useEffect(() => { // shared links and back/forward inside the workspace
    const onHash = () => {
      const h = readHash();
      if (h.target && h.target !== targetId && bundle.targets.some(x => x.id === h.target)) setTargetId(h.target);
      if (h.window !== selected) setSelected(h.window && bundle.windows.id.includes(h.window) ? h.window : null);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [bundle, targetId, selected]);
  const chooseProfile = (p: string) => { setProfile(p); setWeights({ ...bundle.profiles[p].weights }); };

  const W = bundle.windows;
  const agg = useMemo(() => shard ? aggregate(shard, weights) : null, [shard, weights]);
  const rankValue = useMemo(() => {
    if (!agg) return null;
    return Float64Array.from(agg.score, (s, i) => rankBy === 'score' ? s : rankBy === 'fidelity' ? (Number.isFinite(agg.fidelity[i]) ? agg.fidelity[i] : 0) : (Number.isFinite(agg.lo[i]) ? agg.lo[i] * agg.coverage[i] : 0));
  }, [agg, rankBy]);
  const visible = useMemo(() => {
    const reg = REGIONS.find(r => r.id === region)!;
    return W.id.map((_, i) => reg.test(W.lon[i], W.lat[i], (W.country[i] as string | null) ?? null)
      && (!agg || evidence === 'all' || (evidence === 'strong' ? agg.category[i] === 'strong' : agg.category[i] !== 'missing_driven')));
  }, [W, region, evidence, agg]);
  const order = useMemo(() => rankValue ? W.id.map((_, i) => i).filter(i => visible[i]).sort((a, b) => rankValue[b] - rankValue[a]) : [], [rankValue, visible, W]);
  const globalRank = useMemo(() => { const m = new Map<number, number>(); if (agg) W.id.map((_, i) => i).sort((a, b) => agg.score[b] - agg.score[a]).forEach((i, n) => m.set(i, n + 1)); return m; }, [agg, W]);
  const list = useMemo(() => rankValue ? (diverse ? diverseTop(order, rankValue, W.lon, W.lat, 25, 150) : order.slice(0, 25)) : [], [order, rankValue, diverse, W]);
  const scorePct = useMemo(() => agg ? percentileFn(agg.score, W.in_population) : () => NaN, [agg, W]);
  const dimPct = useMemo(() => {
    if (!shard) return () => NaN;
    const fns = new Map(shard.dims.map((d, k) => [d, percentileFn(shard.s50[k].map(v => v ?? NaN), W.in_population)]));
    return (d: string, v: number) => fns.get(d)?.(v) ?? NaN;
  }, [shard, W]);
  const maxScore = useMemo(() => agg ? Math.max(1e-6, ...Array.from(agg.score)) : 1, [agg]);
  const selIndex = selected ? W.id.indexOf(selected) : -1;
  const entry = target.shortlist.find(e => e.window === selected);
  const established = useMemo(() => bundle.benchmark_sites.filter(b => b.role === 'analog').map(b => ({ id: b.id, lon: b.lon, lat: b.lat, name: b.name })), [bundle]);
  const toggleCompare = (id: string) => setCompare(c => c.includes(id) ? c.filter(x => x !== id) : [...c, id].slice(-3));
  const hypotheses = target.benchmark.filter(b => b.role === 'hypothesis');
  const val = validation?.targets.find(v => v.target === target.id);

  return <main className="page dc-page">
    <Intro bundle={bundle} />
    <ol className="dc-steps" aria-label={t('Workflow')}>{STEPS.map((s, i) => <li key={s} className={i <= (selected ? (compare.length > 1 ? 4 : 3) : 2) ? 'done' : ''}><span>{String(i + 1).padStart(2, '0')}</span>{t(s)}</li>)}</ol>

    <section className="dc-config" aria-label={t('Search configuration')}>
      <label className="dc-field"><span>{t('Planetary target')}</span>
        <select value={targetId} onChange={e => { setTargetId(e.target.value); setSelected(null); setCompare([]); }}>
          {(['moon', 'mars'] as const).map(b => <optgroup key={b} label={b === 'moon' ? t('Moon') : t('Mars')}>{bundle.targets.filter(x => x.body === b).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>)}
        </select></label>
      <label className="dc-field"><span>{t('Mission objective')}</span>
        <select value={profile} onChange={e => chooseProfile(e.target.value)}>{Object.entries(bundle.profiles).map(([k, p]) => <option key={k} value={k}>{t(p.label)}</option>)}</select></label>
      <label className="dc-field"><span>{t('Search region')}</span>
        <select value={region} onChange={e => setRegion(e.target.value)}>{REGIONS.map(r => <option key={r.id} value={r.id}>{t(r.label)}</option>)}</select></label>
      <label className="dc-field"><span>{t('Rank by')}</span>
        <select value={rankBy} onChange={e => setRankBy(e.target.value as typeof rankBy)}>{RANK_BY.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></label>
      <label className="dc-field"><span>{t('Evidence filter')}</span>
        <select value={evidence} onChange={e => setEvidence(e.target.value as typeof evidence)}>
          <option value="all">{t('All windows')}</option><option value="no_missing">{t('Exclude missing-driven')}</option><option value="strong">{t('Strong evidence only')}</option></select></label>
      <label className="dc-check"><input type="checkbox" checked={diverse} onChange={e => setDiverse(e.target.checked)} />{t('Geographic diversity (≥ 150 km apart)')}</label>
      <button className="dc-weights-toggle" aria-expanded={showWeights} onClick={() => setShowWeights(v => !v)}>{t('Dimension weights')} <ChevronDown size={14} /></button>
    </section>

    {showWeights && <section className="dc-weights" aria-label={t('Dimension weights')}>
      {bundle.dimensions.map(d => { const st = target.dimension_status[d.id]; return <label key={d.id} className={`dc-weight ${st !== 'measured' ? 'off' : ''}`} title={d.method || d.reason || d.bodies_not_applicable[target.body]}>
        <span>{t(d.label)}<small>{st === 'measured' ? t('measured') : st === 'not_applicable' ? t('not applicable to this body') : t('not assessed — no dataset')}</small></span>
        <input type="range" min={0} max={3} step={0.25} value={weights[d.id] ?? 0} disabled={st === 'not_applicable'} onChange={e => setWeights(w => ({ ...w, [d.id]: Number(e.target.value) }))} />
        <b>{(weights[d.id] ?? 0).toFixed(2)}</b></label>; })}
      <p className="dc-note">{t('Not-assessed dimensions keep their weight in coverage: giving them weight lowers every score instead of rewarding missing data.')}</p>
    </section>}

    <TargetCard target={target} />
    <TrustCard val={val} />
    {shardError && <div className="dc-notice" role="alert"><TriangleAlert size={16} /><p>{shardError}</p></div>}

    <div className="dc-main">
      <DiscoverMap ids={W.id} lon={W.lon} lat={W.lat} score={rankValue ?? new Float64Array(W.id.length)} visible={visible} maxScore={rankBy === 'score' ? maxScore : 1}
        shortlist={list.map(i => W.id[i])} selected={selected} established={established} onSelect={setSelected} />
      <section className="dc-results" aria-labelledby="dc-results-title">
        <header><h2 id="dc-results-title"><Search size={15} /> {t('Ranked candidates')}</h2>
          <p className="dc-note">{order.length.toLocaleString()} {t('windows in scope')} · {t('top')} {list.length}{diverse ? ` · ${t('diverse')}` : ''}</p></header>
        {!agg ? <p className="dc-note">{t('Loading scores…')}</p> : <ol className="dc-list">
          {list.map((i, n) => <li key={W.id[i]}>
            <button className={`dc-item ${selected === W.id[i] ? 'active' : ''}`} onClick={() => setSelected(W.id[i])}>
              <span className="dc-rank">{n + 1}</span>
              <span className="dc-item-main"><b>{String(W.name[i])}</b>{isWeakMatch(agg.fidelity[i], agg.lo[i]) && <em className="dc-weak" title={t('Fidelity or its lower 90 % bound is below 0.3')}>{n === 0 ? t('closest found — weak match') : t('weak match')}</em>}<small>{String(W.country[i] ?? '—')} · {W.lat[i].toFixed(2)}°, {W.lon[i].toFixed(2)}° · {t(String(W.novelty_class[i]).replace('_', ' '))}</small>
                <IntervalBar s50={agg.fidelity[i]} lo={agg.lo[i]} hi={agg.hi[i]} label={String(W.name[i])} /></span>
              <span className="dc-item-score"><b>{agg.score[i].toFixed(3)}</b><small>{t('cov')} {agg.coverage[i].toFixed(2)}</small><i className={`dc-cat dc-cat-${agg.category[i]}`}>{t(agg.category[i].replace('_', ' '))}</i></span>
            </button></li>)}
        </ol>}
      </section>
    </div>

    {region === 'kaz' && <KazakhstanPanel target={target} onSelect={setSelected} />}
    {agg && shard && selIndex >= 0 && <CandidateDetail bundle={bundle} target={target} shard={shard} agg={agg} i={selIndex} rank={globalRank.get(selIndex) ?? 0}
      weights={weights} profile={profile} dimPct={dimPct} scorePct={scorePct} entry={entry} validation={validation}
      inCompare={compare.includes(selected!)} onCompare={() => toggleCompare(selected!)} onClose={() => setSelected(null)} />}
    {agg && shard && compare.length > 0 && <ComparePanel bundle={bundle} shard={shard} agg={agg} ids={compare} onRemove={id => setCompare(c => c.filter(x => x !== id))} target={target} />}

    <div className="dc-cols dc-bottom">
      {agg && shard && <CopilotPanel ctx={{ bundle, target, shard, weights, selected, compare, validation }} onSelect={setSelected} />}
      <section className="dc-validation" aria-labelledby="dc-val-title">
        <h2 id="dc-val-title"><Info size={15} /> {t('Is the method any good?')}</h2>
        {val ? <>
          <p>{t('Published analog sites for this body vs the Earth-wide lattice')}: <b>ROC AUC {String(val.metrics.auc)}</b> {Array.isArray(val.metrics.auc_90ci) ? `[90 % ${val.metrics.auc_90ci.join('–')}]` : ''}, n = {val.positives.length}; {t('vs designated controls')} {String(val.metrics.auc_vs_designated_controls)}; {t('seed-to-seed rank correlation')} {val.reproducibility.spearman_seed_2026_vs_7}.</p>
          <table className="dc-table"><thead><tr><th>{t('Published analog')}</th><th>{t('Percentile')}</th><th>{t('Literature claim')}</th></tr></thead>
            <tbody>{val.per_positive.map(p => <tr key={p.site}><th scope="row"><button className="dc-link" onClick={() => setSelected(p.window)}>{bundle.benchmark_sites.find(b => b.id === p.site)?.name ?? p.site}</button></th><td className="dc-mono">{p.percentile.toFixed(1)}</td><td><small>{p.aspects.join(', ')}</small></td></tr>)}</tbody></table>
          <details><summary>{t('Ablation: AUC without each dimension')}</summary><ul>{Object.entries(val.ablation_auc_without).map(([d, a]) => <li key={d}>{t(bundle.dimensions.find(x => x.id === d)?.label ?? d)}: {a}</li>)}</ul></details>
          <ul className="dc-caveats">{validation!.caveats.map((c, k) => <li key={k}>{t(c)}</li>)}</ul>
        </> : <p className="dc-note">{t('No validation record for this target. Run python -m pipeline.discovery validate.')}</p>}
        {hypotheses.length > 0 && <>
          <h3>{t('Kazakhstan hypotheses (not forced into the ranking)')}</h3>
          <table className="dc-table"><tbody>{hypotheses.map(h => <tr key={h.site}><th scope="row"><button className="dc-link" onClick={() => setSelected(h.window)}>{bundle.benchmark_sites.find(b => b.id === h.site)?.name ?? h.site}</button></th>
            <td className="dc-mono">{h.rank ? `#${h.rank}` : t('not acquired')}</td><td className="dc-mono">{h.score_percentile != null ? `${t('pct')} ${h.score_percentile.toFixed(1)}` : ''}</td></tr>)}</tbody></table>
          <p className="dc-note">{t('Ranks under the general profile, out of all Earth windows.')}</p>
        </>}
      </section>
    </div>
  </main>;
}

const fmtCi = (ci: unknown) => Array.isArray(ci) ? `[90 % ${ci.join('–')}]` : '';

/** "How far to trust this ranking": the validation numbers a judge needs, next to the ranking itself. */
function TrustCard({ val }: { val: ValidationTarget | undefined }) {
  if (!val) return null;
  const m = val.metrics, h = m.hard_negative;
  const r50 = typeof m['recall@50'] === 'number' ? m['recall@50'] : null;
  return <section className="dc-trust" aria-labelledby="dc-trust-title">
    <h2 id="dc-trust-title"><Info size={15} /> {t('How far to trust this ranking')}</h2>
    <dl className="dc-trust-grid">
      <div><dt>{t('AUC vs typical Earth land')}</dt><dd className="dc-mono">{String(m.auc)} <small>{fmtCi(m.auc_90ci)}</small></dd></div>
      <div><dt>{t('AUC vs bare, arid, latitude-matched land')}</dt><dd className="dc-mono">{h?.auc == null ? '—' : String(h.auc)} <small>{fmtCi(h?.auc_90ci)}</small></dd></div>
      <div><dt>{t('Known analogs found in the top 50 (recall@50)')}</dt><dd className="dc-mono">{r50 == null ? '—' : `${(r50 * 100).toFixed(0)} %`}</dd></div>
      <div><dt>{t('Positive sites')}</dt><dd className="dc-mono">{val.positives.length}</dd></div>
    </dl>
    <p className="dc-note">{t('The positive labels are places where past analog campaigns ran — chosen for logistics and training as much as similarity — not ground truth. An AUC of 0.5 means no better than chance.')}</p>
    {h && <p className="dc-note">{t('Hard control')}: {h.n_hard_negative} {t('windows')}; {h.n_positive_matched}/{val.positives.length} {t('positives have latitude-matched controls')} ({t('per positive')}: {h.n_per_positive.join(', ')}).</p>}
  </section>;
}

function TargetCard({ target }: { target: TargetEntry }) {
  const fp = target.fingerprint;
  const terr = Object.entries(fp.terrain ?? {});
  return <section className={`dc-target body-${target.body}`} aria-label={t('Target fingerprint')}>
    <div>
      <p className="eg-eyebrow">{target.body === 'moon' ? t('Moon') : t('Mars')} · {t(target.kind.replace('_', ' '))} · {target.lat.toFixed(3)}°, {target.lon.toFixed(3)}°</p>
      <h2>{target.name}</h2>
      <p>{target.significance}</p>
      <p className="dc-note">{target.dem} · {t('fine baseline')} {target.fine_baseline_m} m · {target.coordinate_reference}</p>
    </div>
    <dl className="dc-fp">
      {terr.map(([k, f]) => <div key={k}><dt>{k}</dt><dd>{typeof f.value === 'number' ? (+f.value.toPrecision(3)).toString() : '—'} {f.unit}{f.sigma ? <small> ± {+f.sigma.toPrecision(2)}</small> : null}</dd></div>)}
      <div><dt>{t('noon Sun elevation')}</dt><dd>{String(fp.illumination?.noon_elevation_min_deg?.value)}° – {String(fp.illumination?.noon_elevation_max_deg?.value)}°</dd></div>
      <div><dt>{t('geology (literature)')}</dt><dd>{(fp.geology?.classes?.value as string[] | undefined)?.join(', ')}</dd></div>
      <div><dt>{t('temperature reference')}</dt><dd>{(fp.thermal?.air_or_surface_range_k?.value as number[] | undefined)?.join('–')} K</dd></div>
    </dl>
  </section>;
}
