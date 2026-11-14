// Mission Studio panels. Each panel reads/writes the shared studio state; no panel owns separate data.
import { useMemo, useState, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { BrainCircuit, CheckCircle2, CircleAlert, Download, ExternalLink, FileUp, KeyRound, Loader2, Play, RefreshCw, Send, ShieldAlert, Trash2 } from 'lucide-react';
import { useStudio, type Panel, type Variant } from './api';
import { FactList } from './facts';
import { Bars, LineChart } from './charts';
import { profile as terrainProfile, lineOfSight } from '../world/analysis/terrain';
import { CAPABILITIES } from '../world/intelligence/copilot';
import { mergeRegistry, STATUS_LABEL } from '../world/intelligence/registry';
import { cloneMission, OBJECTIVE_LABEL, validateMission, type MissionSpec } from '../world/sim/mission';
import { REGOLITH } from '../world/sim/terramechanics';
import { ROVERS, tipAngleDeg } from '../world/sim/rover';
import { frameAt, simulate } from '../world/sim/traverse';
import { parseMissionRequest } from '../world/intelligence/nlMission';
import { simulationHashes } from '../world/report/dossier';
import { epochPlus } from '../world/analysis/illumination';
import type { OverlayMode, QualityName } from '../world/render/worldView';

const UNIT_COLORS = ['#3f7f86', '#7aa36b', '#b8a46a', '#c4734f', '#8a6aa8', '#a14b4b'];
const pct = (v: number) => `${(v * 100).toFixed(0)} %`;

export function PanelBody() {
  const { panel } = useStudio();
  const map: Record<Panel, () => ReactElement> = { explore: Explore, terrain: Terrain, intelligence: Intelligence, mission: Mission, simulate: Simulate, compare: Compare, evidence: Evidence };
  const P = map[panel];
  return <P />;
}

function Head({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  return <div className="astral-head"><p className="astral-kicker">{kicker}</p><h2>{title}</h2>{children && <p className="astral-muted">{children}</p>}</div>;
}

// ---------------- Explore ----------------
function Explore() {
  const s = useStudio(), w = s.world;
  const overlays: { id: OverlayMode; label: string; note: string }[] = [
    { id: 'none', label: 'Surface', note: 'Lunar-Lambert shading of the measured DEM under the SPICE Sun; uniform assumed albedo.' },
    { id: 'slope', label: 'Slope', note: 'Slope of the rendered surface (posting of the displayed level, 5–160 m).' },
    { id: 'units', label: 'Terrain units', note: 'Unsupervised geomorphometric k-means units (model output, not geology).' },
    { id: 'hazard', label: 'Hazards', note: 'Red: slope above the limit. Blue: in shadow at the scene time.' },
    { id: 'traversability', label: 'Traversability', note: 'Planner lattice: red impassable, violet crater interior, green→amber uphill energy cost. Plan a mission first.' },
    { id: 'illumination', label: 'Illumination', note: 'Visible fraction of the solar disk from the terrain ray march.' },
  ];
  const craters = useMemo(() => w.objects.filter(o => o.type === 'crater' && (o.confidence ?? 0) >= 0.6).sort((a, b) => b.radius - a.radius).slice(0, 12), [w]);
  const current = overlays.find(o => o.id === s.overlay)!;
  return <>
    <Head kicker="Explore" title="World layers">Mons Mouton plateau, measured at native 5 m inside the gold box.</Head>
    <fieldset className="astral-seg" aria-label="Overlay layer">{overlays.map(o => <label key={o.id} className={s.overlay === o.id ? 'on' : ''}><input type="radio" name="overlay" checked={s.overlay === o.id} onChange={() => s.setOverlay(o.id)} />{o.label}</label>)}</fieldset>
    <p className="astral-note">{current.note}</p>
    {(s.overlay === 'hazard' || s.overlay === 'slope') && <label className="astral-field">Slope limit <b>{s.slopeLimit}°</b><input type="range" min={5} max={30} value={s.slopeLimit} onChange={e => s.setOverlay(s.overlay, Number(e.target.value))} /></label>}
    {s.overlay === 'units' && <ul className="astral-legend-list">{w.perception.units.classes.map(u => <li key={u.id}><i style={{ background: UNIT_COLORS[u.id] }} /><b>{u.label}</b> {u.descriptor} <span>{pct(u.areaFraction)}</span></li>)}</ul>}
    {s.overlay === 'slope' && <div className="astral-ramp" aria-hidden="true"><span>0°</span><i /><span>30°+</span></div>}
    <div className="astral-row">
      <label className="astral-field">Contours<select value={s.contours} onChange={e => s.setContours(Number(e.target.value))}><option value={0}>off</option><option value={5}>5 m</option><option value={10}>10 m</option><option value={25}>25 m</option><option value={50}>50 m</option></select></label>
      <label className="astral-field">Exposure<input type="range" min={1.5} max={9} step={0.1} value={s.exposure} onChange={e => s.setExposure(Number(e.target.value))} /></label>
    </div>
    <h3>Detections</h3>
    <label className="astral-check"><input type="checkbox" checked={s.showAll} onChange={e => s.setShowAll(e.target.checked)} />Show all model detections ({w.manifest.objects.craters} craters, {w.manifest.objects.anomalies} anomalies)</label>
    <ul className="astral-list">{craters.map(o => <li key={o.id}><button onClick={() => s.select({ kind: 'object', id: o.id }, true)}><b>{o.id}</b><span>D ≈ {Math.round(Number(o.properties.diameter_m))} m · depth {String(o.properties.depth_m)} m · score {o.confidence}</span></button></li>)}</ul>
    <h3>Display mode</h3>
    <label className="astral-check"><input type="checkbox" checked={s.illustrative} onChange={e => s.setIllustrative(e.target.checked)} />Visualization mode — add illustrative micro-relief and rocks</label>
    {s.illustrative && <label className="astral-field">Illustrative rock abundance k <b>{s.rockK}</b><input type="range" min={0.005} max={0.15} step={0.005} value={s.rockK} onChange={e => s.setRockK(Number(e.target.value))} /></label>}
    <p className="astral-note">{s.illustrative ? 'Illustrative detail is drawn from an assumed rock size–frequency model and procedural noise. It is never used by analysis, planning or physics.' : 'Scientific mode shows only measured terrain and attributed model outputs.'}</p>
    <h3>Rendering</h3>
    <label className="astral-field">Quality profile<select value={s.quality} onChange={e => s.setQuality(e.target.value as QualityName)}><option value="high">High</option><option value="balanced">Balanced</option><option value="performance">Performance (integrated GPUs)</option></select></label>
    {s.stats && <FactList compact facts={[
      { label: 'Frame rate', value: `${s.stats.fps.toFixed(0)} fps (${s.stats.frameMs.toFixed(1)} ms)`, cls: 'derived' },
      { label: 'Tiles drawn', value: `${s.stats.tiles} (finest L${s.stats.maxLevel}, ${s.stats.postingM} m); ${s.stats.cachedTiles} cached, ${s.stats.cachedMB.toFixed(1)} MB`, cls: 'derived' },
      { label: 'Geometry', value: `${(s.stats.triangles / 1e6).toFixed(2)} M triangles, ${s.stats.drawCalls} draw calls`, cls: 'derived' },
      { label: 'Shadow bake', value: `${s.stats.lastBakeMs.toFixed(1)} ms CPU submit (GPU ray march)`, cls: 'derived' }]} />}
  </>;
}

// ---------------- Terrain tools ----------------
function Terrain() {
  const s = useStudio(), w = s.world;
  const [a, b] = s.profilePts;
  const pr = useMemo(() => a && b ? terrainProfile(w, [a, b]) : null, [w, a, b]);
  const los = useMemo(() => a && b ? lineOfSight(w, a, b, 2, 2) : null, [w, a, b]);
  return <>
    <Head kicker="Terrain" title="Spatial analysis">Measure on the shared analysis surface (5 m inside the box, 20 m outside).</Head>
    <div className="astral-actions">
      <button className={`astral-btn ${s.pickMode === 'profile' ? '' : 'ghost'}`} onClick={() => { s.setProfilePts([]); s.setPickMode('profile'); }}>Draw cross-section</button>
      <button className="astral-btn ghost" onClick={() => { s.setProfilePts([s.mission.start, s.mission.destination ?? s.mission.start]); }}>Start → destination</button>
    </div>
    {pr && pr.points.length > 1 ? <>
      <LineChart x={pr.points.map(p => p.distance)} series={[{ label: 'Elevation', color: '#e3b65c', values: pr.points.map(p => p.h) }]} xLabel="m" yLabel="Elevation (m above sphere)" />
      <LineChart x={pr.points.map(p => p.distance)} series={[{ label: 'Surface slope', color: '#7fc3a6', values: pr.points.map(p => p.slopeDeg ?? NaN) }]} xLabel="m" yLabel="Surface slope (°)" band={{ from: s.mission.constraints.maxSlopeDeg, to: 90, label: 'Above the mission slope limit' }} yMin={0} />
      <FactList compact facts={[
        { label: 'Length', value: `${pr.length.toFixed(0)} m (map distance)`, cls: 'derived' },
        { label: 'Ascent / descent', value: `${pr.ascent.toFixed(1)} / ${pr.descent.toFixed(1)} m`, cls: 'derived' },
        { label: 'Max grade / max slope', value: `${pr.maxGradeDeg.toFixed(1)}° / ${pr.maxSlopeDeg.toFixed(1)}°`, cls: 'derived' },
        { label: 'Local relief', value: `${(Math.max(...pr.points.map(p => p.h)) - Math.min(...pr.points.map(p => p.h))).toFixed(1)} m`, cls: 'derived' },
        { label: 'Line of sight (2 m masts)', value: los ? (los.visible ? `clear (min clearance ${los.minClearanceM.toFixed(1)} m)` : `blocked at ${los.blockedAtM?.toFixed(0)} m`) : 'n/a', cls: 'derived' },
        { label: 'Sampling', value: `${pr.postingM} m along the line; bilinear analysis surface`, cls: 'derived' }]} />
      <button className="astral-btn ghost" onClick={() => s.download('egiz-profile.csv', ['distance_m,x_m,y_m,elevation_m,slope_deg,grade_deg', ...pr.points.map(p => [p.distance, p.x, p.y, p.h, p.slopeDeg, p.gradeDeg].map(v => v === null ? '' : Number(v).toFixed(3)).join(','))].join('\n'), 'text/csv')}><Download size={13} />Export CSV</button>
    </> : <p className="astral-note">Choose “Draw cross-section”, then click two points on the terrain. The profile uses the same slope definition as the planner and the inspector.</p>}
  </>;
}

// ---------------- Intelligence (copilot + models + data quality) ----------------
function Intelligence() {
  const s = useStudio();
  const [tab, setTab] = useState<'copilot' | 'models' | 'quality'>('copilot');
  const [text, setText] = useState('');
  const [key, setKey] = useState('');
  const registry = useMemo(() => mergeRegistry(s.world.registry, s.llmOn), [s.world, s.llmOn]);
  const submit = (e: FormEvent) => { e.preventDefault(); void s.ask(text); setText(''); };
  const examples = ['Identify the most interesting geological structures in this area and highlight potential rover hazards', 'Plan a rover survey starting at the western landing area, avoiding slopes above 12 degrees, prioritizing geological diversity, and preserving 25% energy reserve', 'Start a rover simulation', 'What changes if the rover has a smaller energy budget?', 'Why was this route selected?', 'Find evidence contradicting this assessment', 'Compare this area with Boszhira', 'What measurements are missing?', 'Highlight possible boulder fields', 'Change the solar time to local noon'];
  return <>
    <Head kicker="Intelligence" title="Planetary intelligence" />
    <div className="astral-tabs" role="tablist">{(['copilot', 'models', 'quality'] as const).map(t => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => { setTab(t); if (t === 'quality' && !s.quality_checks) void s.runChecks(); }}>{t === 'copilot' ? 'Copilot' : t === 'models' ? 'Model registry' : 'Data quality'}</button>)}</div>
    {tab === 'copilot' && <>
      <div className="astral-chat" aria-live="polite">
        {!s.answers.length && <div className="astral-empty"><BrainCircuit size={20} /><p>Ask about the selected feature, the visible area or the mission. Every number comes from a deterministic tool on the shared world model.</p><div className="astral-chips">{examples.map(x => <button key={x} onClick={() => void s.ask(x)}>{x}</button>)}</div></div>}
        {s.answers.map((a, i) => <article key={a.id} className="astral-answer" ref={i === s.answers.length - 1 ? el => el?.scrollIntoView({ block: 'start', behavior: 'smooth' }) : undefined}>
          <p className="astral-q">{a.request}</p>
          {a.narrative && <p className="astral-narrative">{a.narrative}</p>}
          {a.declined && <p className="astral-declined"><CircleAlert size={14} />{a.declined}</p>}
          {a.sections.map((sec, i) => <section key={i} className={sec.ok ? '' : 'failed'}><h4>{sec.ok ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />}{sec.title}</h4><FactList compact facts={sec.facts} />{sec.notes.map(n => <p key={n} className="astral-note">{n}</p>)}</section>)}
          {a.citations.length > 0 && <div className="astral-cites"><b>Evidence</b>{a.citations.map(c => <span key={c.id} className={`cite k-${c.kind}`}>{c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.label}<ExternalLink size={10} /></a> : c.kind === 'object' ? <button onClick={() => s.select({ kind: 'object', id: c.id }, true)}>{c.label}</button> : c.label}</span>)}</div>}
          {a.tools.length > 0 && <details className="astral-toollog"><summary>{a.tools.length} tool call{a.tools.length > 1 ? 's' : ''} · {a.provider === 'llm' ? 'Claude (remote)' : 'local planner'}</summary>{a.tools.map((t, i) => <code key={i}>{t.ok ? '✓' : '✗'} {t.tool}({JSON.stringify(t.args)}) · {t.ms} ms</code>)}</details>}
        </article>)}
        {s.asking && <p className="astral-muted"><Loader2 size={14} className="spin" /> Running tools…</p>}
      </div>
      <form className="astral-ask" onSubmit={submit}><textarea value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(e as unknown as FormEvent); } }} placeholder="Ask the copilot…" aria-label="Message to the research copilot" rows={2} /><button className="astral-btn" disabled={!text.trim() || s.asking} aria-label="Send"><Send size={14} /></button></form>
      <details className="astral-more"><summary>What the local copilot understands</summary><ul>{CAPABILITIES.map(c => <li key={c}>{c}</li>)}</ul></details>
    </>}
    {tab === 'models' && <>
      <p className="astral-note">Status reflects what actually runs in this build. Earth foundation models are registered but not used: their training domain is incompatible with lunar DEMs.</p>
      <div className="astral-models">{registry.map(m => <details key={m.id} className="astral-model"><summary><b>{m.name}</b><span className="astral-statuses">{m.status.map(st => <i key={st} className={`st-${st}`}>{STATUS_LABEL[st]}</i>)}</span></summary>
        <FactList compact facts={[{ label: 'Task', value: m.task, cls: 'derived' }, { label: 'Architecture', value: m.architecture, cls: 'derived' }, { label: 'Training domain', value: m.trainingDomain, cls: 'derived' }, { label: 'Inputs / resolution', value: `${m.inputs.join('; ')} · ${m.resolution}`, cls: 'derived' }, { label: 'Runtime', value: `${m.inference} · ${m.hardware} · ${m.memory}`, cls: 'derived' }, { label: 'Version / license', value: `${m.version} · ${m.license}`, cls: 'derived' }, { label: 'Evaluation', value: m.evaluation, cls: 'unknown' }, ...m.limitations.map(l => ({ label: 'Limitation', value: l, cls: 'unknown' as const }))]} />
      </details>)}</div>
      <div className="astral-key"><h3><KeyRound size={14} /> Optional remote LLM</h3>
        <p className="astral-note">EGIZ is fully functional without it. With your own Anthropic API key (kept only in this tab’s memory), Claude Opus 5.5 drives the same allowlisted tools; numbers still come from tools.</p>
        {s.llmOn ? <button className="astral-btn ghost" onClick={() => s.setLlmKey(null)}>Disconnect remote LLM</button> : <form onSubmit={e => { e.preventDefault(); s.setLlmKey(key); setKey(''); }} className="astral-row"><input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder="sk-ant-…" aria-label="Anthropic API key" autoComplete="off" /><button className="astral-btn" disabled={!key.trim()}>Use</button></form>}
      </div>
    </>}
    {tab === 'quality' && <>
      <button className="astral-btn ghost" onClick={() => void s.runChecks()}><RefreshCw size={13} />Re-run checks</button>
      {!s.quality_checks ? <p className="astral-muted"><Loader2 size={14} className="spin" /> Checking…</p> : <ul className="astral-checks">{s.quality_checks.map(c => <li key={c.id} className={`q-${c.status}`}><b>{c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : c.status === 'warn' ? '!' : 'i'} {c.label}</b><span>{c.detail}</span></li>)}</ul>}
    </>}
  </>;
}

