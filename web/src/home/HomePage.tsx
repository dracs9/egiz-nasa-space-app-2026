// EGIZ landing: one measured ground that becomes the Moon, Mars and the places on Earth that rehearse them.
// Every figure on this page is read from the loaded dataset; every surface is measured terrain.
// AI-assisted implementation; human review pending.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, ArrowDown, Volume2, VolumeX } from 'lucide-react';
import { t as tr, useLanguage } from '../i18n';
import { useAppStore, type Route } from '../state/store';
import type { AppData, Run, Target } from '../types/contracts';
import { hasSyntheticData } from '../data/load';
import { MissionGlyph } from '../mission/MissionGlyph';
import { setLaunchIntent, type LaunchOverrides } from '../mission/launchIntent';
import type { Mode } from '../mission/types';
import { WorldStage, type StageApi, type Shot, type LabelSpec, type ProbeReadout } from './world/WorldStage';
import type { StageData } from './world/terrainData';
import type { WorldEngine } from './world/engine';
import { Soundscape } from './world/soundscape';
import { CinemaLayer, type CinemaHandle } from './cinema/CinemaLayer';
import type { CinemaAsset } from './cinema/cinema';
import { MatchChapter } from './match/MatchChapter';
import { FilmAct } from './film/FilmAct';
import { Reticle } from './film/Reticle';
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

const EXPEDITIONS: { mode: Mode; en: string; ru: string; noteEn: string; noteRu: string }[] = [
  { mode: 'rover', en: 'Rover traverse', ru: 'Маршрут ровера', noteEn: 'Amber ground is too steep for the rover at the slope you set. The ring is a rough reach for the battery, not a planned route.', noteRu: 'Янтарным отмечен грунт круче заданного предела. Кольцо — примерная дальность на заряде батареи, а не готовый маршрут.' },
  { mode: 'launch', en: 'Launch & ascent', ru: 'Старт и подъём', noteEn: 'The pad sits at the centre of the measured ground. Set thrust, propellant and tilt, then fly it in the lab.', noteRu: 'Площадка стоит в центре измеренного участка. Задайте тягу, топливо и наклон — и запустите в лаборатории.' },
  { mode: 'descent', en: 'Descent & landing', ru: 'Спуск и посадка', noteEn: 'The ellipse widens with speed and starting altitude. It is a sketch of uncertainty, not a computed footprint.', noteRu: 'Эллипс растёт со скоростью и высотой начала спуска. Это набросок неопределённости, а не рассчитанная зона.' },
  { mode: 'eva', en: 'Base & moonwalk', ru: 'База и выход', noteEn: 'Amber ground is too steep to walk safely. The ring is a rough walking reach on the suit energy reserve.', noteRu: 'Янтарным отмечен грунт, по которому опасно идти. Кольцо — примерная дальность пешего выхода на запасе энергии скафандра.' },
];

type Lang = 'en' | 'ru';
const L = <T,>(lang: Lang, en: T, ru: T) => (lang === 'ru' ? ru : en);

function coord(value: number, pos: string, neg: string) { return `${Math.abs(value).toFixed(2)}°${value >= 0 ? pos : neg}`; }
function latLon(lang: Lang, lat: number, lon: number) {
  return lang === 'ru' ? `${coord(lat, ' с.ш.', ' ю.ш.')} · ${coord(lon, ' в.д.', ' з.д.')}` : `${coord(lat, 'N', 'S')} · ${coord(lon, 'E', 'W')}`;
}
const pct = (v: number) => `${Math.round(v * 100)}`;
const shortName = (name: string) => name.split(/[/,]/)[0].trim();

function siteName(data: AppData, id: string) {
  const tile = data.candidates.tiles.find(t => t.id === id);
  return (tile?.name ?? id).replace(/ regional window$/i, '');
}
function bestCampaign(run: Run | undefined) {
  if (!run?.campaigns.length) return null;
  return run.campaigns.reduce((a, b) => (b.k > a.k ? b : a));
}
function firstSite(run: Run | undefined) {
  return run?.campaigns.find(c => c.k === 1) ?? run?.campaigns[0];
}

function Spec({ label, children }: { label: string; children: ReactNode }) {
  return <div className="wd-spec"><dt>{label}</dt><dd>{children}</dd></div>;
}

