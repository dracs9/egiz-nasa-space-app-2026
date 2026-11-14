// EGIZ Planetary Studio · unified terrain renderer.
// One Three.js view for every site format. Tiles stream through a quadtree refined by screen-space error;
// every vertex is a measured post (or a decimation / area average of measured posts, as the level table says).
// Scene frame: X east, Z south, Y up; Y = (h − datum)·exaggeration − (x² + y²)/2R, i.e. a local tangent plane with
// the second-order curvature drop (horizontal error < 0.1 m at 13 km on the Moon). Vertical exaggeration is a
// DISPLAY transform applied in the vertex shader: stored heights, slopes, layers and measurements never change.
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { XY } from '../../astral/world/field';
import { heightAt, type Body, type Site, type TerrainTile } from '../terrain/site';

export type ShadeMode = 'physical' | 'hillshade' | 'unlit';
export type BaseMode = 'natural' | 'elevation' | 'mono';
export type Quality = 'performance' | 'balanced' | 'high';
export interface CameraPose { tx: number; ty: number; range: number; headingDeg: number; pitchDeg: number }
export interface LayerTexture { side: number; west: number; north: number; cell: number; rgba: Uint8Array; smooth?: boolean }
export interface Mark extends XY { id: string; label: string; color: string }
export interface PathDraw { id: string; points: XY[]; color: string; width?: number; dashed?: boolean; closed?: boolean }
export interface RingDraw extends XY { id: string; radiusM: number; color: string }
export interface RoverDims { length: number; track: number; wheelRadius: number; wheelWidth: number; wheels: number; clearance: number; solar: boolean }
export interface RoverPose extends XY { headingDeg: number; pitchDeg: number; rollDeg: number; distance: number }
export interface ViewStats { fps: number; tiles: number; pending: number; triangles: number; finestPostingM: number; level: number }
export interface PickPoint extends XY { h: number }

const QUALITY: Record<Quality, { sse: number; pixelRatio: number; maxTiles: number; aniso: number }> = {
  performance: { sse: 5, pixelRatio: 1, maxTiles: 60, aniso: 2 }, balanced: { sse: 2.5, pixelRatio: 1.5, maxTiles: 120, aniso: 8 }, high: { sse: 1.4, pixelRatio: 2, maxTiles: 200, aniso: 16 },
};
export function estimateQuality(): Quality {
  const cores = navigator.hardwareConcurrency ?? 4, memory = (navigator as { deviceMemory?: number }).deviceMemory ?? 8;
  return cores >= 12 && memory >= 8 ? 'high' : cores >= 6 && memory >= 4 ? 'balanced' : 'performance';
}
const LOOK: Record<Body, { tone: [number, number, number]; zenith: string; horizon: string; fog: number; ambient: number }> = {
  moon: { tone: [0.34, 0.335, 0.33], zenith: '#000000', horizon: '#000000', fog: 0, ambient: 0.012 },
  mars: { tone: [0.5, 0.31, 0.19], zenith: '#8f7460', horizon: '#d2b79a', fog: 0.000035, ambient: 0.22 },
  earth: { tone: [0.4, 0.36, 0.29], zenith: '#4f7fa8', horizon: '#c3d2da', fog: 0.000018, ambient: 0.26 },
};

const VERTEX = /* glsl */`
attribute vec2 aGrad; attribute vec2 aFlag;
uniform float uDatum, uExag, uRadius;
varying vec3 vMap; varying vec2 vGrad; varying vec2 vUv; varying vec3 vWorld; varying float vHole;
void main() {
  vMap = position; vGrad = aGrad; vUv = uv; vHole = aFlag.y;
  vec3 p = vec3(position.x, (position.z - uDatum) * uExag - dot(position.xy, position.xy) / (2.0 * uRadius) - aFlag.x, -position.y);
  vWorld = p; gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const FRAGMENT = /* glsl */`
