// "Same ground, two planets": point at Mars (or the Moon), watch EGIZ search Earth, and compare the
// ground there with the ground here. Every number is read from the loaded dataset; nothing is invented.
// AI-assisted implementation; human review pending.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t as tr } from '../../i18n';
import type { AppData, AttrKey, EarthTile, Run, Target } from '../../types/contracts';
import type { CinemaAsset } from '../cinema/cinema';
import { OrthoGlobe } from './OrthoGlobe';
import './match.css';

type Lang = 'en' | 'ru';
const L = <T,>(lang: Lang, en: T, ru: T) => (lang === 'ru' ? ru : en);
const BASE = import.meta.env.BASE_URL;

interface Row { key: AttrKey; en: string; ru: string; unit: string; scale?: number; earthLimit?: boolean }
const ROWS: Row[] = [
  { key: 'slope_f100_p50_deg', en: 'Typical slope · 100 m', ru: 'Типичный уклон · 100 м', unit: '°' },
  { key: 'slope_f400_p90_deg', en: 'Steepest tenth · 400 m', ru: 'Самые крутые 10 % · 400 м', unit: '°' },
  { key: 'tri_f100_m', en: 'Roughness · 100 m', ru: 'Шероховатость · 100 м', unit: ' m' },
  { key: 'frac_lt20_f100', en: 'Ground gentler than 20°', ru: 'Грунт положе 20°', unit: ' %', scale: 100 },
  { key: 'relief_m', en: 'Relief', ru: 'Перепад высот', unit: ' m' },
  { key: 't_min_c', en: 'Coldest', ru: 'Минимум температуры', unit: ' °C', earthLimit: true },
  { key: 'precip_mm', en: 'Rain per year', ru: 'Осадки за год', unit: ' mm', earthLimit: true },
];

/** Equirectangular position of a point on a planet map (0..1). */
const uv = (lat: number, lon: number) => ({ u: (lon + 180) / 360, v: (90 - lat) / 180 });
const fmtNum = (v: number, lang: Lang) => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US');

function siteScore(run: Run, id: string) {
  let s = 0, n = 0;
  for (const obj of Object.values(run.fidelity)) { const c = obj[id]; if (c && c.F != null) { s += c.F; n++; } }
  return n ? s / n : null;
}

function PlanetMap({ img, lat, lon, zoom, focus, children, label }: { img: string; lat: number; lon: number; zoom: number; focus: number; children?: React.ReactNode; label: string }) {
  const p0 = uv(lat, lon);
  // keep the zoomed map covering its frame: the focus point may sit off-centre near a pole or edge
  const lim = (x: number) => Math.min(1 - .5 / zoom, Math.max(.5 / zoom, x));
  const p = { u: lim(p0.u), v: lim(p0.v) };
  const style = { '--z': zoom, transform: `translate(-50%, -50%) scale(${zoom}) translate(${((.5 - p.u) * 100 * focus).toFixed(3)}%, ${((.5 - p.v) * 100 * focus).toFixed(3)}%)` } as React.CSSProperties;
  return <div className="mt-map" role="img" aria-label={label}>
    <div className="mt-map-inner" style={style}>
      <img src={img} alt="" draggable={false} />
      {children}
    </div>
  </div>;
}

/** The pointing (S6) and the answer (S7) play back to back when the reel scrolls into view, as one shot. */
function FilmReel({ films, lang }: { films: CinemaAsset[]; lang: Lang }) {
  const [i, setI] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const film = films[Math.min(i, films.length - 1)];
  useEffect(() => {
    const el = host.current; if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => { const v = vid.current; if (!v) return; if (e.isIntersecting && e.intersectionRatio > .55) v.play().catch(() => {}); else v.pause(); }, { threshold: [0, .55, 1] });
    io.observe(el); return () => io.disconnect();
  }, []);
  useEffect(() => { vid.current?.load(); if (i > 0) vid.current?.play().catch(() => {}); }, [i]);
  return <div ref={host} className="mt-film">
    {film.sources.length
      ? <video ref={vid} key={film.id} muted playsInline preload="metadata" poster={film.still ?? undefined} style={{ objectPosition: film.focus }} onEnded={() => setI(n => Math.min(n + 1, films.length - 1))}>{film.sources.map(s => <source key={s.src} src={s.src} type={s.type} />)}</video>
      : <img src={film.still!} alt="" style={{ objectPosition: film.focus }} />}
    <span className="mt-film-credit">{film.id} · {L(lang, 'illustrative film', 'иллюстративный кадр')}</span>
  </div>;
}

