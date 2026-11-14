// Small SVG charts for the Discover workspace. Every mark is real bundle data.
// Colour roles: one sequential blue for magnitude, three validated categorical slots for
// comparison (dark-mode steps of the reference palette), text in ink tokens only.
import { useState } from 'react';
import { GRID } from './engine';

/** Short radar axis labels; the tables keep the full dimension names. */
export const SHORT: Record<string, string> = { terrain_fine: 'Slope distribution', terrain_roughness: 'Roughness', terrain_regional: 'Relief 2 km', surface_exposure: 'Exposure', geology: 'Lithology', aridity: 'Aridity', thermal: 'Thermal', illumination: 'Sun geometry' };
export const SERIES = ['#3987e5', '#d95926', '#199e70'] as const; // categorical slots 1-3 (dark), validated all-pairs
const SEQ = ['#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#b7d3f6', '#cde2fb'];

/** Sequential blue (dark -> light on the black surface): low values recede. */
export function seqColor(v: number, max = 1) {
  if (!Number.isFinite(v) || v <= 0) return '#26262b';
  const t = Math.max(0, Math.min(1, v / (max || 1)));
  return SEQ[Math.round(t * (SEQ.length - 1))];
}

export interface RadarSeries { label: string; values: (number | null)[] }

/** Radar of dimension similarities (0-1). Missing values are drawn as gaps, never as zero. */
export function Radar({ axes, series, size = 260 }: { axes: string[]; series: RadarSeries[]; size?: number }) {
  const [hover, setHover] = useState<{ s: number; a: number } | null>(null);
  const c = size / 2, R = c - 30, n = axes.length;
  const pt = (a: number, v: number) => [c + Math.sin(2 * Math.PI * a / n) * R * v, c - Math.cos(2 * Math.PI * a / n) * R * v];
  return <figure className="dc-radar">
    <svg viewBox={`-70 -6 ${size + 140} ${size + 12}`} role="img" aria-label={`Dimension profile: ${series.map(s => s.label).join(', ')}`}>
      {[0.25, 0.5, 0.75, 1].map(r => <polygon key={r} points={axes.map((_, a) => pt(a, r).join(',')).join(' ')} className="dc-grid" />)}
      {axes.map((ax, a) => { const [x, y] = pt(a, 1.13); return <g key={ax}><line x1={c} y1={c} x2={pt(a, 1)[0]} y2={pt(a, 1)[1]} className="dc-grid" />
        <text x={x} y={y} textAnchor={Math.abs(x - c) < 4 ? 'middle' : x > c ? 'start' : 'end'} dominantBaseline="middle" className="dc-axis-label">{ax}</text></g>; })}
      {series.map((s, si) => {
        const pts = s.values.map((v, a) => v == null ? null : pt(a, v));
        const closed = pts.every(p => p);
        return <g key={s.label}>
          {closed ? <polygon points={pts.map(p => p!.join(',')).join(' ')} fill={SERIES[si]} fillOpacity={0.12} stroke={SERIES[si]} strokeWidth={2} strokeLinejoin="round" />
            : pts.map((p, a) => { const q = pts[(a + 1) % n]; return p && q ? <line key={a} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke={SERIES[si]} strokeWidth={2} /> : null; })}
          {pts.map((p, a) => p && <circle key={a} cx={p[0]} cy={p[1]} r={hover?.s === si && hover.a === a ? 6 : 4} fill={SERIES[si]} stroke="#000" strokeWidth={2}
            onMouseEnter={() => setHover({ s: si, a })} onMouseLeave={() => setHover(null)} />)}
        </g>;
      })}
    </svg>
    {hover && <div className="dc-tip" role="status">{series[hover.s].label} · {axes[hover.a]}: <b>{series[hover.s].values[hover.a]?.toFixed(2)}</b></div>}
    {series.length > 1 && <figcaption className="dc-legend">{series.map((s, i) => <span key={s.label}><i style={{ background: SERIES[i] }} />{s.label}</span>)}</figcaption>}
  </figure>;
}

/** Median dot with 90 % interval on a 0-1 track; optional Earth-wide percentile tick. */
export function IntervalBar({ s50, lo, hi, label }: { s50: number | null; lo: number | null; hi: number | null; label: string }) {
  if (s50 == null) return <div className="dc-ibar dc-ibar-empty" aria-label={`${label}: no value`} />;
  return <div className="dc-ibar" role="img" aria-label={`${label}: ${s50.toFixed(2)}, 90% interval ${lo?.toFixed(2)} to ${hi?.toFixed(2)}`}>
    <span className="dc-ibar-ci" style={{ left: `${(lo ?? s50) * 100}%`, width: `${Math.max(0.5, ((hi ?? s50) - (lo ?? s50)) * 100)}%` }} />
    <span className="dc-ibar-dot" style={{ left: `${s50 * 100}%` }} />
  </div>;
}

/** Slope CDFs on a shared axis (degrees). */
export function CdfChart({ series, height = 150 }: { series: { label: string; cdf: number[] | null; dashed?: boolean }[]; height?: number }) {
  const [hx, setHx] = useState<number | null>(null);
  const W = 320, H = height, L = 34, B = 22, maxX = 40;
  const x = (deg: number) => L + (deg / maxX) * (W - L - 8), y = (p: number) => 6 + (1 - p) * (H - B - 6);
  const shown = series.filter(s => s.cdf);
  return <figure className="dc-cdf">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Slope cumulative distributions"
      onMouseMove={e => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const deg = Math.round(((e.clientX - r.left) / r.width * W - L) / (W - L - 8) * maxX); setHx(deg >= 0 && deg <= maxX ? deg : null); }}
      onMouseLeave={() => setHx(null)}>
      {[0, 0.5, 1].map(p => <g key={p}><line x1={L} x2={W - 8} y1={y(p)} y2={y(p)} className="dc-grid" /><text x={L - 5} y={y(p)} textAnchor="end" dominantBaseline="middle" className="dc-tick">{p}</text></g>)}
      {[0, 10, 20, 30, 40].map(d => <text key={d} x={x(d)} y={H - 6} textAnchor="middle" className="dc-tick">{d}°</text>)}
      {shown.map((s, i) => <polyline key={s.label} fill="none" stroke={SERIES[i]} strokeWidth={2} strokeDasharray={s.dashed ? '5 4' : undefined}
        points={GRID.filter(g => g <= maxX).map(g => `${x(g)},${y(s.cdf![g])}`).join(' ')} />)}
      {hx != null && <line x1={x(hx)} x2={x(hx)} y1={6} y2={H - B} className="dc-cross" />}
    </svg>
    {hx != null && <div className="dc-tip" role="status">slope ≤ {hx}°: {shown.map((s, i) => <span key={s.label} style={{ marginRight: 8 }}><i className="dc-swatch" style={{ background: SERIES[i] }} />{s.label} {(s.cdf![hx] * 100).toFixed(0)}%</span>)}</div>}
    <figcaption className="dc-legend">{shown.map((s, i) => <span key={s.label}><i style={{ background: SERIES[i] }} />{s.label}</span>)}</figcaption>
  </figure>;
}