// ---------------- Mission ----------------
function Mission() {
  const s = useStudio(), w = s.world, m = s.mission;
  const [request, setRequest] = useState('');
  const [parseNotes, setParseNotes] = useState<string[]>([]);
  const v = useMemo(() => validateMission(m, w), [m, w]);
  const set = (patch: Partial<MissionSpec>) => s.setMission({ ...cloneMission(m), ...patch, provenance: { ...m.provenance, createdBy: 'user' } });
  const setC = (patch: Partial<MissionSpec['constraints']>) => set({ constraints: { ...m.constraints, ...patch } });
  const rover = ROVERS.find(r => r.id === m.roverId)!;
  const parse = () => {
    const sel = s.selection?.kind === 'point' ? s.selection : s.selection?.kind === 'object' ? w.object(s.selection.id) : null;
    const r = parseMissionRequest(request, m, w, { selection: sel, selectionLabel: s.selection?.kind === 'object' ? s.selection.id : 'location' });
    s.setMission(r.spec); setParseNotes(r.spec.provenance.notes);
  };
  return <>
    <Head kicker="Mission" title="Mission specification">A typed, validated specification drives planning and simulation. Natural language is parsed into it — never passed to the physics.</Head>
    <label className="astral-field wide">Describe the mission<textarea rows={3} value={request} onChange={e => setRequest(e.target.value)} placeholder="Plan a rover survey starting at the western landing area, avoiding slopes above 12 degrees, prioritizing geological diversity, and preserving 25% energy reserve" /></label>
    <div className="astral-actions"><button className="astral-btn ghost" disabled={!request.trim()} onClick={parse}>Convert to specification</button><button className="astral-btn ghost" onClick={() => setRequest('Plan a rover survey starting at the western landing area, avoiding slopes above 12 degrees, prioritizing geological diversity, and preserving 25% energy reserve')}>Example</button></div>
    {parseNotes.length > 0 && <ul className="astral-parse">{parseNotes.map(n => <li key={n} className={n.startsWith('Not') ? 'miss' : ''}>{n}</li>)}</ul>}
    <h3>Route</h3>
    <div className="astral-pts">
      <span>A · start ({m.start.x.toFixed(0)}, {m.start.y.toFixed(0)}) m</span><button className="astral-btn ghost" onClick={() => s.setPickMode('start')}>Pick</button>
      <span>B · destination {m.destination ? `(${m.destination.x.toFixed(0)}, ${m.destination.y.toFixed(0)}) m` : '— return to start'}</span><button className="astral-btn ghost" onClick={() => s.setPickMode('destination')}>Pick</button>
    </div>
    <label className="astral-check"><input type="checkbox" checked={m.returnToStart} onChange={e => set({ returnToStart: e.target.checked, destination: e.target.checked ? null : m.destination ?? m.start })} />Return to start</label>
    <h3>Science stops ({m.waypoints.length})</h3>
    <ul className="astral-list">{m.waypoints.map((wp, i) => <li key={wp.id}><button onClick={() => s.select({ kind: 'object', id: wp.id }, true)}><b>{wp.label}</b><span>{wp.rationale ?? `(${wp.x.toFixed(0)}, ${wp.y.toFixed(0)}) m`} · {(wp.dwellS / 60).toFixed(0)} min</span></button><button className="astral-icon" aria-label={`Remove ${wp.label}`} onClick={() => set({ waypoints: m.waypoints.filter((_, j) => j !== i) })}><Trash2 size={13} /></button></li>)}</ul>
    <button className="astral-btn ghost" onClick={() => s.setPickMode('waypoint')} disabled={m.waypoints.length >= 8}>Add stop on map</button>
    <h3>Vehicle and regolith</h3>
    <label className="astral-field">Rover profile<select value={m.roverId} onChange={e => set({ roverId: e.target.value, roverOverrides: {} })}>{ROVERS.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
    <p className="astral-note">{rover.note} {rover.massKg} kg, {rover.wheels} wheels r = {rover.wheelRadiusM} m, {rover.batteryWh} Wh, tip angle {tipAngleDeg(rover).toFixed(1)}°.</p>
    <div className="astral-row">
      <label className="astral-field">Battery (Wh)<input type="number" min={100} max={100000} value={m.roverOverrides.batteryWh ?? rover.batteryWh} onChange={e => set({ roverOverrides: { ...m.roverOverrides, batteryWh: Number(e.target.value) } })} /></label>
      <label className="astral-field">Speed (m/s)<input type="number" min={0.02} max={2} step={0.01} value={m.roverOverrides.maxSpeedMs ?? rover.maxSpeedMs} onChange={e => set({ roverOverrides: { ...m.roverOverrides, maxSpeedMs: Number(e.target.value) } })} /></label>
    </div>
    <label className="astral-field">Regolith (assumed)<select value={m.soilId} onChange={e => set({ soilId: e.target.value })}>{REGOLITH.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
    <label className="astral-field">Terramechanics fidelity<select value={m.fidelity} onChange={e => set({ fidelity: e.target.value as MissionSpec['fidelity'] })}><option value="fast">Fast — Bekker + Janosi–Hanamoto (closed form)</option><option value="detailed">Detailed — Wong–Reece stress integration</option></select></label>
    <p className="astral-note">Reference fidelity (comparison with published wheel tests) is not available: no experimental dataset is packaged.</p>
    <h3>Constraints and objective</h3>
    <div className="astral-row">
      <label className="astral-field">Max slope <b>{m.constraints.maxSlopeDeg}°</b><input type="range" min={4} max={30} value={m.constraints.maxSlopeDeg} onChange={e => setC({ maxSlopeDeg: Number(e.target.value) })} /></label>
      <label className="astral-field">Max cross-slope <b>{m.constraints.maxCrossSlopeDeg}°</b><input type="range" min={4} max={30} value={m.constraints.maxCrossSlopeDeg} onChange={e => setC({ maxCrossSlopeDeg: Number(e.target.value) })} /></label>
    </div>
    <label className="astral-field">Energy reserve <b>{pct(m.constraints.minReserveFrac)}</b><input type="range" min={0} max={0.6} step={0.05} value={m.constraints.minReserveFrac} onChange={e => setC({ minReserveFrac: Number(e.target.value) })} /></label>
    <label className="astral-check"><input type="checkbox" checked={m.constraints.avoidCraterInteriors} onChange={e => setC({ avoidCraterInteriors: e.target.checked })} />Avoid detected crater interiors</label>
    <label className="astral-field">Preferred objective<select value={m.preferred} onChange={e => set({ preferred: e.target.value as MissionSpec['preferred'] })}>{Object.entries(OBJECTIVE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
    <label className="astral-field">Departure <b>{epochPlus(w.illumination, m.departureT).toISOString().slice(0, 16).replace('T', ' ')} UTC</b><input type="range" min={0} max={w.illumination.duration - 3600} step={3600} value={m.departureT} onChange={e => set({ departureT: Number(e.target.value) })} /></label>
    <div className={`astral-validation ${v.ok ? 'ok' : 'bad'}`} role="status">{v.ok ? <><CheckCircle2 size={14} />Specification valid</> : <><ShieldAlert size={14} />{v.errors.join(' · ')}</>}{v.warnings.map(x => <small key={x}>{x}</small>)}</div>
    <button className="astral-btn primary" disabled={!v.ok || !!s.planning} onClick={async () => { await s.runPlan(); s.setPanel('simulate'); }}>{s.planning ? <><Loader2 size={14} className="spin" />{s.planning}</> : <><Play size={14} />Plan routes and simulate</>}</button>
  </>;
}

// ---------------- Simulate ----------------
function Simulate() {
  const s = useStudio(), sim = s.activeSim, plan = s.plan;
  if (!plan || !sim) return <><Head kicker="Simulate" title="Mission rehearsal">No simulation yet.</Head><button className="astral-btn primary" onClick={() => s.setPanel('mission')}>Configure a mission</button></>;
  const f = frameAt(sim.frames, s.playback), sm = sim.summary, route = plan.routes.find(r => r.id === s.activeRouteId)!;
  const drive = sim.frames;
  return <>
    <Head kicker="Simulate" title={`${OBJECTIVE_LABEL[route.objective]} route`}>{sim.rover.name} · {REGOLITH.find(r => r.id === sim.spec.soilId)!.name} · {sim.spec.fidelity} terramechanics</Head>
    <div className="astral-routes" role="radiogroup" aria-label="Route">{plan.routes.map(r => <button key={r.id} role="radio" aria-checked={r.id === s.activeRouteId} disabled={!r.feasible} className={r.id === s.activeRouteId ? 'on' : ''} onClick={() => s.setActiveRoute(r.id)} title={r.reason}>{OBJECTIVE_LABEL[r.objective]}<small>{r.feasible ? `${(r.lengthM / 1000).toFixed(2)} km` : 'infeasible'}</small></button>)}</div>
    <div className={`astral-outcome ${sm.status}`}>{sm.status === 'completed' ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}{sm.status === 'completed' ? `Completed ${(sm.distanceM / 1000).toFixed(2)} km in ${(sm.durationS / 3600).toFixed(2)} h` : `Failed: ${sm.failure}`}</div>
    <div className="astral-telemetry" aria-live="off">
      {[['MET', `${(f.t / 3600).toFixed(2)} h`], ['Odometer', `${f.s.toFixed(0)} m`], ['Speed', `${(f.speedMs * 100).toFixed(1)} cm/s`], ['Slip', pct(f.slip)], ['Sinkage', `${(f.sinkageM * 100).toFixed(1)} cm`], ['Pitch / roll', `${f.pitchDeg.toFixed(1)}° / ${f.rollDeg.toFixed(1)}°`], ['Stability margin', `${f.stabilityMarginDeg.toFixed(1)}°`], ['Wheel torque', `${f.torqueNm.toFixed(0)} N·m`], ['Load / solar', `${f.loadW.toFixed(0)} / ${f.genW.toFixed(0)} W`], ['Battery', `${f.socWh.toFixed(0)} Wh (${pct(f.socWh / sim.rover.batteryWh)})`], ['Sun disk visible', pct(f.sunFrac)], ['Earth link', f.earthVisible ? 'line of sight' : 'occulted'], ['Phase', f.phase]].map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
    </div>
    <LineChart x={drive.map(d => d.t / 3600)} series={[{ label: 'Battery', color: '#e3b65c', values: drive.map(d => d.socWh) }]} xLabel="h" yLabel="Battery state of charge (Wh)" marker={s.playback / 3600} band={{ from: 0, to: sim.spec.constraints.minReserveFrac * sim.rover.batteryWh, label: 'Below the energy reserve' }} yMin={0} yMax={sim.rover.batteryWh} />
    <LineChart x={drive.map(d => d.t / 3600)} series={[{ label: 'Load', color: '#d0735a', values: drive.map(d => d.loadW) }, { label: 'Solar', color: '#7fc3a6', values: drive.map(d => d.genW) }]} xLabel="h" yLabel="Power (W)" marker={s.playback / 3600} yMin={0} />
    <LineChart x={drive.map(d => d.s)} series={[{ label: 'Slip', color: '#c9a85c', values: drive.map(d => d.slip * 100) }, { label: 'Pitch', color: '#8fb4e8', values: drive.map(d => d.pitchDeg) }]} xLabel="m" yLabel="Wheel slip (%) and pitch (°)" marker={f.s} />
    <LineChart x={drive.map(d => d.s)} series={[{ label: 'Elevation', color: '#b8b8c0', values: drive.map(d => d.h) }]} xLabel="m" yLabel="Elevation along route (m)" marker={f.s} />
    <h3>Event log</h3>
    <ol className="astral-events-list">{sim.events.map((e, i) => <li key={i} className={e.kind}><button onClick={() => s.seek(e.t)}><span>T+{(e.t / 3600).toFixed(2)} h · {e.s.toFixed(0)} m</span>{e.message}</button></li>)}</ol>
    <FactList compact facts={[
      { label: 'Energy', value: `used ${sm.energyUsedWh} Wh · generated ${sm.energyGeneratedWh} Wh · min SoC ${pct(sm.minSocFrac)}${sm.reserveBreached ? ' · RESERVE BREACHED' : ''}`, cls: 'simulated' },
      { label: 'Soil sensitivity (drive energy)', value: `firm ${sm.energySensitivityWh.firm} Wh · loose ${sm.energySensitivityWh.loose}${typeof sm.energySensitivityWh.loose === 'number' ? ' Wh' : ''}`, cls: 'simulated' },
      { label: 'Mobility extremes', value: `max slip ${pct(sm.maxSlip)}, max pitch ${sm.maxPitchDeg}°, max roll ${sm.maxRollDeg}°, min stability ${sm.minStabilityMarginDeg}°`, cls: 'simulated' },
      { label: '5 m route check', value: plan.checks[route.id] ? `max slope ${plan.checks[route.id].maxSlope5m}°; ${plan.checks[route.id].exceedM} m above ${plan.spec.constraints.maxSlopeDeg}°` : 'n/a', cls: 'derived' },
      { label: 'Rock encounters (assumed model)', value: sm.rockEncounterProbability === null ? 'disabled' : `P(≥1 rock above clearance) = ${(sm.rockEncounterProbability * 100).toFixed(2)} %`, cls: 'assumed' },
      { label: 'Environment', value: `sunlit ${pct(sm.sunlitFraction)}, Earth line of sight ${pct(sm.earthLinkFraction)} of mission time`, cls: 'simulated' }]} />
  </>;
}

// ---------------- Compare ----------------
function Compare() {
  const s = useStudio(), plan = s.plan;
  const [param, setParam] = useState<'battery' | 'mass' | 'rover' | 'soil' | 'fidelity' | 'speed'>('soil');
  const [factor, setFactor] = useState(0.5);
  const [soil, setSoil] = useState('lunar-loose');
  if (!plan) return <><Head kicker="Compare" title="Scenario comparison">Plan a mission first.</Head></>;
  const feas = plan.routes.filter(r => r.feasible && plan.sims[r.id]);
  const metric = (id: string) => plan.sims[id].summary;
  const dominated = (id: string) => feas.some(o => { if (o.id === id) return false; const a = metric(o.id), b = metric(id); const ra = feas.find(r => r.id === o.id)!.lengthM, rb = feas.find(r => r.id === id)!.lengthM; return ra <= rb && a.energyUsedWh <= b.energyUsedWh && a.maxRollDeg <= b.maxRollDeg && a.sunlitFraction >= b.sunlitFraction && (ra < rb || a.energyUsedWh < b.energyUsedWh || a.maxRollDeg < b.maxRollDeg || a.sunlitFraction > b.sunlitFraction); });
  const base = s.activeRouteId ? plan.routes.find(r => r.id === s.activeRouteId) : feas[0];
  const runVariant = () => {
    if (!base) return;
    const v = cloneMission(plan.spec), rover = plan.sims[base.id].rover;
    let label = '';
    if (param === 'battery') { v.roverOverrides.batteryWh = Math.round(rover.batteryWh * factor); label = `Battery × ${factor}`; }
    if (param === 'mass') { v.roverOverrides.massKg = Math.round(rover.massKg * factor); label = `Mass × ${factor}`; }
    if (param === 'speed') { v.roverOverrides.maxSpeedMs = +(rover.maxSpeedMs * factor).toFixed(3); label = `Speed × ${factor}`; }
    if (param === 'rover') { v.roverId = v.roverId === 'egiz-lr1' ? 'egiz-lr6' : 'egiz-lr1'; v.roverOverrides = {}; label = ROVERS.find(r => r.id === v.roverId)!.name; }
    if (param === 'soil') { v.soilId = soil; label = REGOLITH.find(r => r.id === soil)!.name; }
    if (param === 'fidelity') { v.fidelity = v.fidelity === 'fast' ? 'detailed' : 'fast'; label = `${v.fidelity} terramechanics`; }
    const val = validateMission(v, s.world);
    if (!val.ok) return;
    const result = simulate(s.world, v, base, {});
    s.addVariant({ id: `v${Date.now()}`, label: `${OBJECTIVE_LABEL[base.objective]} · ${label}`, spec: v, result, baseRouteId: base.id } as Variant);
  };
  const rows = [...feas.map(r => ({ label: OBJECTIVE_LABEL[r.objective], sm: metric(r.id), len: r.lengthM })), ...s.variants.map(v => ({ label: v.label, sm: v.result.summary, len: v.result.summary.distanceM }))];
  return <>
    <Head kicker="Compare" title="Routes and scenarios">Actual simulator outputs only. Pareto-dominated routes are marked.</Head>
    <div className="astral-table-wrap"><table className="astral-table">
      <thead><tr><th>Scenario</th><th>km</th><th>h</th><th>Wh</th><th>min SoC</th><th>max slip</th><th>max roll</th><th>sunlit</th><th>outcome</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.label}><th>{r.label}{feas.some(f => OBJECTIVE_LABEL[f.objective] === r.label && dominated(f.id)) && <i className="astral-dominated" title="Pareto-dominated on length, energy, roll and sunlight"> dominated</i>}</th><td>{(r.len / 1000).toFixed(2)}</td><td>{(r.sm.durationS / 3600).toFixed(2)}</td><td>{r.sm.energyUsedWh.toFixed(0)}</td><td>{pct(r.sm.minSocFrac)}</td><td>{pct(r.sm.maxSlip)}</td><td>{r.sm.maxRollDeg.toFixed(1)}°</td><td>{pct(r.sm.sunlitFraction)}</td><td className={r.sm.status}>{r.sm.status === 'completed' ? 'ok' : 'failed'}</td></tr>)}</tbody>
    </table></div>
    <h3>Energy used</h3><Bars unit="Wh" rows={rows.map(r => ({ label: r.label, value: r.sm.energyUsedWh }))} />
    <h3>Duration</h3><Bars unit="h" rows={rows.map(r => ({ label: r.label, value: r.sm.durationS / 3600 }))} />
    <h3>Add a scenario (same route: {base ? OBJECTIVE_LABEL[base.objective] : '—'})</h3>
    <div className="astral-row">
      <label className="astral-field">Change<select value={param} onChange={e => setParam(e.target.value as typeof param)}><option value="soil">Regolith</option><option value="battery">Battery</option><option value="mass">Mass</option><option value="speed">Speed</option><option value="rover">Rover profile</option><option value="fidelity">Terramechanics fidelity</option></select></label>
      {param === 'soil' ? <label className="astral-field">To<select value={soil} onChange={e => setSoil(e.target.value)}>{REGOLITH.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        : ['battery', 'mass', 'speed'].includes(param) ? <label className="astral-field">Factor<select value={factor} onChange={e => setFactor(Number(e.target.value))}>{[0.25, 0.5, 0.75, 1.5, 2].map(x => <option key={x} value={x}>× {x}</option>)}</select></label> : <span />}
    </div>
    <div className="astral-actions"><button className="astral-btn" onClick={runVariant} disabled={!base}>Simulate scenario</button>{s.variants.length > 0 && <button className="astral-btn ghost" onClick={s.clearVariants}>Clear scenarios</button>}</div>
  </>;
}

// ---------------- Evidence ----------------
function Evidence() {
  const s = useStudio(), m = s.world.manifest;
  const [repro, setRepro] = useState<string | null>(null);
  const reproduce = async (expected?: { inputHash: string; outputHash: string; spec: MissionSpec; routeId: string; points?: { x: number; y: number }[] }) => {
    const plan = s.plan;
    const spec = expected?.spec ?? plan?.spec;
    const route = expected?.points ? { id: expected.routeId, objective: plan?.routes.find(r => r.id === expected.routeId)?.objective ?? 'safest', points: expected.points, legs: [], lengthM: 0, cost: 0, expanded: 0, feasible: true, waypointOrder: [] } : plan?.routes.find(r => r.id === s.activeRouteId);
    if (!spec || !route) { setRepro('Nothing to reproduce yet.'); return; }
    await s.world.ensureOperational();
    const first = plan?.sims[route.id] ?? simulate(s.world, spec, route as never, {});
    const again = simulate(s.world, spec, route as never, {});
    const h1 = await simulationHashes(s.world, spec, route as never, first), h2 = await simulationHashes(s.world, spec, route as never, again);
    const target = expected ?? h1;
    setRepro(h2.inputHash === target.inputHash && h2.outputHash === target.outputHash ? `Reproduced ✓ input ${h2.inputHash.slice(0, 12)}… output ${h2.outputHash.slice(0, 12)}… (${again.tiles.length} terrain tiles)` : `Mismatch ✗ expected ${target.outputHash.slice(0, 12)}…, got ${h2.outputHash.slice(0, 12)}…`);
  };
  return <>
    <Head kicker="Evidence" title="Provenance and dossier" />
    <FactList compact facts={[
      { label: 'Elevation source', value: `${m.source.product} — ${m.source.citation}`, cls: 'measured' },
      { label: 'Source SHA-256', value: m.source.sha256, cls: 'measured' },
      { label: 'Native CRS → map frame', value: `${m.source.nativeCrs} → ${m.referenceFrame.mapProjection}`, cls: 'derived' },
      { label: 'Vertical datum', value: m.referenceFrame.verticalDatum, cls: 'measured' },
      { label: 'Pyramid', value: m.pyramid.method, cls: 'derived' },
      { label: 'Tiles', value: `${m.pyramid.tiles.length} content-hashed tiles (${(m.pyramid.tiles.reduce((a, t) => a + t.bytes, 0) / 1e6).toFixed(1)} MB)`, cls: 'derived' },
      { label: 'Illumination', value: `${s.world.illumination.engine}; ${s.world.illumination.kernels.map(k => k.name).join(', ')}`, cls: 'simulated' },
      { label: 'Evidence classes', value: Object.entries(m.evidenceClasses).map(([k, v]) => `${k}: ${v}`).join(' · '), cls: 'derived' }]} />
    <h3>Mission dossier</h3>
    <p className="astral-note">Inputs, routes, simulation metrics, events, AI components, copilot tool log, assumptions, limitations and hashes. Only real results are included.</p>
    <div className="astral-actions">
      <button className="astral-btn" disabled={!s.plan} onClick={async () => { const d = await s.dossier(); s.download('egiz-astral-dossier.md', d.markdown, 'text/markdown'); }}><Download size={13} />Markdown</button>
      <button className="astral-btn ghost" disabled={!s.plan} onClick={async () => { const d = await s.dossier(); const route = s.plan!.routes.find(r => r.id === s.activeRouteId); s.download('egiz-astral-dossier.json', JSON.stringify({ ...d.json, routePoints: route?.points ?? [] }, null, 2), 'application/json'); }}><Download size={13} />JSON</button>
      <button className="astral-btn ghost" disabled={!s.plan} onClick={() => void reproduce()}><RefreshCw size={13} />Reproduce</button>
      <label className="astral-btn ghost"><FileUp size={13} />Verify a dossier<input type="file" accept="application/json" hidden onChange={async e => { const f = e.target.files?.[0]; if (!f) return; try { const d = JSON.parse(await f.text()); if (!d.reproducibility || !d.mission) throw new Error(); await reproduce({ ...d.reproducibility, spec: d.mission, routeId: d.activeRoute, points: d.routePoints }); } catch { setRepro('That file is not an EGIZ ASTRAL dossier with route points.'); } }} /></label>
    </div>
    {repro && <p className="astral-validation ok" role="status">{repro}</p>}
    <h3>Related EGIZ instruments</h3>
    <p className="astral-note">Earth-analog transferability for this site is computed by ATLAS-Π (deterministic, authoritative). {s.atlas ? `${s.atlas.tensor.cells.filter(c => c.target === m.siteId).length} task × window cells loaded for Mons Mouton.` : 'Bundle not loaded in this data mode.'}</p>
    <a className="astral-btn ghost" href="#/atlas?data=pilot">Open Transferability (ATLAS-Π)<ExternalLink size={12} /></a>
  </>;
}
