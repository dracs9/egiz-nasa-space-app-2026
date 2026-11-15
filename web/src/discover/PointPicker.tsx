// Pick any point on the Moon or Mars; the local point API (pipeline.discovery.serve) measures it from
// a global DEM and scores it against every Earth window. The result is shaped like a bundle target
// plus its score shard, so the whole Discover workspace (map, ranking, detail, compare) works on it.
// Written with AI assistance (Claude); human scientific review pending.
import { useRef, useState } from 'react';
import { Crosshair, LoaderCircle, TriangleAlert } from 'lucide-react';
import { t } from '../i18n';
import type { Body, Dimension, ScoreShard, TargetEntry } from './types';

export interface PointResult {
  schema: 'egiz.point_analysis'; version: string; synthetic: false;
  point: { id: string; body: Body; lon: number; lat: number; window_km: number; fine_baseline_m: number; dem: string; dem_url: string };
  terrain: Record<string, number | null>; verdict: string | null;
  target: TargetEntry; shard: ScoreShard; window_ids: string[];
  not_assessed_note: string; timing_s: Record<string, number>;
  alphaearth?: AlphaEarthExpansion | null;
  properties?: { values: Record<string, { value: number; median: number; std: number; n_pixels: number; unit: string; label: string; source: string; url: string }>; gaps: { key: string; label: string; reason: string }[] };
  geology_inferred?: { classes: string[]; rules: string[] };
  extra_dimensions?: Dimension[];
  bridge?: { status: string; note?: string; domain?: string; mahalanobis_d2?: number; training_d2_p99?: number; warning?: string | null;
    cv?: { cv_cosine_mean: number; baseline_cosine_mean: number; skill: number };
    top?: { window: string; cosine: number; name: string; physical_rank: number; physical_score: number }[] };
}
export interface AlphaEarthExpansion {
  status: 'ok' | 'not_built' | 'index_stale' | 'no_seed_embedding'; note?: string; year?: number; method?: string; citation?: string;
  seeds?: { window: string; weight: number }[];
  top?: { window: string; cosine: number; name: string; lon: number; lat: number; physical_rank: number; physical_score: number }[];
}

/** Reorder a point shard onto the bundle's window order (ids are the join key; missing windows stay null). */
export function alignShard(shard: ScoreShard, from: string[], to: string[]): ScoreShard {
  if (from.length === to.length && from.every((id, i) => id === to[i])) return shard;
  const pos = new Map(from.map((id, i) => [id, i]));
  const idx = to.map(id => pos.get(id) ?? -1);
  const pick = <T,>(row: T[], fill: T) => idx.map(i => i < 0 ? fill : row[i]);
  const missing = shard.status_codes.indexOf('missing');
  return { ...shard, s50: shard.s50.map(r => pick(r, null)), lo: shard.lo.map(r => pick(r, null)), hi: shard.hi.map(r => pick(r, null)),
    status: shard.status.map(r => pick(r, missing)), w1_deg: pick(shard.w1_deg, null) };
}

export async function fetchPoint(body: Body, lon: number, lat: number, signal?: AbortSignal): Promise<PointResult> {
  const q = new URLSearchParams({ body, lon: lon.toFixed(3), lat: lat.toFixed(3) });
  let r: Response;
  try { r = await fetch(`/api/point?${q}`, { signal }); }
  catch (e) { if ((e as Error).name === 'AbortError') throw e; throw new Error('Point API unreachable. Start it with: make discover-serve'); }
  const text = await r.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error(r.ok ? 'Point API returned invalid JSON.' : 'Point API unreachable. Start it with: make discover-serve'); }
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `Point API error ${r.status}`);
  const p = data as PointResult;
  if (p.schema !== 'egiz.point_analysis' || p.synthetic !== false || !p.target || !p.shard) throw new Error('Point API returned an unsupported format.');
  return p;
}

const TEX: Record<Body, string> = { mars: 'textures/mars-preview.jpg', moon: 'textures/moon-preview.jpg' };
const fmt = (lon: number, lat: number) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;