/** Directed shots, one per chapter. Metres on the measured stage (x east, z south); agl shots give heights above ground. */
function buildShots(stage: StageData | null): Shot[] {
  const rim = stage?.worlds.mars.peak ?? [-9900, 800, 1700];
  return [
    // 0 — Quiet and vast: low orbit-like oblique over cratered highland, Earth on the horizon.
    { agl: true, cam: [2100, 170, 2600], look: [-1500, -60, -2600], fov: 46, w: [1, 0, 0, 0], sunAz: 250, sunEl: 10, exposure: 1.15, drift: [-260, 30, -420], earth: [3, 6], veil: [.52, .12, 0] },
    // 1 — The stand-in: across the salt pan to the range, late sun behind the lens.
    { agl: true, cam: [-600, 140, 2400], look: [7200, 380, -700], fov: 36, w: [0, 0, 1, 0], sunAz: 246, sunEl: 12, exposure: 1.0, drift: [700, 20, -500], probe: true, veil: [.58, 0, .04] },
    // 2 — The Moon again, close over the measured plateau, the Sun skimming it.
    { agl: true, cam: [2600, 620, 2800], look: [-500, -80, -600], fov: 44, w: [1, 0, 0, 0], sunAz: 232, sunEl: 4.5, exposure: 1.2, drift: [-500, -60, -500], contours: 1, survey: 1, sunDrag: true, earth: [-14, 8], veil: [0, .62, 0] },
    // 3 — Mars: low on the crater floor, looking into a low western sun over the rim.
    { agl: true, cam: [2600, 45, 2200], look: [rim[0] * .7, 260, rim[2] * .5], fov: 38, w: [0, 1, 0, 0], sunAz: 262, sunEl: 6, exposure: 1.05, drift: [-500, 10, -400], survey: .6, veil: [.55, 0, .04] },
    // 4 — Method: the Mars stand-in from high above, painted by likeness.
    { agl: true, cam: [2500, 7600, 11500], look: [0, 0, -1200], fov: 38, w: [0, 0, 0, 1], sunAz: 180, sunEl: 32, exposure: 1.0, drift: [-1200, -700, -1400], fidelity: 1, veil: [.45, .66, .05] },
    // 5 — The limits: the salt pan at dusk, splitting open.
    { agl: true, cam: [900, 5200, 5200], look: [0, -200, -900], fov: 40, w: [0, 0, 1, 0], sunAz: 258, sunEl: 8, exposure: .8, drift: [0, -700, -600], gaps: 1, veil: [.45, .5, .05] },
    // 6 — Your mission: the chosen ground, with what the settings mean drawn on it.
    { agl: true, cam: [3000, 1800, 4200], look: [0, 0, 0], fov: 42, w: [1, 0, 0, 0], sunAz: 230, sunEl: 9, exposure: 1.15, drift: [-600, 0, -400], survey: .7, launch: true, veil: [.45, .3, 0] },
    // 7 — Earth, before elsewhere.
    { cam: [0, 30000, 30000], look: [0, 0, -20000], fov: 4, w: [0, 0, 0, 1], sunAz: 200, sunEl: 20, exposure: 1.1, space: 1, alt: 410 },
  ];
}

const CHAPTERS = [
  { en: 'Frontier', ru: 'Рубеж' },
  { en: 'Stand-in', ru: 'Двойник' },
  { en: 'The Moon', ru: 'Луна' },
  { en: 'Mars', ru: 'Марс' },
  { en: 'Method', ru: 'Метод' },
  { en: 'Limits', ru: 'Пределы' },
  { en: 'Your mission', ru: 'Миссия' },
  { en: 'Earth', ru: 'Земля' },
];

