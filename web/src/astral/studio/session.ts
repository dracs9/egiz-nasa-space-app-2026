// EGIZ ASTRAL · studio session: loads one measured world and derives every analysis layer from it.
import { validateManifest, localToLatLon, type WorldManifest, type WorldTile } from "../world/core";
import { aspectDeg, horizonAngle, inShadow, loadField, roughness, sample, shadowMask, slopeDeg, type Field, type XY } from "../world/field";
import { cellAt, classifyTerrain, dataQuality, detectCraters, detectRocks, fitShading, fitTerrainUnits, similarTo, terrainFeatures, TERRAIN_CLASSES,
  type Crater, type FeatureGrid, type QualityFinding, type Rock, type ShadingFit, type SiteImage, type TerrainUnitModel } from "../intelligence/perception";
import { BLOCK, type NavGrid } from "../sim/traverse";
import { GRAVITY } from "../sim/terramechanics";
import { solarAt, validateGeometry } from "../../mission/solar";
import type { MissionTerrain, SpiceGeometry } from "../../mission/types";

export interface WorldSession {
  dir: string; baseUrl: string; manifest: WorldManifest; field: Field; image: SiteImage | null;
  regional: MissionTerrain | null; solar: SpiceGeometry | null; solarNote: string; gravity: number;
}
export interface SceneAnalysis {
  features: FeatureGrid; classes: Uint8Array; classShare: number[]; units: TerrainUnitModel; craters: Crater[];
  shading: ShadingFit | null; quality: QualityFinding[]; outliers: { cell: number; x: number; y: number; score: number; unit: number }[]; elapsedMs: number;
}
export type LoadStep = (label: string, done: number, total: number) => void;

async function decodeGray(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Image tile ${url}: HTTP ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob()), canvas = document.createElement("canvas");
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0); bitmap.close();
  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data, out = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4];
  return out;
}
/** Stitch one imagery level into a site-wide grayscale raster. */
export async function loadSiteImage(m: WorldManifest, baseUrl: string, level: number, step?: LoadStep): Promise<SiteImage | null> {
  const px = m.encoding.image_px, info = m.levels[level];
  if (!px || !info?.image_px_m) return null;
  const tiles = m.tiles.filter(t => t.level === level && t.image_sha256), side = info.tiles_per_side * px, data = new Uint8Array(side * side);
  let done = 0;
  await Promise.all(tiles.map(async t => { const gray = await decodeGray(`${baseUrl}img/${t.key}.jpg`); for (let r = 0; r < px; r++) data.set(gray.subarray(r * px, (r + 1) * px), (t.row * px + r) * side + t.col * px); step?.("Orthoimage", ++done, tiles.length); }));
  return { side, pixelM: info.image_px_m, west: m.extent.west, north: m.extent.north, data };
}
export async function listWorlds(base: string): Promise<{ dir: string; id: string; name: string; body: string }[]> {
  const response = await fetch(`${base}world/index.json`);
  if (!response.ok) return [];
  const index = await response.json();
  return index?.schema === "egiz.world_index" && Array.isArray(index.sites) ? index.sites : [];
}
export async function loadWorld(base: string, dir: string, step?: LoadStep): Promise<WorldSession> {
  const baseUrl = `${base}world/${dir}/`, response = await fetch(`${baseUrl}manifest.json`);
  if (!response.ok) throw new Error(`World package ${dir} is not available (HTTP ${response.status}). Build it with python -m pipeline.world.scene ${dir}.`);
  const manifest = validateManifest(await response.json());
  const navLevel = Math.max(0, manifest.levels.length - 2), wanted = manifest.tiles.filter(t => t.level === navLevel);
  let done = 0;
  const field = await loadField(manifest, navLevel, async (t: WorldTile) => { const r = await fetch(`${baseUrl}h/${t.key}.bin`); if (!r.ok) throw new Error(`Terrain tile ${t.key}: HTTP ${r.status}`); const b = await r.arrayBuffer(); step?.("Measured elevation", ++done, wanted.length); return b; });
  const image = await loadSiteImage(manifest, baseUrl, Math.max(0, manifest.levels.length - 3), step);
  let regional: MissionTerrain | null = null, solar: SpiceGeometry | null = null, solarNote = "No SPICE geometry record is packaged for this site.";
  try {
    const own = await fetch(`${baseUrl}illumination.json`);
    if (own.ok) { solar = validateIllumination(await own.json(), manifest); solarNote = `${solar.engine}; epoch ${solar.epochUtc}, ${solar.duration / 3600} h at ${solar.step} s steps, frame ${solar.frame}. World-package record (consecutive 24 h CSPICE runs).`; }
  } catch (error) { solarNote = `World illumination record rejected: ${error instanceof Error ? error.message : error}`; }
  try {
    const bundle = await (await fetch(`${base}data/pilot/mission_terrain.json`)).json();
    regional = bundle?.schema === "egiz.mission_terrain" && bundle.synthetic === false ? (bundle.entries.find((e: MissionTerrain) => e.id === manifest.site.id) ?? null) : null;
    if (regional) {
      const catalog = await (await fetch(`${base}data/pilot/spice_geometry.json`)).json(), entry = catalog?.entries?.find((e: SpiceGeometry) => e.siteId === manifest.site.id);
      if (entry && !solar) { solar = validateGeometry(entry, regional); solarNote = `${solar.engine}; epoch ${solar.epochUtc}, ${solar.duration / 3600} h at ${solar.step} s steps, frame ${solar.frame}.`; }
    }
  } catch (error) { solarNote = `SPICE geometry could not be used: ${error instanceof Error ? error.message : error}`; }
  return { dir, baseUrl, manifest, field, image, regional, solar, solarNote, gravity: GRAVITY[manifest.site.body] };
}

