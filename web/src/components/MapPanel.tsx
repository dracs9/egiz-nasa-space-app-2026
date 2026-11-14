import { t as localizeText, useLanguage } from '../i18n';
// AI-assisted implementation; human review pending.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Layers, MapPin, Maximize2, Minus, Plus, Table2, WifiOff } from 'lucide-react';
import { useAppStore } from '../state/store';
import type { Campaign, EarthTile, Run } from '../types/contracts';
import { coords, decimal, fidelityColor, siteName } from '../lib/format';
import copy from '../content/copy.json';
import { loadMapLibrary } from '../lib/maplibre';
import { candidateFidelity } from '../lib/candidateFidelity';
import type { Map as GLMap, Marker, GeoJSONSource } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';

interface Props { campaign?: Campaign; run: Run }
export function MapPanel({ campaign, run }: Props) {
  useLanguage();
  const { data, focusObjective, selectedSite, selectSite, lens } = useAppStore();
  const [view, setView] = useState<'map' | 'table'>('map');
  const [offline, setOffline] = useState(!navigator.onLine);
  const [mapReady, setMapReady] = useState(false);
  const element = useRef<HTMLDivElement>(null); const map = useRef<GLMap | null>(null); const markers = useRef<Marker[]>([]);
  const tiles = useMemo(() => data!.candidates.tiles.filter(t => t.pool !== 'control' && (lens === 'global' || t.pool === 'kazakhstan')), [data, lens]);
  const scores = useMemo(() => new Map(tiles.map(tile => [tile.id, candidateFidelity(run, tile.id, focusObjective)])), [tiles, run, focusObjective]);
  const value = useCallback((tile: EarthTile) => scores.get(tile.id) ?? null, [scores]);
  const ranked = useMemo(() => tiles.slice().sort((a, b) => (value(b) ?? -1) - (value(a) ?? -1) || a.id.localeCompare(b.id)), [tiles, value]);
  const fit = () => {
    if (!map.current || !campaign?.sites.length) return;
    const mapLatitude = (lat: number) => Math.max(-85, Math.min(85, lat));
    const positions = campaign.sites.map(s => tiles.find(t => t.id === s.id)).filter((t): t is EarthTile => !!t);
    if (positions.length === 1) map.current.flyTo({ center: [positions[0].lon, mapLatitude(positions[0].lat)], zoom: 3, essential: false });
    else if (positions.length) map.current.fitBounds([[Math.min(...positions.map(t => t.lon)), mapLatitude(Math.min(...positions.map(t => t.lat)))], [Math.max(...positions.map(t => t.lon)), mapLatitude(Math.max(...positions.map(t => t.lat)))]], { padding: 75, maxZoom: 3, duration: 600 });
  };
  useEffect(() => {
    if (!element.current || view !== 'map') return;
    let disposed = false; let gl: GLMap | null = null;
    loadMapLibrary().then(lib => {
      if (disposed || !element.current) return;
      try {
        gl = new lib.Map({ container: element.current, center: [20, 15], zoom: .5, minZoom: .2, maxZoom: 8, attributionControl: false, renderWorldCopies: false, style: { version: 8, sources: { gibs: { type: 'raster', tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg'], tileSize: 256, attribution: 'NASA GIBS / Blue Marble', maxzoom: 8 } }, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#131e2a' } }, { id: 'earth', type: 'raster', source: 'gibs', paint: { 'raster-opacity': .7, 'raster-saturation': -.6, 'raster-brightness-max': .65 } }] } });
        map.current = gl;
        gl.on('load', () => { if (!disposed) { setMapReady(true); gl!.resize(); } });
        gl.on('error', () => { if (!disposed) setOffline(true); });
        gl.on('sourcedata', e => { if (e.sourceId === 'gibs' && e.isSourceLoaded && !disposed) setOffline(false); });
      } catch { setOffline(true); }
    }).catch(() => setOffline(true));
    return () => { disposed = true; markers.current.forEach(m => m.remove()); markers.current = []; gl?.remove(); map.current = null; setMapReady(false); };
  }, [view]);
  useEffect(() => {
    if (view !== 'map' || typeof ResizeObserver === 'undefined' || !element.current) return;
    const observer = new ResizeObserver(() => map.current?.resize());
    observer.observe(element.current);
    return () => observer.disconnect();
  }, [view]);
  useEffect(() => {
    if (!mapReady || !map.current) return;
    let cancelled = false;
    const gl = map.current;
    const geojson: FeatureCollection = { type: 'FeatureCollection', features: tiles.map(tile => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [tile.lon, tile.lat] }, properties: { id: tile.id, fidelity: value(tile), eligible: value(tile) !== null, color: fidelityColor(value(tile)) } })) };
    const source = gl.getSource('candidates');
    if (source && source.type === 'geojson') (source as GeoJSONSource).setData(geojson);
    else {
      gl.addSource('candidates', { type: 'geojson', data: geojson });
      gl.addLayer({ id: 'candidate-points', type: 'circle', source: 'candidates', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 3, 4, 5], 'circle-color': ['get', 'color'], 'circle-stroke-width': 1, 'circle-stroke-color': '#0b1017', 'circle-opacity': .9 } });
      gl.on('click', 'candidate-points', e => { const id = e.features?.[0]?.properties?.id; if (typeof id === 'string') selectSite(id); });
      gl.on('mouseenter', 'candidate-points', () => { gl.getCanvas().style.cursor = 'pointer'; });
      gl.on('mouseleave', 'candidate-points', () => { gl.getCanvas().style.cursor = ''; });
    }
    markers.current.forEach(m => m.remove()); markers.current = [];
    import('maplibre-gl').then(lib => {
      if (cancelled || map.current !== gl) return;
      campaign?.sites.forEach((site, i) => {
        const tile = tiles.find(t => t.id === site.id); if (!tile) return;
        const button = document.createElement('button'); button.type = 'button'; button.className = `map-site-marker ${selectedSite === tile.id ? 'selected' : ''}`; button.textContent = String(i + 1); button.title = siteName(tile); button.setAttribute('aria-label', `Open site ${i + 1}: ${siteName(tile)}`); button.onclick = () => selectSite(tile.id);
        markers.current.push(new lib.Marker({ element: button }).setLngLat([tile.lon, tile.lat]).addTo(gl));
      });
    });
    return () => { cancelled = true; };
  }, [mapReady, campaign, tiles, value, selectedSite, selectSite]);
  const isCampaign = (id: string) => campaign?.sites.findIndex(s => s.id === id) ?? -1;
  return <section className="map-panel panel" aria-label={localizeText("Earth candidate locations")}>
    <div className="map-toolbar"><div className="segmented small"><button aria-pressed={view === 'map'} className={view === 'map' ? 'active' : ''} onClick={() => setView('map')}><Layers size={14} />{localizeText(copy.campaign.map)}</button><button aria-pressed={view === 'table'} className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}><Table2 size={14} />{localizeText(copy.campaign.table)}</button></div><span className="mono map-count"><span className="status-dot" /> {localizeText(tiles.length)}{localizeText(" CANDIDATES")}</span></div>
    {localizeText(view === 'table' ? <div className="candidate-table-wrap"><table className="candidate-table"><caption>{localizeText("Top candidates ")}{localizeText(focusObjective ? `for ${focusObjective}` : 'by best objective fidelity')}</caption><thead><tr><th>{localizeText("Site / location")}</th><th>{localizeText("Fidelity")}</th><th>{localizeText("Pool")}</th></tr></thead><tbody>{localizeText(ranked.slice(0, 50).map(tile => <tr key={tile.id}><td><button className="text-button" onClick={() => selectSite(tile.id)}>{localizeText(isCampaign(tile.id) >= 0 && <span className="tiny-number">{localizeText(isCampaign(tile.id) + 1)}</span>)}{localizeText(siteName(tile))}<small className="mono muted">{localizeText(coords(tile.lat, tile.lon))}</small></button></td><td className="mono" style={{ color: value(tile) == null ? 'var(--text-muted)' : 'var(--moon)' }}>{localizeText(value(tile) === null ? 'Not eligible' : decimal(value(tile)))}</td><td><span className="tag">{localizeText(tile.pool)}</span></td></tr>))}</tbody></table></div> : <div className="map-stage">
      <div className="map-grid" aria-hidden="true"><span>{localizeText("60°N")}</span><span>0°</span><span>{localizeText("60°S")}</span></div><div className="map-canvas" ref={element} aria-label={localizeText("Interactive Earth map")} />
      {localizeText(!mapReady && <div className="fallback-points">{localizeText(tiles.map(tile => <button key={tile.id} className={`fallback-point ${isCampaign(tile.id) >= 0 ? 'campaign-point' : ''}`} style={{ left: `${(tile.lon + 180) / 360 * 100}%`, top: `${(90 - tile.lat) / 180 * 100}%`, background: isCampaign(tile.id) >= 0 ? 'var(--earth)' : fidelityColor(value(tile)) }} onClick={() => selectSite(tile.id)} aria-label={localizeText(`Open ${siteName(tile)}, ${value(tile) === null ? 'not eligible' : `fidelity ${decimal(value(tile))}`}`)} title={localizeText(value(tile) === null ? 'Not eligible: no known objective fidelity' : `Fidelity ${decimal(value(tile))}`)}>{localizeText(isCampaign(tile.id) >= 0 ? isCampaign(tile.id) + 1 : '')}</button>))}</div>)}
      <div className="map-corner top-left"><Crosshair size={13} /><span className="mono">{localizeText("EARTH / WGS84")}</span></div>
      <div className="map-controls"><button title={localizeText("Zoom in")} aria-label={localizeText("Zoom in")} disabled={!mapReady} onClick={() => map.current?.zoomIn()}><Plus size={16} /></button><button title={localizeText("Zoom out")} aria-label={localizeText("Zoom out")} disabled={!mapReady} onClick={() => map.current?.zoomOut()}><Minus size={16} /></button><button title={localizeText(!mapReady ? 'Fit requires the interactive map. Candidate table remains available offline.' : copy.campaign.fit)} aria-label={localizeText(copy.campaign.fit)} disabled={!mapReady || !campaign?.sites.length} onClick={fit}><Maximize2 size={15} /></button></div>
      <div className="map-caption"><MapPin size={12} /> {localizeText(campaign?.sites.length ?? 0)}{localizeText(" campaign sites ")}<span>·</span>{localizeText(" Select a point to inspect")}</div>
      <div className="map-attribution">{localizeText("NASA GIBS / Blue Marble ")}{localizeText(offline && '· offline grid')}</div>
      {localizeText(offline && <div className="offline-note"><WifiOff size={12} />{localizeText(copy.common.offline)}</div>)}
    </div>)}
    <div className="map-legend"><span>{localizeText("OBJECTIVE FIDELITY")}</span><div className="legend-scale" /><span className="mono">0</span><span className="mono">1</span><span className="legend-missing" /> <span>{localizeText("not eligible")}</span></div>
  </section>;
}
