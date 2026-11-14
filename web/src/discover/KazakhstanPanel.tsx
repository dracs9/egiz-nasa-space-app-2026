// Kazakhstan chapter: coarse-to-fine refinement around Kazakhstan windows that rank in the Earth-wide
// top 100 of a Mars target (pipeline/discovery/refine.py -> data/discovery/regions/kz.json).
// Every number shown here is read from that file; nothing is computed or filled in the browser.
import { useEffect, useState } from 'react';
import { MapPin, TriangleAlert } from 'lucide-react';
import { t } from '../i18n';
import { isWeakMatch } from './engine';
import type { GapRow, RoverExperiment, TargetEntry } from './types';

interface RegionDim { s50: number | null; lo: number | null; hi: number | null; status: string; percentile: number | null; label: string }
interface RegionEntry {
  window: string; lon: number; lat: number; score: number; fidelity: number; lo: number; hi: number; coverage: number;
  category: string; score_percentile: number; rank_among_earth_windows: number; dims: Record<string, RegionDim>;
  pool?: string; parent?: string | null; gaps?: GapRow[]; rover?: RoverExperiment | null;
  context?: Record<string, string | number | null>; features?: Record<string, number | null>; text?: Record<string, string>;
}
interface RegionTarget { target: string; name: string; n_better_than_parent: number; seeds: { seed: RegionEntry; n_refined: number; refined: RegionEntry[]; best_refined_beats_seed: boolean }[]; top: RegionEntry[] }
export interface RegionDoc { schema: 'egiz.discovery_region'; version: string; step_km: number; n_refinement_windows: number; population: string; notes: string[]; targets: RegionTarget[]; generated_at: string }

/** Display thresholds for the card (not used in any score). */
const MATCH = 0.6, MISMATCH = 0.4;
/** What a field team would measure to confirm or reject each dimension. */
const FIELD_CHECK: Record<string, string> = {
  terrain_fine: 'RTK-GNSS or drone photogrammetry slope survey at rover scale (< 10 m)',
  terrain_roughness: 'rock-abundance and roughness transects (clasts > 0.3 m per 100 m²)',
  terrain_regional: 'traverse of the 2 km relief: elevation range along the planned route',
  surface_exposure: 'ground photos of vegetation and crust cover at random plots',
  geology: 'field lithology mapping and hand samples (map unit vs. outcrop)',
  aridity: 'soil moisture probe and season of standing water',
  thermal: 'surface and air temperature loggers through a full season',
  illumination: 'sun-angle log and shadow mapping on the planned test dates',
  mineralogy: 'portable XRF / VNIR spectra of outcrops (sulfates, clays, carbonates)',
  aeolian_dust: 'anemometer and dust sampler during the test window',
  ice_permafrost: 'ground-penetrating radar or shallow coring for ground ice',
  subsurface_voids: 'speleological survey of caves or pits, if any are reported',
};

const f2 = (v: number | null | undefined, d = 2) => v == null || !Number.isFinite(v) ? '—' : v.toFixed(d);

export function KazakhstanPanel({ target, onSelect }: { target: TargetEntry; onSelect(id: string): void }) {
  const [doc, setDoc] = useState<RegionDoc | null | 'missing'>(null);
  useEffect(() => {
    let alive = true;
    fetch(`${import.meta.env.BASE_URL}discovery/regions/kz.json`, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null)
      .then(d => { if (alive) setDoc(d && d.schema === 'egiz.discovery_region' ? d : 'missing'); }).catch(() => { if (alive) setDoc('missing'); });
    return () => { alive = false; };
  }, []);
  if (doc === null) return null;
  if (doc === 'missing') return <section className="dc-kz"><h2><MapPin size={15} /> {t('Kazakhstan')}</h2><p className="dc-note">{t('The Kazakhstan refinement has not been built: python -m pipeline.discovery refine-plan / refine-acquire / refine-index / refine-build.')}</p></section>;
  const rt = doc.targets.find(x => x.target === target.id);
  return <section className="dc-kz" aria-labelledby="dc-kz-title">
    <h2 id="dc-kz-title"><MapPin size={15} /> {t('Kazakhstan: zooming in')}</h2>
    <p className="dc-note">{t('Around every Kazakhstan window in the Earth-wide top 100 of a Mars target, a lattice of neighbouring windows was acquired and scored with the same code. A smaller area can match better than the cell that found it.')} {doc.n_refinement_windows} {t('refinement windows')}, {doc.step_km} km {t('step')}.</p>
    {!rt ? <p className="dc-note">{t('The refinement was run for Mars targets only. Choose a Mars target to see it.')}</p> : <>
      <p className="dc-note">{rt.seeds.length} {t('Kazakhstan seed windows for this target')}; {t('a refined neighbour scores higher than its seed for')} {rt.n_better_than_parent}.</p>
      <RegionMap entries={rt.top} seeds={rt.seeds.map(s => s.seed)} />
      <div className="dc-kz-cards">{rt.top.slice(0, 6).map((e, n) => <RegionCard key={e.window} e={e} n={n} onSelect={onSelect} />)}</div>
    </>}
    {doc.notes.map((x, k) => <p key={k} className="dc-note">{t(x)}</p>)}
  </section>;
}

