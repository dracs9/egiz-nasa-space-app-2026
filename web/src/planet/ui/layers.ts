// EGIZ Planetary Studio · layer catalogue and rendering modes. Every layer names its evidence class and how it
// was computed; a mode that would need data EGIZ does not have is listed as unavailable with the reason.
import { fieldRange } from '../../astral/world/field';
import type { LayerSet } from '../compute';
import { colorAt, colorize, colorizeClasses, type Colormap } from '../render/colormaps';
import type { BaseMode, LayerTexture, ShadeMode } from '../render/terrainView';
import { mobilityClasses, stats, type Raster } from '../terrain/derive';
import type { Site } from '../terrain/site';

export type LayerId = 'elevation' | 'slope' | 'aspect' | 'roughness' | 'curvature' | 'tpi' | 'mobility' | 'lit' | 'insolation' | 'coverage';
export type Evidence = 'measured' | 'terrain-derived' | 'simulated';
export interface LayerDef { id: LayerId; label: string; evidence: Evidence; unit: string; map: Colormap; needs?: 'insolation'; how: string }
export const LAYERS: LayerDef[] = [
  { id: 'elevation', label: 'Elevation', evidence: 'measured', unit: 'm', map: 'terrain', how: 'Analysis-grid posts above the source vertical datum.' },
  { id: 'slope', label: 'Slope', evidence: 'terrain-derived', unit: '°', map: 'slope', how: 'Central differences over one post spacing.' },
  { id: 'aspect', label: 'Aspect', evidence: 'terrain-derived', unit: '° from N', map: 'cyclic', how: 'Downslope azimuth of the gradient.' },
  { id: 'roughness', label: 'Roughness', evidence: 'terrain-derived', unit: 'm RMS', map: 'viridis', how: 'RMS residual about the best-fit plane in a 5 × 5 post window.' },
  { id: 'curvature', label: 'Curvature', evidence: 'terrain-derived', unit: '1/m', map: 'diverging', how: 'Laplacian of elevation: blue convex (ridges, rims), red concave (floors, channels).' },
  { id: 'tpi', label: 'Landform position', evidence: 'terrain-derived', unit: 'm', map: 'diverging', how: 'Elevation minus neighbourhood mean (TPI): highs and lows relative to surroundings. Geometry only, not geology.' },
  { id: 'mobility', label: 'Rover traversability', evidence: 'simulated', unit: 'class', map: 'slope', how: 'Slope and roughness screened against the configured vehicle limits.' },
  { id: 'lit', label: 'Direct-Sun fraction', evidence: 'terrain-derived', unit: 'fraction', map: 'magma', needs: 'insolation', how: 'Fraction of Sun samples with the solar disc centre above the terrain horizon.' },
  { id: 'insolation', label: 'Solar energy', evidence: 'simulated', unit: 'W/m²', map: 'magma', needs: 'insolation', how: 'Mean direct irradiance on the local surface: flux × assumed beam transmission × cos(incidence).' },
  { id: 'coverage', label: 'Data coverage', evidence: 'measured', unit: 'class', map: 'ice', how: 'Posts with and without elevation in the analysis grid.' },
];
export const MOBILITY_CLASSES: { label: string; color: [number, number, number, number] | null }[] = [
  { label: 'Go', color: [60, 150, 130, 150] }, { label: 'Caution (within 30 % of a limit)', color: [226, 186, 90, 220] }, { label: 'Slope no-go', color: [200, 62, 52, 240] }, { label: 'Roughness no-go', color: [150, 80, 170, 240] },
];
export interface LayerInputs { site: Site; layers: LayerSet | null; insolation: { lit: Raster; irradiance: Raster } | null; limits: { maxSlopeDeg: number; maxStepM: number; tractionLimitDeg?: number; binding?: string }; /** colour range imposed by a linked view, so two sites share one scale */ shared?: { lo: number; hi: number } }
export interface BuiltLayer { texture: LayerTexture; lo: number; hi: number; classes?: { label: string; css: string }[]; note?: string }
const css = (c: [number, number, number, number]) => `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(2)})`;
const tex = (r: { side: number; west: number; north: number; cell: number }, rgba: Uint8Array, smooth = true): LayerTexture => ({ side: r.side, west: r.west, north: r.north, cell: r.cell, rgba, smooth });

