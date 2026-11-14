// Written with AI assistance (Codex); human review pending.
import * as T from "three";
import { captureView } from "./snapshot";
import { createRenderTiming } from "./renderTiming";
import { fitRegionalCamera, cinematicAngle } from "./camera";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { sampleTerrain } from "../terrain";
import type {
  Frame,
  MissionTerrain,
  Point,
  RunResult,
  Scenario,
} from "../types";
import { headingAt, propulsion, surfacePose, terminalState } from "./replay";
import { makeVehicle, makeHabitat } from "./vehicles";
import { solarAt } from "../solar";
import {
  makeDisturbance,
  makeLocalSurface,
  makePlume,
  makeSky,
  makeTerrain,
  PALETTES,
} from "./environment";

export type CameraMode =
  "close" | "follow" | "orbit" | "overhead" | "mast" | "ground" | "cinematic";
export interface SceneState {
  frame: Frame | null;
  run: RunResult | null;
  scenario: Scenario;
  camera: CameraMode;
  vectors: boolean;
  trajectory: boolean;
  details: boolean;
  sun: number;
  presentation: string;
  exploded?: number;
}
interface Options {
  host: HTMLDivElement;
  terrain: MissionTerrain;
  run: RunResult | null;
  scenario: Scenario;
  observations: Point[];
  layer: string;
  quality: string;
  exaggeration: number;
  getState(): SceneState;
  onPick(p: Point): void;
  onCapture?(mode: CameraMode, image: string): void;
  onError(message: string): void;
  onProfile(value: {
    fps: number;
    calls: number;
    triangles: number;
    ratio: number;
    cpuMs: number;
    gpuMs: number | null;
    geometries: number;
    textures: number;
  }): void;
}
export function createMissionScene(o: Options) {
  const { host, terrain, scenario, run } = o;
  const renderer = new T.WebGLRenderer({
    antialias: o.quality !== "low",
    powerPreference: "high-performance",
  });
  const timing = createRenderTiming(renderer);
  let ratio =
    o.quality === "low"
      ? 1
      : Math.min(window.devicePixelRatio, o.quality === "high" ? 2 : 1.5);
  renderer.setPixelRatio(ratio);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.shadowMap.enabled = o.quality !== "low";
  renderer.shadowMap.type = T.PCFShadowMap;
  renderer.domElement.setAttribute(
    "aria-label",
    "Interactive measured terrain: drag to orbit, scroll to zoom, click to inspect or place a marker",
  );
  renderer.domElement.tabIndex = 0;
  host.appendChild(renderer.domElement);
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera(42, 1, 0.1, 220000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 2;
  controls.maxDistance = 450000;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.enablePan = true;
  const heights = terrain.grid.elevation_m.filter(
      (z): z is number => z !== null,
    ),
    datum = (Math.min(...heights) + Math.max(...heights)) / 2;
  const point = (p: Point, height?: number) =>
    new T.Vector3(
      p.x,
      ((height ?? sampleTerrain(terrain, p) ?? datum) - datum) * o.exaggeration,
      -p.y,
    );
  const surface = scenario.mode === "rover" || scenario.mode === "eva";
  const measured = makeTerrain(terrain, datum, o.layer, o.exaggeration,scenario);
  scene.add(measured.mesh);
  measured.mesh.geometry.computeBoundingBox();
  const recordBounds = measured.mesh.geometry.boundingBox!.clone();
  for (const frame of run?.frames ?? [])
    recordBounds.expandByPoint(point(frame, frame.elevation));
  const local = makeLocalSurface(
    terrain,
    datum,
    measured.texture,
    o.layer,
    run?.route.length ? run.route : [scenario.start, scenario.destination],
    scenario,
  );
  scene.add(local.patch, local.rocks);
  const sky = makeSky(scenario.environment.planet);
  scene.add(sky);
  const dust = makeDisturbance(terrain.body);
  scene.add(dust.points);
  const palette = PALETTES[scenario.environment.planet];
  // No atmospheric fog in vacuum, including counterfactual lunar environments.
  const fog =
    scenario.environment.density > 0
      ? new T.FogExp2(
          palette.horizon,
          scenario.environment.planet === "mars" ? 0.00015 : 0.00009,
        )
      : null;
  const hemi = new T.HemisphereLight(
    palette.ambient,
    palette.ground,
    scenario.environment.planet === "moon" ? 0.18 : 1.05,
  );
  scene.add(hemi);
  const sun = new T.DirectionalLight(
    palette.sun,
    scenario.environment.planet === "moon" ? 3.3 : 3.1,
  );
  sun.castShadow = o.quality !== "low";
  sun.shadow.mapSize.setScalar(o.quality === "high" ? 2048 : 1024);
  sun.shadow.camera.left = -18;
  sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 18;
  sun.shadow.camera.bottom = -18;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 180;
  sun.shadow.normalBias = 0.025;
  sun.shadow.bias = -0.00015;
  scene.add(sun, sun.target);
  const pmrem = new T.PMREMGenerator(renderer),
    room = new RoomEnvironment();
  const env = pmrem.fromScene(room, 0.04);
  scene.environment = env.texture;
  scene.environmentIntensity =
    scenario.environment.planet === "moon" ? 0.15 : 0.32;
  room.dispose();
  pmrem.dispose();
  const rig = makeVehicle(scenario.mode, scenario.rover.design);
  scene.add(rig.root);
  if (scenario.mode === "eva") {
    const habitat = makeHabitat();
    const p = { x: scenario.start.x + 10, y: scenario.start.y + 8 };
    habitat.position.copy(point(p));
    scene.add(habitat);
  }
  const plumes = rig.engines.map((e) => {
    const p = makePlume();
    e.add(p.group);
    return p;
  });
  const engineLight = new T.PointLight("#a2c5ff", 0, 25, 2);
  rig.root.add(engineLight);
  engineLight.position.y = 0.8;
  // Pad/ring is a mission annotation. Its radius is visual, not a landing safety footprint.
  const ring = new T.Mesh(
    new T.RingGeometry(surface ? 2.5 : 3.5, surface ? 2.55 : 3.6, 96),
    new T.MeshBasicMaterial({
      color: "#88c6b4",
      side: T.DoubleSide,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    }),
  );
  ring.geometry.rotateX(-Math.PI / 2);
  const ringPositions = ring.geometry.getAttribute("position"),
    ringOrigin = point(scenario.start);
  for (let i = 0; i < ringPositions.count; i++) {
    const h = sampleTerrain(terrain, {
      x: scenario.start.x + ringPositions.getX(i),
      y: scenario.start.y - ringPositions.getZ(i),
    });
    ringPositions.setY(
      i,
      ((h ?? datum) - datum) * o.exaggeration - ringOrigin.y + 0.045,
    );
  }
  ringPositions.needsUpdate = true;
  ring.position.copy(ringOrigin);
  scene.add(ring);
  const grid = new T.GridHelper(24000, 24, "#2d454c", "#20313a");
  grid.position.y = measured.low - datum - 70;
  scene.add(grid);
  const markerTextures: T.Texture[] = [];
  function marker(label: string, color: string, p: Point) {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 96;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#0d171f";
    ctx.beginPath();
    ctx.arc(48, 48, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = "500 30px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 48, 49);
    const texture = new T.CanvasTexture(canvas);
    markerTextures.push(texture);
    const sprite = new T.Sprite(
      new T.SpriteMaterial({
        map: texture,
        sizeAttenuation: false,
        depthTest: false,
        transparent: true,
      }),
    );
    sprite.scale.set(0.03, 0.03, 1);
    sprite.position.copy(point(p));
    sprite.renderOrder = 5;
    scene.add(sprite);
    return sprite;
  }
  const startMark = marker(
      scenario.mode === "eva" ? "H" : "A",
      "#9be5d1",
      scenario.start,
    ),
    endMark = marker("B", "#e6bc7c", scenario.destination),
    vehicleMark = marker("V", "#f1f1e2", scenario.start);
  const observationMarkers = o.observations.map((p, i) =>
    marker(`P${i + 1}`, "#e0bf87", p),
  );
  const recordEnd =
    !surface && run?.frames.length
      ? marker("END", "#d4c5a0", run.frames[run.frames.length - 1])
      : null;
  if (recordEnd && run) {
    const end = run.frames[run.frames.length - 1];
    recordEnd.position.copy(point(end, end.elevation));
  }
  let track: T.Line | undefined, fullTrack: T.Line | undefined;
  if (run && run.frames.length > 1) {
    const geo = new T.BufferGeometry().setFromPoints(
      run.frames.map((f) => {
        const p = point(f, f.elevation);
        p.y += surface ? 1 : 0.5;
        return p;
      }),
    );
    track = new T.Line(
      geo,
      new T.LineBasicMaterial({
        color: "#8debd5",
        transparent: true,
        opacity: 0.9,
      }),
    );
    scene.add(track);
    fullTrack = new T.Line(
      geo.clone(),
      new T.LineDashedMaterial({
        color: "#d4c5a0",
        transparent: true,
        opacity: 0.85,
        dashSize: Math.max(
          35,
          recordBounds.getSize(new T.Vector3()).length() / 90,
        ),
        gapSize: Math.max(
          23,
          recordBounds.getSize(new T.Vector3()).length() / 140,
        ),
      }),
    );
    fullTrack.computeLineDistances();
    scene.add(fullTrack);
  }
  const arrows = [
    new T.ArrowHelper(
      new T.Vector3(0, -1, 0),
      new T.Vector3(),
      3,
      "#e0b46f",
      0.3,
      0.17,
    ),
    new T.ArrowHelper(
      new T.Vector3(0, 1, 0),
      new T.Vector3(),
      3,
      "#90d9e9",
      0.3,
      0.17,
    ),
    new T.ArrowHelper(
      new T.Vector3(0, 1, 0),
      new T.Vector3(),
      3,
      "#a5e4c1",
      0.3,
      0.17,
    ),
  ];
  arrows.forEach((a) => scene.add(a));
  const resize = () => {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(Math.max(1, width), Math.max(1, height));
    camera.aspect = width / Math.max(1, height);
    if (!manual) lastMode = "";
    camera.updateProjectionMatrix();
    dirty = true;
  };
  let dirty = true,
    raf = 0,
    lastTime = performance.now(),
    lastFrame = -1,
    lastMode: CameraMode | "" = "",
    manual = false,
    transition = false;
  let lastPosition = new T.Vector3(),
    targetPosition = new T.Vector3(),
    desiredPosition = new T.Vector3(),
    desiredTarget = new T.Vector3();
  let frames = 0,
    elapsed = 0,
    slowSeconds = 0;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  const refresh = () => {
    dirty = true;
  };
  const startControl = () => {
    manual = true;
    transition = false;
    dirty = true;
  };
  controls.addEventListener("change", refresh);
  controls.addEventListener("start", startControl);
  const ray = new T.Raycaster();
  let down = { x: 0, y: 0 };
  const pointerDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY };
  };
  const pointerUp = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(
      new T.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        (-(e.clientY - r.top) / r.height) * 2 + 1,
      ),
      camera,
    );
    const hit = ray.intersectObject(measured.mesh)[0];
    if (hit) o.onPick({ x: hit.point.x, y: -hit.point.z });
  };
  const key = (e: KeyboardEvent) => {
    if (
      o.getState().camera !== "ground" ||
      ![
        "w",
        "a",
        "s",
        "d",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
      ].includes(e.key)
    )
      return;
    e.preventDefault();
    const forward = new T.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const side = new T.Vector3().crossVectors(forward, new T.Vector3(0, 1, 0));
    const delta = (
      ["w", "ArrowUp"].includes(e.key)
        ? forward
        : ["s", "ArrowDown"].includes(e.key)
          ? forward.negate()
          : ["d", "ArrowRight"].includes(e.key)
            ? side
            : side.negate()
    ).multiplyScalar(5);
    const p = camera.position.clone().add(delta),
      h = sampleTerrain(terrain, { x: p.x, y: -p.z });
    if (h === null) return;
    p.y = (h - datum) * o.exaggeration + 2;
    const change = p.clone().sub(camera.position);
    camera.position.copy(p);
    controls.target.add(change);
    manual = true;
    transition = false;
  };
  const lost = (e: Event) => {
    e.preventDefault();
    o.onError(
      "The graphics context was lost. Calculations are preserved; retry 3D or use the topographic fallback.",
    );
  };
  renderer.domElement.addEventListener("pointerdown", pointerDown);
  renderer.domElement.addEventListener("pointerup", pointerUp);
  renderer.domElement.addEventListener("keydown", key);
  renderer.domElement.addEventListener("webglcontextlost", lost);
  const seekIndex = (time: number) => {
    if (!run) return 0;
    let lo = 0,
      hi = run.frames.length;
    while (lo < hi) {
      const m = (lo + hi) >>> 1;
      if (run.frames[m].t <= time) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  const captured = new Set<CameraMode>();
  let lastSun = -1,
    lastSettings = "",
    lastAssembly = -1;
  const draw = (now: number) => {
    const rawDt = Math.max(0.001, (now - lastTime) / 1000),
      dt = Math.min(0.05, rawDt);
    lastTime = now;
    if (document.hidden || !host.clientWidth || !host.clientHeight) { raf = requestAnimationFrame(draw); return; }
    const s = o.getState(),
      f = s.frame,
      mode = s.camera;
    const settingsKey = [
      s.vectors,
      s.trajectory,
      s.details,
      s.sun,
      s.presentation,
      s.exploded,
      s.scenario.solar?.epochUtc,
    ].join();
    if (settingsKey !== lastSettings) {
      dirty = true;
      lastSettings = settingsKey;
    }
    const regional = mode === "orbit" || mode === "overhead",
      localView = !regional && o.exaggeration === 1;
    const pos = f ?? s.scenario.start;
    const height =
      f?.elevation ??
      (sampleTerrain(terrain, pos) ?? datum) +
        (s.scenario.mode === "descent"
          ? s.scenario.vehicle.initialAltitude
          : 0);
    const yaw = surface
      ? headingAt(run, f?.t ?? 0, s.scenario.start, s.scenario.destination)
      : 0;
    targetPosition = point(pos, height);
    if (surface) {
      const pose = surfacePose(terrain, pos, yaw);
      targetPosition.y = (pose.height - datum) * o.exaggeration;
      rig.root.rotation.set(pose.pitch, yaw, pose.roll, "YXZ");
    } else
      rig.root.rotation.set(
        0,
        0,
        s.scenario.mode === "launch"
          ? (-s.scenario.vehicle.angle * Math.PI) / 180
          : 0,
      );
    rig.root.position.copy(targetPosition);
    rig.root.visible =
      !regional || camera.position.distanceTo(targetPosition) < 150;
    const time = f?.t ?? 0;
    for (const limb of rig.limbs)
      limb.pivot.rotation.x =
        Math.sin((f?.distance ?? 0) * 4) *
        0.35 *
        limb.phase *
        ((f?.speed ?? 0) > 0 ? 1 : 0);
    for (const leg of rig.legs) {
      const world = point({ x: pos.x + leg.x, y: pos.y - leg.z });
      const contactOffset =
        (f?.altitude ?? s.scenario.vehicle.initialAltitude) <= 0.5
          ? world.y - targetPosition.y
          : 0;
      leg.foot.position.y =
        0.065 + Math.max(-0.22, Math.min(0.22, contactOffset));
      for (const rod of leg.rods) {
        rod.mesh.position
          .copy(rod.from)
          .add(leg.foot.position)
          .multiplyScalar(0.5);
        rod.mesh.scale.y = rod.from.distanceTo(leg.foot.position) / rod.length;
        rod.mesh.quaternion.setFromUnitVectors(
          new T.Vector3(0, 1, 0),
          leg.foot.position.clone().sub(rod.from).normalize(),
        );
      }
    }

    for (const w of rig.wheels) {
      w.spin.rotation.x = -(f?.distance ?? 0) / (scenario.rover.design?.wheelRadius ?? 0.42);
      w.steer.rotation.y = 0;
      w.steer.position.x = w.x + Math.sign(w.x) * (s.exploded ?? 0) * 1.2;
      w.steer.position.z = w.z;
    }
    if (rig.chassis) rig.chassis.position.y = (scenario.rover.design?.wheelRadius ?? 0.41) - 0.41 + (s.exploded ?? 0) * 0.65;
    if (scenario.mode === "rover") rig.mast.position.y = 1.41 + (scenario.rover.design?.wheelRadius ?? 0.41) - 0.41 + (s.exploded ?? 0) * 1.3;
    // Contact placement samples the same regional surface. This is kinematic articulation, not wheel dynamics.
    if (surface) {
      rig.root.updateMatrixWorld(true);
      for (const w of rig.wheels) {
        const p = new T.Vector3(w.x, 0, w.z).applyMatrix4(rig.root.matrixWorld);
        const h = sampleTerrain(terrain, { x: p.x, y: -p.z });
        if (h !== null) {
          const localPoint = rig.root.worldToLocal(
            new T.Vector3(p.x, (h - datum) * o.exaggeration + (scenario.rover.design?.wheelRadius ?? 0.42), p.z),
          );
          const radius = scenario.rover.design?.wheelRadius ?? 0.42;
          const travel = scenario.rover.design?.suspensionTravel ?? 0.5;
          w.steer.position.y = Math.max(radius-travel, Math.min(radius+travel, localPoint.y));
        }
      }
      if (run && f) {
        const prev = headingAt(
            run,
            Math.max(0, time - 3),
            s.scenario.start,
            s.scenario.destination,
          ),
          next = headingAt(
            run,
            Math.min(run.metrics.duration, time + 3),
            s.scenario.start,
            s.scenario.destination,
          );
        const turn = Math.atan2(Math.sin(next - prev), Math.cos(next - prev));
        for (let i = 0; i < rig.wheels.length; i++)
          rig.wheels[i].steer.rotation.y =
            (i % 3 === 0 ? 1 : i % 3 === 2 ? -1 : 0) *
            Math.max(-0.4, Math.min(0.4, turn));
      }
      for (const a of rig.arms) {
        const end = rig.wheels[a.wheel].steer.position;
        a.mesh.position.copy(a.from).add(end).multiplyScalar(0.5);
        const length = a.from.distanceTo(end);
        const base = (a.mesh.geometry as T.CylinderGeometry).parameters.height;
        a.mesh.scale.y = length / base;
        a.mesh.quaternion.setFromUnitVectors(
          new T.Vector3(0, 1, 0),
          end.clone().sub(a.from).normalize(),
        );
      }
    }
    const power = propulsion(f, s.scenario, run);
    const dustStrength = surface
      ? Math.min(0.35, (f?.speed ?? 0) * 0.2)
      : power * Math.max(0, 1 - (f?.altitude ?? 100) / 25);
    dust.update(
      time,
      s.details && localView ? dustStrength : 0,
      s.scenario.environment.gravity,
    );
    dust.points.position.copy(point(pos));
    plumes.forEach((p) =>
      p.update(power, time, s.scenario.environment.density === 0 ? 3 : 1),
    );
    engineLight.intensity = power * 18;
    local.patch.visible = localView;
    local.rocks.visible = localView && s.details && o.layer === "surface";
    if (localView) local.update(pos);
    // Coarse triangles can cross the bilinear patch by metres; hide their local footprint in the fragment shader below.
    measured.mesh.visible = true;
    const state = terminalState(run, time);
    (ring.material as T.MeshBasicMaterial).color.set(
      state === "failure"
        ? "#eb7c65"
        : state === "success"
          ? "#95dfbd"
          : "#d8bc87",
    );
    ring.visible = !regional && s.presentation !== "cinematic";
    if (track && run) {
      track.visible = s.trajectory;
      track.geometry.setDrawRange(0, seekIndex(time));
      fullTrack!.visible =
        s.trajectory && (regional || s.presentation === "scientific");
    }
    startMark.visible = regional;
    endMark.visible = regional && surface;
    if (recordEnd) recordEnd.visible = regional;
    observationMarkers.forEach((m) => {
      m.visible = regional;
    });
    vehicleMark.visible = regional && !!f;
    vehicleMark.position.copy(targetPosition);
    grid.visible = regional;
    const center = targetPosition
      .clone()
      .add(new T.Vector3(0, rig.height * 0.48, 0));
    if (lastMode !== mode || lastAssembly !== (s.exploded ?? 0)) {
      manual = false;
      transition = true;
      const distance =
        (rig.height > 5 ? 17 : 6.7) * Math.max(1, 1.2 / camera.aspect) *
        (scenario.mode === "rover" ? Math.max(1,rig.radius/2.6,rig.height/2.8)*(1+(s.exploded??0)*.45) : 1);
      if (mode === "orbit") {
        const fit = fitRegionalCamera(recordBounds, camera.fov, camera.aspect);
        desiredTarget.copy(fit.target);
        desiredPosition.copy(fit.position);
      } else if (mode === "overhead") {
        desiredPosition.set(
          0,
          run?.frames.reduce(
            (a, f) =>
              Math.max(a, (f.elevation - datum) * o.exaggeration + 20000),
            27000,
          ) ?? 27000,
          0.1,
        );
        desiredTarget.set(0, 0, 0);
      } else if (mode === "mast") {
        desiredPosition
          .copy(targetPosition)
          .add(
            new T.Vector3(
              scenario.mode === "eva" ? 0 : 0.42,
              scenario.mode === "eva" ? 1.72 : 2.53,
              scenario.mode === "eva" ? -0.34 : -1.12,
            ).applyAxisAngle(new T.Vector3(0, 1, 0), yaw),
          );
        desiredTarget
          .copy(desiredPosition)
          .add(
            new T.Vector3(0, -0.08, -8).applyAxisAngle(
              new T.Vector3(0, 1, 0),
              yaw,
            ),
          );
      } else if (mode === "ground") {
        desiredPosition.copy(targetPosition).add(new T.Vector3(8, 2, 8));
        desiredTarget.copy(center);
      } else {
        const offset = new T.Vector3(
          mode === "follow" ? 0 : distance * 0.72,
          distance * 0.26,
          mode === "follow" ? distance * 0.9 : -distance * 0.9,
        ).applyAxisAngle(new T.Vector3(0, 1, 0), yaw);
        desiredPosition.copy(center).add(offset);
        desiredTarget.copy(center);
      }
      if (lastMode === "" || reduced) {
        camera.position.copy(desiredPosition);
        controls.target.copy(desiredTarget);
        transition = false;
      }
      lastMode = mode;
      lastAssembly = s.exploded ?? 0;
      lastPosition.copy(targetPosition);
      dirty = true;
    }
    const delta = targetPosition.clone().sub(lastPosition);
    if (!regional && mode !== "ground") {
      camera.position.add(delta);
      controls.target.add(delta);
      desiredPosition.add(delta);
      desiredTarget.add(delta);
      if (mode === "cinematic" && !manual && !reduced) {
        const a = cinematicAngle(time, surface),
          d = (rig.height > 5 ? 21 : 10) * Math.max(1, 1.2 / camera.aspect);
        desiredPosition
          .copy(center)
          .add(new T.Vector3(Math.sin(a) * d, d * 0.4, Math.cos(a) * d));
        desiredTarget.copy(center);
        transition = true;
      }
      if (mode === "mast" && !manual) {
        desiredPosition
          .copy(targetPosition)
          .add(
            new T.Vector3(
              scenario.mode === "eva" ? 0 : 0.42,
              scenario.mode === "eva" ? 1.72 : 2.53,
              scenario.mode === "eva" ? -0.34 : -1.12,
            ).applyAxisAngle(new T.Vector3(0, 1, 0), yaw),
          );
        desiredTarget
          .copy(desiredPosition)
          .add(
            new T.Vector3(0, -0.08, -8).applyAxisAngle(
              new T.Vector3(0, 1, 0),
              yaw,
            ),
          );
        transition = true;
      }
    }
    lastPosition.copy(targetPosition);
    if (transition) {
      const a = reduced ? 1 : 1 - Math.exp(-dt * 5);
      camera.position.lerp(desiredPosition, a);
      controls.target.lerp(desiredTarget, a);
      if (
        camera.position.distanceTo(desiredPosition) < 0.015 &&
        controls.target.distanceTo(desiredTarget) < 0.015
      )
        transition = false;
      dirty = true;
    }
    controls.minDistance = mode === "mast" ? 0.3 : regional ? 100 : 2;
    controls.maxPolarAngle =
      mode === "mast" || mode === "ground" ? Math.PI * 0.65 : Math.PI * 0.49;
    if (!regional) {
      const h = sampleTerrain(terrain, {
        x: camera.position.x,
        y: -camera.position.z,
      });
      if (h !== null)
        camera.position.y = Math.max(
          camera.position.y,
          (h - datum) * o.exaggeration + 0.45,
        );
    }
    const cameraDistance = camera.position.distanceTo(controls.target);
    camera.near = regional
      ? Math.max(10, cameraDistance / 1000)
      : cameraDistance > 1000
        ? 2
        : 0.08;
    camera.far = regional ? 500000 : 220000;
    camera.updateProjectionMatrix();
    const attenuation =
      scenario.environment.density > 0
        ? Math.exp(
            -(f?.altitude ?? 0) / Math.max(1, scenario.environment.scaleHeight),
          )
        : 0;
    if (fog)
      fog.density =
        (scenario.environment.planet === "mars" ? 0.00015 : 0.00009) *
        attenuation;
    const skyMat = sky.material as T.ShaderMaterial;
    skyMat.uniforms.zenith.value
      .set(palette.sky)
      .lerp(new T.Color("#030509"), 1 - attenuation);
    skyMat.uniforms.horizon.value
      .set(palette.horizon)
      .lerp(new T.Color("#06080d"), 1 - attenuation);
    scene.fog = regional ? null : fog;
    sky.visible = !regional;
    sky.position.copy(camera.position);
    scene.background = new T.Color(regional ? "#080e14" : palette.sky);
    if (s.scenario.solar || lastSun !== s.sun || !delta.equals(new T.Vector3())) {
      const angle = (s.sun * Math.PI) / 180;
      sun.target.position.copy(targetPosition);
      if (s.scenario.solar) {
        const geometry = solarAt(s.scenario.solar, time);
        const [east, north, up] = geometry.sunEnu;
        sun.position.copy(targetPosition).add(new T.Vector3(east, up, -north).multiplyScalar(80));
        sun.intensity = up > 0 ? 3.1 : 0;
        hemi.intensity = up > 0 ? (scenario.environment.planet === "moon" ? 0.18 : 0.9) : 0.08;
        const night = Math.max(0, Math.min(1, (up+0.1)/0.3));
        skyMat.uniforms.zenith.value.multiplyScalar(0.08 + 0.92*night);
        skyMat.uniforms.horizon.value.multiplyScalar(0.08 + 0.92*night);
      } else {
        sun.intensity = scenario.environment.planet === "moon" ? 3.3 : 3.1;
        hemi.intensity = scenario.environment.planet === "moon" ? 0.18 : 1.05;
        sun.position.copy(targetPosition).add(new T.Vector3(-Math.cos(angle) * 65, Math.sin(angle) * 80, 30));
      }
      lastSun = s.sun;
      dirty = true;
    }
    arrows.forEach((a) => (a.visible = s.vectors && !regional));
    arrows[0].position.copy(center).add(new T.Vector3(-rig.radius, 0, 0));
    arrows[0].setLength(
      1.8 + Math.min(4, s.scenario.environment.gravity * 0.3),
      0.3,
      0.16,
    );
    arrows[1].position.copy(center).add(new T.Vector3(rig.radius, 0, 0));
    const velocity = surface
      ? new T.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw))
      : new T.Vector3(
          Math.sign(s.scenario.vehicle.angle) *
            Math.sqrt(
              Math.max(0, (f?.speed ?? 0) ** 2 - (f?.verticalSpeed ?? 0) ** 2),
            ),
          f?.verticalSpeed ?? 0,
          0,
        ).normalize();
    if (velocity.lengthSq()) arrows[1].setDirection(velocity);
    arrows[1].setLength(1 + Math.min(5, (f?.speed ?? 0) * 0.1), 0.3, 0.16);
    arrows[1].visible &&= (f?.speed ?? 0) > 0;
    arrows[2].position.copy(center);
    arrows[2].setDirection(
      new T.Vector3(0, 1, 0).applyQuaternion(rig.root.quaternion),
    );
    arrows[2].setLength(1 + power * 4, 0.3, 0.16);
    arrows[2].visible &&= power > 0;
    const changed = controls.update();
    if (
      !document.hidden &&
      (dirty ||
        changed ||
        lastFrame !== time ||
        (mode === "cinematic" && !manual && !reduced))
    ) {
      const cost = timing.render(() => renderer.render(scene, camera));
      if (!transition && !captured.has(mode) && o.onCapture) {
        const image = captureView(renderer.domElement);
        if (image) {
          captured.add(mode);
          o.onCapture(mode, image);
        }
      }
      // Renderer submission cost + observed cadence, only during active rendering.
      frames++;
      elapsed += rawDt;
      slowSeconds =
        cost > 25 || rawDt > 1 / 28
          ? slowSeconds + dt
          : Math.max(0, slowSeconds - dt * 0.25);
      if (o.quality === "auto" && slowSeconds > 2 && ratio > 1) {
        ratio = Math.max(1, ratio - 0.25);
        renderer.setPixelRatio(ratio);
        slowSeconds = 0;
      }
      if (elapsed > 1) {
        o.onProfile({
          fps: Math.round(frames / elapsed),
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          ratio,
          ...timing.read(),
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
        });
        frames = 0;
        elapsed = 0;
      }
      dirty = false;
      lastFrame = time;
    }
    raf = requestAnimationFrame(draw);
  };
  // Shader cutout ensures the measured local interpolation is the visible/contact surface.
  const mat = measured.mesh.material;
  const patchCenter = new T.Vector2();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.patchCenter = { value: patchCenter };
    shader.uniforms.patchEnabled = { value: 0 };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec2 terrainXZ;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nterrainXZ=position.xz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec2 terrainXZ;uniform vec2 patchCenter;uniform float patchEnabled;",
      )
      .replace(
        "#include <clipping_planes_fragment>",
        "#include <clipping_planes_fragment>\nif(patchEnabled>.5 && max(abs(terrainXZ.x-patchCenter.x),abs(terrainXZ.y-patchCenter.y))<89.9)discard;",
      );
    measured.mesh.onBeforeRender = () => {
      patchCenter.set(local.patch.position.x, local.patch.position.z);
      shader.uniforms.patchEnabled.value = local.patch.visible ? 1 : 0;
    };
  };
  raf = requestAnimationFrame(draw);
  return () => {
    cancelAnimationFrame(raf);
    observer.disconnect();
    controls.removeEventListener("change", refresh);
    controls.removeEventListener("start", startControl);
    controls.dispose();
    renderer.domElement.removeEventListener("pointerdown", pointerDown);
    renderer.domElement.removeEventListener("pointerup", pointerUp);
    renderer.domElement.removeEventListener("keydown", key);
    renderer.domElement.removeEventListener("webglcontextlost", lost);
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>(),
      textures = new Set<T.Texture>(markerTextures);
    scene.traverse((obj) => {
      const mesh = obj as T.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material)
        for (const m of Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material]) {
          materials.add(m);
          for (const value of Object.values(m))
            if (value instanceof T.Texture) textures.add(value);
        }
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    textures.forEach((t) => t.dispose());
    env.dispose();
    sun.shadow.dispose();
    timing.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };
}
