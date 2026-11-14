// EGIZ · step 4, Alternatives. How does the mission site compare with every other measured site on its world?
// Terrain resemblance (standardised fingerprint differences), shared Earth analogs (top-50 overlap under the same
// priorities, computed from the published score shards), evidence and data coverage — and the option to change the
// mission site, with its consequences stated before anything changes.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, GitCompareArrows, LoaderCircle, Repeat } from 'lucide-react';
import { t } from '../../i18n';
import type { ScoreShard, TargetEntry } from '../../discover/types';
import { usePlanet } from '../../planet/workspace/store';
import { COMPARE_FEATURES, overlap, resemblance, surfaceKm, topWindows } from '../../planet/journey/alternatives';
import { arcDeg, type Globe } from '../../planet/journey/globe';
import { FEATURE_INFO, featureValue, WORLD } from '../../planet/journey/knowledge';
import { GlobeView, type GlobeMarker } from '../GlobeView';
import { SlopeCdf } from '../SlopeCdf';
import { goStep } from '../actions';
import { StepFooter, StepHead } from '../ExpeditionPage';
import { short } from '../format';

const BASE = import.meta.env.BASE_URL, K = 50;
const likeness = (z: number) => (!Number.isFinite(z) ? 'not comparable' : z < 0.5 ? 'very similar terrain' : z < 1 ? 'similar terrain' : z < 1.75 ? 'different terrain' : 'very different terrain');
const fmt = (key: string, v: number) => `${v.toFixed(FEATURE_INFO[key]?.digits ?? 1)}${key.endsWith('_deg') ? '°' : key.endsWith('_m') ? ' m' : ''}`;
type Shared = Record<string, { n: number; jaccard: number; ids: string[] }>;

