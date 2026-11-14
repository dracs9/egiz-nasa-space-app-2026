// Automated data-quality checks on the loaded world. Every check computes something; none is hardcoded.
import { sha256Hex } from '../core/codec';
import type { World } from '../core/world';

export interface QualityCheck { id: string; label: string; status: 'pass' | 'warn' | 'fail' | 'info'; detail: string }

export async function runQualityChecks(world: World, fetchRaw?: (key: string) => Promise<ArrayBuffer>): Promise<QualityCheck[]> {
  const out: QualityCheck[] = [];
  const m = world.manifest;
  // 1. Content hashes of loaded tiles against the manifest.
  if (fetchRaw) {
    const keys = m.pyramid.tiles.filter(t => world.loadedTile(t.key)).slice(0, 48);
    let bad = 0;
    for (const t of keys) if ((await sha256Hex(await fetchRaw(t.key))) !== t.sha256) bad++;
    out.push({ id: 'tile-hash', label: 'Tile content hashes', status: bad ? 'fail' : 'pass', detail: `${keys.length - bad}/${keys.length} loaded tiles match their manifest SHA-256.` });
  }
  // 2. Seam continuity between loaded same-level neighbours (shared posts must be identical).
  let pairs = 0, maxDiff = 0;
  for (const t of m.pyramid.tiles) {
    const a = world.loadedTile(t.key), b = world.loadedTile(`${t.level}/${t.col + 1}_${t.row}`);
    if (!a || !b) continue;
    pairs++;
    for (let r = 1; r < a.n - 1; r++) maxDiff = Math.max(maxDiff, Math.abs(a.posts[r * a.n + (a.n - 2)] - b.posts[r * b.n + 1]));
  }
  out.push({ id: 'seams', label: 'Tile seam continuity', status: pairs === 0 ? 'info' : maxDiff < 0.02 ? 'pass' : 'warn', detail: pairs ? `${pairs} neighbour pairs; max shared-post difference ${maxDiff.toFixed(3)} m (quantization step ≤ 0.04 m).` : 'No adjacent loaded tiles yet.' });
  // 3. Physical plausibility of elevations (lunar range about −9.1 to +10.8 km).
  const implausible = m.pyramid.tiles.filter(t => t.minH < -10000 || t.maxH > 11000).length;
  out.push({ id: 'range', label: 'Elevation plausibility', status: implausible ? 'fail' : 'pass', detail: `${m.pyramid.tiles.length - implausible}/${m.pyramid.tiles.length} tiles within the lunar elevation range; site span ${Math.min(...m.pyramid.tiles.map(t => t.minH)).toFixed(0)}–${Math.max(...m.pyramid.tiles.map(t => t.maxH)).toFixed(0)} m.` });
  // 4. Horizon coverage for shadow / line-of-sight.
  const hv = m.layers.horizon.validFraction ?? 0;
  out.push({ id: 'horizon', label: 'Horizon grid coverage', status: hv > 0.95 ? 'pass' : 'warn', detail: `${(hv * 100).toFixed(1)} % of the 26 × 26 km horizon grid has measured heights; terrain outside the source raster is not modelled as an occluder, so illumination can be overestimated near the footprint edges.` });
  // 5. Illumination record integrity.
  const s = world.illumination.samples;
  let badVec = 0, badStep = 0;
  for (let i = 0; i < s.length; i++) {
    if (Math.abs(Math.hypot(s[i][1], s[i][2], s[i][3]) - 1) > 1e-6 || Math.abs(Math.hypot(s[i][5], s[i][6], s[i][7]) - 1) > 1e-6) badVec++;
    if (i && Math.abs(s[i][0] - s[i - 1][0] - world.illumination.step) > 1e-6) badStep++;
  }
  out.push({ id: 'spice', label: 'SPICE record integrity', status: badVec || badStep ? 'fail' : 'pass', detail: `${s.length} samples, ${world.illumination.step / 3600} h step, ${badVec} non-unit vectors, ${badStep} irregular steps; ${world.illumination.engine}.` });
  // 6. Resolution truthfulness.
  out.push({ id: 'resolution', label: 'Resolution by area', status: 'info', detail: `Native 5 m posts only inside the operational box (${((m.pyramid.operationalBox[2] - m.pyramid.operationalBox[0]) / 1000).toFixed(2)} km square); 20 m analysis elsewhere; boulders (< 5 m) are not resolved anywhere.` });
  // 7. Model domain.
  const incompatible = world.registry.filter(r => r.status.includes('incompatible')).map(r => r.name);
  out.push({ id: 'domain', label: 'Model domain', status: 'info', detail: `Perception models were fitted/run on this site's DEM only. Not used (domain-incompatible): ${incompatible.join('; ') || 'none'}.` });
  // 8. Missing layers.
  for (const [i, text] of m.missingData.entries()) out.push({ id: `missing-${i}`, label: 'Missing data', status: 'warn', detail: text });
  return out;
}
