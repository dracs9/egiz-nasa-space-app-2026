// EGIZ ASTRAL · Mission Studio. One workspace over one measured world: explore, interpret, plan, simulate, compare, export.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as T from "three";
import { Bot, Compass, Crosshair, Eye, FileDown, FlaskConical, Gauge, GitCompareArrows, Home, Layers3, LocateFixed, Map as MapIcon, Mountain, Pause, Play, Route as RouteIcon, Ruler, ScrollText, Send, Sun, Truck } from "lucide-react";
import { useAppStore } from "../../state/store";
import { downloadJson, downloadText } from "../../lib/download";
import { solarAt } from "../../mission/solar";
import { loadReferenceAsset } from "../../mission/scene/referenceAsset";
import { makeVehicle } from "../../mission/scene/vehicles";
import { profile, shadowMask, type XY } from "../world/field";
import { createWorldView, estimateQuality, type CameraMode, type Quality, type RoverPose, type ViewStats, type WorldView } from "../view/worldView";
import { ask, EXAMPLES, SECTION_LABEL, type ToolLog, type ToolResult } from "../intelligence/copilot";
import { modelsFor, STATUS_LABEL } from "../intelligence/registry";
import { TERRAIN_CLASSES, type Rock } from "../intelligence/perception";
import { ROVERS, SOILS, type RoverProfile } from "../sim/terramechanics";
import { buildNavGrid, type NavGrid, type Route } from "../sim/traverse";
import { simulateMission, telemetryAt, type MissionResult, type MissionSpec } from "../sim/mission";
import { analyzeScene, buildOverlay, detectRocksNear, inspectPoint, LAYERS, listWorlds, loadWorld, soilFromClasses, UNIT_COLORS, type LayerId, type SceneAnalysis, type WorldSession } from "./session";
import { runTool, type StudioHost } from "./tools";
import { buildDossier, dossierMarkdown } from "./dossier";
import "./studio.css";

type Panel = "explore" | "intelligence" | "mission" | "simulation" | "compare" | "evidence";
type PickMode = "inspect" | "start" | "destination" | "waypoint" | "measure";
type Appearance = "visualization" | "scientific" | "acquired";
interface Message { role: "user" | "copilot"; text?: string; results?: ToolResult[]; calls?: string[]; confirm?: { input: string; message: string } }
const PANELS: { id: Panel; label: string; icon: typeof Compass }[] = [
  { id: "explore", label: "Explore", icon: Compass }, { id: "intelligence", label: "Intelligence", icon: FlaskConical }, { id: "mission", label: "Mission", icon: RouteIcon },
  { id: "simulation", label: "Simulation", icon: Gauge }, { id: "compare", label: "Compare", icon: GitCompareArrows }, { id: "evidence", label: "Evidence", icon: ScrollText },
];
const ROUTE_COLOR: Record<string, string> = { safest: "#7fd6a8", energy: "#e8c25a", shortest: "#7fb4e8" };
const num = (v: number | null | undefined, d = 1, unit = "") => (v === null || v === undefined || Number.isNaN(v) ? "—" : `${v.toFixed(d)}${unit}`);
const clock = (s: number) => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
const defaultSpec = (siteId: string): MissionSpec => ({ version: "1.0.0", siteId, roverId: "m2020-class", surface: "dry-sand", start: { x: 0, y: 0 }, destination: { x: 0, y: 0 }, waypoints: [], objective: "safest", maxSlopeDeg: 18, reserveFraction: 0.25, startTimeS: 0, requireDaylight: false, fidelity: "fast" });

/** First recorded culmination of the Sun above the horizon (falls back to the highest sample). */
export const firstNoon = (g: { samples: { t: number; elevationDeg: number }[] }) => g.samples.find((x, i, all) => i > 0 && i < all.length - 1 && x.elevationDeg > 0 && x.elevationDeg >= all[i - 1].elevationDeg && x.elevationDeg > all[i + 1].elevationDeg) ?? g.samples.reduce((b, x) => (x.elevationDeg > b.elevationDeg ? x : b));
async function roverModel(profile: RoverProfile): Promise<{ object: T.Object3D; length: number; spin: ((p: RoverPose) => void) | null; note: string }> {
  if (profile.id === "m2020-class") {
    const asset = await loadReferenceAsset("perseverance"), box = new T.Box3().setFromObject(asset), size = box.getSize(new T.Vector3()), scale = 3 / Math.max(size.x, size.z), holder = new T.Group();
    asset.position.set(-(box.min.x + size.x / 2), -box.min.y, -(box.min.z + size.z / 2)); const turn = new T.Group(); turn.add(asset); turn.rotation.y = Math.PI; holder.add(turn); holder.scale.setScalar(scale); // source model faces +Z; the scene's forward is −Z
    return { object: holder, length: 3, spin: null, note: "NASA/JPL Perseverance model scaled to its published 3 m length. Shown as a rigid body: wheels and suspension are not articulated." };
  }
  const rig = makeVehicle("rover", { wheelRadius: profile.wheelRadius, wheelWidth: profile.wheelWidth, trackWidth: profile.track, wheelbase: profile.wheelbase, cgHeight: profile.cgHeight, suspensionTravel: 0.15, stallTorque: profile.wheelTorqueLimit, noLoadRpm: 20, motorPower: 80, solarArea: 1.6, solarEfficiency: 0.28, transmission: 0.6 });
  const base = rig.wheels.map(w => w.steer.position.y);
  const spin = (p: RoverPose) => rig.wheels.forEach((w, i) => { w.spin.rotation.x = -p.distance / profile.wheelRadius; const k = (w.z < -0.05 ? 0 : w.z > 0.05 ? 4 : 2) + (w.x > 0 ? 1 : 0); w.steer.position.y = base[i] + Math.max(-0.15, Math.min(0.15, p.wheelDz[k] ?? 0)); });
  return { object: rig.root, length: Math.max(2, profile.wheelbase * 1.8), spin, note: "Procedural EGIZ scenario vehicle built from the profile dimensions; wheels rotate with distance and follow the terrain under each contact." };
}

