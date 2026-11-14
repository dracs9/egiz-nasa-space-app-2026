// EGIZ Planetary Studio · stage panels: Inspect, Simulate, Compare, Decide.
import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { ROVERS, SOILS } from '../../astral/sim/terramechanics';
import { telemetryAt } from '../../astral/sim/mission';
import { aspectDeg, roughness, slopeDeg } from '../../astral/world/field';
import { downloadText } from '../../lib/download';
import { Compute, computeSite, type LayerSet } from '../compute';
import { TerrainView, type CameraPose } from '../render/terrainView';
import type { SiteSummary } from '../terrain/derive';
import { streamEarthSite } from '../terrain/earthStream';
import { BODY_LABEL, GRAVITY, loadSite, siteLatLon, type Body, type Site } from '../terrain/site';
import { morningStart } from '../terrain/solar';
import { ARRAY_TRANSMISSION, buildRover, compareRuns, OUTPUT_LABEL, PARAMS, reproduce, toExperiment, twinSite, type NumericKey, type Outputs, type TwinConfig, type TwinRun } from '../twin/twin';
import { buildReport, MARK_LABEL, serializeInvestigation } from '../workspace/investigation';
import { uid, usePlanet } from '../workspace/store';
import { Fact, Histogram, Legend, SignedBar } from './charts';
import { buildLayer, elevationRamp, LAYERS, MODES } from './layers';
import { emptyPlan, useCtl } from './ctl';

