// EGIZ ASTRAL · world renderer. Streams measured terrain tiles by screen-space error and draws every layer from
// the same world state the analysis and simulation use. Scene axes: +X east, +Y up, −Z north; metres, true scale.
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { ancestorsOf, decodeHeights, resolveDrawSet, selectTiles, TileCache, tileIndex, type WorldManifest, type WorldTile } from "../world/core";
import { sample, type Field, type XY } from "../world/field";
import type { MissionTerrain } from "../../mission/types";

export type Quality = "performance" | "balanced" | "high";
export type CameraMode = "free" | "site" | "top" | "follow" | "first";
export const QUALITY: Record<Quality, { maxErrorPx: number; maxTiles: number; pixelRatio: number; shadowMap: number; anisotropy: number }> = {
  performance: { maxErrorPx: 6, maxTiles: 48, pixelRatio: 1, shadowMap: 0, anisotropy: 2 },
  balanced: { maxErrorPx: 3, maxTiles: 96, pixelRatio: 1.5, shadowMap: 2048, anisotropy: 8 },
  high: { maxErrorPx: 1.5, maxTiles: 170, pixelRatio: 2, shadowMap: 4096, anisotropy: 16 },
};
/** Reasonable default from what the browser reports; the user can override. */
export function estimateQuality(): Quality {
  const cores = navigator.hardwareConcurrency ?? 4, memory = (navigator as { deviceMemory?: number }).deviceMemory ?? 8;
  return cores >= 12 && memory >= 8 ? "high" : cores >= 6 && memory >= 4 ? "balanced" : "performance";
}
export interface Marker extends XY { id: string; label: string; color: string }
export interface RockMark extends XY { id: string; diameterM: number }
export interface RingMark extends XY { id: string; radiusM: number; color: string }
export interface Path { id: string; points: XY[]; color: string; width: number; dashed?: boolean }
export interface RoverPose extends XY { headingDeg: number; pitchDeg: number; rollDeg: number; distance: number; wheelDz: number[] }
export interface ViewStats { fps: number; tilesDrawn: number; tilesLoaded: number; pending: number; triangles: number; calls: number; finestLevel: number; pixelRatio: number }
export interface WorldViewOptions {
  host: HTMLElement; manifest: WorldManifest; baseUrl: string; field: Field; regional: MissionTerrain | null; quality: Quality;
  onPick(p: XY, shift: boolean): void; onStats?(s: ViewStats): void; onError(message: string): void; onProgress?(loaded: number, pending: number): void;
}
const PALETTE = {
  mars: { sky: "#b89a80", horizon: "#d6bfa5", tint: [1.22, 0.9, 0.66], ambient: "#c9a98d", ambientLevel: 0.55, fog: 0.00006 },
  moon: { sky: "#000000", horizon: "#000000", tint: [1, 1, 1], ambient: "#ffffff", ambientLevel: 0.02, fog: 0 },
  earth: { sky: "#5f8fb5", horizon: "#c5d3da", tint: [1, 1, 1], ambient: "#bcd4ea", ambientLevel: 0.6, fog: 0.00004 },
};

