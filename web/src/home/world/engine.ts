// The landing world engine: one measured ground, four worlds, a camera directed by scroll.
// AI-assisted implementation; human review pending.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { TERRAIN_VERT, TERRAIN_FRAG, SKY_VERT, SKY_FRAG, POST_FRAG, ROCK_VERT, ROCK_FRAG, BAKE_VERT, BAKE_FRAG } from './shaders';
import { makeRockGeometry } from './rocks';
import { sampleGrid, type StageData } from './terrainData';

export type Vec3 = [number, number, number];
export type Weights = [number, number, number, number]; // moon, mars, earth(moon analogue), earth(mars analogue)

/** One directed shot. Every chapter of the page is one of these; scroll blends between them. */
export interface Shot {
  cam: Vec3; look: Vec3; fov: number; w: Weights;
  sunAz: number; sunEl: number; exposure: number;
  drift?: Vec3;          // camera travel across the chapter
  contours?: number; survey?: number; fidelity?: number; gaps?: number; space?: number;
  probe?: boolean; sunDrag?: boolean; alt?: number; launch?: boolean;
  agl?: boolean;                    // cam[1] and look[1] are heights above the ground
  earth?: [number, number];        // Earth in the lunar sky: degrees right of the view axis, degrees above the horizon
  veil?: [number, number, number]; // graduated darkening behind the chapter's text: left, right, overall
}

export interface LaunchState { destination: 'moon' | 'mars'; mode: 'rover' | 'launch' | 'descent' | 'eva'; params: Record<string, number> }
export interface LabelSpec { el: HTMLElement; at: () => Vec3 | null; from: number; to: number }
export interface ProbeReadout { active: boolean; x: number; y: number; from: string; to: string; dh: number; slopeA: number; slopeB: number; radius: number }

const WORLD_RADIUS = [1737400, 3389500, 6371000, 6371000];
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (t: number) => { t = clamp(t); return t * t * t * (t * (t * 6 - 15) + 10); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mixV = (a: Vec3, b: Vec3, t: number): Vec3 => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const mixW = (a: Weights, b: Weights, t: number): Weights => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t), mix(a[3], b[3], t)];
const angMix = (a: number, b: number, t: number) => { let d = ((b - a + 540) % 360) - 180; return a + d * t; };

function toHalf(data: Float32Array) { const out = new Uint16Array(data.length); for (let i = 0; i < data.length; i++) out[i] = THREE.DataUtils.toHalfFloat(data[i]); return out; }

