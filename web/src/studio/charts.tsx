// Minimal SVG charts for telemetry and profiles (no chart library; axes labelled, values from data).
export interface Series { label: string; color: string; values: number[] }

export function LineChart({ x, series, height = 96, xLabel, yLabel, marker, yMin, yMax, band }: { x: number[]; series: Series[]; height?: number; xLabel: string; yLabel: string; marker?: number; yMin?: number; yMax?: number; band?: { from: number; to: number; label: string } }) {
  const W = 300, H = height, L = 34, R = 6, T = 8, B = 18;
  if (x.length < 2) return <div className="astral-chart-empty">No data</div>;
  const all = series.flatMap(s => s.values).filter(Number.isFinite);
  const lo = yMin ?? Math.min(...all), hi = yMax ?? Math.max(...all), span = hi - lo || 1;
  const x0 = x[0], x1 = x[x.length - 1], sx = (v: number) => L + (v - x0) / (x1 - x0 || 1) * (W - L - R), sy = (v: number) => T + (1 - (v - lo) / span) * (H - T - B);
  const fmt = (v: number) => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2);
  return <figure className="astral-chart">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${yLabel} against ${xLabel}: ${series.map(s => s.label).join(', ')}`}>
      {band && <rect x={L} y={sy(Math.min(hi, band.to))} width={W - L - R} height={Math.max(0, sy(Math.max(lo, band.from)) - sy(Math.min(hi, band.to)))} className="astral-chart-band"><title>{band.label}</title></rect>}
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} className="astral-axis" /><line x1={L} x2={L} y1={T} y2={H - B} className="astral-axis" />
      <text x={L - 4} y={T + 4} textAnchor="end" className="astral-tick">{fmt(hi)}</text>
      <text x={L - 4} y={H - B} textAnchor="end" className="astral-tick">{fmt(lo)}</text>
      <text x={L} y={H - 4} className="astral-tick">{fmt(x0)}</text>
      <text x={W - R} y={H - 4} textAnchor="end" className="astral-tick">{fmt(x1)} {xLabel}</text>
      {series.map(s => <polyline key={s.label} fill="none" stroke={s.color} strokeWidth={1.4} vectorEffect="non-scaling-stroke"
        points={s.values.map((v, i) => Number.isFinite(v) ? `${sx(x[i]).toFixed(1)},${sy(v).toFixed(1)}` : '').filter(Boolean).join(' ')} />)}
      {marker !== undefined && marker >= x0 && marker <= x1 && <line x1={sx(marker)} x2={sx(marker)} y1={T} y2={H - B} className="astral-marker" />}
    </svg>
    <figcaption>{yLabel}{series.length > 1 && <span className="astral-legend">{series.map(s => <span key={s.label}><i style={{ background: s.color }} />{s.label}</span>)}</span>}</figcaption>
  </figure>;
}

export function Spark({ values, marker, height = 26, color = 'var(--astral-accent)' }: { values: number[]; marker?: number; height?: number; color?: string }) {
  const W = 300, lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1) * W).toFixed(1)},${(height - 2 - (v - lo) / span * (height - 4)).toFixed(1)}`).join(' ');
  return <svg className="astral-spark" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" aria-hidden="true">
    {lo < 0 && hi > 0 && <line x1={0} x2={W} y1={height - 2 - (0 - lo) / span * (height - 4)} y2={height - 2 - (0 - lo) / span * (height - 4)} className="astral-zero" />}
    <polyline points={pts} fill="none" stroke={color} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
    {marker !== undefined && <line x1={marker * W} x2={marker * W} y1={0} y2={height} className="astral-marker" />}
  </svg>;
}

export function Bars({ rows, unit, better = 'lower' }: { rows: { label: string; value: number | null; note?: string }[]; unit: string; better?: 'lower' | 'higher' }) {
  const vals = rows.map(r => r.value).filter((v): v is number => v !== null && Number.isFinite(v));
  const max = Math.max(...vals, 1e-9), best = better === 'lower' ? Math.min(...vals) : Math.max(...vals);
  return <div className="astral-bars">{rows.map(r => <div key={r.label} className="astral-bar-row">
    <span>{r.label}</span>
    <span className="astral-bar-track"><i style={{ width: `${r.value === null ? 0 : Math.max(2, r.value / max * 100)}%` }} className={r.value === best ? 'best' : ''} /></span>
    <b>{r.value === null ? '—' : `${r.value >= 100 ? r.value.toFixed(0) : r.value.toFixed(r.value >= 10 ? 1 : 2)} ${unit}`}</b>
  </div>)}</div>;
}
