// EGIZ · React host for the planetary globe with HTML markers (real buttons: focusable, labelled,
// screen-reader visible) that follow the surface every frame without re-rendering React.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { t } from '../i18n';
import { Globe, type GlobeBody, type LatLon } from '../planet/journey/globe';
import { enhancePlace, enhanceSupported, type EnhanceStatus } from './enhance';

export interface GlobeMarker { id: string; lat: number; lon: number; kind: 'site' | 'place' | 'alt'; label: string; sub?: string; on?: boolean; onClick?: () => void }
const BASE = import.meta.env.BASE_URL;

export function GlobeView({ body, markers = [], interactive = true, spin = false, graticule = true, labels = 'auto', enhance = null, onReady, onPick, onHover, onView, onUserMove, children, className = '' }: {
  body: GlobeBody; markers?: GlobeMarker[];
  /** Place whose surface is enhanced on this device (Real-ESRGAN ×4) and laid over the globe; null for none. */
  enhance?: LatLon | null; interactive?: boolean; spin?: boolean; graticule?: boolean; labels?: 'auto' | 'all' | 'none';
  onReady?: (g: Globe | null) => void; onPick?: (p: LatLon) => void; onHover?: (p: LatLon | null) => void; onView?: (v: { lat: number; lon: number; dist: number }) => void; onUserMove?: () => void; children?: ReactNode; className?: string;
}) {
  const host = useRef<HTMLDivElement>(null), layer = useRef<HTMLDivElement>(null), globe = useRef<Globe | null>(null), [failed, setFailed] = useState<string | null>(null);
  const markersRef = useRef(markers); markersRef.current = markers;
  const cb = useRef({ onPick, onHover, onView, onUserMove }); cb.current = { onPick, onHover, onView, onUserMove };
  const dist = useRef(3);
  useEffect(() => {
    if (!host.current) return;
    let g: Globe;
    try { g = new Globe(host.current, { body, base: BASE, interactive, spin, graticule }); }
    catch (e) { setFailed(e instanceof Error ? e.message : String(e)); onReady?.(null); return; }
    globe.current = g;
    g.onPick = p => cb.current.onPick?.(p); g.onHover = p => cb.current.onHover?.(p); g.onUserMove = () => cb.current.onUserMove?.();
    g.onView = v => { dist.current = v.dist; cb.current.onView?.(v); };
    g.onFrame = project => {
      const el = layer.current; if (!el) return;
      for (const m of markersRef.current) {
        const node = el.querySelector<HTMLElement>(`[data-mid="${CSS.escape(m.id)}"]`); if (!node) continue;
        const p = project(m.lat, m.lon); node.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
        node.dataset.hidden = p.visible ? 'false' : 'true'; node.dataset.near = g.view.dist < 1.6 ? 'true' : 'false';
      }
    };
    onReady?.(g);
    return () => { onReady?.(null); g.dispose(); globe.current = null; };
  }, [body, interactive]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { globe.current?.setSpin(spin); }, [spin]);
  useEffect(() => { globe.current?.setGraticule(graticule); }, [graticule]);
  // Enhanced surface around the selected place: computed on this device, cross-faded in, never blocking the globe.
  const [enh, setEnh] = useState<{ status: EnhanceStatus; done: boolean; ep?: string } | null>(null), [ready, setReady] = useState(false);
  useEffect(() => { if (globe.current) setReady(true); });
  useEffect(() => {
    const g = globe.current; if (!g || !ready) return;
    if (!enhance || !enhanceSupported()) { g.setDetail(null); setEnh(null); return; }
    let live = true; setEnh({ status: null, done: false });
    enhancePlace(body, enhance.lat, enhance.lon, st => { if (live) setEnh({ status: st, done: false }); })
      .then(r => { if (!live || globe.current !== g) return; g.setDetail(r.canvas, r.box); setEnh({ status: null, done: true, ep: r.ep }); })
      .catch(e => { if (live) setEnh({ status: { stage: 'error', message: e instanceof Error ? e.message : String(e) }, done: false }); });
    return () => { live = false; };
  }, [ready, body, enhance?.lat, enhance?.lon]); // eslint-disable-line react-hooks/exhaustive-deps
  // Markers changed: let the next frame place them.
  useEffect(() => { globe.current?.renderNow(); }, [markers]);
  const key = (e: React.KeyboardEvent) => {
    const g = globe.current; if (!g) return; const step = e.shiftKey ? 30 : 10, map: Record<string, () => void> = {
      ArrowLeft: () => g.rotateBy(0, -step), ArrowRight: () => g.rotateBy(0, step), ArrowUp: () => g.rotateBy(step, 0), ArrowDown: () => g.rotateBy(-step, 0), '+': () => g.zoomBy(0.7), '=': () => g.zoomBy(0.7), '-': () => g.zoomBy(1.4) };
    const fn = map[e.key]; if (fn) { e.preventDefault(); fn(); }
  };
  return <div className={`xp-globe ${className}`} data-labels={labels}>
    <div ref={host} className="xp-globe-host" tabIndex={interactive ? 0 : -1} role={interactive ? 'application' : 'img'} aria-roledescription={interactive ? 'planet globe' : undefined}
      aria-label={interactive ? `${body === 'moon' ? 'Moon' : 'Mars'} globe. Arrow keys rotate, plus and minus zoom. Measured sites are listed as buttons.` : `${body === 'moon' ? 'Moon' : 'Mars'}, slowly rotating`} onKeyDown={interactive ? key : undefined} />
    <div ref={layer} className="xp-markers">
      {markers.map(m => <button key={m.id} data-mid={m.id} data-hidden="true" className={`xp-mk k-${m.kind} ${m.on ? 'on' : ''}`} onClick={m.onClick} tabIndex={m.onClick ? 0 : -1} aria-label={`${m.label}${m.sub ? `, ${m.sub}` : ''}`} aria-pressed={m.on}>
        <i aria-hidden="true" /><span>{m.label}{m.sub && <em>{m.sub}</em>}</span>
      </button>)}
    </div>
    {enh && <p className={`xp-enhance ${enh.done ? 'done' : ''}`} role="status" title={enh.status?.stage === 'error' ? enh.status.message : undefined}>
      <Sparkles size={12} aria-hidden="true" />
      {enh.done ? <>{t('AI-enhanced surface (Real-ESRGAN ×4, on this device) — illustration, not a measurement')}</>
        : enh.status?.stage === 'error' ? <>{t('Surface enhancement unavailable on this device')}</>
        : enh.status?.stage === 'download' ? <>{t('Loading the enhancement model (once)')} · {Math.round((enh.status.done / enh.status.total) * 100)} %</>
        : <>{t('Enhancing the surface image on this device…')}{enh.status?.stage === 'run' && enh.status.total > 1 ? ` ${enh.status.done}/${enh.status.total}` : ''}</>}
      {!enh.done && enh.status?.stage !== 'error' && <i className="xp-enhance-bar" aria-hidden="true" />}
    </p>}
    {failed && <p className="xp-globe-failed" role="alert">The 3D globe could not start ({failed}). Every site is still available in the list.</p>}
    {children}
  </div>;
}
