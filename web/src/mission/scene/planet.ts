import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { MissionTerrain } from "../types";
import { captureView } from "./snapshot";
import { planetPoint, enuToPlanet } from "./planetCoordinates";

export interface PlanetProfile {
  fps: number;
  calls: number;
  triangles: number;
  ratio: number;
  textures: number;
  textureMiB: number;
}
export function createPlanetScene(
  host: HTMLElement,
  terrain: MissionTerrain,
  label: HTMLElement,
  onReady: () => void,
  onError: (message: string) => void,
  onProfile: (p: PlanetProfile) => void,
  onCapture?: (image: string) => void,
  getSunEnu?: () => number[] | null,
) {
  const renderer = new T.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  let ratio = Math.min(devicePixelRatio, 1.5);
  renderer.setPixelRatio(ratio);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.03;
  renderer.setClearColor("#07090b");
  renderer.domElement.setAttribute(
    "aria-label",
    `Interactive ${terrain.body} globe. Drag to orbit, scroll to zoom. Geographic grid is not a flight trajectory.`,
  );
  renderer.domElement.tabIndex = 0;
  host.appendChild(renderer.domElement);
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera(38, 1, 0.01, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.065;
  controls.enablePan = false;
  controls.minDistance = 1.3;
  controls.maxDistance = 6;
  const site = planetPoint(terrain.lat, terrain.lon, 1.006);
  const initial = planetPoint(
    Math.max(-48, Math.min(48, terrain.lat + 6)),
    terrain.lon + 24,
  );
  camera.position.copy(initial.clone().multiplyScalar(3.4));
  camera.lookAt(0, 0, 0);
  const light = new T.Vector3(-1.3, 0.8, 1.25)
    .applyQuaternion(camera.quaternion)
    .normalize();
  const defaultLight=light.clone();
  let cloudSun:T.DirectionalLight|null=null;
  const body = terrain.body,
    air = body !== "moon";
  const material = new T.ShaderMaterial({
    uniforms: {
      surface: { value: null },
      sun: { value: light },
      tint: { value: new T.Color(body === "mars" ? "#df946c" : "#70baff") },
      ocean: { value: body === "earth" ? 1 : 0 },
      desaturate: { value: body === "mars" ? 0.18 : 0.03 },
      atmosphere: { value: air ? (body === "mars" ? 0.17 : 0.38) : 0 },
      ready: { value: 0 },
    },
    vertexShader: `varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorld;
      void main(){vUv=uv;vNormal=normalize(mat3(modelMatrix)*normal);vWorld=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);}`,
    fragmentShader: `uniform sampler2D surface; uniform vec3 sun; uniform vec3 tint; uniform float atmosphere; uniform float ready; uniform float desaturate; uniform float ocean;
      varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorld;
      void main(){vec3 n=normalize(vNormal); vec3 view=normalize(cameraPosition-vWorld);
        float incidence=dot(n,sun); float day=smoothstep(-0.04,0.12,incidence);
        vec3 albedo=mix(vec3(.12),texture2D(surface,vUv).rgb,ready);
        albedo=mix(albedo,vec3(dot(albedo,vec3(.2126,.7152,.0722))),desaturate);
        float light=max(incidence,0.); vec3 color=albedo*(.008 + day*(.12+1.75*pow(light,.72)));
        float limb=pow(1.-max(dot(n,view),0.),3.7);
        float water=smoothstep(.02,.15,albedo.b-albedo.r)*ocean;
        color+=vec3(1.,.94,.82)*water*pow(max(dot(reflect(-sun,n),view),0.),65.)*.22*day;
        color+=tint*limb*atmosphere*smoothstep(-.15,.5,incidence);
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const globe = new T.Mesh(new T.SphereGeometry(1, 160, 96), material);
  scene.add(globe);
  if (air) {
    const glow = new T.ShaderMaterial({
      transparent: true,
      side: T.BackSide,
      depthWrite: false,
      blending: T.AdditiveBlending,
      uniforms: {
        sun: { value: light },
        tint: { value: material.uniforms.tint.value },
        density: { value: body === "mars" ? 0.36 : 0.8 },
      },
      vertexShader: `varying vec3 n;varying vec3 w;void main(){n=normalize(mat3(modelMatrix)*normal);w=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(w,1.);}`,
      fragmentShader: `uniform vec3 sun;uniform vec3 tint;uniform float density;varying vec3 n;varying vec3 w;
      void main(){float edge=pow(max(0.,1.+dot(normalize(n),normalize(cameraPosition-w))),8.);float daylight=smoothstep(-.25,.6,dot(normalize(n),sun));gl_FragColor=vec4(tint,edge*daylight*density);}`,
    });
    scene.add(
      new T.Mesh(
        new T.SphereGeometry(body === "mars" ? 1.012 : 1.022, 96, 64),
        glow,
      ),
    );
  }
  let captured = false,
    texturePixels = 0;
  let alive = true,
    loaded: T.Texture | null = null;
  const loader = new T.TextureLoader();
  const load = (suffix: string, upgrade: boolean) =>
    loader.load(
      `${import.meta.env.BASE_URL}textures/${body}${suffix}.jpg`,
      (texture) => {
        if (!alive) {
          texture.dispose();
          return;
        }
        texturePixels =
          (texture.image as HTMLImageElement).width *
          (texture.image as HTMLImageElement).height;
        texture.colorSpace = T.SRGBColorSpace;
        texture.anisotropy = Math.min(
          8,
          renderer.capabilities.getMaxAnisotropy(),
        );
        loaded?.dispose();
        loaded = texture;
        captured = false;
        material.uniforms.surface.value = texture;
        material.uniforms.ready.value = 1;
        dirty = true;
        onReady();
        if (
          upgrade &&
          renderer.capabilities.maxTextureSize >= 4096 &&
          host.clientWidth > 600
        )
          load("", false);
      },
      undefined,
      () => {
        if (alive && !loaded)
          onError(
            "Planetary imagery could not load. Retry the view or continue to measured terrain.",
          );
      },
    );
  load("-preview", true);
  if (body === "earth") {
    loader.load(
      `${import.meta.env.BASE_URL}textures/earth-clouds.jpg`,
      (texture) => {
        if (!alive) {
          texture.dispose();
          return;
        }
        const clouds = new T.Mesh(
          new T.SphereGeometry(1.005, 96, 64),
          new T.MeshStandardMaterial({
            alphaMap: texture,
            transparent: true,
            opacity: 0.65,
            depthWrite: false,
            color: "#f0f2f4",
            roughness: 1,
          }),
        );
        scene.add(clouds);
        dirty = true;
      },
    );
    const sun = new T.DirectionalLight("#ffffff", 2);
    cloudSun=sun;
    sun.position.copy(light);
    scene.add(sun, new T.AmbientLight("#56677c", 0.15));
  }
  // Latitude parallels and meridians, deliberately not fictional spacecraft orbits.
  const grid = new T.Group();
  const gridMaterial = new T.LineBasicMaterial({
    color: "#b2a189",
    transparent: true,
    opacity: 0.13,
    depthWrite: false,
  });
  for (const lat of [-60, -30, 0, 30, 60]) {
    const points = Array.from({ length: 257 }, (_, i) =>
      planetPoint(lat, (i / 256) * 360 - 180, 1.002),
    );
    grid.add(
      new T.Line(new T.BufferGeometry().setFromPoints(points), gridMaterial),
    );
  }
  for (let lon = -180; lon < 180; lon += 30)
    grid.add(
      new T.Line(
        new T.BufferGeometry().setFromPoints(
          Array.from({ length: 129 }, (_, i) =>
            planetPoint((i / 128) * 180 - 90, lon, 1.002),
          ),
        ),
        gridMaterial,
      ),
    );
  scene.add(grid);
  const marker = new T.Mesh(
    new T.SphereGeometry(0.008, 16, 12),
    new T.MeshBasicMaterial({ color: "#edb86f" }),
  );
  marker.position.copy(site);
  scene.add(marker);
  const ring = new T.Mesh(
    new T.RingGeometry(0.017, 0.019, 48),
    new T.MeshBasicMaterial({
      color: "#edb86f",
      transparent: true,
      opacity: 0.75,
      side: T.DoubleSide,
    }),
  );
  ring.position.copy(site);
  ring.quaternion.setFromUnitVectors(
    new T.Vector3(0, 0, 1),
    site.clone().normalize(),
  );
  scene.add(ring);
  // Seeded background stars are illustrative, not an astrometric catalog.
  let seed = 29;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const stars = new Float32Array(650 * 3);
  for (let i = 0; i < 650; i++) {
    const p = planetPoint(
      (Math.asin(random() * 2 - 1) * 180) / Math.PI,
      random() * 360,
      35,
    );
    stars.set(p.toArray(), i * 3);
  }
  const starGeometry = new T.BufferGeometry().setAttribute(
    "position",
    new T.BufferAttribute(stars, 3),
  );
  scene.add(
    new T.Points(
      starGeometry,
      new T.PointsMaterial({
        color: "#9fa9b5",
        size: 0.025,
        transparent: true,
        opacity: 0.35,
        sizeAttenuation: true,
      }),
    ),
  );
  let dirty = true,
    raf = 0,
    frames = 0,
    last = performance.now(),
    windowStart = last,
    activeMs = 0,
    slow = 0;
  let focus: "planet" | "target" = "planet",
    moving = true,
    manual = false;
  const desired = new T.Vector3(),
    desiredTarget = new T.Vector3();
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const reset = (mode: "planet" | "target") => {
    focus = mode;
    manual = false;
    moving = true;
    const aspect = Math.max(0.5, camera.aspect);
    desired
      .copy(mode === "target" ? site : initial)
      .normalize()
      .multiplyScalar(
        mode === "target" ? 1.85 : 3.35 * Math.max(1, 0.95 / aspect),
      );
    desiredTarget.copy(
      mode === "target" ? site.clone().multiplyScalar(0.62) : new T.Vector3(),
    );
    dirty = true;
    if (reduced) {
      camera.position.copy(desired);
      controls.target.copy(desiredTarget);
      moving = false;
    }
  };
  const resize = () => {
    if (!host.clientWidth || !host.clientHeight) return;
    const width = Math.max(1, host.clientWidth),
      height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (!manual) reset(focus);
    dirty = true;
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  camera.position.copy(desired);
  controls.target.copy(desiredTarget);
  const change = () => {
    dirty = true;
  };
  const start = () => {
    manual = true;
    moving = false;
  };
  controls.addEventListener("change", change);
  controls.addEventListener("start", start);
  const lost = (event: Event) => {
    event.preventDefault();
    onError(
      "Graphics context lost. Reopen planetary view to retry. Your experiment is preserved.",
    );
  };
  renderer.domElement.addEventListener("webglcontextlost", lost);
  const draw = (now: number) => {
    const enu=getSunEnu?.();
    const next=enu?enuToPlanet(terrain.lat,terrain.lon,enu):defaultLight;
    if(next.distanceToSquared(light)>1e-12){light.copy(next);dirty=true;}
    cloudSun?.position.copy(light);
    raf = requestAnimationFrame(draw);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (document.hidden || !host.clientWidth || !host.clientHeight) return;
    if (moving) {
      const blend = 1 - Math.exp(-dt * 3);
      camera.position.lerp(desired, blend);
      controls.target.lerp(desiredTarget, blend);
      dirty = true;
      if (camera.position.distanceTo(desired) < 0.001) moving = false;
    }
    controls.update();
    if (!dirty) return;
    const p = site.clone().project(camera);
    const visible =
      site.dot(camera.position.clone().sub(site)) > 0 &&
      Math.abs(p.x) < 0.92 &&
      Math.abs(p.y) < 0.9;
    label.style.opacity = visible ? "1" : "0";
    label.style.pointerEvents = visible ? "auto" : "none";
    label.style.left = `${(p.x * 0.5 + 0.5) * 100}%`;
    label.style.top = `${(-p.y * 0.5 + 0.5) * 100}%`;
    const begin = performance.now();
    renderer.render(scene, camera);
    if (!captured && loaded && !moving && onCapture) {
      const image = captureView(renderer.domElement);
      if (image) {
        captured = true;
        onCapture(image);
      }
    }
    activeMs += performance.now() - begin;
    frames++;
    dirty = false;
    if (now - windowStart > 2000) {
      const fps = Math.round((frames * 1000) / (now - windowStart));
      onProfile({
        fps,
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        ratio,
        textures: renderer.info.memory.textures,
        textureMiB: Math.round(
          ((texturePixels * 4 * 4) / 3 +
            (body === "earth" ? (2048 * 1024 * 4 * 4) / 3 : 0)) /
            1048576,
        ),
      });
      if (moving && fps < 30) slow++;
      else slow = 0;
      if (slow >= 2 && ratio > 1) {
        ratio = Math.max(1, ratio - 0.25);
        renderer.setPixelRatio(ratio);
        resize();
        slow = 0;
      }
      host.dataset.renderMs = (activeMs / frames).toFixed(2);
      frames = 0;
      activeMs = 0;
      windowStart = now;
    }
  };
  raf = requestAnimationFrame(draw);
  return {
    focus: reset,
    grid: (visible: boolean) => {
      grid.visible = visible;
      dirty = true;
    },
    dispose: () => {
      alive = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      const textures = new Set<T.Texture>(),
        materials = new Set<T.Material>(),
        geometries = new Set<T.BufferGeometry>();
      scene.traverse((object) => {
        const mesh = object as T.Mesh;
        if (mesh.geometry) geometries.add(mesh.geometry);
        if (mesh.material)
          for (const m of Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material])
            materials.add(m);
      });
      for (const m of materials) {
        for (const value of Object.values(m))
          if (value instanceof T.Texture) textures.add(value);
        m.dispose();
      }
      loaded?.dispose();
      textures.forEach((t) => t.dispose());
      geometries.forEach((g) => g.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
