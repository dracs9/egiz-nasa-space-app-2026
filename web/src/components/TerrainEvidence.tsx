import { t as localizeText, useLanguage } from '../i18n';
import { useEffect, useState } from 'react';
import { useAppStore } from '../state/store';
import { dataModeInfo } from '../data/modes';
import { validateTerrainEvidence, type TerrainEntry, type TerrainEvidence as Evidence, type TerrainGrid } from '../data/terrainEvidence';
import { decimal, safeUrl } from '../lib/format';
import './ResearchTools.css';

function Surface({ entry, grid, label }: { entry: TerrainEntry; grid: TerrainGrid; label: string }) {
  useLanguage();
  const s = grid.surface, values = s.elevation_m.filter((n): n is number => n !== null);
  const lo = Math.min(...values), hi = Math.max(...values);
  return <div className="terrain-patch"><span className="eyebrow">{localizeText(label)}</span><svg viewBox={`0 0 ${s.side} ${s.side}`} role="img" aria-label={localizeText(`${label}: measured 20 kilometre elevation surface, north up. Colors scaled to each window.`)} shapeRendering="crispEdges"><rect width={s.side} height={s.side} fill="#202833" />{localizeText(s.elevation_m.map((v, i) => v === null ? null : <rect key={i} x={i % s.side} y={Math.floor(i / s.side)} width="1" height="1" fill={`hsl(${entry.body === 'earth' ? 174 : 35} ${entry.body === 'earth' ? 25 : 17}% ${20 + 57 * (v - lo) / (hi - lo || 1)}%)`} />))}</svg><small>{localizeText("20 × 20 km · north ↑")}<br />{localizeText(s.cell_m)}{localizeText(" m display cells")}<br />{localizeText(decimal(grid.core20_valid_fraction * 100, 1))}{localizeText("% valid core")}</small></div>;
}
function Profile({ a, b }: { a: TerrainGrid; b: TerrainGrid }) {
  useLanguage();
  const profiles = [a.profile, b.profile].map(p => {
    const known = p.elevation_m.filter((v): v is number => v !== null);
    const mean = known.length ? known.reduce((sum, v) => sum + v, 0) / known.length : 0;
    return { x: p.distance_m, y: p.elevation_m.map(v => v === null ? null : v - mean) };
  });
  const max = Math.max(1, ...profiles.flatMap(p => p.y.filter((v): v is number => v !== null).map(Math.abs)));
  const path = (p: typeof profiles[number]) => { let open = false; return p.y.map((v, i) => { if (v === null) { open = false; return ''; } const command = open ? 'L' : 'M'; open = true; return `${command}${40 + p.x[i] / 10000 * 410},${88 - v / max * 64}`; }).join(' '); };
  return <div className="terrain-profile"><span className="eyebrow">{localizeText("WEST → EAST · 10 KM CENTRAL TRANSECT")}</span><div className="terrain-legend"><span><i style={{ background: '#e6bb7a' }} />{localizeText("Planetary target")}</span><span><i style={{ background: '#7cdbcf' }} />{localizeText("Earth window")}</span></div><svg viewBox="0 0 470 190" role="img" aria-label={localizeText(`Terrain profiles centered on their own mean elevation, shared vertical scale plus or minus ${Math.ceil(max)} metres, 10 kilometre horizontal extent.`)}><line x1="40" y1="88" x2="450" y2="88" stroke="#344252" strokeDasharray="3 4" /><text x="2" y="25">+{localizeText(Math.ceil(max))}{localizeText(" m")}</text><text x="8" y="91">{localizeText("0 m")}</text><text x="2" y="155">−{localizeText(Math.ceil(max))}{localizeText(" m")}</text>{localizeText(profiles.map((p, i) => <path key={i} d={path(p)} stroke={i ? '#7cdbcf' : '#e6bb7a'} strokeWidth="2" fill="none" />))}<text x="40" y="180">{localizeText("0 km")}</text><text x="230" y="180">{localizeText("5 km")}</text><text x="417" y="180">{localizeText("10 km")}</text></svg><p className="small-copy muted">{localizeText("Each profile is centered on its own mean elevation. Both use the same axes; vertical and horizontal display scales differ. Gaps retain missing samples. A single transect does not establish whole-window similarity.")}</p></div>;
}
export function TerrainEvidence({ siteId, targetId }: { siteId: string; targetId: string }) {
  useLanguage();
  const { data, dataMode } = useAppStore();
  const [state, setState] = useState<{ data?: Evidence; error?: string }>({});
  const [attempt, setAttempt] = useState(0);
  const selectedTarget = data!.targets.targets.find(t => t.id === targetId);
  const baseline = selectedTarget?.fine_baseline_m;
  useEffect(() => {
    if (!selectedTarget || data!.results.synthetic) return;
    const controller = new AbortController(); let active = true; setState({});
    fetch(`${import.meta.env.BASE_URL}${dataModeInfo[dataMode].path}/terrain_evidence.json`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Measured terrain evidence is unavailable for this dataset.');
      return validateTerrainEvidence(await response.json(), data!.results);
    }).then(evidence => { if (active) setState({ data: evidence }); }).catch(error => { if (active) setState({ error: error instanceof Error ? error.message : 'Terrain evidence could not load.' }); });
    return () => { active = false; controller.abort(); };
  }, [data, dataMode, attempt, selectedTarget]);
  if (!selectedTarget || data!.results.synthetic) return null;
  const earth = state.data?.entries.find(e => e.id === siteId), target = state.data?.entries.find(e => e.id === targetId);
  const a = target?.grids[String(baseline)], b = earth?.grids[String(baseline)];
  return <section className="drawer-section terrain-evidence" aria-labelledby="terrain-evidence-title"><h3 id="terrain-evidence-title">{localizeText("Measured terrain, side by side")}</h3><p className="small-copy muted">{localizeText("Precomputed from source DEMs at the same ")}{localizeText(baseline)}{localizeText(" m slope baseline. Elevation colors scale separately within each window.")}</p>{localizeText(state.error ? <div className="terrain-status"><p role="status">{localizeText(state.error)}</p><button className="outline-button" onClick={() => setAttempt(n => n + 1)}>{localizeText("Retry terrain evidence")}</button></div> : !state.data ? <p className="terrain-status" role="status">{localizeText("Loading measured terrain…")}</p> : !earth || !target || !a || !b ? <p className="terrain-status">{localizeText("No matched terrain products for this pair.")}</p> : <><div className="terrain-pair"><Surface entry={target} grid={a} label={localizeText(target.body.toUpperCase())} /><Surface entry={earth} grid={b} label={localizeText("EARTH")} /></div><Profile a={a} b={b} /><details><summary>{localizeText("Slope distribution & source fingerprints")}</summary><p>{localizeText("Earth products derived using Copernicus WorldDEM-30. © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.")}</p><table className="preference-table"><thead><tr><th>{localizeText("SLOPE")}</th><th>{localizeText("TARGET")}</th><th>{localizeText("EARTH")}</th></tr></thead><tbody>{localizeText(a.slope_histogram.counts.map((count, i) => <tr key={i}><th>{localizeText(a.slope_histogram.edges_deg[i])}–{localizeText(a.slope_histogram.edges_deg[i + 1])}°</th><td>{localizeText(a.slope_histogram.valid_count ? decimal(count / a.slope_histogram.valid_count * 100, 1) + '%' : '—')}</td><td>{localizeText(b.slope_histogram.valid_count ? decimal(b.slope_histogram.counts[i] / b.slope_histogram.valid_count * 100, 1) + '%' : '—')}</td></tr>))}</tbody></table><p>{localizeText("Missing slope samples: target ")}{localizeText(a.slope_histogram.missing_count)}{localizeText("; Earth ")}{localizeText(b.slope_histogram.missing_count)}{localizeText(". Percentages use valid samples only.")}</p>{localizeText([target, earth].map(entry => <div key={entry.id}><strong>{localizeText(entry.id)}</strong><p>{localizeText(safeUrl(entry.source.url) ? <a href={safeUrl(entry.source.url)} target="_blank" rel="noreferrer">{localizeText("Source DEM")}</a> : entry.source.url)}</p><p>{localizeText("SHA-256: ")}<code>{entry.source.sha256}</code><br />{localizeText("Native CRS: ")}{localizeText(entry.source.native_crs)}</p></div>))}</details></>)}</section>;
}