export function HomePage() {
  const lang = useLanguage(s => s.language) as Lang;
  const { data, navigate, setTarget } = useAppStore();
  const root = useRef<HTMLElement>(null);
  const api = useRef<StageApi>({ engine: null, stage: null });
  const [destination, setDestination] = useState<'moon' | 'mars'>('moon');
  const [mode, setMode] = useState<Mode>('rover');
  const [params, setParams] = useState<Record<string, number>>(() => defaultsFor('rover'));
  const [active, setActive] = useState(0);
  const [ready, setReady] = useState<boolean | null>(null);
  const [probe, setProbe] = useState<ProbeReadout | null>(null);
  const [gapFocus, setGapFocus] = useState(-1);
  const [soundOn, setSoundOn] = useState(false);
  const sound = useRef<Soundscape | null>(null);
  const probeOpen = useRef(false);
  // ---------- Film plates and the opaque match chapter both may cover the live world ----------
  const cinema = useRef<CinemaHandle>(null);
  const [films, setFilms] = useState<CinemaAsset[]>([]);
  const cover = useRef({ film: 0, match: false, act: false, actChrome: false });
  const syncCover = useCallback(() => {
    const { film, match, act, actChrome } = cover.current;
    if (root.current) { root.current.dataset.film = String(film > .5); root.current.dataset.match = String(match); root.current.dataset.filmact = String(actChrome); }
    api.current.engine?.setOccluded(film > .985 || match || act);
  }, []);
  const onActCover = useCallback((v: boolean, chrome: boolean) => { cover.current.act = v; cover.current.actChrome = chrome; syncCover(); }, [syncCover]);
  const onFilmCover = useCallback((v: number) => { cover.current.film = v; syncCover(); }, [syncCover]);
  const onMatchCover = useCallback((v: boolean) => { cover.current.match = v; syncCover(); }, [syncCover]);
  const toggleSound = async () => {
    if (!sound.current) sound.current = new Soundscape();
    if (sound.current.on) { sound.current.disable(); setSoundOn(false); }
    else { try { await sound.current.enable(); setSoundOn(true); } catch { setSoundOn(false); } }
  };
  useEffect(() => {
    if (!soundOn) return; let raf = 0;
    const tick = () => { const e = api.current.engine; if (e) sound.current?.setMix(e.mix); raf = requestAnimationFrame(tick); };
    tick(); return () => cancelAnimationFrame(raf);
  }, [soundOn]);
  useEffect(() => () => sound.current?.dispose(), []);
  const labelRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const probeRef = useRef<HTMLDivElement>(null);
  const chooseMode = (next: Mode) => { setMode(next); setParams(defaultsFor(next)); };

  const moon = data?.targets.targets.find(t => t.body === 'moon' && t.kind !== 'validation_only') ?? data?.targets.targets.find(t => t.body === 'moon');
  const mars = data?.targets.targets.find(t => t.body === 'mars' && t.kind !== 'validation_only') ?? data?.targets.targets.find(t => t.body === 'mars');
  const runFor = (t?: Target) => t && data?.results.runs.find(r => r.target === t.id);
  const moonRun = runFor(moon), marsRun = runFor(mars);
  const moonFirst = firstSite(moonRun), marsFirst = firstSite(marsRun);
  const analogues = useMemo(() => ({ moon: moonFirst?.sites[0]?.id, mars: marsFirst?.sites[0]?.id }), [moonFirst, marsFirst]);

  // ---------- Scroll → chapter ----------
  useEffect(() => {
    const host = root.current; if (!host) return;
    let frame = 0;
    const tick = () => {
      frame = 0;
      const sections = Array.from(host.querySelectorAll<HTMLElement>('[data-chapter]'));
      const y = window.scrollY, vh = window.innerHeight; let c = 0;
      sections.forEach((s, i) => {
        const top = s.offsetTop, h = s.offsetHeight;
        const f = Math.min(1, Math.max(0, (y - top) / Math.max(1, h - vh * .15)));
        s.style.setProperty('--p', f.toFixed(4));
        if (y >= top - 1) c = i + f;
      });
      api.current.engine?.setChapter(c);
      cinema.current?.update(c);
      const a = Math.min(sections.length - 1, Math.round(c - .25)); setActive(prev => prev === a ? prev : a);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(tick); };
    tick(); window.addEventListener('scroll', onScroll, { passive: true }); window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); if (frame) cancelAnimationFrame(frame); };
  }, [ready]);

  useEffect(() => { api.current.engine?.setGapFocus(gapFocus); }, [gapFocus]);

  // ---------- Probe readout follows the probe on screen ----------
  const lastProbe = useRef(0);
  const onProbe = useCallback((p: ProbeReadout) => {
    const el = probeRef.current;
    if (el) { el.style.transform = `translate3d(${(p.x * window.innerWidth).toFixed(1)}px, ${(p.y * window.innerHeight).toFixed(1)}px, 0)`; el.dataset.active = String(p.active); el.dataset.open = String(p.radius > 60); }
    const open = p.radius > 60; if (open && !probeOpen.current) sound.current?.cue(); probeOpen.current = open;
    const now = performance.now(); if (now - lastProbe.current < 120) return; lastProbe.current = now;
    setProbe(p);
  }, []);

  const labels = useCallback((stage: StageData | null, engine: WorldEngine): LabelSpec[] => {
    const els = labelRefs.current; if (!stage) return [];
    const at = (x: number, z: number, lift = 0) => () => [x, engine.heightAt(x, z) + lift, z] as [number, number, number];
    const hm = (stage.hiMoon?.size ?? 4000) / 2, hs = (stage.hiMars?.size ?? 2048) / 2;
    const specs: [number, () => [number, number, number] | null, number, number][] = [
      [1, at(hm, hm, 10), 0, 0],
      [2, at(0, 0, 30), 1, 1],
      [3, at(stage.worlds.earthMoon.peak[0], stage.worlds.earthMoon.peak[2], 40), 1, 1],
      [4, at(-hm, hm, 10), 2, 2],
      [5, at(0, 0, 25), 2, 2],
      [6, at(0, 0, 20), 3, 3],
      [7, at(-hs, hs, 10), 3, 3],
      [8, at(stage.worlds.mars.peak[0] * .6, stage.worlds.mars.peak[2], 60), 3, 3],
      [9, at(0, 0, 60), 4, 4],
    ];
    return specs.filter(([i]) => els[i]).map(([i, fn, from, to]) => ({ el: els[i]!, at: fn, from, to }));
  }, []);

  const launchState = useMemo(() => ({ destination, mode, params: Object.fromEntries(PARAMS[mode].map(p => [p.key, paramValue(p, params)])) }), [destination, mode, params]);

  if (!data) return null;

  const templateFor = (t?: Target) => t && data.templates.templates.find(tp => t.templates.includes(tp.id));
  const moonCampaign = bestCampaign(moonRun), marsCampaign = bestCampaign(marsRun);
  const tiles = data.candidates.tiles.filter(t => t.pool !== 'control').length;
  const gapRows = Array.from(new Map([...(moonRun?.gaps.physical ?? []), ...(marsRun?.gaps.physical ?? [])].map(g => [g.gap, g])).values()).slice(0, 6);
  const synthetic = hasSyntheticData(data);
  const moonAnalogue = moonFirst?.sites[0] ? shortName(siteName(data, moonFirst.sites[0].id)) : 'Death Valley';
  const marsAnalogue = marsFirst?.sites[0] ? shortName(siteName(data, marsFirst.sites[0].id)) : 'Iceland';
  const stage = api.current.stage;
  const fmt = (n: number) => Math.round(n).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US');

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
  const jump = (i: number) => {
    const s = root.current?.querySelectorAll<HTMLElement>('[data-chapter]')[i]; if (!s) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: s.offsetTop + (i === 0 ? 0 : 2), behavior: reduced ? 'auto' : 'smooth' });
  };

  const tools: { route: Route; title: string; ru: string; text: string; textRu: string }[] = [
    { route: 'discover', title: 'Discover', ru: 'Поиск аналогов', text: 'Search the whole Earth for analogs of a lunar or Martian site, dimension by dimension, with uncertainty, rarity and the gaps that remain.', textRu: 'Поиск аналогов лунной или марсианской площадки по всей Земле — по каждому измерению, с неопределённостью, редкостью и оставшимися разрывами.' },
    { route: 'astral', title: 'Mission Studio', ru: 'Студия миссий', text: 'A measured 2 km Jezero world from HiRISE: terrain intelligence, route planning and rover rehearsal.', textRu: 'Измеренный мир Езеро 2 км по данным HiRISE: анализ рельефа, планирование маршрута и репетиция ровера.' },
    { route: 'studio', title: 'Lunar World', ru: 'Лунный мир', text: 'A measured 5 m Mons Mouton world with SPICE lighting, terrain intelligence and terramechanics traverses.', textRu: 'Измеренный мир Монс-Мутон с шагом 5 м: освещение SPICE, анализ рельефа и террамеханика ровера.' },
    { route: 'atlas', title: 'Transferability', ru: 'Переносимость', text: 'Per-task transferability of each measured Earth window, with separate evidence and mismatch axes.', textRu: 'Переносимость каждой задачи для каждого измеренного земного окна — с отдельными осями данных и расхождений.' },
    { route: 'lab', title: 'Engineering Lab', ru: 'Инженерная лаборатория', text: 'Drive, launch and land on measured terrain, and read every number the run produces.', textRu: 'Ведите ровер, запускайте и сажайте аппараты на измеренном рельефе — и смотрите каждую цифру расчёта.' },
    { route: 'campaign', title: 'Field Campaign', ru: 'Полевая кампания', text: 'Choose what the crew must practise. Get the fewest places on Earth that cover it.', textRu: 'Выберите, что экипажу нужно отработать, — и получите минимум мест на Земле, где это возможно.' },
    { route: 'twin', title: 'Same Sun', ru: 'Под одним Солнцем', text: 'Put a target and its Earth stand-in side by side, under the same sunlight.', textRu: 'Цель и её земной двойник рядом — под одним и тем же Солнцем.' },
    { route: 'matrix', title: 'Fidelity Matrix', ru: 'Матрица сходства', text: 'Every objective against every site, with the best Earth can do written in each cell.', textRu: 'Каждая цель против каждой площадки — и в каждой ячейке лучшее, на что способна Земля.' },
    { route: 'evidence', title: 'Sources & Limits', ru: 'Источники и пределы', text: 'Where every number comes from, how it will be tested, and what it cannot tell you.', textRu: 'Откуда каждая цифра, как её будут проверять и о чём она умалчивает.' },
    { route: 'brief', title: 'Mission Brief', ru: 'Задание миссии', text: 'The mission, its objectives and the conditions each one demands.', textRu: 'Миссия, её цели и условия, которых требует каждая из них.' },
  ];
  const exp = EXPEDITIONS.find(e => e.mode === mode)!;
  const labelText: string[] = [
    `${L(lang, 'Mons Mouton plateau', 'Плато Монс-Мутон')} · ${stage ? fmt(stage.worlds.moon.center) : '—'} m`,
    L(lang, 'Measured by laser altimeter · 10 m', 'Измерено лазерным альтиметром · 10 м'),
    `${moonAnalogue} · ${stage ? fmt(stage.worlds.earthMoon.center) : '—'} m`,
    `${L(lang, 'Black Mountains crest', 'Гребень Блэк-Маунтинс')} · ${stage ? fmt(stage.worlds.earthMoon.max) : '—'} m`,
    L(lang, 'Measured ground · 4 × 4 km', 'Измеренный участок · 4 × 4 км'),
    L(lang, 'Summit plateau', 'Вершинное плато'),
    L(lang, 'Perseverance landing site', 'Место посадки Perseverance'),
    L(lang, 'Measured ground · 2 × 2 km', 'Измеренный участок · 2 × 2 км'),
    L(lang, 'Jezero crater, western rim', 'Кратер Езеро, западный вал'),
    `${marsAnalogue} · ${marsFirst ? pct(marsFirst.coverage) : '—'}%`,
  ];

  return <main ref={root} className={`hm wd ${ready === false ? 'wd-no-gl' : ''} ${ready ? 'wd-ready' : ''}`} aria-labelledby="hm-title">
    <WorldStage analogues={analogues} shots={buildShots} labels={labels} apiRef={api} onProbe={onProbe} onReady={setReady} launch={launchState} />
    <CinemaLayer ref={cinema} lang={lang} onAssets={setFilms} onCover={onFilmCover} />
    <Reticle />

    <div className="wd-labels" aria-hidden="true">
      {labelText.map((text, i) => <span key={i} ref={el => { labelRefs.current[i] = el; }} className="wd-label"><i />{text}</span>)}
    </div>

    <div ref={probeRef} className="wd-probe" aria-hidden="true">
      <span className="wd-probe-hint">{L(lang, 'Hold to open the Moon', 'Удерживайте — откроется Луна')}</span>
      {probe && <span className="wd-probe-read">
        <b>{probe.to === 'Moon' ? L(lang, 'Moon', 'Луна') : probe.to === 'Mars' ? L(lang, 'Mars', 'Марс') : L(lang, 'Earth', 'Земля')}</b>
        {L(lang, ' beneath ', ' под: ')}{probe.from === 'Earth' ? (destinationFor(active) === 'mars' ? marsAnalogue : moonAnalogue) : probe.from === 'Moon' ? L(lang, 'the Moon', 'Луна') : L(lang, 'Mars', 'Марс')}
        <em>Δh {probe.dh >= 0 ? '+' : '−'}{fmt(Math.abs(probe.dh))} m · {L(lang, 'slope', 'уклон')} {probe.slopeB.toFixed(1)}° / {probe.slopeA.toFixed(1)}°</em>
      </span>}
    </div>

    {ready && <button className={`wd-sound ${soundOn ? 'is-on' : ''}`} aria-pressed={soundOn} onClick={toggleSound}>
      {soundOn ? <Volume2 size={14} strokeWidth={1.5} /> : <VolumeX size={14} strokeWidth={1.5} />}
      <span className="wd-sound-bars" aria-hidden="true"><i /><i /><i /><i /></span>
      <span>{soundOn ? L(lang, 'Sound on', 'Звук включён') : L(lang, 'Sound off', 'Звук выключен')}</span>
    </button>}

    <nav className="wd-rail" aria-label={L(lang, 'Chapters', 'Главы')}>
      {CHAPTERS.map((c, i) => <button key={i} aria-current={active === i ? 'step' : undefined} onClick={() => jump(i)}>
        <span className="wd-rail-n">{String(i).padStart(2, '0')}</span><span className="wd-rail-t">{L(lang, c.en, c.ru)}</span>
      </button>)}
    </nav>

    {/* 00 — First light on Mons Mouton */}
    {/* ACT I — the film: one continuous flight, scrubbed by the scroll (shows once the footage exists) */}
    {films.some(f => f.mode === 'film') && <FilmAct lang={lang} clips={films.filter(f => f.mode === 'film')} hMax={moon?.h_max_deg ?? null} soundOn={soundOn}
      onCover={onActCover} onPlan={() => jump(6)} onFinish={() => {}} />}

    {/* ACT II — the live instrument: measured ground, rendered in the browser */}
    <section data-chapter="0" className="wd-ch wd-hero">
      <div className="wd-frame">
        <div className="wd-hero-copy">
          {films.some(f => f.mode === 'film')
            ? <><p className="wd-kicker">{L(lang, 'Act II · The live instrument', 'Акт II · Живой инструмент')}</p>
                <h2 className="wd-title wd-title-act">
                  <span className="wd-line"><span style={{ '--d': '0ms' } as React.CSSProperties}>{L(lang, 'Same ground.', 'Тот же грунт.')}</span></span>
                  <span className="wd-line wd-line-indent"><span style={{ '--d': '120ms' } as React.CSSProperties}>{L(lang, 'Measured.', 'Измеренный.')}</span></span>
                </h2></>
            : <><p className="wd-kicker wd-in" style={{ '--d': '300ms' } as React.CSSProperties}>{L(lang, 'EGIZ · Training grounds for the Moon and Mars', 'EGIZ · Земные полигоны для Луны и Марса')}</p>
                <h1 id="hm-title" className="wd-title">
                  <span className="wd-line"><span style={{ '--d': '500ms' } as React.CSSProperties}>{L(lang, 'The next', 'Новый')}</span></span>
                  <span className="wd-line wd-line-indent"><span style={{ '--d': '620ms' } as React.CSSProperties}>{L(lang, 'frontier', 'рубеж')}</span></span>
                  <span className="wd-line"><span style={{ '--d': '740ms' } as React.CSSProperties}>{L(lang, 'starts here', 'начинается здесь')}</span></span>
                </h1></>}
          <p className="wd-lede wd-in" style={{ '--d': '1100ms' } as React.CSSProperties}>{L(lang,
            films.some(f => f.mode === 'film') ? 'This is no longer footage: the lunar south pole from laser altimetry, rendered live in your browser. Scroll on and the ground changes — to Earth, back to the Moon, to Mars.' : 'Every step on the Moon and Mars is practised on Earth first. EGIZ finds the places on our planet that come closest — and says plainly what no place on Earth can teach.',
            films.some(f => f.mode === 'film') ? 'Это уже не съёмка: южный полюс Луны по данным лазерной альтиметрии, отрисованный вживую в вашем браузере. Листайте дальше — грунт будет меняться: Земля, снова Луна, Марс.' : 'Каждый шаг на Луне и Марсе сначала отрабатывают на Земле. EGIZ находит места на нашей планете, которые ближе всего к цели, — и прямо говорит, чему Земля научить не может.')}</p>
          <div className="wd-actions wd-in" style={{ '--d': '1300ms' } as React.CSSProperties}>
            <button className="eg-button" onClick={() => jump(6)}>{L(lang, 'Plan a mission', 'Спланировать миссию')}<ArrowRight size={16} strokeWidth={1.6} /></button>
            <button className="eg-button quiet" onClick={() => open('campaign')}><span>{L(lang, 'Find field sites', 'Подобрать полигоны')}</span></button>
          </div>
        </div>
        <dl className="wd-hero-read wd-in" style={{ '--d': '1500ms' } as React.CSSProperties}>
          {moon && <div><dt>{L(lang, 'Target', 'Цель')}</dt><dd>{shortName(moon.name)} · {latLon(lang, moon.lat, moon.lon)}</dd></div>}
          <div><dt>{L(lang, 'Surface', 'Поверхность')}</dt><dd>{L(lang, 'Measured lunar terrain, rendered live', 'Измеренный лунный рельеф в реальном времени')}</dd></div>
          {moon?.h_max_deg != null && <div><dt>{L(lang, 'Sun', 'Солнце')}</dt><dd>{L(lang, `never higher than ${moon.h_max_deg.toFixed(1)}°`, `никогда не выше ${moon.h_max_deg.toFixed(1)}°`)}</dd></div>}
        </dl>
        <button className="wd-scroll wd-in" style={{ '--d': '1700ms' } as React.CSSProperties} onClick={() => jump(1)} aria-label={L(lang, 'Scroll to story', 'Прокрутить вниз')}><ArrowDown size={14} strokeWidth={1.4} /><span>{L(lang, 'Scroll — the ground is about to change', 'Прокрутите — грунт сейчас изменится')}</span></button>
      </div>
    </section>

    {/* 01 — The same ground, rehearsed on Earth */}
    <section data-chapter="1" className="wd-ch">
      <div className="wd-frame wd-frame-left">
        <div className="wd-block">
          <p className="wd-kicker">{L(lang, '01 · The stand-in', '01 · Двойник')}</p>
          <h2 className="wd-statement">{L(lang,
            <>That was the Moon. This is <em>{moonAnalogue}</em> — the closest thing Earth has to it.</>,
            <>Это была Луна. А это <em>{moonAnalogue}</em> — самое близкое к ней, что есть на Земле.</>)}</h2>
          {moonFirst && <p className="wd-figure"><span className="wd-figure-n">{pct(moonFirst.coverage)}<small>%</small></span><span className="wd-figure-t">{L(lang, `of the ${moon ? shortName(moon.name) : 'mission'} objectives can be practised here. No single place on Earth does better.`, `целей миссии ${moon ? shortName(moon.name) : ''} можно отработать здесь. Ни одно место на Земле не справляется лучше.`)}</span></p>}
          <p className="wd-body">{L(lang,
            `Since Apollo, crews have trained in deserts, lava fields and canyons before leaving Earth. EGIZ makes that choice measurable: it scores ${tiles.toLocaleString(lang)} candidate sites against what the mission actually demands.`,
            `Со времён «Аполлонов» экипажи тренируются в пустынях, на лавовых полях и в каньонах. EGIZ делает этот выбор измеримым: оценивает ${tiles.toLocaleString(lang)} площадок-кандидатов по тому, чего на самом деле требует миссия.`)}</p>
          <p className="wd-hint"><span className="wd-hint-dot" />{L(lang, 'Press and hold the ground to cut a window through to the Moon.', 'Нажмите и удерживайте поверхность — под ней откроется Луна.')}</p>
          {synthetic && <p className="wd-note">{L(lang, 'Demo data — invented for illustration, not NASA observations.', 'Демо-данные — придуманы для иллюстрации, это не наблюдения NASA.')}</p>}
        </div>
      </div>
    </section>

    {/* 02 — Moon, measured */}
    {moon && <section data-chapter="2" className="wd-ch" aria-labelledby="hm-moon">
      <div className="wd-frame wd-frame-right">
        <div className="wd-block">
          <p className="wd-kicker">{L(lang, '02 · The Moon', '02 · Луна')}</p>
          <h2 id="hm-moon" className="wd-h2">Mons Mouton</h2>
          <p className="wd-body">{L(lang,
            'A flat-topped mountain near the lunar south pole, among the regions considered for Artemis landings. Inside the marked square every ridge is measured, ten metres apart. Here the Sun crawls along the horizon and shadows stretch for kilometres.',
            'Гора с плоской вершиной у южного полюса Луны — один из районов, рассматриваемых для посадок Artemis. Внутри отмеченного квадрата измерен каждый гребень, с шагом десять метров. Здесь Солнце ползёт вдоль горизонта, а тени тянутся на километры.')}</p>
          <dl className="wd-specs">
            <Spec label={L(lang, 'Position', 'Координаты')}>{latLon(lang, moon.lat, moon.lon)}</Spec>
            <Spec label={L(lang, 'Terrain', 'Рельеф')}>{moon.dem_product}</Spec>
            <Spec label={L(lang, 'Fine baseline', 'Малая база')}>{moon.fine_baseline_m} m</Spec>
            {moon.h_max_deg != null && <Spec label={L(lang, 'Max sun elevation', 'Макс. высота Солнца')}>{moon.h_max_deg.toFixed(1)}°</Spec>}
            {templateFor(moon) && <Spec label={L(lang, 'Objectives', 'Цели')}>{templateFor(moon)!.objectives.length}</Spec>}
          </dl>
          <p className="wd-hint"><span className="wd-hint-dot" />{L(lang, 'Move across the screen to walk the Sun around the horizon.', 'Ведите курсор по экрану — Солнце пойдёт вдоль горизонта.')}</p>
          <button className="eg-button" onClick={() => open('lab', moon)}>{L(lang, 'Open this ground in the lab', 'Открыть рельеф в лаборатории')}<ArrowRight size={16} strokeWidth={1.6} /></button>
        </div>
      </div>
    </section>}

    {/* 03 — Mars */}
    {mars && <section data-chapter="3" className="wd-ch" aria-labelledby="hm-mars">
      <div className="wd-frame wd-frame-left">
        <div className="wd-block">
          <p className="wd-kicker">{L(lang, '03 · Beyond Earth, into the unknown', '03 · За пределы Земли, в неизвестность')}</p>
          <h2 id="hm-mars" className="wd-h2 wd-h2-xl">{L(lang, 'Jezero', 'Езеро')}</h2>
          <p className="wd-body">{L(lang,
            'An ancient river delta in a crater that once held a lake, and the place Perseverance touched down in 2021. The marked square is measured ground with its own orbital photograph; beyond it the crater floor runs out to the western rim.',
            'Древняя речная дельта в кратере, где когда-то было озеро, и место, где в 2021 году сел Perseverance. Отмеченный квадрат — измеренный грунт со своим орбитальным снимком; дальше дно кратера тянется до западного вала.')}</p>
          <dl className="wd-specs wd-specs-row">
            <Spec label={L(lang, 'Position', 'Координаты')}>{latLon(lang, mars.lat, mars.lon)}</Spec>
            <Spec label={L(lang, 'Terrain', 'Рельеф')}>{mars.dem_product}</Spec>
            <Spec label={L(lang, 'Fine baseline', 'Малая база')}>{mars.fine_baseline_m} m</Spec>
          </dl>
          <button className="eg-button" onClick={() => open('campaign', mars)}>{L(lang, 'Plan a Mars campaign', 'Спланировать кампанию')}<ArrowRight size={16} strokeWidth={1.6} /></button>
        </div>
      </div>
    </section>}

    {/* Same ground, two planets: point at Mars, Earth answers */}
    <MatchChapter data={data} lang={lang} synthetic={synthetic} films={films.filter(f => f.mode === 'inline')} onCover={onMatchCover} />

    {/* 04 — Method */}
    <section data-chapter="4" className="wd-ch wd-ch-long" aria-labelledby="hm-method">
      <div className="wd-frame wd-frame-method">
        <div className="wd-method-head">
          <p className="wd-kicker">{L(lang, '04 · How it works', '04 · Как это работает')}</p>
          <h2 id="hm-method" className="wd-h2">{L(lang, <>Define.<br />Search.<br />Admit.</>, <>Задать.<br />Найти.<br />Признать.</>)}</h2>
          <p className="wd-body">{L(lang,
            `Below lies ${marsAnalogue}. Warm ground has slopes like Jezero and could stand in for Mars; dark ground could not.`,
            `Внизу — ${marsAnalogue}. Тёплым окрашен грунт с уклонами как в Езеро — он может заменить Марс; тёмный — не может.`)}</p>
        </div>
        <ol className="wd-steps">
          <li><span>01</span><h3>{L(lang, 'Define', 'Задать')}</h3><p>{L(lang, 'Each objective states the slopes, light and temperatures it needs, up close and across two kilometres.', 'Каждая цель описывает нужные уклоны, свет и температуру — вблизи и на расстоянии двух километров.')}</p></li>
          <li><span>02</span><h3>{L(lang, 'Search', 'Найти')}</h3><p>{L(lang, `Score ${tiles.toLocaleString(lang)} sites on Earth, then search exactly for the best campaign of one, two or three.`, `Оценить ${tiles.toLocaleString(lang)} мест на Земле и точно найти лучшую кампанию из одного, двух или трёх.`)}</p></li>
          <li><span>03</span><h3>{L(lang, 'Admit', 'Признать')}</h3><p>{L(lang, 'Show the best Earth can do for each objective, and send everything else to the laboratory.', 'Показать, на что способна Земля по каждой цели, — и отправить остальное в лабораторию.')}</p></li>
        </ol>
        <div className="wd-results">
          {[{ t: moon, c: moonCampaign }, { t: mars, c: marsCampaign }].filter(x => x.t && x.c).map(({ t, c }) => <article key={t!.id} className="wd-result">
            <p className="wd-kicker">{t!.body === 'moon' ? L(lang, 'Lunar base', 'Лунная база') : L(lang, 'Mars surface', 'Поверхность Марса')} · {c!.k} {c!.k === 1 ? L(lang, 'site', 'полигон') : L(lang, 'sites', 'полигона')}</p>
            <h3>{shortName(t!.name)}</h3>
            <p className="wd-result-n">{pct(c!.coverage)}<small>%</small></p>
            <div className="wd-bar" aria-hidden="true"><i style={{ '--w': c!.coverage } as React.CSSProperties} /></div>
            <ul>{c!.sites.map(s => <li key={s.id}>{tr(siteName(data, s.id))}</li>)}</ul>
          </article>)}
        </div>
        <p className="wd-foot">{L(lang,
          `${synthetic ? 'Demo' : 'Measured-terrain pilot'} data, engine ${data.results.engine_version}. Exploratory and not yet validated. Low lunar coverage is the result, not a fault. The colour field compares slopes for illustration; it is not the scoring model.`,
          `Данные: ${synthetic ? 'демо' : 'пилот на измеренном рельефе'}, движок ${data.results.engine_version}. Предварительно, без валидации. Низкое покрытие для Луны — это результат, а не ошибка. Цветовое поле сравнивает уклоны для наглядности и не является моделью оценки.`)}</p>
      </div>
    </section>

    {/* 05 — What Earth cannot test */}
    {gapRows.length > 0 && <section data-chapter="5" className="wd-ch wd-ch-long" aria-labelledby="hm-gaps">
      <div className="wd-frame wd-frame-gaps">
        <div className="wd-gaps-head">
          <p className="wd-kicker">{L(lang, '05 · The limits', '05 · Пределы')}</p>
          <h2 id="hm-gaps" className="wd-h2">{L(lang, <>What Earth<br />cannot teach</>, <>Чему Земля<br />не научит</>)}</h2>
          <p className="wd-body">{L(lang, 'No desert lowers gravity. No glacier is a vacuum. Each fault in the ground is a condition no field site can reproduce — and beside it, the facility that can.', 'Ни одна пустыня не ослабит гравитацию. Ни один ледник не станет вакуумом. Каждый разлом — условие, которое не воспроизведёт ни один полигон, а рядом — установка, которая сможет.')}</p>
        </div>
        <ol className="wd-ledger" onMouseLeave={() => setGapFocus(-1)}>
          {gapRows.map((g, i) => <li key={g.gap} onMouseEnter={() => setGapFocus(i)} onFocus={() => setGapFocus(i)} onBlur={() => setGapFocus(-1)} tabIndex={0} className={gapFocus === i ? 'is-focus' : ''}>
            <span className="wd-ledger-n">{String(i + 1).padStart(2, '0')}</span>
            <strong>{tr(g.gap)}</strong>
            <span className="wd-ledger-alt">{tr(g.alternative)}</span>
          </li>)}
        </ol>
      </div>
    </section>}

    {/* 06 — Your rehearsal */}
    <section data-chapter="6" className="wd-ch wd-ch-launch" aria-labelledby="hm-launch">
      <div className="wd-frame wd-frame-launch">
        <div className="wd-launch-head">
          <p className="wd-kicker">{L(lang, '06 · Your mission', '06 · Ваша миссия')}</p>
          <h2 id="hm-launch" className="wd-h2">{L(lang, 'Choose your ground', 'Выберите грунт')}</h2>
          <p className="wd-body">{L(lang, exp.noteEn, exp.noteRu)}</p>
        </div>
        <div className="wd-panel" data-no-probe aria-label={L(lang, 'Plan a mission', 'Планирование миссии')} role="group">
          <div className="wd-dest" role="radiogroup" aria-label={L(lang, 'Destination', 'Цель')}>
            {([['moon', moon, L(lang, 'Moon', 'Луна')], ['mars', mars, L(lang, 'Mars', 'Марс')]] as const).filter(([, t]) => t).map(([body, t, label]) => <button key={body} role="radio" aria-checked={destination === body} onClick={() => setDestination(body)}>
              <span>{label}</span><small>{t ? shortName(t.name) : ''}</small>
            </button>)}
          </div>
          <p className="wd-panel-label">{L(lang, 'Mission type', 'Тип миссии')}</p>
          <div className="wd-exp" role="radiogroup" aria-label={L(lang, 'Mission type', 'Тип миссии')}>
            {EXPEDITIONS.map(e => <button key={e.mode} role="radio" aria-checked={mode === e.mode} onClick={() => chooseMode(e.mode)}>
              <MissionGlyph mode={e.mode} /><span>{L(lang, e.en, e.ru)}</span>
            </button>)}
          </div>
          <p className="wd-panel-label">{L(lang, 'Settings', 'Настройки')}</p>
          <div className="wd-params">
            {PARAMS[mode].map(p => {
              const max = paramMax(p, params); const value = paramValue(p, params);
              return <label key={p.key} className="wd-param">
                <span className="wd-param-head"><span>{L(lang, p.en, p.ru)}</span><output>{value.toLocaleString(lang)}<small>{p.unit}</small></output></span>
                <input type="range" min={p.min} max={max} step={p.step} value={value} onChange={e => setParams(v => ({ ...v, [p.key]: Number(e.target.value) }))} style={{ '--fill': `${((value - p.min) / (max - p.min)) * 100}%` } as React.CSSProperties} />
              </label>;
            })}
          </div>
          <button className="eg-button wd-launch-go" onClick={() => startExpedition(true)}>{L(lang, 'Run the simulation', 'Запустить расчёт')}<ArrowRight size={16} strokeWidth={1.6} /></button>
          <button className="wd-panel-link" onClick={() => startExpedition(false)}>{L(lang, 'Open the lab without running it', 'Открыть лабораторию без запуска')}</button>
        </div>
      </div>
    </section>

    {/* 07 — Earth, before elsewhere */}
    <section data-chapter="7" className="wd-ch wd-finale" aria-labelledby="hm-earth">
      <div className="wd-frame wd-frame-finale">
        <p className="wd-kicker">{L(lang, '07 · Made in Astana', '07 · Сделано в Астане')}</p>
        <h2 id="hm-earth" className="wd-h2 wd-h2-xl">{L(lang, <>Earth,<br />before elsewhere.</>, <>Сначала — Земля.<br />Потом — всё остальное.</>)}</h2>
        <p className="wd-body wd-finale-note">{L(lang, 'Low Earth orbit. The Moon rises through the same thin air every rehearsal happens under. Illustrative, not to scale.', 'Низкая околоземная орбита. Луна восходит сквозь тот же тонкий слой воздуха, под которым проходит каждая репетиция. Иллюстрация, не в масштабе.')}</p>
      </div>
    </section>

    <section className="wd-index hm-wrap" aria-labelledby="hm-index">
      <div className="wd-index-head">
        <p className="wd-kicker">{L(lang, 'Inside EGIZ', 'Внутри EGIZ')}</p>
        <h2 id="hm-index" className="wd-h2">{L(lang, 'The instruments', 'Инструменты')}</h2>
      </div>
      <ul className="wd-index-list">
        {tools.map((tool, i) => <li key={tool.route}>
          <button onClick={() => open(tool.route)}>
            <span className="wd-index-n">{String(i + 1).padStart(2, '0')}</span>
            <span className="wd-index-title">{L(lang, tool.title, tool.ru)}</span>
            <span className="wd-index-text">{L(lang, tool.text, tool.textRu)}</span>
            <ArrowUpRight className="wd-index-arrow" size={22} strokeWidth={1.4} aria-hidden="true" />
          </button>
        </li>)}
      </ul>
      <footer className="wd-footer">
        <div className="wd-footer-mark" aria-hidden="true">Egiz</div>
        <div className="wd-footer-cols">
          <p>{L(lang, 'An independent student project for the NASA Space Apps Challenge 2026. Not affiliated with or endorsed by NASA.', 'Независимый студенческий проект для NASA Space Apps Challenge 2026. Не связан с NASA и не одобрен ею.')}</p>
          <p>{L(lang, 'Landforms are measured: NASA PGDA lunar laser altimetry, a measured Jezero terrain package, Copernicus DEM for Earth. Surface colour, relief finer than the measurements, atmospheres, boulders and the orbital view are artistic interpretation. Planet textures: Solar System Scope (CC BY 4.0), based on NASA imagery. None of the imagery feeds the calculations.', 'Формы рельефа измерены: лазерная альтиметрия NASA PGDA для Луны, измеренный пакет рельефа Езеро, Copernicus DEM для Земли. Цвет поверхности, рельеф мельче измерений, атмосферы, валуны и вид с орбиты — художественная интерпретация. Текстуры планет — Solar System Scope (CC BY 4.0) на основе снимков NASA. Изображения не участвуют в расчётах.')}</p>
          <p className="wd-footer-meta"><span>© 2026 Egiz</span><button className="eg-button quiet" onClick={() => open('evidence')}><span>{L(lang, 'Sources & limits', 'Источники и пределы')}</span></button></p>
        </div>
      </footer>
    </section>
  </main>;
}

function destinationFor(chapter: number): 'moon' | 'mars' { return chapter >= 3 && chapter <= 4 ? 'mars' : 'moon'; }