export default function MissionStudio() {
  const navigate = useAppStore(s => s.navigate), base = import.meta.env.BASE_URL;
  const host = useRef<HTMLDivElement>(null), view = useRef<WorldView | null>(null), toolLog = useRef<ToolLog[]>([]), navCache = useRef<{ key: string; grid: NavGrid } | null>(null), roverAsset = useRef<Awaited<ReturnType<typeof roverModel>> | null>(null), chatEnd = useRef<HTMLDivElement>(null), commandInput = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState<WorldSession | null>(null), [loading, setLoading] = useState<{ label: string; done: number; total: number } | null>({ label: "World index", done: 0, total: 1 }), [error, setError] = useState("");
  const [analysis, setAnalysis] = useState<SceneAnalysis | null>(null), [rocks, setRocks] = useState<Rock[]>([]), [busy, setBusy] = useState("");
  const [panel, setPanel] = useState<Panel>("explore"), [side, setSide] = useState<"inspector" | "copilot">("copilot"), [quality, setQuality] = useState<Quality>(() => estimateQuality());
  const [layer, setLayer] = useState<LayerId>("none"), [slopeAbove, setSlopeAbove] = useState<number | null>(null), [opacity, setOpacity] = useState(0.6), [appearance, setAppearance] = useState<Appearance>("visualization");
  const [selection, setSelection] = useState<XY | null>(null), [pickMode, setPickMode] = useState<PickMode>("inspect"), [measure, setMeasure] = useState<XY[]>([]);
  const [worldList, setWorldList] = useState<{ dir: string; name: string; body: string }[]>([]);
  const [spec, setSpec] = useState<MissionSpec>(defaultSpec("")), [rovers, setRovers] = useState<Record<string, RoverProfile>>(ROVERS), [result, setResult] = useState<MissionResult | null>(null), [baseline, setBaseline] = useState<MissionResult | null>(null);
  const [timeS, setTimeS] = useState(0), [missionT, setMissionT] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(600), [camera, setCamera] = useState<CameraMode>("site");
  const [stats, setStats] = useState<ViewStats | null>(null), [tiles, setTiles] = useState({ loaded: 0, pending: 0 }), [messages, setMessages] = useState<Message[]>([]), [command, setCommand] = useState(""), [roverNote, setRoverNote] = useState("");
  const live = useRef({ session, analysis, selection, spec, result, rocks, rovers, timeS, missionT, pickMode, measure, baseline });
  live.current = { session, analysis, selection, spec, result, rocks, rovers, timeS, missionT, pickMode, measure, baseline };

  // ── load the world ─────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const worlds = await listWorlds(base);
        if (!worlds.length) throw new Error("No measured world package is built. Run: python -m pipeline.world.scene mars-jezero, then restart the app.");
        const wanted = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("world");
        const pick = worlds.find(w => w.dir === wanted) ?? worlds.find(w => w.body !== "earth") ?? worlds[0];
        setWorldList(worlds);
        const s = await loadWorld(base, pick.dir, (label, done, total) => alive && setLoading({ label, done, total }));
        if (!alive) return;
        // Default scene time and mission departure: three hours before the recorded solar noon.
        const morning = s.solar ? Math.max(0, firstNoon(s.solar).t - 3 * 3600) : 0;
        setSession(s); setSpec({ ...defaultSpec(s.manifest.site.id), startTimeS: morning }); setLoading(null); setTimeS(morning);
        if (!s.image) setLayer("elevation"); // no orthoimage (e.g. Earth GLO-30 worlds): show measured elevation
        setBusy("Interpreting the scene…");
        setTimeout(() => { if (!alive) return; try { setAnalysis(analyzeScene(s)); } catch (e) { setError(`Scene analysis failed: ${e instanceof Error ? e.message : e}`); } setBusy(""); }, 60);
      } catch (e) { if (alive) { setError(e instanceof Error ? e.message : String(e)); setLoading(null); } }
    })();
    return () => { alive = false; };
  }, [base]);

  // ── renderer lifecycle ─────────────────────────────────────────────────
  const pick = useCallback((p: XY, shift: boolean) => {
    const c = live.current, mode = shift ? "waypoint" : c.pickMode;
    if (mode === "start") { setSpec(s => ({ ...s, start: p })); setPickMode("destination"); }
    else if (mode === "destination") { setSpec(s => ({ ...s, destination: p })); setPickMode("inspect"); }
    else if (mode === "waypoint") setSpec(s => ({ ...s, waypoints: [...s.waypoints, { ...p, id: `wp${Date.now().toString(36)}`, label: `S${s.waypoints.length + 1}`, activity: "observation" }] }));
    else if (mode === "measure") setMeasure(m => (m.length >= 2 ? [p] : [...m, p]));
    else { setSelection(p); setSide("inspector"); }
  }, []);
  useEffect(() => {
    if (!session || !host.current) return;
    try {
      const v = createWorldView({ host: host.current, manifest: session.manifest, baseUrl: session.baseUrl, field: session.field, regional: session.regional, quality, onPick: pick, onStats: setStats, onError: setError, onProgress: (loaded, pending) => setTiles({ loaded, pending }) });
      view.current = v;
      if (roverAsset.current) v.setRoverModel(roverAsset.current.object, roverAsset.current.length, roverAsset.current.spin);
      return () => { v.dispose(); view.current = null; };
    } catch (e) { setError(`3D graphics are unavailable (${e instanceof Error ? e.message : e}). Analysis, planning and the dossier still work.`); }
  }, [session, quality, pick]);

  // ── illumination: one SPICE vector drives the light, the shadow mask and the energy model ──
  const sceneTime = result && panel !== "explore" && panel !== "intelligence" ? Math.min(session?.solar?.duration ?? Infinity, result.spec.startTimeS + missionT) : timeS;
  const sun = useMemo(() => (session?.solar ? solarAt(session.solar, Math.min(sceneTime, session.solar.duration)) : null), [session, Math.round(sceneTime / 120)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!session || !view.current) return; view.current.setSun(sun?.sunEnu ?? null, sun ? shadowMask(session.field, sun.sunEnu, 4) : null); }, [session, sun, quality]);
  useEffect(() => { view.current?.setAppearance({ tint: appearance === "visualization", unlit: appearance === "acquired" }); }, [appearance, session, quality]);

  // ── mission engine bindings ────────────────────────────────────────────
  const navGrid = useCallback((s: MissionSpec, rv = live.current.rovers, rk = live.current.rocks): NavGrid => {
    const c = live.current, rover = rv[s.roverId], key = JSON.stringify([rover, s.maxSlopeDeg, s.surface, rk.length, !!c.analysis]);
    if (navCache.current?.key === key) return navCache.current.grid;
    const soilAt = s.surface === "classified" && c.analysis ? soilFromClasses(c.analysis, "dry-sand") : undefined;
    const grid = buildNavGrid(c.session!.field, rover, { maxSlopeDeg: s.maxSlopeDeg, gravity: c.session!.gravity, soilId: s.surface === "classified" ? "dry-sand" : s.surface, soilAt, obstacles: rk.map(r => ({ id: r.id, x: r.x, y: r.y, radius: r.diameterM / 2, height: null })) });
    navCache.current = { key, grid }; return grid;
  }, []);
  const runMission = useCallback((s: MissionSpec, o: { rovers?: Record<string, RoverProfile>; rocks?: Rock[]; commit?: boolean; keepBaseline?: boolean } = {}) => {
    const c = live.current, rv = o.rovers ?? c.rovers, rk = o.rocks ?? c.rocks;
    const world = { siteId: c.session!.manifest.site.id, gravity: c.session!.gravity, field: c.session!.field, solar: c.session!.solar, obstacles: rk.map(r => ({ id: r.id, x: r.x, y: r.y, radius: r.diameterM / 2, height: null })), soilAt: c.analysis ? soilFromClasses(c.analysis, "dry-sand") : undefined };
    const out = simulateMission(s, world, rv, rv[s.roverId] && (s.surface !== "classified" || c.analysis) ? navGrid(s, rv, rk) : undefined);
    if (o.commit) { if (o.keepBaseline && c.result) setBaseline(c.result); setResult(out); setMissionT(0); setPlaying(false); if (out.frames.length) { setPanel("simulation"); setCamera("follow"); view.current?.setCamera("follow"); } }
    return out;
  }, [navGrid]);
  const detect = useCallback(async (centre: XY, radius: number) => {
    const c = live.current, azimuth = c.analysis?.shading?.azimuthDeg;
    if (azimuth === undefined) throw new Error("The image illumination direction is unknown (shading fit unavailable), so shadow-based rock detection cannot run.");
    const found = await detectRocksNear(c.session!, centre, radius, azimuth), known = new Set(c.rocks.map(r => r.id)), fresh = found.rocks.filter(r => !known.has(r.id));
    if (fresh.length) { const next = [...c.rocks, ...fresh]; live.current.rocks = next; setRocks(next); }
    return { rocks: found.rocks, tiles: found.tiles, added: fresh.length };
  }, []);
  const exportDossier = useCallback(async () => {
    const c = live.current, d = await buildDossier({ session: c.session!, analysis: c.analysis, result: c.result, baseline: c.baseline, rocks: c.rocks, toolLog: toolLog.current, render: { quality, stats } });
    const name = `egiz-astral-${c.session!.dir}-${d.sha256.slice(0, 8)}`;
    downloadJson(d.document, `${name}.json`); downloadText(dossierMarkdown(d.document), `${name}.md`);
    return { file: `${name}.json and .md`, sha256: d.sha256 };
  }, [quality, stats]);
  const changeLayer = useCallback((id: LayerId, above: number | null = null) => { setLayer(id); setSlopeAbove(above); }, []);
  const toolHost = useCallback((): StudioHost => {
    const c = live.current, pose = c.result ? telemetryAt(c.result, c.missionT) : null;
    return { session: c.session!, analysis: c.analysis, selection: c.selection, roverAt: pose, spec: c.spec, result: c.result, rocks: c.rocks, rovers: c.rovers, timeS: c.timeS,
      flyTo: (p, range) => view.current?.flyTo(p, range), setLayer: changeLayer, setTime: t => { setTimeS(t); setPanel(p => (p === "simulation" || p === "mission" || p === "compare" ? "explore" : p)); }, setCamera: m => { setCamera(m); view.current?.setCamera(m); },
      select: p => { live.current.selection = p; setSelection(p); }, setSpec: s => { live.current.spec = s; setSpec(s); }, setRovers: r => { live.current.rovers = r; setRovers(r); }, navGrid,
      runMission: (s, o) => { const out = runMission(s, o); if (o?.commit) live.current.result = out; return out; }, detectRocks: detect, resetMission: () => { setResult(null); setBaseline(null); setSpec(s => ({ ...s, waypoints: [] })); setMissionT(0); },
      exportDossier, openAnalogs: () => navigate("twin") };
  }, [changeLayer, navGrid, runMission, detect, exportDossier, navigate]);

  // ── copilot ────────────────────────────────────────────────────────────
  const send = useCallback(async (input: string, confirmed = false) => {
    const text = input.trim(); if (!text || !live.current.session) return;
    setCommand(""); setSide("copilot"); if (!confirmed) setMessages(m => [...m, { role: "user", text }]); setBusy("Working…");
    try {
      const h = toolHost(), reply = await ask(text, call => runTool(call, h), toolLog.current, { confirmed });
      if (reply.unknown) setMessages(m => [...m, { role: "copilot", text: "I could not map that request to an available tool, so I have not answered it. I can explain terrain, find hazards and targets, show layers, plan and simulate missions, run what-if and stress tests, set time or camera, cite evidence and export a dossier." }]);
      else if (reply.needsConfirmation) setMessages(m => [...m, { role: "copilot", confirm: { input: text, message: reply.needsConfirmation!.message } }]);
      else setMessages(m => [...m, { role: "copilot", results: reply.results, calls: reply.calls.map(c => `${c.tool}(${Object.entries(c.args).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(", ")})`) }]);
    } catch (e) { setMessages(m => [...m, { role: "copilot", text: `The request failed: ${e instanceof Error ? e.message : e}` }]); }
    setBusy("");
  }, [toolHost]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: "end" }); }, [messages]);
  useEffect(() => { const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); commandInput.current?.focus(); } }; window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key); }, []);

  // ── derived view state ─────────────────────────────────────────────────
  const overlay = useMemo(() => { if (!session) return null; try { return buildOverlay(layer, session, analysis, { nav: layer === "traversability" ? navGrid(spec) : null, reference: selection, slopeAbove }); } catch { return null; } }, [session, analysis, layer, slopeAbove, spec.roverId, spec.maxSlopeDeg, spec.surface, rocks.length, rovers, layer === "similar" ? selection : null]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { view.current?.setOverlay(overlay, opacity); }, [overlay, opacity, quality, session]);
  useEffect(() => { view.current?.setRocks(rocks.map(r => ({ id: r.id, x: r.x, y: r.y, diameterM: r.diameterM }))); }, [rocks, quality, session]);
  useEffect(() => { view.current?.setRings((panel === "intelligence" || layer === "classes" ? analysis?.craters ?? [] : []).map(c => ({ id: c.id, x: c.x, y: c.y, radiusM: c.radiusM, color: "#ffd27a" }))); }, [analysis, panel, layer, quality, session]);
  useEffect(() => {
    const v = view.current; if (!v || !session) return;
    const same = Math.hypot(spec.start.x - spec.destination.x, spec.start.y - spec.destination.y) < 1, markers = [{ id: "start", label: "A", color: "#9be5d1", ...spec.start }, ...(same ? [] : [{ id: "destination", label: "B", color: "#f0c987", ...spec.destination }]), ...spec.waypoints.map(w => ({ id: w.id, label: w.label, color: "#e9e4d4", x: w.x, y: w.y })),
      ...(selection ? [{ id: "selection", label: "◎", color: "#ffffff", ...selection }] : []), ...measure.map((p, i) => ({ id: `m${i}`, label: `M${i + 1}`, color: "#c6a7ff", ...p }))];
    v.setMarkers(markers);
    const paths = [...(result?.alternatives.filter((r): r is Route => !!r.points && r.objective !== result.spec.objective).map(r => ({ id: r.objective, points: r.points, color: ROUTE_COLOR[r.objective], width: 2, dashed: true })) ?? []),
      ...(result?.route ? [{ id: "chosen", points: result.route.points, color: ROUTE_COLOR[result.route.objective], width: 4 }] : []), ...(baseline?.route ? [{ id: "baseline", points: baseline.route.points, color: "#b9b9b9", width: 2, dashed: true }] : []), ...(measure.length === 2 ? [{ id: "measure", points: measure, color: "#c6a7ff", width: 2 }] : [])];
    v.setPaths(paths);
  }, [spec.start, spec.destination, spec.waypoints, selection, measure, result, baseline, quality, session]);
  useEffect(() => { let alive = true; const p = rovers[spec.roverId]; if (!session || !p) return; roverModel(p).then(m => { if (!alive) return; roverAsset.current = m; view.current?.setRoverModel(m.object, m.length, m.spin); setRoverNote(m.note); view.current?.setRoverPose(live.current.result ? telemetryAt(live.current.result, live.current.missionT) : null); }).catch(e => setRoverNote(`Vehicle model unavailable: ${e instanceof Error ? e.message : e}`)); return () => { alive = false; }; }, [spec.roverId, session, quality]); // eslint-disable-line react-hooks/exhaustive-deps
  const frame = useMemo(() => (result ? telemetryAt(result, missionT) : null), [result, missionT]);
  useEffect(() => { view.current?.setRoverPose(frame); }, [frame]);
  useEffect(() => {
    if (!playing) return; let raf = 0, last = performance.now();
    const tick = (now: number) => { const dt = (now - last) / 1000; last = now;
      if (live.current.result && panel !== "explore" && panel !== "intelligence") setMissionT(t => { const end = live.current.result!.metrics.durationS, next = Math.min(end, t + dt * speed); if (next >= end) setPlaying(false); return next; });
      else setTimeS(t => { const end = live.current.session?.solar?.duration ?? 0, next = t + dt * speed; return next > end ? 0 : next; });
      raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [playing, speed, panel]);

  const info = useMemo(() => (session && selection ? inspectPoint(session, analysis, selection, sceneTime) : null), [session, analysis, selection, Math.round(sceneTime / 300)]); // eslint-disable-line react-hooks/exhaustive-deps
  const profileLine = measure.length === 2 ? measure : result?.route?.points ?? null;
  const chart = useMemo(() => { if (!session || !profileLine) return null; const pts = profile(session.field, profileLine, Math.max(session.field.posting, 2)).filter(p => p.elevation !== null); if (pts.length < 2) return null; const zs = pts.map(p => p.elevation!), lo = Math.min(...zs), hi = Math.max(...zs), len = pts.at(-1)!.distance; return { pts, lo, hi, len, path: pts.map((p, i) => `${i ? "L" : "M"}${((p.distance / len) * 1000).toFixed(1)},${(100 - ((p.elevation! - lo) / Math.max(0.5, hi - lo)) * 90 - 5).toFixed(1)}`).join("") }; }, [session, profileLine]);
  const rover = rovers[spec.roverId], missionMode = !!result && panel !== "explore" && panel !== "intelligence";
  const noRoute = Math.hypot(spec.start.x - spec.destination.x, spec.start.y - spec.destination.y) < 4;

  if (error && !session) return <main className="as-shell as-center"><h1>Mission Studio unavailable</h1><p role="alert">{error}</p><button className="as-btn" onClick={() => navigate("home")}>Back to EGIZ</button></main>;
  if (!session) return <main className="as-shell as-center" aria-busy="true"><span className="as-mark">EGIZ ASTRAL</span><h1>Loading measured world</h1><p>{loading ? `${loading.label} · ${loading.done}/${loading.total}` : "Preparing…"}</p><progress value={loading?.done ?? 0} max={loading?.total ?? 1} /></main>;
  const m = session.manifest, finest = m.levels[m.levels.length - 1];
  return (
    <main className="as-shell" data-panel={panel}>
      <header className="as-top">
        <button className="as-brand" onClick={() => navigate("home")} aria-label="Back to EGIZ home"><Home size={14} /><strong>EGIZ</strong><span>ASTRAL</span></button>
        <div className="as-site"><span className="as-chip">{m.site.body.toUpperCase()}</span><b>{m.site.name}</b><small>{Math.abs(m.site.lat).toFixed(4)}°{m.site.lat < 0 ? "S" : "N"} {Math.abs(m.site.lon).toFixed(4)}°{m.site.lon < 0 ? "W" : "E"}</small>
          {worldList.length > 1 && <select aria-label="Measured world" value={session.dir} onChange={e => { window.location.hash = `#/astral?world=${encodeURIComponent(e.target.value)}`; window.location.reload(); }}>
            {worldList.map(w => <option key={w.dir} value={w.dir}>{w.body.toUpperCase()} · {w.name}</option>)}</select>}</div>
        <form className="as-command" onSubmit={e => { e.preventDefault(); void send(command); }}>
          <Bot size={15} aria-hidden="true" /><input ref={commandInput} value={command} onChange={e => setCommand(e.target.value)} placeholder="Ask or command — e.g. “find rover hazards around this point”  (Ctrl K)" aria-label="Command and question bar" list="as-examples" />
          <datalist id="as-examples">{EXAMPLES.map(x => <option key={x} value={x} />)}</datalist><button type="submit" aria-label="Send" disabled={!command.trim()}><Send size={14} /></button>
        </form>
        <label className="as-quality">Quality<select value={quality} onChange={e => setQuality(e.target.value as Quality)} aria-label="Rendering quality"><option value="performance">Performance</option><option value="balanced">Balanced</option><option value="high">High</option></select></label>
        <button className="as-btn" onClick={() => void exportDossier()}><FileDown size={14} /> Dossier</button>
      </header>
      <nav className="as-rail" aria-label="Studio sections">{PANELS.map(({ id, label, icon: Icon }) => <button key={id} aria-current={panel === id ? "page" : undefined} onClick={() => setPanel(id)}><Icon size={17} /><span>{label}</span></button>)}</nav>

      <aside className="as-panel" aria-label={`${panel} panel`}>
        {panel === "explore" && <>
          <h2>Explore</h2>
          <section><h3>Layer</h3>{LAYERS.map(l => { const off = (l.needs === "analysis" && !analysis) || (l.needs === "solar" && !session.solar) || (l.needs === "reference" && (!selection || !analysis)); return <label key={l.id} className="as-radio" data-disabled={off}><input type="radio" name="layer" disabled={off} checked={layer === l.id} onChange={() => changeLayer(l.id)} /><span>{l.label}</span><em>{l.provenance}</em></label>; })}
            {layer !== "none" && <label className="as-range">Opacity<input type="range" min="0.2" max="1" step="0.05" value={opacity} onChange={e => setOpacity(Number(e.target.value))} /></label>}</section>
          <section><h3>Appearance</h3><div className="as-seg" role="group" aria-label="Appearance">{(["visualization", "scientific", "acquired"] as Appearance[]).map(a => <button key={a} aria-pressed={appearance === a} onClick={() => setAppearance(a)}>{a === "acquired" ? "As acquired" : a[0].toUpperCase() + a.slice(1)}</button>)}</div>
            <p className="as-note">{appearance === "visualization" ? "Illustrative colour tint over the measured single-band image, relit by the SPICE Sun." : appearance === "scientific" ? "Measured image brightness without tint, relit by the SPICE Sun. The image also carries its own acquisition shading." : "Image exactly as acquired: no tint, no relighting, no computed shadows."}</p></section>
          <section><h3>Tools</h3><div className="as-seg" role="group" aria-label="Pointer tool"><button aria-pressed={pickMode === "inspect"} onClick={() => setPickMode("inspect")}><Crosshair size={13} /> Inspect</button><button aria-pressed={pickMode === "measure"} onClick={() => { setPickMode("measure"); setMeasure([]); }}><Ruler size={13} /> Profile</button></div>
            {pickMode === "measure" && <p className="as-note">Click two points to draw a cross-section. The profile appears in the timeline.</p>}</section>
          <section><h3>Resolution levels</h3><table className="as-table"><thead><tr><th>Level</th><th>Terrain</th><th>Image</th><th>Origin</th></tr></thead><tbody>
            {session.regional && <tr><td>Regional</td><td>{session.regional.grid.cell_m} m</td><td>—</td><td>measured (MOLA–HRSC)</td></tr>}
            {m.levels.map(l => <tr key={l.level} data-active={stats?.finestLevel === l.level}><td>L{l.level}</td><td>{l.posting_m} m</td><td>{l.image_px_m} m</td><td>{l.provenance === "measured" ? "measured" : "area average"}</td></tr>)}</tbody></table>
            <p className="as-note">Geometry never exceeds the {finest.posting_m} m source posting. Nothing below it is invented.</p></section>
        </>}
        {panel === "intelligence" && <>
          <h2>Intelligence</h2>
          {!analysis ? <p className="as-note" role="status">{busy || "Scene analysis pending."}</p> : <>
            <section><h3>Terrain classes <em>model output</em></h3>{TERRAIN_CLASSES.slice(1).map(c => <button key={c.id} className="as-bar" onClick={() => changeLayer("classes")} title={c.rule}><i style={{ background: c.color }} /><span>{c.label}</span><b>{(analysis.classShare[c.id] * 100).toFixed(1)}%</b></button>)}</section>
            <section><h3>Terrain units <em>unsupervised</em></h3>{analysis.units.sizes.map((n, u) => <button key={u} className="as-bar" onClick={() => changeLayer("units")} title={analysis.units.features.map((f, i) => `${f} ${analysis.units.centroids[u][i].toFixed(2)}`).join(" · ")}><i style={{ background: UNIT_COLORS[u] }} /><span>Unit {u + 1} · slope {analysis.units.centroids[u][0].toFixed(1)}° · relief {analysis.units.centroids[u][1].toFixed(2)} m</span><b>{((n / analysis.units.trainedCells) * 100).toFixed(0)}%</b></button>)}</section>
            <section><h3>Objects</h3><p className="as-kv"><span>Crater candidates</span><b>{analysis.craters.length}</b></p><p className="as-kv"><span>Rock candidates</span><b>{rocks.length || "not run"}</b></p><p className="as-kv"><span>Outlier cells</span><b>{analysis.outliers.length}</b></p>
              <div className="as-actions"><button className="as-btn" disabled={!!busy} onClick={() => void send(selection ? "Find rover hazards around this point" : "Find rover hazards around the landing site")}>Detect rocks {selection ? "near selection" : "near landing site"}</button><button className="as-btn" onClick={() => void send("Which formations deserve further investigation?")}>Rank science targets</button><button className="as-btn" onClick={() => changeLayer("anomaly")}>Show outliers</button></div>
              <ul className="as-list">{analysis.craters.slice(0, 8).map(c => <li key={c.id}><button onClick={() => { view.current?.flyTo(c, c.radiusM * 5); setSelection({ x: c.x, y: c.y }); }}>⌀ {(c.radiusM * 2).toFixed(0)} m · {c.depthM.toFixed(1)} m deep · conf {c.confidence.toFixed(2)}</button></li>)}</ul></section>
            <section><h3>Data quality</h3>{analysis.quality.map(q => <p key={q.check} className="as-q" data-status={q.status}><b>{q.status === "ok" ? "✓" : q.status === "info" ? "i" : "!"} {q.check}</b>{q.detail}</p>)}</section>
          </>}
          <section><h3>Model registry</h3>{modelsFor(m.site.body).map(c => <details key={c.id} className="as-model" data-status={c.status}><summary><span>{c.name}</span><em>{c.applicable || c.status === "not-configured" ? STATUS_LABEL[c.status] : "Not applicable here"}</em></summary><p>{c.task}. {c.architecture}.</p><p><b>Training domain:</b> {c.trainingDomain}. <b>Resolution:</b> {c.resolution}. <b>Hardware:</b> {c.hardware}.</p><p><b>Evaluation:</b> {c.evaluation}</p><p><b>Limits:</b> {c.limitations}</p></details>)}</section>
        </>}
        {panel === "mission" && <>
          <h2>Mission</h2>
          <section><h3>Vehicle</h3><select value={spec.roverId} onChange={e => setSpec({ ...spec, roverId: e.target.value })} aria-label="Rover profile">{Object.values(rovers).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
            <p className="as-note" data-kind={rover.kind}>{rover.kind === "reference" ? "Reference profile" : "Hypothetical EGIZ asset"} · {rover.mass} kg · wheels ⌀{(rover.wheelRadius * 200).toFixed(0)} cm · {(rover.maxSpeed * 100).toFixed(1)} cm/s · {rover.generation.kind === "rtg" ? `RTG ${rover.generation.powerW} W` : `solar ${rover.generation.areaM2} m²`}</p>
            <label className="as-field">Battery (Wh)<input type="number" min="100" max="20000" step="100" value={rover.batteryWh} onChange={e => setRovers({ ...rovers, [rover.id]: { ...rover, batteryWh: Math.max(100, Number(e.target.value) || rover.batteryWh) } })} /></label>
            <label className="as-field">Surface assumption<select value={spec.surface} onChange={e => setSpec({ ...spec, surface: e.target.value })}>{Object.values(SOILS).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}<option value="classified" disabled={!analysis}>By terrain class (assumed mapping)</option></select></label>
            <p className="as-note">{spec.surface === "classified" ? "Rough cells → rock, aligned-texture cells → weak drift, others → dry sand. An assumption, not a soil map." : SOILS[spec.surface].source}</p></section>
          <section><h3>Route</h3><div className="as-seg" role="group" aria-label="Place mission points"><button aria-pressed={pickMode === "start"} onClick={() => setPickMode("start")}><LocateFixed size={13} /> Start</button><button aria-pressed={pickMode === "destination"} onClick={() => setPickMode("destination")}><MapIcon size={13} /> Goal</button><button aria-pressed={pickMode === "waypoint"} onClick={() => setPickMode("waypoint")}>+ Stop</button></div>
            <p className="as-note">{pickMode === "start" ? "Click the terrain to place the start." : pickMode === "destination" ? "Click the terrain to place the destination." : pickMode === "waypoint" ? "Click to add science stops (or Shift-click anytime)." : `A (${spec.start.x.toFixed(0)}, ${spec.start.y.toFixed(0)}) → B (${spec.destination.x.toFixed(0)}, ${spec.destination.y.toFixed(0)}) · ${spec.waypoints.length} stops`}</p>
            {spec.waypoints.length > 0 && <button className="as-link" onClick={() => setSpec({ ...spec, waypoints: [] })}>Clear stops</button>}
            <label className="as-field">Objective<select value={spec.objective} onChange={e => setSpec({ ...spec, objective: e.target.value as MissionSpec["objective"] })}><option value="safest">Safest</option><option value="energy">Lowest energy</option><option value="shortest">Shortest</option></select></label>
            <label className="as-field">Slope limit (°)<input type="number" min="1" max="45" value={spec.maxSlopeDeg} onChange={e => setSpec({ ...spec, maxSlopeDeg: Number(e.target.value) })} /></label>
            <label className="as-field">Energy reserve (%)<input type="number" min="0" max="90" value={Math.round(spec.reserveFraction * 100)} onChange={e => setSpec({ ...spec, reserveFraction: Number(e.target.value) / 100 })} /></label>
            <label className="as-field">Departure (h after epoch)<input type="number" min="0" max={(session.solar?.duration ?? 86400) / 3600} step="0.5" value={spec.startTimeS / 3600} onChange={e => setSpec({ ...spec, startTimeS: Number(e.target.value) * 3600 })} /></label>
            <label className="as-field">Fidelity<select value={spec.fidelity} onChange={e => setSpec({ ...spec, fidelity: e.target.value as MissionSpec["fidelity"] })}><option value="fast">Fast · body gradient, 1 m steps</option><option value="detailed">Detailed · six wheel contacts, 0.25 m steps</option></select></label>
            <div className="as-actions"><button className="as-btn as-primary" disabled={noRoute || !!busy} onClick={() => { setBusy("Planning and simulating…"); setTimeout(() => { try { runMission(spec, { commit: true, keepBaseline: true }); } catch (e) { setError(String(e)); } setBusy(""); }, 30); }}><Truck size={14} /> Plan and simulate</button><button className="as-btn" onClick={() => changeLayer("traversability")}>Traversability</button></div>
            {noRoute && <p className="as-note">Place a start and a destination, or ask the copilot to plan a mission.</p>}</section>
        </>}
        {panel === "simulation" && <>
          <h2>Simulation</h2>
          {!result ? <p className="as-note">No simulation yet. Plan a mission in the Mission panel or ask the copilot.</p> : <>
            <section><h3>Outcome</h3><p className="as-outcome" data-state={result.outcome}>{result.outcome.replace("-", " ")}</p><p className="as-note">{result.explanation}</p></section>
            <section><h3>Routes considered</h3><table className="as-table"><thead><tr><th></th><th>m</th><th>h</th><th>Wh</th><th>max °</th><th>slip</th></tr></thead><tbody>{result.alternatives.map(r => <tr key={r.objective} data-active={r.objective === result.spec.objective}><td><i className="as-dot" style={{ background: ROUTE_COLOR[r.objective] }} />{r.objective}</td>{r.points ? <><td>{r.metrics.lengthM.toFixed(0)}</td><td>{(r.metrics.driveTimeS / 3600).toFixed(2)}</td><td>{r.metrics.driveEnergyWh.toFixed(0)}</td><td>{r.metrics.maxSlopeDeg.toFixed(1)}</td><td>{(r.metrics.meanSlip * 100).toFixed(0)}%</td></> : <td colSpan={5}>{r.reason}</td>}</tr>)}</tbody></table>{result.route && <p className="as-note">{result.route.why}</p>}</section>
            {frame && <section><h3>Telemetry · T+{clock(frame.t)}</h3><div className="as-grid">{[["Battery", num(frame.batteryWh, 0, " Wh")], ["Speed", num(frame.speed * 100, 1, " cm/s")], ["Slip", num(frame.slip * 100, 0, "%")], ["Sinkage", num(frame.sinkageM * 100, 1, " cm")], ["Pitch", num(frame.pitchDeg, 1, "°")], ["Roll", num(frame.rollDeg, 1, "°")], ["Drive", num(frame.drivePowerW, 0, " W")], ["Source", num(frame.generationW, 0, " W")], ["Sun", num(frame.sunElevationDeg, 1, "°")], ["Lighting", frame.shadowed === null ? "—" : frame.shadowed ? "shadow" : "sunlit"], ["Surface", SOILS[frame.soil]?.name.split(" ")[0] ?? frame.soil], ["Phase", frame.phase]].map(([k, v]) => <p key={k}><span>{k}</span><b>{v}</b></p>)}</div></section>}
            <section><h3>Events</h3><ol className="as-events">{result.events.map((e, i) => <li key={i} data-type={e.type} data-past={e.t <= missionT}><button onClick={() => { setMissionT(e.t); view.current?.flyTo(e, 40); }}><time>T+{clock(e.t)}</time><b>{e.type}</b><span>{e.detail}</span></button></li>)}</ol></section>
            <section><h3>Model</h3><p className="as-note">{result.model.terramechanics}. {roverNote}</p><ul className="as-list as-plain">{result.model.assumptions.map(x => <li key={x}>{x}</li>)}</ul></section>
          </>}
        </>}
        {panel === "compare" && <>
          <h2>Compare</h2>
          {!result || !baseline ? <p className="as-note">Run a second scenario (change rover, surface, limits or ask “what if…”) to compare it with the previous run.</p> : <section><table className="as-table as-compare"><thead><tr><th></th><th>A · previous</th><th>B · current</th></tr></thead><tbody>
            {([["Rover", (r: MissionResult) => r.rover.name.split(" (")[0]], ["Surface", r => r.spec.surface], ["Objective", r => r.spec.objective], ["Fidelity", r => r.spec.fidelity], ["Outcome", r => r.outcome], ["Distance", r => num(r.metrics.distanceM, 0, " m")], ["Duration", r => num(r.metrics.durationS / 3600, 2, " h")], ["Energy used", r => num(r.metrics.energyUsedWh, 0, " Wh")], ["Battery min", r => num(r.metrics.minBatteryWh, 0, " Wh")], ["Reserve", r => num(r.rover.batteryWh * r.spec.reserveFraction, 0, " Wh")], ["Peak slip", r => num(r.metrics.maxSlip * 100, 0, "%")], ["Peak sinkage", r => num(r.metrics.maxSinkageM * 100, 1, " cm")], ["Peak tilt", r => num(r.metrics.maxTiltDeg, 1, "°")], ["Shadow time", r => num(r.metrics.shadowTimeS / 60, 0, " min")]] as [string, (r: MissionResult) => string][]).map(([k, fn]) => { const x = fn(baseline), y = fn(result); return <tr key={k} data-diff={x !== y}><td>{k}</td><td>{x}</td><td>{y}</td></tr>; })}</tbody></table><p className="as-note">Both runs use the same measured terrain and SPICE record. Grey dashed line: route A.</p></section>}
        </>}
        {panel === "evidence" && <>
          <h2>Evidence</h2>
          <section><h3>Terrain</h3><p className="as-note"><b>{m.sources.dtm.product}</b><br />{m.sources.dtm.citation}<br />{m.sources.dtm.vertical_datum}. {m.sources.dtm.kind}.<br />Window sha256 <code>{m.sources.dtm.window_sha256.slice(0, 16)}…</code></p><a className="as-link" href={m.sources.dtm.landing_page} target="_blank" rel="noreferrer">Product page</a></section>
          {m.sources.ortho && <section><h3>Imagery</h3><p className="as-note"><b>{m.sources.ortho.product}</b><br />{m.sources.ortho.citation}<br />{m.sources.ortho.kind}.<br />Window sha256 <code>{m.sources.ortho.window_sha256.slice(0, 16)}…</code></p><a className="as-link" href={m.sources.ortho.landing_page} target="_blank" rel="noreferrer">Product page</a></section>}
          <section><h3>Illumination</h3><p className="as-note">{session.solarNote}</p></section>
          <section><h3>Processing</h3><p className="as-note">{m.method}</p></section>
          <section><h3>Limitations</h3><ul className="as-list as-plain">{m.limitations.map(x => <li key={x}>{x}</li>)}</ul></section>
          <section><h3>Tool log</h3>{toolLog.current.length ? <ol className="as-log">{toolLog.current.slice(-30).map((l, i) => <li key={i} data-ok={l.ok}><code>{l.call.tool}</code> {l.title}</li>)}</ol> : <p className="as-note">No tools have run yet.</p>}</section>
        </>}
      </aside>

      <section className="as-view" aria-label="Planetary world">
        <div ref={host} className="as-canvas" />
        <div className="as-hud as-hud-tl"><b>{stats ? `L${stats.finestLevel} · ${m.levels[stats.finestLevel].posting_m} m terrain · ${m.levels[stats.finestLevel].image_px_m} m image` : "Streaming…"}</b><span>{tiles.loaded} tiles{tiles.pending ? ` · ${tiles.pending} loading` : ""}{stats ? `${stats.fps ? ` · ${stats.fps} fps` : ""} · ${(stats.triangles / 1000).toFixed(0)}k tris` : ""}</span></div>
        {overlay && <div className="as-hud as-legend"><b>{LAYERS.find(l => l.id === layer)?.label}</b><div>{overlay.legend.map(l => <span key={l.label}><i style={{ background: l.color }} />{l.label}</span>)}</div><p>{overlay.caption}</p></div>}
        <div className="as-hud as-cams" role="group" aria-label="Camera">{([["site", "Site", Mountain], ["top", "Top", Layers3], ["follow", "Follow", Truck], ["first", "Onboard", Eye]] as [CameraMode, string, typeof Eye][]).map(([id, label, Icon]) => <button key={id} aria-pressed={camera === id} disabled={(id === "follow" || id === "first") && !frame} onClick={() => { setCamera(id); view.current?.setCamera(id); }}><Icon size={13} />{label}</button>)}</div>
        <div className="as-hud as-prov"><span data-p="measured">Measured terrain &amp; image</span>{rocks.length > 0 && <span data-p="derived">Rocks: image-derived position and size, illustrative shape</span>}{appearance === "visualization" && <span data-p="illustrative">Colour tint &amp; sky: illustrative</span>}{session.regional && <span data-p="measured">Surroundings: 200 m regional terrain</span>}</div>
        {(busy || error) && <div className="as-toast" role="status" data-error={!!error}>{error || busy}{error && <button onClick={() => setError("")} aria-label="Dismiss">×</button>}</div>}
      </section>

      <aside className="as-side" aria-label="Inspector and copilot">
        <div className="as-tabs" role="tablist"><button role="tab" aria-selected={side === "copilot"} onClick={() => setSide("copilot")}><Bot size={13} /> Copilot</button><button role="tab" aria-selected={side === "inspector"} onClick={() => setSide("inspector")}><Crosshair size={13} /> Inspector</button></div>
        {side === "inspector" ? <div className="as-inspector">{!info ? <p className="as-note">Click the terrain to inspect a location. Every value names its origin.</p> : <>
          <h3>Location</h3><div className="as-grid">{[["East", num(info.x, 1, " m")], ["North", num(info.y, 1, " m")], ["Latitude", `${info.lat.toFixed(5)}°`], ["Longitude", `${info.lon.toFixed(5)}°E`]].map(([k, v]) => <p key={k}><span>{k}</span><b>{v}</b></p>)}</div>
          <h3>Measured <em>{session.field.posting} m terrain</em></h3><div className="as-grid">{[["Elevation", num(info.elevation, 2, " m")], ["Slope", num(info.slope, 1, "°")], ["Aspect", num(info.aspect, 0, "°")], ["Relief RMS", num(info.roughness, 2, " m")]].map(([k, v]) => <p key={k}><span>{k}</span><b>{v}</b></p>)}</div>
          <h3>Interpretation <em>model output</em></h3><div className="as-grid">{[["Class", info.classId ? TERRAIN_CLASSES[info.classId].label : "—"], ["Terrain unit", info.unit !== null ? `Unit ${info.unit + 1}` : "—"], ["Outlier score", info.anomaly !== null ? `${info.anomaly.toFixed(1)}×${analysis && info.anomaly >= analysis.units.anomalyThreshold ? " ⚑" : ""}` : "—"], ["Geological unit", "not loaded"]].map(([k, v]) => <p key={k}><span>{k}</span><b>{v}</b></p>)}</div>
          <h3>Illumination <em>SPICE · T+{clock(sceneTime)}</em></h3><div className="as-grid">{[["Sun elevation", num(info.sunElevation, 1, "°")], ["Horizon to Sun", num(info.horizonToSun, 1, "°")], ["Now", info.shadowed === null ? "—" : info.shadowed ? "terrain shadow" : "sunlit"]].map(([k, v]) => <p key={k}><span>{k}</span><b>{v}</b></p>)}</div>
          <div className="as-actions"><button className="as-btn" onClick={() => void send("Explain the geological structure of this area")}>Explain</button><button className="as-btn" onClick={() => void send("Generate hypotheses for this point")}>Hypotheses</button><button className="as-btn" onClick={() => changeLayer("similar")} disabled={!analysis}>Find similar</button><button className="as-btn" onClick={() => { setSpec({ ...spec, destination: selection! }); setPanel("mission"); }}>Set as goal</button></div>
        </>}</div> : <div className="as-chat">
          <div className="as-thread" aria-live="polite">{!messages.length && <div className="as-empty"><p>Ask about what you are looking at. Answers come from tools that run on this world; nothing is estimated from memory.</p>{EXAMPLES.slice(0, 6).map(x => <button key={x} onClick={() => void send(x)}>{x}</button>)}</div>}
            {messages.map((msg, i) => <article key={i} data-role={msg.role}>{msg.text && <p>{msg.text}</p>}
              {msg.confirm && <div className="as-confirm"><p>{msg.confirm.message}</p><button className="as-btn" onClick={() => void send(msg.confirm!.input, true)}>Confirm</button></div>}
              {msg.results?.map((r, j) => <div key={j} className="as-result" data-ok={r.ok}><h4>{r.title}</h4>{r.sections.map((s, k) => <p key={k} data-kind={s.kind}><em>{SECTION_LABEL[s.kind]}</em>{s.text}</p>)}{r.evidence && r.evidence.length > 0 && <footer>Evidence: {[...new Set(r.evidence)].slice(0, 6).join(" · ")}</footer>}</div>)}
              {msg.calls && <footer className="as-calls">{msg.calls.map(c => <code key={c}>{c}</code>)}</footer>}</article>)}
            <div ref={chatEnd} /></div>
          <form onSubmit={e => { e.preventDefault(); const el = e.currentTarget.elements.namedItem("q") as HTMLInputElement; void send(el.value); el.value = ""; }}><input name="q" placeholder="Ask the copilot…" aria-label="Copilot message" autoComplete="off" /><button type="submit" aria-label="Send"><Send size={14} /></button></form>
          <p className="as-foot">Local intent parser · typed tools only · no remote model configured</p>
        </div>}
      </aside>

      <footer className="as-timeline" aria-label="Timeline">
        <button className="as-play" onClick={() => setPlaying(p => !p)} aria-label={playing ? "Pause" : "Play"} disabled={missionMode ? !result?.frames.length : !session.solar}>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
        <select value={speed} onChange={e => setSpeed(Number(e.target.value))} aria-label="Playback speed"><option value="60">1 min/s</option><option value="600">10 min/s</option><option value="1800">30 min/s</option><option value="3600">1 h/s</option></select>
        {missionMode ? <div className="as-scrub"><label>Mission T+{clock(missionT)} / {clock(result!.metrics.durationS)}<input type="range" min="0" max={Math.max(1, result!.metrics.durationS)} step="10" value={missionT} onChange={e => setMissionT(Number(e.target.value))} aria-label="Mission time" /></label>
          <svg viewBox="0 0 1000 40" preserveAspectRatio="none" aria-hidden="true">{result!.frames.length > 1 && <><polyline className="as-battery" points={result!.frames.map(f => `${(f.t / result!.metrics.durationS) * 1000},${38 - (f.batteryWh / result!.rover.batteryWh) * 36}`).join(" ")} /><polyline className="as-slip" points={result!.frames.map(f => `${(f.t / result!.metrics.durationS) * 1000},${38 - f.slip * 36}`).join(" ")} /><line x1="0" x2="1000" y1={38 - result!.spec.reserveFraction * 36} y2={38 - result!.spec.reserveFraction * 36} className="as-reserve" /><line x1={(missionT / result!.metrics.durationS) * 1000} x2={(missionT / result!.metrics.durationS) * 1000} y1="0" y2="40" className="as-cursor" /></>}</svg>
          <small><i className="as-dot" style={{ background: "#7fd6a8" }} />battery <i className="as-dot" style={{ background: "#e88a6a" }} />slip <i className="as-dot" style={{ background: "#888" }} />reserve</small></div>
          : <div className="as-scrub"><label><Sun size={13} /> Scene T+{clock(timeS)} after {session.solar?.epochUtc.slice(0, 16).replace("T", " ") ?? "—"} UTC · Sun {num(sun?.elevationDeg, 1, "°")} elev, {num(sun?.azimuthDeg, 0, "°")} az<input type="range" min="0" max={session.solar?.duration ?? 1} step="300" value={timeS} disabled={!session.solar} onChange={e => setTimeS(Number(e.target.value))} aria-label="Scene time" /></label>
            <svg viewBox="0 0 1000 40" preserveAspectRatio="none" aria-hidden="true">{session.solar && <><polyline className="as-sun" points={session.solar.samples.map(x => `${(x.t / session.solar!.duration) * 1000},${20 - (x.elevationDeg / 90) * 19}`).join(" ")} /><line x1="0" x2="1000" y1="20" y2="20" className="as-reserve" /><line x1={(timeS / session.solar.duration) * 1000} x2={(timeS / session.solar.duration) * 1000} y1="0" y2="40" className="as-cursor" /></>}</svg>
            <small>{session.solar ? "Sun elevation over the SPICE record; the line is the geometric horizon." : session.solarNote}</small></div>}
        {chart && <div className="as-profile"><span>{measure.length === 2 ? "Cross-section" : "Route profile"} · {chart.len.toFixed(0)} m · {chart.lo.toFixed(1)} to {chart.hi.toFixed(1)} m</span><svg viewBox="0 0 1000 100" preserveAspectRatio="none" role="img" aria-label="Elevation profile"><path d={`${chart.path}L1000,100L0,100Z`} className="as-fill" /><path d={chart.path} className="as-line" />{frame && measure.length !== 2 && result && <line x1={(frame.distance / Math.max(1, result.metrics.distanceM)) * 1000} x2={(frame.distance / Math.max(1, result.metrics.distanceM)) * 1000} y1="0" y2="100" className="as-cursor" />}</svg></div>}
      </footer>
    </main>
  );
}
