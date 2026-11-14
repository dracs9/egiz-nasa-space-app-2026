// EGIZ ASTRAL world renderer. Streams the measured tile pyramid with screen-space-error LOD, lights it
// with the SPICE Sun through a lunar photometric function, bakes terrain shadows on the GPU with the
// same ray march as the power model, and draws scene objects, routes, tracks and the rover.
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { aeqdToEnu, enuToAeqd } from '../core/coordinates';
import type { MapPoint, SceneObject } from '../core/types';
import type { World } from '../core/world';
import type { Frame } from '../sim/traverse';
import type { RoverProfile } from '../sim/rover';
import { illustrativeRocks } from '../sim/rocks';
import { bodiesAt, sunVisibleFraction } from '../analysis/illumination';
import { BAKE_FRAGMENT, BAKE_VERTEX, TERRAIN_FRAGMENT, TERRAIN_VERTEX } from './glsl';
import { buildTileGeometry, selectTiles, toThree } from './tiles';
import { buildRover, type RoverModel } from './rover3d';

export type OverlayMode = 'none' | 'slope' | 'units' | 'hazard' | 'traversability' | 'illumination';
const OVERLAY_ID: Record<OverlayMode, number> = { none: 0, slope: 1, units: 2, hazard: 3, traversability: 4, illumination: 5 };
export type CameraMode = 'orbit' | 'plan' | 'follow' | 'rover' | 'inspect';
export type QualityName = 'high' | 'balanced' | 'performance';
export interface QualityProfile { name: QualityName; sse: number; pixelRatio: number; shadowSteps: number; fineShadow: number; coarseShadow: number; bakesPerSecond: number; antialias: boolean; maxConcurrent: number }
export const QUALITY: Record<QualityName, QualityProfile> = {
  high: { name: 'high', sse: 1.5, pixelRatio: 2, shadowSteps: 112, fineShadow: 1152, coarseShadow: 1024, bakesPerSecond: 10, antialias: true, maxConcurrent: 8 },
  balanced: { name: 'balanced', sse: 3, pixelRatio: 1.5, shadowSteps: 88, fineShadow: 1152, coarseShadow: 768, bakesPerSecond: 4, antialias: true, maxConcurrent: 6 },
  performance: { name: 'performance', sse: 6, pixelRatio: 1, shadowSteps: 56, fineShadow: 576, coarseShadow: 512, bakesPerSecond: 2, antialias: false, maxConcurrent: 4 },
};

/** Conservative default from coarse device hints; the view also downgrades itself if frame time is poor. */
export function detectQuality(gl?: WebGLRenderingContext | WebGL2RenderingContext | null): QualityName {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 4 : 4;
  const memory = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8 : 8;
  let gpu = '';
  try { const ext = gl?.getExtension('WEBGL_debug_renderer_info'); if (gl && ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)); } catch { /* not exposed */ }
  if (/swiftshader|llvmpipe|software/i.test(gpu) || cores <= 2 || memory <= 2) return 'performance';
  if (/apple m\d|rtx|radeon rx|geforce gtx 1[0-9]{3}|nvidia/i.test(gpu) && cores >= 8) return 'high';
  return 'balanced';
}

export interface ViewStats { fps: number; frameMs: number; tiles: number; maxLevel: number; triangles: number; drawCalls: number; cachedTiles: number; cachedMB: number; pending: number; lastBakeMs: number; quality: QualityName; postingM: number; cameraAltM: number }
export interface PickResult { point: MapPoint & { h: number }; objectId: string | null }
export interface RouteDraw { id: string; points: MapPoint[]; color: string; width: number; dashed?: boolean; selected?: boolean }

const UNIT_COLORS = ['#3f7f86', '#7aa36b', '#b8a46a', '#c4734f', '#8a6aa8', '#a14b4b', '#5f6f8f', '#999999'];