/** Accept only a genuine multi-day CSPICE record for this site: same checks as the packaged 24 h geometry, longer span. */
export function validateIllumination(value: unknown, m: WorldManifest): SpiceGeometry {
  const g = value as Omit<SpiceGeometry, "schema"> & { schema: string };
  const ok = g && g.schema === "egiz.world_illumination" && typeof g.engine === "string" && g.engine.includes("CSPICE") && g.siteId === m.site.id && g.body === m.site.body &&
    g.lat === m.site.lat && g.lon === m.site.lon && g.aberration === "NONE" && Number.isFinite(Date.parse(g.epochUtc)) && g.duration > 0 && g.duration <= 10 * 86400 &&
    Array.isArray(g.kernels) && g.kernels.length >= 3 && g.kernels.every(k => /^[a-f0-9]{64}$/.test(k.sha256) && k.url.startsWith("https://naif.jpl.nasa.gov/")) &&
    Array.isArray(g.samples) && g.samples.length >= 2 && g.samples.length <= 15000 && g.samples[0].t === 0 && g.samples[g.samples.length - 1].t === g.duration &&
    g.samples.every((x, i) => (!i || x.t > g.samples[i - 1].t) && Array.isArray(x.sunEnu) && x.sunEnu.length === 3 && Math.abs(Math.hypot(...x.sunEnu) - 1) < 1e-6 && x.solarFluxWm2 > 0 && x.solarFluxWm2 < 2000 && Math.abs(x.elevationDeg) <= 90);
  if (!ok) throw new Error("not a valid CSPICE illumination record for this site");
  return g as unknown as SpiceGeometry;
}

