// ACT I · THE FILM. Five chained clips (S1–S5) become one continuous flight: S1 plays on arrival,
// then the scroll position IS the camera — Moon, Death Valley, the Moon again, the passage, Jezero.
// A flight computer reads out where the camera is; at the end the frame dissolves into the live,
// measured world (Act II). All per-frame work writes to the DOM directly; React only for captions.
// AI-assisted implementation; human review pending.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowRight } from 'lucide-react';
import { prefersStills, type CinemaAsset } from '../cinema/cinema';
import { Decode } from './Decode';
import './film.css';

type Lang = 'en' | 'ru';
const L = <T,>(lang: Lang, en: T, ru: T) => (lang === 'ru' ? ru : en);
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (t: number) => { t = clamp(t); return t * t * (3 - 2 * t); };
const CLIP_S = 7.93, FPS = 24;

/** Scroll lengths in screen heights: the hold on the arrival, four scrubbed clips, the hand-off. */
const SEG = [0.9, 1.5, 1.5, 1.4, 1.6, 1.1];
const STARTS = SEG.map((_, i) => SEG.slice(0, i).reduce((a, b) => a + b, 0));
const TOTAL = SEG.reduce((a, b) => a + b, 0);

type Place = { body: 'moon' | 'earth' | 'mars' | 'transit'; en: string; ru: string; lat?: number; lon?: number };
const MOUTON: Place = { body: 'moon', en: 'Mons Mouton · lunar south pole', ru: 'Монс-Мутон · южный полюс Луны', lat: -85.43, lon: 31.74 };
const VALLEY: Place = { body: 'earth', en: 'Death Valley · California', ru: 'Долина Смерти · Калифорния', lat: 36.24, lon: -116.82 };
const RIM: Place = { body: 'moon', en: 'Crater rim · lunar south pole', ru: 'Край кратера · южный полюс Луны', lat: -85.4, lon: 32.7 };
const TRANSIT: Place = { body: 'transit', en: 'Moon → Mars', ru: 'Луна → Марс' };
const JEZERO: Place = { body: 'mars', en: 'Jezero crater · Mars', ru: 'Кратер Езеро · Марс', lat: 18.44, lon: 77.45 };

/** What the flight computer shows for clip k at local time t: place, and camera altitude in metres. */
function telemetry(k: number, t: number): { place: Place; alt: number | null } {
  const lerpLog = (a: number, b: number, x: number) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * smooth(x));
  switch (k) {
    case 0: return { place: MOUTON, alt: lerpLog(60000, 600, t) };
    case 1: return { place: t < .5 ? MOUTON : VALLEY, alt: lerpLog(600, 4, t) };
    case 2: return { place: t < .5 ? VALLEY : RIM, alt: lerpLog(4, 40, t) };
    case 3: return t < .22 ? { place: RIM, alt: lerpLog(40, 9000, t / .22) } : t > .78 ? { place: JEZERO, alt: lerpLog(40000, 1500, (t - .78) / .22) } : { place: TRANSIT, alt: null };
    default: return { place: JEZERO, alt: lerpLog(1500, 25, t) };
  }
}
const fmtAlt = (m: number | null, lang: Lang) => m == null ? '— — —' : m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} ${L(lang, 'km', 'км')}` : `${Math.round(m)} ${L(lang, 'm', 'м')}`;
const fmtCoord = (p: Place, lang: Lang) => p.lat == null || p.lon == null ? L(lang, 'interplanetary', 'межпланетный перелёт')
  : `${Math.abs(p.lat).toFixed(2)}°${p.lat >= 0 ? L(lang, 'N', ' с.ш.') : L(lang, 'S', ' ю.ш.')}  ${Math.abs(p.lon).toFixed(2)}°${p.lon >= 0 ? L(lang, 'E', ' в.д.') : L(lang, 'W', ' з.д.')}`;
const bodyName = (b: Place['body'], lang: Lang) => ({ moon: L(lang, 'MOON', 'ЛУНА'), earth: L(lang, 'EARTH', 'ЗЕМЛЯ'), mars: L(lang, 'MARS', 'МАРС'), transit: L(lang, 'DEEP SPACE', 'КОСМОС') })[b];
const tc = (sec: number) => { const f = Math.floor(sec * FPS); const s = Math.floor(f / FPS); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}:${String(f % FPS).padStart(2, '0')}`; };

interface Caption { id: string; seg: number; from: number; to: number; kicker?: { en: string; ru: string }; title: { en: string; ru: string }; body?: { en: string; ru: string }; side?: 'left' | 'right' }