export class WorldView {
  readonly renderer: T.WebGLRenderer;
  readonly scene = new T.Scene();
  readonly camera: T.PerspectiveCamera;
  readonly controls: OrbitControls;
  private material: T.ShaderMaterial;
  private tileGroup = new T.Group();
  private meshes = new Map<string, T.Mesh>();
  private inflight = new Map<string, AbortController>();
  private objectsGroup = new T.Group();
  private routeGroup = new T.Group();
  private trackGroup = new T.Group();
  private rocksGroup = new T.Group();
  private sunSprite: T.Sprite; private earthSprite: T.Sprite;
  private sunLight = new T.DirectionalLight(0xffffff, 3);
  // Regolith bounce light: black sky, sunlit-ground colour from below (scaled by the rover's own sun visibility).
  private fill = new T.HemisphereLight(0x000000, 0x9a948a, 0.0);
  private rover: RoverModel | null = null;
  private roverFrame: Frame | null = null;
  private quality: QualityProfile;
  private bake: { scene: T.Scene; camera: T.OrthographicCamera; material: T.ShaderMaterial; fine: T.WebGLRenderTarget; coarse: T.WebGLRenderTarget; fineHeights: T.DataTexture | null; lastSun: T.Vector3; lastBake: number; dirty: boolean };
  private sunEnu: [number, number, number] = [0, 0, 1];
  private earthEnu: [number, number, number] = [0, 1, 0];
  private raf = 0;
  private frameCount = 0; private fpsEma = 60; private lastFrame = performance.now(); private lastLod = 0; private lowFrames = 0;
  private stats: ViewStats;
  private cameraMode: CameraMode = 'orbit';
  private transition: { from: T.Vector3; to: T.Vector3; fromT: T.Vector3; toT: T.Vector3; start: number; dur: number } | null = null;
  private lineMaterials: LineMaterial[] = [];
  private selection: { x: number; y: number; r: number } | null = null;
  private resizeObserver: ResizeObserver;
  private disposed = false;
  onStats?: (s: ViewStats) => void;
  onPick?: (p: PickResult) => void;
  onHover?: (p: (MapPoint & { h: number }) | null) => void;
  objects: SceneObject[] = [];
  illustrative = false;
  autoQuality = true;

  constructor(private container: HTMLElement, readonly world: World, quality?: QualityName) {
    const probe = document.createElement('canvas').getContext('webgl2');
    this.quality = QUALITY[quality ?? detectQuality(probe)];
    this.renderer = new T.WebGLRenderer({ antialias: this.quality.antialias, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio));
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.domElement.className = 'astral-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D terrain of the selected planetary site');
    this.renderer.domElement.tabIndex = 0;
    container.appendChild(this.renderer.domElement);
    this.camera = new T.PerspectiveCamera(42, 1, 0.3, 90000);
    this.scene.background = new T.Color(0x000000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495; this.controls.minDistance = 3; this.controls.maxDistance = 40000;
    this.controls.screenSpacePanning = false;
    this.controls.keys = { LEFT: 'ArrowLeft', UP: 'ArrowUp', RIGHT: 'ArrowRight', BOTTOM: 'ArrowDown' };
    this.controls.listenToKeyEvents(this.renderer.domElement);
    this.stats = { fps: 0, frameMs: 0, tiles: 0, maxLevel: 0, triangles: 0, drawCalls: 0, cachedTiles: 0, cachedMB: 0, pending: 0, lastBakeMs: 0, quality: this.quality.name, postingM: 0, cameraAltM: 0 };

    const gl = this.renderer.getContext();
    const floatLinear = !!gl.getExtension('OES_texture_float_linear');
    const hz = world.horizon;
    const hvals = new Float32Array(hz.values.length);
    for (let i = 0; i < hvals.length; i++) hvals[i] = Number.isFinite(hz.values[i]) ? hz.values[i] : -1e9;
    const horizonTex = new T.DataTexture(hvals, hz.width, hz.height, T.RedFormat, T.FloatType);
    horizonTex.minFilter = horizonTex.magFilter = floatLinear ? T.LinearFilter : T.NearestFilter; horizonTex.needsUpdate = true;
    const u = world.units;
    const unitsTex = new T.DataTexture(u.values, u.width, u.height, T.RedFormat, T.UnsignedByteType);
    unitsTex.minFilter = unitsTex.magFilter = T.NearestFilter; unitsTex.needsUpdate = true;
    const travTex = new T.DataTexture(new Uint8Array(4), 1, 1, T.RGBAFormat); travTex.needsUpdate = true;
    const [w, s, e, n] = world.operationalBox, half = world.half;
    const target = (size: number) => new T.WebGLRenderTarget(size, size, { minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: false, type: T.UnsignedByteType });
    const shared = { uRadius: { value: world.radius }, uHorizon: { value: horizonTex }, uHorizonGeo: { value: new T.Vector4(hz.west, hz.north, hz.cell, hz.width) }, uSunEnu: { value: new T.Vector3(0, 0, 1) }, uShadowSteps: { value: this.quality.shadowSteps } };
    this.bake = {
      scene: new T.Scene(), camera: new T.OrthographicCamera(-1, 1, 1, -1, 0, 1),
      material: new T.ShaderMaterial({ vertexShader: BAKE_VERTEX, fragmentShader: BAKE_FRAGMENT, uniforms: { ...shared, uHeights: { value: null }, uTargetGeo: { value: new T.Vector4() } }, depthTest: false, depthWrite: false }),
      fine: target(this.quality.fineShadow), coarse: target(this.quality.coarseShadow), fineHeights: null, lastSun: new T.Vector3(), lastBake: 0, dirty: true,
    };
    this.bake.scene.add(new T.Mesh(new T.PlaneGeometry(2, 2), this.bake.material));
    this.material = new T.ShaderMaterial({
      vertexShader: TERRAIN_VERTEX, fragmentShader: TERRAIN_FRAGMENT,
      uniforms: {
        uRadius: shared.uRadius, uSun: { value: new T.Vector3(0, 1, 0) }, uFluxScale: { value: 1 }, uExposure: { value: 4.2 }, uAlbedo: { value: 0.2 }, uAmbient: { value: 0.02 },
        uShadowFine: { value: this.bake.fine.texture }, uShadowFineGeo: { value: new T.Vector4(w, n, e - w, 0) },
        uShadowCoarse: { value: this.bake.coarse.texture }, uShadowCoarseGeo: { value: new T.Vector4(-half, half, 2 * half, 1) },
        uOverlay: { value: 0 }, uOverlayOpacity: { value: 0.6 }, uUnits: { value: unitsTex }, uUnitsGeo: { value: new T.Vector4(u.west, u.north, u.cell * u.width, 0) },
        uUnitColors: { value: UNIT_COLORS.map(c => new T.Color(c)) },
        uTrav: { value: travTex }, uTravGeo: { value: new T.Vector4(w, n, e - w, 0) }, uSlopeLimit: { value: 15 }, uContour: { value: 0 },
        uOpBox: { value: new T.Vector4(w, s, e, n) }, uShowBox: { value: 1 }, uSelection: { value: new T.Vector3(0, 0, 0) }, uIllustrative: { value: 0 },
      },
    });
    this.scene.add(this.tileGroup, this.objectsGroup, this.routeGroup, this.trackGroup, this.rocksGroup, this.sunLight, this.sunLight.target, this.fill);
    this.sunSprite = new T.Sprite(new T.SpriteMaterial({ map: discTexture('#fffaf0', true), depthWrite: false, toneMapped: false }));
    this.earthSprite = new T.Sprite(new T.SpriteMaterial({ map: discTexture('#8fb4e8', false), depthWrite: false, toneMapped: false }));
    this.scene.add(this.sunSprite, this.earthSprite);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.installPointer();
    this.flyTo({ x: (w + e) / 2, y: (s + n) / 2 }, { distance: 9000, pitchDeg: 38, headingDeg: 200, duration: 0 });
    this.setTime(0);
    this.loop();
  }