export function AlternativesStep() {
  const s = usePlanet(), b = s.bundle, base = s.inv.target ? s.target() : null, world = base?.body ?? s.world() ?? 'mars', weights = s.weights();
  const peers = useMemo(() => b?.targets.filter(x => x.body === world) ?? [], [b, world]);
  const ranked = useMemo(() => (base ? resemblance(base, peers) : []), [base, peers]);
  const [pick, setPick] = useState<string | null>(null), [shared, setShared] = useState<Shared | null>(null), [busy, setBusy] = useState<string | null>(null), [confirm, setConfirm] = useState<string | null>(null);
  const globe = useRef<Globe | null>(null), [ready, setReady] = useState(false), cache = useRef(new Map<string, ScoreShard>());
  useEffect(() => { setShared(null); setConfirm(null); setPick(ranked[0]?.id ?? null); }, [base?.id, JSON.stringify(weights), ranked.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const sel = peers.find(x => x.id === pick) ?? null;
  useEffect(() => { if (!ready || !base) return; const x = sel ?? base; const arc = (arcDeg(base, x) * Math.PI) / 180; globe.current?.flyTo((base.lat + x.lat) / 2, base.lon + (((x.lon - base.lon + 540) % 360) - 180) / 2, Math.min(3.4, Math.max(1.12, 1.2 + 2.9 * arc)), 1200); }, [ready, pick, base?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const computeShared = async () => {
    if (!b || !base || (busy && !busy.startsWith('!'))) return; const out: Shared = {};
    try {
      const get = async (x: TargetEntry) => { if (s.shard?.target === x.id) return s.shard; if (cache.current.has(x.id)) return cache.current.get(x.id)!; const r = await fetch(`${BASE}discovery/${x.shard}`, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${x.shard}: HTTP ${r.status}`); const j = await r.json() as ScoreShard; cache.current.set(x.id, j); return j; };
      setBusy(`${t('Loading scores for')} ${base.id}…`); const mine = topWindows(b, await get(base), weights, K);
      for (const [i, p] of peers.filter(p => p.id !== base.id).entries()) { setBusy(`${t('Ranking Earth for')} ${short(p.name)} (${i + 1}/${peers.length - 1})…`); const o = overlap(mine, topWindows(b, await get(p), weights, K)); out[p.id] = { n: o.shared.length, jaccard: o.jaccard, ids: o.shared }; }
      setShared(out); setBusy(null);
    } catch (e) { setBusy(`!${t('Could not compute shared analogs')}: ${e instanceof Error ? e.message : e}`); }
  };
  if (!b || !base) return <div className="xp-msg" role="status">{s.discoveryError ?? t('Loading the measured site index…')}</div>;
  const markers: GlobeMarker[] = peers.map(x => ({ id: x.id, lat: x.lat, lon: x.lon, kind: x.id === base.id ? 'site' : 'alt', label: short(x.name), sub: x.id === base.id ? t('mission site') : undefined, on: x.id === base.id || x.id === pick, onClick: x.id === base.id ? undefined : () => setPick(x.id) }));
  const keys = COMPARE_FEATURES[world].filter(k => peers.some(p => featureValue(p, k) !== null));
  const validation = (id: string) => { const v = s.validation?.targets.find(z => z.target === id), auc = v?.metrics.auc; return typeof auc === 'number' ? auc.toFixed(2) : '—'; };
  const doSwitch = (id: string) => { usePlanet.getState().investigate(id, 'switch'); setConfirm(null); goStep('analysis', id); };

  return <div className="xp-alts">
    <div className="xp-map xp-alts-map"><GlobeView body={world} markers={markers} labels="all" onReady={g => { globe.current = g; setReady(!!g); }}>
      <p className="xp-hud xp-hud-tl"><b>{peers.length} {t('measured sites')}</b><span>◆ {t('mission site')} · ○ {t('alternative — click to compare')}</span></p></GlobeView></div>
    <div className="xp-alts-main">
      <StepHead step="alternatives">{t('Every site below has a measured fingerprint. EGIZ compares each with the mission site in two ways: how alike the ground is, and whether the same places on Earth could rehearse both.')} <b>{short(base.name)}</b>.</StepHead>
      <section className="xp-strips" aria-label={t('Fingerprints side by side')}>
        <h2 className="xp-h3">{t('Fingerprints side by side')}</h2>
        {keys.map(k => { const vals = peers.map(p => ({ p, v: featureValue(p, k) })).filter((z): z is { p: TargetEntry; v: number } => z.v !== null), lo = Math.min(...vals.map(z => z.v)), hi = Math.max(...vals.map(z => z.v)), pos = (v: number) => `${hi > lo ? ((v - lo) / (hi - lo)) * 100 : 50}%`;
          return <div key={k} className="xp-strip" title={t(FEATURE_INFO[k]?.explain ?? '')}><span className="xp-strip-l">{t(FEATURE_INFO[k]?.label ?? k)}</span>
            <span className="xp-strip-track">{vals.map(({ p, v }) => <i key={p.id} className={p.id === base.id ? 'me' : p.id === pick ? 'pick' : ''} style={{ left: pos(v) }} title={`${p.name}: ${fmt(k, v)}`} />)}</span>
            <span className="xp-strip-v">{fmt(k, lo)} – {fmt(k, hi)}</span></div>; })}
        <p className="xp-dim xp-small"><i className="xp-dot me" /> {t('mission site')} <i className="xp-dot pick" /> {t('selected alternative')} <i className="xp-dot" /> {t('others')}. {t('Relief is compared on a log scale.')}</p>
      </section>
      <section aria-label={t('Ranked alternatives')}>
        <div className="xp-row xp-between"><h2 className="xp-h3">{t('Alternatives, most alike first')}</h2>
          <button className="eg-button quiet" onClick={computeShared} disabled={!!busy && !busy.startsWith('!')}>{busy && !busy.startsWith('!') ? <><LoaderCircle size={14} className="xp-spin" /><span>{t('Computing…')}</span></> : <><GitCompareArrows size={14} /><span>{shared ? t('Recompute shared Earth analogs') : t('Compute shared Earth analogs')}</span></>}</button></div>
        {busy && <p className="xp-dim" role="status">{busy.replace(/^!/, '')}</p>}
        <ol className="xp-altlist">{ranked.map(r => { const p = peers.find(z => z.id === r.id)!, sh = shared?.[r.id], ref = s.refs.some(z => z.id === p.id), measured = b.dimensions.filter(d => p.dimension_status[d.id] === 'measured').length;
          return <li key={r.id} className={pick === r.id ? 'on' : ''}>
            <button className="xp-alt-head" onClick={() => setPick(r.id)} aria-pressed={pick === r.id}><b>{short(p.name)}</b><span>{Math.round(surfaceKm(base, p, WORLD[world].radiusKm)).toLocaleString('en')} km · {t(likeness(r.meanZ))} ({Number.isFinite(r.meanZ) ? r.meanZ.toFixed(2) : '—'} SD)</span></button>
            {pick === r.id && <div className="xp-alt-body">
              <p>{p.significance}</p>
              <div className="xp-table-wrap"><table className="xp-delta"><thead><tr><th>{t('Feature')}</th><th>{short(base.name)}</th><th>{short(p.name)}</th><th>{t('Difference')}</th></tr></thead>
                <tbody>{r.deltas.map(d => <tr key={d.key}><th>{t(d.label)}</th><td>{fmt(d.key, d.a)}</td><td>{fmt(d.key, d.b)}</td><td className={Math.abs(d.z) > 1 ? 'big' : ''}>{d.diff >= 0 ? '+' : ''}{fmt(d.key, d.diff)}</td></tr>)}</tbody></table></div>
              <SlopeCdf focus={p} peers={[base]} />
              <dl className="xp-facts">
                <div><dt>{t('Dimensions with evidence')}</dt><dd>{measured} / {b.dimensions.length}</dd></div>
                <div><dt>{t('Earth windows on strong evidence')}</dt><dd>{p.n_strong_evidence.toLocaleString('en')} / {p.n_scored.toLocaleString('en')}</dd></div>
                <div><dt>{t('Validation AUC')}</dt><dd>{validation(p.id)} <span className="xp-dim">({t('mission site')} {validation(base.id)})</span></dd></div>
                <div><dt>{t('Measured 3D terrain')}</dt><dd>{ref ? t('packaged') : t('not packaged')}</dd></div>
                <div><dt>{t('Shared Earth analogs')} (top {K})</dt><dd>{sh ? `${sh.n} / ${K} · Jaccard ${sh.jaccard.toFixed(2)}` : t('not computed yet')}</dd></div>
              </dl>
              {sh && <p className="xp-dim">{t(sh.n >= 25 ? 'Most of the same Earth sites would rehearse both: changing site mainly changes the planetary terrain, not the field campaign.' : sh.n >= 8 ? 'Some Earth sites rehearse both; a campaign could cover the two with a few additional sites.' : 'Almost no Earth site rehearses both: changing site would mean a different field campaign.')}</p>}
              {confirm === p.id ? <div className="xp-confirm" role="alertdialog" aria-label={`${t('Change the mission site to')} ${p.name}`}>
                <p><b>{t('Change the mission site to')} {short(p.name)}?</b></p>
                <ul><li>{t('The Earth-analog ranking is recomputed for the new site.')}</li><li>{t('The analysis is marked as needing a re-run.')}</li><li>{t('Kept: Earth analogs, marks, measurements and simulations — each stays tied to the site where it was made, and Mission Home flags what needs recalculating.')}</li><li>{short(base.name)} {t('is recorded as an alternative considered; you can switch back at any time.')}</li></ul>
                <div className="xp-row"><button className="eg-button" onClick={() => doSwitch(p.id)}><Repeat size={14} />{t('Change and re-analyse')}</button><button className="eg-button quiet" onClick={() => setConfirm(null)}><span>{t('Keep')} {short(base.name)}</span></button></div></div>
                : <div className="xp-row"><button className="eg-button quiet" onClick={() => setConfirm(p.id)}><Repeat size={14} /><span>{t('Investigate this site instead')}</span></button>
                  <button className="xp-link" onClick={() => goStep('explore', p.id)}>{t('Open it on the globe')}<ArrowRight size={12} /></button></div>}
            </div>}
          </li>; })}</ol>
        <p className="xp-dim xp-small">{t('Terrain resemblance is the mean absolute difference over the fingerprint features, each in units of its spread across the sites of this world. Shared analogs compare the top-50 Earth windows ranked with your current priorities.')}</p>
      </section>
      <StepFooter step="alternatives" why="Every mission is rehearsed on Earth first. Find the places on Earth that resemble your site — and where they do not." />
    </div>
  </div>;
}
