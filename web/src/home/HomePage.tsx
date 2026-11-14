// EGIZ landing narrative. Every figure on this page is read from the loaded dataset.
import { Fragment, isValidElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import Lenis from 'lenis';
import { Decode } from './Decode';
import { t as tr, useLanguage } from '../i18n';
import { useAppStore, type Route } from '../state/store';
import type { AppData, Run, Target } from '../types/contracts';
import { hasSyntheticData } from '../data/load';
import { MissionGlyph } from '../mission/MissionGlyph';
import { DestinationArtwork } from '../components/DestinationArtwork';
import { setLaunchIntent, type LaunchOverrides } from '../mission/launchIntent';
import type { Mode } from '../mission/types';
import './home.css';

interface Param { key: string; group: 'rover' | 'vehicle'; en: string; ru: string; unit: string; min: number; max: number; step: number; value: number; maxFrom?: string }
/** The few inputs that change each expedition the most; everything else stays in the lab. */
const PARAMS: Record<Mode, Param[]> = {
  rover: [
    { key: 'speed', group: 'rover', en: 'Cruise speed', ru: 'Скорость', unit: 'm/s', min: 0.2, max: 2, step: 0.1, value: 0.8 },
    { key: 'maxSlope', group: 'rover', en: 'Slope limit', ru: 'Предел уклона', unit: '°', min: 5, max: 30, step: 1, value: 15 },
    { key: 'batteryWh', group: 'rover', en: 'Battery', ru: 'Батарея', unit: 'Wh', min: 1000, max: 10000, step: 500, value: 3000 },
  ],
  launch: [
    { key: 'thrust', group: 'vehicle', en: 'Thrust', ru: 'Тяга', unit: 'N', min: 10000, max: 60000, step: 1000, value: 24000 },
    { key: 'fuel', group: 'vehicle', en: 'Propellant', ru: 'Топливо', unit: 'kg', min: 200, max: 1500, step: 50, value: 600 },
    { key: 'angle', group: 'vehicle', en: 'Tilt from vertical', ru: 'Наклон', unit: '°', min: 0, max: 30, step: 1, value: 0 },
  ],
  descent: [
    { key: 'initialAltitude', group: 'vehicle', en: 'Start altitude', ru: 'Начальная высота', unit: 'm', min: 400, max: 3000, step: 100, value: 1200 },
    { key: 'initialVelocity', group: 'vehicle', en: 'Vertical speed', ru: 'Вертикальная скорость', unit: 'm/s', min: -80, max: -5, step: 1, value: -35 },
    { key: 'ignitionAltitude', group: 'vehicle', en: 'Engine ignition', ru: 'Включение двигателя', unit: 'm', min: 100, max: 2900, step: 50, value: 800, maxFrom: 'initialAltitude' },
  ],
  eva: [
    { key: 'speed', group: 'rover', en: 'Walking speed', ru: 'Скорость', unit: 'm/s', min: 0.5, max: 2, step: 0.1, value: 1 },
    { key: 'maxSlope', group: 'rover', en: 'Slope limit', ru: 'Предел уклона', unit: '°', min: 10, max: 30, step: 1, value: 20 },
    { key: 'batteryWh', group: 'rover', en: 'Life-support energy', ru: 'Запас энергии', unit: 'Wh', min: 1000, max: 6000, step: 250, value: 3000 },
  ],
};
const paramMax = (p: Param, values: Record<string, number>) => p.maxFrom ? Math.min(p.max, (values[p.maxFrom] ?? p.max) - p.step) : p.max;
const paramValue = (p: Param, values: Record<string, number>) => Math.min(values[p.key] ?? p.value, paramMax(p, values));
const defaultsFor = (mode: Mode) => Object.fromEntries(PARAMS[mode].map(p => [p.key, p.value]));

const EXPEDITIONS: { mode: Mode; en: string; ru: string; textEn: string; textRu: string }[] = [
  { mode: 'rover', en: 'Rover traverse', ru: 'Маршрут ровера', textEn: 'Drive across measured terrain', textRu: 'Проехать по измеренному рельефу' },
  { mode: 'launch', en: 'Launch & flight', ru: 'Взлёт и полёт', textEn: 'Test a rocket launch', textRu: 'Испытать запуск ракеты' },
  { mode: 'descent', en: 'Descent & landing', ru: 'Спуск и посадка', textEn: 'Try a surface landing', textRu: 'Попробовать посадку' },
  { mode: 'eva', en: 'Habitat & EVA', ru: 'База и выход', textEn: 'Plan surface exploration', textRu: 'Спланировать выход на поверхность' },
];

type Lang = 'en' | 'ru';
const L = <T,>(lang: Lang, en: T, ru: T) => (lang === 'ru' ? ru : en);
const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;

/** Pick the rendition by the screen's real pixels: phones 720p, laptops 1080p, large or dense screens 1440p. */
const CLIP_RES = (() => {
  if (typeof window === 'undefined') return 1080;
  const px = Math.max(window.innerWidth, window.innerHeight) * Math.min(window.devicePixelRatio || 1, 2);
  return px < 1000 ? 720 : px < 1800 ? 1080 : 1440;
})();
/** The seven clips, in flight order: one continuous film behind the whole page. */
const FILM = ['hero/s1-arrival', 'earth/s2-twin', 'moon/s3-return', 'transitions/s4-passage', 'mars/s5-jezero', 'missions/s6-answer', 'orbital/s7-home'];

type Body = 'moon' | 'earth' | 'mars' | 'transit';
interface Place { body: Body; en: string; ru: string; lat?: number; lon?: number }
const MOUTON: Place = { body: 'moon', en: 'Mons Mouton · lunar south pole', ru: 'Монс-Мутон · южный полюс Луны', lat: -85.43, lon: 31.74 };
const VALLEY: Place = { body: 'earth', en: 'Death Valley · California', ru: 'Долина Смерти · Калифорния', lat: 36.24, lon: -116.82 };
const RIM: Place = { body: 'moon', en: 'Crater rim · lunar south pole', ru: 'Край кратера · южный полюс Луны', lat: -85.4, lon: 32.7 };
const TRANSIT: Place = { body: 'transit', en: 'Moon → Mars', ru: 'Луна → Марс' };
const JEZERO: Place = { body: 'mars', en: 'Jezero crater · Mars', ru: 'Кратер Езеро · Марс', lat: 18.44, lon: 77.45 };
const ORBIT: Place = { body: 'transit', en: 'Low Earth orbit', ru: 'Низкая околоземная орбита' };
const smoothstep = (t: number) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const logLerp = (a: number, b: number, x: number) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * smoothstep(x));
/** Where the camera is in clip k at local time t: the place, and its altitude in metres (null in deep space). */
function telemetry(k: number, t: number, twin: Place): { place: Place; alt: number | null } {
  switch (k) {
    case 0: return { place: MOUTON, alt: logLerp(60000, 600, t) };
    case 1: return { place: t < .5 ? MOUTON : VALLEY, alt: logLerp(600, 4, t) };
    case 2: return { place: t < .5 ? VALLEY : RIM, alt: logLerp(4, 40, t) };
    case 3: return t < .22 ? { place: RIM, alt: logLerp(40, 9000, t / .22) } : t > .78 ? { place: JEZERO, alt: logLerp(40000, 1500, (t - .78) / .22) } : { place: TRANSIT, alt: null };
    case 4: return { place: JEZERO, alt: logLerp(1500, 25, t) };
    case 5: return { place: t < .55 ? JEZERO : twin, alt: 25 };
    default: return t < .4 ? { place: twin, alt: logLerp(25, 12000, t / .4) } : { place: ORBIT, alt: logLerp(12000, 400000, (t - .4) / .6) };
  }
}
const fmtAlt = (m: number | null, lang: Lang) => m == null ? '— — —' : m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} ${L(lang, 'km', 'км')}` : `${Math.round(m)} ${L(lang, 'm', 'м')}`;
const fmtCoord = (pl: Place, lang: Lang) => pl.lat == null || pl.lon == null ? (pl.body === 'transit' && pl === ORBIT ? L(lang, '400 km above Earth', '400 км над Землёй') : L(lang, 'interplanetary', 'межпланетный перелёт'))
  : `${Math.abs(pl.lat).toFixed(2)}°${pl.lat >= 0 ? L(lang, 'N', ' с.ш.') : L(lang, 'S', ' ю.ш.')}  ${Math.abs(pl.lon).toFixed(2)}°${pl.lon >= 0 ? L(lang, 'E', ' в.д.') : L(lang, 'W', ' з.д.')}`;
const bodyName = (b: Body, lang: Lang) => ({ moon: L(lang, 'MOON', 'ЛУНА'), earth: L(lang, 'EARTH', 'ЗЕМЛЯ'), mars: L(lang, 'MARS', 'МАРС'), transit: L(lang, 'SPACE', 'КОСМОС') })[b];
const timecode = (sec: number) => { const f = Math.floor(sec * 24); const s2 = Math.floor(f / 24); return `${String(Math.floor(s2 / 60)).padStart(2, '0')}:${String(s2 % 60).padStart(2, '0')}:${String(f % 24).padStart(2, '0')}`; };

/** Mono labels resolve out of signal noise the first time they come into view. */
function DecodeView({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null); const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el || typeof IntersectionObserver === 'undefined') { setOn(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setOn(true); io.disconnect(); } }, { rootMargin: '0px 0px -8% 0px' });
    io.observe(el); return () => io.disconnect();
  }, []);
  return <span ref={ref}><Decode text={text} on={on} speed={18} /></span>;
}

/** Splits a heading into words so each word can move on its own (strings only; line breaks kept). */
function Words({ children }: { children: ReactNode }) {
  let i = 0;
  const split = (node: ReactNode): ReactNode => {
    if (typeof node === 'string') return node.split(/(\s+)/).map((part, k) => /^\s+$/.test(part) || !part ? part : <span key={`${i}-${k}`} className="w" style={{ '--i': i++ } as React.CSSProperties}><span>{part}</span></span>);
    if (Array.isArray(node)) return node.map((n, k) => <Fragment key={k}>{split(n)}</Fragment>);
    if (isValidElement(node) && node.type === Fragment) return split((node.props as { children?: ReactNode }).children);
    return node;
  };
  const out = split(children);
  return <span className="ws" style={{ '--n': i } as React.CSSProperties}>{out}</span>;
}

function coord(value: number, pos: string, neg: string) { return `${Math.abs(value).toFixed(2)}°${value >= 0 ? pos : neg}`; }
function latLon(lang: Lang, lat: number, lon: number) {
  return lang === 'ru' ? `${coord(lat, ' с.ш.', ' ю.ш.')} · ${coord(lon, ' в.д.', ' з.д.')}` : `${coord(lat, 'N', 'S')} · ${coord(lon, 'E', 'W')}`;
}
const pct = (v: number) => `${Math.round(v * 100)}`;

/** Fades and lifts elements tagged with data-reveal as they enter the viewport. */
function useReveal(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const host = root.current; if (!host) return;
    const nodes = Array.from(host.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (typeof IntersectionObserver === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { nodes.forEach(n => n.classList.add('is-in')); return; }
    const io = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -12% 0px', threshold: .08 });
    nodes.forEach(n => io.observe(n));
    return () => io.disconnect();
  }, [root]);
}

/** Slow parallax on full-bleed plates; disabled for reduced motion. */
function useParallax(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const host = root.current; if (!host || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const plates = Array.from(host.querySelectorAll<HTMLElement>('[data-parallax]'));
    let frame = 0;
    const tick = () => {
      frame = 0; const vh = window.innerHeight;
      for (const p of plates) {
        const r = p.parentElement!.getBoundingClientRect();
        if (r.bottom < 0 || r.top > vh) continue;
        const progress = (r.top + r.height / 2 - vh / 2) / (vh + r.height);
        p.style.transform = `translate3d(0, ${(progress * Number(p.dataset.parallax)).toFixed(1)}px, 0) scale(1.08)`;
      }
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(tick); };
    tick(); window.addEventListener('scroll', onScroll, { passive: true }); window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); if (frame) cancelAnimationFrame(frame); };
  }, [root]);
}

function Spec({ label, children }: { label: string; children: ReactNode }) {
  return <div className="hm-spec"><dt>{label}</dt><dd>{children}</dd></div>;
}

function siteName(data: AppData, id: string) {
  const tile = data.candidates.tiles.find(t => t.id === id);
  return (tile?.name ?? id).replace(/ regional window$/i, '');
}
function bestCampaign(run: Run | undefined) {
  if (!run?.campaigns.length) return null;
  return run.campaigns.reduce((a, b) => (b.k > a.k ? b : a));
}

/** Which motion each element gets, by its role on the page. */
function motionFor(el: HTMLElement, i: number): string {
  if (el.querySelector('.ws')) return 'text';
  if (el.matches('.eg-eyebrow')) return 'left';
  if (el.matches('.hm-statement')) return 'depth';
  if (el.matches('.hm-target-figure')) return 'door';
  if (el.matches('.hm-steps li, .hm-result, .hm-specs')) return 'flip';
  if (el.matches('.hm-ledger li')) return i % 2 ? 'right' : 'left-far';
  if (el.matches('h2')) return 'tilt';
  return 'rise';
}

/** Spatial scroll: inertial smooth scrolling; pinned film plates follow the scroll frame by frame;
 *  every content element moves through the scene in its own way as it arrives and leaves.
 *  Off for reduced motion (then the page is plain and still). */
function useSpatial(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const host = root.current; if (!host || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    // inertial scrolling: wheel and trackpad glide instead of stepping
    const lenis = new Lenis({ duration: .9, smoothWheel: true, autoRaf: true });
    // assign motions once; the ledger alternates sides
    const movers = Array.from(host.querySelectorAll<HTMLElement>('[data-reveal]')).filter(el => !el.closest('.hm-hero'));
    let ledger = 0, heading = 0;
    // headings each get a different word choreography, in turn
    const TEXT = ['wave', 'blur', 'swing', 'drop', 'zoom', 'spread'];
    movers.forEach(el => { const m = motionFor(el, el.matches('.hm-ledger li') ? ledger++ : 0); el.dataset.sp = m; if (m === 'text') el.dataset.tv = TEXT[heading++ % TEXT.length]; });
    const film = Array.from(host.querySelectorAll<HTMLVideoElement>('video[data-film]'));
    let filmSp = -1, shown = 0;
    let raf = 0, last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(.05, (now - last) / 1000); last = now; const vh = window.innerHeight;
      for (const el of movers) {
        const r = el.getBoundingClientRect(); if (r.top > vh * 1.15 || r.bottom < -vh * .15) continue;
        // starts the moment it shows at the bottom edge, done by the lower third: never late
        el.style.setProperty('--sp', clamp((vh * 1.02 - r.top) / (vh * .36)).toFixed(3));
        el.style.setProperty('--sx', clamp((vh * .1 - r.bottom) / (vh * .25)).toFixed(3));
      }
      // ---------- the film: the page scroll is the flight; one clip per stretch between anchors ----------
      if (film.length) {
        const y = window.scrollY;
        const anchors = [0, ...Array.from(host.querySelectorAll<HTMLElement>('[data-film-anchor]')).map(e => e.getBoundingClientRect().top + y - vh * .6)];
        const n = Math.min(film.length, anchors.length - 1);
        let k = n - 1; for (let j = 0; j < n; j++) if (y < anchors[j + 1]) { k = j; break; }
        const pos = k + clamp((y - anchors[k]) / Math.max(1, anchors[k + 1] - anchors[k]));
        filmSp = filmSp < 0 ? pos : filmSp + (pos - filmSp) * (1 - Math.exp(-dt * 12));
        const ci = Math.min(n - 1, Math.floor(filmSp)); const ct = filmSp - ci;
        if (ci !== shown) { film[shown].style.opacity = '0'; film[ci].style.opacity = '1'; shown = ci; }
        film.forEach((v, j) => { if (Math.abs(j - ci) <= 1 && v.preload !== 'auto') { v.preload = 'auto'; v.load(); } if (!v.paused) v.pause(); });
        const v = film[ci];
        if (v.readyState >= 2 && v.duration) {
          // one seek at a time: queued seeks are what makes scrubbing stutter
          const t = ct * (v.duration - .05);
          if (!v.seeking && Math.abs(v.currentTime - t) > 1 / 60) v.currentTime = t;
        }
        host.style.setProperty('--film', (filmSp / n).toFixed(4));
        // flight computer
        const hud = host.querySelector<HTMLElement>('.hm-hud');
        if (hud) {
          const lang = (document.documentElement.lang || 'en').startsWith('ru') ? 'ru' : 'en';
          const twin: Place = hud.dataset.twin ? JSON.parse(hud.dataset.twin) : { body: 'earth', en: 'Earth', ru: 'Земля' };
          const { place, alt } = telemetry(ci, ct, twin);
          const sec = (ci + ct) * 7.92;
          const set = (k: string, v: string) => { const e = hud.querySelector<HTMLElement>(`[data-hud="${k}"]`); if (e && e.textContent !== v) e.textContent = v; };
          set('body', bodyName(place.body, lang)); set('place', lang === 'ru' ? place.ru : place.en); set('coord', fmtCoord(place, lang));
          set('alt', fmtAlt(alt, lang)); set('tc', timecode(sec)); set('frame', String(Math.round(sec * 24)).padStart(4, '0'));
          if (hud.dataset.body !== place.body) { hud.dataset.body = place.body; host.dataset.body = place.body; }
        }
      }
      { // letterbox opens with the first scroll; the HUD and path step back for the footer
        const y = window.scrollY;
        host.style.setProperty('--bars', (1 - smoothstep(y / (vh * .35))).toFixed(3));
        const foot = host.querySelector<HTMLElement>('.hm-footer');
        const fr = foot ? foot.getBoundingClientRect().top : vh * 9;
        // the hero has its own panel on the right: the flight computer arrives once the hero is leaving
        host.style.setProperty('--hud', Math.min(smoothstep((y - vh * .5) / (vh * .3)), smoothstep((fr - vh * .45) / (vh * .4))).toFixed(3));
      }
      const foot = host.querySelector<HTMLElement>('[data-spatial-footer]');
      if (foot) { const r = foot.getBoundingClientRect(); foot.style.setProperty('--set', clamp((vh - r.top) / (r.height + vh * .2)).toFixed(3)); }
    };
    host.classList.add('is-spatial');
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); lenis.destroy(); host.classList.remove('is-spatial'); movers.forEach(el => { delete el.dataset.sp; }); };
  }, [root]);
}

export function HomePage() {
  const lang = useLanguage(s => s.language) as Lang;
  const { data, navigate, setTarget } = useAppStore();
  const root = useRef<HTMLElement>(null);
  const [destination, setDestination] = useState<'moon' | 'mars'>('moon');
  const [mode, setMode] = useState<Mode>('rover');
  const [params, setParams] = useState<Record<string, number>>(() => defaultsFor('rover'));
  const chooseMode = (next: Mode) => { setMode(next); setParams(defaultsFor(next)); };
  useReveal(root); useParallax(root); useSpatial(root);
  if (!data) return null;

  const moon = data.targets.targets.find(t => t.body === 'moon' && t.kind !== 'validation_only') ?? data.targets.targets.find(t => t.body === 'moon');
  const mars = data.targets.targets.find(t => t.body === 'mars' && t.kind !== 'validation_only') ?? data.targets.targets.find(t => t.body === 'mars');
  const runFor = (t?: Target) => t && data.results.runs.find(r => r.target === t.id);
  const templateFor = (t?: Target) => t && data.templates.templates.find(tp => t.templates.includes(tp.id));
  const moonRun = runFor(moon), marsRun = runFor(mars);
  const moonCampaign = bestCampaign(moonRun), marsCampaign = bestCampaign(marsRun);
  const marsTwinId = (marsRun?.campaigns.find(c => c.k === 1) ?? marsRun?.campaigns[0])?.sites[0]?.id;
  const marsTwinName = marsTwinId ? tr(siteName(data, marsTwinId)) : null;
  const marsTwinTile = marsTwinId ? data.candidates.tiles.find(tl => tl.id === marsTwinId) : undefined;
  const marsTwinPlace: Place | null = marsTwinTile ? { body: 'earth', en: siteName(data, marsTwinId!), ru: tr(siteName(data, marsTwinId!)), lat: marsTwinTile.lat, lon: marsTwinTile.lon } : null;
  const tiles = data.candidates.tiles.filter(t => t.pool !== 'control').length;
  const gapRows = Array.from(new Map([...(moonRun?.gaps.physical ?? []), ...(marsRun?.gaps.physical ?? [])].map(g => [g.gap, g])).values());
  const synthetic = hasSyntheticData(data);
  const currentTarget = destination === 'mars' ? mars : moon;
  const open = (route: Route, target?: Target) => { if (target) setTarget(target.id); navigate(route); };
  const startExpedition = (autorun: boolean) => {
    const overrides: LaunchOverrides = {};
    for (const p of PARAMS[mode]) {
      const group = (overrides[p.group] ??= {}) as Record<string, number>;
      group[p.key] = paramValue(p, params);
    }
    setLaunchIntent(mode, overrides, autorun);
    open('lab', destination === 'mars' ? mars : moon);
  };

  const tools: { route: Route; title: string; ru: string; text: string; textRu: string }[] = [
    { route: 'planet', title: 'Planetary Studio', ru: 'Планетарная студия', text: 'One investigation from start to finish: discover, inspect, simulate, compare, decide.', textRu: 'Одно исследование от начала до конца: найти, изучить, смоделировать, сравнить, решить.' },
    { route: 'discover', title: 'Discover', ru: 'Поиск аналогов', text: 'Search the whole Earth for analogue ground, and ask the assistant in plain words.', textRu: 'Поиск аналогов по всей Земле — и ассистент, которому можно задать вопрос словами.' },
    { route: 'astral', title: 'Mission Studio', ru: 'Студия миссий', text: 'Measured Jezero ground: terrain units, science targets and a rover you can plan.', textRu: 'Измеренный грунт Езеро: типы рельефа, научные цели и ровер, которым можно управлять.' },
    { route: 'studio', title: 'Lunar World', ru: 'Lunar World', text: 'One workspace where the measured world, the intelligence layer and the simulator share state.', textRu: 'Одно пространство, где измеренный мир, слой анализа и симулятор работают вместе.' },
    { route: 'lab', title: 'Engineering lab', ru: 'Инженерная лаборатория', text: 'Drive, launch and land on measured terrain, and read every number the run produces.', textRu: 'Ведите ровер, запускайте и сажайте аппараты на измеренном рельефе — и видьте каждую цифру.' },
    { route: 'campaign', title: 'Field campaign', ru: 'Полевая кампания', text: 'Choose what the crew must practise. Get the fewest places on Earth that cover it.', textRu: 'Выберите, что нужно отработать, — и получите минимум мест на Земле, где это возможно.' },
    { route: 'atlas', title: 'Transferability', ru: 'Переносимость', text: 'How much of a rehearsal carries over to the real mission — and what would raise it.', textRu: 'Сколько от репетиции переносится на настоящую миссию — и что это повысит.' },
    { route: 'evidence', title: 'Sources & limits', ru: 'Источники и пределы', text: 'Where every number comes from, how it will be tested, and what it cannot tell you.', textRu: 'Откуда каждая цифра, как её будут проверять и о чём она умалчивает.' },
    { route: 'twin', title: 'Same Sun', ru: 'Под одним Солнцем', text: 'A target and its Earth stand-in side by side, under the same sunlight.', textRu: 'Цель и её земной двойник рядом — под одним и тем же Солнцем.' },
  ];

  return <main ref={root} className="hm" aria-labelledby="hm-title">
    {/* one continuous film behind the page: scrolling flies the camera forward, scrolling back flies it back */}
    <div className="hm-film" aria-hidden="true">
      {FILM.map((base, i) => <video key={base} data-film={i} muted playsInline preload={i < 2 ? 'auto' : 'none'} poster={asset(`media/cinematic/${base}.jpg`)} src={asset(`media/cinematic/${base}-${CLIP_RES}.mp4`)} style={{ opacity: i === 0 ? 1 : 0 }} />)}
      <span className="hm-veo">{L(lang, 'AI-generated (Veo) — illustration, not data', 'создано ИИ (Veo) — иллюстрация, не данные')}</span>
    </div>
    {/* letterbox: the film opens up with the first scroll */}
    <div className="hm-bars" aria-hidden="true"><i /><i /></div>
    {/* flight computer: where the camera is, as the scroll flies it */}
    <div className="hm-hud" aria-hidden="true" data-body="moon" data-twin={marsTwinPlace ? JSON.stringify(marsTwinPlace) : ''}>
      <div className="hm-hud-body"><i /><span data-hud="body">{bodyName('moon', lang)}</span></div>
      <div className="hm-hud-place" data-hud="place">{L(lang, MOUTON.en, MOUTON.ru)}</div>
      <dl>
        <div><dt>{L(lang, 'Position', 'Координаты')}</dt><dd data-hud="coord">{fmtCoord(MOUTON, lang)}</dd></div>
        <div><dt>{L(lang, 'Camera alt.', 'Высота камеры')}</dt><dd data-hud="alt">60 {L(lang, 'km', 'км')}</dd></div>
        <div><dt>{L(lang, 'Film', 'Плёнка')}</dt><dd><span data-hud="tc">00:00:00</span> · <span data-hud="frame">0000</span></dd></div>
      </dl>
    </div>
    {/* the trajectory */}
    <div className="hm-path" aria-hidden="true">
      <div className="hm-path-line"><i /></div>
      {[[0, L(lang, 'Moon', 'Луна')], [1.5, L(lang, 'Earth', 'Земля')], [2.5, L(lang, 'Moon', 'Луна')], [4, L(lang, 'Mars', 'Марс')], [5.6, L(lang, 'Earth', 'Земля')], [6.6, L(lang, 'Orbit', 'Орбита')]].map(([at, label], i) =>
        <span key={i} className="hm-node" title={String(label)} style={{ top: `${(Number(at) / FILM.length) * 100}%` }}><b /></span>)}
    </div>
    {/* 01 — Hero */}
    <section className="hm-hero">
      <div className="hm-hero-shade" aria-hidden="true" />
      <div className="hm-hero-grid">
        <div className="hm-hero-copy">
          <p className="eg-eyebrow hm-rise" style={{ '--d': '120ms' } as React.CSSProperties}><Decode text={L(lang, 'Egiz · Training grounds for the Moon and Mars', 'Egiz · Земные полигоны для Луны и Марса')} on delay={200} speed={16} /></p>
          <h1 id="hm-title" className="eg-display hm-hero-title">
            <span className="hm-line hm-line-decode"><Decode key={destination} text={destination === 'mars' ? L(lang, 'Mars', 'Марс') : L(lang, 'The Moon', 'Луна')} on delay={300} speed={34} /></span>
            <span className="hm-line hm-line-decode"><Decode text={L(lang, 'starts', 'начинается')} on delay={520} speed={30} /></span>
            <span className="hm-line hm-line-decode"><Decode text={L(lang, 'here.', 'здесь.')} on delay={760} speed={34} /></span>
          </h1>
          <p className="hm-hero-lede hm-rise" style={{ '--d': '600ms' } as React.CSSProperties}>{L(lang,
            'Every step on another world is rehearsed on this one first. Egiz finds the ground on Earth that comes closest — and says plainly what no place on Earth can teach.',
            'Каждый шаг по другому миру сначала репетируют на этом. Egiz находит на Земле самый близкий грунт — и прямо говорит, чему Земля не научит никогда.')}</p>
          {currentTarget && <p className="hm-hero-coord hm-rise" style={{ '--d': '760ms' } as React.CSSProperties}><span>{currentTarget.name.split(/[/,]/)[0].trim()}</span>{latLon(lang, currentTarget.lat, currentTarget.lon)}</p>}
        </div>

        <aside className="hm-panel hm-rise" style={{ '--d': '520ms' } as React.CSSProperties} aria-label={L(lang, 'New mission', 'Новая миссия')}>
          <p className="hm-panel-kicker">{L(lang, 'New mission', 'Новая миссия')}</p>

          <div className="hm-dest" role="radiogroup" aria-label={L(lang, 'Destination', 'Цель')}>
            {([['moon', moon, L(lang, 'Moon', 'Луна')], ['mars', mars, L(lang, 'Mars', 'Марс')]] as const).filter(([, t]) => t).map(([body, , label]) => <button key={body} role="radio" aria-checked={destination === body} onClick={() => setDestination(body)}>
              <DestinationArtwork body={body} sizes="200px" />
              <span>{label}</span>
            </button>)}
          </div>

          <p className="hm-panel-label">{L(lang, 'Expedition', 'Экспедиция')}</p>
          <div className="hm-exp-list" role="radiogroup" aria-label={L(lang, 'Expedition', 'Экспедиция')}>
            {EXPEDITIONS.map(exp => <button key={exp.mode} role="radio" aria-checked={mode === exp.mode} onClick={() => chooseMode(exp.mode)}>
              <MissionGlyph mode={exp.mode} />
              <span className="hm-exp-title">{L(lang, exp.en, exp.ru)}</span>
            </button>)}
          </div>

          <p className="hm-panel-label">{L(lang, 'Parameters', 'Параметры')}</p>
          <div className="hm-params">
            {PARAMS[mode].map(p => {
              const max = paramMax(p, params);
              const value = paramValue(p, params);
              return <label key={p.key} className="hm-param">
                <span className="hm-param-head"><span>{L(lang, p.en, p.ru)}</span><output>{value.toLocaleString(lang)}<small>{p.unit}</small></output></span>
                <input type="range" min={p.min} max={max} step={p.step} value={value} onChange={e => setParams(v => ({ ...v, [p.key]: Number(e.target.value) }))} style={{ '--fill': `${((value - p.min) / (max - p.min)) * 100}%` } as React.CSSProperties} />
              </label>;
            })}
          </div>

          <button className="eg-button hm-launch-button" onClick={() => startExpedition(true)}>{L(lang, 'Start simulation', 'Запустить моделирование')}<ArrowRight size={16} strokeWidth={1.6} /></button>
          <button className="hm-panel-link" onClick={() => startExpedition(false)}>{L(lang, 'Open the lab without running', 'Открыть лабораторию без запуска')}</button>
        </aside>
      </div>
      <a className="hm-scroll" href="#hm-thesis" aria-label={L(lang, 'Scroll to story', 'Прокрутить вниз')}><span /></a>
    </section>

    {/* 02 — Thesis */}
    <section id="hm-thesis" className="hm-thesis hm-wrap" data-film-anchor>
      <p className="eg-eyebrow" data-reveal><DecodeView text={L(lang, '01 / The question', '01 / Вопрос')} /></p>
      <h2 className="hm-statement" data-reveal><Words>{L(lang,
        'Before anyone walks on another world, someone has to find where on Earth to practise. That is the problem Egiz solves.',
        'Прежде чем человек ступит на другой мир, кто-то должен найти, где на Земле к этому готовиться. Эту задачу и решает Egiz.')}</Words></h2>
      <div className="hm-thesis-cols">
        <p data-reveal>{L(lang,
          `${tiles.toLocaleString(lang)} places on Earth, measured against what the mission demands. Out come the one, two or three that cover the most.`,
          `${tiles.toLocaleString(lang)} мест на Земле — против того, что требует миссия. На выходе одна, две или три площадки, которые покрывают больше всего.`)}</p>
        <p data-reveal>{L(lang,
          'And what no place on Earth can give is written down too — with the laboratory that can.',
          'А то, чего не даст ни одно место на Земле, тоже записано — вместе с лабораторией, которая сможет.')}</p>
      </div>
      {synthetic && <p className="hm-note" data-reveal>{L(lang, 'Showing synthetic demo data — not NASA observations.', 'Показаны синтетические демо-данные — не наблюдения NASA.')}</p>}
    </section>

    {/* Film — the stand-in: the same light on another world */}
    <section className="hm-plate hm-window" aria-labelledby="hm-twin">
      <div className="hm-plate-copy hm-wrap">
        <p className="eg-eyebrow" data-reveal><DecodeView text={L(lang, 'The stand-in', 'Двойник')} /></p>
        <h2 id="hm-twin" className="eg-display hm-h2" data-reveal><Words>{L(lang, 'This is not the Moon.', 'Это не Луна.')}</Words></h2>
        <p className="hm-body" data-reveal>{L(lang, 'It is Death Valley. The same low light, the same broken ground — and it is a drive away.', 'Это Долина Смерти. Тот же низкий свет, тот же изломанный грунт — и до него можно доехать.')}</p>
      </div>
    </section>

    {/* 03 — Moon target, measured */}
    {moon && <section className="hm-target hm-wrap" aria-labelledby="hm-moon" data-film-anchor>
      <figure className="hm-target-figure" data-reveal>
        <div className="hm-target-image">
          <img src={asset('hero/mons-mouton-hillshade-1600.jpg')} srcSet={`${asset('hero/mons-mouton-hillshade-800.jpg')} 800w, ${asset('hero/mons-mouton-hillshade-1600.jpg')} 1600w`} sizes="(max-width: 900px) 100vw, 50vw" width={1600} height={1600} alt={L(lang, 'Hillshade of the measured Mons Mouton terrain, 4 by 4 kilometres, lit by a low sun.', 'Теневая отмывка измеренного рельефа Монс-Мутон, 4 на 4 километра, при низком Солнце.')} loading="lazy" decoding="async" />
          <span className="hm-scale" aria-hidden="true"><i />1 km</span>
        </div>
        <figcaption className="eg-eyebrow">{L(lang, 'Measured, not illustrated — PGDA LOLA terrain, 10 m posts, 4 × 4 km', 'Измерено, а не нарисовано — рельеф PGDA LOLA, шаг 10 м, 4 × 4 км')}</figcaption>
      </figure>
      <div className="hm-target-copy">
        <p className="eg-eyebrow" data-reveal><DecodeView text={L(lang, '02 / Destination — Moon', '02 / Цель — Луна')} /></p>
        <h2 id="hm-moon" className="eg-display hm-h2" data-reveal><Words>Mons Mouton</Words></h2>
        <p className="hm-body" data-reveal>{L(lang,
          'A mountain near the lunar south pole and a candidate Artemis region. The Sun never rises more than a few degrees; shadows run for kilometres.',
          'Гора у южного полюса Луны и район-кандидат программы Artemis. Солнце не поднимается выше нескольких градусов, тени тянутся на километры.')}</p>
        <dl className="hm-specs" data-reveal>
          <Spec label={L(lang, 'Position', 'Координаты')}>{latLon(lang, moon.lat, moon.lon)}</Spec>
          <Spec label={L(lang, 'Terrain', 'Рельеф')}>{moon.dem_product}</Spec>
          <Spec label={L(lang, 'Fine baseline', 'Малая база')}>{moon.fine_baseline_m} m</Spec>
          {moon.h_max_deg != null && <Spec label={L(lang, 'Max sun elevation', 'Макс. высота Солнца')}>{moon.h_max_deg.toFixed(1)}°</Spec>}
          {templateFor(moon) && <Spec label={L(lang, 'Objectives', 'Цели')}>{templateFor(moon)!.objectives.length}</Spec>}
        </dl>
        <button className="eg-button" data-reveal onClick={() => open('lab', moon)}>{L(lang, 'Explore the terrain', 'Изучить рельеф')}<ArrowRight size={16} strokeWidth={1.6} /></button>
      </div>
    </section>}

    {/* 04 — Mars target, full bleed */}
    {mars && <section className="hm-plate hm-window" aria-labelledby="hm-mars" data-film-anchor>
      <div className="hm-plate-copy hm-wrap">
        <p className="eg-eyebrow" data-reveal><DecodeView text={L(lang, '03 / Destination — Mars', '03 / Цель — Марс')} /></p>
        <h2 id="hm-mars" className="eg-display hm-h2 hm-h2-xl" data-reveal><Words>{L(lang, 'Jezero', 'Езеро')}</Words></h2>
        <p className="hm-body" data-reveal>{L(lang,
          'An ancient lake delta and the Perseverance landing site — the reference for rover routes, field geology and sample work.',
          'Древняя дельта озера и место посадки Perseverance — эталон для маршрутов ровера, полевой геологии и работы с образцами.')}</p>
        <dl className="hm-specs hm-specs-row" data-reveal>
          <Spec label={L(lang, 'Position', 'Координаты')}>{latLon(lang, mars.lat, mars.lon)}</Spec>
          <Spec label={L(lang, 'Terrain', 'Рельеф')}>{mars.dem_product}</Spec>
          <Spec label={L(lang, 'Fine baseline', 'Малая база')}>{mars.fine_baseline_m} m</Spec>
        </dl>
        <button className="eg-button" data-reveal onClick={() => open('campaign', mars)}>{L(lang, 'Plan a Mars campaign', 'Спланировать кампанию')}<ArrowRight size={16} strokeWidth={1.6} /></button>
      </div>
    </section>}

    {/* Film — Mars becomes its Earth twin */}
    {mars && <section className="hm-plate hm-window" aria-labelledby="hm-mars-twin" data-film-anchor>
      <div className="hm-plate-copy hm-wrap">
        <p className="eg-eyebrow" data-reveal><DecodeView text={L(lang, 'The twin of Mars', 'Двойник Марса')} /></p>
        <h2 id="hm-mars-twin" className="eg-display hm-h2" data-reveal><Words>{L(lang, 'Mars has a twin here.', 'У Марса есть двойник здесь.')}</Words></h2>
        {marsTwinName && <p className="hm-body" data-reveal>{L(lang, `${marsTwinName}. Found from measured slopes and relief, not by eye.`, `${marsTwinName}. Это место нашли по измеренным уклонам и рельефу, а не на глаз.`)}</p>}
      </div>
    </section>}

    {/* 05 — Method & the live result */}
    <section className="hm-method hm-wrap" aria-labelledby="hm-method" data-film-anchor>
      <div className="hm-method-head">
        <p className="eg-eyebrow" data-reveal><DecodeView text={L(lang, '04 / Method', '04 / Метод')} /></p>
        <h2 id="hm-method" className="eg-display hm-h2" data-reveal><Words>{L(lang, 'Ask. Search. Tell the truth.', 'Спросить. Найти. Сказать правду.')}</Words></h2>
      </div>
      <ol className="hm-steps">
        <li data-reveal><span className="hm-step-n">01</span><h3>{L(lang, 'Ask', 'Спросить')}</h3><p>{L(lang, 'Pick a mission template. Each objective names the terrain, light and thermal conditions it needs, on a fine and a 2 km baseline.', 'Выберите шаблон миссии. Каждая цель задаёт нужный рельеф, освещение и температуру — на малой базе и на базе 2 км.')}</p></li>
        <li data-reveal><span className="hm-step-n">02</span><h3>{L(lang, 'Search', 'Найти')}</h3><p>{L(lang, `Score ${tiles.toLocaleString(lang)} Earth tiles, then search exactly for the k = 1–3 site campaign with the highest coverage.`, `Оценить ${tiles.toLocaleString(lang)} земных участков и точно найти кампанию из k = 1–3 площадок с наибольшим покрытием.`)}</p></li>
        <li data-reveal><span className="hm-step-n">03</span><h3>{L(lang, 'Tell the truth', 'Сказать правду')}</h3><p>{L(lang, 'Report the ceiling Earth can reach for each objective, and list every condition that has to move to a lab.', 'Показать предел, которого Земля достигает по каждой цели, и перечислить всё, что придётся перенести в лабораторию.')}</p></li>
      </ol>
      <div className="hm-results">
        {[{ t: moon, c: moonCampaign }, { t: mars, c: marsCampaign }].filter(x => x.t && x.c).map(({ t, c }) => <article key={t!.id} className="hm-result" data-reveal>
          <header><p className="eg-eyebrow">{t!.body === 'moon' ? L(lang, 'Moon base', 'База на Луне') : L(lang, 'Mars surface', 'Поверхность Марса')} · k = {c!.k}</p><h3>{t!.name.split(/[/,]/)[0].trim()}</h3></header>
          <p className="hm-result-figure"><span className="eg-display">{pct(c!.coverage)}</span><span className="hm-result-unit">%<br />{L(lang, 'coverage', 'покрытие')}</span></p>
          <div className="hm-bar" aria-hidden="true"><i style={{ '--w': c!.coverage } as React.CSSProperties} /></div>
          <ul className="hm-sites">{c!.sites.map(s => <li key={s.id}>{tr(siteName(data, s.id))}</li>)}</ul>
        </article>)}
      </div>
      <p className="hm-footnote" data-reveal>{L(lang,
        `Results from the ${synthetic ? 'synthetic demo' : 'measured-terrain pilot'} dataset, engine ${data.results.engine_version}. Exploratory and unvalidated — the low lunar coverage is the finding, not an error.`,
        `Результаты набора данных «${synthetic ? 'синтетическое демо' : 'пилот на измеренном рельефе'}», движок ${data.results.engine_version}. Предварительно и без валидации — низкое покрытие для Луны и есть вывод, а не ошибка.`)}</p>
    </section>

    {/* 05 — Intelligence */}
    <section className="hm-method hm-ai hm-wrap" aria-labelledby="hm-ai">
      <div className="hm-method-head">
        <p className="eg-eyebrow" data-reveal><DecodeView text={L(lang, '05 / Intelligence', '05 / Интеллект')} /></p>
        <h2 id="hm-ai" className="eg-display hm-h2" data-reveal><Words>{L(lang, 'Ask in words. Get answers from data.', 'Спросите словами. Ответ — из данных.')}</Words></h2>
      </div>
      <ol className="hm-steps">
        <li data-reveal><span className="hm-step-n">01</span><h3>{L(lang, 'An assistant that cannot make numbers up', 'Ассистент, который не выдумывает цифры')}</h3><p>{L(lang, 'Ask Discover a question in plain words. It calls the search tools itself, and every number in the answer comes from those tools — never from the model.', 'Спросите Discover обычными словами. Он сам вызывает инструменты поиска, и каждая цифра в ответе берётся из них — не из модели.')}</p></li>
        <li data-reveal><span className="hm-step-n">02</span><h3>{L(lang, 'Terrain it reads on its own', 'Рельеф, который он читает сам')}</h3><p>{L(lang, 'In Mission Studio a model with no labelled training data maps terrain units on measured Jezero ground and points to places worth a closer look — as hypotheses, not findings.', 'В Студии миссий модель без размеченных обучающих данных делит измеренный грунт Езеро на типы рельефа и указывает места, на которые стоит посмотреть, — как гипотезы, а не находки.')}</p></li>
        <li data-reveal><span className="hm-step-n">03</span><h3>{L(lang, 'A ranking you can open up', 'Рейтинг, который можно разобрать')}</h3><p>{L(lang, 'The machine-learning ranking of candidate sites is transparent: each score breaks into its components, with a check of how stable it is.', 'ML-рейтинг площадок прозрачен: каждая оценка раскладывается на составляющие, и проверено, насколько она устойчива.')}</p></li>
      </ol>
      <div className="hm-actions" data-reveal>
        <button className="eg-button" onClick={() => open('discover')}>{L(lang, 'Ask Discover', 'Спросить Discover')}<ArrowRight size={16} strokeWidth={1.6} /></button>
        <button className="eg-button quiet" onClick={() => open('astral')}><span>{L(lang, 'Open Mission Studio', 'Открыть Студию миссий')}</span></button>
      </div>
    </section>

    {/* 06 — What Earth cannot test */}
    {gapRows.length > 0 && <section className="hm-gaps hm-wrap" aria-labelledby="hm-gaps">
      <div className="hm-gaps-head">
        <p className="eg-eyebrow" data-reveal><DecodeView text={L(lang, '06 / Gap ledger', '06 / Реестр пробелов')} /></p>
        <h2 id="hm-gaps" className="eg-display hm-h2" data-reveal><Words>{L(lang, 'Where Earth runs out.', 'Где Земля заканчивается.')}</Words></h2>
        <p className="hm-body" data-reveal>{L(lang, 'No desert lowers gravity. No glacier is a vacuum. Egiz names every gap — and the facility that closes it.', 'Ни одна пустыня не ослабит гравитацию. Ни один ледник не станет вакуумом. Egiz называет каждый пробел — и установку, которая его закроет.')}</p>
      </div>
      <ol className="hm-ledger">
        {gapRows.map((g, i) => <li key={g.gap} data-reveal>
          <span className="hm-ledger-n">{String(i + 1).padStart(2, '0')}</span>
          <strong>{tr(g.gap)}</strong>
          <span className="hm-ledger-alt">{tr(g.alternative)}</span>
        </li>)}
      </ol>
    </section>}

    {/* 07 — Earth */}
    <section className="hm-plate hm-window hm-window-top" aria-labelledby="hm-earth" data-film-anchor>
      <div className="hm-plate-copy hm-wrap">
        <p className="eg-eyebrow" data-reveal><DecodeView text={L(lang, '07 / Built in Astana', '07 / Сделано в Астане')} /></p>
        <h2 id="hm-earth" className="eg-display hm-h2 hm-h2-xl" data-reveal><Words>{L(lang, <>Earth first.<br />Then everything else.</>, <>Сначала Земля.<br />Потом — всё остальное.</>)}</Words></h2>
        <div className="hm-actions" data-reveal>
          <button className="eg-button" onClick={() => open('campaign')}>{L(lang, 'Design a campaign', 'Создать кампанию')}<ArrowRight size={16} strokeWidth={1.6} /></button>
        </div>
      </div>
    </section>

    {/* 08 — Index of workspaces */}
    <section className="hm-index hm-wrap" aria-labelledby="hm-index">
      <div className="hm-index-head">
        <p className="eg-eyebrow" data-reveal><DecodeView text={L(lang, '08 / Workspaces', '08 / Разделы')} /></p>
        <h2 id="hm-index" className="eg-display hm-h2" data-reveal><Words>{L(lang, 'Everything a mission needs.', 'Всё, что нужно миссии.')}</Words></h2>
      </div>
      <ul className="hm-index-list">
        {tools.map((tool, i) => <li key={tool.route} data-reveal>
          <button onClick={() => open(tool.route)}>
            <span className="hm-index-n">{String(i + 1).padStart(2, '0')}</span>
            <span className="hm-index-title">{L(lang, tool.title, tool.ru)}</span>
            <span className="hm-index-text">{L(lang, tool.text, tool.textRu)}</span>
            <ArrowUpRight className="hm-index-arrow" size={22} strokeWidth={1.4} aria-hidden="true" />
          </button>
        </li>)}
      </ul>
    </section>

    <footer className="hm-footer" data-spatial-footer data-film-anchor>
      <div className="hm-foot-line hm-wrap">
        <span className="hm-foot-word eg-display">Egiz</span>
        <button className="hm-foot-top" onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })}>{L(lang, 'Back to the Moon', 'Обратно к Луне')}<span aria-hidden="true">↑</span></button>
      </div>
      <div className="hm-foot-fine hm-wrap">
        <span>© 2026 Egiz</span>
        <span>{L(lang, 'Independent student project for NASA Space Apps Challenge 2026. Not affiliated with or endorsed by NASA.', 'Независимый студенческий проект для NASA Space Apps Challenge 2026. Не связан с NASA и не одобрен NASA.')}</span>
        <span>{L(lang, 'Films are illustrative, generated with Veo; terrain from NASA PGDA. Visual context only — never solver input.', 'Фильмы — иллюстрация, созданная в Veo; рельеф — NASA PGDA. Только визуальный контекст, не входные данные расчёта.')}</span>
        <button className="eg-button quiet" onClick={() => open('evidence')}><span>{L(lang, 'Sources & limits', 'Источники и ограничения')}</span></button>
      </div>
    </footer>
  </main>;
}