  get qualityName() { return this.quality.name; }
  setQuality(name: QualityName) {
    this.quality = QUALITY[name];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio));
    this.bake.material.uniforms.uShadowSteps.value = this.quality.shadowSteps;
    this.bake.fine.setSize(this.quality.fineShadow, this.quality.fineShadow);
    this.bake.coarse.setSize(this.quality.coarseShadow, this.quality.coarseShadow);
    this.bake.dirty = true; this.stats.quality = name; this.resize();
  }

  /** Upload 5 m origin heights for the fine shadow bake once the operational analysis tiles are loaded. */
  enableFineShadows() {
    const [w, , e, n] = this.world.operationalBox, size = 1152, cell = (e - w) / size;
    const data = new Float32Array(size * size);
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) data[r * size + c] = this.world.heightAt(w + (c + 0.5) * cell, n - (r + 0.5) * cell) ?? -1e9;
    const tex = new T.DataTexture(data, size, size, T.RedFormat, T.FloatType);
    tex.flipY = false; tex.minFilter = tex.magFilter = T.NearestFilter; tex.needsUpdate = true;
    this.bake.fineHeights?.dispose(); this.bake.fineHeights = tex;
    this.material.uniforms.uShadowFineGeo.value.w = 1; this.bake.dirty = true;
  }

  setTime(t: number) {
    const b = bodiesAt(this.world.illumination, t);
    this.sunEnu = b.sun; this.earthEnu = b.earth;
    const sun = new T.Vector3(...toThree(...b.sun)).normalize();
    this.material.uniforms.uSun.value.copy(sun);
    this.material.uniforms.uFluxScale.value = b.fluxWm2 / 1361;
    this.bake.material.uniforms.uSunEnu.value.set(...b.sun);
    if (this.bake.lastSun.angleTo(sun) > 0.0008) this.bake.dirty = true;
    this.updateRoverLight();
    return b;
  }

  setOverlay(mode: OverlayMode, opts: { slopeLimit?: number; opacity?: number } = {}) {
    this.material.uniforms.uOverlay.value = OVERLAY_ID[mode];
    if (opts.slopeLimit !== undefined) this.material.uniforms.uSlopeLimit.value = opts.slopeLimit;
    if (opts.opacity !== undefined) this.material.uniforms.uOverlayOpacity.value = opts.opacity;
  }
  setContours(intervalM: number) { this.material.uniforms.uContour.value = intervalM; }
  setExposure(v: number) { this.material.uniforms.uExposure.value = v; }
  setShowBox(v: boolean) { this.material.uniforms.uShowBox.value = v ? 1 : 0; }
  setIllustrative(on: boolean, rockAbundance = 0.02) {
    this.illustrative = on; this.material.uniforms.uIllustrative.value = on ? 1 : 0;
    this.rebuildRocks(on ? rockAbundance : 0);
  }
  /** RGBA traversability texture (row 0 = north) covering the operational box. */
  setTraversability(rgba: Uint8Array, width: number, height: number, geo?: { west: number; north: number; size: number }) {
    if (geo) this.material.uniforms.uTravGeo.value.set(geo.west, geo.north, geo.size, 0);
    const tex = new T.DataTexture(rgba, width, height, T.RGBAFormat);
    tex.minFilter = T.LinearFilter; tex.magFilter = T.NearestFilter; tex.flipY = false; tex.needsUpdate = true;
    const old = this.material.uniforms.uTrav.value as T.Texture; old.dispose();
    this.material.uniforms.uTrav.value = tex;
  }
  setSelection(sel: { x: number; y: number; r: number } | null) {
    this.selection = sel;
    this.material.uniforms.uSelection.value.set(sel?.x ?? 0, sel?.y ?? 0, sel?.r ?? 0);
  }

  /** Surface height for draping: analysis model where loaded, else the horizon grid. */
  surface(x: number, y: number) {
    const h = this.world.heightAt(x, y);
    return h ?? (Number.isFinite(this.world.horizonHeight(x, y)) ? this.world.horizonHeight(x, y) : 0);
  }
  toScene(x: number, y: number, h: number) { const p = aeqdToEnu(x, y, h, this.world.radius); return new T.Vector3(...toThree(p.e, p.n, p.u)); }
  fromScene(v: T.Vector3) { return enuToAeqd(v.x, -v.z, v.y, this.world.radius); }
  project(x: number, y: number, h: number) {
    const v = this.toScene(x, y, h).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { sx: (v.x + 1) / 2 * r.width, sy: (1 - v.y) / 2 * r.height, visible: v.z < 1 && Math.abs(v.x) <= 1.1 && Math.abs(v.y) <= 1.1 };
  }

  setObjects(objects: SceneObject[], filter: (o: SceneObject) => boolean = () => true) {
    this.objects = objects;
    this.clearGroup(this.objectsGroup);
    for (const o of objects) {
      if (!filter(o) || o.type === 'reference') continue;
      const color = o.type === 'crater' ? '#e3b65c' : o.type === 'anomaly' ? '#79b8d6' : o.type === 'waypoint' || o.type === 'science-target' ? '#f2efe6' : '#cccccc';
      if (o.radius > 0) {
        const pts: number[] = [];
        for (let k = 0; k <= 72; k++) {
          const a = (k / 72) * Math.PI * 2, x = o.x + o.radius * Math.cos(a), y = o.y + o.radius * Math.sin(a);
          const v = this.toScene(x, y, this.surface(x, y) + 0.8); pts.push(v.x, v.y, v.z);
        }
        this.objectsGroup.add(this.line(pts, color, o.type === 'anomaly' ? 1.4 : 1.8, o.type === 'anomaly', 0.85));
      }
      if (o.type === 'waypoint' || o.type === 'science-target') {
        const h = this.surface(o.x, o.y), base = this.toScene(o.x, o.y, h), top = this.toScene(o.x, o.y, h + 14);
        this.objectsGroup.add(this.line([base.x, base.y, base.z, top.x, top.y, top.z], color, 2, false, 1));
        const head = new T.Mesh(new T.SphereGeometry(1.6, 16, 8), new T.MeshBasicMaterial({ color, toneMapped: false })); head.position.copy(top);
        this.objectsGroup.add(head);
      }
    }
  }

  setRoutes(routes: RouteDraw[]) {
    this.clearGroup(this.routeGroup);
    for (const r of routes) {
      if (r.points.length < 2) continue;
      const pts: number[] = [];
      for (let i = 0; i < r.points.length - 1; i++) {
        const a = r.points[i], b = r.points[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y), m = Math.max(1, Math.ceil(len / 8));
        for (let k = 0; k < m; k++) { const x = a.x + (b.x - a.x) * k / m, y = a.y + (b.y - a.y) * k / m; const v = this.toScene(x, y, this.surface(x, y) + 1.2); pts.push(v.x, v.y, v.z); }
      }
      const last = r.points[r.points.length - 1], v = this.toScene(last.x, last.y, this.surface(last.x, last.y) + 1.2); pts.push(v.x, v.y, v.z);
      this.routeGroup.add(this.line(pts, r.color, r.width, !!r.dashed, r.selected ? 1 : 0.7));
    }
  }

  /** Wheel tracks coloured by recorded slip (green→amber→red). */
  setTracks(frames: Frame[] | null, upTo = Infinity) {
    this.clearGroup(this.trackGroup);
    if (!frames || !this.rover) return;
    const drive = frames.filter(f => f.phase === 'drive' && f.t <= upTo);
    if (drive.length < 2) return;
    const off = this.rover.profile.trackWidthM / 2;
    for (const side of [1, -1]) {
      const pts: number[] = [], cols: number[] = [];
      for (const f of drive) {
        const hd = f.headingDeg * Math.PI / 180, x = f.x - side * off * Math.cos(hd), y = f.y + side * off * Math.sin(hd);
        const v = this.toScene(x, y, this.surface(x, y) + 0.06); pts.push(v.x, v.y, v.z);
        const c = slipColor(f.slip); cols.push(c.r, c.g, c.b);
      }
      const geo = new LineGeometry(); geo.setPositions(pts); geo.setColors(cols);
      const mat = new LineMaterial({ linewidth: 2.2, vertexColors: true, transparent: true, opacity: 0.9, worldUnits: false });
      mat.resolution.set(this.renderer.domElement.width, this.renderer.domElement.height); this.lineMaterials.push(mat);
      this.trackGroup.add(new Line2(geo, mat));
    }
  }

  setRover(profile: RoverProfile | null) {
    if (this.rover) { this.scene.remove(this.rover.root); this.rover.dispose(); this.rover = null; }
    if (profile) { this.rover = buildRover(profile); this.rover.root.visible = false; this.scene.add(this.rover.root); }
  }
  /** Place the rover from a recorded/interpolated simulation frame. */
  setRoverFrame(f: Frame | null) {
    this.roverFrame = f;
    if (!this.rover) return;
    this.rover.root.visible = !!f;
    if (!f) return;
    const base = this.toScene(f.x, f.y, f.h);
    this.rover.root.position.copy(base);
    const H = f.headingDeg * Math.PI / 180;
    this.rover.root.rotation.set(f.rollDeg * Math.PI / 180, Math.PI / 2 - H, f.pitchDeg * Math.PI / 180, 'YZX');
    const angle = -f.s / this.rover.profile.wheelRadiusM;
    for (const w of this.rover.wheels) w.rotation.z = angle;
    this.updateRoverLight();
  }
  private updateRoverLight() {
    const sun = new T.Vector3(...toThree(...this.sunEnu)).normalize();
    let frac = this.sunEnu[2] > -0.02 ? 1 : 0;
    if (this.roverFrame) frac = sunVisibleFraction(this.world, this.roverFrame.x, this.roverFrame.y, this.roverFrame.h + 1, this.sunEnu);
    const anchor = this.rover?.root.position ?? this.controls.target;
    this.sunLight.position.copy(anchor).addScaledVector(sun, 100);
    this.sunLight.target.position.copy(anchor);
    this.sunLight.intensity = 3.2 * frac;
    this.fill.intensity = 0.25 + 1.1 * frac * Math.max(0, Math.min(1, this.sunEnu[2] * 6 + 0.3));
  }

  flyTo(p: MapPoint, o: { distance?: number; pitchDeg?: number; headingDeg?: number; duration?: number } = {}) {
    const h = this.surface(p.x, p.y);
    const target = this.toScene(p.x, p.y, h);
    const dist = o.distance ?? Math.max(60, this.camera.position.distanceTo(this.controls.target) * 0.5);
    const pitch = (o.pitchDeg ?? 35) * Math.PI / 180, heading = (o.headingDeg ?? 200) * Math.PI / 180;
    const offset = new T.Vector3(Math.sin(heading) * Math.cos(pitch), Math.sin(pitch), -Math.cos(heading) * Math.cos(pitch)).multiplyScalar(-dist);
    offset.y = Math.abs(offset.y);
    this.animateCamera(target.clone().add(offset), target, o.duration ?? 1.4);
  }
  private animateCamera(pos: T.Vector3, target: T.Vector3, duration: number) {
    if (duration <= 0) { this.camera.position.copy(pos); this.controls.target.copy(target); this.controls.update(); this.transition = null; return; }
    const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.transition = { from: this.camera.position.clone(), to: pos, fromT: this.controls.target.clone(), toT: target, start: performance.now(), dur: (reduced ? 0.01 : duration) * 1000 };
  }
  setCameraMode(mode: CameraMode) {
    this.cameraMode = mode;
    this.controls.enableRotate = mode !== 'plan';
    if (mode === 'plan') {
      const t = this.controls.target.clone(), m = this.fromScene(t);
      const up = this.toScene(m.x, m.y, m.h + Math.max(800, this.camera.position.distanceTo(t)));
      this.animateCamera(up.add(new T.Vector3(0, 0, 0.01)), t, 1.2);
    }
    if (mode === 'inspect' && this.selection) this.flyTo(this.selection, { distance: Math.max(80, this.selection.r * 3.2), pitchDeg: 42 });
  }
  get mode() { return this.cameraMode; }

  private installPointer() {
    const el = this.renderer.domElement;
    let down: { x: number; y: number } | null = null, hoverAt = 0;
    const ray = new T.Raycaster();
    const hit = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ray.setFromCamera(new T.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), this.camera);
      const hits = ray.intersectObjects(this.tileGroup.children.filter(c => c.visible), false);
      if (!hits.length) return null;
      const m = this.fromScene(hits[0].point);
      const h = this.world.heightAt(m.x, m.y) ?? m.h;
      return { x: m.x, y: m.y, h };
    };
    el.addEventListener('pointerdown', ev => { down = { x: ev.clientX, y: ev.clientY }; });
    el.addEventListener('pointerup', ev => {
      if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 5) { down = null; return; }
      down = null;
      const p = hit(ev);
      if (!p) return;
      this.onPick?.({ point: p, objectId: this.objectAt(p) });
    });
    el.addEventListener('pointermove', ev => {
      const now = performance.now();
      if (now - hoverAt < 90 || !this.onHover) return;
      hoverAt = now; this.onHover(hit(ev));
    });
    el.addEventListener('pointerleave', () => this.onHover?.(null));
  }
  objectAt(p: MapPoint): string | null {
    let best: SceneObject | null = null;
    for (const o of this.objects) {
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      const reach = o.type === 'waypoint' || o.type === 'science-target' ? 25 : o.radius * 1.15;
      if (d <= reach && (!best || o.radius < best.radius)) best = o;
    }
    return best?.id ?? null;
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%'; this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    for (const m of this.lineMaterials) m.resolution.set(this.renderer.domElement.width, this.renderer.domElement.height);
  }

  private updateLod() {
    const frustum = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    const box = new T.Box3();
    const focus = this.roverFrame && (this.cameraMode === 'follow' || this.cameraMode === 'rover') ? { x: this.roverFrame.x, y: this.roverFrame.y, radius: 300 } : null;
    const sel = selectTiles(this.world, {
      position: [this.camera.position.x, this.camera.position.y, this.camera.position.z], fovYRad: this.camera.fov * Math.PI / 180,
      viewportHeightPx: this.renderer.domElement.height,
      visible: (min, max) => frustum.intersectsBox(box.set(new T.Vector3(...min), new T.Vector3(...max))), focus,
    }, this.quality.sse, k => !!this.world.loadedTile(k));
    const want = new Set(sel.render.map(d => d.key));
    for (const d of sel.render) {
      let mesh = this.meshes.get(d.key);
      if (!mesh) {
        const tile = this.world.loadedTile(d.key)!;
        const data = buildTileGeometry(this.world, tile, Math.max(3, d.geometricErrorMax * 2 + d.posting * 0.5));
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.BufferAttribute(data.positions, 3));
        g.setAttribute('normal', new T.BufferAttribute(data.normals, 3));
        g.setAttribute('aMap', new T.BufferAttribute(data.map, 3));
        g.setIndex(new T.BufferAttribute(data.index, 1));
        g.computeBoundingSphere(); g.computeBoundingBox();
        mesh = new T.Mesh(g, this.material); mesh.name = `tile:${d.key}`; mesh.userData.used = 0; mesh.matrixAutoUpdate = false;
        this.meshes.set(d.key, mesh); this.tileGroup.add(mesh);
      }
      mesh.visible = true; mesh.userData.used = this.frameCount;
    }
    for (const [key, mesh] of this.meshes) {
      if (want.has(key)) continue;
      mesh.visible = false;
      if (this.frameCount - (mesh.userData.used as number) > 600 && this.meshes.size > 160) { this.tileGroup.remove(mesh); mesh.geometry.dispose(); this.meshes.delete(key); }
    }
    // Stream requested tiles (nearest-first order is the quadtree order); cancel stale requests.
    const requested = new Set(sel.request.map(d => d.key));
    for (const [key, ctl] of this.inflight) if (!requested.has(key)) { ctl.abort(); this.inflight.delete(key); }
    for (const d of sel.request) {
      if (this.inflight.size >= this.quality.maxConcurrent) break;
      if (this.inflight.has(d.key)) continue;
      const ctl = new AbortController(); this.inflight.set(d.key, ctl);
      this.world.tile(d.key, ctl.signal).catch(() => undefined).finally(() => this.inflight.delete(d.key));
    }
    this.stats.tiles = sel.render.length; this.stats.maxLevel = sel.maxLevel; this.stats.pending = sel.request.length;
    const m = this.fromScene(this.controls.target);
    this.stats.postingM = this.world.manifest.pyramid.postingsM[sel.maxLevel];
    this.stats.cameraAltM = this.camera.position.distanceTo(this.controls.target);
    void m;
  }

  private bakeShadows(now: number) {
    const b = this.bake;
    if (!b.dirty || now - b.lastBake < 1000 / this.quality.bakesPerSecond) return;
    const t0 = performance.now();
    const [w, , e, n] = this.world.operationalBox, half = this.world.half;
    const prev = this.renderer.getRenderTarget();
    b.material.uniforms.uTargetGeo.value.set(-half, half, 2 * half, 1);
    this.renderer.setRenderTarget(b.coarse); this.renderer.render(b.scene, b.camera);
    if (b.fineHeights) {
      b.material.uniforms.uHeights.value = b.fineHeights;
      b.material.uniforms.uTargetGeo.value.set(w, n, e - w, 0);
      this.renderer.setRenderTarget(b.fine); this.renderer.render(b.scene, b.camera);
    }
    this.renderer.setRenderTarget(prev);
    b.lastSun.copy(this.material.uniforms.uSun.value); b.dirty = false; b.lastBake = now;
    this.stats.lastBakeMs = performance.now() - t0;
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now(), dt = now - this.lastFrame; this.lastFrame = now; this.frameCount++;
    this.fpsEma = this.fpsEma * 0.95 + (1000 / Math.max(1, dt)) * 0.05;
    if (this.transition) {
      const k = Math.min(1, (now - this.transition.start) / this.transition.dur), e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
      this.camera.position.lerpVectors(this.transition.from, this.transition.to, e);
      this.controls.target.lerpVectors(this.transition.fromT, this.transition.toT, e);
      if (k >= 1) this.transition = null;
    }
    this.followRover();
    this.controls.update();
    this.camera.near = Math.max(0.2, Math.min(50, this.camera.position.distanceTo(this.controls.target) / 400));
    this.camera.updateProjectionMatrix();
    if (now - this.lastLod > 120) { this.updateLod(); this.lastLod = now; }
    this.bakeShadows(now);
    const sunDir = new T.Vector3(...toThree(...this.sunEnu)).normalize(), earthDir = new T.Vector3(...toThree(...this.earthEnu)).normalize();
    const far = 60000;
    this.sunSprite.position.copy(this.camera.position).addScaledVector(sunDir, far); this.sunSprite.scale.setScalar(far * 0.0093 * 3.2);
    this.earthSprite.position.copy(this.camera.position).addScaledVector(earthDir, far); this.earthSprite.scale.setScalar(far * 0.0332);
    this.renderer.render(this.scene, this.camera);
    if (this.frameCount % 30 === 0) {
      const info = this.renderer.info;
      Object.assign(this.stats, { fps: this.fpsEma, frameMs: 1000 / this.fpsEma, triangles: info.render.triangles, drawCalls: info.render.calls, cachedTiles: this.world.cachedTileCount, cachedMB: this.world.cachedBytes / 1e6, quality: this.quality.name });
      this.onStats?.({ ...this.stats });
      if (this.autoQuality && this.frameCount > 240) {
        this.lowFrames = this.fpsEma < 22 ? this.lowFrames + 1 : 0;
        if (this.lowFrames >= 4 && this.quality.name !== 'performance') { this.setQuality(this.quality.name === 'high' ? 'balanced' : 'performance'); this.lowFrames = 0; }
      }
    }
  };

  private followRover() {
    if (!this.roverFrame || (this.cameraMode !== 'follow' && this.cameraMode !== 'rover') || this.transition) return;
    const f = this.roverFrame, H = f.headingDeg * Math.PI / 180, profile = this.rover?.profile;
    const fwd = new T.Vector3(Math.sin(H), 0, -Math.cos(H));
    const base = this.toScene(f.x, f.y, f.h);
    if (this.cameraMode === 'rover') {
      const eye = base.clone().add(new T.Vector3(0, (profile?.mastHeightM ?? 2) + 0.1, 0)).addScaledVector(fwd, (profile?.wheelbaseM ?? 1.5) * 0.35);
      this.camera.position.copy(eye); this.controls.target.copy(eye.clone().addScaledVector(fwd, 30).add(new T.Vector3(0, -3, 0)));
    } else {
      const desired = base.clone().addScaledVector(fwd, -14).add(new T.Vector3(0, 6, 0));
      this.camera.position.lerp(desired, 0.08); this.controls.target.lerp(base.clone().add(new T.Vector3(0, 1, 0)), 0.2);
    }
  }

  private rebuildRocks(k: number) {
    this.clearGroup(this.rocksGroup);
    if (!k) return;
    const [w, s, e] = this.world.operationalBox;
    const target = this.fromScene(this.controls.target);
    const size = 600, area = { west: Math.max(w, target.x - size / 2), south: Math.max(s, target.y - size / 2), size: Math.min(size, e - w) };
    const rocks = illustrativeRocks(k, 2026, area, 0.3, 6000);
    const geo = new T.IcosahedronGeometry(0.5, 1);
    const pos = geo.attributes.position as T.BufferAttribute;
    for (let i = 0; i < pos.count; i++) { const v = new T.Vector3().fromBufferAttribute(pos, i); v.multiplyScalar(0.8 + 0.35 * Math.abs(Math.sin(v.x * 7.1 + v.y * 3.3 + v.z * 5.7))); pos.setXYZ(i, v.x, v.y * 0.62, v.z); }
    geo.computeVertexNormals();
    const mesh = new T.InstancedMesh(geo, new T.MeshStandardMaterial({ color: '#8d8a84', roughness: 0.95 }), rocks.length);
    const m = new T.Matrix4(), q = new T.Quaternion();
    rocks.forEach((r, i) => {
      const h = this.surface(r.x, r.y), p = this.toScene(r.x, r.y, h + r.d * 0.12);
      q.setFromEuler(new T.Euler(0, r.yaw, 0)); m.compose(p, q, new T.Vector3(r.d, r.d, r.d)); mesh.setMatrixAt(i, m);
    });
    mesh.name = 'illustrative-rocks'; this.rocksGroup.add(mesh);
  }

  private line(pts: number[], color: string, width: number, dashed: boolean, opacity: number) {
    const geo = new LineGeometry(); geo.setPositions(pts);
    const mat = new LineMaterial({ color: new T.Color(color).getHex(), linewidth: width, dashed, dashSize: 12, gapSize: 8, transparent: opacity < 1, opacity, worldUnits: false });
    mat.resolution.set(this.renderer.domElement.width, this.renderer.domElement.height);
    this.lineMaterials.push(mat);
    const l = new Line2(geo, mat); if (dashed) l.computeLineDistances();
    return l;
  }
  private clearGroup(g: T.Group) {
    for (const c of [...g.children]) {
      g.remove(c);
      c.traverse(o => { const m = o as T.Mesh; if (m.geometry) m.geometry.dispose(); const mat = m.material as T.Material | undefined; if (mat) { mat.dispose(); this.lineMaterials = this.lineMaterials.filter(x => x !== mat); } });
    }
  }

  captureMetrics() { return { ...this.stats }; }

  dispose() {
    this.disposed = true; cancelAnimationFrame(this.raf); this.resizeObserver.disconnect();
    for (const c of this.inflight.values()) c.abort();
    this.controls.dispose();
    for (const m of this.meshes.values()) m.geometry.dispose();
    this.setRover(null);
    [this.objectsGroup, this.routeGroup, this.trackGroup, this.rocksGroup].forEach(g => this.clearGroup(g));
    this.bake.fine.dispose(); this.bake.coarse.dispose(); this.bake.fineHeights?.dispose(); this.material.dispose(); this.bake.material.dispose();
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}

function slipColor(s: number) {
  const c = new T.Color();
  if (s < 0.2) return c.setRGB(0.35 + s * 2, 0.75, 0.55);
  if (s < 0.5) return c.setRGB(0.85, 0.75 - (s - 0.2) * 1.2, 0.35);
  return c.setRGB(0.9, 0.25, 0.2);
}

function discTexture(color: string, glow: boolean) {
  const size = 128, c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    if (glow) { grad.addColorStop(0, color); grad.addColorStop(0.31, color); grad.addColorStop(0.36, 'rgba(255,240,210,0.35)'); grad.addColorStop(1, 'rgba(255,240,210,0)'); }
    else { grad.addColorStop(0, color); grad.addColorStop(0.92, color); grad.addColorStop(1, 'rgba(0,0,0,0)'); }
    g.fillStyle = grad; g.fillRect(0, 0, size, size);
  }
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
}