export class WorldEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 5, 400000);
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private post: ShaderPass;
  private terrain: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private sky: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private rocks: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private bakes: THREE.WebGLRenderTarget[] = [];
  private uT: Record<string, THREE.IUniform>;
  private uS: Record<string, THREE.IUniform>;
  private raf = 0; private last = performance.now(); private t0 = performance.now();
  private chapter = 0; private chapterTarget = 0;
  private pointer = { x: 0, y: 0, sx: 0, sy: 0, inside: false, down: false, downAt: 0 };
  private probe = { x: 0, z: 0, r: 0, target: 0, hit: false, wx: 0, wz: 0 };
  private launch: LaunchState | null = null;
  private gapFocus = -1; private gapOpen = [0, 0, 0, 0, 0, 0];
  private sunDrag = 0;
  private scale = 1; private frameAvg = 16; private quality: number;
  private labels: LabelSpec[] = [];
  private shots: Shot[];
  private reduced: boolean;
  private stage: StageData | null;
  private w: Weights = [1, 0, 0, 0];
  private spaceMix = 0;
  onProbe: ((p: ProbeReadout) => void) | null = null;
  onFrame: ((chapter: number) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement, stage: StageData | null, shots: Shot[], opts: { reduced: boolean }) {
    this.stage = stage; this.shots = shots; this.reduced = opts.reduced;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.quality = Math.min(window.devicePixelRatio || 1, 1.5);
    // phones and small tablets: same picture from a lighter setup (smaller bake, coarser grid, fewer boulders)
    const compact = Math.min(window.innerWidth, window.innerHeight) < 600 || window.matchMedia?.('(pointer: coarse)').matches;

    // ---------- Measured textures ----------
    const side = stage?.side ?? 2;
    const regional = new Float32Array(side * side * 4);
    if (stage) for (let i = 0; i < side * side; i++) for (let k = 0; k < 4; k++) regional[i * 4 + k] = stage.grids[k][i];
    const regTex = new THREE.DataTexture(toHalf(regional), side, side, THREE.RGBAFormat, THREE.HalfFloatType);
    const hiTex = (hi: StageData['hiMoon'], center: number) => {
      if (!hi) { const t = new THREE.DataTexture(new Uint16Array(1), 1, 1, THREE.RedFormat, THREE.HalfFloatType); t.needsUpdate = true; return t; }
      const rel = new Float32Array(hi.data.length); for (let i = 0; i < rel.length; i++) rel[i] = hi.data[i] - hi.offset - center;
      const t = new THREE.DataTexture(toHalf(rel), hi.side, hi.side, THREE.RedFormat, THREE.HalfFloatType); return t;
    };
    const hiMoon = hiTex(stage?.hiMoon ?? null, 0), hiMars = hiTex(stage?.hiMars ?? null, 0);
    if (stage?.hiMoon) { // inserts are absolute: remove each world's centre too
      const rel = new Float32Array(stage.hiMoon.data.length); for (let i = 0; i < rel.length; i++) rel[i] = stage.hiMoon.data[i] - stage.hiMoon.offset - stage.worlds.moon.center;
      hiMoon.image.data = toHalf(rel);
    }
    if (stage?.hiMars) {
      const rel = new Float32Array(stage.hiMars.data.length); for (let i = 0; i < rel.length; i++) rel[i] = stage.hiMars.data[i] - stage.hiMars.offset - stage.worlds.mars.center;
      hiMars.image.data = toHalf(rel);
    }
    for (const t of [regTex, hiMoon, hiMars]) { t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; }
    const albedo = stage?.marsAlbedo ? new THREE.CanvasTexture(stage.marsAlbedo) : new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    albedo.needsUpdate = true; albedo.wrapS = albedo.wrapT = THREE.ClampToEdgeWrapping;
    const loader = new THREE.TextureLoader();
    const base = import.meta.env.BASE_URL;
    const earthTex = loader.load(`${base}textures/earth.jpg`); const moonTex = loader.load(`${base}textures/moon.jpg`);
    for (const t of [earthTex, moonTex]) { t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4; }
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    const detail = (name: string) => {
      const t = loader.load(`${base}textures/terrain/${name}.webp`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = aniso;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
      return t;
    };
    const texRegolith = detail('regolith'), texRock = detail('rock'), texSand = detail('sand');

    // ---------- Terrain ----------
    this.uT = {
      uRegional: { value: regTex }, uHiMoon: { value: hiMoon }, uHiMars: { value: hiMars }, uMarsAlbedo: { value: albedo },
      uHiSize: { value: new THREE.Vector2(stage?.hiMoon?.size ?? 0, stage?.hiMars?.size ?? 0) },
      uHalf: { value: stage?.half ?? 9900 }, uSide: { value: side },
      uW: { value: new THREE.Vector4(1, 0, 0, 0) }, uPW: { value: new THREE.Vector4(0, 0, 1, 0) },
      uProbe: { value: new THREE.Vector4(0, 0, 0, 120) }, uProbeOff: { value: 0 }, uCam: { value: new THREE.Vector3() },
      uTime: { value: 0 }, uRadius: { value: WORLD_RADIUS[0] }, uExtent: { value: 60000 }, uGridCenter: { value: new THREE.Vector2() },
      uDetailNear: { value: null }, uDetailFar: { value: null }, uNearRect: { value: new THREE.Vector3(0, 0, 22000) }, uFarRect: { value: new THREE.Vector3(0, 0, 120000) },
      uTexRegolith: { value: texRegolith }, uTexRock: { value: texRock }, uTexSand: { value: texSand },
      uSunDir: { value: new THREE.Vector3(0, .1, -1).normalize() }, uSunCol: { value: new THREE.Vector3(3, 3, 3) },
      uAtmo: { value: new THREE.Vector4(0, 0, 1, 0) },
      uContours: { value: 0 }, uSurvey: { value: 0 }, uFidelity: { value: 0 }, uScan: { value: -1 },
      uGapOpen0: { value: new THREE.Vector4() }, uGapOpen1: { value: new THREE.Vector2() }, uGapFocus: { value: -1 },
      uSlopeLimit: { value: 0 }, uRange: { value: new THREE.Vector3() }, uMarker: { value: new THREE.Vector4() },
      uReticle: { value: new THREE.Vector3() }, uReveal: { value: this.reduced ? 1 : 0 },
    };
    // ---------- Bake procedural relief once (per world, one channel each) ----------
    const bake = (size: number, res: number, fine: number) => {
      const rt = new THREE.WebGLRenderTarget(res, res, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
      const m = new THREE.ShaderMaterial({ vertexShader: BAKE_VERT, fragmentShader: BAKE_FRAG, uniforms: { ...this.uT, uRect: { value: new THREE.Vector3(0, 0, size) }, uFine: { value: fine } } });
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m); const sc = new THREE.Scene(); sc.add(quad);
      this.renderer.setRenderTarget(rt); this.renderer.render(sc, new THREE.Camera()); this.renderer.setRenderTarget(null);
      m.dispose(); quad.geometry.dispose();
      this.bakes.push(rt);
      return rt.texture;
    };
    this.uT.uDetailNear.value = bake(22000, compact ? 2048 : 4096, 1);
    this.uT.uDetailFar.value = bake(120000, 2048, 0);

    const segs = compact ? 640 : 1024;
    const geo = new THREE.PlaneGeometry(2, 2, segs, segs);
    const mat = new THREE.ShaderMaterial({ vertexShader: TERRAIN_VERT, fragmentShader: TERRAIN_FRAG, uniforms: this.uT });
    mat.extensions = { ...(mat.extensions ?? {}), derivatives: true } as THREE.ShaderMaterial['extensions'];
    this.terrain = new THREE.Mesh(geo, mat); this.terrain.frustumCulled = false; this.scene.add(this.terrain);

    // ---------- Boulders: instanced in a tile that repeats around the camera ----------
    const rockGeo = makeRockGeometry();
    const ig = new THREE.InstancedBufferGeometry();
    ig.index = rockGeo.index; ig.setAttribute('position', rockGeo.attributes.position); ig.setAttribute('normal', rockGeo.attributes.normal);
    const COUNT = compact ? 7000 : 16000, TILE = 1600; const data = new Float32Array(COUNT * 4);
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < COUNT; i++) {
      const size = Math.min(10, .55 * Math.pow(1 - rnd(), -1 / 1.5));     // power-law clast sizes: many pebbles, few blocks
      data.set([(rnd() - .5) * TILE, (rnd() - .5) * TILE, size, rnd()], i * 4);
    }
    ig.setAttribute('aRock', new THREE.InstancedBufferAttribute(data, 4)); ig.instanceCount = COUNT;
    const rockMat = new THREE.ShaderMaterial({ vertexShader: ROCK_VERT, fragmentShader: ROCK_FRAG, uniforms: { ...this.uT, uTile: { value: TILE }, uRockScale: { value: 1 } } });
    this.rocks = new THREE.Mesh(ig, rockMat); this.rocks.frustumCulled = false; this.scene.add(this.rocks);

    // ---------- Sky ----------
    this.uS = {
      uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
      uSunDir: this.uT.uSunDir, uSunCol: this.uT.uSunCol, uAtmo: this.uT.uAtmo,
      uEarthTex: { value: earthTex }, uMoonTex: { value: moonTex },
      uEarthDir: { value: new THREE.Vector3(.3, .05, -1).normalize() }, uEarthSize: { value: .0167 },
      uTime: this.uT.uTime, uReveal: this.uT.uReveal, uCam: this.uT.uCam,
      uMoonDir: { value: new THREE.Vector3(0, 0, -1) }, uMoonSize: { value: .0105 }, uAlt: { value: 410 },
    };
    const skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.uS, depthWrite: false, depthTest: true });
    this.sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMat); this.sky.frustumCulled = false; this.sky.renderOrder = -1;
    this.scene.add(this.sky);

    // ---------- Post ----------
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .22, .5, 1.6);
    this.composer.addPass(this.bloom);
    this.post = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uExposure: { value: 1 }, uTime: { value: 0 }, uFlash: { value: 0 }, uFlashCol: { value: new THREE.Vector3(.7, .8, 1) }, uRes: { value: new THREE.Vector2(1, 1) }, uVeil: { value: new THREE.Vector3() }, uVeilB: { value: 0 },
        uShadowTint: { value: new THREE.Vector3(1, 1, 1) }, uHighTint: { value: new THREE.Vector3(1, 1, 1) }, uSat: { value: 1 }, uContrast: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: POST_FRAG,
    });
    this.composer.addPass(this.post);
    this.composer.addPass(new SMAAPass());

    this.resize();
    window.addEventListener('resize', this.resize);
    this.loop();
  }

  // ---------- Inputs from the page ----------
  setChapter(c: number) { this.chapterTarget = c; }
  jumpChapter(c: number) { this.chapterTarget = c; this.chapter = c; }
  setPointer(nx: number, ny: number, inside: boolean) { this.pointer.x = nx; this.pointer.y = ny; this.pointer.inside = inside; }
  setPointerDown(down: boolean) { this.pointer.down = down; if (down) this.pointer.downAt = performance.now(); }
  setLaunch(l: LaunchState | null) { this.launch = l; }
  setGapFocus(i: number) { this.gapFocus = i; }
  setLabels(l: LabelSpec[]) { this.labels = l; }
  get weights() { return this.w; }
  /** How much of each kind of air the current shot is in, for the soundscape. */
  get mix() { const k = 1 - this.spaceMix; return { vacuum: this.w[0] * k + this.spaceMix, mars: this.w[1] * k, earth: (this.w[2] + this.w[3]) * k }; }

  /** Height of the visible ground (CPU, regional + inserts, no micro relief). */
  heightAt(x: number, z: number, w: Weights = this.w) {
    const s = this.stage; if (!s) return 0;
    let h = 0;
    for (let k = 0; k < 4; k++) if (w[k] > 0.001) {
      let v = sampleGrid(s.grids[k], s.side, s.half, x, z);
      const hi = k === 0 ? s.hiMoon : k === 1 ? s.hiMars : null;
      if (hi) {
        const hs = hi.size / 2, mx = clamp((hs - Math.abs(x)) / 200), mz = clamp((hs - Math.abs(z)) / 200);
        if (mx * mz > 0) { const center = k === 0 ? s.worlds.moon.center : s.worlds.mars.center; const hv = sampleGrid(hi.data, hi.side, hs, x, z) - hi.offset - center; v = mix(v, hv, mx * mz); }
      }
      h += v * w[k];
    }
    return h;
  }
  slopeAt(x: number, z: number, w: Weights) {
    const e = 60; const dx = this.heightAt(x + e, z, w) - this.heightAt(x - e, z, w), dz = this.heightAt(x, z + e, w) - this.heightAt(x, z - e, w);
    return Math.atan(Math.hypot(dx, dz) / (2 * e)) * 180 / Math.PI;
  }

  private resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    const pr = this.quality * this.scale;
    this.renderer.setPixelRatio(pr); this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr); this.composer.setSize(w, h);
    this.bloom.resolution.set(w * pr * .5, h * pr * .5);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    (this.post.uniforms.uRes.value as THREE.Vector2).set(w * pr, h * pr);
  };

  /** Blends the two shots around the current scroll position. Transitions live at chapter ends. */
  private shotAt(c: number) {
    const n = this.shots.length; const i = clamp(Math.floor(c), 0, n - 1); const f = clamp(c - i);
    const a = this.shots[i], b = this.shots[Math.min(i + 1, n - 1)];
    const t = smooth((f - .52) / .48);
    const da = a.drift ?? [0, 0, 0];
    // shots marked agl give camera and target heights above the ground of their own world
    const ground = (sh: Shot, x: number, z: number) => sh.agl ? this.heightAt(x, z, sh.w) : 0;
    const camA: Vec3 = [a.cam[0] + da[0] * f, 0, a.cam[2] + da[2] * f]; camA[1] = a.cam[1] + da[1] * f + ground(a, camA[0], camA[2]);
    const camB: Vec3 = [b.cam[0], b.cam[1] + ground(b, b.cam[0], b.cam[2]), b.cam[2]];
    const lookA: Vec3 = [a.look[0], a.look[1] + ground(a, a.look[0], a.look[2]), a.look[2]];
    const lookB: Vec3 = [b.look[0], b.look[1] + ground(b, b.look[0], b.look[2]), b.look[2]];
    const cam = mixV(camA, camB, t);
    // long moves crane upward through the middle of the transition, like a jib, rather than skimming the ground
    cam[1] += Math.sin(Math.PI * t) * Math.hypot(camB[0] - camA[0], camB[2] - camA[2]) * .18;
    return {
      a, b, t, f, i,
      cam, look: mixV(lookA, lookB, t), fov: mix(a.fov, b.fov, t), w: mixW(a.w, b.w, t),
      sunAz: angMix(a.sunAz, b.sunAz, t), sunEl: mix(a.sunEl, b.sunEl, t), exposure: mix(a.exposure, b.exposure, t),
      contours: mix(a.contours ?? 0, b.contours ?? 0, t), survey: mix(a.survey ?? 0, b.survey ?? 0, t),
      fidelity: mix(a.fidelity ?? 0, b.fidelity ?? 0, t), gaps: mix(a.gaps ?? 0, b.gaps ?? 0, t), space: mix(a.space ?? 0, b.space ?? 0, t),
      alt: mix(a.alt ?? 410, b.alt ?? 410, t),
      veil: mixV(a.veil ?? [0, 0, 0], b.veil ?? [0, 0, 0], t),
      probe: t < .5 ? !!a.probe : !!b.probe, sunDrag: t < .5 ? !!a.sunDrag : !!b.sunDrag,
    };
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now(); const dt = Math.min(.05, (now - this.last) / 1000); this.last = now;
    const time = (now - this.t0) / 1000;
    this.frameAvg = mix(this.frameAvg, dt * 1000, .05);
    this.adapt(now);

    // critically damped scroll follow
    this.chapter += (this.chapterTarget - this.chapter) * (1 - Math.exp(-dt * 3.2));
    const s = this.shotAt(this.chapter);
    const pt = this.pointer;
    pt.sx += (pt.x - pt.sx) * (1 - Math.exp(-dt * 2.5)); pt.sy += (pt.y - pt.sy) * (1 - Math.exp(-dt * 2.5));

    // ---------- World blend, possibly overridden by the launch chapter ----------
    let w = s.w;
    const launchW: Weights = this.launch?.destination === 'mars' ? [0, 1, 0, 0] : [1, 0, 0, 0];
    const inLaunch = this.launchWeight();
    if (inLaunch > 0) w = mixW(w, launchW, inLaunch);
    this.w = w;
    (this.uT.uW.value as THREE.Vector4).set(...w);
    (this.uT.uPW.value as THREE.Vector4).set(w[2], w[3], w[0], w[1]);
    const R = 1 / (w[0] / WORLD_RADIUS[0] + w[1] / WORLD_RADIUS[1] + (w[2] + w[3]) / WORLD_RADIUS[2]);
    this.uT.uRadius.value = R;
    const earthAir = w[2] + w[3], marsAir = w[1], moonVac = w[0];
    (this.uT.uAtmo.value as THREE.Vector4).set(earthAir * (1 - s.space), marsAir * (1 - s.space), moonVac * (1 - s.space), s.space);

    // ---------- Sun ----------
    let el = s.sunEl, az = s.sunAz;
    if (!this.reduced && time < 4 && this.chapter < .6) el = mix(-.4, el, smooth(time / 3.6));
    this.sunDrag += ((s.sunDrag && pt.inside ? pt.sx * 70 : 0) - this.sunDrag) * (1 - Math.exp(-dt * 2));
    az += this.sunDrag;
    const er = el * Math.PI / 180, ar = az * Math.PI / 180;
    const L = new THREE.Vector3(Math.sin(ar) * Math.cos(er), Math.sin(er), -Math.cos(ar) * Math.cos(er));
    (this.uT.uSunDir.value as THREE.Vector3).copy(L);
    const air = earthAir + marsAir * .6; const airmass = 1 / Math.max(.06, Math.sin(Math.max(er, .02)) + .05);
    const ext = (k: number) => Math.exp(-k * airmass * air);
    const sunI = 2.3;
    (this.uT.uSunCol.value as THREE.Vector3).set(sunI * ext(.012) * (1 - marsAir * .08), sunI * ext(.03 + marsAir * .02), sunI * ext(.075 + marsAir * .05));
    this.uT.uReveal.value = this.reduced ? 1 : clamp(time / 1.2);

    // ---------- Camera ----------
    const cam = new THREE.Vector3(...s.cam), look = new THREE.Vector3(...s.look);
    if (!this.reduced) {
      cam.x += Math.sin(time * .07) * 30; cam.y += Math.sin(time * .11) * 12;
      if (this.chapter < .6) { const k = smooth(time / 7); const back = cam.clone().sub(look).normalize(); cam.addScaledVector(back, (1 - k) * 900 * (1 - this.chapter / .6)); }
    }
    // keep the lens above the ground it is filming
    const ground = this.heightAt(cam.x, cam.z, w);
    if (s.space < .5) cam.y = Math.max(cam.y, ground + 45);
    const dir = look.clone().sub(cam); const dist = dir.length();
    const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const lookAt = look.clone().addScaledVector(side, -pt.sx * dist * .05).add(new THREE.Vector3(0, -pt.sy * dist * .035, 0));
    // portrait: words fill the lower half, so tilt down and let the ground climb into the empty sky above them
    lookAt.y -= dist * .2 * clamp((1.05 - this.camera.aspect) / .35);
    this.camera.position.copy(cam); this.camera.up.set(0, 1, 0); this.camera.lookAt(lookAt);
    this.camera.fov = this.lens(s.fov, .7); this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
    (this.uT.uCam.value as THREE.Vector3).copy(cam);
    (this.uT.uGridCenter.value as THREE.Vector2).set(Math.round(cam.x / 8) * 8, Math.round(cam.z / 8) * 8);
    this.rocks.visible = s.space < .5;
    { // Earth hangs where the shot asks, relative to the camera's heading (it barely moves in a polar sky)
      const e = s.t < .5 ? s.a.earth : s.b.earth; const off = (e?.[0] ?? 14) * Math.PI / 180, up = (e?.[1] ?? 6) * Math.PI / 180;
      const head = Math.atan2(dir.x, -dir.z) + off;
      (this.uS.uEarthDir.value as THREE.Vector3).set(Math.sin(head) * Math.cos(up), Math.sin(up), -Math.cos(head) * Math.cos(up));
    }
    this.uT.uTime.value = time;
    this.terrain.visible = s.space < .999; this.spaceMix = s.space;

    // ---------- Overlays ----------
    this.uT.uContours.value = s.contours; this.uT.uSurvey.value = s.survey * (.85 + .15 * Math.sin(time * 2));
    this.uT.uFidelity.value = s.fidelity;
    this.uT.uScan.value = s.fidelity > .01 ? ((time * 1400) % 26000) - 13000 : -1;
    const gapOpen = this.uT.uGapOpen0.value as THREE.Vector4, gapOpen1 = this.uT.uGapOpen1.value as THREE.Vector2;
    for (let i = 0; i < 6; i++) {
      const target = clamp(s.gaps * 1.6 - i * .12) * (1 + (this.gapFocus === i ? .2 : 0)) * (s.gaps > .05 ? 1 : 0);
      this.gapOpen[i] += (target - this.gapOpen[i]) * (1 - Math.exp(-dt * (target < this.gapOpen[i] ? 5 : 2.2)));
    }
    gapOpen.set(this.gapOpen[0], this.gapOpen[1], this.gapOpen[2], this.gapOpen[3]); gapOpen1.set(this.gapOpen[4], this.gapOpen[5]);
    this.uT.uGapFocus.value = this.gapFocus;
    this.updateLaunchOverlays(inLaunch);
    this.updateProbe(dt, s.probe);

    // ---------- Finale ----------
    this.uS.uAlt.value = s.alt;
    const pitchDown = Math.acos(6371 / (6371 + s.alt));
    const moonEl = pitchDown - (this.uS.uMoonSize.value as number) * 2.5; (this.uS.uMoonDir.value as THREE.Vector3).set(0, -Math.sin(moonEl), -Math.cos(moonEl));
    if (s.space > .5) {
      // telephoto on the limb: point the real camera at the horizon so the sky shader frames it
      const aim = pitchDown - .034; const lim = new THREE.Vector3(0, -Math.sin(aim), -Math.cos(aim));
      this.camera.position.set(0, 0, 0); this.camera.fov = this.lens(mix(11, 9.5, clamp((this.chapter - 7) * 1.4)), .9);
      this.camera.lookAt(lim.x - pt.sx * .01, lim.y - pt.sy * .006, lim.z); this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
    }
    (this.uS.uInvProj.value as THREE.Matrix4).copy(this.camera.projectionMatrixInverse);
    (this.uS.uCamWorld.value as THREE.Matrix4).copy(this.camera.matrixWorld);
    const flash = s.a.space !== s.b.space ? Math.max(0, 1 - Math.abs(s.space - .5) * 2.6) : 0;
    this.post.uniforms.uFlash.value = flash * .9;
    this.post.uniforms.uExposure.value = s.exposure;
    { // per-world grade: cool, neutral regolith; warm Mars highlights over cooler shadows; natural Earth
      const g = [w[0] * (1 - s.space), w[1] * (1 - s.space), w[2] * (1 - s.space), w[3] * (1 - s.space), s.space];
      const tint = (vals: number[][]) => vals[0].map((_, k) => vals.reduce((acc, v, i) => acc + v[k] * g[i], 0)) as [number, number, number];
      (this.post.uniforms.uShadowTint.value as THREE.Vector3).set(...tint([[.95, .98, 1.05], [.92, .96, 1.04], [.95, .98, 1.04], [.96, 1, 1.03], [.97, .99, 1.04]]));
      (this.post.uniforms.uHighTint.value as THREE.Vector3).set(...tint([[1.02, 1, .97], [1.06, 1, .91], [1.04, 1, .95], [1.02, 1, .97], [1.02, 1, .98]]));
      this.post.uniforms.uSat.value = .82 * g[0] + 1.02 * g[1] + .95 * g[2] + .92 * g[3] + 1. * g[4];
      this.post.uniforms.uContrast.value = 1.07 * g[0] + 1.08 * g[1] + 1.04 * g[2] + 1.04 * g[3] + 1.02 * g[4];
    }
    { // landscape: the text column's side darkens; portrait: text sits low over the whole width, so the floor darkens
      const portrait = clamp((1.05 - this.camera.aspect) / .35);
      const v = s.veil; (this.post.uniforms.uVeil.value as THREE.Vector3).set(v[0] * (1 - portrait), v[1] * (1 - portrait), v[2]);
      this.post.uniforms.uVeilB.value = portrait * mix(.5, .15, s.space);
    }
    this.post.uniforms.uTime.value = time;
    // airless ground blooms less: in vacuum there is no haze to carry the glow, so the sky stays black
    this.bloom.strength = mix(.1 + .14 * (earthAir + marsAir), .4, s.space);

    this.composer.render(dt);
    this.updateLabels();
    this.onFrame?.(this.chapter);
  };

  private launchWeight() {
    const idx = this.shots.findIndex(sh => sh.launch);
    if (idx < 0 || !this.launch) return 0;
    const c = this.chapter;
    return smooth((c - (idx - .48)) / .48) * (1 - smooth((c - (idx + .52)) / .48));
  }

  private updateLaunchOverlays(k: number) {
    const l = this.launch; const range = this.uT.uRange.value as THREE.Vector3, marker = this.uT.uMarker.value as THREE.Vector4;
    if (!l || k < .02) { this.uT.uSlopeLimit.value = 0; range.set(0, 0, 0); marker.set(0, 0, 0, 0); return; }
    const p = l.params;
    if (l.mode === 'rover' || l.mode === 'eva') {
      this.uT.uSlopeLimit.value = (p.maxSlope ?? 15) * (k > .5 ? 1 : 0);
      // reachable radius: half the energy for the outbound leg at a nominal specific consumption (illustrative, not the solver)
      const whPerKm = l.mode === 'rover' ? 420 : 600;
      const r = clamp((p.batteryWh ?? 3000) / whPerKm / 2 * 1000, 200, 9000);
      range.set(0, 0, r * smooth(k));
      marker.set(0, 0, 0, 0);
    } else if (l.mode === 'descent') {
      this.uT.uSlopeLimit.value = 0; range.set(0, 0, 0);
      const ellipse = clamp(Math.abs(p.initialVelocity ?? -35) * 9 + (p.initialAltitude ?? 1200) * .25, 200, 3000);
      marker.set(0, 0, ellipse * smooth(k), 1);
    } else {
      this.uT.uSlopeLimit.value = 0; range.set(0, 0, 0);
      marker.set(0, 0, 260 * smooth(k), 2);
    }
  }

  private updateProbe(dt: number, enabled: boolean) {
    const pt = this.pointer; const pr = this.probe;
    const reticle = this.uT.uReticle.value as THREE.Vector3; const probe = this.uT.uProbe.value as THREE.Vector4;
    let hit: THREE.Vector3 | null = null;
    if (enabled && pt.inside) hit = this.raycast(pt.x, pt.y);
    if (hit) { pr.wx = hit.x; pr.wz = hit.z; if (!pr.hit) { pr.x = hit.x; pr.z = hit.z; } pr.hit = true; } else pr.hit = false;
    pr.x += (pr.wx - pr.x) * (1 - Math.exp(-dt * 9)); pr.z += (pr.wz - pr.z) * (1 - Math.exp(-dt * 9));
    const held = enabled && pt.down && pr.hit ? (performance.now() - pt.downAt) / 1000 : 0;
    // the window may grow, but never far enough to swallow the camera that is looking into it
    const reach = Math.hypot(pr.x - this.camera.position.x, pr.z - this.camera.position.z) * .72;
    pr.target = held > 0 ? Math.min(900, 140 + held * 700, reach) : 0;
    pr.r += (pr.target - pr.r) * (1 - Math.exp(-dt * (pr.target > pr.r ? 3.5 : 2.2)));
    if (pr.r < 2) pr.r = 0;
    probe.set(pr.x, pr.z, pr.r, Math.max(30, pr.r * .12));
    { const w = this.w, pw: Weights = [w[2], w[3], w[0], w[1]]; this.uT.uProbeOff.value = this.heightAt(pr.x, pr.z, w) - this.heightAt(pr.x, pr.z, pw); }
    reticle.set(pr.x, pr.z, enabled && pr.hit ? clamp(1 - pr.r / 300) : 0);
    if (this.onProbe) {
      const w = this.w, pw: Weights = [w[2], w[3], w[0], w[1]];
      const v = new THREE.Vector3(pr.x, this.heightAt(pr.x, pr.z) - (pr.x - this.camera.position.x) ** 2 * 0, pr.z).project(this.camera);
      const names = ['Moon', 'Mars', 'Earth', 'Earth'];
      const from = names[w.indexOf(Math.max(...w))], to = names[pw.indexOf(Math.max(...pw))];
      this.onProbe({ active: enabled && pr.hit, x: (v.x * .5 + .5), y: (-v.y * .5 + .5), from, to,
        dh: this.heightAt(pr.x, pr.z, pw) - this.heightAt(pr.x, pr.z, w), slopeA: this.slopeAt(pr.x, pr.z, w), slopeB: this.slopeAt(pr.x, pr.z, pw), radius: pr.r });
    }
  }

  /** Marches the pointer ray across the CPU height field (curvature ignored: the probe lives within a few km). */
  private raycast(nx: number, ny: number) {
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(nx, -ny), this.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    let t = 20, prev = 0, prevT = 0;
    for (let i = 0; i < 260; i++) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      const diff = y - this.heightAt(x, z);
      if (diff < 0) {
        let a = prevT, b = t; for (let k = 0; k < 8; k++) { const m = (a + b) / 2; const yy = o.y + d.y * m; if (yy - this.heightAt(o.x + d.x * m, o.z + d.z * m) < 0) b = m; else a = m; }
        const tt = (a + b) / 2; return new THREE.Vector3(o.x + d.x * tt, 0, o.z + d.z * tt);
      }
      prev = diff; prevT = t; t += Math.max(15, t * .02);
      if (t > 40000) break;
    }
    void prev; return null;
  }

  private updateLabels() {
    const vw = this.canvas.clientWidth, vh = this.canvas.clientHeight; const v = new THREE.Vector3();
    for (const l of this.labels) {
      const a = clamp((this.chapter - l.from + .35) / .35) * clamp((l.to - this.chapter + .35) / .35);
      const at = a > 0 ? l.at() : null;
      if (!at) { l.el.style.opacity = '0'; continue; }
      v.set(at[0], at[1], at[2]);
      const d = Math.hypot(at[0] - this.camera.position.x, at[2] - this.camera.position.z);
      v.y -= d * d / (2 * (this.uT.uRadius.value as number));
      v.project(this.camera);
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) { l.el.style.opacity = '0'; continue; }
      l.el.style.opacity = String(a);
      l.el.style.transform = `translate3d(${((v.x * .5 + .5) * vw).toFixed(1)}px, ${((-v.y * .5 + .5) * vh).toFixed(1)}px, 0)`;
    }
  }

  /** Keeps the horizontal view from collapsing on tall screens: a shot framed for 16:9 widens on a phone. */
  private lens(fov: number, k: number) {
    const a = this.camera.aspect; if (a >= 1.25) return fov;
    const t = Math.tan(fov * Math.PI / 360) * Math.pow(1.25 / a, k);
    return Math.min(84, Math.atan(t) * 360 / Math.PI);
  }

  /** Dynamic resolution: hold a smooth frame rate rather than cutting what is drawn. */
  private lastAdapt = 0;
  private adapt(now: number) {
    if (now - this.lastAdapt < 900) return; this.lastAdapt = now;
    const prev = this.scale;
    if (this.frameAvg > 24 && this.scale > .7) this.scale = Math.max(.7, this.scale - .1);
    else if (this.frameAvg < 14 && this.scale < 1) this.scale = Math.min(1, this.scale + .06);
    if (prev !== this.scale) this.resize();
  }

  dispose() {
    cancelAnimationFrame(this.raf); window.removeEventListener('resize', this.resize);
    this.terrain.geometry.dispose(); this.terrain.material.dispose(); this.sky.geometry.dispose(); this.sky.material.dispose(); this.rocks.geometry.dispose(); this.rocks.material.dispose(); this.bakes.forEach(b => b.dispose());
    this.composer.dispose(); this.renderer.dispose();
  }
}