precision highp float;
varying vec3 vMap; varying vec2 vGrad; varying vec2 vUv; varying vec3 vWorld; varying float vHole;
uniform float uExag, uExposure, uAmbient, uSunLevel, uContour, uHasImage, uTint, uFogDensity, uOpA, uOpB, uShadowStrength, uBoxOn;
uniform int uShade, uBase;
uniform vec3 uSun, uTone, uFog, uGeoA, uGeoB, uGeoS, uSel;
uniform vec2 uElev; uniform vec4 uBox;
uniform sampler2D uImage, uRamp, uLayerA, uLayerB, uShadow;
vec2 geo(vec3 g) { return vec2(vMap.x - g.x, g.y - vMap.y) / g.z; }
bool inside(vec2 u) { return u.x >= 0.0 && u.y >= 0.0 && u.x <= 1.0 && u.y <= 1.0; }
void main() {
  if (vHole > 0.5) discard;
  vec3 nTrue = normalize(vec3(-vGrad.x, 1.0, vGrad.y));
  vec3 nShow = normalize(vec3(-vGrad.x * uExag, 1.0, vGrad.y * uExag));
  vec3 base = uTone;
  if (uBase == 0 && uHasImage > 0.5) base = texture2D(uImage, vUv).rgb * mix(vec3(1.0), uTone / max(uTone.g, 1e-3) * 0.92, uTint);
  else if (uBase == 1) base = texture2D(uRamp, vec2(clamp((vMap.z - uElev.x) / max(uElev.y - uElev.x, 1e-3), 0.0, 1.0), 0.5)).rgb;
  else if (uBase == 2) base = vec3(0.42);
  float light = 1.0;
  if (uShade == 0) {
    float shadow = 0.0; vec2 us = geo(uGeoS);
    if (uShadowStrength > 0.0 && inside(us)) shadow = texture2D(uShadow, us).r * uShadowStrength;
    // Physical incidence uses the TRUE surface normal: exaggeration must not change what is lit.
    light = uAmbient + uSunLevel * max(dot(nTrue, uSun), 0.0) * (1.0 - shadow);
  } else if (uShade == 1) {
    light = 0.28 + 0.92 * max(dot(nShow, normalize(vec3(-0.5, 0.7071, -0.5))), 0.0); // cartographic NW light, 45°
  }
  vec3 col = uShade == 0 ? vec3(1.0) - exp(-base * light * uExposure) : base * light;
  float relief = uShade == 2 ? 1.0 : mix(1.0, clamp(light * (uShade == 0 ? uExposure : 1.0), 0.25, 1.15), 0.42);
  vec2 ua = geo(uGeoA); if (uOpA > 0.0 && inside(ua)) { vec4 l = texture2D(uLayerA, ua); col = mix(col, l.rgb * relief, l.a * uOpA); }
  vec2 ub = geo(uGeoB); if (uOpB > 0.0 && inside(ub)) { vec4 l = texture2D(uLayerB, ub); col = mix(col, l.rgb * relief, l.a * uOpB); }
  float dist = length(cameraPosition - vWorld);
  if (uContour > 0.0) {
    float h = vMap.z / uContour, w = fwidth(h);
    float line = 1.0 - smoothstep(0.0, w * 1.3, abs(fract(h - 0.5) - 0.5));
    float major = 1.0 - step(0.5, abs(mod(floor(h + 0.5), 5.0)));
    col = mix(col, vec3(0.93, 0.9, 0.8), line * (0.2 + 0.4 * major) * (1.0 - smoothstep(0.5, 1.6, w)));
  }
  if (uBoxOn > 0.5) {
    vec2 d = min(abs(vMap.xy - uBox.xy), abs(vMap.xy - uBox.zw));
    bool within = vMap.x > uBox.x - 1.0 && vMap.x < uBox.z + 1.0 && vMap.y > uBox.y - 1.0 && vMap.y < uBox.w + 1.0;
    if (within && min(d.x, d.y) < max(2.0, dist * 0.0016)) col = mix(col, vec3(0.86, 0.72, 0.4), 0.75);
  }
  if (uSel.z > 0.0) { float dd = abs(length(vMap.xy - uSel.xy) - uSel.z); col = mix(col, vec3(1.0, 0.85, 0.42), (1.0 - smoothstep(0.0, max(0.6, dist * 0.0022), dd)) * 0.9); }
  if (uFogDensity > 0.0) col = mix(uFog, col, exp(-uFogDensity * uFogDensity * dist * dist));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

type Entry = { tile: TerrainTile; state: 'loading' | 'ready'; mesh?: T.Mesh; texture?: T.Texture; used: number; abort?: AbortController };
const smooth = (k: number) => k * k * (3 - 2 * k);

export class TerrainView {
  readonly renderer: T.WebGLRenderer; readonly camera = new T.PerspectiveCamera(42, 1, 0.5, 400000); readonly controls: OrbitControls;
  private scene = new T.Scene(); private tiles = new Map<string, Entry>(); private group = new T.Group(); private notes = new T.Group(); private roverGroup = new T.Group();
  private uniforms: Record<string, { value: unknown }>; private index: T.BufferAttribute; private ring: number[] = [];
  private q: (typeof QUALITY)[Quality]; private pass = 0; private active = 0; private raf = 0; private dirty = true; private lodDirty = true; private disposed = false;
  private flight: { from: CameraPose; to: CameraPose; start: number; dur: number } | null = null;
  private last = performance.now(); private frames = 0; private elapsed = 0; private fps = 0; private drawn: Entry[] = [];
  private lineMaterials: LineMaterial[] = []; private annotations: { marks: Mark[]; paths: PathDraw[]; rings: RingDraw[] } = { marks: [], paths: [], rings: [] };
  private exag = 1; private exposureAuto = true; private sky: T.Mesh; private look; private observer: ResizeObserver; private follow = false; private pose: RoverPose | null = null; private roverLen = 2;
  private syncing = false; private statsAt = 0; private statsKey = -1;
  onPick?: (p: PickPoint, ev: { shift: boolean; alt: boolean }) => void; onHover?: (p: PickPoint | null) => void; onCamera?: (p: CameraPose) => void; onStats?: (s: ViewStats) => void; onError?: (m: string) => void;

  constructor(private host: HTMLElement, readonly site: Site, quality: Quality = estimateQuality()) {
    this.q = QUALITY[quality]; this.look = LOOK[site.body];
    this.renderer = new T.WebGLRenderer({ antialias: quality !== 'performance', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.pixelRatio)); this.renderer.outputColorSpace = T.SRGBColorSpace;
    const el = this.renderer.domElement; el.tabIndex = 0; el.className = 'pl-canvas';
    el.setAttribute('aria-label', `Interactive 3D terrain of ${site.name}. Drag to orbit, right-drag to pan, scroll to zoom, click to inspect.`);
    host.appendChild(el);
    this.controls = new OrbitControls(this.camera, el);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.09, maxPolarAngle: Math.PI * 0.497, minDistance: 2, maxDistance: (site.extent.east - site.extent.west) * 4, zoomToCursor: true, screenSpacePanning: false });
    this.controls.listenToKeyEvents(el);
    const blank = () => { const t = new T.DataTexture(new Uint8Array(4), 1, 1, T.RGBAFormat); t.needsUpdate = true; return t; };
    const f = site.field, e = site.extent, analysisIsSite = Math.abs((f.side - 1) * f.posting - (e.east - e.west)) < f.posting;
    this.uniforms = {
      uDatum: { value: site.datum }, uExag: { value: 1 }, uRadius: { value: site.radiusM }, uExposure: { value: 1.6 }, uAmbient: { value: this.look.ambient }, uSunLevel: { value: 1 }, uContour: { value: 0 },
      uTint: { value: 0 }, uFogDensity: { value: this.look.fog }, uOpA: { value: 0 }, uOpB: { value: 0 }, uShadowStrength: { value: 0 }, uBoxOn: { value: analysisIsSite ? 0 : 1 },
      uShade: { value: 0 }, uBase: { value: 0 }, uSun: { value: new T.Vector3(-0.5, 0.6, 0.3).normalize() }, uTone: { value: new T.Vector3(...this.look.tone) }, uFog: { value: new T.Color(this.look.horizon) },
      uGeoA: { value: new T.Vector3(0, 0, 1) }, uGeoB: { value: new T.Vector3(0, 0, 1) }, uGeoS: { value: new T.Vector3(0, 0, 1) }, uSel: { value: new T.Vector3() }, uElev: { value: new T.Vector2(0, 1) },
      uBox: { value: new T.Vector4(f.west, f.north - (f.side - 1) * f.posting, f.west + (f.side - 1) * f.posting, f.north) },
      uRamp: { value: blank() }, uLayerA: { value: blank() }, uLayerB: { value: blank() }, uShadow: { value: blank() },
    };
    // Shared topology: cells² quads plus a skirt ring that hides cracks between neighbouring levels.
    const C = site.tiles.cells, V = C + 1, idx: number[] = [];
    for (let r = 0; r < C; r++) for (let c = 0; c < C; c++) { const a = r * V + c; idx.push(a, a + V, a + 1, a + 1, a + V, a + V + 1); }
    for (let c = 0; c < C; c++) this.ring.push(c); for (let r = 0; r < C; r++) this.ring.push(r * V + C); for (let c = C; c > 0; c--) this.ring.push(C * V + c); for (let r = C; r > 0; r--) this.ring.push(r * V);
    this.ring.forEach((a, i) => { const b = this.ring[(i + 1) % this.ring.length], sa = V * V + i, sb = V * V + ((i + 1) % this.ring.length); idx.push(a, b, sa, b, sb, sa, a, sa, b, b, sa, sb); });
    this.index = new T.Uint32BufferAttribute(idx, 1);
    this.sky = new T.Mesh(new T.SphereGeometry(1, 32, 16), new T.ShaderMaterial({ side: T.BackSide, depthWrite: false, depthTest: false, uniforms: { zenith: { value: new T.Color(this.look.zenith) }, horizon: { value: new T.Color(this.look.horizon) }, level: { value: 1 } },
      vertexShader: 'varying vec3 d;void main(){d=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'varying vec3 d;uniform vec3 zenith;uniform vec3 horizon;uniform float level;void main(){float h=pow(clamp(normalize(d).y,0.,1.),.45);gl_FragColor=vec4(mix(horizon,zenith,h)*level,1.);\n#include <colorspace_fragment>\n}' }));
    this.sky.scale.setScalar(200000); this.sky.renderOrder = -10; this.sky.frustumCulled = false;
    this.scene.add(this.sky, this.group, this.notes, this.roverGroup, new T.HemisphereLight('#ffffff', '#3a3530', 1.1));
    const key = new T.DirectionalLight('#fff6e8', 2.2); key.position.set(-1, 2, 1); this.scene.add(key);
    this.controls.addEventListener('start', () => { this.flight = null; this.follow = false; });
    this.controls.addEventListener('change', () => { this.dirty = true; this.lodDirty = true; if (!this.syncing) this.onCamera?.(this.getPose()); });
    this.installPointer();
    el.addEventListener('webglcontextlost', this.lost);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host); this.resize();
    this.setPose(this.overview(), 0);
    this.raf = requestAnimationFrame(this.frame);
    if (import.meta.env.DEV) (window as unknown as { __planet?: unknown }).__planet = this;
  }
  private lost = (ev: Event) => { ev.preventDefault(); this.onError?.('The graphics context was lost. Measurements and results are preserved; reopen the site to restore 3D.'); };

  // ── coordinates ──────────────────────────────────────────────────────────
  private surfaceY(x: number, y: number, lift = 0) { const h = heightAt(this.site, { x, y }); return ((h ?? this.site.datum) - this.site.datum) * this.exag - (x * x + y * y) / (2 * this.site.radiusM) + lift; }
  toScene(p: XY, lift = 0) { return new T.Vector3(p.x, this.surfaceY(p.x, p.y, lift), -p.y); }
  overview(): CameraPose { const e = this.site.extent, f = this.site.field, cx = f.west + ((f.side - 1) * f.posting) / 2, cy = f.north - ((f.side - 1) * f.posting) / 2; return { tx: cx, ty: cy, range: Math.min(e.east - e.west, (f.side - 1) * f.posting * 1.9) * 0.95, headingDeg: 20, pitchDeg: 34 }; }
  getPose(): CameraPose { const o = this.camera.position.clone().sub(this.controls.target), range = o.length(); return { tx: this.controls.target.x, ty: -this.controls.target.z, range, headingDeg: ((Math.atan2(-o.x, o.z) * 180) / Math.PI + 360) % 360, pitchDeg: (Math.asin(Math.max(-1, Math.min(1, o.y / range))) * 180) / Math.PI }; }
  private applyPose(p: CameraPose) {
    const h = (p.headingDeg * Math.PI) / 180, e = (Math.max(1, Math.min(89.5, p.pitchDeg)) * Math.PI) / 180, target = this.toScene({ x: p.tx, y: p.ty });
    this.controls.target.copy(target); this.camera.position.set(target.x - Math.sin(h) * Math.cos(e) * p.range, target.y + Math.sin(e) * p.range, target.z + Math.cos(h) * Math.cos(e) * p.range);
    this.camera.lookAt(target); this.dirty = true; this.lodDirty = true;
  }
  /** Move the camera; `duration` seconds of eased flight (0 = instant; reduced-motion users always get 0). */
  setPose(p: CameraPose, duration = 1.3, silent = false) {
    const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.syncing = silent;
    if (duration <= 0 || reduced) { this.flight = null; this.applyPose(p); this.controls.update(); } else this.flight = { from: this.getPose(), to: p, start: performance.now(), dur: duration * 1000 };
    this.syncing = false;
    if (!silent) this.onCamera?.(p);
  }
  flyTo(p: XY, range?: number) { const c = this.getPose(); this.follow = false; this.setPose({ ...c, tx: p.x, ty: p.y, range: range ?? Math.max(40, Math.min(c.range, (this.site.extent.east - this.site.extent.west) * 0.18)), pitchDeg: Math.max(24, Math.min(55, c.pitchDeg)) }); }
  preset(name: 'overview' | 'top' | 'oblique' | 'surface') {
    const c = this.getPose(); this.follow = false;
    this.setPose(name === 'overview' ? this.overview() : name === 'top' ? { ...c, pitchDeg: 89.5, headingDeg: 0 } : name === 'oblique' ? { ...c, pitchDeg: 22 } : { ...c, range: Math.max(12, this.site.field.posting * 6), pitchDeg: 5 });
  }
  setFollow(on: boolean) { this.follow = on && !!this.pose; this.dirty = true; }

  // ── appearance ───────────────────────────────────────────────────────────
  private tex(l: LayerTexture) { const t = new T.DataTexture(l.rgba, l.side, l.side, T.RGBAFormat); t.colorSpace = T.SRGBColorSpace; t.magFilter = l.smooth === false ? T.NearestFilter : T.LinearFilter; t.minFilter = T.LinearFilter; t.needsUpdate = true; return t; }
  private swap(name: string, next: T.Texture) { (this.uniforms[name].value as T.Texture).dispose(); this.uniforms[name].value = next; this.dirty = true; }
  /** Two independent draped layers (A below B). Rasters are post-registered: pixel centres sit on grid posts. */
  setLayer(slot: 'A' | 'B', layer: LayerTexture | null, opacity = 0.8) {
    if (layer) { this.swap(`uLayer${slot}`, this.tex(layer)); (this.uniforms[`uGeo${slot}`].value as T.Vector3).set(layer.west - layer.cell / 2, layer.north + layer.cell / 2, layer.side * layer.cell); }
    this.uniforms[`uOp${slot}`].value = layer ? opacity : 0; this.dirty = true;
  }
  setLayerOpacity(slot: 'A' | 'B', opacity: number) { if ((this.uniforms[`uOp${slot}`].value as number) > 0 || opacity > 0) this.uniforms[`uOp${slot}`].value = opacity; this.dirty = true; }
  /** Sun direction (ENU) for physical shading and the computed terrain-shadow mask (1 = shadowed). */
  setSun(enu: number[] | null, shadow: { side: number; cell: number; data: Uint8Array } | null) {
    if (enu) {
      (this.uniforms.uSun.value as T.Vector3).set(enu[0], enu[2], -enu[1]).normalize();
      const up = enu[2], day = Math.max(0, Math.min(1, (up + 0.02) / 0.2));
      this.uniforms.uSunLevel.value = up > 0 ? 1 : 0; this.uniforms.uAmbient.value = this.look.ambient * (0.08 + 0.92 * day);
      (this.sky.material as T.ShaderMaterial).uniforms.level.value = 0.03 + 0.97 * day; (this.uniforms.uFog.value as T.Color).set(this.look.horizon).multiplyScalar(0.03 + 0.97 * day);
      if (this.exposureAuto) this.uniforms.uExposure.value = Math.min(9, 1.5 / Math.max(0.16, up + 0.06));
    }
    if (shadow) {
      const bytes = new Uint8Array(shadow.data.length); for (let i = 0; i < bytes.length; i++) bytes[i] = shadow.data[i] === 1 ? 255 : 0;
      const t = new T.DataTexture(bytes, shadow.side, shadow.side, T.RedFormat); t.magFilter = t.minFilter = T.LinearFilter; t.needsUpdate = true; this.swap('uShadow', t);
      (this.uniforms.uGeoS.value as T.Vector3).set(this.site.field.west - shadow.cell / 2, this.site.field.north + shadow.cell / 2, shadow.side * shadow.cell);
    }
    this.uniforms.uShadowStrength.value = shadow ? 0.94 : 0; this.dirty = true;
  }
  setShade(mode: ShadeMode) { this.uniforms.uShade.value = mode === 'physical' ? 0 : mode === 'hillshade' ? 1 : 2; this.dirty = true; }
  setBase(mode: BaseMode, ramp?: { rgba: Uint8Array; lo: number; hi: number }) {
    this.uniforms.uBase.value = mode === 'natural' ? 0 : mode === 'elevation' ? 1 : 2;
    if (ramp) { const t = new T.DataTexture(ramp.rgba, ramp.rgba.length / 4, 1, T.RGBAFormat); t.colorSpace = T.SRGBColorSpace; t.magFilter = t.minFilter = T.LinearFilter; t.needsUpdate = true; this.swap('uRamp', t); (this.uniforms.uElev.value as T.Vector2).set(ramp.lo, ramp.hi); }
    this.dirty = true;
  }
  setExposure(v: number | null) { this.exposureAuto = v === null; if (v !== null) this.uniforms.uExposure.value = v; this.dirty = true; }
  setContours(intervalM: number) { this.uniforms.uContour.value = intervalM; this.dirty = true; }
  setTint(on: boolean) { this.uniforms.uTint.value = on ? 1 : 0; this.dirty = true; }
  setSelection(s: { x: number; y: number; r: number } | null) { (this.uniforms.uSel.value as T.Vector3).set(s?.x ?? 0, s?.y ?? 0, s?.r ?? 0); this.dirty = true; }
  /** Display-only vertical exaggeration (1 = true scale). */
  setExaggeration(v: number) { const p = this.getPose(); this.exag = v; this.uniforms.uExag.value = v; this.applyPose(p); this.drawAnnotations(); if (this.pose) this.setRoverPose(this.pose); }
  get exaggeration() { return this.exag; }

  // ── tiles ────────────────────────────────────────────────────────────────
  private build(t: TerrainTile, h: Float32Array) {
    const C = this.site.tiles.cells, V = C + 1, n = C + 3, count = V * V + this.ring.length, p = t.posting;
    const pos = new Float32Array(count * 3), grad = new Float32Array(count * 2), uv = new Float32Array(count * 2), flag = new Float32Array(count * 2);
    for (let r = 0; r < V; r++) for (let c = 0; c < V; c++) {
      const i = r * V + c, j = (r + 1) * n + c + 1, z = h[j], hole = Number.isNaN(z);
      pos[i * 3] = t.west + c * p; pos[i * 3 + 1] = t.north - r * p; pos[i * 3 + 2] = hole ? t.minH : z;
      const gx = (h[j + 1] - h[j - 1]) / (2 * p), gy = (h[j - n] - h[j + n]) / (2 * p), ok = !Number.isNaN(gx + gy);
      grad[i * 2] = ok ? gx : 0; grad[i * 2 + 1] = ok ? gy : 0; uv[i * 2] = c / C; uv[i * 2 + 1] = 1 - r / C; flag[i * 2 + 1] = hole ? 1 : 0;
    }
    this.ring.forEach((a, k) => { const i = V * V + k; pos.set(pos.subarray(a * 3, a * 3 + 3), i * 3); grad.set(grad.subarray(a * 2, a * 2 + 2), i * 2); uv.set(uv.subarray(a * 2, a * 2 + 2), i * 2); flag[i * 2] = Math.max(p * 1.5, t.error * 3); flag[i * 2 + 1] = flag[a * 2 + 1]; });
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('aGrad', new T.BufferAttribute(grad, 2)); g.setAttribute('uv', new T.BufferAttribute(uv, 2)); g.setAttribute('aFlag', new T.BufferAttribute(flag, 2)); g.setIndex(this.index);
    return g;
  }
  private ensure(t: TerrainTile): Entry | null {
    let e = this.tiles.get(t.key);
    if (e) { e.used = this.pass; return e; }
    if (this.active >= 6) return null;
    const abort = new AbortController(); e = { tile: t, state: 'loading', used: this.pass, abort }; this.tiles.set(t.key, e); this.active++;
    const entry = e;
    (async () => {
      const h = await this.site.tiles.heights(t, abort.signal);
      let texture: T.Texture | undefined;
      if (t.image) { texture = await new T.TextureLoader().loadAsync(t.image); texture.colorSpace = T.SRGBColorSpace; texture.anisotropy = Math.min(this.q.aniso, this.renderer.capabilities.getMaxAnisotropy()); texture.wrapS = texture.wrapT = T.ClampToEdgeWrapping; }
      if (abort.signal.aborted || this.disposed || this.tiles.get(t.key) !== entry) { texture?.dispose(); return; }
      const material = new T.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: { ...this.uniforms, uImage: { value: texture ?? this.uniforms.uRamp.value }, uHasImage: { value: texture ? 1 : 0 } } });
      const mesh = new T.Mesh(this.build(t, h), material); mesh.frustumCulled = false; mesh.visible = false; mesh.matrixAutoUpdate = false;
      entry.mesh = mesh; entry.texture = texture; entry.state = 'ready'; entry.abort = undefined; this.group.add(mesh);
    })().catch(err => { if (this.tiles.get(t.key) === entry) this.tiles.delete(t.key); if (!abort.signal.aborted && !this.disposed) this.onError?.(`Terrain tile ${t.key} failed to load: ${err instanceof Error ? err.message : err}`); })
      .finally(() => { this.active--; this.lodDirty = true; this.dirty = true; });
    return e;
  }
  private drop(e: Entry) { e.abort?.abort(); if (e.mesh) { this.group.remove(e.mesh); e.mesh.geometry.setIndex(null); e.mesh.geometry.dispose(); (e.mesh.material as T.Material).dispose(); } e.texture?.dispose(); this.tiles.delete(e.tile.key); }
  private updateLod() {
    this.pass++; this.camera.updateMatrixWorld();
    const frustum = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse)), box = new T.Box3();
    const k = this.renderer.domElement.clientHeight / (2 * Math.tan((this.camera.fov * Math.PI) / 360)), eye = this.camera.position, R = this.site.radiusM, d0 = this.site.datum, next: Entry[] = [];
    const bounds = (t: TerrainTile) => {
      const far = Math.max(Math.abs(t.west), Math.abs(t.west + t.size)) ** 2 + Math.max(Math.abs(t.north), Math.abs(t.north - t.size)) ** 2;
      return box.set(new T.Vector3(t.west, (t.minH - d0) * this.exag - far / (2 * R) - t.posting * 2, -t.north), new T.Vector3(t.west + t.size, (t.maxH - d0) * this.exag + 2, -t.north + t.size));
    };
    const visit = (t: TerrainTile) => {
      const b = bounds(t);
      if (!frustum.intersectsBox(b)) return;
      const e = this.ensure(t), dist = Math.max(1, b.distanceToPoint(eye));
      const kids = (t.error * this.exag * k) / dist > this.q.sse ? this.site.tiles.children(t) : [];
      if (kids.length) { const ks = kids.map(c => this.ensure(c)); if (ks.every(c => c?.state === 'ready')) { kids.forEach(visit); return; } }
      if (e?.state === 'ready') next.push(e);
    };
    this.site.tiles.roots.forEach(visit);
    for (const e of this.drawn) if (e.mesh) e.mesh.visible = false;
    for (const e of next) e.mesh!.visible = true;
    this.drawn = next;
    for (const e of [...this.tiles.values()]) {
      if (e.used === this.pass || e.tile.level === 0) continue;
      if (e.state === 'loading' || (this.tiles.size > this.q.maxTiles && this.pass - e.used > 240)) this.drop(e);
    }
  }

  // ── interaction ──────────────────────────────────────────────────────────
  /** Intersect a view ray with the analysis height model (not with GPU-displaced triangles): exact and LOD-independent. */
  pick(clientX: number, clientY: number): PickPoint | null {
    const r = this.renderer.domElement.getBoundingClientRect(), ray = new T.Raycaster();
    ray.setFromCamera(new T.Vector2(((clientX - r.left) / r.width) * 2 - 1, (-(clientY - r.top) / r.height) * 2 + 1), this.camera);
    const o = ray.ray.origin, d = ray.ray.direction, e = this.site.extent, far = (e.east - e.west) * 6, min = this.site.field.posting * 0.5, at = (t: number) => o.y + d.y * t - this.surfaceY(o.x + d.x * t, -(o.z + d.z * t));
    let prev = 0, gPrev = at(0);
    for (let t = min; t < far; t += Math.max(min, t * 0.004)) {
      const x = o.x + d.x * t, y = -(o.z + d.z * t);
      if (heightAt(this.site, { x, y }) === null) { prev = t; gPrev = 1; continue; }
      const g = at(t);
      if (g <= 0 && gPrev > 0) {
        let a = prev, b = t;
        for (let i = 0; i < 24; i++) { const m = (a + b) / 2; if (at(m) > 0) a = m; else b = m; }
        const p = { x: o.x + d.x * b, y: -(o.z + d.z * b) }, h = heightAt(this.site, p);
        return h === null ? null : { ...p, h };
      }
      prev = t; gPrev = g;
    }
    return null;
  }
  private installPointer() {
    const el = this.renderer.domElement; let down = { x: 0, y: 0 }, hoverAt = 0;
    el.addEventListener('pointerdown', ev => { down = { x: ev.clientX, y: ev.clientY }; });
    el.addEventListener('pointerup', ev => { if (ev.button !== 0 || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 5) return; const p = this.pick(ev.clientX, ev.clientY); if (p) this.onPick?.(p, { shift: ev.shiftKey, alt: ev.altKey }); });
    el.addEventListener('pointermove', ev => { const now = performance.now(); if (!this.onHover || now - hoverAt < 70 || ev.buttons) return; hoverAt = now; this.onHover(this.pick(ev.clientX, ev.clientY)); });
    el.addEventListener('pointerleave', () => this.onHover?.(null));
  }
  private resize() { const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight); this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); for (const m of this.lineMaterials) m.resolution.set(w, h); this.dirty = true; this.lodDirty = true; }

  // ── annotations and vehicle ──────────────────────────────────────────────
  private clear(g: T.Group) { g.traverse(o => { const m = o as T.Mesh; m.geometry?.dispose(); for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) { (mat as T.SpriteMaterial).map?.dispose(); mat.dispose(); } }); g.clear(); }
  setAnnotations(a: Partial<{ marks: Mark[]; paths: PathDraw[]; rings: RingDraw[] }>) { this.annotations = { ...this.annotations, ...a }; this.drawAnnotations(); }
  private drawAnnotations() {
    this.clear(this.notes); this.lineMaterials = [];
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1, post = this.site.field.posting, lift = Math.max(0.4, post * 0.12);
    const line = (pts: XY[], color: string, width: number, dashed: boolean) => {
      const flat: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[i + 1]; const n = b ? Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / post)) : 1;
        for (let k = 0; k < (b ? n : 1); k++) { const v = this.toScene(b ? { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n } : a, lift); flat.push(v.x, v.y, v.z); }
      }
      if (flat.length < 6) return;
      const m = new LineMaterial({ color, linewidth: width, dashed, dashSize: post * 3, gapSize: post * 2, transparent: true, opacity: dashed ? 0.75 : 0.96, depthTest: false }); m.resolution.set(w, h); this.lineMaterials.push(m);
      const l = new Line2(new LineGeometry().setPositions(flat), m); l.computeLineDistances(); l.renderOrder = 12; this.notes.add(l);
    };
    for (const p of this.annotations.paths) if (p.points.length > 1) line(p.closed ? [...p.points, p.points[0]] : p.points, p.color, p.width ?? 2.4, !!p.dashed);
    for (const r of this.annotations.rings) line(Array.from({ length: 65 }, (_, i) => ({ x: r.x + Math.cos((i / 64) * 2 * Math.PI) * r.radiusM, y: r.y + Math.sin((i / 64) * 2 * Math.PI) * r.radiusM })), r.color, 1.3, false);
    for (const mk of this.annotations.marks) {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 64; const ctx = canvas.getContext('2d')!;
      ctx.font = "500 24px 'IBM Plex Mono', monospace"; const tw = Math.min(300, ctx.measureText(mk.label).width + 30);
      ctx.fillStyle = 'rgba(6,8,10,.86)'; ctx.fillRect((320 - tw) / 2, 12, tw, 40); ctx.fillStyle = mk.color; ctx.fillRect((320 - tw) / 2, 12, 3, 40); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f1ede4'; ctx.fillText(mk.label, 161, 33, 280);
      const s = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(canvas), depthTest: false, sizeAttenuation: false, transparent: true })); s.scale.set(0.13, 0.026, 1); s.center.set(0.5, -0.9); s.renderOrder = 20;
      const base = this.toScene(mk), stem = Math.max(3, post * 1.2); s.position.copy(base).add(new T.Vector3(0, stem, 0)); this.notes.add(s);
      const pin = new T.Mesh(new T.CylinderGeometry(post * 0.03, post * 0.03, stem, 6), new T.MeshBasicMaterial({ color: mk.color, depthTest: false, transparent: true, opacity: 0.85 })); pin.position.copy(base).add(new T.Vector3(0, stem / 2, 0)); pin.renderOrder = 15; this.notes.add(pin);
    }
    this.dirty = true;
  }
  /** Vehicle drawn from the configured dimensions (illustrative shape, measured-terrain placement). */
  setRover(d: RoverDims | null) {
    this.clear(this.roverGroup); this.pose = null;
    if (!d) { this.dirty = true; return; }
    const body = new T.MeshStandardMaterial({ color: '#d9d4c7', roughness: 0.6, metalness: 0.25 }), dark = new T.MeshStandardMaterial({ color: '#1c1d1f', roughness: 0.8 }), gold = new T.MeshStandardMaterial({ color: '#b8935a', roughness: 0.45, metalness: 0.6 });
    const rows = d.wheels / 2, deck = d.clearance + d.wheelRadius * 0.4, hull = new T.Mesh(new T.BoxGeometry(d.track * 0.62, d.wheelRadius * 1.3, d.length * 0.82), body); hull.position.y = deck + d.wheelRadius * 0.65; this.roverGroup.add(hull);
    for (let i = 0; i < rows; i++) for (const side of [-1, 1]) {
      const z = rows === 1 ? 0 : -d.length / 2 + (i * d.length) / (rows - 1), wheel = new T.Mesh(new T.CylinderGeometry(d.wheelRadius, d.wheelRadius, d.wheelWidth, 20), dark); wheel.rotation.z = Math.PI / 2; wheel.position.set((side * d.track) / 2, d.wheelRadius, z); wheel.name = 'wheel'; this.roverGroup.add(wheel);
      const strut = new T.Mesh(new T.BoxGeometry(d.wheelWidth * 0.3, deck, d.wheelWidth * 0.3), gold); strut.position.set(side * d.track * 0.4, d.wheelRadius + deck / 2, z); this.roverGroup.add(strut);
    }
    const mast = new T.Mesh(new T.CylinderGeometry(d.wheelRadius * 0.12, d.wheelRadius * 0.12, d.length * 0.6, 8), body); mast.position.set(0, deck + d.wheelRadius * 1.3 + d.length * 0.3, -d.length * 0.28); this.roverGroup.add(mast);
    const head = new T.Mesh(new T.BoxGeometry(d.track * 0.3, d.wheelRadius * 0.5, d.wheelRadius * 0.5), dark); head.position.set(0, deck + d.wheelRadius * 1.3 + d.length * 0.6, -d.length * 0.28); this.roverGroup.add(head);
    if (d.solar) { const panel = new T.Mesh(new T.BoxGeometry(d.track * 1.15, 0.03, d.length * 0.7), new T.MeshStandardMaterial({ color: '#16233f', roughness: 0.3, metalness: 0.5 })); panel.position.set(0, deck + d.wheelRadius * 1.4, d.length * 0.06); this.roverGroup.add(panel); }
    this.roverLen = d.length; this.roverGroup.userData.wheelRadius = d.wheelRadius; this.roverGroup.visible = false; this.dirty = true;
  }
  setRoverPose(p: RoverPose | null) {
    this.pose = p; this.roverGroup.visible = !!p && this.roverGroup.children.length > 0;
    if (p) {
      this.roverGroup.position.copy(this.toScene(p)); this.roverGroup.rotation.set((p.pitchDeg * Math.PI) / 180, (-p.headingDeg * Math.PI) / 180, (-p.rollDeg * Math.PI) / 180, 'YXZ');
      // Readability scale at coarse postings: a 2 m rover on 32 m posts would be sub-pixel. Scale is display-only.
      this.roverGroup.scale.setScalar(Math.max(1, this.site.field.posting / 4));
      const spin = p.distance / (this.roverGroup.userData.wheelRadius as number); for (const c of this.roverGroup.children) if (c.name === 'wheel') c.rotation.x = -spin;
    }
    this.dirty = true;
  }
  get roverScale() { return Math.max(1, this.site.field.posting / 4); }

  // ── frame loop ───────────────────────────────────────────────────────────
  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = (now - this.last) / 1000; this.last = now;
    if (document.hidden || !this.host.clientWidth) return;
    if (this.flight) {
      const f = this.flight, k = smooth(Math.min(1, (now - f.start) / f.dur)), turn = ((f.to.headingDeg - f.from.headingDeg + 540) % 360) - 180;
      this.syncing = true;
      this.applyPose({ tx: f.from.tx + (f.to.tx - f.from.tx) * k, ty: f.from.ty + (f.to.ty - f.from.ty) * k, range: Math.exp(Math.log(f.from.range) + (Math.log(f.to.range) - Math.log(f.from.range)) * k), headingDeg: f.from.headingDeg + turn * k, pitchDeg: f.from.pitchDeg + (f.to.pitchDeg - f.from.pitchDeg) * k });
      this.syncing = false;
      if (k >= 1) this.flight = null;
    } else if (this.follow && this.pose) {
      const c = this.getPose(), a = 1 - Math.exp(-Math.min(dt, 0.3) * 3);
      this.syncing = true; this.applyPose({ ...c, tx: c.tx + (this.pose.x - c.tx) * a, ty: c.ty + (this.pose.y - c.ty) * a, range: Math.min(c.range, this.roverLen * this.roverScale * 14) }); this.syncing = false;
    } else if (this.controls.update()) { this.dirty = true; this.lodDirty = true; }
    const ground = this.surfaceY(this.camera.position.x, -this.camera.position.z, 1.2);
    if (this.camera.position.y < ground) { this.camera.position.y = ground; this.dirty = true; }
    if (this.lodDirty) { this.updateLod(); this.lodDirty = false; this.dirty = true; }
    if (!this.dirty) return;
    const d = this.camera.position.distanceTo(this.controls.target);
    this.camera.near = Math.max(0.3, d / 3000); this.camera.far = Math.max(60000, d * 40); this.camera.updateProjectionMatrix(); this.sky.position.copy(this.camera.position); this.sky.scale.setScalar(this.camera.far * 0.8);
    this.renderer.render(this.scene, this.camera); this.dirty = false;
    // Rendering is on demand, so only back-to-back frames say anything about frame rate.
    if (dt < 0.1) { this.frames++; this.elapsed += dt; }
    const statsKey = this.drawn.length * 100 + this.active;
    if (this.drawn.length && (this.elapsed > 0.5 || now - this.statsAt > 700 || statsKey !== this.statsKey)) {
      this.statsKey = statsKey;
      if (this.elapsed > 0.5) { this.fps = Math.round(this.frames / this.elapsed); this.frames = 0; this.elapsed = 0; }
      this.statsAt = now;
      const level = this.drawn.reduce((m, e) => Math.max(m, e.tile.level), 0);
      this.onStats?.({ fps: this.fps, tiles: this.drawn.length, pending: this.active, triangles: this.renderer.info.render.triangles, level, finestPostingM: this.drawn.reduce((m, e) => Math.min(m, e.tile.posting), Infinity) });
    }
  };
  /** Force a redraw (after external state changes). */
  invalidate() { this.dirty = true; }
  get loadedTiles() { return this.tiles.size; }
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.raf); this.observer.disconnect(); this.controls.dispose(); this.renderer.domElement.removeEventListener('webglcontextlost', this.lost);
    for (const e of [...this.tiles.values()]) this.drop(e);
    this.clear(this.notes); this.clear(this.roverGroup); this.sky.geometry.dispose(); (this.sky.material as T.Material).dispose();
    for (const k of ['uRamp', 'uLayerA', 'uLayerB', 'uShadow']) (this.uniforms[k].value as T.Texture).dispose();
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove();
    if (import.meta.env.DEV && (window as unknown as { __planet?: unknown }).__planet === this) delete (window as unknown as { __planet?: unknown }).__planet;
  }
}
