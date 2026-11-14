// EGIZ Planetary Studio · unified workspace shell. One persistent investigation moves through
// Discover → Inspect → Simulate → Compare → Decide; the 3D terrain, selection, mission and intelligence context
// stay alive across stages. The shell owns the site lifecycle, the renderer and the compute worker.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Compass, Crosshair, Layers, MessageSquareText, Mountain, Pause, Play, Ruler, Sun, TriangleAlert } from 'lucide-react';
import { aspectDeg, fieldRange, lineOfSight, pathLength, polygonArea, profile, slopeDeg, type XY } from '../../astral/world/field';
import { telemetryAt } from '../../astral/sim/mission';
import { EgizMark } from '../../components/SiteHeader';
import { useAppStore } from '../../state/store';
import { Compute, computeSite } from '../compute';
import type { IntelAction } from '../intel/engine';
import { TerrainView, type CameraPose, type Mark, type PathDraw, type PickPoint, type RingDraw, type ViewStats } from '../render/terrainView';
import { streamEarthSite } from '../terrain/earthStream';
import { BODY_LABEL, loadSite, siteLatLon, type SiteRef } from '../terrain/site';
import { morningStart, sunAt } from '../terrain/solar';
import { defaultConfig, mobilityLimits, type MissionPlan } from '../twin/twin';
import { MARK_COLOR, MARK_LABEL, type MarkKind, type StreamRef } from '../workspace/investigation';
import { STAGES, uid, usePlanet, type Stage, type Tool } from '../workspace/store';
import { usePlanetData } from '../workspace/data';
import { openWorkspace } from '../../expedition/nav';
import { WorkspaceSwitcher } from '../../components/WorkspaceSwitcher';
import { Legend, ProfileChart, SunDial } from './charts';
import { CtlContext, emptyPlan, PanelShell, StudioBoundary, type Appearance, type Ctl } from './ctl';
import { DiscoverStage } from './DiscoverStage';
import { IntelPanel } from './IntelPanel';
import { buildLayer, elevationRamp, LAYERS, MODES, type LayerId } from './layers';
import { ComparePanel, InspectPanel, ReportPanel, SimulatePanel } from './panels';
import '../planet.css';

const BASE = import.meta.env.BASE_URL;
const TOOL_HINT: Record<Tool, string> = { inspect: 'Click terrain to inspect a point', distance: 'Click two points to measure distance, height difference and line of sight', profile: 'Click points along a line, then press Enter for the elevation profile', area: 'Click the corners of a polygon, then press Enter',
  'mark-landing': 'Click to mark a landing site', 'mark-science': 'Click to mark a science target', 'mark-hazard': 'Click to mark a hazard', 'plan-start': 'Click the rover start position', 'plan-destination': 'Click the destination', 'plan-waypoint': 'Click to add a science stop', 'plan-hazard': 'Click to add a keep-out zone' };
