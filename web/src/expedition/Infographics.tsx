// EGIZ · small, honest infographics for the expedition. Each one draws values read from the measured index (or a
// stated physical constant) and keeps the number next to the picture, so nothing is shown without its value.
import { t } from '../i18n';
import type { DiscoveryBundle, TargetEntry } from '../discover/types';
import { featureValue } from '../planet/journey/knowledge';

/** Fine-baseline slope keys of a body (the index uses 100 m on the Moon, 400 m on Mars). */
export const fineKey = (x: TargetEntry, q: 'p50' | 'p90') => `slope_${x.body === 'moon' ? 'f100' : 'f400'}_${q}_deg`;

/** Slope distribution as a ruler: typical (p50) and steep tail (p90) against the 15° rover planning limit. */
export function SlopeGauge({ x, max = 30 }: { x: TargetEntry; max?: number }) {
  const p50 = featureValue(x, fineKey(x, 'p50')), p90 = featureValue(x, fineKey(x, 'p90')); if (p50 === null || p90 === null) return null;
  const pos = (v: number) => `${Math.min(100, (v / max) * 100)}%`, over = p90 > 15;
  return <figure className="ig ig-slope" aria-label={`${t('Typical slope')} ${p50.toFixed(1)}°, ${t('steep tail')} ${p90.toFixed(1)}°, ${t('rover limit')} 15°`}>
    <figcaption><span>{t('Slope')}</span><b>{p50.toFixed(1)}°<em> / {p90.toFixed(1)}°</em></b></figcaption>
    <div className="ig-track">
      <i className="ig-ok" style={{ width: pos(15) }} /><i className={`ig-range ${over ? 'over' : ''}`} style={{ left: pos(p50), width: `calc(${pos(p90)} - ${pos(p50)})` }} />
      <b className="ig-p50" style={{ left: pos(p50) }} /><b className={`ig-p90 ${over ? 'over' : ''}`} style={{ left: pos(p90) }} />
      <s className="ig-limit" style={{ left: pos(15) }}><span>15°</span></s>
    </div>
    <p className="ig-legend"><span><i className="d-p50" />{t('typical')}</span><span><i className="d-p90" />{t('steepest 10 %')}</span><span><i className="d-lim" />{t('rover limit')}</span></p>
  </figure>;
}

/** Highest (and lowest) noon Sun as an arc over the horizon. */
export function SunArc({ x }: { x: TargetEntry }) {
  const hi = featureValue(x, 'noon_elevation_max_deg'), lo = featureValue(x, 'noon_elevation_min_deg'); if (hi === null) return null;
  const R = 34, cx = 40, cy = 40, pt = (deg: number) => { const a = (Math.min(90, Math.max(0, deg)) * Math.PI) / 180; return [cx - R * Math.cos(a), cy - R * Math.sin(a)]; }; // elevation measured from the left horizon
  const [hx, hy] = pt(hi), [lx, ly] = lo !== null ? pt(lo) : [0, 0];
  return <figure className="ig ig-sun" aria-label={`${t('Highest noon Sun')} ${hi.toFixed(1)}°`}>
    <svg viewBox="0 0 80 46" aria-hidden="true">
      <path d={`M${cx - R},${cy} A${R},${R} 0 0 1 ${cx + R},${cy}`} className="ig-sky" /><line x1="2" x2="78" y1={cy} y2={cy} className="ig-horizon" />
      <line x1={cx} y1={cy} x2={hx} y2={hy} className="ig-ray" />
      {lo !== null && <circle cx={lx} cy={ly} r="2.2" className="ig-sun-lo" />}<circle cx={hx} cy={hy} r="4" className="ig-sun-hi" />
    </svg>
    <figcaption><span>{t('Noon Sun')}</span><b>{hi.toFixed(1)}°{lo !== null && <em> / {lo.toFixed(1)}°</em>}</b></figcaption>
  </figure>;
}

/** Comparison dimensions as dots: filled = measured for this site. */
export function EvidenceDots({ b, x }: { b: DiscoveryBundle; x: TargetEntry }) {
  const dims = b.dimensions, n = dims.filter(d => x.dimension_status[d.id] === 'measured').length;
  return <figure className="ig ig-dots" aria-label={`${n} / ${dims.length} ${t('dimensions with evidence')}`}>
    <figcaption><span>{t('Evidence')}</span><b>{n}<em> / {dims.length}</em></b></figcaption>
    <div>{dims.map(d => <i key={d.id} className={`st-${x.dimension_status[d.id] ?? 'not_assessed'}`} title={`${d.label}: ${x.dimension_status[d.id]?.replace('_', ' ')}`} />)}</div>
  </figure>;
}

/** Relief on a log scale against the other sites of the same world. */
export function ReliefBar({ x, peers }: { x: TargetEntry; peers: TargetEntry[] }) {
  const v = featureValue(x, 'relief_m'); if (v === null) return null;
  const all = [x, ...peers].map(p => featureValue(p, 'relief_m')).filter((z): z is number => z !== null), hi = Math.log10(Math.max(...all, 10)), lo = Math.log10(Math.max(1, Math.min(...all)));
  const f = hi > lo ? (Math.log10(Math.max(1, v)) - lo) / (hi - lo) : 1;
  return <figure className="ig ig-relief" aria-label={`${t('Relief')} ${Math.round(v)} m`}>
    <figcaption><span>{t('Relief')}</span><b>{Math.round(v).toLocaleString('en')}<em> m</em></b></figcaption>
    <div className="ig-track"><i className="ig-fill" style={{ width: `${Math.max(4, f * 100)}%` }} /></div>
    <p className="ig-legend"><span>{t('vs other sites on this world (log scale)')}</span></p>
  </figure>;
}

/** Surface gravity against Earth's 9.81 m/s². */
export function GravityBar({ g }: { g: number }) {
  return <figure className="ig ig-gravity" aria-label={`${t('Gravity')} ${g} m/s²`}>
    <figcaption><span>{t('Gravity')}</span><b>{g.toFixed(2)}<em> m/s²</em></b></figcaption>
    <div className="ig-track"><i className="ig-fill" style={{ width: `${(g / 9.81) * 100}%` }} /><s className="ig-limit" style={{ left: '100%' }}><span>{t('Earth')}</span></s></div>
  </figure>;
}

/** Three tiny bars for a site list row: slope, relief, noon Sun — each scaled across the sites of the world. */
export function SiteSpark({ x, peers }: { x: TargetEntry; peers: TargetEntry[] }) {
  const all = [x, ...peers], val = (p: TargetEntry, k: (p: TargetEntry) => string) => featureValue(p, k(p));
  const rows: [string, (p: TargetEntry) => string, (v: number) => string][] = [['slope', p => fineKey(p, 'p50'), v => `${v.toFixed(1)}°`], ['relief', () => 'relief_m', v => `${Math.round(v)} m`], ['sun', () => 'noon_elevation_max_deg', v => `${v.toFixed(0)}°`]];
  return <span className="ig-spark" aria-hidden="true">{rows.map(([id, k, fmt]) => { const v = val(x, k); if (v === null) return null; const hi = Math.max(...all.map(p => val(p, k) ?? 0), 1e-6);
    return <span key={id} className={`sp-${id}`}><i style={{ width: `${Math.max(6, (v / hi) * 100)}%` }} /><em>{fmt(v)}</em></span>; })}</span>;
}