export function MatchChapter({ data, lang, films, synthetic, onCover }: { data: AppData; lang: Lang; films: CinemaAsset[]; synthetic: boolean; onCover?: (v: boolean) => void }) {
  const targets = useMemo(() => {
    const pick = (body: 'mars' | 'moon') => data.targets.targets.find(t => t.body === body && t.kind !== 'validation_only') ?? data.targets.targets.find(t => t.body === body);
    return [pick('mars'), pick('moon')].filter(Boolean) as Target[];
  }, [data]);
  const [targetId, setTargetId] = useState(() => targets[0]?.id);
  const target = targets.find(t => t.id === targetId) ?? targets[0];
  const run = data.results.runs.find(r => r.target === target?.id);
  const best = run?.campaigns.find(c => c.k === 1)?.sites[0]?.id ?? run?.campaigns[0]?.sites[0]?.id ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => setPicked(null), [targetId]);
  const siteId = picked ?? best;
  // only places the mission model actually scored: excluded windows (water, snow, controls) stay off the map
  const scores = useMemo(() => new Map(data.candidates.tiles.map(t => [t.id, run ? siteScore(run, t.id) : null])), [data, run]);
  const tiles = useMemo(() => data.candidates.tiles.filter(t => t.pool !== 'control' && scores.get(t.id) != null), [data, scores]);
  const site: EarthTile | undefined = tiles.find(t => t.id === siteId) ?? data.candidates.tiles.find(t => t.id === siteId);
  const template = target && data.templates.templates.find(tp => target.templates.includes(tp.id));

  // ---------- Scroll stages: there → the search → here ----------
  const root = useRef<HTMLElement>(null);
  const [stage, setStage] = useState(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = 0; const el = root.current; if (!el) return;
      const r = el.getBoundingClientRect(); const vh = window.innerHeight;
      const p = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - vh)));
      setStage(p < .3 ? 0 : p < .58 ? 1 : 2);
      onCover?.(r.top < 1 && r.bottom > vh - 1);
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(tick); };
    tick(); window.addEventListener('scroll', on, { passive: true }); window.addEventListener('resize', on);
    return () => { window.removeEventListener('scroll', on); window.removeEventListener('resize', on); if (raf) cancelAnimationFrame(raf); onCover?.(false); };
  }, [onCover]);
  const shown = picked ? 2 : stage;

  // ---------- The thread: drawn between the two markers wherever the maps have put them ----------
  const stageRef = useRef<HTMLDivElement>(null);
  const [thread, setThread] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (shown !== 2) { setThread(null); return; }
    const measure = () => {
      const host = stageRef.current; if (!host) return;
      const a = host.querySelector('.mt-there .mt-point')?.getBoundingClientRect(), b = host.querySelector('.mt-here .mt-dot.is-site')?.getBoundingClientRect(), h = host.getBoundingClientRect();
      if (!a || !b) return;
      const x1 = a.left + a.width / 2 - h.left, y1 = a.top + a.height / 2 - h.top, x2 = b.left + b.width / 2 - h.left, y2 = b.top + b.height / 2 - h.top;
      const bend = Math.min(120, Math.abs(y2 - y1) * .25);
      setThread(`M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${(x1 + bend).toFixed(1)} ${(y1 + (y2 - y1) * .35).toFixed(1)}, ${(x2 + bend).toFixed(1)} ${(y2 - (y2 - y1) * .35).toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`);
    };
    const t = window.setTimeout(measure, 1700); window.addEventListener('resize', measure);
    return () => { window.clearTimeout(t); window.removeEventListener('resize', measure); };
  }, [shown, siteId, targetId]);

  if (!target || !run) return null;
  const isMars = target.body === 'mars';
  const bodyImg = `${BASE}textures/${isMars ? 'mars' : 'moon'}.jpg`;
  const groundImg = isMars ? `${BASE}world/mars-jezero/img/0-0-0.jpg` : `${BASE}hero/mons-mouton-hillshade-800.jpg`;
  const tName = isMars ? L(lang, 'Jezero crater', 'Кратер Езеро') : L(lang, 'Mons Mouton', 'Монс-Мутон');
  const sName = site ? tr((site.name ?? site.id).replace(/ regional window$/i, '')) : '—';
  const score = siteId ? scores.get(siteId) ?? null : null;
  const coord = (lat: number, lon: number) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? L(lang, 'N', ' с.ш.') : L(lang, 'S', ' ю.ш.')} · ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? L(lang, 'E', ' в.д.') : L(lang, 'W', ' з.д.')}`;
  const objectives = template?.objectives ?? [];

  return <section ref={root} className="mt" data-stage={shown} aria-labelledby="mt-title">
    {films.length > 0 && <FilmReel films={films} lang={lang} />}

    <div className="mt-frame">
      <header className="mt-head">
        <p className="wd-kicker">{L(lang, 'Same ground · two planets', 'Одна почва · две планеты')}</p>
        <h2 id="mt-title" className="mt-title">{isMars ? L(lang, 'Point at Mars. Earth answers.', 'Укажите на Марс. Ответит Земля.') : L(lang, 'Point at the Moon. Earth answers.', 'Укажите на Луну. Ответит Земля.')}</h2>
        <div className="mt-targets" role="radiogroup" aria-label={L(lang, 'Where to start', 'С чего начать')}>
          {targets.map(t => <button key={t.id} role="radio" aria-checked={t.id === target.id} onClick={() => setTargetId(t.id)}>{t.body === 'mars' ? L(lang, 'Mars', 'Марс') : L(lang, 'Moon', 'Луна')}</button>)}
        </div>
      </header>

      <div ref={stageRef} className="mt-stage">
        {/* THERE */}
        <figure className="mt-panel mt-there">
          <figcaption><b>{L(lang, 'There', 'Там')}</b><span>{tName}</span><em>{coord(target.lat, target.lon)}</em></figcaption>
          <div className="mt-map">
            <OrthoGlobe key={target.id} src={bodyImg} lat={target.lat} lon={target.lon} zoom={shown === 0 ? 5.5 : 3.2} label={`${tName}, ${isMars ? L(lang, 'Mars', 'Марс') : L(lang, 'Moon', 'Луна')}`} />
            <span className="mt-point" style={{ left: '50%', top: '50%' }}><i /></span>
          </div>
          <div className="mt-ground"><img src={groundImg} alt="" /><span>{isMars ? L(lang, 'Measured ground · 2 × 2 km', 'Измеренный участок · 2 × 2 км') : L(lang, 'Measured relief · 10 m', 'Измеренный рельеф · 10 м')}</span></div>
        </figure>

        {thread && <svg className="mt-thread" aria-hidden="true"><path d={thread} pathLength={1} /></svg>}

        {/* HERE */}
        <figure className="mt-panel mt-here">
          <figcaption><b>{L(lang, 'Here', 'Здесь')}</b><span>{shown === 2 ? sName : shown === 1 ? L(lang, `Searching ${tiles.length} places…`, `Поиск среди ${tiles.length} мест…`) : L(lang, 'Earth', 'Земля')}</span><em>{shown === 2 && site ? coord(site.lat, site.lon) : ' '}</em></figcaption>
          <PlanetMap img={`${BASE}textures/earth.jpg`} lat={site?.lat ?? 0} lon={site?.lon ?? 0} zoom={shown === 2 ? 3.2 : 1} focus={shown === 2 ? 1 : 0} label={L(lang, 'Earth candidate sites', 'Кандидаты на Земле')}>
            {tiles.map(t => { const p = uv(t.lat, t.lon); const s = scores.get(t.id); return <button key={t.id} className={`mt-dot ${t.id === siteId ? 'is-site' : ''}`} style={{ left: `${p.u * 100}%`, top: `${p.v * 100}%`, '--s': s ?? 0 } as React.CSSProperties}
              onClick={() => setPicked(t.id)} aria-label={`${tr((t.name ?? t.id).replace(/ regional window$/i, ''))}${s != null ? ` · ${Math.round(s * 100)}%` : ''}`} tabIndex={shown ? 0 : -1} />; })}
            <span className="mt-scan" aria-hidden="true" />
          </PlanetMap>
          {shown === 2 && score != null && <p className="mt-score"><b>{Math.round(score * 100)}<small>%</small></b><span>{L(lang, 'average fidelity across the mission objectives', 'среднее сходство по целям миссии')}</span></p>}
        </figure>
      </div>

      <div className="mt-story">
        <p className={shown === 0 ? 'is-on' : ''}>{isMars
          ? L(lang, 'Start with one place on Mars: Jezero, where Perseverance landed. Its slopes, roughness and relief are measured from orbit.', 'Начнём с одной точки на Марсе — кратера Езеро, где сел Perseverance. Его уклоны, шероховатость и перепады высот измерены с орбиты.')
          : L(lang, 'Start with one place on the Moon: Mons Mouton near the south pole. Its slopes, roughness and relief are measured by laser.', 'Начнём с одной точки на Луне — горы Монс-Мутон у южного полюса. Её уклоны, шероховатость и перепады высот измерены лазером.')}</p>
        <p className={shown === 1 ? 'is-on' : ''}>{L(lang, `EGIZ reads the same numbers for ${tiles.length} places on Earth and scores every one against what the mission needs. Brighter dots are closer.`, `EGIZ читает те же числа для ${tiles.length} мест на Земле и оценивает каждое по тому, что нужно миссии. Чем ярче точка, тем ближе.`)}</p>
        <p className={shown === 2 ? 'is-on' : ''}>{picked && picked !== best
          ? L(lang, 'Your pick, side by side with the target. Choose another dot, or return to the closest match.', 'Ваш выбор рядом с целью. Выберите другую точку или вернитесь к лучшему совпадению.')
          : L(lang, 'The closest ground on Earth for this mission. Here is where it matches — and where no place on Earth ever can.', 'Самый близкий грунт на Земле для этой миссии. Вот где он совпадает — и где не совпадёт ни одно место на Земле.')}
          {picked && picked !== best && <button className="mt-reset" onClick={() => setPicked(null)}>{L(lang, 'Back to the closest match', 'К лучшему совпадению')}</button>}</p>
      </div>

      {shown === 2 && site && <div className="mt-compare">
        <table>
          <thead><tr><th scope="col">{L(lang, 'Measured', 'Измерено')}</th><th scope="col">{L(lang, 'There', 'Там')}</th><th scope="col" aria-label={L(lang, 'Closeness', 'Близость')} /><th scope="col">{L(lang, 'Here', 'Здесь')}</th></tr></thead>
          <tbody>{ROWS.map(r => {
            const a = target.attrs[r.key], b = site.attrs[r.key];
            if (a == null || b == null) return null;
            const k = r.scale ?? 1; const av = a * k, bv = b * k;
            const close = 1 - Math.min(1, Math.abs(av - bv) / Math.max(Math.abs(av), Math.abs(bv), 1e-6));
            const off = r.earthLimit && close < .5;
            return <tr key={r.key} className={off ? 'is-off' : ''}>
              <th scope="row">{L(lang, r.en, r.ru)}</th>
              <td>{fmtNum(av, lang)}{r.unit}</td>
              <td className="mt-close">{off ? <span className="mt-chip">{L(lang, 'Earth cannot', 'Земле не под силу')}</span> : <span className="mt-bar"><i style={{ '--w': close } as React.CSSProperties} /></span>}</td>
              <td>{fmtNum(bv, lang)}{r.unit}</td>
            </tr>;
          })}</tbody>
        </table>
        {objectives.length > 0 && <ul className="mt-objectives">
          {objectives.map(o => { const c = run.fidelity[o.id]?.[site.id]; const F = c && c.F != null ? c.F : null; return <li key={o.id}>
            <span>{tr(o.name)}</span><span className="mt-bar"><i style={{ '--w': F ?? 0 } as React.CSSProperties} /></span><b>{F == null ? '—' : `${Math.round(F * 100)}%`}</b>
          </li>; })}
        </ul>}
        <p className="mt-note">{synthetic ? L(lang, 'Demo data — invented for illustration. ', 'Демо-данные — придуманы для иллюстрации. ') : ''}{L(lang, 'Closeness bars compare raw values only; the fidelity scores come from the mission model. Cold and rain are listed so the difference is visible, not scored away.', 'Полоски сравнивают только сами значения; оценки сходства даёт модель миссии. Холод и осадки показаны, чтобы разница была видна, а не спрятана.')}</p>
      </div>}
    </div>
  </section>;
}
