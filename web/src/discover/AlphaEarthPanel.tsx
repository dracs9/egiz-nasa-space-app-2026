// AlphaEarth Foundations on the Earth side: year-to-year stability and unsupervised zoning of one
// Earth window, served live by the local point API (pipeline.discovery.alphaearth via Earth Engine).
// Written with AI assistance (Claude); human scientific review pending.
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import type { Map as GLMap } from 'maplibre-gl';
import { Layers, LoaderCircle, Satellite, TriangleAlert } from 'lucide-react';
import { loadMapLibrary } from '../lib/maplibre';
import { t } from '../i18n';

interface Stability { status: string; pairs: { from: number; to: number; cosine: number | null }[]; min_year_to_year: number | null; first_to_last: number | null; reading: string; method: string }
interface Zones { status: string; k: number; year: number; tiles: string; bounds: [number, number, number, number]; zones: { zone: number; color: string; fraction: number }[]; method: string; citation: string }

async function getJson<T>(path: string): Promise<T> {
  let r: Response;
  try { r = await fetch(path); } catch { throw new Error('Point API unreachable. Start it with: make discover-serve'); }
  const data = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${r.status}`);
  return data as T;
}

const verdict = (c: number | null) => c == null ? '—' : c >= 0.98 ? t('stable') : c >= 0.9 ? t('minor / seasonal change') : t('marked change');

export function AlphaEarthPanel({ lon, lat, name }: { lon: number; lat: number; name: string }) {
  const [stab, setStab] = useState<Stability | null>(null);
  const [zones, setZones] = useState<Zones | null>(null);
  const [busy, setBusy] = useState<'stab' | 'zones' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [k, setK] = useState(6);
  useEffect(() => { setStab(null); setZones(null); setError(null); }, [lon, lat]);
  const q = `lon=${lon.toFixed(4)}&lat=${lat.toFixed(4)}`;
  const run = async (what: 'stab' | 'zones') => {
    setBusy(what); setError(null);
    try {
      if (what === 'stab') setStab(await getJson<Stability>(`/api/point/alphaearth/stability?${q}`));
      else setZones(await getJson<Zones>(`/api/point/alphaearth/zones?${q}&k=${k}`));
    } catch (e) { setError(String((e as Error).message ?? e)); } finally { setBusy(null); }
  };
  return <section className="dc-ae" aria-labelledby="dc-ae-title">
    <header>
      <h2 id="dc-ae-title"><Satellite size={15} /> AlphaEarth · {name}</h2>
      <p className="dc-note">{t('Google DeepMind AlphaEarth embeddings (Earth only, 10 m, yearly since 2017). Used here to check the Earth candidate, never to compare with the planet directly.')}</p>
    </header>
    <div className="dc-ae-actions">
      <button type="button" className="dc-run" disabled={busy !== null} onClick={() => void run('stab')}>{busy === 'stab' ? <LoaderCircle size={14} className="dc-spin" /> : null} {t('Stability 2017–2024')}</button>
      <label className="dc-field dc-ae-k"><span>{t('zones')}</span><select value={k} onChange={e => setK(Number(e.target.value))}>{[3, 4, 5, 6, 8, 10].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      <button type="button" className="dc-run" disabled={busy !== null} onClick={() => void run('zones')}>{busy === 'zones' ? <LoaderCircle size={14} className="dc-spin" /> : <Layers size={14} />} {t('Zone the window (k-means)')}</button>
    </div>
    {error && <div className="dc-notice" role="alert"><TriangleAlert size={16} /><p>{t(error)}</p></div>}
    {stab && <div className="dc-ae-stab">
      {stab.status !== 'ok' ? <p className="dc-note">{t('No AlphaEarth coverage for this window.')}</p> : <>
        <p><b>{t('Lowest year-to-year similarity')}:</b> <span className="dc-mono">{stab.min_year_to_year?.toFixed(3) ?? '—'}</span> ({verdict(stab.min_year_to_year)}) · <b>2017→2024:</b> <span className="dc-mono">{stab.first_to_last?.toFixed(3) ?? '—'}</span></p>
        <div className="dc-ae-bars" role="img" aria-label={t('Year-to-year cosine similarity')}>
          {stab.pairs.map(p => <span key={p.from} title={`${p.from}→${p.to}: ${p.cosine ?? '—'}`}>
            <i style={{ height: `${p.cosine == null ? 0 : Math.max(4, (p.cosine - 0.8) / 0.2 * 100)}%` }} className={p.cosine != null && p.cosine < 0.9 ? 'bad' : p.cosine != null && p.cosine < 0.98 ? 'mid' : ''} />
            <small>{String(p.to).slice(2)}</small></span>)}
        </div>
        <p className="dc-note">{t(stab.reading)}</p>
      </>}
    </div>}
    {zones && <ZoneMap z={zones} />}
  </section>;
}

function ZoneMap({ z }: { z: Zones }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    let gl: GLMap | null = null, disposed = false;
    const [w, s, e, n] = z.bounds;
    loadMapLibrary().then(lib => {
      if (disposed || !el.current) return;
      gl = new lib.Map({ container: el.current, bounds: [[w, s], [e, n]], fitBoundsOptions: { padding: 8 }, attributionControl: { compact: true },
        style: { version: 8, sources: {
          img: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: 'Esri World Imagery' },
          zones: { type: 'raster', tiles: [z.tiles], tileSize: 256, attribution: 'AlphaEarth / Google Earth Engine' } },
          layers: [{ id: 'img', type: 'raster', source: 'img' }, { id: 'zones', type: 'raster', source: 'zones', paint: { 'raster-opacity': 0.6 } }] } });
    }).catch(() => undefined);
    return () => { disposed = true; gl?.remove(); };
  }, [z]);
  return <div className="dc-ae-zones">
    <div ref={el} className="dc-ae-map" aria-label={t('Zone map')} />
    <ul className="dc-ae-legend">{z.zones.map(c => <li key={c.zone}><i style={{ background: c.color }} />{t('zone')} {c.zone + 1}<span className="dc-mono">{(c.fraction * 100).toFixed(0)} %</span></li>)}</ul>
    <p className="dc-note">{t(z.method)}</p>
  </div>;
}