/** Run every site-scale interpretation. Deterministic for a given world package. */
export function analyzeScene(s: WorldSession): SceneAnalysis {
  const t0 = performance.now(), features = terrainFeatures(s.field, s.image), classes = classifyTerrain(features), units = fitTerrainUnits(features);
  const classShare = new Array(TERRAIN_CLASSES.length).fill(0);
  for (const c of classes) classShare[c]++;
  const valid = classes.length - classShare[0];
  const outliers: SceneAnalysis["outliers"] = [];
  for (let k = 0; k < units.anomaly.length; k++) if (units.anomaly[k] >= units.anomalyThreshold) outliers.push({ cell: k, x: features.west + ((k % features.side) + 0.5) * features.cellM, y: features.north - (Math.floor(k / features.side) + 0.5) * features.cellM, score: units.anomaly[k], unit: units.assignment[k] });
  outliers.sort((a, b) => b.score - a.score);
  const shading = s.image ? fitShading(s.field, s.image) : null;
  return { features, classes, classShare: classShare.map(n => n / Math.max(1, valid)), units, craters: detectCraters(s.field), shading, quality: dataQuality(s.field, s.image, shading), outliers, elapsedMs: performance.now() - t0 };
}
/** Shadow-segmentation rock candidates in the finest imagery tiles within `radius` metres of a point. */
export async function detectRocksNear(s: WorldSession, centre: XY, radius: number, sunAzimuthDeg: number): Promise<{ rocks: Rock[]; tiles: string[]; pixelM: number }> {
  const level = s.manifest.levels.length - 1, px = s.manifest.encoding.image_px!;
  const tiles = s.manifest.tiles.filter(t => t.level === level && t.image_sha256 && centre.x + radius > t.west && centre.x - radius < t.west + t.size && centre.y + radius > t.north - t.size && centre.y - radius < t.north);
  const rocks: Rock[] = [];
  for (const t of tiles) rocks.push(...detectRocks({ width: px, height: px, pixelM: t.image_px_m!, west: t.west, north: t.north, data: await decodeGray(`${s.baseUrl}img/${t.key}.jpg`), tileKey: t.key }, sunAzimuthDeg));
  return { rocks: rocks.filter(r => r.confidence >= 0.35 && Math.hypot(r.x - centre.x, r.y - centre.y) <= radius), tiles: tiles.map(t => t.key), pixelM: s.manifest.levels[level].image_px_m! };
}
/** Assumed mapping from terrain class to a mechanical surface profile. A scenario assumption, not a measurement. */
export function soilFromClasses(a: SceneAnalysis, loose: string): (p: XY) => string {
  return p => { const k = cellAt(a.features, p), c = k < 0 ? 0 : a.classes[k]; return c === 3 ? "bedrock" : c === 4 ? "mars-drift" : loose; };
}

export interface PointInfo {
  x: number; y: number; lat: number; lon: number; elevation: number | null; slope: number | null; aspect: number | null; roughness: number | null;
  classId: number | null; unit: number | null; anomaly: number | null; shadowed: boolean | null; sunElevation: number | null; horizonToSun: number | null;
}
export function inspectPoint(s: WorldSession, a: SceneAnalysis | null, p: XY, timeS: number): PointInfo {
  const ll = localToLatLon(s.manifest.site, p.x, p.y), sun = s.solar ? solarAt(s.solar, Math.min(timeS, s.solar.duration)) : null, k = a ? cellAt(a.features, p) : -1;
  return { ...p, ...ll, elevation: sample(s.field, p), slope: slopeDeg(s.field, p), aspect: aspectDeg(s.field, p), roughness: roughness(s.field, p, 2),
    classId: a && k >= 0 ? a.classes[k] : null, unit: a && k >= 0 && a.units.assignment[k] >= 0 ? a.units.assignment[k] : null, anomaly: a && k >= 0 && !Number.isNaN(a.units.anomaly[k]) ? a.units.anomaly[k] : null,
    shadowed: sun ? inShadow(s.field, p, sun.sunEnu) : null, sunElevation: sun?.elevationDeg ?? null, horizonToSun: sun ? horizonAngle(s.field, p, sun.azimuthDeg) : null };
}

