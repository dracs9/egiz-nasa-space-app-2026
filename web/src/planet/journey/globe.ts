// EGIZ Expedition · planetary globe. A rotatable, zoomable body for the World and Explore stages.
// The surface is a published visual mosaic (Solar System Scope, CC BY 4.0, see public/textures/ATTRIBUTION.md):
// it is context for orientation, never an input to any calculation. Measured terrain begins when the visitor
// descends into a packaged site. The globe is rotated (not the camera), so the poles have no singularity —
// the lunar south-polar targets at −89.8° are reachable like any other place.
import * as T from 'three';

export type GlobeBody = 'moon' | 'mars';
export interface LatLon { lat: number; lon: number }
export interface ScreenPoint { x: number; y: number; visible: boolean }
export interface GlobeOptions { body: GlobeBody; base: string; interactive?: boolean; spin?: boolean; graticule?: boolean }

const D = Math.PI / 180;
/** Unit vector for latitude/longitude in the mesh frame of three's SphereGeometry (u = 0 at −180°). */
export function toVec(lat: number, lon: number, r = 1): T.Vector3 {
  const phi = (lon + 180) * D, c = Math.cos(lat * D);
  return new T.Vector3(-Math.cos(phi) * c * r, Math.sin(lat * D) * r, Math.sin(phi) * c * r);
}
export function toLatLon(v: T.Vector3): LatLon {
  const n = v.clone().normalize(), lat = Math.asin(Math.max(-1, Math.min(1, n.y))) / D;
  let lon = Math.atan2(n.z, -n.x) / D - 180; if (lon < -180) lon += 360; if (lon >= 180) lon -= 360;
  return { lat, lon };
}
/** Great-circle angle between two places, degrees. */
export function arcDeg(a: LatLon, b: LatLon): number { return toVec(a.lat, a.lon).angleTo(toVec(b.lat, b.lon)) / D; }

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const MIN_DIST = 1.035, MAX_DIST = 6;
interface View { lat: number; lon: number; dist: number }

export class Globe {
  readonly renderer: T.WebGLRenderer; readonly canvas: HTMLCanvasElement;
  private scene = new T.Scene(); private camera = new T.PerspectiveCamera(32, 1, 0.005, 100); private group = new T.Group();
  private mesh: T.Mesh<T.SphereGeometry, T.MeshStandardMaterial>; private grat: T.LineSegments<T.BufferGeometry, T.LineBasicMaterial>; private light = new T.DirectionalLight(0xffffff, 2.1);
  /** View state: the place under the screen centre and the camera distance in body radii. */
  view: View = { lat: 20, lon: 0, dist: 3.2 };
  private vel = { lat: 0, lon: 0 }; private anim: { from: View; to: View; t0: number; ms: number } | null = null;
  private raf = 0; private dirty = true; private alive = true; private spin: boolean; private dragging = false; private ro: ResizeObserver; private ray = new T.Raycaster();
  onFrame: ((project: (lat: number, lon: number) => ScreenPoint) => void) | null = null;
  onPick: ((p: LatLon) => void) | null = null; onHover: ((p: LatLon | null) => void) | null = null; onView: ((v: { lat: number; lon: number; dist: number }) => void) | null = null;
  onUserMove: (() => void) | null = null;

