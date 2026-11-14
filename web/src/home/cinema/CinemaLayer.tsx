// Full-screen film plates between the live world and the words. Driven imperatively by scroll
// (no React work per frame). A plate covers the world only where the page has no interaction;
// interactive chapters open on film and hand off to the live instrument.
// AI-assisted implementation; human review pending.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { loadCinema, prefersStills, windowAlpha, type CinemaAsset } from './cinema';
import './cinema.css';

export interface CinemaHandle {
  /** Chapter position from the scroll; returns how much of the screen film covers (0..1). */
  update(c: number): number;
}
type Lang = 'en' | 'ru';

export const CinemaLayer = forwardRef<CinemaHandle, { lang: Lang; onAssets?: (a: CinemaAsset[]) => void; onCover?: (cover: number) => void }>(function CinemaLayer({ lang, onAssets, onCover }, ref) {
  const [assets, setAssets] = useState<CinemaAsset[]>([]);
  const els = useRef(new Map<string, HTMLDivElement>());
  const vids = useRef(new Map<string, HTMLVideoElement>());
  const ended = useRef(new Set<string>());
  const last = useRef(0);
  const stills = useRef(prefersStills());

  useEffect(() => {
    const ctl = new AbortController();
    loadCinema(ctl.signal).then(a => { if (!ctl.signal.aborted) { setAssets(a); onAssets?.(a); } });
    return () => ctl.abort();
  }, [onAssets]);

  const apply = (c: number) => {
    let cover = 0;
    for (const a of assets) {
      if (a.mode === 'inline') continue;
      const el = els.current.get(a.id); if (!el) continue;
      let alpha = windowAlpha(a.window, c);
      if (a.mode === 'handoff' && ended.current.has(a.id)) alpha = 0;
      el.style.opacity = alpha.toFixed(3);
      el.dataset.on = String(alpha > .5);
      cover = Math.max(cover, alpha);
      const v = vids.current.get(a.id);
      if (v && a.mode === 'scrub') {
        // the scroll position is the frame: the camera moves exactly as far as the visitor scrolls
        if (c > a.window[0] - .4 && c < a.window[1] + .1 && v.preload !== 'auto') { v.preload = 'auto'; v.load(); }
        if (!v.paused) v.pause();
        if (v.readyState >= 1 && v.duration) {
          const t = Math.min(1, Math.max(0, (c - a.window[0]) / (a.window[1] - a.window[0]))) * (v.duration - .04);
          if (Math.abs(v.currentTime - t) > 1 / 40) v.currentTime = t;
        }
      } else if (v) {
        const near = c > a.window[0] - .4 && c < a.window[1] + .1;
        if (near && v.preload !== 'auto') { v.preload = 'auto'; v.load(); }
        if (alpha > .02 && !(a.mode === 'handoff' && ended.current.has(a.id))) { if (v.paused) v.play().catch(() => {}); }
        else if (!v.paused) v.pause();
      }
    }
    onCover?.(cover);
    return cover;
  };
  useImperativeHandle(ref, () => ({ update(c: number) { last.current = c; return apply(c); } }), [assets]);
  useEffect(() => { apply(last.current); });

  const plates = assets.filter(a => a.mode !== 'inline');
  if (!plates.length) return null;
  const useVideo = (a: CinemaAsset) => a.sources.length > 0 && !stills.current;

  return <div className="cn-layer" aria-hidden="true">
    {plates.map(a => <div key={a.id} ref={el => { if (el) els.current.set(a.id, el); else els.current.delete(a.id); }} className={`cn-plate cn-${a.mode}`} style={{ opacity: 0 }}>
      {useVideo(a)
        ? <video ref={v => { if (v) vids.current.set(a.id, v); else vids.current.delete(a.id); }} muted playsInline loop={a.loop && a.mode !== 'scrub'} preload={a.window[0] <= 0 ? 'auto' : 'none'} autoPlay={a.window[0] <= 0 && a.mode !== 'scrub'}
            onLoadedMetadata={() => apply(last.current)}
            poster={a.still ?? undefined} style={{ objectPosition: a.focus }}
            onEnded={() => { if (a.mode === 'handoff') { ended.current.add(a.id); apply(last.current); } }}>
            {a.sources.map(s => <source key={s.src} src={s.src} type={s.type} />)}
          </video>
        : a.still && <img src={a.still} alt="" className="cn-still" style={{ objectPosition: a.focus }} loading={a.window[0] <= 0 ? 'eager' : 'lazy'} decoding="async" />}
      <span className="cn-credit">{a.id} · {lang === 'ru' ? 'иллюстративный кадр' : 'illustrative film'}</span>
    </div>)}
  </div>;
});