// ── overlays: site-wide RGBA rasters, row 0 north ───────────────────────────
export type LayerId = "none" | "elevation" | "slope" | "roughness" | "classes" | "units" | "anomaly" | "similar" | "traversability" | "shadow-hours";
export const LAYERS: { id: LayerId; label: string; provenance: string; needs?: "analysis" | "nav" | "solar" | "reference" }[] = [
  { id: "none", label: "Orthoimage only", provenance: "measured" },
  { id: "elevation", label: "Elevation", provenance: "measured" },
  { id: "slope", label: "Slope", provenance: "terrain-derived" },
  { id: "roughness", label: "Roughness (10 m RMS)", provenance: "terrain-derived" },
  { id: "classes", label: "Terrain classes", provenance: "model-inferred", needs: "analysis" },
  { id: "units", label: "Terrain units (unsupervised)", provenance: "model-inferred", needs: "analysis" },
  { id: "anomaly", label: "Statistical outliers", provenance: "model-inferred", needs: "analysis" },
  { id: "similar", label: "Similar to selection", provenance: "model-inferred", needs: "reference" },
  { id: "traversability", label: "Rover traversability", provenance: "terrain-derived", needs: "nav" },
  { id: "shadow-hours", label: "Shadow duration", provenance: "terrain-derived", needs: "solar" },
];
const hex = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
/** Perceptually ordered ramp (dark blue → teal → yellow), readable over grayscale imagery. */
export function ramp(t: number): [number, number, number] {
  const stops = [[38, 44, 110], [30, 120, 150], [60, 175, 125], [200, 210, 70], [250, 235, 120]], x = Math.max(0, Math.min(0.9999, t)) * (stops.length - 1), i = Math.floor(x), k = x - i;
  return [0, 1, 2].map(j => Math.round(stops[i][j] + (stops[i + 1][j] - stops[i][j]) * k)) as [number, number, number];
}
export const UNIT_COLORS = ["#4e79a7", "#59a14f", "#edc948", "#f28e2b", "#e15759", "#b07aa1", "#76b7b2", "#9c755f"];
export interface Overlay { side: number; rgba: Uint8Array; legend: { label: string; color: string }[]; caption: string }
export function buildOverlay(id: LayerId, s: WorldSession, a: SceneAnalysis | null, extra: { nav?: NavGrid | null; reference?: XY | null; slopeAbove?: number | null }): Overlay | null {
  if (id === "none") return null;
  const f = s.field, side = 512, rgba = new Uint8Array(side * side * 4), step = (f.side - 1) / side;
  const put = (i: number, c: number[], alpha = 255) => { rgba[i * 4] = c[0]; rgba[i * 4 + 1] = c[1]; rgba[i * 4 + 2] = c[2]; rgba[i * 4 + 3] = alpha; };
  const post = (r: number, c: number): XY => ({ x: f.west + (c + 0.5) * step * f.posting, y: f.north - (r + 0.5) * step * f.posting });
  const each = (fn: (p: XY, i: number) => void) => { for (let r = 0; r < side; r++) for (let c = 0; c < side; c++) fn(post(r, c), r * side + c); };
  const swatches = (lo: number, hi: number, unit: string, digits = 0) => [0, 0.25, 0.5, 0.75, 1].map(t => ({ label: `${(lo + (hi - lo) * t).toFixed(digits)}${unit}`, color: `rgb(${ramp(t).join(",")})` }));
  if (id === "elevation") { let lo = Infinity, hi = -Infinity; for (const z of f.z) if (!Number.isNaN(z)) { lo = Math.min(lo, z); hi = Math.max(hi, z); } each((p, i) => { const z = sample(f, p); if (z !== null) put(i, ramp((z - lo) / (hi - lo))); }); return { side, rgba, legend: swatches(lo, hi, " m"), caption: `Elevation above the source datum, ${f.posting} m posts.` }; }
  if (id === "slope") {
    const limit = extra.slopeAbove ?? null;
    each((p, i) => { const v = slopeDeg(f, p); if (v === null) return; if (limit !== null) { if (v >= limit) put(i, [226, 87, 76]); } else put(i, ramp(v / 30)); });
    return limit !== null ? { side, rgba, legend: [{ label: `Slope ≥ ${limit}°`, color: "#e2574c" }], caption: `Cells steeper than ${limit}° over a ${2 * f.posting} m baseline.` } : { side, rgba, legend: swatches(0, 30, "°"), caption: `Slope over a ${2 * f.posting} m baseline; values above 30° share the top colour.` };
  }
  if (id === "roughness") { each((p, i) => { const v = roughness(f, p, 2); if (v !== null) put(i, ramp(v / 0.5)); }); return { side, rgba, legend: swatches(0, 0.5, " m", 2), caption: `RMS height residual about the local plane in a ${5 * f.posting} m window.` }; }
  if (id === "traversability" && extra.nav) {
    const g = extra.nav, colors = [[70, 160, 110], [226, 87, 76], [176, 110, 220], [60, 60, 60], [235, 170, 60], [226, 87, 76]];
    each((p, i) => { const c = Math.round((p.x - g.west) / g.posting), r = Math.round((g.north - p.y) / g.posting), b = g.blocked[r * g.side + c]; put(i, colors[b], b === BLOCK.none ? 110 : 235); });
    return { side, rgba, caption: `Cells the ${g.rover.name} may enter under a ${g.maxSlopeDeg}° limit. Screens slope, 10 m roughness and detected-rock keep-outs at ${g.posting} m.`,
      legend: [{ label: "Traversable", color: "rgb(70,160,110)" }, { label: "Slope limit", color: "rgb(226,87,76)" }, { label: "Roughness limit", color: "rgb(235,170,60)" }, { label: "Rock keep-out", color: "rgb(176,110,220)" }] };
  }
  if (id === "shadow-hours" && s.solar) {
    const samples = 24, total = new Float32Array(257 * 257);
    let daylight = 0;
    for (let k = 0; k < samples; k++) { const sun = solarAt(s.solar, (s.solar.duration * (k + 0.5)) / samples); if (sun.elevationDeg <= 0) continue; daylight++; const mask = shadowMask(f, sun.sunEnu, Math.round((f.side - 1) / 256)); for (let i = 0; i < total.length; i++) total[i] += mask.data[i]; }
    const hours = (s.solar.duration / 3600 / samples);
    each((_, i) => { const r = Math.floor(i / side), c = i % side, v = total[Math.min(256, r >> 1) * 257 + Math.min(256, c >> 1)] / Math.max(1, daylight); if (v > 0.02) put(i, ramp(1 - v), 230); });
    return { side, rgba, legend: swatches(0, daylight * hours, " h lit", 1), caption: `Terrain-shadow time during the ${(daylight * hours).toFixed(1)} h of daylight in the SPICE record, sampled hourly. Only terrain inside the site casts shadow.` };
  }
  if (!a) return null;
  const g = a.features, cell = (p: XY) => cellAt(g, p);
  if (id === "classes") { const colors = TERRAIN_CLASSES.map(c => hex(c.color)); each((p, i) => { const k = cell(p); if (k >= 0 && a.classes[k]) put(i, colors[a.classes[k]], 215); }); return { side, rgba, legend: TERRAIN_CLASSES.slice(1).map(c => ({ label: c.label, color: c.color })), caption: "Rule-based shape and texture classes at 8 m. Not a geological map." }; }
  if (id === "units") { each((p, i) => { const k = cell(p); if (k >= 0 && a.units.assignment[k] >= 0) put(i, hex(UNIT_COLORS[a.units.assignment[k]]), 215); }); return { side, rgba, legend: a.units.sizes.map((_, u) => ({ label: `Unit ${u + 1}`, color: UNIT_COLORS[u] })), caption: "Unsupervised k-means groupings of terrain and image descriptors; unnamed and unvalidated." }; }
  if (id === "anomaly") { each((p, i) => { const k = cell(p), v = k >= 0 ? a.units.anomaly[k] : NaN; if (v >= a.units.anomalyThreshold) put(i, [255, 90, 160], 240); }); return { side, rgba, legend: [{ label: "Top 1% descriptor outliers", color: "rgb(255,90,160)" }], caption: "Cells farthest from their terrain-unit centre. Statistical outliers only — unverified candidates." }; }
  if (id === "similar" && extra.reference) { const ref = cell(extra.reference); if (ref < 0) return null; const sim = similarTo(g, a.units, ref); each((p, i) => { const k = cell(p), v = k >= 0 ? sim[k] : NaN; if (v > 0.55) put(i, ramp(v), Math.round(120 + 135 * v)); }); return { side, rgba, legend: swatches(0.55, 1, "", 2), caption: "Similarity to the selected cell in standardised descriptor space (1 = identical). Query-by-example, same site only." }; }
  return null;
}