const fmtM = (m: number) => (m >= 2000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(m < 100 ? 1 : 0)} m`);
export default function PlanetWorkspace() { return <StudioBoundary><Workspace /></StudioBoundary>; }
function Workspace() {
  const s = usePlanet(), navigate = useAppStore(a => a.navigate), dataMode = useAppStore(a => a.dataMode);
  const host = useRef<HTMLDivElement>(null), viewRef = useRef<TerrainView | null>(null), computeRef = useRef<Compute | null>(null), openToken = useRef(0), abort = useRef<AbortController | null>(null);
  const [view, setView] = useState<TerrainView | null>(null), [stats, setStats] = useState<ViewStats | null>(null), [hover, setHover] = useState<PickPoint | null>(null), [pose, setPose] = useState<CameraPose | null>(null);
  const [appearance, setApp] = useState<Appearance>({ mode: 'natural', layer: null, opacity: 0.85, contourM: 0, exaggeration: 1, exposure: null, tint: false, craters: false });
  const [insolation, setInsolation] = useState<Ctl['insolation']>(null), [insolating, setInsolating] = useState<string | null>(null), [shadowBusy, setShadowBusy] = useState(false), [notice, setNotice] = useState<string | null>(null);
  const [playT, setPlayT] = useState(0), [playing, setPlaying] = useState(false), [activeProfile, setActiveProfile] = useState<string | null>(null);
  const site = s.site, stage = s.stage, show3d = stage === 'inspect' || stage === 'simulate' || stage === 'compare';

  // ── data: packaged sites, discovery index, validation, ATLAS-Π (shared with the expedition and Mission Home) ──
  usePlanetData(dataMode);
  const target = s.target();

  // ── site lifecycle ────────────────────────────────────────────────────────
  const open = useCallback((t: { ref?: SiteRef; stream?: StreamRef }) => {
    const token = ++openToken.current; abort.current?.abort(); const c = (abort.current = new AbortController());
    computeRef.current?.dispose(); computeRef.current = null; setInsolation(null); setPlaying(false); setPlayT(0); setActiveProfile(null);
    const st = usePlanet.getState(), name = t.ref?.name ?? t.stream?.name ?? 'site';
    st.set({ site: null, siteStatus: 'loading', siteMessage: t.ref ? `Loading ${name}…` : `Streaming elevation for ${name}…`, layers: null, run: null, baseline: null, sensitivity: null, plan: null, selection: null, draft: [], compare: null, tool: 'inspect' });
    (t.ref ? loadSite(t.ref, BASE, c.signal, (d, n) => { if (token === openToken.current) usePlanet.getState().set({ siteMessage: `Loading ${name}: analysis tiles ${d} / ${n}` }); }) : streamEarthSite(t.stream!.id, t.stream!.name, t.stream!.lat, t.stream!.lon, { signal: c.signal }))
      .then(async loaded => {
        if (token !== openToken.current) return;
        const compute = (computeRef.current = new Compute(computeSite(loaded)));
        const best = loaded.sun ? loaded.sun.samples.reduce((a, b) => (b.elevationDeg > a.elevationDeg ? b : a)).t : 0;
        usePlanet.getState().set({ site: loaded, siteStatus: 'ready', siteMessage: '', timeS: best, config: defaultConfig(loaded.body) }); usePlanet.getState().setSiteRef(t.ref?.key ?? null, t.stream ?? null);
        const layers = await compute.run('layers', { baselineM: loaded.field.posting, tpiRadiusM: loaded.field.posting * 12 });
        if (token === openToken.current) usePlanet.getState().set({ layers });
      })
      .catch(e => { if (token === openToken.current && !c.signal.aborted) usePlanet.getState().set({ siteStatus: 'error', siteMessage: `${name} could not be opened: ${e instanceof Error ? e.message : e}${t.stream ? ' Streamed terrain needs a network connection to the public elevation tiles.' : ''}` }); });
  }, []);
  useEffect(() => () => { abort.current?.abort(); computeRef.current?.dispose(); }, []);
  // Reopen the investigation's site once the catalogue is known.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !s.refs.length || s.site || s.siteStatus !== 'idle') return; resumed.current = true;
    const ref = s.refs.find(r => r.key === s.inv.siteKey); if (ref) open({ ref }); else if (s.inv.streamed) open({ stream: s.inv.streamed });
  }, [s.refs, s.site, s.siteStatus, s.inv.siteKey, s.inv.streamed, open]);

  useEffect(() => {
    if (!site || !host.current) return;
    const v = new TerrainView(host.current, site); viewRef.current = v; setView(v); setStats(null); setPose(v.getPose());
    v.onStats = setStats; v.onHover = setHover; v.onError = setNotice;
    let last = 0; v.onCamera = p => { const now = performance.now(); if (now - last > 120) { last = now; setPose(p); } };
    v.setBase('natural', elevationRamp(site));
    return () => { v.dispose(); viewRef.current = null; setView(null); };
  }, [site]);

  // ── appearance, layers, Sun ───────────────────────────────────────────────
  const mode = MODES.find(m => m.id === appearance.mode) ?? MODES[0];
  const limits = useMemo(() => mobilityLimits(s.config, site?.body ?? 'mars', s.plan?.maxSlopeDeg ?? 15), [s.config, s.plan?.maxSlopeDeg, site?.body]);
  const built = useMemo(() => (site && appearance.layer ? buildLayer(appearance.layer, { site, layers: s.layers, insolation, limits }) : null), [site, appearance.layer, s.layers, insolation, limits]);
  useEffect(() => { if (!view) return; view.setShade(mode.shade); view.setBase(mode.base); view.setContours(appearance.contourM); view.setExposure(appearance.exposure); view.setTint(appearance.tint); }, [view, mode, appearance.contourM, appearance.exposure, appearance.tint]);
  useEffect(() => { view?.setExaggeration(appearance.exaggeration); }, [view, appearance.exaggeration]);
  useEffect(() => { view?.setLayer('A', built?.texture ?? null, appearance.opacity); }, [view, built]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { view?.setLayerOpacity('A', built ? appearance.opacity : 0); }, [view, appearance.opacity, built]);
  const sun = site?.sun ? sunAt(site.sun, s.timeS) : null;
  useEffect(() => {
    if (!view || !site?.sun) { view?.setSun(null, null); return; }
    const st = sunAt(site.sun, s.timeS); view.setSun(st.sunEnu, null);
    if (mode.shade !== 'physical' || !computeRef.current) return;
    setShadowBusy(true);
    const timer = window.setTimeout(() => { computeRef.current?.run('shadow', { t: s.timeS, stride: site.field.side > 700 ? 4 : 2 }, { supersede: true }).then(mask => { if (viewRef.current === view && mask) view.setSun(st.sunEnu, mask); setShadowBusy(false); }).catch(e => { if (e.message !== 'superseded') { setShadowBusy(false); setNotice(`Terrain shadows could not be computed: ${e.message}`); } }); }, 140);
    return () => window.clearTimeout(timer);
  }, [view, site, s.timeS, mode.shade]);
  const computeInsolation = useCallback(() => {
    const st = usePlanet.getState(), c = computeRef.current; if (!st.site?.sun || !c || insolating) return;
    const dur = st.site.sun.duration, count = Math.min(48, Math.max(12, Math.round(dur / 3600)));
    setInsolating('Integrating direct Sun…');
    c.run('insolation', { fromS: 0, toS: dur, count, stride: st.site.field.side > 700 ? 6 : 3 }, { progress: (d, n) => setInsolating(`Integrating direct Sun: sample ${d} / ${n}`) }).then(r => { setInsolation(r); setInsolating(null); }).catch(e => { setInsolating(null); if (e.message !== 'superseded') setNotice(`Insolation failed: ${e.message}`); });
  }, [insolating]);
  const setAppearance = useCallback((p: Partial<Appearance>) => setApp(a => {
    const next = { ...a, ...p };
    if (p.mode && p.mode !== a.mode) { const m = MODES.find(x => x.id === p.mode)!; next.layer = m.layer; next.contourM = m.contour && usePlanet.getState().site ? niceContour(usePlanet.getState().site!.field) : 0; }
    return next;
  }), []);
  useEffect(() => { const d = LAYERS.find(l => l.id === appearance.layer); if (d?.needs === 'insolation' && !insolation && !insolating && site?.sun) computeInsolation(); }, [appearance.layer, insolation, insolating, site, computeInsolation]);

  // ── tools ─────────────────────────────────────────────────────────────────
  const finishDraft = useCallback(() => {
    const st = usePlanet.getState(), f = st.site?.field, pts = st.draft; if (!f || !st.site) return;
    if (st.tool === 'profile' && pts.length >= 2) {
      const pr = profile(f, pts), ok = pr.filter(p => p.elevation !== null), len = pathLength(f, pts); let up = 0, down = 0;
      for (let i = 1; i < ok.length; i++) { const d = ok[i].elevation! - ok[i - 1].elevation!; if (d > 0) up += d; else down -= d; }
      const id = uid('m'); st.addMeasure({ id, kind: 'profile', siteKey: st.site.key, points: pts, label: `Profile ${st.inv.measurements.filter(m => m.kind === 'profile').length + 1}`, values: { 'length m': len.plan, 'surface m': len.surface, 'ascent m': up, 'descent m': down, 'max slope °': Math.max(0, ...pr.map(p => p.slopeDeg ?? 0)) } });
      setActiveProfile(id);
    } else if (st.tool === 'area' && pts.length >= 3) {
      let perim = 0; for (let i = 0; i < pts.length; i++) perim += Math.hypot(pts[(i + 1) % pts.length].x - pts[i].x, pts[(i + 1) % pts.length].y - pts[i].y);
      st.addMeasure({ id: uid('m'), kind: 'area', siteKey: st.site.key, points: pts, label: `Area ${st.inv.measurements.filter(m => m.kind === 'area').length + 1}`, values: { 'area m²': polygonArea(pts), 'area km²': polygonArea(pts) / 1e6, 'perimeter m': perim } });
    }
    st.set({ draft: [] });
  }, []);
  useEffect(() => {
    if (!view) return;
    view.onPick = p => {
      const st = usePlanet.getState(), cur = st.site; if (!cur) return; const tool = st.tool, f = cur.field;
      if (tool === 'inspect') { st.set({ selection: p }); return; }
      if (tool === 'distance') {
        const pts = [...st.draft, { x: p.x, y: p.y }];
        if (pts.length < 2) { st.set({ draft: pts }); return; }
        const len = pathLength(f, pts), pr = profile(f, pts), a = pr[0].elevation, b = pr.at(-1)!.elevation, dh = a !== null && b !== null ? b - a : null, los = lineOfSight(f, pts[0], pts[1]);
        st.addMeasure({ id: uid('m'), kind: 'distance', siteKey: cur.key, points: pts, label: `Distance ${st.inv.measurements.filter(m => m.kind === 'distance').length + 1}`, values: { 'plan m': len.plan, 'surface m': len.surface, 'height difference m': dh, 'mean grade °': dh !== null ? (Math.atan2(dh, len.plan) * 180) / Math.PI : null, 'line of sight (1 = clear)': los === 'clear' ? 1 : los === 'blocked' ? 0 : null } });
        st.set({ draft: [] }); return;
      }
      if (tool === 'profile' || tool === 'area') { st.set({ draft: [...st.draft, { x: p.x, y: p.y }] }); return; }
      if (tool.startsWith('mark-')) { const kind = tool.slice(5) as MarkKind, ll = siteLatLon(cur, p); st.addMark({ id: uid('k'), kind, label: `${MARK_LABEL[kind]} ${st.inv.marks.filter(m => m.kind === kind && m.siteKey === cur.key).length + 1}`, x: p.x, y: p.y, h: p.h, lat: ll.lat, lon: ll.lon, siteKey: cur.key, radiusM: kind === 'hazard' ? f.posting * 3 : undefined }); return; }
      const plan = st.plan ?? emptyPlan({ x: p.x, y: p.y }, morningStart(cur.sun)), xy = { x: p.x, y: p.y };
      if (tool === 'plan-start') st.set({ plan: { ...plan, start: xy, destination: st.plan ? plan.destination : xy }, run: null, tool: st.plan && plan.destination !== plan.start ? 'inspect' : 'plan-destination' });
      else if (tool === 'plan-destination') st.set({ plan: { ...plan, destination: xy }, run: null, tool: 'inspect' });
      else if (tool === 'plan-waypoint') st.set({ plan: { ...plan, waypoints: [...plan.waypoints, { id: uid('wp'), label: `Stop ${plan.waypoints.length + 1}`, activity: 'imaging', ...xy }] }, run: null });
      else if (tool === 'plan-hazard') st.set({ plan: { ...plan, hazards: [...plan.hazards, { id: uid('hz'), label: `Keep-out ${plan.hazards.length + 1}`, radiusM: Math.max(10, f.posting * 3), ...xy }] }, run: null });
    };
  }, [view]);
  useEffect(() => { view?.setSelection(s.selection && site ? { x: s.selection.x, y: s.selection.y, r: site.field.posting * 2.5 } : null); }, [view, s.selection, site]);

  // ── annotations and vehicle ───────────────────────────────────────────────
  useEffect(() => {
    if (!view || !site) return;
    const marks: Mark[] = s.inv.marks.filter(m => m.siteKey === site.key).map(m => ({ id: m.id, x: m.x, y: m.y, label: m.label, color: MARK_COLOR[m.kind] })), paths: PathDraw[] = [], rings: RingDraw[] = [];
    for (const m of s.inv.measurements.filter(m => m.siteKey === site.key)) paths.push({ id: m.id, points: m.points, color: m.id === activeProfile ? '#f2d38a' : '#9fd0c4', closed: m.kind === 'area', width: m.id === activeProfile ? 3 : 2 });
    if (s.draft.length) { paths.push({ id: 'draft', points: s.draft, color: '#f2efe6', dashed: true, closed: s.tool === 'area' && s.draft.length > 2 }); marks.push(...s.draft.map((p, i) => ({ id: `d${i}`, x: p.x, y: p.y, label: String(i + 1), color: '#f2efe6' }))); }
    for (const m of s.inv.marks.filter(m => m.siteKey === site.key && m.kind === 'hazard' && m.radiusM)) rings.push({ id: m.id, x: m.x, y: m.y, radiusM: m.radiusM!, color: MARK_COLOR.hazard });
    if (s.plan) {
      marks.push({ id: 'start', ...s.plan.start, label: 'START', color: '#e8c36a' });
      if (s.plan.destination !== s.plan.start) marks.push({ id: 'end', ...s.plan.destination, label: 'END', color: '#e8c36a' });
      marks.push(...s.plan.waypoints.map(w => ({ id: w.id, x: w.x, y: w.y, label: w.label, color: '#7fc8b8' })));
      rings.push(...s.plan.hazards.map(h => ({ id: h.id, x: h.x, y: h.y, radiusM: h.radiusM, color: '#e0705c' })));
    }
    if (s.run) { for (const r of s.run.result.alternatives) if (r.points && r.objective !== s.run.result.spec.objective) paths.push({ id: `alt-${r.objective}`, points: thin(r.points), color: '#8a8f98', dashed: true, width: 1.6 }); if (s.run.result.route) paths.push({ id: 'route', points: thin(s.run.result.route.points), color: s.run.result.outcome === 'completed' ? '#e8c36a' : '#e0705c', width: 3 }); }
    if (s.baseline?.result.route && s.baseline !== s.run) paths.push({ id: 'baseline', points: thin(s.baseline.result.route.points), color: '#6fa8dc', dashed: true, width: 2 });
    if (appearance.craters) rings.push(...site.objects.filter(o => o.kind === 'crater').map(o => ({ id: o.id, x: o.x, y: o.y, radiusM: o.radiusM, color: '#c9a45c' })));
    view.setAnnotations({ marks, paths, rings });
  }, [view, site, s.inv.marks, s.inv.measurements, s.draft, s.tool, s.plan, s.run, s.baseline, appearance.craters, activeProfile]);
  useEffect(() => {
    if (!view || !site) return;
    if (!s.run || !s.run.result.frames.length) { view.setRover(null); return; }
    const r = s.run.rover; view.setRover({ length: r.wheelbase, track: r.track, wheelRadius: r.wheelRadius, wheelWidth: r.wheelWidth, wheels: r.wheels, clearance: r.groundClearance, solar: r.generation.kind === 'solar' });
    setPlayT(0); setPlaying(false);
  }, [view, site, s.run]);
  const frame = s.run ? telemetryAt(s.run.result, playT) : null;
  useEffect(() => { if (view && s.run) view.setRoverPose(frame ? { x: frame.x, y: frame.y, headingDeg: frame.headingDeg, pitchDeg: frame.pitchDeg, rollDeg: frame.rollDeg, distance: frame.distance } : null); }, [view, s.run, frame]);
  useEffect(() => {
    if (!playing || !s.run) return; const dur = s.run.summary.durationS; let raf = 0, last = performance.now();
    const tick = (now: number) => { const dt = (now - last) / 1000; last = now; setPlayT(t => { const n = t + dt * (dur / 24); if (n >= dur) { setPlaying(false); return dur; } return n; }); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [playing, s.run]);

  // ── intelligence actions, shortcuts ───────────────────────────────────────
  const execute = useCallback((a: IntelAction) => {
    const st = usePlanet.getState();
    if (a.kind === 'stage') { if (a.payload === 'atlas') navigate('atlas'); else st.setStage(a.payload as Stage); }
    else if (a.kind === 'fly-to') { st.setStage('inspect'); viewRef.current?.flyTo(a.payload as XY); }
    else if (a.kind === 'layer') { st.setStage('inspect'); setApp(x => ({ ...x, layer: a.payload as LayerId })); }
    else if (a.kind === 'select-window') { st.patchInv({ candidates: st.inv.candidates.includes(a.payload as string) ? st.inv.candidates : [...st.inv.candidates, a.payload as string].slice(-8) }); st.set({ stage: 'discover' }); window.dispatchEvent(new CustomEvent('egiz-planet-select', { detail: a.payload })); }
    else if (a.kind === 'apply-plan' && st.site) { const p = a.payload as Partial<MissionPlan>; st.set({ plan: { ...emptyPlan(p.start!, morningStart(st.site.sun)), ...p } as MissionPlan, run: null, stage: 'simulate', tool: 'inspect' }); }
  }, [navigate]);
  useEffect(() => {
    const key = (ev: KeyboardEvent) => {
      const el = ev.target as HTMLElement, typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable), st = usePlanet.getState();
      if ((ev.key === 'k' && (ev.ctrlKey || ev.metaKey)) || (ev.key === '/' && !typing)) { ev.preventDefault(); st.set({ intelOpen: true }); window.setTimeout(() => document.getElementById('pl-ask')?.focus(), 30); return; }
      if (typing || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (ev.key === 'Escape') { st.set({ draft: [], tool: 'inspect' }); return; }
      if (ev.key === '\\') { st.set({ panelOpen: !st.panelOpen }); return; }
      if (ev.key === 'Enter' && st.draft.length) { finishDraft(); return; }
      const stg = STAGES[Number(ev.key) - 1]; if (stg) { st.setStage(stg.id); return; }
      const tool = ({ i: 'inspect', d: 'distance', p: 'profile', a: 'area' } as Record<string, Tool>)[ev.key.toLowerCase()]; if (tool && st.site && (st.stage === 'inspect' || st.stage === 'simulate')) { st.set({ tool, draft: [] }); return; }
      const preset = ({ o: 'overview', t: 'top', b: 'oblique', g: 'surface' } as const)[ev.key.toLowerCase() as 'o' | 't' | 'b' | 'g']; if (preset) viewRef.current?.preset(preset);
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [finishDraft]);

  const ctl: Ctl = { view, compute: computeRef.current, appearance, setAppearance, built, insolation, insolating, computeInsolation, open, execute, finishDraft, playT, setPlayT, playing, setPlaying, activeProfile, setActiveProfile };
  const hoverInfo = hover && site ? { ll: siteLatLon(site, hover), slope: slopeDeg(site.field, hover), aspect: aspectDeg(site.field, hover) } : null;
  const mPerPx = pose && view ? (2 * pose.range * Math.tan((42 * Math.PI) / 360)) / Math.max(1, view.renderer.domElement.clientHeight) : null, bar = mPerPx ? niceLength(mPerPx * 110) : null;
  const profileRec = s.inv.measurements.find(m => m.id === activeProfile && m.siteKey === site?.key), profilePts = profileRec && site ? profile(site.field, profileRec.points) : null;
  const layerDef = LAYERS.find(l => l.id === appearance.layer);

  return <CtlContext.Provider value={ctl}><div className={`pl-root stage-${stage} ${s.intelOpen ? 'intel-open' : ''} ${s.notesOn ? 'notes-on' : ''}`}>
    <header className="pl-top">
      <button className="pl-brand" onClick={() => openWorkspace(usePlanet.getState().world() ? 'mission' : 'home')} aria-label={usePlanet.getState().world() ? 'EGIZ — Mission Home' : 'EGIZ home'}><EgizMark /><span>EGIZ</span><em>Planetary Studio</em></button>
      <nav className="pl-stages" aria-label="Workflow stages">{STAGES.map((st, i) => <button key={st.id} className={stage === st.id ? 'on' : ''} aria-current={stage === st.id ? 'step' : undefined} title={`${st.hint} (${i + 1})`} onClick={() => s.setStage(st.id)}><b>{i + 1}</b>{st.label}</button>)}</nav>
      <input className="pl-title" aria-label="Investigation title" value={s.inv.title} onChange={e => s.patchInv({ title: e.target.value })} />
      <span className="pl-context" title="Active context shared by every stage">{target ? target.id : 'no target'}{site ? ` · ${site.id}` : ''}{s.inv.candidates.length ? ` · ${s.inv.candidates.length} candidate${s.inv.candidates.length > 1 ? 's' : ''}` : ''}</span>
      <button className={`pl-ask-toggle ${s.intelOpen ? 'on' : ''}`} onClick={() => s.set({ intelOpen: !s.intelOpen })} aria-pressed={s.intelOpen} title="Research assistant (Ctrl+K or /)"><MessageSquareText size={15} />Ask</button>
      <WorkspaceSwitcher toggleClass="pl-ask-toggle" label="Tools" />
    </header>
    <div className="pl-body">
      <main className="pl-main">
        {stage === 'discover' && <DiscoverStage />}
        {stage === 'report' && <ReportPanel />}
        <section className="pl-scene" hidden={!show3d} aria-label="3D terrain">
          <div className="pl-views"><div ref={host} className="pl-host" />{stage === 'compare' && <ComparePanel.Viewport />}</div>
          {s.siteStatus !== 'ready' && <div className="pl-overlay" role="status">
            {s.siteStatus === 'loading' && <><span className="eg-loading-bar" aria-hidden="true" /><p>{s.siteMessage}</p></>}
            {s.siteStatus === 'error' && <><TriangleAlert size={22} /><p role="alert">{s.siteMessage}</p></>}
            {s.siteStatus === 'idle' && <><Mountain size={24} /><p>Choose a site</p></>}
            {s.siteStatus !== 'loading' && <div className="pl-sitepick">{s.refs.map(r => <button key={r.key} onClick={() => open({ ref: r })}><b>{BODY_LABEL[r.body]}</b>{r.name}<em>{r.postingM} m · {(r.extentM / 1000).toFixed(1)} km</em></button>)}{!s.refs.length && <p className="pl-empty">No world package is built. Run <code>make world</code>, or open an Earth candidate from Discover to stream its terrain.</p>}</div>}
          </div>}
          {site && view && <>
            <div className="pl-hud pl-hud-tl">
              <strong>{site.name}</strong>
              <span>{BODY_LABEL[site.body]} · {site.field.posting} m · <em className={`pl-ev ev-${site.provenance.delivery}`}>{site.provenance.delivery}</em></span>
              {appearance.exaggeration !== 1 && <span className="pl-warn">Vertical exaggeration ×{appearance.exaggeration} — display only</span>}
              {mode.unavailable?.(site) && <span className="pl-warn">{mode.unavailable(site)}</span>}
            </div>
            <div className="pl-hud pl-hud-tr" role="toolbar" aria-label="Camera">
              {(['overview', 'top', 'oblique', 'surface'] as const).map(p => <button key={p} onClick={() => view.preset(p)} title={`${p} view (${{ overview: 'O', top: 'T', oblique: 'B', surface: 'G' }[p]})`}>{p}</button>)}
              <button onClick={() => { const p = view.getPose(); usePlanet.getState().addView({ id: uid('v'), name: `View ${s.inv.views.filter(v => v.siteKey === site.key).length + 1}`, siteKey: site.key, pose: p }); }} title="Save this camera position">save view</button>
            </div>
            {stage !== 'compare' && <div className="pl-hud pl-hud-tools" role="toolbar" aria-label="Terrain tools">
              {([['inspect', Crosshair, 'Inspect (I)'], ['distance', Ruler, 'Distance (D)'], ['profile', Mountain, 'Profile (P)'], ['area', Layers, 'Area (A)']] as const).map(([id, Icon, label]) => <button key={id} className={s.tool === id ? 'on' : ''} aria-pressed={s.tool === id} title={label} onClick={() => s.set({ tool: id, draft: [] })}><Icon size={15} /></button>)}
            </div>}
            {s.tool !== 'inspect' && <div className="pl-hud pl-hud-hint" aria-live="polite">{TOOL_HINT[s.tool]}{s.draft.length > 0 && (s.tool === 'profile' || s.tool === 'area') && <button onClick={finishDraft}>finish (Enter)</button>}</div>}
            <div className="pl-hud pl-hud-bl">
              {hover && hoverInfo ? <><span>{hoverInfo.ll.lat.toFixed(5)}°, {hoverInfo.ll.lon.toFixed(5)}°</span><span>x {hover.x.toFixed(1)} y {hover.y.toFixed(1)} m</span><span>z {hover.h.toFixed(2)} m</span><span>slope {hoverInfo.slope === null ? '—' : `${hoverInfo.slope.toFixed(1)}°`}</span></> : null}
            </div>
            <div className="pl-hud pl-hud-br">
              {bar && mPerPx && <span className="pl-scalebar"><i style={{ width: `${bar / mPerPx}px` }} />{fmtM(bar)}</span>}
              {pose && <span title="Camera heading"><Compass size={12} /> {pose.headingDeg.toFixed(0)}°</span>}
              {stats && <span className="pl-dim" title="Finest terrain posting drawn now vs the analysis grid. Measurements always use the analysis grid.">{stats.finestPostingM} m{stats.pending ? ' · loading' : ''}</span>}
            </div>
            <div className="pl-sunbar">
              {sun && site.sun ? <>
                <SunDial azimuthDeg={sun.azimuthDeg} elevationDeg={sun.elevationDeg} />
                <div className="pl-sunread"><b><Sun size={12} /> {sun.utc.toISOString().slice(0, 16).replace('T', ' ')} UTC</b><span>{sun.elevationDeg.toFixed(1)}° elevation · {sun.azimuthDeg.toFixed(0)}° azimuth</span>
                  <span className="pl-dim">{mode.shade === 'physical' ? (shadowBusy ? 'computing terrain shadows…' : 'computed terrain shadows (horizon march)') : mode.shade === 'hillshade' ? 'simplified cartographic light — not this Sun' : 'unlit'} · {site.sun.engine.includes('CSPICE') ? 'CSPICE' : 'analytic ephemeris'}</span></div>
                <input type="range" aria-label="Scene time" min={0} max={site.sun.duration} step={site.sun.step} value={s.timeS} onChange={e => s.set({ timeS: Number(e.target.value) })} />
              </> : <span className="pl-dim">No Sun record for this site: scene is lit by a fixed visual light.</span>}
              {s.run && <div className="pl-play"><button onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause replay' : 'Play replay'}>{playing ? <Pause size={14} /> : <Play size={14} />}</button>
                <input type="range" aria-label="Mission replay time" min={0} max={s.run.summary.durationS || 1} step={1} value={playT} onChange={e => { setPlaying(false); setPlayT(Number(e.target.value)); }} />
                <span>{(playT / 3600).toFixed(2)} h{frame ? ` · ${frame.batteryWh.toFixed(0)} Wh · slip ${(frame.slip * 100).toFixed(0)} %` : ''} <em className="pl-ev ev-simulated">simulated</em></span>
                <button onClick={() => view.setFollow(true)} title="Camera follows the rover">follow</button></div>}
            </div>
            {built && layerDef && <div className="pl-hud pl-hud-legend"><b>{layerDef.label} <em className={`pl-ev ev-${layerDef.evidence.replace('-', '')}`}>{layerDef.evidence}</em></b><Legend map={layerDef.map} lo={built.lo} hi={built.hi} unit={layerDef.unit} classes={built.classes} />{built.note && <span className="pl-dim">{built.note}</span>}</div>}
            {layerDef?.needs === 'insolation' && !insolation && <div className="pl-hud pl-hud-legend"><span>{insolating ?? 'Solar integration not yet computed.'}</span></div>}
            {profilePts && profileRec && stage !== 'compare' && <div className="pl-dock"><header><b>{profileRec.label}</b><span>{Object.entries(profileRec.values).map(([k, v]) => `${k} ${v === null ? '—' : v.toFixed(1)}`).join(' · ')}</span><button onClick={() => setActiveProfile(null)} aria-label="Close profile">×</button></header><ProfileChart points={profilePts} /></div>}
          </>}
          {notice && <div className="pl-notice" role="alert"><TriangleAlert size={14} />{notice}<button onClick={() => setNotice(null)} aria-label="Dismiss">×</button></div>}
        </section>
      </main>
      {show3d && <PanelShell label={`${stage} controls`}>{stage === 'inspect' ? <InspectPanel /> : stage === 'simulate' ? <SimulatePanel /> : <ComparePanel />}</PanelShell>}
      {s.intelOpen && <IntelPanel />}
    </div>
  </div></CtlContext.Provider>;
}
function thin(points: XY[], max = 600): XY[] { if (points.length <= max) return points; const step = Math.ceil(points.length / max), out = points.filter((_, i) => i % step === 0); if (out.at(-1) !== points.at(-1)) out.push(points.at(-1)!); return out; }
function niceLength(m: number) { const p = 10 ** Math.floor(Math.log10(m)), k = m / p; return (k >= 5 ? 5 : k >= 2 ? 2 : 1) * p; }
function niceContour(f: { z: Float32Array }) { const r = fieldRange(f as never), span = r.max - r.min; return niceLength(span / 12); }