export function FilmAct({ lang, clips, hMax, soundOn, onCover, onPlan, onFinish }: {
  lang: Lang; clips: CinemaAsset[]; hMax: number | null; soundOn: boolean;
  /** covering: the film hides the live world (skip its GPU work) · chrome: the film still owns the screen (hide the world's UI) */
  onCover: (covering: boolean, chrome: boolean) => void; onPlan: () => void; onFinish: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  const vids = useRef<(HTMLVideoElement | null)[]>([]);
  const layers = useRef<(HTMLDivElement | null)[]>([]);
  const hud = useRef<Record<string, HTMLElement | null>>({});
  const [cap, setCap] = useState('hero');
  const [arrived, setArrived] = useState(false);
  const stills = useRef(prefersStills());
  const s1Done = useRef(false);

  const captions: Caption[] = useMemo(() => [
    { id: 'twin-a', seg: 1, from: .06, to: .42, kicker: { en: 'Same camera · same light', ru: 'Та же камера · тот же свет' }, title: { en: 'That was the Moon.', ru: 'Это была Луна.' } },
    { id: 'twin-b', seg: 1, from: .58, to: .98, kicker: { en: 'Earth · the stand-in', ru: 'Земля · двойник' }, title: { en: 'This is Death Valley.', ru: 'А это — Долина Смерти.' }, body: { en: 'The closest ground Earth has to it. Crews rehearse here before they ever leave.', ru: 'Самое близкое к ней, что есть на Земле. Здесь репетируют, прежде чем улететь.' } },
    { id: 'rim', seg: 2, from: .55, to: .98, kicker: { en: 'Back at the pole', ru: 'Снова на полюсе' }, title: { en: 'The Sun never climbs.', ru: 'Солнце здесь не поднимается.' }, body: hMax != null ? { en: `At Mons Mouton it never gets higher than ${hMax.toFixed(1)}°. Shadows run for kilometres, and every slope is measured.`, ru: `На Монс-Мутон оно не выше ${hMax.toFixed(1)}°. Тени тянутся на километры, и каждый уклон здесь измерен.` } : undefined },
    { id: 'beyond', seg: 3, from: .12, to: .7, kicker: { en: 'Moon → Mars', ru: 'Луна → Марс' }, title: { en: 'Beyond Earth,\ninto the unknown.', ru: 'За пределы Земли,\nв неизвестность.' }, side: 'right' },
    { id: 'jezero', seg: 4, from: .2, to: .95, kicker: { en: 'Mars · 18.44° N 77.45° E', ru: 'Марс · 18,44° с.ш. 77,45° в.д.' }, title: { en: 'Jezero.', ru: 'Езеро.' }, body: { en: 'An ancient river delta in a crater that once held a lake, where Perseverance landed in 2021. Earth has a twin for this ground too.', ru: 'Древняя дельта в кратере, где когда-то было озеро, и место посадки Perseverance в 2021 году. У этой почвы тоже есть двойник на Земле.' } },
  ], [hMax]);

  // ---------- the clock: scroll → clip, frame, telemetry ----------
  useEffect(() => {
    const host = root.current; if (!host) return;
    let raf = 0, sp = 0, last = performance.now(), live = false, covering = false, chrome = false;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(.05, (now - last) / 1000); last = now;
      const vh = window.innerHeight; const pos = clamp(-host.getBoundingClientRect().top / vh, 0, TOTAL);
      sp += (pos - sp) * (1 - Math.exp(-dt * 9));   // a little inertia: the camera glides, it never jumps
      if (Math.abs(pos - sp) < .0005) sp = pos;
      let seg = SEG.length - 1; for (let i = 0; i < SEG.length; i++) if (sp < STARTS[i] + SEG[i]) { seg = i; break; }
      const t = clamp((sp - STARTS[seg]) / SEG[seg]);
      const clip = Math.min(seg, 4);                  // seg 5 (the hand-off) holds the last clip
      const ct = seg === 0 ? null : seg === 5 ? 1 : t;

      // the visible clip; neighbours are already loaded so the cut lands on the shared frame
      layers.current.forEach((el, i) => { if (el) el.style.opacity = i === clip ? '1' : '0'; });
      vids.current.forEach((v, i) => {
        if (!v) return;
        if (Math.abs(i - clip) <= 1 && v.preload !== 'auto') { v.preload = 'auto'; v.load(); }
        if (i === 0) {
          if (clip === 0 && !s1Done.current) { if (v.paused && v.readyState >= 2) v.play().catch(() => {}); }
          else if (!v.paused) { v.pause(); }
          v.muted = !soundOnRef.current;
          return;
        }
        if (!v.paused) v.pause();
        if (i === clip && ct != null && v.readyState >= 1 && v.duration) {
          const target = ct * (v.duration - .05);
          if (Math.abs(v.currentTime - target) > 1 / 48) v.currentTime = target;
        }
      });

      // the hand-off: the frame dissolves and the live, measured world shows through
      // a scan line wipes the frame away top to bottom; the HUD and path fade a little after it
      const wipe = seg === 5 ? smooth((t - .12) / .6) : 0;
      const fade = seg === 5 ? smooth((t - .62) / .3) : 0;
      host.style.setProperty('--fa-wipe', wipe.toFixed(4));
      host.style.setProperty('--fa-fade', fade.toFixed(3));
      host.style.setProperty('--fa-bars', (1 - smooth(sp / .35)).toFixed(3));
      host.style.setProperty('--fa-progress', (sp / TOTAL).toFixed(4));
      const cov = wipe < .02, chr = fade < .98;
      if (cov !== covering || chr !== chrome) { covering = cov; chrome = chr; onCoverRef.current(cov, chr); }

      // flight computer
      const filmSec = clip === 0 ? (vids.current[0]?.currentTime ?? 0) : clip * CLIP_S + (ct ?? 0) * CLIP_S;
      const { place, alt } = telemetry(clip, clip === 0 ? clamp(filmSec / CLIP_S) : (ct ?? 0));
      const h = hud.current;
      if (h.body) h.body.textContent = bodyName(place.body, langRef.current);
      if (h.place) h.place.textContent = L(langRef.current, place.en, place.ru);
      if (h.coord) h.coord.textContent = fmtCoord(place, langRef.current);
      if (h.alt) h.alt.textContent = fmtAlt(alt, langRef.current);
      if (h.tc) h.tc.textContent = `T+ ${tc(filmSec)}`;
      if (h.frame) h.frame.textContent = String(Math.round(filmSec * FPS)).padStart(4, '0');
      if (root.current) root.current.dataset.body = place.body;

      // captions (React only when the active one changes)
      let id = seg === 0 ? 'hero' : seg === 5 ? 'handoff' : '';
      for (const c of capsRef.current) if (c.seg === seg && t >= c.from && t <= c.to) id = c.id;
      if (id !== capRef.current) { capRef.current = id; setCap(id); }
      if (seg === 5 && t > .9 && !finished.current) { finished.current = true; onFinishRef.current(); }
      if (seg < 5) finished.current = false;
    };
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !live) { live = true; last = performance.now(); raf = requestAnimationFrame(frame); }
      else if (!e.isIntersecting && live) { live = false; cancelAnimationFrame(raf); if (covering || chrome) { covering = false; chrome = false; onCoverRef.current(false, false); } vids.current.forEach(v => v?.pause()); }
    });
    io.observe(host);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, []);
  // latest props for the loop without restarting it
  const soundOnRef = useRef(soundOn); soundOnRef.current = soundOn;
  const langRef = useRef(lang); langRef.current = lang;
  const onCoverRef = useRef(onCover); onCoverRef.current = onCover;
  const onFinishRef = useRef(onFinish); onFinishRef.current = onFinish;
  const capsRef = useRef(captions); capsRef.current = captions;
  const capRef = useRef(cap);
  const finished = useRef(false);

  useEffect(() => { const id = window.setTimeout(() => setArrived(true), 250); return () => window.clearTimeout(id); }, []);

  const byId = (id: string) => clips.find(c => c.id === id);
  const ordered = ['S1', 'S2', 'S3', 'S4', 'S5'].map(byId);
  const scrollOn = () => { const el = root.current; if (el) window.scrollTo({ top: el.offsetTop + window.innerHeight * (STARTS[1] + .05), behavior: 'smooth' }); };
  const T = (x: { en: string; ru: string }) => L(lang, x.en, x.ru);
  const nodes = [
    { at: STARTS[0], label: L(lang, 'Moon', 'Луна') }, { at: STARTS[1] + SEG[1] * .5, label: L(lang, 'Earth', 'Земля') },
    { at: STARTS[2] + SEG[2] * .5, label: L(lang, 'Moon', 'Луна') }, { at: STARTS[4], label: L(lang, 'Mars', 'Марс') },
    { at: STARTS[5] + SEG[5] * .6, label: L(lang, 'Live', 'Вживую') },
  ];

  return <section ref={root} className={`fa ${arrived ? 'is-arrived' : ''}`} style={{ height: `${(TOTAL + 1) * 100}svh` }} data-cap={cap} aria-labelledby="hm-title">
    <div className="fa-stage">
      <div className="fa-reel" aria-hidden="true">
        {ordered.map((c, i) => <div key={i} ref={el => { layers.current[i] = el; }} className="fa-clip" style={{ opacity: i === 0 ? 1 : 0 }}>
          {c && (c.sources.length && !stills.current
            ? <video ref={v => { vids.current[i] = v; }} muted playsInline preload={i === 0 ? 'auto' : 'none'} poster={c.still ?? undefined} style={{ objectPosition: c.focus }}
                autoPlay={i === 0} onEnded={i === 0 ? () => { s1Done.current = true; } : undefined}>
                {c.sources.map(s => <source key={s.src} src={s.src} type={s.type} />)}
              </video>
            : <img src={(i === 0 ? c.end : c.still) ?? c.still ?? ''} alt="" style={{ objectPosition: c.focus }} />)}
        </div>)}
        <div className="fa-grain" />
        <div className="fa-scanline" />
      </div>

      <div className="fa-bars" aria-hidden="true"><i /><i /></div>

      {/* the opening title over the arrival */}
      <div className="fa-cap fa-hero" data-on={cap === 'hero'}>
        <p className="fa-kicker">{L(lang, 'EGIZ · Training grounds for the Moon and Mars', 'EGIZ · Земные полигоны для Луны и Марса')}</p>
        <h1 id="hm-title" className="fa-title">
          <Decode text={L(lang, 'The next frontier', 'Новый рубеж')} on={arrived && cap === 'hero'} delay={500} />
          <Decode text={L(lang, 'starts here', 'начинается здесь')} on={arrived && cap === 'hero'} delay={900} className="fa-title-2" />
        </h1>
        <p className="fa-lede">{L(lang, 'Every step on the Moon and Mars is practised on Earth first. EGIZ finds the places on our planet that come closest — and says plainly what no place on Earth can teach.', 'Каждый шаг на Луне и Марсе сначала отрабатывают на Земле. EGIZ находит места на нашей планете, которые ближе всего к цели, — и прямо говорит, чему Земля научить не может.')}</p>
        <div className="fa-actions">
          <button className="eg-button" onClick={onPlan}>{L(lang, 'Plan a mission', 'Спланировать миссию')}<ArrowRight size={16} strokeWidth={1.6} /></button>
          <button className="fa-scroll" onClick={scrollOn}><ArrowDown size={14} strokeWidth={1.4} /><span>{L(lang, 'Scroll to fly', 'Скролл — это полёт')}</span></button>
        </div>
      </div>

      {captions.map(c => <div key={c.id} className={`fa-cap fa-cap-${c.side ?? 'left'}`} data-on={cap === c.id} aria-hidden={cap !== c.id}>
        {c.kicker && <p className="fa-kicker">{T(c.kicker)}</p>}
        <Decode as="h2" className="fa-h2" text={T(c.title)} on={cap === c.id} speed={22} />
        {c.body && <p className="fa-body">{T(c.body)}</p>}
      </div>)}

      <div className="fa-cap fa-handoff" data-on={cap === 'handoff'}>
        <p className="fa-kicker">{L(lang, 'End of film · 00:39', 'Конец фильма · 00:39')}</p>
        <Decode as="h2" className="fa-h2" text={L(lang, 'That was a film.\nWhat follows is live.', 'Это был фильм.\nДальше — вживую.')} on={cap === 'handoff'} speed={22} />
        <p className="fa-body">{L(lang, 'Measured terrain of the Moon, Mars and their stand-ins on Earth, rendered in your browser. Touch it, light it, plan on it.', 'Измеренный рельеф Луны, Марса и их земных двойников, отрисованный прямо в вашем браузере. Его можно трогать, освещать и планировать на нём.')}</p>
      </div>

      {/* flight computer */}
      <div className="fa-hud" aria-hidden="true">
        <div className="fa-hud-body"><i /><span ref={el => { hud.current.body = el; }}>{bodyName('moon', lang)}</span></div>
        <div className="fa-hud-place" ref={el => { hud.current.place = el; }}>{T(MOUTON)}</div>
        <dl>
          <div><dt>{L(lang, 'Position', 'Координаты')}</dt><dd ref={el => { hud.current.coord = el; }}>{fmtCoord(MOUTON, lang)}</dd></div>
          <div><dt>{L(lang, 'Camera alt.', 'Высота камеры')}</dt><dd ref={el => { hud.current.alt = el; }}>60 {L(lang, 'km', 'км')}</dd></div>
          <div><dt>{L(lang, 'Film', 'Плёнка')}</dt><dd><span ref={el => { hud.current.tc = el; }}>T+ 00:00:00</span> · <span ref={el => { hud.current.frame = el; }}>0000</span></dd></div>
        </dl>
        <p className="fa-hud-note">{L(lang, 'Illustrative film · real coordinates', 'Иллюстративный фильм · реальные координаты')}</p>
      </div>

      <div className="fa-path" aria-hidden="true">
        <div className="fa-path-line"><i /></div>
        {nodes.map((n, i) => <span key={i} className="fa-node" style={{ top: `${(n.at / TOTAL) * 100}%` }}><b />{n.label}</span>)}
      </div>
    </div>
  </section>;
}
