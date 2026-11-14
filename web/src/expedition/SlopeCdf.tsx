// Cumulative slope distribution of measured target fingerprints: the share of ground gentler than each slope.
// Values are the bundle's `target_slope_cdf` (1° grid, 0–60°) — read, never resampled into something new.
import type { TargetEntry } from '../discover/types';

export function SlopeCdf({ focus, peers = [], maxDeg, limitDeg = 15, height = 132 }: { focus: TargetEntry; peers?: TargetEntry[]; maxDeg?: number; limitDeg?: number; height?: number }) {
  const all = [focus, ...peers], top = maxDeg ?? Math.min(60, Math.max(12, ...all.map(t => { const i = t.target_slope_cdf.findIndex(v => v >= 0.995); return i < 0 ? 60 : i + 3; })));
  const W = 360, H = height, pad = { l: 34, r: 10, t: 10, b: 22 }, x = (d: number) => pad.l + (d / top) * (W - pad.l - pad.r), y = (v: number) => pad.t + (1 - v) * (H - pad.t - pad.b);
  const path = (t: TargetEntry) => t.target_slope_cdf.slice(0, top + 1).map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const atLimit = focus.target_slope_cdf[Math.min(60, Math.round(limitDeg))] ?? null;
  return <figure className="xp-cdf">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Share of ground gentler than a given slope for ${focus.name}${atLimit !== null ? `: ${Math.round(atLimit * 100)} percent is below ${limitDeg} degrees` : ''}`}>
      {[0, 0.5, 1].map(v => <g key={v}><line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="xp-grid" /><text x={pad.l - 5} y={y(v) + 3} textAnchor="end">{v * 100}%</text></g>)}
      <line x1={x(limitDeg)} x2={x(limitDeg)} y1={pad.t} y2={H - pad.b} className="xp-limit" /><text x={x(limitDeg) + 4} y={pad.t + 9} className="xp-limit-t">{limitDeg}° plan limit</text>
      {peers.map(p => <path key={p.id} d={path(p)} className="xp-peer"><title>{p.name}</title></path>)}
      <path d={path(focus)} className="xp-focus" />
      <text x={pad.l} y={H - 6}>0°</text><text x={W - pad.r} y={H - 6} textAnchor="end">{top}° slope</text>
    </svg>
    <figcaption>{atLimit !== null && <><b>{Math.round(atLimit * 100)} %</b> of the measured ground is gentler than {limitDeg}° ({focus.fine_baseline_m} m baseline). </>}{peers.length > 0 && <span className="pl-dim">Grey: the other measured sites on this world.</span>}</figcaption>
  </figure>;
}
