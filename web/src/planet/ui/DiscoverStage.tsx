// EGIZ Planetary Studio · Discover stage. The Earth-wide candidate map and ranking for the active planetary
// target, with adjustable priorities, an explicit candidate profile and one-click hand-off to 3D terrain.
// Ranking and uncertainty come from the measured discovery index (discover/engine); nothing is re-scored by hand.
import { useEffect, useMemo, useState } from 'react';
import { Box, Plus, Check } from 'lucide-react';
import type { Status } from '../../atlas/types';
import { DiscoverMap } from '../../discover/DiscoverMap';
import { aggregate, col, gapLedger, text } from '../../discover/engine';
import { fitCandidateSpace, mmr } from '../intel/ml';
import { BODY_LABEL } from '../terrain/site';
import { candidateFeatures, FEATURES } from '../workspace/investigation';
import { usePlanet } from '../workspace/store';
import { Fact, Interval } from './charts';
import { PanelShell, useCtl } from './ctl';

const STATUS_LABEL: Record<Status, string> = { SUPPORTED: 'Supported', CONDITIONAL: 'Conditional', WEAK: 'Weak', NON_TRANSFERABLE: 'Non-transferable', UNKNOWN: 'Unknown' };
const n = (v: number | null | undefined, d = 1, u = '') => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(d)}${u}`);
export function DiscoverStage() {
  const s = usePlanet(), ctl = useCtl(), b = s.bundle, shard = s.shard, target = s.target(), weights = s.weights();
  const [selected, setSelected] = useState<string | null>(s.inv.candidates[0] ?? null), [country, setCountry] = useState(''), [strong, setStrong] = useState(false), [diverse, setDiverse] = useState(false), [fitting, setFitting] = useState<string | null>(null);
  useEffect(() => { const h = (e: Event) => setSelected((e as CustomEvent<string>).detail); window.addEventListener('egiz-planet-select', h); return () => window.removeEventListener('egiz-planet-select', h); }, []);
  const agg = useMemo(() => (shard && shard.target === target?.id ? aggregate(shard, weights) : null), [shard, target?.id, JSON.stringify(weights)]); // eslint-disable-line react-hooks/exhaustive-deps
  const view = useMemo(() => {
    if (!b || !agg) return null;
    const ids = b.windows.id, visible = ids.map((_, i) => agg.score[i] > 0 && (!country || b.windows.country[i] === country) && (!strong || agg.category[i] === 'strong'));
    let order = ids.map((_, i) => i).filter(i => visible[i]).sort((x, y) => agg.score[y] - agg.score[x]);
    if (diverse && s.space) { const pool = order.slice(0, 120).filter(i => s.space!.rows.includes(i)), z = pool.map(i => new Float64Array(s.space!.pca.scores[s.space!.rows.indexOf(i)])); order = mmr(pool.map(i => agg.score[i]), z, Math.min(25, pool.length), 0.6).map(k => pool[k]); }
    let max = 0; for (let i = 0; i < ids.length; i++) if (visible[i] && agg.score[i] > max) max = agg.score[i];
    return { visible, order: order.slice(0, 40), max: max || 1 };
  }, [b, agg, country, strong, diverse, s.space]);
  if (s.discoveryError && !b) return <div className="pl-discover"><div className="pl-overlay" role="alert"><p>{s.discoveryError}</p><p className="pl-dim">You can still open packaged terrain from the Inspect stage.</p></div></div>;
  if (!b || !target) return <div className="pl-discover"><div className="pl-overlay" role="status"><span className="eg-loading-bar" aria-hidden="true" /><p>Loading the Earth-wide discovery index…</p></div></div>;
  const countries = [...new Set(b.windows.country.filter((c): c is string => typeof c === 'string'))].sort(), i = selected ? b.windows.id.indexOf(selected) : -1;
  const packaged = selected ? s.refs.find(r => r.discoveryWindow === selected) : undefined, targetRef = s.refs.find(r => r.id === target.id), measured = b.dimensions.filter(d => target.dimension_status[d.id] === 'measured');
  const atlasCells = s.atlas && selected ? s.atlas.tensor.cells.filter(c => c.site === selected && c.target === target.id) : [], gaps = i >= 0 && shard ? gapLedger(b, target.body, target.lat, i, shard.w1_deg[i]).filter(g => g.measurable).slice(0, 6) : [];
  const fit = () => { setFitting('Fitting the candidate space…'); window.setTimeout(() => { try { const f = candidateFeatures(b); usePlanet.getState().set({ space: fitCandidateSpace(f.x, FEATURES.map(x => x.label), f.lon, f.lat) }); setFitting(null); } catch (e) { setFitting(e instanceof Error ? e.message : String(e)); } }, 30); };
  const sp = s.space, spi = sp && i >= 0 ? sp.rows.indexOf(i) : -1;
  return <div className="pl-discover">
    <div className="pl-map">{agg && view ? <DiscoverMap ids={b.windows.id} lon={b.windows.lon} lat={b.windows.lat} score={agg.score} visible={view.visible} maxScore={view.max} shortlist={view.order.slice(0, 25).map(k => b.windows.id[k])} selected={selected} established={b.benchmark_sites} onSelect={setSelected} />
      : <div className="pl-overlay" role="status"><span className="eg-loading-bar" aria-hidden="true" /><p>Loading scores for {target.id}…</p></div>}</div>
    <PanelShell wide label="Discovery controls"><div className="pl-pad">
      <label className="pl-field">Planetary target<select value={target.id} onChange={e => { s.patchInv({ target: e.target.value, weights: null }); }}>{b.targets.map(t => <option key={t.id} value={t.id}>{BODY_LABEL[t.body]} — {t.name}</option>)}</select></label>
      <p className="pl-note">{target.significance} Fingerprint from {target.dem}, {target.fine_baseline_m} m slope baseline.{' '}
        {targetRef ? <button className="pl-link" onClick={() => { ctl.open({ ref: targetRef }); s.setStage('inspect'); }}>Open the target's measured terrain in 3D →</button> : <span>No 3D terrain package exists for this target.</span>}</p>
      <details className="pl-sec"><summary>Mission priorities</summary><div>
        <label className="pl-field">Profile<select value={s.inv.profile} onChange={e => s.patchInv({ profile: e.target.value, weights: null })}>{Object.entries(b.profiles).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select></label>
        <div className="pl-weights">{b.dimensions.map(d => { const ok = target.dimension_status[d.id] === 'measured'; return <label key={d.id} className={ok ? '' : 'off'} title={ok ? d.method : `${target.dimension_status[d.id].replace('_', ' ')}${d.reason ? `: ${d.reason}` : ''}`}><span>{d.label}{!ok && <em className="pl-ev ev-missing">{target.dimension_status[d.id].replace('_', ' ')}</em>}</span>
          <input type="range" min={0} max={3} step={0.5} disabled={!ok} value={weights[d.id] ?? 0} onChange={e => s.patchInv({ weights: { ...weights, [d.id]: Number(e.target.value) } })} /><b>{(weights[d.id] ?? 0).toFixed(1)}</b></label>; })}</div>
        <p className="pl-note">{measured.length} of {b.dimensions.length} dimensions are measured for this target; the rest cannot influence the ranking and are reported as missing coverage. Weights are preferences, not measurements.</p>
      </div></details>
      <details className="pl-sec" open><summary>Ranked candidates{view && ` (top ${view.order.length})`}</summary><div>
        <div className="pl-row"><select aria-label="Country filter" value={country} onChange={e => setCountry(e.target.value)}><option value="">All countries</option>{countries.map(c => <option key={c} value={c}>{c}</option>)}</select>
          <button className={country === 'KAZ' ? 'on' : ''} onClick={() => setCountry(country === 'KAZ' ? '' : 'KAZ')}>Kazakhstan</button>
          <label className="pl-check"><input type="checkbox" checked={strong} onChange={e => setStrong(e.target.checked)} />Strong evidence only</label></div>
        <div className="pl-row"><button onClick={fit} disabled={!!fitting && !/[.!]$/.test(fitting)}>{sp ? 'Refit candidate space' : 'Fit candidate space (ML)'}</button>{sp && <label className="pl-check"><input type="checkbox" checked={diverse} onChange={e => setDiverse(e.target.checked)} />Diverse shortlist</label>}</div>
        {fitting && <p className="pl-note" role="status">{fitting}</p>}
        {sp && <p className="pl-note"><em className="pl-ev ev-model">model</em> {sp.nRows} windows in {sp.k} groups · silhouette {sp.silhouette.toFixed(2)} · geographic hold-out ARI {n(sp.geographicHoldoutAri, 2)} · seed stability {sp.seedStabilityAri.toFixed(2)}. Unsupervised structure of terrain and climate features — not an analog-quality prediction.{diverse && ' Shortlist: maximal marginal relevance over the top 120 by score.'}</p>}
        <ol className="pl-rank">{view && agg && view.order.map((k, r) => { const id = b.windows.id[k]; return <li key={id} className={id === selected ? 'on' : ''}><button onClick={() => setSelected(id)}>
          <span className="pl-rank-n">{r + 1}</span><span className="pl-rank-id"><b>{b.windows.name[k]}</b><em>{id} · {b.windows.country[k] ?? '—'}{sp && sp.rows.includes(k) ? ` · group ${sp.labels[sp.rows.indexOf(k)] + 1}` : ''}</em></span>
          <span className="pl-rank-v">{agg.fidelity[k].toFixed(3)}<Interval lo={agg.lo[k]} mid={agg.fidelity[k]} hi={agg.hi[k]} max={Math.max(0.05, view.max * 1.6)} /></span><span className={`pl-cat c-${agg.category[k]}`}>{agg.category[k].replace('_', ' ')}</span></button></li>; })}</ol>
        {view && !view.order.length && <p className="pl-empty">No window passes these filters.</p>}
      </div></details>
      {i >= 0 && agg && shard && <details className="pl-sec" open><summary>Candidate profile — {b.windows.name[i]}</summary><div>
        <div className="pl-row"><button className="pl-primary" onClick={() => { if (packaged) ctl.open({ ref: packaged }); else ctl.open({ stream: { id: selected!, name: b.windows.name[i], lat: b.windows.lat[i], lon: b.windows.lon[i] } }); if (!s.inv.candidates.includes(selected!)) s.toggleCandidate(selected!); s.setStage('inspect'); }}><Box size={14} />Open terrain in 3D</button>
          <button onClick={() => s.toggleCandidate(selected!)}>{s.inv.candidates.includes(selected!) ? <><Check size={14} />In investigation</> : <><Plus size={14} />Add to investigation</>}</button></div>
        <p className="pl-note">{packaged ? `Packaged ${packaged.postingM} m terrain (${packaged.name}) with a CSPICE Sun record.` : Math.abs(b.windows.lat[i]) < 84 ? 'No packaged terrain: 32 m elevation will be streamed from the public Terrain Tiles dataset (needs network; Sun from an analytic ephemeris).' : 'No packaged terrain, and streamed tiles do not cover this latitude.'}</p>
        <dl className="pl-facts"><Fact label="Location" value={`${b.windows.lat[i].toFixed(3)}°, ${b.windows.lon[i].toFixed(3)}° · ${b.windows.country[i] ?? 'no country'}`} /><Fact label="Fidelity (90 % interval)" value={`${agg.fidelity[i].toFixed(3)} (${agg.lo[i].toFixed(3)}–${agg.hi[i].toFixed(3)})`} evidence="derived" />
          <Fact label="Coverage of weighted dimensions" value={`${(agg.coverage[i] * 100).toFixed(0)} % · ${agg.category[i].replace('_', ' ')}`} evidence="derived" /><Fact label="Data level / quality" value={`${text(b, 'coverage_level', i) ?? '—'} · ${text(b, 'quality', i) ?? '—'}`} evidence="curated" />
          <Fact label="Slope p50 / p90 (100 m)" value={`${n(col(b, 'slope_f100_p50_deg', i))}° / ${n(col(b, 'slope_f100_p90_deg', i))}°`} evidence="derived" /><Fact label="Relief / ruggedness" value={`${n(col(b, 'relief_m', i), 0)} m / ${n(col(b, 'tri_f100_m', i), 2)} m`} evidence="derived" />
          <Fact label="Bare ground" value={col(b, 'bare_frac', i) === null ? 'no land-cover data' : `${(col(b, 'bare_frac', i)! * 100).toFixed(0)} %`} evidence={col(b, 'bare_frac', i) === null ? 'missing' : 'measured'} /><Fact label="Precipitation / mean T" value={`${n(col(b, 'precip_annual_mm', i), 0)} mm/yr / ${n(col(b, 't2m_mean_annual_c', i))} °C`} evidence="measured" />
          <Fact label="Lithology (map)" value={`${text(b, 'geo_lith_label', i) ?? 'no geological map data'}${text(b, 'geo_map_scale_label', i) ? ` · ${text(b, 'geo_map_scale_label', i)}-scale map` : ''}`} evidence={text(b, 'geo_lith_label', i) ? 'curated' : 'missing'} />
          <Fact label="Rarity (terrain / environment)" value={`${n(col(b, 'rarity_terrain_pct', i), 0)} / ${n(col(b, 'rarity_env_pct', i), 0)} percentile`} evidence="derived" /><Fact label="Nearest established analog" value={`${text(b, 'nearest_established', i) ?? '—'} · ${n(col(b, 'novelty_km', i), 0)} km (${text(b, 'novelty_class', i) ?? '—'})`} evidence="curated" />
          {spi >= 0 && sp && <Fact label="Candidate-space group" value={`${sp.labels[spi] + 1} of ${sp.k}${sp.outlier[spi] > sp.outlierThreshold ? ' · statistical outlier' : ''}`} evidence="model" />}</dl>
        <p className="pl-cap">Suitability dimensions (median, 90 % interval)</p>
        <table className="pl-table"><tbody>{shard.dims.map((d, k) => { const st = shard.status_codes[shard.status[k][i]], s50 = shard.s50[k][i]; return <tr key={d}><th>{b.dimensions.find(x => x.id === d)?.label ?? d}</th>{st === 'measured' && s50 !== null ? <><td>{s50.toFixed(2)}</td><td><Interval lo={shard.lo[k][i] ?? s50} mid={s50} hi={shard.hi[k][i] ?? s50} /></td></> : <td colSpan={2}><em className="pl-ev ev-missing">{st.replace('_', ' ')}</em></td>}</tr>; })}</tbody></table>
        {atlasCells.length > 0 ? <><p className="pl-cap">Task transferability (ATLAS-Π)</p><ul className="pl-chips">{atlasCells.map(c => <li key={c.task} className={`s-${c.status.toLowerCase()}`} title={c.reasons.join(', ')}>{s.atlas!.registry.tasks.tasks.find(t => t.id === c.task)?.name ?? c.task}: {STATUS_LABEL[c.status]}</li>)}</ul></>
          : <p className="pl-note">ATLAS-Π has no task-level transferability for this window ({s.atlas ? `it covers ${s.atlas.sites.length} catalogued sites` : 'bundle not packaged'}). Resemblance here is not a statement of functional suitability.</p>}
        {gaps.length > 0 && <><p className="pl-cap">Largest computed mismatches with {target.id}</p><ul className="pl-limits">{gaps.map(g => <li key={g.key}><b>{g.parameter}</b>: Earth {String(g.earth_value)} vs target {String(g.target_value)} {g.unit}{g.alternative ? ` — ${g.alternative}` : ''}</li>)}</ul></>}
        <p className="pl-cap">Data gaps and follow-up</p><ul className="pl-limits">{b.dimensions.filter(d => target.dimension_status[d.id] !== 'measured').map(d => <li key={d.id}><b>{d.label}</b>: {target.dimension_status[d.id].replace('_', ' ')}{d.integration_path ? ` — ${d.integration_path}` : ''}</li>)}<li>Field verification of slope and roughness at vehicle scale; in-situ soil bearing and shear tests.</li></ul>
      </div></details>}
    </div></PanelShell>
  </div>;
}