const BASE = import.meta.env.BASE_URL;
const n = (v: number | null | undefined, d = 1, u = '') => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(d)}${u}`);
const pct = (v: number) => `${(v * 100).toFixed(0)} %`;
const hours = (sec: number) => (sec >= 3600 ? `${(sec / 3600).toFixed(2)} h` : `${(sec / 60).toFixed(0)} min`);
function Section({ title, children, open = true, tag }: { title: string; children: React.ReactNode; open?: boolean; tag?: string }) { return <details className="pl-sec" open={open}><summary>{title}{tag && <em className={`pl-ev ev-${tag.replace(/[^a-z]/g, '')}`}>{tag}</em>}</summary><div>{children}</div></details>; }
function SitePicker() {
  const s = usePlanet(), ctl = useCtl();
  return <label className="pl-field">Site<select value={s.site?.key ?? ''} onChange={e => { const r = s.refs.find(x => x.key === e.target.value); if (r) ctl.open({ ref: r }); }}>
    {!s.site && <option value="">Choose a measured site…</option>}{s.site && !s.refs.some(r => r.key === s.site!.key) && <option value={s.site.key}>{s.site.name} (streamed)</option>}
    {s.refs.map(r => <option key={r.key} value={r.key}>{r.name}</option>)}</select></label>;
}

// ── Inspect ─────────────────────────────────────────────────────────────────
export function InspectPanel() {
  const s = usePlanet(), ctl = useCtl(), site = s.site, a = ctl.appearance, mode = MODES.find(m => m.id === a.mode) ?? MODES[0], sel = s.selection;
  if (!site) return <div className="pl-pad"><SitePicker /><p className="pl-empty">Choose a site</p></div>;
  const ll = sel ? siteLatLon(site, sel) : null, m = s.layers?.summary;
  return <div className="pl-pad">
    <SitePicker />
    <Section title="Display">
      <label className="pl-field">Mode<select value={a.mode} onChange={e => ctl.setAppearance({ mode: e.target.value })}>{MODES.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
      <p className="pl-note">{mode.note}</p>
    </Section>
    <Section title="Layers" open={false}>
      <label className="pl-field">Data layer<select value={a.layer ?? ''} onChange={e => ctl.setAppearance({ layer: (e.target.value || null) as never })}><option value="">None</option>{LAYERS.map(l => <option key={l.id} value={l.id} disabled={l.needs === 'insolation' && !site.sun}>{l.label} — {l.evidence}</option>)}</select></label>
      {a.layer && <p className="pl-note">{LAYERS.find(l => l.id === a.layer)!.how}</p>}
      <label className="pl-field">Layer opacity<input type="range" min={0} max={1} step={0.05} value={a.opacity} onChange={e => ctl.setAppearance({ opacity: Number(e.target.value) })} /></label>
      <label className="pl-field">Contours every<span className="pl-inline"><input type="number" min={0} step={1} value={a.contourM} onChange={e => ctl.setAppearance({ contourM: Math.max(0, Number(e.target.value)) })} /> m (0 = off)</span></label>
      <label className="pl-field">Vertical exaggeration ×{a.exaggeration.toFixed(1)}<input type="range" min={1} max={6} step={0.5} value={a.exaggeration} onChange={e => ctl.setAppearance({ exaggeration: Number(e.target.value) })} /></label>
      <p className="pl-note">Exaggeration changes the picture only. Heights, slopes, shadows and simulations always use true-scale data.</p>
      <label className="pl-field">Exposure<span className="pl-inline"><input type="range" min={0.3} max={9} step={0.1} value={a.exposure ?? 1.6} onChange={e => ctl.setAppearance({ exposure: Number(e.target.value) })} /><button onClick={() => ctl.setAppearance({ exposure: null })} disabled={a.exposure === null}>auto</button></span></label>
      {site.imagery && <label className="pl-check"><input type="checkbox" checked={a.tint} onChange={e => ctl.setAppearance({ tint: e.target.checked })} />Colour tint (illustrative; the orthoimage is single-band)</label>}
      {site.objects.length > 0 && <label className="pl-check"><input type="checkbox" checked={a.craters} onChange={e => ctl.setAppearance({ craters: e.target.checked })} />Crater candidates ({site.objects.filter(o => o.kind === 'crater').length}, model-detected)</label>}
    </Section>
    <Section title="Selected point" tag={sel ? 'measured' : undefined}>
      {sel && ll ? <><dl className="pl-facts">
        <Fact label="Latitude, longitude" value={`${ll.lat.toFixed(5)}°, ${ll.lon.toFixed(5)}°`} /><Fact label="Local x east, y north" value={`${sel.x.toFixed(1)}, ${sel.y.toFixed(1)} m`} />
        <Fact label="Elevation" value={`${sel.h.toFixed(2)} m`} evidence="measured" /><Fact label={`Slope (${site.field.posting} m baseline)`} value={n(slopeDeg(site.field, sel), 1, '°')} evidence="derived" />
        <Fact label="Aspect (downslope)" value={n(aspectDeg(site.field, sel), 0, '°')} evidence="derived" /><Fact label="Roughness (5 × 5 posts)" value={n(roughness(site.field, sel, 2), 2, ' m')} evidence="derived" /></dl>
        <div className="pl-row">{(['landing', 'science', 'hazard'] as const).map(k => <button key={k} onClick={() => s.addMark({ id: uid('k'), kind: k, label: `${MARK_LABEL[k]} ${s.inv.marks.filter(x => x.kind === k && x.siteKey === site.key).length + 1}`, x: sel.x, y: sel.y, h: sel.h, lat: ll.lat, lon: ll.lon, siteKey: site.key, radiusM: k === 'hazard' ? site.field.posting * 3 : undefined })}>{k}</button>)}
          <button onClick={() => ctl.view?.flyTo(sel)}>Fly here</button></div>
        <div className="pl-row"><button onClick={() => s.set({ plan: { ...(s.plan ?? emptyPlan(sel, morningStart(site.sun))), start: { x: sel.x, y: sel.y }, destination: s.plan ? s.plan.destination : { x: sel.x, y: sel.y } }, run: null })}>Set rover start</button>
          <button disabled={!s.plan} onClick={() => s.set({ plan: { ...s.plan!, destination: { x: sel.x, y: sel.y } }, run: null })}>Set destination</button></div></> : <p className="pl-empty">Click the terrain</p>}
    </Section>
    <Section open={false} title={`Workspace (${s.inv.marks.filter(x => x.siteKey === site.key).length} marks, ${s.inv.measurements.filter(x => x.siteKey === site.key).length} measurements)`}>
      <div className="pl-row">{(['mark-landing', 'mark-science', 'mark-hazard'] as const).map(t => <button key={t} className={s.tool === t ? 'on' : ''} onClick={() => s.set({ tool: s.tool === t ? 'inspect' : t, draft: [] })}>+ {t.slice(5)}</button>)}</div>
      <ul className="pl-list">{s.inv.marks.filter(x => x.siteKey === site.key).map(x => <li key={x.id}><button className="pl-link" onClick={() => ctl.view?.flyTo(x)}>{x.label}</button><span>{x.lat.toFixed(4)}°, {x.lon.toFixed(4)}° · {x.h.toFixed(1)} m</span><button aria-label={`Remove ${x.label}`} onClick={() => s.removeMark(x.id)}>×</button></li>)}
        {s.inv.measurements.filter(x => x.siteKey === site.key).map(x => <li key={x.id}><button className="pl-link" onClick={() => { if (x.kind === 'profile') ctl.setActiveProfile(ctl.activeProfile === x.id ? null : x.id); ctl.view?.flyTo(x.points[0]); }}>{x.label}</button><span>{Object.entries(x.values).slice(0, 3).map(([k, v]) => `${k} ${v === null ? '—' : v >= 1000 ? v.toFixed(0) : v.toFixed(2)}`).join(' · ')}</span><button aria-label={`Remove ${x.label}`} onClick={() => s.removeMeasure(x.id)}>×</button></li>)}
        {s.inv.views.filter(x => x.siteKey === site.key).map(x => <li key={x.id}><button className="pl-link" onClick={() => ctl.view?.setPose(x.pose)}>{x.name}</button><span>camera · {x.pose.range.toFixed(0)} m</span><button aria-label={`Remove ${x.name}`} onClick={() => s.removeView(x.id)}>×</button></li>)}</ul>
    </Section>
    <Section title="Terrain statistics" tag="terrain-derived" open={false}>
      {m ? <><dl className="pl-facts"><Fact label="Relief" value={`${m.reliefM.toFixed(1)} m`} /><Fact label={`Slope p50 / p90 (${m.baselineM} m)`} value={`${m.slope.p50.toFixed(1)}° / ${m.slope.p90.toFixed(1)}°`} /><Fact label="Roughness p50 / p95" value={`${m.roughness.p50.toFixed(2)} / ${m.roughness.p95.toFixed(2)} m`} /><Fact label="Below 15° / above 25°" value={`${pct(m.fractionBelow15)} / ${pct(m.fractionAbove25)}`} /><Fact label="Valid posts" value={`${(m.validFraction * 100).toFixed(2)} %`} /></dl>
        <p className="pl-cap">Slope distribution</p><Histogram a={m.slopeHist} lo={0} hi={45} unit="°" /><p className="pl-cap">Elevation distribution</p><Histogram a={m.hypsometry} lo={Math.round(m.elevation.min)} hi={Math.round(m.elevation.max)} unit=" m" /></> : <p className="pl-empty">Computing…</p>}
    </Section>
    <Section title="Provenance and limits" open={false}>
      <dl className="pl-facts"><Fact label="Product" value={site.provenance.product} /><Fact label="Citation" value={site.provenance.citation} /><Fact label="Native posting" value={`${site.provenance.nativePostingM.toFixed(1)} m`} /><Fact label="Levels" value={site.levels.map(l => `${l.postingM} m`).join(' · ')} />
        <Fact label="Vertical datum" value={site.provenance.verticalDatum} /><Fact label="Local CRS" value={site.provenance.crs} /><Fact label="SHA-256" value={site.provenance.sha256 ? `${site.provenance.sha256.slice(0, 20)}…` : 'not available'} /><Fact label="Sun geometry" value={site.sunNote} /></dl>
      <p className="pl-note">{site.provenance.method}</p><ul className="pl-limits">{site.limitations.map(x => <li key={x}>{x}</li>)}</ul>
      <a className="pl-link" href={site.provenance.url} target="_blank" rel="noreferrer">Source ↗</a>
    </Section>
  </div>;
}

// ── Simulate ────────────────────────────────────────────────────────────────
const QUICK: { label: string; apply(c: TwinConfig, mass: number, r: number): { config?: Partial<TwinConfig>; reserve?: number; timeShift?: number } }[] = [
  { label: 'Mass +20 %', apply: (c, mass) => ({ config: { overrides: { ...c.overrides, mass: mass * 1.2 } } }) }, { label: 'Wheel radius +20 %', apply: (c, _m, r) => ({ config: { overrides: { ...c.overrides, wheelRadius: r * 1.2 } } }) },
  { label: 'Reserve 40 %', apply: () => ({ reserve: 0.4 }) }, { label: 'Start 6 h later', apply: () => ({ timeShift: 21600 }) },
];
export function SimulatePanel() {
  const s = usePlanet(), ctl = useCtl(), site = s.site, c = s.config, plan = s.plan, run = s.run;
  const [bodies, setBodies] = useState<Record<Body, TwinRun> | null>(null), [name, setName] = useState(''), [repro, setRepro] = useState<Record<string, string>>({});
  useEffect(() => setBodies(null), [site, c, plan]);
  if (!site) return <div className="pl-pad"><SitePicker /><p className="pl-empty">Choose a site</p></div>;
  const { rover, errors } = buildRover(c, site.body), setC = (p: Partial<TwinConfig>) => s.set({ config: { ...c, ...p }, sensitivity: null }), ready = !!plan && plan.destination !== plan.start && !errors.length;
  const exec = (config: TwinConfig, p: NonNullable<typeof plan>, keepBaseline: boolean) => {
    if (!ctl.compute) return; s.set({ running: 'Planning routes and simulating…', config, plan: p, baseline: keepBaseline ? (s.baseline ?? run) : s.baseline });
    ctl.compute.run('twin', { config, plan: p }, { supersede: true }).then(r => usePlanet.getState().set({ run: r, running: null })).catch(e => { if (e.message !== 'superseded') usePlanet.getState().set({ running: null, siteMessage: e.message }); });
  };
  const frame = run ? telemetryAt(run.result, ctl.playT) : null, cmp = run && s.baseline && s.baseline !== run ? compareRuns(s.baseline, run) : null, exps = s.inv.experiments.filter(e => e.site.key === site.key);
  const maxEl = s.sensitivity ? Math.max(0.01, ...s.sensitivity.flatMap(r => [Math.abs(r.elasticity.energyUsedWh ?? 0), Math.abs(r.elasticity.durationS ?? 0)])) : 1;
  return <div className="pl-pad">
    <SitePicker />
    <Section title="Vehicle" tag="assumed">
      <label className="pl-field">Base profile<select value={c.baseRover} onChange={e => { const g = ROVERS[e.target.value].generation; setC({ baseRover: e.target.value, overrides: {}, power: g.kind === 'rtg' ? { kind: 'rtg', powerW: g.powerW } : { kind: 'solar', areaM2: g.areaM2, efficiency: g.efficiency } }); }}>{Object.values(ROVERS).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <div className="pl-grid2">
        <label className="pl-field">Wheels<select value={c.wheels} onChange={e => setC({ wheels: Number(e.target.value) as 4 | 6 | 8 })}><option value={4}>4</option><option value={6}>6</option><option value={8}>8</option></select></label>
        <label className="pl-field">Payload kg<input type="number" min={0} max={2000} step={5} value={c.payloadKg} onChange={e => setC({ payloadKg: Number(e.target.value) })} /></label>
        <label className="pl-field">Power<select value={c.power.kind} onChange={e => setC({ power: e.target.value === 'rtg' ? { kind: 'rtg', powerW: 110 } : { kind: 'solar', areaM2: 1.6, efficiency: 0.28 } })}><option value="rtg">Radioisotope (constant)</option><option value="solar">Solar array</option></select></label>
        {c.power.kind === 'rtg' ? <label className="pl-field">Output W<input type="number" min={0} max={5000} step={5} value={c.power.powerW} onChange={e => setC({ power: { kind: 'rtg', powerW: Number(e.target.value) } })} /></label>
          : <label className="pl-field">Array m²<input type="number" min={0.1} max={60} step={0.1} value={c.power.areaM2} onChange={e => setC({ power: { ...(c.power as { kind: 'solar'; areaM2: number; efficiency: number }), areaM2: Number(e.target.value) } })} /></label>}
        <label className="pl-field">Soil profile<select value={c.surface} onChange={e => setC({ surface: e.target.value })}>{Object.values(SOILS).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label className="pl-field">Gravity<select value={c.gravity} onChange={e => setC({ gravity: e.target.value as TwinConfig['gravity'] })}><option value="site">{BODY_LABEL[site.body]} (this site) {GRAVITY[site.body]} m/s²</option>{(['earth', 'mars', 'moon'] as const).filter(b => b !== site.body).map(b => <option key={b} value={b}>{BODY_LABEL[b]} {GRAVITY[b]} m/s² — counterfactual</option>)}</select></label>
      </div>
      <details className="pl-sub"><summary>All parameters ({Object.keys(c.overrides).length} changed)</summary><div className="pl-grid2">{PARAMS.map(p => <label key={p.key} className={`pl-field ${c.overrides[p.key] !== undefined ? 'changed' : ''}`}>{p.label}{p.unit && ` (${p.unit})`}<input type="number" min={p.min} max={p.max} step={p.step} value={c.overrides[p.key] ?? (ROVERS[c.baseRover][p.key] as number)} onChange={e => setC({ overrides: { ...c.overrides, [p.key]: Number(e.target.value) } })} /></label>)}</div>
        <button onClick={() => setC({ overrides: {} })} disabled={!Object.keys(c.overrides).length}>Reset to profile</button></details>
      <p className="pl-note">{SOILS[c.surface]?.source} {c.power.kind === 'solar' && `Array transmission ${ARRAY_TRANSMISSION[site.body]} (assumed, constant).`} Total mass {rover.mass.toFixed(0)} kg.</p>
      {errors.map(e => <p key={e} className="pl-error" role="alert">{e}</p>)}
    </Section>
    <Section title="Mission plan" tag="hypothetical">
      <div className="pl-row">{([['plan-start', 'Start'], ['plan-destination', 'Destination'], ['plan-waypoint', '+ Science stop'], ['plan-hazard', '+ Keep-out']] as const).map(([t, label]) => <button key={t} className={s.tool === t ? 'on' : ''} disabled={t !== 'plan-start' && !plan} onClick={() => s.set({ tool: s.tool === t ? 'inspect' : t })}>{label}</button>)}</div>
      {plan ? <>
        <ul className="pl-list"><li><span>Start</span><span>{plan.start.x.toFixed(0)}, {plan.start.y.toFixed(0)} m</span></li><li><span>Destination</span><span>{plan.destination === plan.start ? 'not set — click terrain' : `${plan.destination.x.toFixed(0)}, ${plan.destination.y.toFixed(0)} m`}</span></li>
          {plan.waypoints.map(w => <li key={w.id}><span>{w.label}</span><span>{w.x.toFixed(0)}, {w.y.toFixed(0)} m</span><button aria-label={`Remove ${w.label}`} onClick={() => s.set({ plan: { ...plan, waypoints: plan.waypoints.filter(x => x.id !== w.id) }, run: null })}>×</button></li>)}
          {plan.hazards.map(h => <li key={h.id}><span>{h.label}</span><span><input type="number" aria-label={`${h.label} radius in metres`} min={1} step={5} value={h.radiusM} onChange={e => s.set({ plan: { ...plan, hazards: plan.hazards.map(x => (x.id === h.id ? { ...x, radiusM: Math.max(1, Number(e.target.value)) } : x)) }, run: null })} /> m</span><button aria-label={`Remove ${h.label}`} onClick={() => s.set({ plan: { ...plan, hazards: plan.hazards.filter(x => x.id !== h.id) }, run: null })}>×</button></li>)}</ul>
        <div className="pl-grid2">
          <label className="pl-field">Route objective<select value={plan.objective} onChange={e => s.set({ plan: { ...plan, objective: e.target.value as never } })}><option value="safest">Lowest terrain risk</option><option value="energy">Lowest energy</option><option value="shortest">Shortest</option></select></label>
          <label className="pl-field">Slope limit °<input type="number" min={1} max={45} value={plan.maxSlopeDeg} onChange={e => s.set({ plan: { ...plan, maxSlopeDeg: Number(e.target.value) } })} /></label>
          <label className="pl-field">Energy reserve %<input type="number" min={0} max={90} step={5} value={Math.round(plan.reserveFraction * 100)} onChange={e => s.set({ plan: { ...plan, reserveFraction: Number(e.target.value) / 100 } })} /></label>
          <label className="pl-field">Fidelity<select value={plan.fidelity} onChange={e => s.set({ plan: { ...plan, fidelity: e.target.value as never } })}><option value="fast">Fast (1 m steps)</option><option value="detailed">Detailed (wheel-contact plane)</option></select></label>
        </div>
        <label className="pl-check"><input type="checkbox" checked={plan.requireDaylight} onChange={e => s.set({ plan: { ...plan, requireDaylight: e.target.checked } })} />Drive in daylight only</label>
        <p className="pl-note">{site.sun ? `Departure ${new Date(Date.parse(site.sun.epochUtc) + plan.startTimeS * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC (record +${(plan.startTimeS / 3600).toFixed(1)} h of ${(site.sun.duration / 3600).toFixed(0)} h)` : 'No Sun record: time of day is not modelled.'} <button className="pl-link" disabled={!site.sun} onClick={() => s.set({ plan: { ...plan, startTimeS: s.timeS }, run: null })}>use the scene time</button></p>
      </> : <p className="pl-empty">Set a start, then a destination</p>}
      <div className="pl-row"><button className="pl-primary" disabled={!ready || !!s.running} onClick={() => exec(c, plan!, false)}>{s.running ?? 'Run digital twin'}</button>{run && <button onClick={() => s.set({ baseline: run })} disabled={s.baseline === run}>Set as baseline</button>}</div>
    </Section>
    {run && <Section title={`Result — ${run.summary.outcome}`} tag="simulated">
      <p className={`pl-outcome ${run.result.outcome === 'completed' ? 'ok' : 'bad'}`}>{run.result.explanation}</p>
      <dl className="pl-facts"><Fact label="Distance / duration" value={`${n(run.summary.distanceM, 0)} m / ${hours(run.summary.durationS)}`} /><Fact label="Energy used / generated" value={`${n(run.summary.energyUsedWh, 0)} / ${n(run.summary.energyGeneratedWh, 0)} Wh`} /><Fact label="Minimum / final battery" value={`${n(run.summary.minBatteryWh, 0)} / ${n(run.summary.finalBatteryWh, 0)} Wh`} />
        <Fact label="Peak slip / sinkage" value={`${pct(run.summary.maxSlip)} / ${(run.summary.maxSinkageM * 100).toFixed(1)} cm`} /><Fact label="Peak tilt" value={n(run.summary.maxTiltDeg, 1, '°')} /><Fact label="Time in shadow" value={hours(run.summary.shadowTimeS)} /><Fact label="Energy per km" value={n(run.summary.whPerKm, 0, ' Wh')} /><Fact label="Gravity" value={`${run.gravity} m/s² (${run.gravityBody})`} /><Fact label="Fingerprint" value={run.fingerprint} /></dl>
      {run.warnings.map(w => <p key={w} className="pl-warnline">{w}</p>)}
      <p className="pl-cap">Route alternatives</p>
      <table className="pl-table"><thead><tr><th>Objective</th><th>Length</th><th>Energy</th><th>Max slope</th><th>Risk</th></tr></thead><tbody>{run.result.alternatives.map(r => <tr key={r.objective} className={r.objective === run.result.spec.objective ? 'on' : ''}><th><button className="pl-link" onClick={() => exec(c, { ...plan!, objective: r.objective }, false)}>{r.objective}</button></th>{r.points ? <><td>{n(r.metrics.lengthM, 0)} m</td><td>{n(r.metrics.driveEnergyWh, 0)} Wh</td><td>{n(r.metrics.maxSlopeDeg, 1)}°</td><td>{n(r.metrics.riskExposure, 0)}</td></> : <td colSpan={4}>{r.reason}</td>}</tr>)}</tbody></table>
      {frame && <><p className="pl-cap">Telemetry at {hours(ctl.playT)} <em className="pl-ev ev-simulated">simulated</em></p><dl className="pl-facts pl-tele"><Fact label="Position" value={`${frame.x.toFixed(1)}, ${frame.y.toFixed(1)}, ${frame.z.toFixed(1)} m`} /><Fact label="Heading / pitch / roll" value={`${frame.headingDeg.toFixed(0)}° / ${frame.pitchDeg.toFixed(1)}° / ${frame.rollDeg.toFixed(1)}°`} /><Fact label="Speed / slip" value={`${frame.speed.toFixed(3)} m/s / ${pct(frame.slip)}`} /><Fact label="Sinkage" value={`${(frame.sinkageM * 100).toFixed(1)} cm`} />
        <Fact label="Load / generation" value={`${frame.loadPowerW.toFixed(0)} / ${frame.generationW.toFixed(0)} W`} /><Fact label="Battery" value={`${frame.batteryWh.toFixed(0)} Wh (${pct(frame.batteryWh / run.rover.batteryWh)})`} /><Fact label="Distance" value={`${frame.distance.toFixed(0)} m (${pct(frame.distance / Math.max(1, run.summary.distanceM))})`} /><Fact label="Sun / shadow" value={frame.sunElevationDeg === null ? 'no record' : `${frame.sunElevationDeg.toFixed(1)}° · ${frame.shadowed ? 'shadowed' : 'lit'}`} /><Fact label="Phase" value={frame.phase} /></dl></>}
      <p className="pl-cap">Mission timeline</p>
      <ol className="pl-timeline">{run.timeline.map((t, i) => <li key={i} className={`t-${t.type}`}><button onClick={() => { ctl.setPlaying(false); ctl.setPlayT(t.t); ctl.view?.flyTo(t); }}><time>{hours(t.t)}</time><b>{t.title}</b><span>{t.detail}{t.batteryWh !== null && ` · ${t.batteryWh.toFixed(0)} Wh`}</span></button></li>)}</ol>
      <div className="pl-row"><button onClick={() => downloadText(['t_s,x_m,y_m,z_m,distance_m,heading_deg,pitch_deg,roll_deg,speed_m_s,slip,sinkage_m,drive_w,load_w,generation_w,battery_wh,sun_elevation_deg,shadowed,phase', ...run.result.frames.map(f => [f.t, f.x, f.y, f.z, f.distance, f.headingDeg, f.pitchDeg, f.rollDeg, f.speed, f.slip, f.sinkageM, f.drivePowerW, f.loadPowerW, f.generationW, f.batteryWh, f.sunElevationDeg ?? '', f.shadowed ?? '', f.phase].join(','))].join('\n'), `egiz-twin-telemetry-${run.fingerprint}.csv`, 'text/csv')}>Export simulated telemetry (CSV)</button></div>
    </Section>}
    {run && <Section title="Scenarios and sensitivity" tag="simulated" open={false}>
      <div className="pl-row">{QUICK.map(q => <button key={q.label} disabled={!!s.running} onClick={() => { const r = q.apply(c, rover.mass - c.payloadKg, rover.wheelRadius); exec({ ...c, ...r.config }, { ...plan!, reserveFraction: r.reserve ?? plan!.reserveFraction, startTimeS: Math.min(site.sun?.duration ?? 0, plan!.startTimeS + (r.timeShift ?? 0)) }, true); }}>{q.label}</button>)}</div>
      {cmp ? <><p className="pl-note">Against the baseline ({s.baseline!.fingerprint}){cmp.outcomeChanged && <b> — outcome changed: {cmp.before} → {cmp.after}</b>}. Largest relative change first.</p>
        <table className="pl-table"><thead><tr><th>Output</th><th>Baseline</th><th>Now</th><th>Change</th></tr></thead><tbody>{cmp.deltas.map(d => <tr key={d.key}><th>{d.label}</th><td>{d.before.toPrecision(4)}</td><td>{d.after.toPrecision(4)}</td><td>{d.relative === null ? '—' : `${d.relative > 0 ? '+' : ''}${(d.relative * 100).toFixed(1)} %`}</td></tr>)}</tbody></table></> : null}
      <div className="pl-row"><button disabled={!!s.running || !ctl.compute} onClick={() => { s.set({ running: 'Sensitivity: re-simulating…' }); ctl.compute!.run('sensitivity', { config: c, plan: plan!, keys: ['mass', 'payloadKg', 'wheelRadius', 'wheelWidth', 'driveEfficiency', 'maxSpeed', 'idlePowerW', 'batteryWh'] as (NumericKey | 'payloadKg')[], fraction: 0.2 }, { progress: (d, t) => usePlanet.getState().set({ running: `Sensitivity: parameter ${d} / ${t}` }) }).then(r => usePlanet.getState().set({ sensitivity: r.rows, running: null })).catch(e => usePlanet.getState().set({ running: null, siteMessage: e.message })); }}>Which parameters matter? (±20 %)</button>
        <button disabled={!!s.running || !ctl.compute} onClick={() => { s.set({ running: 'Simulating under three gravities…' }); ctl.compute!.run('bodies', { config: c, plan: plan! }).then(r => { setBodies(r); usePlanet.getState().set({ running: null }); }).catch(() => usePlanet.getState().set({ running: null })); }}>Earth · Mars · Moon gravity</button></div>
      {s.sensitivity && <><p className="pl-note">Elasticity = % change in the output per % change in the parameter (central difference, others fixed, routes re-planned in a window around the mission). Local and first-order.</p>
        <table className="pl-table"><thead><tr><th>Parameter</th><th>Energy used</th><th>Duration</th><th>Outcome −20 / +20 %</th></tr></thead><tbody>{s.sensitivity.map(r => <tr key={r.param}><th>{r.label}</th>{(['energyUsedWh', 'durationS'] as (keyof Outputs)[]).map(k => <td key={k}><SignedBar value={r.elasticity[k] ?? 0} max={maxEl} />{r.elasticity[k] === undefined ? '—' : r.elasticity[k]!.toFixed(2)}</td>)}<td className={r.outcomeLow !== run.summary.outcome || r.outcomeHigh !== run.summary.outcome ? 'pl-flag' : ''}>{r.outcomeLow} / {r.outcomeHigh}</td></tr>)}</tbody></table></>}
      {bodies && <><p className="pl-note">Counterfactual: this terrain, vehicle and plan under each body's gravity. Soil and Sun record unchanged.</p>
        <table className="pl-table"><thead><tr><th>Gravity</th><th>Outcome</th><th>{OUTPUT_LABEL.energyUsedWh}</th><th>Peak slip</th><th>Sinkage cm</th></tr></thead><tbody>{(['earth', 'mars', 'moon'] as const).map(b => <tr key={b} className={b === site.body ? 'on' : ''}><th>{BODY_LABEL[b]} {GRAVITY[b]}</th><td>{bodies[b].summary.outcome}</td><td>{n(bodies[b].summary.energyUsedWh, 0)}</td><td>{pct(bodies[b].summary.maxSlip)}</td><td>{(bodies[b].summary.maxSinkageM * 100).toFixed(1)}</td></tr>)}</tbody></table></>}
    </Section>}
    <Section title={`Experiments (${exps.length})`} open={exps.length > 0 || !!run}>
      {run && <div className="pl-row"><input aria-label="Experiment name" placeholder="Experiment name" value={name} onChange={e => setName(e.target.value)} /><button onClick={() => { s.saveExperiment(toExperiment(twinSite(site), c, plan!, run, name || `Run ${exps.length + 1}`, uid('exp'), new Date().toISOString())); setName(''); }}>Save experiment</button></div>}
      <ul className="pl-list pl-exps">{exps.map(e => <li key={e.id}><div><b>{e.name}</b><span>{e.summary.outcome} · {n(e.summary.distanceM, 0)} m · {n(e.summary.energyUsedWh, 0)} Wh · {e.fingerprint}</span>{repro[e.id] && <span className={repro[e.id].startsWith('Fingerprint') && repro[e.id].includes('reproduced') ? 'pl-ok' : 'pl-warnline'}>{repro[e.id]}</span>}</div>
        <button onClick={() => { const r = reproduce(twinSite(site), e); setRepro(x => ({ ...x, [e.id]: r.reason })); if (r.run) s.set({ run: r.run, config: e.config, plan: e.plan }); }}>Reproduce</button><button onClick={() => s.set({ config: e.config, plan: e.plan, run: null })}>Load</button><button onClick={() => s.saveExperiment({ ...e, id: uid('exp'), name: `${e.name} (copy)` })}>Duplicate</button><button aria-label={`Delete ${e.name}`} onClick={() => s.removeExperiment(e.id)}>×</button></li>)}</ul>
      {!exps.length && !run && <p className="pl-empty">None saved</p>}
    </Section>
  </div>;
}

// ── Compare ─────────────────────────────────────────────────────────────────
interface CompareState { site: Site | null; status: 'idle' | 'loading' | 'ready' | 'error'; message: string; layers: LayerSet | null; sumA: SiteSummary | null; sumB: SiteSummary | null; sync: 'off' | 'relative' | 'metric'; /** primary site this comparison belongs to */ forKey: string | null; compute: Compute | null; set(p: Partial<CompareState>): void }
const useCompare = create<CompareState>(set => ({ site: null, status: 'idle', message: '', layers: null, sumA: null, sumB: null, sync: 'relative', forKey: null, compute: null, set: p => set(p) }));
const w1Hist = (a: number[], b: number[]) => { let ca = 0, cb = 0, w = 0; for (let i = 0; i < a.length; i++) { ca += a[i]; cb += b[i]; w += Math.abs(ca - cb); } return w; }; // 1° bins
function CompareViewport() {
  const c = useCompare(), ctl = useCtl(), a = usePlanet(st => st.site), host = useRef<HTMLDivElement>(null), [viewB, setViewB] = useState<TerrainView | null>(null);
  useEffect(() => { if (!c.site || !host.current) return; const v = new TerrainView(host.current, c.site); v.setBase('natural', elevationRamp(c.site)); setViewB(v); return () => { v.dispose(); setViewB(null); }; }, [c.site]);
  useEffect(() => {
    const va = ctl.view; if (!va || !viewB || !a || !c.site || c.sync === 'off') return;
    const ea = a.field, eb = c.site.field, spanA = (ea.side - 1) * ea.posting, spanB = (eb.side - 1) * eb.posting, k = c.sync === 'metric' ? 1 : spanB / spanA; let lock = 0;
    const map = (p: CameraPose, from: typeof ea, to: typeof eb, scale: number): CameraPose => ({ ...p, tx: to.west + ((p.tx - from.west) / ((from.side - 1) * from.posting)) * (to.side - 1) * to.posting, ty: to.north - ((from.north - p.ty) / ((from.side - 1) * from.posting)) * (to.side - 1) * to.posting, range: p.range * scale });
    const prevA = va.onCamera, prevB = viewB.onCamera;
    va.onCamera = p => { prevA?.(p); if (performance.now() < lock) return; lock = performance.now() + 90; viewB.setPose(map(p, ea, eb, k), 0, true); };
    viewB.onCamera = p => { prevB?.(p); if (performance.now() < lock) return; lock = performance.now() + 90; va.setPose(map(p, eb, ea, 1 / k), 0, true); };
    viewB.setPose(map(va.getPose(), ea, eb, k), 0, true);
    return () => { va.onCamera = prevA; viewB.onCamera = prevB; };
  }, [ctl.view, viewB, a, c.site, c.sync]);
  // The comparison view mirrors the primary view's mode, layer and exaggeration, with the layer drawn on one shared scale.
  const mode = MODES.find(m => m.id === ctl.appearance.mode) ?? MODES[0];
  useEffect(() => { if (!viewB || !c.site) return; viewB.setShade(mode.shade === 'physical' && !c.site.sun ? 'hillshade' : mode.shade); viewB.setBase(mode.base); viewB.setContours(ctl.appearance.contourM); viewB.setExaggeration(ctl.appearance.exaggeration);
    // Each site is lit by its own Sun at its own highest elevation in its record: the two records cover different bodies and epochs.
    if (c.site.sun) viewB.setSun(c.site.sun.samples.reduce((a, b) => (b.elevationDeg > a.elevationDeg ? b : a)).sunEnu, null); }, [viewB, c.site, mode, ctl.appearance.contourM, ctl.appearance.exaggeration]);
  useEffect(() => {
    if (!viewB || !c.site) return; const id = ctl.appearance.layer, shared = ctl.built && id && ['slope', 'roughness', 'aspect', 'lit'].includes(id) ? { lo: ctl.built.lo, hi: ctl.built.hi } : undefined;
    const b = id && id !== 'lit' && id !== 'insolation' ? buildLayer(id, { site: c.site, layers: c.layers, insolation: null, limits: { maxSlopeDeg: 15, maxStepM: 0.3 }, shared }) : null;
    viewB.setLayer('A', b?.texture ?? null, ctl.appearance.opacity);
  }, [viewB, c.site, c.layers, ctl.appearance.layer, ctl.appearance.opacity, ctl.built]);
  return <div className="pl-host pl-host-b"><div ref={host} className="pl-fill" />
    {c.status === 'ready' && c.site ? <div className="pl-hud pl-hud-tl"><strong>{c.site.name}</strong><span>{BODY_LABEL[c.site.body]} · {c.site.field.posting} m · <em className={`pl-ev ev-${c.site.provenance.delivery}`}>{c.site.provenance.delivery}</em></span></div>
      : <div className="pl-overlay" role="status">{c.status === 'loading' ? <><span className="eg-loading-bar" aria-hidden="true" /><p>{c.message}</p></> : <p>{c.status === 'error' ? c.message : 'Choose a second site'}</p>}</div>}
  </div>;
}
function ComparePanelBody() {
  const s = usePlanet(), c = useCompare(), ctl = useCtl(), a = s.site, token = useRef(0);
  const options = useMemo(() => { const b = s.bundle, list: { key: string; label: string; run(signal: AbortSignal): Promise<Site> }[] = s.refs.filter(r => r.key !== a?.key).map(r => ({ key: r.key, label: `${BODY_LABEL[r.body]} — ${r.name} (${r.postingM} m)`, run: sig => loadSite(r, BASE, sig) }));
    if (b) for (const id of s.inv.candidates) { const i = b.windows.id.indexOf(id), packaged = s.refs.find(r => r.discoveryWindow === id); if (i >= 0 && !packaged) list.push({ key: `stream:${id}`, label: `Earth — ${b.windows.name[i]} (streamed, 32 m)`, run: sig => streamEarthSite(id, b.windows.name[i], b.windows.lat[i], b.windows.lon[i], { signal: sig }) }); }
    return list; }, [s.refs, s.bundle, s.inv.candidates, a?.key]);
  const openB = (key: string) => { const o = options.find(x => x.key === key); if (!o) return; const t = ++token.current, ac = new AbortController(); c.compute?.dispose(); c.set({ site: null, status: 'loading', message: `Loading ${o.label}…`, layers: null, sumA: null, sumB: null, compute: null, forKey: a?.key ?? null }); usePlanet.getState().set({ compare: null });
    o.run(ac.signal).then(async site => { if (t !== token.current) return; const comp = new Compute(computeSite(site)); c.set({ site, status: 'ready', compute: comp }); const layers = await comp.run('layers', { baselineM: site.field.posting, tpiRadiusM: site.field.posting * 12 }); if (t === token.current) c.set({ layers }); })
      .catch(e => { if (t === token.current) c.set({ status: 'error', message: `Could not open: ${e instanceof Error ? e.message : e}` }); }); };
  // The comparison survives stage changes; it is reset only when the primary site changes.
  useEffect(() => { const st = useCompare.getState(); if (st.forKey !== (a?.key ?? null)) { st.compute?.dispose(); st.set({ site: null, status: 'idle', layers: null, sumA: null, sumB: null, compute: null, forKey: a?.key ?? null }); usePlanet.getState().set({ compare: null }); } }, [a?.key]);
  const common = a && c.site ? Math.max(a.field.posting, c.site.field.posting) : 0;
  useEffect(() => {
    if (!a || !c.site || !ctl.compute || !c.compute || !common || c.sumA) return; let live = true;
    Promise.all([ctl.compute.run('summary', { baselineM: common, postingM: common }), c.compute.run('summary', { baselineM: common, postingM: common })]).then(([sumA, sumB]) => { if (!live) return; c.set({ sumA, sumB });
      usePlanet.getState().set({ compare: { a: { name: a.name, body: a.body, summary: sumA }, b: { name: c.site!.name, body: c.site!.body, summary: sumB }, commonPostingM: common, baselineM: sumA.baselineM, slopeW1Deg: w1Hist(sumA.slopeHist, sumB.slopeHist), nativePostingsM: [a.field.posting, c.site!.field.posting] } }); }).catch(() => undefined);
    return () => { live = false; };
  }, [a, c.site, c.compute, ctl.compute, common]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!a) return <div className="pl-pad"><SitePicker /><p className="pl-empty">Open a primary site first.</p></div>;
  const A = c.sumA, B = c.sumB, rows: [string, (m: SiteSummary) => string, string][] = [['Relief', m => `${m.reliefM.toFixed(0)} m`, 'measured'], ['Slope p50', m => `${m.slope.p50.toFixed(1)}°`, 'derived'], ['Slope p90', m => `${m.slope.p90.toFixed(1)}°`, 'derived'], ['Roughness p50', m => `${m.roughness.p50.toFixed(2)} m`, 'derived'], ['Area below 15°', m => pct(m.fractionBelow15), 'derived'], ['Area above 25°', m => pct(m.fractionAbove25), 'derived'], ['Grid extent', m => `${m.extentKm.toFixed(1)} km`, 'measured'], ['Valid posts', m => `${(m.validFraction * 100).toFixed(1)} %`, 'measured']];
  return <div className="pl-pad">
    <SitePicker />
    <label className="pl-field">Compare with<select value={c.site?.key ?? ''} onChange={e => openB(e.target.value)}><option value="">Choose a second site…</option>{options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
    <label className="pl-field">Linked cameras<select value={c.sync} onChange={e => c.set({ sync: e.target.value as CompareState['sync'] })}><option value="relative">Same orientation, each site fitted</option><option value="metric">Same orientation and metric scale</option><option value="off">Independent</option></select></label>
    <p className="pl-note">Both views share the rendering mode, layer, contour interval and exaggeration chosen in Inspect. The second site is lit at its own highest Sun in its own record (computed terrain shadows are drawn for the primary view only). Slope, roughness and aspect layers use one shared colour scale. Add Earth candidates in Discover to list them here.</p>
    {c.site && <Section title="Quantitative comparison" tag="terrain-derived">
      {A && B ? <><p className="pl-note">Both grids were block-averaged to <b>{common} m</b> before slope was measured over a {A.baselineM} m baseline (native: {a.field.posting} m and {c.site.field.posting} m). Comparing native grids would mostly measure the resolution difference.</p>
        <dl className="pl-facts"><Fact label="Slope distribution distance (1-Wasserstein)" value={`${w1Hist(A.slopeHist, B.slopeHist).toFixed(2)}°`} evidence="derived" /><Fact label="Gravity" value={`${GRAVITY[a.body]} vs ${GRAVITY[c.site.body]} m/s²`} evidence="curated" /></dl>
        <table className="pl-table"><thead><tr><th>At {common} m</th><th>{a.id}</th><th>{c.site.id}</th></tr></thead><tbody>{rows.map(([label, f]) => <tr key={label}><th>{label}</th><td>{f(A)}</td><td>{f(B)}</td></tr>)}</tbody></table>
        <p className="pl-cap">Slope distribution — bars {a.id}, line {c.site.id}</p><Histogram a={A.slopeHist} b={B.slopeHist} lo={0} hi={45} unit="°" labels={[a.id, c.site.id]} />
        <p className="pl-cap">Elevation distribution, each normalised to its own range</p><Histogram a={A.hypsometry} b={B.hypsometry} lo={0} hi={1} unit="" />
        <p className="pl-note">Terrain geometry is one dimension of analog suitability. Whether a task transfers also depends on gravity, soil, atmosphere and illumination — ask the assistant for the transferability status.</p></> : <p className="pl-empty">Computing…</p>}
    </Section>}
    {ctl.built && ctl.appearance.layer && <Legend map={LAYERS.find(l => l.id === ctl.appearance.layer)!.map} lo={ctl.built.lo} hi={ctl.built.hi} unit={LAYERS.find(l => l.id === ctl.appearance.layer)!.unit} classes={ctl.built.classes} />}
  </div>;
}
export const ComparePanel = Object.assign(ComparePanelBody, { Viewport: CompareViewport });

// ── Decide (report) ─────────────────────────────────────────────────────────
export function ReportPanel() {
  const s = usePlanet(), [msg, setMsg] = useState<string | null>(null), file = useRef<HTMLInputElement>(null), target = s.target();
  const discovery = s.bundle && s.shard && target ? { bundle: s.bundle, target, shard: s.shard, weights: s.weights(), selected: s.inv.candidates[0] ?? null, compare: s.inv.candidates, validation: s.validation } : null;
  const report = useMemo(() => buildReport(s.inv, { site: s.site, layers: s.layers, discovery, atlasVersion: s.atlas?.version ?? null, generatedUtc: new Date().toISOString() }), [s.inv, s.site, s.layers, s.shard, s.atlas]); // eslint-disable-line react-hooks/exhaustive-deps
  const verdicts = s.inv.answers.reduce<Record<string, number>>((m, a) => ({ ...m, [a.verdict]: (m[a.verdict] ?? 0) + 1 }), {});
  return <div className="pl-report">
    <section className="pl-report-side">
      <h1>Decide</h1>
      <label className="pl-field">Research question<textarea rows={3} value={s.inv.question} placeholder="What must this investigation decide?" onChange={e => s.patchInv({ question: e.target.value })} /></label>
      <label className="pl-field">Notes<textarea rows={4} value={s.inv.notes} onChange={e => s.patchInv({ notes: e.target.value })} /></label>
      <h2>Evidence on file</h2>
      <dl className="pl-facts"><Fact label="Target" value={target?.id ?? '—'} /><Fact label="Candidates" value={s.inv.candidates.join(', ') || 'none'} /><Fact label="3D site" value={s.site?.id ?? s.inv.siteKey ?? 'none'} /><Fact label="Marks / measurements" value={`${s.inv.marks.length} / ${s.inv.measurements.length}`} /><Fact label="Saved experiments" value={String(s.inv.experiments.length)} />
        <Fact label="Reviewed answers" value={s.inv.answers.length ? Object.entries(verdicts).map(([k, v]) => `${v} ${k}`).join(' · ') : 'none kept'} /></dl>
      {(verdicts.rejected ?? 0) > 0 && <p className="pl-warnline">The critic rejected {verdicts.rejected} kept answer(s). A decision resting on them is not supported by the evidence on file.</p>}
      <div className="pl-row"><button className="pl-primary" onClick={() => downloadText(report, `${s.inv.id}-report.md`)}>Download report (Markdown)</button><button onClick={() => downloadText(serializeInvestigation(s.inv), `${s.inv.id}.json`, 'application/json')}>Export investigation</button></div>
      <div className="pl-row"><button onClick={() => file.current?.click()}>Import investigation…</button><button onClick={() => s.newInvestigation()}>New investigation</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { s.importInvestigation(await f.text()); setMsg(`Imported ${f.name}.`); } catch (err) { setMsg(err instanceof Error ? err.message : String(err)); } }} /></div>
      {msg && <p className="pl-note" role="status">{msg}</p>}{!s.persisted && <p className="pl-warnline">Browser storage is unavailable: export the investigation to keep it.</p>}
      <h2>Saved investigations</h2>
      <ul className="pl-list">{s.saved.map(e => <li key={e.id} className={e.id === s.inv.id ? 'on' : ''}><button className="pl-link" onClick={() => { const err = s.openInvestigation(e.id); setMsg(err ?? `Opened “${e.title}”.`); }}>{e.title}</button><span>{e.updatedUtc.slice(0, 16).replace('T', ' ')}</span>{e.id !== s.inv.id && <button aria-label={`Delete ${e.title}`} onClick={() => s.deleteInvestigation(e.id)}>×</button>}</li>)}</ul>
    </section>
    <section className="pl-report-doc" aria-label="Report preview"><pre>{report}</pre></section>
  </div>;
}