export function buildLayer(id: LayerId, i: LayerInputs): BuiltLayer | null {
  const f = i.site.field, grid = { side: f.side, west: f.west, north: f.north, cell: f.posting }, l = i.layers;
  const cont = (r: Raster, map: Colormap, lo: number, hi: number): BuiltLayer => ({ texture: tex(r, colorize(r.data, map, lo, hi)), lo, hi });
  if (id === 'elevation') { const r = fieldRange(f); return cont({ ...grid, data: f.z, unit: 'm', baselineM: f.posting }, 'terrain', r.min, r.max); }
  if (id === 'coverage') { const cls = new Uint8Array(f.z.length); let missing = 0; for (let k = 0; k < cls.length; k++) if (Number.isNaN(f.z[k])) { cls[k] = 1; missing++; }
    return { texture: tex(grid, colorizeClasses(cls, [[70, 130, 150, 90], [214, 70, 60, 255]]), false), lo: 0, hi: 1, classes: [{ label: 'Elevation present', css: 'rgba(70,130,150,.6)' }, { label: 'No data', css: 'rgb(214,70,60)' }], note: `${((missing / cls.length) * 100).toFixed(2)} % of posts have no elevation. No per-post elevation error is published for this product.` }; }
  if (id === 'lit' || id === 'insolation') { if (!i.insolation) return null; const r = id === 'lit' ? i.insolation.lit : i.insolation.irradiance; return cont(r, 'magma', 0, id === 'lit' ? 1 : Math.max(1, stats(r.data).max)); }
  if (!l) return null;
  if (id === 'slope') return cont(l.slope, 'slope', i.shared?.lo ?? 0, i.shared?.hi ?? Math.min(45, Math.max(12, Math.ceil(l.summary.slope.p95 * 1.25))));
  if (id === 'aspect') return cont(l.aspect, 'cyclic', 0, 360);
  if (id === 'roughness') return cont(l.roughness, 'viridis', i.shared?.lo ?? 0, i.shared?.hi ?? Math.max(0.05, l.summary.roughness.p95 * 1.4));
  if (id === 'curvature' || id === 'tpi') { const r = id === 'curvature' ? l.curvature : l.tpi, s = stats(r.data), m = Math.max(Math.abs(s.p5), Math.abs(s.p95)) || 1; return cont(r, 'diverging', -m, m); }
  const cls = mobilityClasses(l.slope, l.roughness, i.limits); let go = 0, valid = 0; for (const c of cls) if (c !== 255) { valid++; if (c < 2) go++; }
  return { texture: tex(grid, colorizeClasses(cls, MOBILITY_CLASSES.map(c => c.color)), false), lo: 0, hi: 3, classes: MOBILITY_CLASSES.map(c => ({ label: c.label, css: css(c.color!) })),
    note: `${((go / Math.max(1, valid)) * 100).toFixed(0)} % of the grid passes the ${i.limits.maxSlopeDeg}° slope${i.limits.binding === 'traction' ? ' (traction limit on the chosen soil)' : i.limits.binding === 'tilt' ? ' (vehicle tilt limit)' : ' (plan limit)'} and ${i.limits.maxStepM} m step screens of the configured vehicle. A screen, not a route.` };
}

/** Hypsometric ramp for the "elevation" base mode, spanning the site's own measured range. */
export function elevationRamp(site: Site): { rgba: Uint8Array; lo: number; hi: number } {
  const r = fieldRange(site.field), rgba = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) { const c = colorAt('terrain', i / 255); rgba.set([c[0], c[1], c[2], 255], i * 4); }
  return { rgba, lo: r.min, hi: r.max };
}
export interface ModeDef { id: string; label: string; base: BaseMode; shade: ShadeMode; layer: LayerId | null; contour: boolean; note: string; unavailable?: (s: Site) => string | null }
export const MODES: ModeDef[] = [
  { id: 'natural', label: 'Natural terrain', base: 'natural', shade: 'physical', layer: null, contour: false, note: 'Measured relief lit by the ephemeris Sun with computed terrain shadows. Imagery is draped where a registered orthoimage exists; otherwise a uniform body tone — no invented surface texture.' },
  { id: 'elevation', label: 'Scientific elevation', base: 'elevation', shade: 'hillshade', layer: null, contour: false, note: 'Hypsometric tint of measured elevation under a fixed cartographic light (simplified visual lighting, not the real Sun).' },
  { id: 'topographic', label: 'Topographic', base: 'mono', shade: 'hillshade', layer: null, contour: true, note: 'Contours of measured elevation over a neutral shaded relief.' },
  { id: 'slope', label: 'Slope analysis', base: 'mono', shade: 'unlit', layer: 'slope', contour: false, note: 'Slope at the analysis posting, unshaded so colour is not biased by lighting.' },
  { id: 'geological', label: 'Geological', base: 'mono', shade: 'hillshade', layer: 'tpi', contour: false, note: 'No verified geological map is packaged for any EGIZ site, so no geological units are drawn. Shown instead: landform position (terrain-derived geometry), which is not a geological classification.', unavailable: () => 'No verified geological map is integrated. Landform position is shown as a geometric substitute.' },
  { id: 'solar', label: 'Solar illumination', base: 'natural', shade: 'physical', layer: 'lit', contour: false, note: 'Physical Sun and computed shadows; the layer integrates direct-Sun fraction over the record (computed on demand).', unavailable: s => (s.sun ? null : 'No Sun record for this site.') },
  { id: 'mission', label: 'Mission suitability', base: 'mono', shade: 'hillshade', layer: 'mobility', contour: false, note: 'Traversability classes for the configured vehicle. Suitability beyond mobility (science value, communications) is not modelled.' },
  { id: 'uncertainty', label: 'Uncertainty', base: 'mono', shade: 'hillshade', layer: 'coverage', contour: false, note: 'Data coverage of the analysis grid. EGIZ has no per-post elevation error for these products, so quantitative elevation uncertainty cannot be mapped; coverage and resolution are shown instead.', unavailable: () => 'Per-post elevation error is not published; showing coverage.' },
  { id: 'traversability', label: 'Rover traversability', base: 'natural', shade: 'physical', layer: 'mobility', contour: false, note: 'Traversability classes over the naturally lit terrain.' },
];