function RegionMap({ entries, seeds }: { entries: RegionEntry[]; seeds: RegionEntry[] }) {
  const pts = [...entries, ...seeds];
  const x0 = Math.min(...pts.map(p => p.lon)) - .3, x1 = Math.max(...pts.map(p => p.lon)) + .3;
  const y0 = Math.min(...pts.map(p => p.lat)) - .3, y1 = Math.max(...pts.map(p => p.lat)) + .3;
  const X = (lon: number) => ((lon - x0) / (x1 - x0)) * 600, Y = (lat: number) => ((y1 - lat) / (y1 - y0)) * 260;
  return <svg className="dc-kz-map" viewBox="0 0 600 260" role="img" aria-label={t('Kazakhstan seed windows and best refined windows (longitude/latitude)')}>
    {seeds.map(s => <circle key={s.window} cx={X(s.lon)} cy={Y(s.lat)} r={5} className="seed"><title>{s.window} · {t('seed')} · {f2(s.score, 3)}</title></circle>)}
    {entries.map((e, n) => <g key={e.window}><circle cx={X(e.lon)} cy={Y(e.lat)} r={4} className={e.pool === 'kz_refine' ? 'refined' : 'seed-top'} /><text x={X(e.lon) + 6} y={Y(e.lat) - 6}>{n + 1}</text></g>)}
  </svg>;
}

function RegionCard({ e, n, onSelect }: { e: RegionEntry; n: number; onSelect(id: string): void }) {
  const dims = Object.entries(e.dims);
  const matched = dims.filter(([, d]) => d.status === 'measured' && d.s50 != null && d.s50 >= MATCH);
  const mismatched = dims.filter(([, d]) => d.status === 'measured' && d.s50 != null && d.s50 < MISMATCH);
  const unassessed = dims.filter(([, d]) => d.status !== 'measured' && d.status !== 'not_applicable');
  const weak = isWeakMatch(e.fidelity, e.lo);
  const checks = [...mismatched, ...unassessed].map(([id]) => FIELD_CHECK[id]).filter(Boolean).slice(0, 4);
  return <article className="dc-kz-card">
    <header>
      <span className="dc-rank">{n + 1}</span>
      <div><b>{e.window}</b><small>{e.lat.toFixed(3)}°, {e.lon.toFixed(3)}° · {e.pool === 'kz_refine' ? `${t('refined near')} ${e.parent}` : t('Earth-wide index window')}</small></div>
    </header>
    <p className="dc-mono">{t('score')} {f2(e.score, 3)} · {t('fidelity')} {f2(e.fidelity)} [90 % {f2(e.lo)}–{f2(e.hi)}] · {t('coverage')} {f2(e.coverage)} · {t('Earth pct')} {f2(e.score_percentile, 1)} · {t('would rank')} #{e.rank_among_earth_windows}</p>
    {weak && <p className="dc-weak-note"><TriangleAlert size={13} /> {t('weak match')}: {t('this is the nearest Earth window found, not a demonstrated analog.')}</p>}
    <dl className="dc-dl">
      <dt>{t('Matches')} (≥ {MATCH})</dt><dd>{matched.length ? matched.map(([, d]) => `${t(d.label)} ${f2(d.s50)}`).join('; ') : '—'}</dd>
      <dt>{t('Mismatches')} (&lt; {MISMATCH})</dt><dd>{mismatched.length ? mismatched.map(([, d]) => `${t(d.label)} ${f2(d.s50)}`).join('; ') : '—'}</dd>
      <dt>{t('Not assessed')}</dt><dd>{unassessed.map(([, d]) => t(d.label)).join('; ') || '—'}</dd>
      <dt>{t('Map lithology')}</dt><dd>{e.text?.geo_lith_label ?? '—'}</dd>
      <dt>{t('Nearest town')}</dt><dd className="dc-muted">{t('to be confirmed')}</dd>
      <dt>{t('Season')}</dt><dd className="dc-muted">{t('to be confirmed')}</dd>
      <dt>{t('Field checks that would confirm or reject the analogy')}</dt><dd>{checks.length ? checks.map(c => t(c)).join('; ') : '—'}</dd>
    </dl>
    {e.pool !== 'kz_refine' && <button className="dc-link" onClick={() => onSelect(e.window)}>{t('Open full dossier')}</button>}
  </article>;
}
