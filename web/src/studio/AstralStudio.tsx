// EGIZ ASTRAL Mission Studio: one workspace where the measured world, intelligence layer and mission
// simulator share state. Written with AI assistance (Claude); human scientific review pending.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { BrainCircuit, Compass, Download, FileUp, Gauge, GitCompare, Layers, Mountain, Pause, Play, Route as RouteIcon, ScrollText, Search, TriangleAlert, X } from 'lucide-react';
import { useAppStore } from '../state/store';
import { dataModeInfo } from '../data/modes';
import { loadAtlas } from '../atlas/AtlasLab';
import type { AtlasBundle } from '../atlas/types';
import { browserFetcher, World } from '../world/core/world';
import type { MapPoint, SceneObject } from '../world/core/types';
import { WorldView, type CameraMode, type OverlayMode, type QualityName, type ViewStats } from '../world/render/worldView';
import { bodiesAt, epochPlus } from '../world/analysis/illumination';
import { lunarLocalTime } from '../world/core/coordinates';
import { defaultMission, OBJECTIVE_LABEL, type MissionSpec } from '../world/sim/mission';
import { costModel, executePlan, traversabilityTexture, type PlanResult } from '../world/sim/pipeline';
import type { PlanningGrid } from '../world/sim/planner';
import { frameAt, simulate, type SimResult } from '../world/sim/traverse';
import { askLocal, type CopilotAnswer } from '../world/intelligence/copilot';
import { askLlm, llmAvailable, setLlmKey as setKey } from '../world/intelligence/llm';
import type { Selection, ToolCallLog, ToolContext, StudioAction } from '../world/intelligence/tools';
import { runQualityChecks, type QualityCheck } from '../world/intelligence/quality';
import { buildDossier } from '../world/report/dossier';
import { StudioContext, type Panel, type PickMode, type StudioApi, type Variant } from './api';
import { PanelBody } from './panels';
import { Inspector } from './Inspector';
import { Spark } from './charts';
import './studio.css';
import type Anthropic from '@anthropic-ai/sdk';

const WORLD_BASE = `${import.meta.env.BASE_URL}world/moon-mons-mouton/`;
const NAV: { id: Panel; label: string; icon: typeof Layers }[] = [
  { id: 'explore', label: 'Explore', icon: Layers }, { id: 'terrain', label: 'Terrain', icon: Mountain }, { id: 'intelligence', label: 'Intelligence', icon: BrainCircuit },
  { id: 'mission', label: 'Mission', icon: RouteIcon }, { id: 'simulate', label: 'Simulate', icon: Gauge }, { id: 'compare', label: 'Compare', icon: GitCompare }, { id: 'evidence', label: 'Evidence', icon: ScrollText },
];
const tick = () => new Promise<void>(r => setTimeout(r, 16));

export default function AstralStudio() {
  const { dataMode } = useAppStore();
  const [world, setWorld] = useState<World | null>(null);
  const [loading, setLoading] = useState('Loading world manifest…');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    World.load(browserFetcher(WORLD_BASE)).then(async w => {
      if (!alive) return;
      setLoading('Streaming the 5 m operational terrain…');
      await w.ensureOperational(undefined, (d, n) => alive && setLoading(`Streaming the 5 m operational terrain · ${d}/${n} measured tiles`));
      if (alive) setWorld(w);
    }).catch(e => alive && setError(String(e instanceof Error ? e.message : e)));
    return () => { alive = false; };
  }, []);
  if (error) return <main className="astral astral-state" role="alert"><TriangleAlert size={28} /><h1>World package unavailable</h1><p>{error}</p><p className="astral-muted">Build it with <code>make world</code> (python -m pipeline.world build), then reload. No synthetic terrain is substituted.</p></main>;
  if (!world) return <main className="astral astral-state" aria-busy="true"><span className="eg-loading-bar" aria-hidden="true" /><h1>EGIZ ASTRAL</h1><p>{loading}</p></main>;
  return <Studio world={world} dataMode={dataMode} />;
}