export function createWorldView(o: WorldViewOptions) {
  const { manifest: m, field } = o, e = m.encoding, q = QUALITY[o.quality], body = m.site.body, palette = PALETTE[body];
  const index = tileIndex(m), datum = e.offset_m;
  const renderer = new T.WebGLRenderer({ antialias: o.quality !== "performance", powerPreference: "high-performance" });
  let pixelRatio = Math.min(window.devicePixelRatio, q.pixelRatio);
  renderer.setPixelRatio(pixelRatio);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.NoToneMapping; // imagery brightness is shown as recorded, not re-graded
  renderer.shadowMap.enabled = q.shadowMap > 0;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute("aria-label", "Interactive 3D terrain. Drag to orbit, right-drag to pan, scroll to zoom, click to inspect.");
  o.host.appendChild(renderer.domElement);
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(45, 1, 0.5, 120000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.1; controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 3; controls.maxDistance = 30000;
  controls.zoomToCursor = true; controls.screenSpacePanning = false;
  const toScene = (p: XY, lift = 0) => new T.Vector3(p.x, (sample(field, p) ?? datum) - datum + lift, -p.y);

  // ── lighting ─────────────────────────────────────────────────────────────
  const ambient = new T.HemisphereLight(palette.ambient, "#3a2f28", palette.ambientLevel), sun = new T.DirectionalLight("#fff4e6", 3);
  sun.castShadow = q.shadowMap > 0;
  if (q.shadowMap) { sun.shadow.mapSize.setScalar(q.shadowMap); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.05; }
  scene.add(ambient, sun, sun.target);
  const sky = new T.Mesh(new T.SphereGeometry(1, 32, 16), new T.ShaderMaterial({ side: T.BackSide, depthWrite: false, fog: false,
    uniforms: { zenith: { value: new T.Color(palette.sky) }, horizon: { value: new T.Color(palette.horizon) }, level: { value: 1 } },
    vertexShader: "varying vec3 d;void main(){d=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
    fragmentShader: "varying vec3 d;uniform vec3 zenith;uniform vec3 horizon;uniform float level;void main(){float h=pow(clamp(normalize(d).y,0.,1.),.5);gl_FragColor=vec4(mix(horizon,zenith,h)*level,1.);\n#include <colorspace_fragment>\n}" }));
  sky.scale.setScalar(90000); sky.renderOrder = -10; sky.frustumCulled = false;
  scene.add(sky);
  scene.fog = palette.fog ? new T.FogExp2(palette.horizon, palette.fog) : null;
  // Neutral reflection probe for vehicle materials only (PBR metals are black without one). Terrain is unaffected.
  const pmrem = new T.PMREMGenerator(renderer), room = new RoomEnvironment(), vehicleEnv = pmrem.fromScene(room, 0.04);
  room.dispose(); pmrem.dispose();

  // ── shared terrain shader state ──────────────────────────────────────────
  const size = m.extent.east - m.extent.west;
  const blank = () => { const t = new T.DataTexture(new Uint8Array(4), 1, 1, T.RGBAFormat); t.needsUpdate = true; return t; };
  const uniforms = {
    uExtent: { value: new T.Vector3(m.extent.west, -m.extent.north, size) }, uTint: { value: new T.Vector3(...palette.tint) },
    uOverlay: { value: blank() as T.Texture }, uOverlayOpacity: { value: 0 }, uShadow: { value: blank() as T.Texture }, uShadowStrength: { value: 0 }, uUnlit: { value: 0 },
  };
  const patch = (material: T.MeshStandardMaterial, cutout: boolean) => {
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vSite;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSite=(modelMatrix*vec4(transformed,1.)).xz;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vSite;uniform vec3 uExtent;uniform vec3 uTint;uniform sampler2D uOverlay;uniform float uOverlayOpacity;uniform sampler2D uShadow;uniform float uShadowStrength;uniform float uUnlit;")
        .replace("#include <map_fragment>", `#include <map_fragment>
vec2 suv=(vSite-uExtent.xy)/uExtent.z;bool inSite=suv.x>=0.&&suv.y>=0.&&suv.x<=1.&&suv.y<=1.;
${cutout ? "if(inSite)discard;" : ""}
diffuseColor.rgb*=uTint;
if(inSite){vec4 ov=texture2D(uOverlay,suv);diffuseColor.rgb=mix(diffuseColor.rgb,ov.rgb,ov.a*uOverlayOpacity);}`)
        .replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\nif(inSite)reflectedLight.directDiffuse*=1.-texture2D(uShadow,suv).r*uShadowStrength;")
        .replace("#include <opaque_fragment>", "outgoingLight=mix(outgoingLight,diffuseColor.rgb,uUnlit);\n#include <opaque_fragment>");
    };
    material.customProgramCacheKey = () => `astral-terrain-${cutout}`;
    return material;
  };

  // ── regional context (coarse measured grid around the high-resolution site) ──
  if (o.regional) {
    const g = o.regional.grid, positions: number[] = [], colors: number[] = [], indices: number[] = [];
    const valid = g.elevation_m.filter((z): z is number => z !== null), lo = Math.min(...valid), hi = Math.max(...valid);
    g.elevation_m.forEach((z, i) => { positions.push(g.west_m + (i % g.side) * g.cell_m, (z ?? datum) - datum - 0.3, -(g.north_m - Math.floor(i / g.side) * g.cell_m)); const v = 0.07 + 0.06 * (((z ?? lo) - lo) / Math.max(1, hi - lo)); colors.push(v, v, v); });
    for (let r = 0; r < g.side - 1; r++) for (let c = 0; c < g.side - 1; c++) { const a = r * g.side + c; if ([a, a + 1, a + g.side, a + g.side + 1].every(i => g.elevation_m[i] !== null)) indices.push(a, a + g.side, a + 1, a + 1, a + g.side, a + g.side + 1); }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3)); geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
    const mesh = new T.Mesh(geometry, patch(new T.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }), true));
    mesh.name = "regional-context"; scene.add(mesh);
  }

  // ── tile geometry ────────────────────────────────────────────────────────
  const P = e.posts, V = P + 1, sharedIndex: number[] = [];
  for (let r = 0; r < P; r++) for (let c = 0; c < P; c++) { const a = r * V + c; sharedIndex.push(a, a + V, a + 1, a + 1, a + V, a + V + 1); }
  const edge: number[] = []; // perimeter, clockwise from the north-west corner
  for (let c = 0; c < P; c++) edge.push(c); for (let r = 0; r < P; r++) edge.push(r * V + P); for (let c = P; c > 0; c--) edge.push(P * V + c); for (let r = P; r > 0; r--) edge.push(r * V);
  edge.forEach((a, i) => { const b = edge[(i + 1) % edge.length], sa = V * V + i, sb = V * V + ((i + 1) % edge.length); sharedIndex.push(a, b, sa, b, sb, sa); });
  const indexAttribute = new T.Uint32BufferAttribute(sharedIndex, 1);
  type TileData = { mesh: T.Mesh; texture: T.Texture | null };
  const textureLoader = new T.TextureLoader();
  const loadTile = async (t: WorldTile, signal: AbortSignal): Promise<TileData> => {
    const response = await fetch(`${o.baseUrl}h/${t.key}.bin`, { signal });
    if (!response.ok) throw new Error(`Terrain tile ${t.key}: HTTP ${response.status}`);
    const h = decodeHeights(await response.arrayBuffer(), e), post = t.posting_m, count = V * V + edge.length;
    const position = new Float32Array(count * 3), normal = new Float32Array(count * 3), uv = new Float32Array(count * 2);
    for (let r = 0; r < V; r++) for (let c = 0; c < V; c++) {
      const i = r * V + c, j = (r + 1) * e.side + c + 1, z = h[j];
      position[i * 3] = c * post; position[i * 3 + 1] = (Number.isNaN(z) ? (t.min_m ?? datum) : z) - datum; position[i * 3 + 2] = r * post;
      const gx = (h[j + 1] - h[j - 1]) / (2 * post), gn = (h[j - e.side] - h[j + e.side]) / (2 * post), ok = !Number.isNaN(gx + gn), l = ok ? Math.hypot(gx, gn, 1) : 1;
      normal[i * 3] = ok ? -gx / l : 0; normal[i * 3 + 1] = 1 / l; normal[i * 3 + 2] = ok ? gn / l : 0;
      uv[i * 2] = c / P; uv[i * 2 + 1] = 1 - r / P;
    }
    edge.forEach((a, k) => { const i = V * V + k; position.set([position[a * 3], position[a * 3 + 1] - post * 2, position[a * 3 + 2]], i * 3); normal.set(normal.subarray(a * 3, a * 3 + 3), i * 3); uv.set(uv.subarray(a * 2, a * 2 + 2), i * 2); });
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(position, 3)); geometry.setAttribute("normal", new T.BufferAttribute(normal, 3)); geometry.setAttribute("uv", new T.BufferAttribute(uv, 2));
    geometry.setIndex(indexAttribute);
    geometry.boundingBox = new T.Box3(new T.Vector3(0, (t.min_m ?? datum) - datum - post * 2, 0), new T.Vector3(t.size, (t.max_m ?? datum) - datum, t.size));
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new T.Sphere());
    let texture: T.Texture | null = null;
    if (t.image_sha256) {
      texture = await textureLoader.loadAsync(`${o.baseUrl}img/${t.key}.jpg`);
      if (signal.aborted) { texture.dispose(); geometry.dispose(); throw new DOMException("aborted", "AbortError"); }
      texture.colorSpace = T.SRGBColorSpace; texture.anisotropy = Math.min(q.anisotropy, renderer.capabilities.getMaxAnisotropy()); texture.wrapS = texture.wrapT = T.ClampToEdgeWrapping;
    }
    const mesh = new T.Mesh(geometry, patch(new T.MeshStandardMaterial({ map: texture, color: texture ? "#ffffff" : "#8a8a8a", roughness: 1, metalness: 0 }), false));
    mesh.position.set(t.west, 0, -t.north); mesh.receiveShadow = true; mesh.visible = false; mesh.userData.tile = t.key; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    scene.add(mesh);
    return { mesh, texture };
  };
  const cache = new TileCache<TileData>(loadTile, d => { scene.remove(d.mesh); d.mesh.geometry.setIndex(null); d.mesh.geometry.dispose(); (d.mesh.material as T.Material).dispose(); d.texture?.dispose(); },
    { maxConcurrent: 6, maxTiles: q.maxTiles, onChange: () => { dirty = true; lodDirty = true; }, onError: (t, err) => o.onError(`Terrain tile ${t.key} failed to load: ${err instanceof Error ? err.message : err}`) });
  const pinned = new Set(m.tiles.filter(t => t.level === 0).map(t => t.key));

  // ── annotation layers ────────────────────────────────────────────────────
  const layer = { markers: new T.Group(), rocks: new T.Group(), rings: new T.Group(), paths: new T.Group(), rover: new T.Group() };
  scene.add(...Object.values(layer));
  const disposeGroup = (g: T.Group) => { g.traverse(obj => { const x = obj as T.Mesh; x.geometry?.dispose(); for (const mat of Array.isArray(x.material) ? x.material : x.material ? [x.material] : []) { (mat as T.SpriteMaterial).map?.dispose(); mat.dispose(); } }); g.clear(); };
  const rockGeometry = (() => { const g = new T.IcosahedronGeometry(0.5, 1), p = g.getAttribute("position"); for (let i = 0; i < p.count; i++) { const n = Math.sin(i * 12.9898) * 43758.5453, k = 0.82 + 0.3 * (n - Math.floor(n)); p.setXYZ(i, p.getX(i) * k, Math.max(-0.1, p.getY(i)) * k, p.getZ(i) * k); } g.computeVertexNormals(); return g; })();
  let rockIds: string[] = [];
  const lineMaterials: LineMaterial[] = [];

  // ── camera ───────────────────────────────────────────────────────────────
  let mode: CameraMode = "site", wasDrawn = false, dirty = true, lodDirty = true, raf = 0, last = performance.now(), frames = 0, elapsed = 0, slow = 0, lastFps = 0;
  let pose: RoverPose | null = null, roverObject: T.Object3D | null = null, roverSpin: ((p: RoverPose) => void) | null = null, roverLength = 3;
  const goal = { position: new T.Vector3(), target: new T.Vector3(), active: false };
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fly = (position: T.Vector3, target: T.Vector3, instant = false) => { goal.position.copy(position); goal.target.copy(target); goal.active = true; if (instant || reduced) { camera.position.copy(position); controls.target.copy(target); goal.active = false; } dirty = true; };
  const siteView = (instant = false) => fly(new T.Vector3(-size * 0.55, size * 0.5, size * 0.75), toScene({ x: 0, y: 0 }), instant);
  siteView(true);
  controls.addEventListener("start", () => { goal.active = false; if (mode === "follow" || mode === "first" || mode === "top" || mode === "site") mode = "free"; });
  controls.addEventListener("change", () => { dirty = true; lodDirty = true; });

  const ray = new T.Raycaster();
  let down = { x: 0, y: 0 };
  const pointerDown = (ev: PointerEvent) => { down = { x: ev.clientX, y: ev.clientY }; };
  const pointerUp = (ev: PointerEvent) => {
    if (Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 5 || ev.button !== 0) return;
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new T.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, (-(ev.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObjects([...cache.entries.values()].filter(t => t.data?.mesh.visible).map(t => t.data!.mesh))[0];
    if (hit) o.onPick({ x: hit.point.x, y: -hit.point.z }, ev.shiftKey);
  };
  const lost = (ev: Event) => { ev.preventDefault(); o.onError("The graphics context was lost. Analysis results are preserved; reload the view to restore 3D."); };
  renderer.domElement.addEventListener("pointerdown", pointerDown); renderer.domElement.addEventListener("pointerup", pointerUp); renderer.domElement.addEventListener("webglcontextlost", lost);
  const resize = () => { const { width, height } = o.host.getBoundingClientRect(); if (!width || !height) return; renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); for (const lm of lineMaterials) lm.resolution.set(width, height); dirty = true; lodDirty = true; };
  const observer = new ResizeObserver(resize); observer.observe(o.host); resize();

  const frustum = new T.Frustum(), box = new T.Box3(), matrix = new T.Matrix4();
  let drawn: string[] = [];
  const updateLod = () => {
    camera.updateMatrixWorld(); frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const visible = (t: WorldTile) => { box.min.set(t.west, (t.min_m ?? datum) - datum - 40, -t.north); box.max.set(t.west + t.size, (t.max_m ?? datum) - datum + 5, -t.north + t.size); return frustum.intersectsBox(box); };
    const eye: [number, number, number] = [camera.position.x, -camera.position.z, camera.position.y + datum];
    const wanted = selectTiles(m, index, { eye, viewportHeightPx: renderer.domElement.clientHeight, fovDeg: camera.fov, maxErrorPx: q.maxErrorPx, visible });
    const coarse = ancestorsOf(index, wanted), seen = new Set(coarse.map(t => t.key));
    cache.request([...m.tiles.filter(t => t.level === 0 && !seen.has(t.key)), ...coarse, ...wanted.filter(t => !seen.has(t.key)).sort((a, b) => a.level - b.level)], pinned);
    const next = resolveDrawSet(m, index, wanted, key => cache.get(key) !== undefined);
    for (const key of drawn) { const d = cache.get(key); if (d) d.mesh.visible = false; }
    for (const key of next) cache.get(key)!.mesh.visible = true;
    drawn = next; o.onProgress?.([...cache.entries.values()].filter(t => t.data).length, cache.pendingCount);
  };

  const clampCamera = () => { const g = sample(field, { x: camera.position.x, y: -camera.position.z }); if (g !== null) camera.position.y = Math.max(camera.position.y, g - datum + 1.2); };
  const draw = (now: number) => {
    raf = requestAnimationFrame(draw);
    const raw = (now - last) / 1000; last = now;
    if (document.hidden || !o.host.clientWidth) return;
    if (pose && roverObject && (mode === "follow" || mode === "first")) {
      const p = toScene(pose), yaw = (pose.headingDeg * Math.PI) / 180, forward = new T.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
      if (mode === "follow") { goal.target.copy(p).add(new T.Vector3(0, roverLength * 0.4, 0)); goal.position.copy(p).addScaledVector(forward, -roverLength * 2.6).add(new T.Vector3(0, roverLength * 1.1, 0)); }
      else { goal.position.copy(p).add(new T.Vector3(0, roverLength * 0.72, 0)).addScaledVector(forward, roverLength * 0.25); goal.target.copy(goal.position).addScaledVector(forward, 12).add(new T.Vector3(0, -1.2, 0)); }
      goal.active = true;
    }
    if (goal.active) {
      const k = reduced ? 1 : 1 - Math.exp(-Math.min(raw, 0.3) * 4);
      camera.position.lerp(goal.position, k); controls.target.lerp(goal.target, k);
      if (camera.position.distanceTo(goal.position) < 0.02 && mode !== "follow" && mode !== "first") goal.active = false;
      dirty = true; lodDirty = true;
    }
    controls.minDistance = mode === "first" ? 0.5 : 3;
    if (controls.update()) { dirty = true; lodDirty = true; }
    clampCamera();
    if (lodDirty) { updateLod(); lodDirty = false; dirty = true; }
    if (!dirty) { wasDrawn = false; return; }
    const d = camera.position.distanceTo(controls.target);
    camera.near = Math.max(0.2, d / 2000); camera.far = 120000; camera.updateProjectionMatrix();
    sky.position.copy(camera.position);
    if (sun.castShadow) { const half = Math.max(25, Math.min(600, d * 0.9)), c = sun.shadow.camera; c.left = -half; c.right = half; c.top = half; c.bottom = -half; c.near = 1; c.far = half * 8; c.updateProjectionMatrix(); sun.target.position.copy(controls.target); sun.position.copy(controls.target).addScaledVector(sunDirection, half * 4); }
    renderer.render(scene, camera);
    dirty = false;
    // Rendering is on demand, so only back-to-back frames say anything about frame rate.
    const continuous = wasDrawn && raw < 0.25; wasDrawn = true;
    if (continuous) { frames++; elapsed += raw; slow = raw > 1 / 24 ? slow + raw : Math.max(0, slow - raw * 0.5); }
    if (slow > 3 && pixelRatio > 1) { pixelRatio = Math.max(1, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); slow = 0; resize(); }
    if (elapsed > 0.5 || !continuous) {
      o.onStats?.({ fps: elapsed > 0.5 ? Math.round(frames / elapsed) : lastFps, tilesDrawn: drawn.length, tilesLoaded: [...cache.entries.values()].filter(t => t.data).length, pending: cache.pendingCount, triangles: renderer.info.render.triangles, calls: renderer.info.render.calls,
        finestLevel: drawn.reduce((a, key) => Math.max(a, index.get(key)!.level), 0), pixelRatio });
      if (elapsed > 0.5) { lastFps = Math.round(frames / elapsed); frames = 0; elapsed = 0; }
    }
  };
  const sunDirection = new T.Vector3(-0.5, 0.6, 0.3).normalize();
  raf = requestAnimationFrame(draw);
  if (import.meta.env.DEV) (window as unknown as { __astral?: unknown }).__astral = { scene, camera, renderer, controls, cache };

  const label = (text: string, color: string) => {
    const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext("2d")!; ctx.font = "600 26px 'IBM Plex Mono', monospace"; const w = Math.min(248, ctx.measureText(text).width + 28);
    ctx.fillStyle = "rgba(8,10,12,.82)"; ctx.beginPath(); ctx.roundRect((256 - w) / 2, 10, w, 44, 6); ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = color; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, 128, 33, 230);
    const sprite = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(canvas), depthTest: false, sizeAttenuation: false, transparent: true }));
    sprite.scale.set(0.11, 0.0275, 1); sprite.center.set(0.5, -0.4); sprite.renderOrder = 20; return sprite;
  };
  const dataTexture = (data: Uint8Array, side: number, format: T.PixelFormat, srgb: boolean, smooth: boolean) => { const t = new T.DataTexture(data, side, side, format); if (srgb) t.colorSpace = T.SRGBColorSpace; t.magFilter = smooth ? T.LinearFilter : T.NearestFilter; t.minFilter = T.LinearFilter; t.needsUpdate = true; return t; };

  return {
    /** Sun direction as an ENU unit vector (from the SPICE record), or null when no geometry is available. */
    setSun(enu: number[] | null, shadow: { side: number; data: Uint8Array } | null) {
      if (enu) { sunDirection.set(enu[0], enu[2], -enu[1]).normalize(); const up = enu[2]; sun.intensity = up > 0 ? 3 : 0; const dusk = Math.max(0, Math.min(1, (up + 0.05) / 0.25)); ambient.intensity = palette.ambientLevel * (0.06 + 0.94 * dusk); (sky.material as T.ShaderMaterial).uniforms.level.value = 0.04 + 0.96 * dusk; if (scene.fog) (scene.fog as T.FogExp2).color.set(palette.horizon).multiplyScalar(0.04 + 0.96 * dusk); }
      const old = uniforms.uShadow.value;
      if (shadow) { const bytes = new Uint8Array(shadow.data.length); for (let i = 0; i < bytes.length; i++) bytes[i] = shadow.data[i] * 255; uniforms.uShadow.value = dataTexture(bytes, shadow.side, T.RedFormat, false, true); uniforms.uShadowStrength.value = 0.92; } else uniforms.uShadowStrength.value = 0;
      if (shadow) old.dispose();
      dirty = true;
    },
    /** Site-wide RGBA raster (row 0 north) draped over the terrain, or null to clear. */
    setOverlay(raster: { side: number; rgba: Uint8Array } | null, opacity = 0.6) {
      const old = uniforms.uOverlay.value;
      uniforms.uOverlay.value = raster ? dataTexture(raster.rgba, raster.side, T.RGBAFormat, true, false) : blank(); uniforms.uOverlayOpacity.value = raster ? opacity : 0; old.dispose(); dirty = true;
    },
    /** scientific: imagery untinted. visualization: declared illustrative colour tint. unlit: image as acquired, no relighting. */
    setAppearance(a: { tint: boolean; unlit: boolean }) { uniforms.uTint.value.set(...((a.tint ? palette.tint : [1, 1, 1]) as [number, number, number])); uniforms.uUnlit.value = a.unlit ? 1 : 0; dirty = true; },
    setMarkers(items: Marker[]) { disposeGroup(layer.markers); for (const it of items) { const s = label(it.label, it.color); s.position.copy(toScene(it, 4)); s.userData.id = it.id; layer.markers.add(s); const pin = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 4, 6), new T.MeshBasicMaterial({ color: it.color, transparent: true, opacity: 0.7 })); pin.position.copy(toScene(it, 2)); layer.markers.add(pin); } dirty = true; },
    /** Image-derived rock candidates. Position and diameter come from detection; the 3D shape is illustrative. */
    setRocks(items: RockMark[]) {
      disposeGroup(layer.rocks); rockIds = items.map(r => r.id);
      if (items.length) { const mesh = new T.InstancedMesh(rockGeometry.clone(), new T.MeshStandardMaterial({ color: body === "mars" ? "#7d6250" : "#77787a", roughness: 0.95 }), items.length), obj = new T.Object3D();
        items.forEach((r, i) => { obj.position.copy(toScene(r)); obj.scale.set(r.diameterM, r.diameterM, r.diameterM); obj.rotation.y = (i * 2.399) % 6.283; obj.updateMatrix(); mesh.setMatrixAt(i, obj.matrix); });
        mesh.castShadow = true; mesh.receiveShadow = true; mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); layer.rocks.add(mesh); }
      dirty = true;
    },
    setRings(items: RingMark[]) {
      disposeGroup(layer.rings);
      for (const it of items) { const pts: T.Vector3[] = []; for (let i = 0; i <= 64; i++) { const a = (i / 64) * Math.PI * 2; pts.push(toScene({ x: it.x + Math.cos(a) * it.radiusM, y: it.y + Math.sin(a) * it.radiusM }, 0.4)); }
        const line = new T.Line(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color: it.color, depthTest: false, transparent: true, opacity: 0.9 })); line.renderOrder = 10; line.userData.id = it.id; layer.rings.add(line); }
      dirty = true;
    },
    setPaths(items: Path[]) {
      disposeGroup(layer.paths); lineMaterials.length = 0;
      const { width, height } = o.host.getBoundingClientRect();
      for (const it of items) { if (it.points.length < 2) continue; const flat: number[] = []; for (const p of it.points) { const v = toScene(p, 0.5); flat.push(v.x, v.y, v.z); }
        const material = new LineMaterial({ color: it.color, linewidth: it.width, dashed: !!it.dashed, dashSize: 4, gapSize: 3, transparent: true, opacity: it.dashed ? 0.7 : 0.95 }); material.resolution.set(width || 1, height || 1); lineMaterials.push(material);
        const line = new Line2(new LineGeometry().setPositions(flat), material); line.computeLineDistances(); line.renderOrder = 12; layer.paths.add(line); }
      dirty = true;
    },
    /** Vehicle model, already scaled to metres with its wheels on y = 0. `spin` animates model-specific parts. */
    setRoverModel(object: T.Object3D | null, length: number, spin: ((p: RoverPose) => void) | null) { layer.rover.clear(); roverObject = object; roverSpin = spin; roverLength = length; if (object) { object.traverse(x => { x.castShadow = true; const mesh = x as T.Mesh; for (const mat of Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []) if ((mat as T.MeshStandardMaterial).isMeshStandardMaterial) { (mat as T.MeshStandardMaterial).envMap = vehicleEnv.texture; (mat as T.MeshStandardMaterial).envMapIntensity = body === "moon" ? 0.2 : 0.55; mat.needsUpdate = true; } }); layer.rover.add(object); } layer.rover.visible = !!pose; dirty = true; },
    setRoverPose(p: RoverPose | null) {
      pose = p; layer.rover.visible = !!p && !!roverObject;
      if (p && roverObject) { layer.rover.position.copy(toScene(p)); layer.rover.rotation.set((p.pitchDeg * Math.PI) / 180, (-p.headingDeg * Math.PI) / 180, (-p.rollDeg * Math.PI) / 180, "YXZ"); roverSpin?.(p); }
      dirty = true;
    },
    setCamera(next: CameraMode) {
      mode = next;
      if (next === "site") siteView();
      if (next === "top") { const c = pose ?? { x: controls.target.x, y: -controls.target.z }, h = pose ? 120 : Math.max(200, camera.position.distanceTo(controls.target)); fly(toScene(c, h).add(new T.Vector3(0, 0, 0.01)), toScene(c)); }
      dirty = true;
    },
    getCamera: () => mode,
    flyTo(p: XY, distance = 90) { mode = "free"; const t = toScene(p), dir = camera.position.clone().sub(controls.target).setY(0); if (dir.lengthSq() < 1) dir.set(0.6, 0, 0.8); dir.normalize(); fly(t.clone().addScaledVector(dir, distance * 0.85).add(new T.Vector3(0, distance * 0.5, 0)), t); },
    cameraState: () => ({ x: camera.position.x, y: -camera.position.z, height: camera.position.y + datum, target: { x: controls.target.x, y: -controls.target.z }, range: camera.position.distanceTo(controls.target) }),
    rockIdAt: (i: number) => rockIds[i],
    invalidate() { dirty = true; },
    dispose() {
      cancelAnimationFrame(raf); observer.disconnect(); controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", pointerDown); renderer.domElement.removeEventListener("pointerup", pointerUp); renderer.domElement.removeEventListener("webglcontextlost", lost);
      cache.clear(); Object.values(layer).forEach(disposeGroup); rockGeometry.dispose();
      scene.traverse(obj => { const x = obj as T.Mesh; x.geometry?.dispose(); for (const mat of Array.isArray(x.material) ? x.material : x.material ? [x.material] : []) mat.dispose(); });
      uniforms.uOverlay.value.dispose(); uniforms.uShadow.value.dispose(); vehicleEnv.dispose(); sun.shadow.map?.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    },
  };
}
export type WorldView = ReturnType<typeof createWorldView>;
