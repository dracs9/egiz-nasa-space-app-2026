// Earth-wide candidate map: every window of the index as a point coloured by its score
// for the active target (sequential blue). Established analog sites are outlined.
import { useEffect, useRef, useState } from 'react';
import type { Map as GLMap, GeoJSONSource } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { WifiOff } from 'lucide-react';
import { loadMapLibrary } from '../lib/maplibre';
import { t } from '../i18n';
import { seqColor } from './charts';

interface Props {
  ids: string[]; lon: number[]; lat: number[]; score: ArrayLike<number>; visible: boolean[]; maxScore: number;
  shortlist: string[]; selected: string | null; established: { id: string; lon: number; lat: number; name: string }[];
  onSelect(id: string): void;
}

export function DiscoverMap({ ids, lon, lat, score, visible, maxScore, shortlist, selected, established, onSelect }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<GLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const select = useRef(onSelect); select.current = onSelect;

  useEffect(() => {
    if (!el.current) return;
    let disposed = false, gl: GLMap | null = null;
    loadMapLibrary().then(lib => {
      if (disposed || !el.current) return;
      try {
        gl = new lib.Map({ container: el.current, center: [40, 25], zoom: 0.6, minZoom: 0.3, maxZoom: 9, attributionControl: { compact: true }, renderWorldCopies: false,
          style: { version: 8, sources: { gibs: { type: 'raster', tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg'], tileSize: 256, attribution: 'NASA GIBS / Blue Marble', maxzoom: 8 } },
            layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0b0b0d' } }, { id: 'earth', type: 'raster', source: 'gibs', paint: { 'raster-opacity': .55, 'raster-saturation': -.85, 'raster-brightness-max': .55 } }] } });
        map.current = gl;
        gl.on('load', () => {
          if (disposed || !gl) return;
          gl.addSource('windows', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          gl.addSource('analogs', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          gl.addLayer({ id: 'w', type: 'circle', source: 'windows', paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 0.5, ['case', ['get', 'short'], 4.5, 2.4], 5, ['case', ['get', 'short'], 9, 5]],
            'circle-color': ['get', 'color'], 'circle-opacity': ['case', ['get', 'dim'], 0.25, 0.95],
            'circle-stroke-width': ['case', ['get', 'sel'], 2.5, ['get', 'short'], 1.2, 0], 'circle-stroke-color': ['case', ['get', 'sel'], '#f0f0f5', '#000'] } });
          gl.addLayer({ id: 'a', type: 'circle', source: 'analogs', paint: { 'circle-radius': 7, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#d9c9a3' } });
          gl.on('click', 'w', e => { const id = e.features?.[0]?.properties?.id; if (typeof id === 'string') select.current(id); });
          gl.on('mouseenter', 'w', () => { gl!.getCanvas().style.cursor = 'pointer'; });
          gl.on('mouseleave', 'w', () => { gl!.getCanvas().style.cursor = ''; });
          setReady(true);
        });
        gl.on('error', () => { if (!disposed) setOffline(true); });
        gl.on('sourcedata', e => { if (e.sourceId === 'gibs' && e.isSourceLoaded && !disposed) setOffline(false); });
      } catch { setOffline(true); }
    }).catch(() => setOffline(true));
    const ro = typeof ResizeObserver !== 'undefined' && el.current ? new ResizeObserver(() => map.current?.resize()) : null;
    if (ro && el.current) ro.observe(el.current);
    return () => { disposed = true; ro?.disconnect(); gl?.remove(); map.current = null; setReady(false); };
  }, []);

  useEffect(() => {
    const gl = map.current; if (!ready || !gl) return;
    const shortSet = new Set(shortlist);
    const order = ids.map((_, i) => i).sort((a, b) => score[a] - score[b]); // high scores drawn on top
    const fc: FeatureCollection = { type: 'FeatureCollection', features: order.map(i => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon[i], lat[i]] },
      properties: { id: ids[i], color: seqColor(score[i], maxScore), dim: !visible[i], short: shortSet.has(ids[i]), sel: ids[i] === selected } })) };
    (gl.getSource('windows') as GeoJSONSource).setData(fc);
    (gl.getSource('analogs') as GeoJSONSource).setData({ type: 'FeatureCollection', features: established.map(a => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [a.lon, a.lat] }, properties: { id: a.id, name: a.name } })) });
  }, [ready, ids, lon, lat, score, visible, maxScore, shortlist, selected, established]);

  useEffect(() => {
    const gl = map.current; if (!ready || !gl || !selected) return;
    const i = ids.indexOf(selected); if (i < 0) return;
    gl.flyTo({ center: [lon[i], Math.max(-80, Math.min(80, lat[i]))], zoom: Math.max(gl.getZoom(), 3), duration: 700, essential: false });
  }, [ready, selected, ids, lon, lat]);

  return <div className="dc-map-wrap">
    <div ref={el} className="dc-map" role="application" aria-label={t('Earth-wide candidate map')} />
    <div className="dc-map-legend" aria-hidden="true">
      <span>{t('Score')}</span><i className="dc-ramp" /><span>0</span><span>{maxScore.toFixed(2)}</span>
      <span className="dc-analog-key"><i />{t('Established analog')}</span>
    </div>
    {offline && <p className="dc-map-offline" role="status"><WifiOff size={14} /> {t('Basemap offline — points still shown')}</p>}
  </div>;
}