function Studio({ world, dataMode }: { world: World; dataMode: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<WorldView | null>(null);
  const [panel, setPanel] = useState<Panel>('explore');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [overlay, setOverlayState] = useState<OverlayMode>('none');
  const [slopeLimit, setSlopeLimit] = useState(15);
  const [contours, setContours] = useState(0);
  const [illustrative, setIllustrative] = useState(false);
  const [rockK, setRockK] = useState(0.02);
  const [showAll, setShowAll] = useState(true);
  const [highlight, setHighlight] = useState<{ ids: string[]; label: string } | null>(null);
  const [cameraMode, setCameraModeState] = useState<CameraMode>('orbit');
  const [quality, setQualityState] = useState<QualityName>('balanced');
  const [stats, setStats] = useState<ViewStats | null>(null);
  const [exposure, setExposure] = useState(4.2);
  const [mission, setMission] = useState<MissionSpec>(() => defaultMission(world));
  const [time, setTimeState] = useState(() => mission.departureT);
  const [sunPlaying, setSunPlaying] = useState(false);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [planning, setPlanning] = useState<string | null>(null);
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);
  const [playback, setPlayback] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pbSpeed, setPbSpeed] = useState(600);
  const [pickMode, setPickMode] = useState<PickMode>('inspect');
  const [profilePts, setProfilePts] = useState<MapPoint[]>([]);
  const [answers, setAnswers] = useState<CopilotAnswer[]>([]);
  const [asking, setAsking] = useState(false);
  const [llmOn, setLlmOn] = useState(llmAvailable());
  const [variants, setVariants] = useState<Variant[]>([]);
  const [checks, setChecks] = useState<QualityCheck[] | null>(null);
  const [atlas, setAtlas] = useState<AtlasBundle | null>(null);
  const [hover, setHover] = useState<(MapPoint & { h: number }) | null>(null);
  const [command, setCommand] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const toolLog = useRef<ToolCallLog[]>([]).current;
  const gridRef = useRef<PlanningGrid | null>(null);
  const llmHistory = useRef<Anthropic.Beta.BetaMessageParam[]>([]);
  const labels = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => { panelRef.current?.scrollTo({ top: 0 }); }, [panel]);
  const state = useRef({ plan, activeRouteId, mission, selection, time, playback });
  state.current = { plan, activeRouteId, mission, selection, time, playback };

  // ---- 3D view lifecycle ----
  useEffect(() => {
    if (!host.current) return;
    let v: WorldView;
    try { v = new WorldView(host.current, world); } catch (e) { setToast(`3D view unavailable: ${e instanceof Error ? e.message : String(e)}. Analysis tools still work.`); return; }
    v.enableFineShadows();
    v.onStats = setStats; v.onHover = setHover;
    setQualityState(v.qualityName); setView(v);
    (window as unknown as { __astral?: unknown }).__astral = { view: v, world };
    return () => { v.dispose(); setView(null); };
  }, [world]);
  useEffect(() => { if (!dataMode || dataMode === 'demo') return; const c = new AbortController(); loadAtlas(fetch, dataModeInfo[dataMode as 'pilot'].path, c.signal).then(setAtlas).catch(() => setAtlas(null)); return () => c.abort(); }, [dataMode]);

  const activeSim: SimResult | null = plan && activeRouteId ? plan.sims[activeRouteId] ?? null : null;
  const setTime = useCallback((t: number) => { const c = Math.max(0, Math.min(world.illumination.duration, t)); setTimeState(c); view?.setTime(c); }, [view, world]);
  useEffect(() => { view?.setTime(time); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  const setOverlay = useCallback((m: OverlayMode, limit?: number) => {
    setOverlayState(m); if (limit !== undefined) setSlopeLimit(limit);
    view?.setOverlay(m, { slopeLimit: limit ?? slopeLimit });
  }, [view, slopeLimit]);
  useEffect(() => { view?.setContours(contours); }, [view, contours]);
  useEffect(() => { view?.setExposure(exposure); }, [view, exposure]);
  useEffect(() => { view?.setIllustrative(illustrative, rockK); }, [view, illustrative, rockK]);
  const setCameraMode = useCallback((m: CameraMode) => { setCameraModeState(m); view?.setCameraMode(m); }, [view]);
  const setQuality = useCallback((q: QualityName) => { view?.setQuality(q); setQualityState(q); if (view) view.autoQuality = false; }, [view]);

  // ---- Scene objects: detections + mission markers, one id space ----
  const missionObjects = useMemo<SceneObject[]>(() => {
    const mk = (id: string, p: MapPoint, label: string): SceneObject => ({ id, type: 'waypoint', evidenceClass: 'reference', x: p.x, y: p.y, lon: 0, lat: 0, radius: 0, confidence: null, properties: { label }, provenance: { modelId: null, input: 'mission specification', sourceSha256: '' } });
    return [mk('wp-start', mission.start, 'A · start'), ...(mission.destination ? [mk('wp-destination', mission.destination, 'B · destination')] : []), ...mission.waypoints.map(w => mk(w.id, w, w.label))];
  }, [mission]);
  useEffect(() => {
    if (!view) return;
    const hl = highlight ? new Set(highlight.ids) : null;
    view.setObjects([...world.objects, ...missionObjects], o => o.type === 'waypoint' || (hl ? hl.has(o.id) : showAll) || (state.current.selection?.kind === 'object' && state.current.selection.id === o.id));
  }, [view, world, missionObjects, highlight, showAll, selection]);

  // ---- Routes, rover, tracks ----
  useEffect(() => {
    if (!view) return;
    const colors: Record<string, string> = { shortest: '#9aa4ad', safest: '#7fc3a6', energy: '#e3b65c', illumination: '#f0e6c8' };
    view.setRoutes((plan?.routes ?? []).filter(r => r.feasible).map(r => ({ id: r.id, points: r.points, color: colors[r.objective], width: r.id === activeRouteId ? 4 : 2, selected: r.id === activeRouteId, dashed: r.id !== activeRouteId })));
    const sim = plan && activeRouteId ? plan.sims[activeRouteId] : null;
    view.setRover(sim ? sim.rover : null);
    if (sim) { view.setRoverFrame(frameAt(sim.frames, state.current.playback)); view.setTracks(sim.frames, state.current.playback); }
  }, [view, plan, activeRouteId]);

  // ---- Playback loop: rover state AND scene time advance together ----
  useEffect(() => {
    if (!playing || !activeSim || !view) return;
    let raf = 0, last = performance.now(), lastUi = 0, lastTracks = 0, pb = state.current.playback;
    const end = activeSim.frames[activeSim.frames.length - 1].t;
    const step = (now: number) => {
      pb = Math.min(end, pb + (now - last) / 1000 * pbSpeed); last = now;
      const f = frameAt(activeSim.frames, pb);
      view.setRoverFrame(f); view.setTime(activeSim.spec.departureT + pb);
      if (now - lastTracks > 900) { view.setTracks(activeSim.frames, pb); lastTracks = now; }
      if (now - lastUi > 120) { setPlayback(pb); setTimeState(activeSim.spec.departureT + pb); lastUi = now; }
      if (pb >= end) { setPlayback(end); setPlaying(false); view.setTracks(activeSim.frames, end); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, activeSim, view, pbSpeed]);
  const seek = useCallback((t: number) => {
    if (!activeSim || !view) return;
    setPlayback(t); view.setRoverFrame(frameAt(activeSim.frames, t)); view.setTracks(activeSim.frames, t); setTime(activeSim.spec.departureT + t);
  }, [activeSim, view, setTime]);
  // Sun animation without a mission.
  useEffect(() => {
    if (!sunPlaying) return;
    let raf = 0, last = performance.now(), t = state.current.time;
    const step = (now: number) => { t = (t + (now - last) / 1000 * 3 * 3600) % world.illumination.duration; last = now; setTime(t); raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [sunPlaying, setTime, world]);

  // ---- Selection & picking ----
  const select = useCallback((s: Selection | null, fly = false) => {
    setSelection(s);
    if (!view) return;
    if (!s) { view.setSelection(null); return; }
    const o = s.kind === 'object' ? world.object(s.id) ?? missionObjects.find(m => m.id === s.id) : null;
    const p = o ?? (s.kind === 'point' ? s : null);
    if (!p) return;
    view.setSelection({ x: p.x, y: p.y, r: o && o.radius > 0 ? o.radius : 6 });
    if (fly) view.flyTo(p, { distance: o && o.radius > 0 ? Math.max(160, o.radius * 4) : 240 });
  }, [view, world, missionObjects]);
  useEffect(() => {
    if (!view) return;
    view.onPick = ({ point, objectId }) => {
      const p = { x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 };
      if (pickMode === 'profile') { setProfilePts(prev => prev.length >= 2 ? [p] : [...prev, p]); return; }
      if (pickMode === 'start' || pickMode === 'destination' || pickMode === 'waypoint') {
        if (!world.inOperational(p)) { setToast('Mission points must lie inside the 5 m operational box (gold outline).'); return; }
        setMission(m => pickMode === 'start' ? { ...m, start: p } : pickMode === 'destination' ? { ...m, destination: p, returnToStart: false } : { ...m, waypoints: [...m.waypoints, { id: `wp-${m.waypoints.length + 1}`, x: p.x, y: p.y, dwellS: 1800, instrumentIds: ['nss', 'nirvss', 'cams'], label: `S${m.waypoints.length + 1} · user stop` }] });
        setPickMode('inspect'); return;
      }
      select(objectId ? { kind: 'object', id: objectId } : { kind: 'point', ...p });
    };
  }, [view, pickMode, select, world]);

  // ---- Planning pipeline ----
  const runPlan = useCallback(async (specArg?: MissionSpec) => {
    const spec = specArg ?? state.current.mission;
    setPlaying(false); setPlanning('Validating the mission specification…'); await tick();
    try {
      const { result, grid } = await executePlan(world, spec, gridRef.current, async stage => { setPlanning(stage); await tick(); });
      if (grid) gridRef.current = grid;
      setPlan(result);
      state.current.plan = result;
      if (result.validation.ok && grid) {
        const tex = traversabilityTexture(grid, spec, costModel(spec));
        view?.setTraversability(tex.rgba, tex.width, tex.height, tex.geo);
        const pick = result.routes.find(r => r.feasible && r.objective === spec.preferred) ?? result.routes.find(r => r.feasible);
        setActiveRouteId(pick?.id ?? null); state.current.activeRouteId = pick?.id ?? null; setPlayback(0); setTime(spec.departureT);
      }
      return result;
    } finally { setPlanning(null); }
  }, [world, view, setTime]);

  const download = useCallback((name: string, text: string, mime: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);
  const dossier = useCallback(async () => {
    const p = state.current.plan;
    if (!p) throw new Error('No plan');
    return buildDossier({ world, spec: p.spec, validation: p.validation, routes: p.routes, sims: p.sims, activeRouteId: state.current.activeRouteId, copilotLog: toolLog.map(l => ({ at: l.at, tool: l.tool, args: l.args, summary: l.summary })), routeChecks: p.checks });
  }, [world, toolLog]);

  // ---- Copilot ----
  const applyAction = useCallback((a: StudioAction) => {
    switch (a.type) {
      case 'flyTo': view?.flyTo(a, { distance: a.distance }); break;
      case 'overlay': setOverlay(a.mode, a.slopeLimit); break;
      case 'select': select(a.selection, true); state.current.selection = a.selection; break;
      case 'highlight': setHighlight({ ids: a.ids, label: a.label }); break;
      case 'time': setTime(a.t); state.current.time = a.t; break;
      case 'mission': setMission(a.spec); state.current.mission = a.spec; break;
      case 'activeRoute': setActiveRouteId(a.id); state.current.activeRouteId = a.id; setPlayback(0); break;
      case 'play': setPlaying(true); break;
      case 'panel': setPanel(a.panel); break;
      case 'download': download(a.name, a.text, a.mime); break;
    }
  }, [view, setOverlay, select, setTime, download]);
  // Getters read live state so a tool sees the effects of the previous tool in the same request.
  const toolContext = useCallback((): ToolContext => ({
    world,
    get selection() { return state.current.selection; }, get mission() { return state.current.mission; }, get plan() { return state.current.plan; },
    get activeRouteId() { return state.current.activeRouteId; }, get time() { return state.current.time; },
    get viewTarget() { return view ? view.fromScene(view.controls.target) : { x: 0, y: 0 }; }, atlas, slopeLimit,
    apply: applyAction,
    planMission: async spec => (await runPlan(spec))!,
    simulateVariant: (spec, route) => simulate(world, spec, route, {}),
    dossier,
    fetchTileRaw: key => fetch(`${WORLD_BASE}tiles/${key}.egt`).then(r => r.arrayBuffer()),
  }), [world, view, atlas, slopeLimit, applyAction, runPlan, dossier]);
  const ask = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setAsking(true); setPanel('intelligence');
    try {
      const ans = llmAvailable() ? await askLlm(text, toolContext(), llmHistory.current) : await askLocal(text, toolContext());
      toolLog.push(...ans.tools.filter(t => !toolLog.includes(t)));
      setAnswers(a => [...a, ans]);
    } catch (e) {
      setAnswers(a => [...a, { id: `e${Date.now()}`, request: text, provider: llmAvailable() ? 'llm' : 'local', headline: 'The request failed.', sections: [], citations: [], tools: [], declined: e instanceof Error ? e.message : String(e) }]);
    } finally { setAsking(false); }
  }, [toolContext, toolLog]);

  const runChecks = useCallback(async () => { setChecks(await runQualityChecks(world, key => fetch(`${WORLD_BASE}tiles/${key}.egt`).then(r => r.arrayBuffer()))); }, [world]);

  // ---- On-scene labels for mission markers and the selection ----
  useEffect(() => {
    if (!view) return;
    const id = setInterval(() => {
      const el = labels.current; if (!el) return;
      const items = [...missionObjects.map(o => ({ key: o.id, x: o.x, y: o.y, text: String(o.properties.label) })),
        ...(selection?.kind === 'object' && world.object(selection.id) ? [{ key: 'sel', x: world.object(selection.id)!.x, y: world.object(selection.id)!.y, text: selection.id }] : [])];
      el.replaceChildren(...items.map(it => {
        const h = view.surface(it.x, it.y), p = view.project(it.x, it.y, h + 16);
        const d = document.createElement('span'); d.className = 'astral-label'; d.textContent = it.text;
        d.style.transform = `translate(${p.sx.toFixed(0)}px, ${p.sy.toFixed(0)}px)`; d.style.display = p.visible ? '' : 'none';
        return d;
      }));
    }, 120);
    return () => clearInterval(id);
  }, [view, missionObjects, selection, world]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 5200); return () => clearTimeout(t); }, [toast]);
  // Keyboard: Escape clears selection / pick mode; "/" focuses the command bar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.matches?.('input, textarea, select');
      if (e.key === 'Escape') { setPickMode('inspect'); select(null); setHighlight(null); }
      if (e.key === '/' && !typing) { e.preventDefault(); document.getElementById('astral-command')?.focus(); }
      if (e.key === ' ' && !typing && activeSim && (e.target as HTMLElement)?.tagName !== 'BUTTON') { e.preventDefault(); setPlaying(p => !p); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [select, activeSim]);

  const api: StudioApi = {
    world, view, panel, setPanel, selection, select, overlay, slopeLimit, setOverlay, contours, setContours, illustrative, setIllustrative, rockK, setRockK,
    showAll, setShowAll, highlight, setHighlight, cameraMode, setCameraMode, quality, setQuality, stats, exposure, setExposure, time, setTime,
    mission, setMission, plan, planning, runPlan, activeRouteId, setActiveRoute: id => { setActiveRouteId(id); setPlayback(0); setPlaying(false); },
    playback, playing, setPlaying, seek, pbSpeed, setPbSpeed, pickMode, setPickMode, profilePts, setProfilePts,
    answers, ask, asking, toolLog, llmOn, setLlmKey: k => { setKey(k); setLlmOn(llmAvailable()); llmHistory.current = []; },
    variants, addVariant: v => setVariants(vs => [...vs, v]), clearVariants: () => setVariants([]),
    quality_checks: checks, runChecks, atlas, download, dossier, activeSim,
  };

  const submitCommand = (e: FormEvent) => { e.preventDefault(); const t = command; setCommand(''); void ask(t); };
  const sun = bodiesAt(world.illumination, time);
  const sunSeries = useMemo(() => world.illumination.samples.map(s => Math.asin(s[3]) * 180 / Math.PI), [world]);
  const date = epochPlus(world.illumination, time);
  const pickHint: Record<PickMode, string> = { inspect: '', profile: profilePts.length === 1 ? 'Click the end point of the profile' : 'Click the start point of the profile', start: 'Click the terrain to set the start (A)', destination: 'Click the terrain to set the destination (B)', waypoint: 'Click the terrain to add a science stop' };

  return <StudioContext.Provider value={api}>
    <main className="astral" aria-label="EGIZ ASTRAL Mission Studio">
      <header className="astral-top">
        <div className="astral-id"><b>EGIZ ASTRAL</b><span className="astral-chip" title={world.manifest.name}><i className="moon" />Moon · Mons Mouton</span><span className="astral-chip subtle" title="Mission name">{mission.name}</span></div>
        <form className="astral-command" onSubmit={submitCommand} role="search">
          <Search size={15} aria-hidden="true" />
          <input id="astral-command" value={command} onChange={e => setCommand(e.target.value)} placeholder='Ask or command — e.g. "highlight possible boulder fields", "show slopes above 20 degrees", "start a rover simulation"  ( / )' aria-label="Command or question for the research copilot" autoComplete="off" />
          <span className="astral-provider" title={llmOn ? 'Remote LLM provider active (your key)' : 'Local deterministic copilot'}>{llmOn ? 'Claude' : 'Local'}</span>
        </form>
        <div className="astral-top-actions">
          <button className="astral-btn ghost" onClick={() => download(`mission-${mission.name.replace(/\W+/g, '-').toLowerCase()}.json`, JSON.stringify(mission, null, 2), 'application/json')} title="Save mission specification (JSON)"><Download size={14} />Save</button>
          <label className="astral-btn ghost" title="Load a mission specification JSON"><FileUp size={14} />Load<input type="file" accept="application/json" hidden onChange={async e => { const f = e.target.files?.[0]; if (!f) return; try { const spec = JSON.parse(await f.text()) as MissionSpec; setMission(spec); setPanel('mission'); setToast('Mission loaded — validate and plan to use it.'); } catch { setToast('That file is not a mission specification.'); } }} /></label>
          <button className="astral-btn" disabled={!plan} onClick={async () => { const d = await dossier(); download(`egiz-astral-dossier.md`, d.markdown, 'text/markdown'); }} title={plan ? 'Export the mission dossier' : 'Plan a mission first'}><ScrollText size={14} />Dossier</button>
        </div>
      </header>
      <nav className="astral-rail" aria-label="Studio sections">
        {NAV.map(n => <button key={n.id} className={panel === n.id ? 'on' : ''} aria-current={panel === n.id ? 'page' : undefined} onClick={() => setPanel(n.id)} title={n.label}><n.icon size={18} strokeWidth={1.5} /><span>{n.label}</span></button>)}
      </nav>
      <section ref={panelRef} className="astral-panel" aria-label={`${NAV.find(n => n.id === panel)!.label} panel`}><PanelBody /></section>
      <div className="astral-viewport">
        <div ref={host} className="astral-canvas-host" />
        <div ref={labels} className="astral-labels" aria-hidden="true" />
        {pickMode !== 'inspect' && <div className="astral-pick-hint" role="status">{pickHint[pickMode]} <button onClick={() => { setPickMode('inspect'); setProfilePts([]); }} aria-label="Cancel picking"><X size={13} /></button></div>}
        {planning && <div className="astral-progress" role="status" aria-live="polite"><span className="eg-loading-bar" aria-hidden="true" />{planning}</div>}
        {highlight && <div className="astral-highlight" role="status">{highlight.label}<button onClick={() => setHighlight(null)} aria-label="Clear highlight"><X size={13} /></button></div>}
        {toast && <div className="astral-toast" role="status">{toast}</div>}
        <div className="astral-hud" aria-label="View status">
          <span title="Finest level currently rendered">LOD L{stats?.maxLevel ?? 0} · {stats?.postingM ?? '—'} m posts</span>
          <span>{stats ? `${stats.fps.toFixed(0)} fps · ${stats.tiles} tiles · ${(stats.triangles / 1e6).toFixed(2)} M tris` : 'starting renderer…'}</span>
          {stats && stats.pending > 0 && <span className="astral-stream">streaming {stats.pending}</span>}
          <span className={illustrative ? 'astral-illus' : 'astral-sci'}>{illustrative ? 'VISUALIZATION MODE · illustrative detail shown' : 'SCIENTIFIC MODE · measured & attributed only'}</span>
          {!illustrative && stats && stats.cameraAltM < 80 && <span className="astral-scale-note">Viewing below the 5 m measured posting — no measured relief exists at this scale</span>}
        </div>
        <div className="astral-readout" aria-live="off">
          {hover ? <>x {hover.x.toFixed(0)} · y {hover.y.toFixed(0)} m · h {hover.h.toFixed(1)} m · {world.analysisLevel(hover) === world.maxLevel ? '5 m' : '20 m'} analysis</> : <>Drag to orbit · right-drag to pan · scroll to zoom · click to inspect</>}
        </div>
        <div className="astral-cams" role="group" aria-label="Camera mode">
          {(['orbit', 'plan', 'follow', 'rover', 'inspect'] as CameraMode[]).map(m => <button key={m} className={cameraMode === m ? 'on' : ''} disabled={(m === 'follow' || m === 'rover') && !activeSim || (m === 'inspect' && !selection)} onClick={() => setCameraMode(m)}>{m === 'rover' ? 'first-person' : m === 'plan' ? 'top-down' : m}</button>)}
          <button onClick={() => view?.flyTo({ x: (world.operationalBox[0] + world.operationalBox[2]) / 2, y: (world.operationalBox[1] + world.operationalBox[3]) / 2 }, { distance: 9000, pitchDeg: 38 })} title="Regional overview"><Compass size={13} /></button>
        </div>
      </div>
      <aside className={`astral-inspector ${selection ? 'has-sel' : ''}`} aria-label="Inspector"><Inspector /></aside>
      <footer className="astral-timeline" aria-label="Time and mission timeline">
        <div className="astral-time-controls">
          <button className="astral-icon" onClick={() => setSunPlaying(p => !p)} aria-label={sunPlaying ? 'Pause Sun animation' : 'Animate the Sun (3 h per second)'} disabled={playing}>{sunPlaying ? <Pause size={15} /> : <Play size={15} />}</button>
          <div className="astral-time-meta"><b>{date.toISOString().slice(0, 16).replace('T', ' ')} UTC</b><span>Sun {sun.sunElevationDeg.toFixed(2)}° el · {sun.sunAzimuthDeg.toFixed(0)}° az · lunar local {lunarLocalTime(sun.sunAzimuthDeg, true).toFixed(1)} h · Earth {sun.earthElevationDeg.toFixed(1)}°</span></div>
        </div>
        <div className="astral-scrub">
          <Spark values={sunSeries} marker={time / world.illumination.duration} />
          <input type="range" min={0} max={world.illumination.duration} step={600} value={time} onChange={e => { setPlaying(false); setTime(Number(e.target.value)); }} aria-label="Scene time within the 30-day SPICE record" aria-valuetext={date.toISOString()} />
          <span className="astral-scrub-label">SPICE Sun elevation · 30 days from {world.illumination.epochUtc.slice(0, 10)}</span>
        </div>
        {activeSim ? <div className="astral-mission-scrub">
          <button className="astral-icon" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause simulation playback' : 'Play simulation'}>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
          <div className="astral-scrub">
            <div className="astral-events">{activeSim.events.filter(e => e.kind !== 'info').map((e, i) => <button key={i} className={`ev ${e.kind}`} style={{ left: `${(e.t / Math.max(1, activeSim.summary.durationS)) * 100}%` }} title={e.message} onClick={() => seek(e.t)} aria-label={`Jump to ${e.kind}: ${e.message}`} />)}</div>
            <input type="range" min={0} max={activeSim.frames[activeSim.frames.length - 1].t} step={1} value={playback} onChange={e => { setPlaying(false); seek(Number(e.target.value)); }} aria-label="Mission elapsed time" aria-valuetext={`${(playback / 3600).toFixed(2)} hours`} />
            <span className="astral-scrub-label">{OBJECTIVE_LABEL[plan!.routes.find(r => r.id === activeRouteId)!.objective]} route · MET {(playback / 3600).toFixed(2)} / {(activeSim.summary.durationS / 3600).toFixed(2)} h · {activeSim.summary.status}</span>
          </div>
          <select value={pbSpeed} onChange={e => setPbSpeed(Number(e.target.value))} aria-label="Playback speed">{[60, 300, 600, 1800, 3600].map(s => <option key={s} value={s}>{s}×</option>)}</select>
        </div> : <div className="astral-mission-scrub empty">No simulation yet — plan a mission to rehearse it here.</div>}
      </footer>
    </main>
  </StudioContext.Provider>;
}