  constructor(private host: HTMLElement, private opts: GlobeOptions) {
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.canvas = this.renderer.domElement; this.canvas.className = 'xp-globe-canvas'; host.appendChild(this.canvas);
    this.spin = !!opts.spin && !reduced();
    if (opts.interactive === false) this.view = { lat: opts.body === 'moon' ? 6 : 14, lon: opts.body === 'moon' ? 10 : 70, dist: 4.1 };
    const mat = new T.MeshStandardMaterial({ color: 0x777777, roughness: 1, metalness: 0 });
    this.mesh = new T.Mesh(new T.SphereGeometry(1, 192, 128), mat); this.group.add(this.mesh);
    this.grat = graticule(); this.grat.visible = opts.graticule ?? true; this.group.add(this.grat);
    this.scene.add(this.group, new T.AmbientLight(0xffffff, opts.body === 'moon' ? 0.5 : 0.6), this.light);
    this.scene.add(stars());
    this.loadTexture();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(host); this.resize();
    if (opts.interactive !== false) this.bind();
    const loop = (now: number) => { if (!this.alive) return; this.raf = requestAnimationFrame(loop); this.tick(now); };
    this.raf = requestAnimationFrame(loop); this.renderNow();
  }
  /** Low-resolution mosaic first for a fast first frame, then the 4096 px map. */
  private loadTexture() {
    const loader = new T.TextureLoader(), max = this.renderer.capabilities.getMaxAnisotropy();
    const apply = (tex: T.Texture) => { if (!this.alive) { tex.dispose(); return; } tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = max; const old = this.mesh.material.map; this.mesh.material.map = tex; this.mesh.material.color.set(0xffffff); this.mesh.material.needsUpdate = true; old?.dispose(); this.dirty = true; this.renderNow(); };
    loader.load(`${this.opts.base}textures/${this.opts.body}-preview.jpg`, tex => { apply(tex); if (this.opts.interactive !== false) loader.load(`${this.opts.base}textures/${this.opts.body}.jpg`, apply); });
  }
  private resize() { const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight); this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.dirty = true; this.renderNow(); }
  /** Draw immediately (first frame, texture arrival, resize) instead of waiting for the next animation frame. */
  renderNow() { if (!this.alive) return; this.dirty = true; this.tick(performance.now()); }
  setGraticule(on: boolean) { this.grat.visible = on; this.dirty = true; }

  // ── detail patch: an enhanced image laid exactly over its latitude/longitude box, faded in (no visible swap) ──
  private detail: { mesh: T.Mesh<T.SphereGeometry, T.MeshStandardMaterial>; t0: number; ms: number; from: number; to: number } | null = null;
  private retired: { mesh: T.Mesh<T.SphereGeometry, T.MeshStandardMaterial>; t0: number; ms: number }[] = [];
  /** Show `image` over the box (degrees; longitudes may run past ±180). Replaces any previous patch with a cross-fade. */
  setDetail(image: HTMLCanvasElement | null, box?: { latMin: number; latMax: number; lonMin: number; lonMax: number }, ms = 900) {
    const now = performance.now(), fade = reduced() ? 1 : ms;
    if (this.detail) { this.retired.push({ mesh: this.detail.mesh, t0: now, ms: fade }); this.detail = null; }
    if (image && box) {
      // three's SphereGeometry: phi runs with longitude exactly as toVec() (phi = lon + 180°), theta from the north pole.
      const geo = new T.SphereGeometry(1.0006, 96, 64, (box.lonMin + 180) * D, (box.lonMax - box.lonMin) * D, (90 - box.latMax) * D, (box.latMax - box.latMin) * D);
      const tex = new T.CanvasTexture(image); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy(); tex.generateMipmaps = true;
      const mat = new T.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const mesh = new T.Mesh(geo, mat); mesh.renderOrder = 1; this.group.add(mesh);
      this.detail = { mesh, t0: now, ms: fade, from: 0, to: 1 };
    }
    this.dirty = true;
  }
  private fadeDetail(now: number) {
    let busy = false;
    if (this.detail) { const d = this.detail, k = Math.min(1, (now - d.t0) / d.ms); d.mesh.material.opacity = d.from + (d.to - d.from) * ease(k); if (k < 1) busy = true; }
    this.retired = this.retired.filter(r => { const k = Math.min(1, (now - r.t0) / r.ms); r.mesh.material.opacity = Math.min(r.mesh.material.opacity, 1 - ease(k)); if (k >= 1) { this.group.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.map?.dispose(); r.mesh.material.dispose(); return false; } busy = true; return true; });
    if (busy) this.dirty = true;
  }
  setSpin(on: boolean) { this.spin = on && !reduced(); }

  /** Animate the view to centre a place. Reduced-motion users get a short cut instead of a flight. */
  flyTo(lat: number, lon: number, dist = this.view.dist, ms = 1700) {
    const to = { lat: Math.max(-90, Math.min(90, lat)), lon, dist: Math.max(MIN_DIST, Math.min(MAX_DIST, dist)) }, from = { ...this.view };
    let dl = to.lon - from.lon; while (dl > 180) dl -= 360; while (dl < -180) dl += 360; to.lon = from.lon + dl;
    this.vel = { lat: 0, lon: 0 }; this.spin = false;
    if (reduced()) ms = 1;
    // Long arcs zoom out mid-flight so the visitor sees where they are going.
    this.anim = { from, to, t0: performance.now(), ms: ms * (0.75 + Math.min(1, arcDeg(from, to) / 120) * 0.5) };
  }
  zoomBy(f: number) { this.anim = null; this.view.dist = Math.max(MIN_DIST, Math.min(MAX_DIST, 1 + (this.view.dist - 1) * f)); this.dirty = true; this.emitView(); }
  rotateBy(dLat: number, dLon: number) { this.anim = null; this.spin = false; const k = Math.max(0.02, this.view.dist - 1); this.view.lat = Math.max(-90, Math.min(90, this.view.lat + dLat * k)); this.view.lon += dLon * k; this.dirty = true; this.emitView(); }
  /** Kilometres per CSS pixel at the screen centre (for the scale bar). */
  kmPerPixel(radiusKm: number): number { const h = this.host.clientHeight || 1, d = (this.view.dist - 1) * radiusKm; return (2 * d * Math.tan((this.camera.fov * D) / 2)) / h; }

  private emitView() { this.onView?.({ ...this.view, lon: ((((this.view.lon + 180) % 360) + 360) % 360) - 180 }); }
  private tick(now: number) {
    if (this.anim) {
      const a = this.anim, t = Math.min(1, (now - a.t0) / a.ms), e = ease(t), lift = Math.sin(Math.PI * t) * Math.min(1.6, arcDeg(a.from, a.to) / 60);
      this.view = { lat: a.from.lat + (a.to.lat - a.from.lat) * e, lon: a.from.lon + (a.to.lon - a.from.lon) * e, dist: a.from.dist + (a.to.dist - a.from.dist) * e + lift };
      if (t >= 1) { this.anim = null; this.view = { ...a.to }; } this.dirty = true; this.emitView();
    } else if (!this.dragging && (Math.abs(this.vel.lat) > 1e-3 || Math.abs(this.vel.lon) > 1e-3)) {
      this.view.lat = Math.max(-90, Math.min(90, this.view.lat + this.vel.lat)); this.view.lon += this.vel.lon; this.vel.lat *= 0.92; this.vel.lon *= 0.92; this.dirty = true; this.emitView();
    } else if (this.spin && !this.dragging) { this.view.lon += 0.035; this.dirty = true; }
    this.fadeDetail(now);
    if (!this.dirty) return; this.dirty = false;
    const v = this.view;
    this.group.rotation.set(v.lat * D, Math.PI / 2 - (v.lon + 180) * D, 0, 'XYZ');
    // Near the surface the camera tilts toward the horizon, like descending in an aircraft.
    const h = v.dist - 1, polar = Math.max(0, Math.min(1, (78 - Math.abs(v.lat)) / 12)), tilt = Math.max(0, Math.min(1, (0.55 - h) / 0.5)) * 0.62 * polar; // no horizon tilt at the poles, where the mosaic is stretched
    this.camera.position.set(0, -Math.sin(tilt) * h, 1 + Math.cos(tilt) * h); this.camera.up.set(0, 1, 0);
    // Far away the camera looks at the body's centre; close in it looks at the surface point under the view.
    this.camera.lookAt(0, 0, Math.max(0, Math.min(1, (1.2 - h) / 1.1)));
    this.camera.near = Math.max(0.0005, h * 0.05); this.camera.far = 100; this.camera.updateProjectionMatrix();
    // Illustrative light from the upper left of the viewer, so relief reads on whichever face is shown.
    this.light.position.set(-2.4, 2.2, 3.4);
    this.grat.material.opacity = Math.min(0.22, 0.05 + h * 0.06);
    this.renderer.render(this.scene, this.camera);
    if (this.onFrame) { this.group.updateMatrixWorld(); this.onFrame((lat, lon) => this.project(lat, lon)); }
  }
  private project(lat: number, lon: number): ScreenPoint {
    const p = toVec(lat, lon).applyMatrix4(this.group.matrixWorld), n = p.clone().normalize(), toCam = this.camera.position.clone().sub(p);
    const visible = n.dot(toCam) > 0, s = p.clone().project(this.camera);
    return { x: (s.x * 0.5 + 0.5) * this.host.clientWidth, y: (-s.y * 0.5 + 0.5) * this.host.clientHeight, visible: visible && s.z < 1 };
  }
  /** The surface place under a screen position, or null when the pointer is on space. */
  pick(clientX: number, clientY: number): LatLon | null {
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new T.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hit = this.ray.intersectObject(this.mesh, false)[0]; if (!hit) return null;
    this.group.updateMatrixWorld(); return toLatLon(this.group.worldToLocal(hit.point.clone()));
  }
  private bind() {
    const c = this.canvas; let down: { x: number; y: number; t: number; moved: boolean } | null = null, last = { x: 0, y: 0 }; const pointers = new Map<number, { x: number; y: number }>(); let pinch = 0;
    c.addEventListener('pointerdown', e => { c.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false }; last = { x: e.clientX, y: e.clientY }; this.dragging = true; this.anim = null; this.spin = false; this.vel = { lat: 0, lon: 0 }; if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); } });
    c.addEventListener('pointermove', e => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) { const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch > 0 && d > 0) this.zoomBy(pinch / d); pinch = d; if (down) down.moved = true; return; }
      if (!this.dragging || !down) { this.onHover?.(this.pick(e.clientX, e.clientY)); return; }
      const dx = e.clientX - last.x, dy = e.clientY - last.y; last = { x: e.clientX, y: e.clientY };
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) { if (!down.moved) this.onUserMove?.(); down.moved = true; }
      const k = (Math.max(0.02, this.view.dist - 1) * 0.0042 * 1000) / Math.max(400, this.host.clientHeight);
      this.vel = { lat: dy * k * 60 * 0.6, lon: -dx * k * 60 * 0.6 };
      this.view.lat = Math.max(-90, Math.min(90, this.view.lat + this.vel.lat)); this.view.lon += this.vel.lon; this.dirty = true; this.emitView();
    });
    const up = (e: PointerEvent) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = 0; if (pointers.size) return; this.dragging = false; if (down && !down.moved && performance.now() - down.t < 500) { const p = this.pick(e.clientX, e.clientY); if (p) this.onPick?.(p); this.vel = { lat: 0, lon: 0 }; } down = null; };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => { if (!this.dragging) this.onHover?.(null); });
    c.addEventListener('wheel', e => { e.preventDefault(); this.onUserMove?.(); this.zoomBy(Math.exp(e.deltaY * 0.0015)); }, { passive: false });
    c.addEventListener('dblclick', e => { const p = this.pick(e.clientX, e.clientY); if (p) this.flyTo(p.lat, p.lon, 1 + (this.view.dist - 1) * 0.45, 900); });
  }
  dispose() {
    this.alive = false; cancelAnimationFrame(this.raf); this.ro.disconnect();
    this.scene.traverse(o => { const m = o as T.Mesh; if (m.geometry) m.geometry.dispose(); const mat = m.material as T.Material | T.Material[] | undefined; for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) { (x as T.MeshStandardMaterial).map?.dispose(); x.dispose(); } });
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.canvas.remove();
  }
}

function graticule(): T.LineSegments<T.BufferGeometry, T.LineBasicMaterial> {
  const pts: number[] = [], r = 1.0015, push = (a: T.Vector3, b: T.Vector3) => pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
  for (let lon = -180; lon < 180; lon += 30) for (let lat = -88; lat < 88; lat += 4) push(toVec(lat, lon, r), toVec(lat + 4, lon, r));
  for (let lat = -60; lat <= 60; lat += 30) for (let lon = -180; lon < 180; lon += 3) push(toVec(lat, lon, r), toVec(lat, lon + 3, r));
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
  return new T.LineSegments(g, new T.LineBasicMaterial({ color: 0xece8df, transparent: true, opacity: 0.12, depthWrite: false }));
}
/** Faint fixed star field (decorative backdrop, seeded so it is identical on every visit). */
function stars(): T.Points {
  let a = 2026; const rnd = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
  const pts: number[] = []; for (let i = 0; i < 1400; i++) { const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u); pts.push(s * Math.cos(t) * 40, u * 40, s * Math.sin(t) * 40); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
  return new T.Points(g, new T.PointsMaterial({ color: 0xbfc6cf, size: 0.07, sizeAttenuation: true, transparent: true, opacity: 0.55, depthWrite: false }));
}
