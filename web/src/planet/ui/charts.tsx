// EGIZ Planetary Studio · small SVG charts. Each one draws only values passed in; none carries decorative data.
import { cssGradient, type Colormap } from '../render/colormaps';

export interface ProfilePt { distance: number; elevation: number | null }
export function ProfileChart({ points, cursor, height = 120, label }: { points: ProfilePt[]; cursor?: number | null; height?: number; label?: string }) {
  const valid = points.filter(p => p.elevation !== null) as { distance: number; elevation: number }[];
  if (valid.length < 2) return <p className="pl-empty">No elevation along this line.</p>;
  const W = 640, H = height, pad = { l: 46, r: 8, t: 8, b: 20 }, len = points[points.length - 1].distance || 1, lo = Math.min(...valid.map(p => p.elevation)), hi = Math.max(...valid.map(p => p.elevation)), span = hi - lo || 1;
  const x = (d: number) => pad.l + (d / len) * (W - pad.l - pad.r), y = (e: number) => pad.t + (1 - (e - lo) / span) * (H - pad.t - pad.b);
  // Break the line wherever elevation is missing: gaps are shown as gaps.
  const segs: string[] = []; let cur = '';
  for (const p of points) { if (p.elevation === null) { if (cur) segs.push(cur); cur = ''; } else cur += `${cur ? 'L' : 'M'}${x(p.distance).toFixed(1)},${y(p.elevation).toFixed(1)}`; }
  if (cur) segs.push(cur);
  return <svg className="pl-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label ?? `Elevation profile, ${len.toFixed(0)} metres long, ${lo.toFixed(1)} to ${hi.toFixed(1)} metres`}>
    <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} className="pl-axis" /><line x1={pad.l} y1={pad.t} x2={pad.l} y2={H - pad.b} className="pl-axis" />
    {segs.map((d, i) => <path key={i} d={d} className="pl-line" />)}
    {cursor !== null && cursor !== undefined && <line x1={x(cursor)} x2={x(cursor)} y1={pad.t} y2={H - pad.b} className="pl-cursor" />}
    <text x={pad.l - 5} y={pad.t + 8} textAnchor="end">{hi.toFixed(1)}</text><text x={pad.l - 5} y={H - pad.b} textAnchor="end">{lo.toFixed(1)}</text>
    <text x={pad.l} y={H - 5}>0</text><text x={W - pad.r} y={H - 5} textAnchor="end">{len >= 2000 ? `${(len / 1000).toFixed(2)} km` : `${len.toFixed(0)} m`}</text>
    <text x={pad.l + 6} y={pad.t + 8} className="pl-unit">m elevation</text>
  </svg>;
}

export function Histogram({ a, b, lo, hi, unit, labels }: { a: number[]; b?: number[]; lo: number; hi: number; unit: string; labels?: [string, string] }) {
  const W = 300, H = 92, pad = { l: 4, r: 4, t: 6, b: 16 }, max = Math.max(1e-9, ...a, ...(b ?? [])), n = a.length, bw = (W - pad.l - pad.r) / n;
  const line = (h: number[]) => h.map((v, i) => `${i ? 'L' : 'M'}${(pad.l + (i + 0.5) * bw).toFixed(1)},${(H - pad.b - (v / max) * (H - pad.t - pad.b)).toFixed(1)}`).join('');
  return <svg className="pl-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Distribution from ${lo} to ${hi} ${unit}${labels ? `: ${labels.join(' and ')}` : ''}`}>
    {a.map((v, i) => <rect key={i} x={pad.l + i * bw + 0.5} width={Math.max(0.5, bw - 1)} y={H - pad.b - (v / max) * (H - pad.t - pad.b)} height={(v / max) * (H - pad.t - pad.b)} className="pl-bar" />)}
    {b && <path d={line(b)} className="pl-line pl-line-b" />}
    <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} className="pl-axis" />
    <text x={pad.l} y={H - 4}>{lo}{unit}</text><text x={W - pad.r} y={H - 4} textAnchor="end">{hi}{unit}</text>
  </svg>;
}

/** Median with a 90 % interval on a 0–max track. */
export function Interval({ lo, mid, hi, max = 1 }: { lo: number; mid: number; hi: number; max?: number }) {
  const p = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  return <span className="pl-interval" role="img" aria-label={`${mid.toFixed(3)}, 90 percent interval ${lo.toFixed(3)} to ${hi.toFixed(3)}`}><i style={{ left: p(lo), width: `calc(${p(hi)} - ${p(lo)})` }} /><b style={{ left: p(mid) }} /></span>;
}
/** Signed bar centred on zero (elasticities, deltas). */
export function SignedBar({ value, max }: { value: number; max: number }) {
  const w = Math.min(50, (Math.abs(value) / (max || 1)) * 50);
  return <span className="pl-signed" aria-hidden="true"><i className={value < 0 ? 'neg' : 'pos'} style={value < 0 ? { right: '50%', width: `${w}%` } : { left: '50%', width: `${w}%` }} /></span>;
}
export function Legend({ map, lo, hi, unit, classes }: { map: Colormap; lo: number; hi: number; unit: string; classes?: { label: string; css: string }[] }) {
  if (classes) return <ul className="pl-legend-classes">{classes.map(c => <li key={c.label}><i style={{ background: c.css }} />{c.label}</li>)}</ul>;
  const f = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toPrecision(2));
  return <div className="pl-legend"><span>{f(lo)}</span><i style={{ background: cssGradient(map) }} /><span>{f(hi)} {unit}</span></div>;
}
/** Sun position on a horizon dial: azimuth clockwise from north (up), elevation as distance from the rim. */
export function SunDial({ azimuthDeg, elevationDeg }: { azimuthDeg: number; elevationDeg: number }) {
  const r = 22 * (1 - Math.max(0, Math.min(90, elevationDeg)) / 90), a = (azimuthDeg * Math.PI) / 180, up = elevationDeg > 0;
  return <svg className="pl-dial" viewBox="-28 -28 56 56" role="img" aria-label={`Sun azimuth ${azimuthDeg.toFixed(0)} degrees, elevation ${elevationDeg.toFixed(1)} degrees`}>
    <circle r="22" className="pl-dial-rim" /><circle r="11" className="pl-dial-mid" /><line y1="-22" y2="-26" className="pl-dial-n" /><text y="-17" textAnchor="middle">N</text>
    <circle cx={Math.sin(a) * (up ? r : 22)} cy={-Math.cos(a) * (up ? r : 22)} r="3.2" className={up ? 'pl-dial-sun' : 'pl-dial-sun below'} />
  </svg>;
}
export function Fact({ label, value, evidence }: { label: string; value: string; evidence?: string }) {
  return <div className="pl-fact"><dt>{label}</dt><dd>{value}{evidence && <em className={`pl-ev ev-${evidence.replace(/[^a-z]/g, '')}`}>{evidence}</em>}</dd></div>;
}