export function PointPicker({ onResult, active }: { onResult(p: PointResult): void; active: string | null }) {
  const [body, setBody] = useState<Body>('mars');
  const [lon, setLon] = useState('-72.5');
  const [lat, setLat] = useState('-7.0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const abort = useRef<AbortController | null>(null);
  const L = Number(lon), B = Number(lat);
  const valid = Number.isFinite(L) && Number.isFinite(B) && L >= -180 && L <= 180 && Math.abs(B) <= 88;

  const run = async (lo = L, la = B) => {
    abort.current?.abort();
    const ctrl = new AbortController(); abort.current = ctrl;
    setBusy(true); setError(null);
    try { onResult(await fetchPoint(body, lo, la, ctrl.signal)); }
    catch (e) { if ((e as Error).name !== 'AbortError') setError(String((e as Error).message ?? e)); }
    finally { if (abort.current === ctrl) setBusy(false); }
  };
  const fromEvent = (e: React.MouseEvent<HTMLDivElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [Math.max(-180, Math.min(180, ((e.clientX - r.left) / r.width) * 360 - 180)), Math.max(-88, Math.min(88, 90 - ((e.clientY - r.top) / r.height) * 180))];
  };
  const pick = (e: React.MouseEvent<HTMLDivElement>) => {
    const [lo, la] = fromEvent(e);
    setLon(lo.toFixed(3)); setLat(la.toFixed(3));
    void run(lo, la);
  };

  return <section className={`dc-picker body-${body}`} aria-labelledby="dc-picker-title">
    <header>
      <h2 id="dc-picker-title"><Crosshair size={15} /> {t('Any point on the Moon or Mars')}</h2>
      <p className="dc-note">{t('Click the map or type coordinates. A 22 km window is read from the global DEM, its terrain is measured, and every Earth window is scored with the same method as the curated targets.')}</p>
    </header>
    <div className="dc-picker-body">
      <div className="dc-picker-map" role="button" tabIndex={0} aria-label={t('Planet map: click to analyse a point')}
        onClick={busy ? undefined : pick} onMouseMove={e => setHover(fromEvent(e))} onMouseLeave={() => setHover(null)}
        onKeyDown={e => { if (e.key === 'Enter' && valid && !busy) void run(); }}>
        <img src={`${import.meta.env.BASE_URL}${TEX[body]}`} alt="" draggable={false} />
        {valid && <span className="dc-picker-pin" style={{ left: `${((L + 180) / 360) * 100}%`, top: `${((90 - B) / 180) * 100}%` }} />}
        {hover && <span className="dc-picker-hover">{fmt(...hover)}</span>}
        {busy && <span className="dc-picker-busy"><LoaderCircle size={16} className="dc-spin" /> {t('Reading the DEM window and scoring Earth…')}</span>}
      </div>
      <div className="dc-picker-form">
        <div className="dc-seg" role="group" aria-label={t('Body')}>
          {(['moon', 'mars'] as const).map(b => <button key={b} type="button" aria-pressed={body === b} disabled={busy} onClick={() => setBody(b)}>{b === 'moon' ? t('Moon') : t('Mars')}</button>)}
        </div>
        <label className="dc-field"><span>{t('Latitude')} (°)</span><input inputMode="decimal" value={lat} onChange={e => setLat(e.target.value)} /></label>
        <label className="dc-field"><span>{t('Longitude')} (°E)</span><input inputMode="decimal" value={lon} onChange={e => setLon(e.target.value)} /></label>
        <button type="button" className="dc-run" disabled={!valid || busy} onClick={() => void run()}>{busy ? t('Analysing…') : t('Analyse this point')}</button>
        <p className="dc-note">{body === 'moon' ? t('Moon: USGS LOLA global DEM, 118 m/px. About a minute for a new point.') : t('Mars: USGS HRSC/MOLA blend, 200 m/px. About 30 s for a new point.')} {t('Planetocentric, east-positive; |lat| ≤ 88°.')}</p>
        {active && <p className="dc-note">{t('Active point')}: <code>{active}</code></p>}
      </div>
    </div>
    {error && <div className="dc-notice" role="alert"><TriangleAlert size={16} /><p>{t(error)}</p></div>}
  </section>;
}
