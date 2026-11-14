// Contextual inspector: the same object ids and analysis functions as the scene, planner and copilot.
import { useMemo } from 'react';
import { Crosshair, Flag, FlaskConical, MapPin, MessageSquare, ScrollText } from 'lucide-react';
import { useStudio } from './api';
import { FactList } from './facts';
import { locationFacts, type Fact } from '../world/intelligence/tools';
import { bodiesAt } from '../world/analysis/illumination';
import { nearestGentle } from '../world/sim/mission';

export function Inspector() {
  const s = useStudio();
  const { world, selection, mission, time } = s;
  const obj = selection?.kind === 'object' ? world.object(selection.id) : null;
  const wp = selection?.kind === 'object' && !obj ? [{ id: 'wp-start', ...mission.start, label: 'A · start' }, ...(mission.destination ? [{ id: 'wp-destination', ...mission.destination, label: 'B · destination' }] : []), ...mission.waypoints].find(w => w.id === selection.id) ?? null : null;
  const point = obj ?? wp ?? (selection?.kind === 'point' ? selection : null);
  const facts = useMemo(() => point ? locationFacts({ world, time }, point) : null, [world, time, point]);

  if (!point || !facts) {
    const m = world.manifest, b = bodiesAt(world.illumination, time);
    const site: Fact[] = [
      { label: 'Source', value: `${m.source.product} (${m.source.citation})`, cls: 'measured' },
      { label: 'Resolution', value: `native 5 m inside the ${(m.pyramid.operationalBox[2] - m.pyramid.operationalBox[0]) / 1000} km operational box; ${m.pyramid.postingsM.join(' / ')} m pyramid levels`, cls: 'measured' },
      { label: 'Frame', value: `${m.referenceFrame.body}, sphere R = ${m.referenceFrame.radiusM} m; curvature applied in the 3D world`, cls: 'derived' },
      { label: 'Detections', value: `${m.objects.craters} crater candidates, ${m.objects.anomalies} anomaly regions`, cls: 'model' },
      { label: 'Sun now', value: `${b.sunElevationDeg.toFixed(2)}° elevation, ${b.sunAzimuthDeg.toFixed(0)}° azimuth (${(b.fluxWm2).toFixed(0)} W/m²)`, cls: 'simulated' },
      ...m.missingData.slice(0, 3).map(t => ({ label: 'Missing', value: t, cls: 'unknown' as const })),
    ];
    return <div className="astral-inspect">
      <p className="astral-kicker">Site</p><h2>{m.name}</h2>
      <p className="astral-muted">Click the terrain or a detected feature to inspect it. Every value below is labelled by evidence class.</p>
      <FactList facts={site} compact />
    </div>;
  }

  const ask = (q: string) => void s.ask(q);
  const label = obj ? obj.id : wp ? wp.label : `Point (${point.x.toFixed(0)}, ${point.y.toFixed(0)}) m`;
  const objFacts: Fact[] = obj ? [
    { label: 'Evidence class', value: obj.evidenceClass, cls: obj.evidenceClass === 'model-detected' ? 'model' : obj.evidenceClass === 'computational-hypothesis' ? 'hypothesis' : 'derived' },
    { label: 'Confidence', value: obj.confidence === null ? 'statistical candidate — no score' : `${obj.confidence} (heuristic score, not a probability)`, cls: 'model' },
    ...Object.entries(obj.properties).filter(([k]) => k !== 'drivers' && k !== 'name').map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: String(v), cls: 'model' as const })),
    ...(Array.isArray(obj.properties.drivers) ? [{ label: 'Outlier drivers', value: (obj.properties.drivers as { feature: string; zScore: number }[]).map(d => `${d.feature} (z ${d.zScore})`).join(', '), cls: 'model' as const }] : []),
    { label: 'Produced by', value: `${obj.provenance.modelId ?? 'reference'} · ${obj.provenance.input}`, cls: 'derived' },
  ] : [];
  const routeHere = () => {
    const dir = Math.atan2(mission.start.y - point.y, mission.start.x - point.x), r = obj && obj.radius > 0 ? obj.radius * 1.25 : 0;
    const p = nearestGentle(world, { x: point.x + Math.cos(dir) * r, y: point.y + Math.sin(dir) * r }, Math.min(8, mission.constraints.maxSlopeDeg * 0.6), 300);
    if (!p || !world.inOperational(p)) return;
    s.setMission({ ...mission, destination: p, returnToStart: false, name: obj ? `Traverse to ${obj.id}` : mission.name });
    s.setPanel('mission');
  };
  const addStop = () => {
    const p = nearestGentle(world, point, Math.min(10, mission.constraints.maxSlopeDeg * 0.6), 200);
    if (!p || !world.inOperational(p) || mission.waypoints.length >= 8) return;
    s.setMission({ ...mission, waypoints: [...mission.waypoints, { id: `wp-${mission.waypoints.length + 1}`, x: p.x, y: p.y, dwellS: 1800, instrumentIds: ['nss', 'nirvss', 'cams'], label: `S${mission.waypoints.length + 1} · ${obj ? obj.id : 'user stop'}`, objectRef: obj?.id, rationale: obj ? `User-selected near ${obj.id}` : 'User-selected location' }] });
    s.setPanel('mission');
  };
  const inBox = world.inOperational(point);
  return <div className="astral-inspect">
    <p className="astral-kicker">{obj ? obj.type : wp ? 'mission marker' : 'terrain location'}</p>
    <h2>{label}</h2>
    {wp && 'rationale' in wp && typeof wp.rationale === 'string' && <p className="astral-muted">{wp.rationale}</p>}
    <div className="astral-actions">
      <button className="astral-btn ghost" onClick={() => s.select(selection, true)}><Crosshair size={13} />Fly to</button>
      <button className="astral-btn ghost" onClick={() => ask(obj ? `Explain ${obj.id}` : 'Explain the selected location')}><MessageSquare size={13} />Explain</button>
      {obj && obj.type !== 'reference' && <button className="astral-btn ghost" onClick={() => ask(`Generate a hypothesis for ${obj.id}`)}><FlaskConical size={13} />Hypothesis</button>}
      <button className="astral-btn ghost" onClick={() => ask(obj ? `Show the evidence behind ${obj.id}` : 'Show the evidence behind this location')}><ScrollText size={13} />Evidence</button>
      <button className="astral-btn ghost" disabled={!inBox} title={inBox ? 'Set as mission destination' : 'Outside the 5 m operational box'} onClick={routeHere}><Flag size={13} />Route here</button>
      <button className="astral-btn ghost" disabled={!inBox} title={inBox ? 'Add a science stop here' : 'Outside the 5 m operational box'} onClick={addStop}><MapPin size={13} />Add stop</button>
    </div>
    {objFacts.length > 0 && <><h3>Detection</h3><FactList facts={objFacts} compact /></>}
    <h3>Location</h3>
    <FactList facts={facts.facts} compact />
    {facts.notes.map(n => <p key={n} className="astral-note">{n}</p>)}
  </div>;
}
