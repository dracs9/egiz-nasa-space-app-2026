// Written with AI assistance (Codex); human review pending.
// Original illustrative engineering models. Dimensions are visual design, not vehicle specifications.
import * as T from "three";
import { makeWheelVisual } from "./mechanical";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Mode, RoverDesign } from "../types";

export interface VehicleRig {
  root: T.Group;
  wheels: { steer: T.Group; spin: T.Group; x: number; z: number }[];
  arms: { mesh: T.Mesh; from: T.Vector3; wheel: number }[];
  engines: T.Group[];
  limbs: { pivot: T.Group; phase: number }[];
  legs: {
    foot: T.Group;
    rods: { mesh: T.Mesh; from: T.Vector3; length: number }[];
    x: number;
    z: number;
  }[];
  mast: T.Group;
  height: number;
  radius: number;
  chassis?: T.Group;
}
const up = new T.Vector3(0, 1, 0);
function material(color: string, metalness = 0.5, roughness = 0.4) {
  return new T.MeshStandardMaterial({ color, metalness, roughness });
}
export function makeVehicle(mode: Mode, design?: RoverDesign): VehicleRig {
  const root = new T.Group(),
    mast = new T.Group();
  const rig: VehicleRig = {
    root,
    mast,
    wheels: [],
    arms: [],
    engines: [],
    limbs: [],
    legs: [],
    height: 3,
    radius: 3,
  };
  const white = material("#c9c8bc", 0.18, 0.46),
    metal = material("#aeb6bd", 0.94, 0.31),
    dark = material("#252a2d", 0.6, 0.46),
    gold = material("#c3a36a", 0.88, 0.39),
    black = material("#171d22", 0.2, 0.8),
    blue = material("#122b49", 0.65, 0.28),
    copper = material("#805c42", 0.75, 0.45);
  // Small, original foil normal texture. A material treatment, never measured surface data.
  const textureSize = 256;
  const foilData = new Uint8Array(textureSize * textureSize * 4);
  const roughData = new Uint8Array(textureSize * textureSize * 4);
  // Periodic crossing folds produce directional highlights, with no random state or external asset.
  const fold = (x: number, y: number) => {
    const u = (x / textureSize) * Math.PI * 2,
      v = (y / textureSize) * Math.PI * 2;
    return (
      Math.abs(Math.sin(u * 3 + Math.sin(v * 2) * 1.6)) * 0.6 +
      Math.abs(Math.sin(v * 5 - u * 2 + Math.sin(u * 4) * 0.6)) * 0.3 +
      Math.sin(u * 17 + v * 13) * 0.035 +
      Math.sin(v * 31 - u * 23) * 0.018
    );
  };
  for (let y = 0; y < textureSize; y++)
    for (let x = 0; x < textureSize; x++) {
      const i = (y * textureSize + x) * 4;
      const normal = new T.Vector3(
        (fold(x - 1, y) - fold(x + 1, y)) * 5,
        (fold(x, y - 1) - fold(x, y + 1)) * 5,
        1,
      ).normalize();
      foilData[i] = (normal.x * 0.5 + 0.5) * 255;
      foilData[i + 1] = (normal.y * 0.5 + 0.5) * 255;
      foilData[i + 2] = (normal.z * 0.5 + 0.5) * 255;
      foilData[i + 3] = 255;
      const roughness = 160 + fold(x, y) * 75;
      roughData.set([roughness, roughness, roughness, 255], i);
    }
  const foil = new T.DataTexture(
    foilData,
    textureSize,
    textureSize,
    T.RGBAFormat,
  );
  foil.wrapS = foil.wrapT = T.RepeatWrapping;
  foil.minFilter = T.LinearMipmapLinearFilter;
  foil.magFilter = T.LinearFilter;
  foil.generateMipmaps = true;
  foil.repeat.set(4, 2);
  foil.needsUpdate = true;
  gold.normalMap = foil;
  gold.normalScale.set(0.85, 0.85);
  const roughness = new T.DataTexture(
    roughData,
    textureSize,
    textureSize,
    T.RGBAFormat,
  );
  roughness.wrapS = roughness.wrapT = T.RepeatWrapping;
  roughness.repeat.copy(foil.repeat);
  roughness.minFilter = T.LinearMipmapLinearFilter;
  roughness.magFilter = T.LinearFilter;
  roughness.generateMipmaps = true;
  roughness.needsUpdate = true;
  gold.roughnessMap = roughness;
  const glass = new T.MeshPhysicalMaterial({
    color: "#183d50",
    metalness: 0.45,
    roughness: 0.16,
    clearcoat: 1,
  });
  let component = "chassis";
  const add = (
    parent: T.Object3D,
    geo: T.BufferGeometry,
    mat: T.Material,
    x = 0,
    y = 0,
    z = 0,
  ) => {
    const mesh = new T.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.userData.component = component;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const box = (
    p: T.Object3D,
    w: number,
    h: number,
    d: number,
    m: T.Material,
    x = 0,
    y = 0,
    z = 0,
  ) =>
    add(
      p,
      new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.13),
      m,
      x,
      y,
      z,
    );
  const cyl = (
    p: T.Object3D,
    r: number,
    h: number,
    m: T.Material,
    x = 0,
    y = 0,
    z = 0,
    r2 = r,
  ) => add(p, new T.CylinderGeometry(r, r2, h, 32), m, x, y, z);
  const bar = (
    p: T.Object3D,
    a: T.Vector3,
    b: T.Vector3,
    radius: number,
    mat: T.Material,
  ) => {
    const mesh = cyl(p, radius, a.distanceTo(b), mat);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
    return mesh;
  };
  const bolt = (p: T.Object3D, x: number, y: number, z: number, r = 0.024) =>
    cyl(p, r, 0.025, metal, x, y, z);
  const ring = (
    p: T.Object3D,
    r: number,
    t: number,
    m: T.Material,
    y: number,
  ) => {
    const o = add(p, new T.TorusGeometry(r, t, 8, 48), m, 0, y);
    o.rotation.x = Math.PI / 2;
    return o;
  };
  const engine = (
    p: T.Object3D,
    x: number,
    y: number,
    z: number,
    scale: number,
  ) => {
    const g = new T.Group();
    g.position.set(x, y, z);
    g.scale.setScalar(scale);
    p.add(g);
    const profile = [
      [0.38, 0],
      [0.4, 0.05],
      [0.32, 0.18],
      [0.23, 0.4],
      [0.13, 0.64],
      [0.13, 0.75],
      [0.2, 0.82],
    ].map(([r, h]) => new T.Vector2(r, h));
    add(g, new T.LatheGeometry(profile, 40), dark);
    ring(g, 0.38, 0.035, metal, 0.04);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      bar(
        g,
        new T.Vector3(Math.cos(a) * 0.34, 0.1, Math.sin(a) * 0.34),
        new T.Vector3(Math.cos(a) * 0.16, 0.7, Math.sin(a) * 0.16),
        0.012,
        copper,
      );
    }
    cyl(g, 0.2, 0.2, metal, 0, 0.9);
    cyl(g, 0.18, 0.06, black, 0, 0.035);
    const exhaust = new T.Group();
    exhaust.position.y = 0.015;
    g.add(exhaust);
    rig.engines.push(exhaust);
    return g;
  };
  const dish = (p: T.Object3D, x: number, y: number, z: number, r: number) => {
    const g = new T.Group();
    g.position.set(x, y, z);
    g.rotation.x = -0.45;
    p.add(g);
    add(
      g,
      new T.SphereGeometry(r, 32, 12, 0, Math.PI * 2, 0, 0.82),
      white,
    ).scale.y = 0.28;
    bar(g, new T.Vector3(0, 0, 0), new T.Vector3(0, r * 0.8, 0), 0.025, metal);
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3;
      bar(
        g,
        new T.Vector3(Math.cos(a) * r * 0.7, r * 0.1, Math.sin(a) * r * 0.7),
        new T.Vector3(0, r * 0.65, 0),
        0.009,
        dark,
      );
    }
  };
  const panel = (
    p: T.Object3D,
    x: number,
    y: number,
    z: number,
    w: number,
    d: number,
  ) => {
    const previousComponent=component; component="power";
    box(p, w + 0.07, 0.06, d + 0.07, metal, x, y, z);
    box(p, w, 0.012, d, blue, x, y + 0.04, z);
    for (let i = 1; i < 9; i++)
      box(p, 0.009, 0.014, d, gold, x - w / 2 + (w * i) / 9, y + 0.05, z);
    for (let i = 1; i < 5; i++)
      box(p, w, 0.014, 0.008, metal, x, y + 0.05, z - d / 2 + (d * i) / 5);
    component=previousComponent;
  };
  if (mode === "rover") {
    box(root, 1.7, 0.48, 2.35, gold, 0, 1.05);
    box(root, 1.82, 0.12, 2.48, white, 0, 1.34);
    box(root, 1.34, 0.18, 1.4, dark, 0, 0.72, 0.2);
    for (const side of [-1, 1]) {
      box(root, 0.09, 0.35, 2.28, metal, side * 0.88, 1.05);
      for (let j = 0; j < 6; j++)
        box(
          root,
          0.025,
          0.28,
          0.055,
          dark,
          side * 0.935,
          1.03,
          -0.9 + j * 0.36,
        );
      panel(root, side * 1.11, 1.48, 0.55, 0.63, 1.2);
      for (let i = 0; i < 3; i++) {
        const z = -1.12 + i * 1.12,
          x = side * 1.29;
        const steer = new T.Group(),
          spin = new T.Group();
        steer.position.set(x, 0.42, z);
        steer.add(spin);
        root.add(steer);
        spin.add(makeWheelVisual());
        steer.userData.component = "mobility";
        component = "suspension";
        rig.wheels.push({ steer, spin, x, z });
        const from = new T.Vector3(side * 0.67, 0.91, i === 0 ? -0.55 : 0.65);
        const mesh = bar(root, from, steer.position, 0.055, metal);
        rig.arms.push({ mesh, from, wheel: rig.wheels.length - 1 });
        const strut = bar(
          root,
          new T.Vector3(side * 0.8, 0.84, z + 0.22),
          steer.position,
          0.028,
          dark,
        );
        rig.arms.push({
          mesh: strut,
          from: new T.Vector3(side * 0.8, 0.84, z + 0.22),
          wheel: rig.wheels.length - 1,
        });
      }
    }
    component = "mast";
    mast.userData.component = "mast";
    mast.position.set(0.42, 1.41, -0.8);
    root.add(mast);
    cyl(mast, 0.07, 1.02, metal, 0, 0.5);
    cyl(mast, 0.12, 0.14, dark, 0, 0.95);
    box(mast, 0.72, 0.29, 0.25, white, 0, 1.12);
    box(mast, 0.62, 0.18, 0.04, dark, 0, 1.12, -0.145);
    for (const x of [-0.22, 0.22]) {
      const lens = cyl(mast, 0.078, 0.09, glass, x, 1.12, -0.19);
      lens.rotation.x = Math.PI / 2;
    }
    box(mast, 0.2, 0.24, 0.21, gold, 0.41, 1.12);
    component = "avionics";
    box(root, 0.5, 0.24, 0.42, white, -0.42, 1.54, -0.72);
    component = "communications";
    dish(root, -0.48, 1.86, 0.25, 0.43);
    cyl(root, 0.023, 0.9, metal, -0.65, 1.85, 0.95);
    cyl(root, 0.05, 0.2, black, -0.65, 2.3, 0.95);
    component = "power";
    // Rear instrument and heat-rejection assembly.
    box(root, 0.63, 0.55, 0.43, white, 0, 1.22, 1.41);
    for (let i = 0; i < 10; i++)
      box(root, 0.8, 0.025, 0.6, metal, 0, 0.98 + i * 0.055, 1.4);
    component = "science";
    // Stowed robotic science arm with a turret, not a simulated manipulator.
    bar(
      root,
      new T.Vector3(-0.65, 1.1, -1.19),
      new T.Vector3(-0.62, 0.68, -1.65),
      0.075,
      white,
    );
    bar(
      root,
      new T.Vector3(-0.62, 0.68, -1.65),
      new T.Vector3(0.3, 0.61, -1.68),
      0.065,
      metal,
    );
    cyl(root, 0.15, 0.2, dark, 0.32, 0.62, -1.7).rotation.x = Math.PI / 2;
    for (let x = -0.7; x <= 0.7; x += 0.35)
      for (const z of [-1.12, 1.1]) bolt(root, x, 1.42, z);
    rig.height = 2.8;
    rig.radius = 2.6;
  } else if (mode === "eva") {
    // Illustrative suited field operator. Limb motion is distance-driven kinematics, not biomechanics.
    box(root, 0.58, 0.6, 0.36, white, 0, 1.18);
    box(root, 0.46, 0.56, 0.25, gold, 0, 1.2, 0.29);
    box(root, 0.4, 0.22, 0.07, dark, 0, 1.33, -0.21);
    box(root, 0.32, 0.12, 0.09, metal, 0, 1.34, -0.25);
    add(root, new T.SphereGeometry(0.27, 32, 24), white, 0, 1.72);
    const visor = add(
      root,
      new T.SphereGeometry(
        0.24,
        32,
        18,
        Math.PI * 0.5,
        Math.PI,
        Math.PI * 0.2,
        Math.PI * 0.65,
      ),
      glass,
      0,
      1.73,
      -0.04,
    );
    visor.rotation.y = Math.PI;
    ring(root, 0.235, 0.035, metal, 1.52);
    for (const side of [-1, 1]) {
      const leg = new T.Group();
      leg.position.set(side * 0.17, 0.92, 0);
      root.add(leg);
      rig.limbs.push({ pivot: leg, phase: side });
      cyl(leg, 0.12, 0.62, white, 0, -0.31);
      cyl(leg, 0.135, 0.12, dark, 0, -0.4);
      box(leg, 0.26, 0.17, 0.4, white, 0, -0.74, -0.07);
      box(leg, 0.27, 0.05, 0.42, black, 0, -0.84, -0.07);
      const arm = new T.Group();
      arm.position.set(side * 0.36, 1.4, 0);
      root.add(arm);
      rig.limbs.push({ pivot: arm, phase: -side });
      cyl(arm, 0.105, 0.51, white, 0, -0.24);
      cyl(arm, 0.115, 0.1, dark, 0, -0.44);
      add(arm, new T.SphereGeometry(0.11, 16, 12), white, 0, -0.55);
    }
    cyl(root, 0.015, 0.45, metal, -0.23, 1.62, 0.29);
    rig.height = 2;
    rig.radius = 1.2;
  } else if (mode === "launch") {
    // Compact single-stage demonstrator. No fabricated staging or deployable fins.
    cyl(root, 0.72, 5.9, white, 0, 4.1);
    cyl(root, 0.73, 0.85, dark, 0, 1.48);
    const fairing = [
      [0.72, 0],
      [0.76, 0.28],
      [0.76, 0.8],
      [0.69, 1.28],
      [0.53, 1.8],
      [0.28, 2.23],
      [0.02, 2.5],
    ].map(([r, h]) => new T.Vector2(r, h));
    add(root, new T.LatheGeometry(fairing, 64), white, 0, 7.05);
    for (const y of [1.09, 1.93, 3.8, 6.8, 7.06])
      ring(root, 0.735, 0.027, metal, y);
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      box(
        root,
        0.035,
        0.72,
        0.035,
        metal,
        Math.cos(a) * 0.73,
        1.5,
        Math.sin(a) * 0.73,
      );
    }
    for (const side of [-1, 1]) {
      box(root, 0.09, 4.2, 0.09, metal, side * 0.74, 4.3);
      box(root, 0.34, 0.55, 0.035, dark, 0, 5.8, side * 0.724);
    }
    engine(root, 0, 0.18, 0, 1.25);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      bar(
        root,
        new T.Vector3(Math.cos(a) * 0.58, 1.4, Math.sin(a) * 0.58),
        new T.Vector3(Math.cos(a) * 0.18, 1.05, Math.sin(a) * 0.18),
        0.055,
        metal,
      );
    }
    // Cable raceways, access panels, fastening rings.
    for (const y of [2.4, 4.7, 6.3]) {
      box(root, 0.38, 0.3, 0.025, metal, 0, y, 0.733);
      for (const x of [-0.14, 0.14]) {
        const b = cyl(root, 0.023, 0.025, dark, x, y + 0.1, 0.754);
        b.rotation.x = Math.PI / 2;
      }
    }
    rig.height = 9.6;
    rig.radius = 2;
  } else {
    // Twelve fitted thermal blankets around a tapered bus. The folds affect the
    // silhouette as well as its normal map; seams remain attached to the chassis.
    const blanket = new T.CylinderGeometry(1.08, 1.17, 0.82, 192, 24);
    const positions = blanket.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i),
        y = positions.getY(i),
        z = positions.getZ(i);
      const radius = Math.hypot(x, z);
      if (radius < 0.1) continue;
      const angle = Math.atan2(x, z),
        panelAngle = Math.PI / 6;
      const local = ((angle + Math.PI * 2) % panelAngle) / panelAngle;
      const height = (y + 0.41) / 0.82;
      const wrinkle =
        Math.sin(local * Math.PI) *
        Math.sin(height * Math.PI) *
        (0.009 * Math.sin(local * 29 + height * 17) +
          0.006 * Math.sin(height * 41 - local * 13));
      const fitted =
        (radius * Math.cos(Math.PI / 12)) /
          Math.cos((local - 0.5) * panelAngle) +
        wrinkle;
      positions.setXYZ(i, (x / radius) * fitted, y, (z / radius) * fitted);
    }
    blanket.computeVertexNormals();
    add(root, blanket, gold, 0, 1.75);
    cyl(root, 1.1, 0.12, metal, 0, 2.2);
    cyl(root, 1.16, 0.13, dark, 0, 1.3);
    box(root, 1.22, 0.48, 1.08, white, 0, 2.48);
    box(root, 0.82, 0.12, 0.76, dark, 0, 2.78);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4,
        c = Math.cos(a),
        s = Math.sin(a);
      const foot = new T.Vector3(c * 2.1, 0.09, s * 2.1),
        top = new T.Vector3(c * 0.84, 1.94, s * 0.84);
      const footGroup = new T.Group();
      footGroup.position.copy(foot);
      root.add(footGroup);
      cyl(footGroup, 0.31, 0.1, dark, 0, 0);
      cyl(footGroup, 0.24, 0.045, metal, 0, 0.06);
      const origins = [
        top,
        new T.Vector3(c * 0.98, 1.36, s * 0.98),
        new T.Vector3(c * 0.74 - s * 0.3, 1.35, s * 0.74 + c * 0.3),
      ];
      const rods = origins.map((from, j) => ({
        mesh: bar(
          root,
          from,
          foot,
          j === 1 ? 0.095 : j === 0 ? 0.064 : 0.035,
          j === 1 ? white : j === 0 ? metal : gold,
        ),
        from,
        length: from.distanceTo(foot),
      }));
      rig.legs.push({ foot: footGroup, rods, x: foot.x, z: foot.z });
      engine(root, c * 0.64, 0.58, s * 0.64, 0.46);
      box(root, 0.34, 0.22, 0.3, dark, c * 1.05, 1.9, s * 1.05);
    }
    for (const x of [-1, 1]) panel(root, x * 1.62, 2.15, 0, 0.9, 1.28);
    dish(root, 0.38, 2.89, 0.25, 0.38);
    cyl(root, 0.025, 0.85, metal, -0.4, 2.9, -0.28);
    box(root, 0.32, 0.28, 0.21, dark, 0, 2.48, -0.64);
    cyl(root, 0.072, 0.08, glass, 0, 2.48, -0.78).rotation.x = Math.PI / 2;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      bolt(root, Math.cos(a) * 0.96, 2.28, Math.sin(a) * 0.96, 0.035);
    }
    rig.height = 3.45;
    rig.radius = 3.2;
  }
  // Original close-view mechanical detailing. All dimensions remain in scene metres.
  const cable = (
    points: number[][],
    radius = 0.014,
    mat: T.Material = black,
  ) => {
    const curve = new T.CatmullRomCurve3(
      points.map((p) => new T.Vector3(...(p as [number, number, number]))),
    );
    return add(root, new T.TubeGeometry(curve, 24, radius, 6, false), mat);
  };
  if (mode === "rover") {
    component = "chassis";
    // Looms, feedthroughs, machined instrument mounts and separate thermal panels.
    for (const side of [-1, 1]) {
      component="chassis";
      for (let lane = 0; lane < 3; lane++)
        cable(
          [
            [side * 0.7, 1.42, -0.7],
            [side * 0.62, 1.45, -0.2],
            [side * 0.76, 1.47, 0.45],
            [side * 0.61, 1.43, 1.1 + lane * 0.03],
          ],
          0.012,
          lane === 1 ? copper : black,
        );
      for (let panelIndex = 0; panelIndex < 4; panelIndex++) {
        const z = -0.87 + panelIndex * 0.57;
        box(root, 0.022, 0.29, 0.48, dark, side * 0.94, 1.04, z);
        box(root, 0.026, 0.245, 0.435, metal, side * 0.954, 1.04, z);
        for (const dy of [-0.1, 0.1])
          for (const dz of [-0.18, 0.18]) {
            const screw = cyl(
              root,
              0.019,
              0.017,
              black,
              side * 0.976,
              1.04 + dy,
              z + dz,
            );
            screw.rotation.z = Math.PI / 2;
          }
      }
      component = "sensors";
      // Front hazard-camera pair and protective lip.
      box(root, 0.23, 0.12, 0.12, metal, side * 0.56, 0.94, -1.26);
      const lens = cyl(root, 0.043, 0.025, glass, side * 0.56, 0.94, -1.34);
      lens.rotation.x = Math.PI / 2;
      box(root, 0.27, 0.023, 0.17, white, side * 0.56, 1.016, -1.28);
    }
    component = "mast";
    cable(
      [
        [0.42, 1.4, -0.8],
        [0.49, 1.57, -0.86],
        [0.49, 2.15, -0.86],
        [0.46, 2.35, -0.91],
      ],
      0.024,
    );
    for (let j = 0; j < 5; j++)
      box(root, 0.14, 0.018, 0.13, metal, 0.43, 1.65 + j * 0.11, -0.86);
    box(root, 0.48, 0.03, 0.32, dark, -0.22, 1.44, 0.25);
    for (let j = 0; j < 8; j++)
      box(root, 0.44, 0.06, 0.015, metal, -0.22, 1.48, 0.11 + j * 0.04);
    for (const w of rig.wheels) {
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4;
        const mesh = new T.Mesh(
          new T.CylinderGeometry(0.023, 0.023, 0.024, 6),
          black,
        );
        mesh.rotation.z = Math.PI / 2;
        mesh.position.set(
          Math.sign(w.x) * 0.205,
          Math.cos(angle) * 0.23,
          Math.sin(angle) * 0.23,
        );
        w.spin.add(mesh);
      }
    }
  } else if (mode === "launch") {
    // Access fasteners, thermal joints, intertank service ports and external conduits.
    for (const y of [1.95, 3.81, 6.82])
      for (let i = 0; i < 24; i++) {
        const a = (i * Math.PI) / 12;
        const screw = new T.Mesh(new T.SphereGeometry(0.018, 6, 5), dark);
        screw.position.set(Math.cos(a) * 0.739, y, Math.sin(a) * 0.739);
        root.add(screw);
      }
    for (let i = 0; i < 3; i++)
      cable(
        [
          [0.38 + i * 0.04, 1.2, 0.5],
          [0.43 + i * 0.04, 1.7, 0.58],
          [0.43 + i * 0.04, 2.4, 0.58],
          [0.4 + i * 0.04, 2.65, 0.55],
        ],
        0.018,
        metal,
      );
    for (const y of [2.8, 5.2]) {
      const port = cyl(root, 0.095, 0.025, dark, 0, y, 0.737);
      port.rotation.x = Math.PI / 2;
      const cap = cyl(root, 0.068, 0.028, metal, 0, y, 0.75);
      cap.rotation.x = Math.PI / 2;
    }
    for (let i = 0; i < 8; i++)
      box(
        root,
        0.09,
        0.43,
        0.015,
        dark,
        Math.sin((i * Math.PI) / 4) * 0.72,
        6.5,
        Math.cos((i * Math.PI) / 4) * 0.72,
      ).rotation.y = (i * Math.PI) / 4;
  } else if (mode === "descent") {
    // Thermal-blanket edge bindings, inspection plates and fasteners. These are
    // original visualization details, not a claimed flight-qualified assembly.
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6,
        x = Math.sin(a),
        z = Math.cos(a);
      bar(
        root,
        new T.Vector3(x * 1.17, 1.345, z * 1.17),
        new T.Vector3(x * 1.08, 2.155, z * 1.08),
        0.012,
        dark,
      );
      for (const y of [1.39, 2.11]) {
        const r = y < 1.7 ? 1.166 : 1.09;
        const stud = add(
          root,
          new T.SphereGeometry(0.022, 8, 6),
          metal,
          x * r,
          y,
          z * r,
        );
        stud.scale.y = 0.7;
      }
      const plateAngle = a + Math.PI / 12;
      const px = Math.sin(plateAngle),
        pz = Math.cos(plateAngle);
      const panel = box(
        root,
        0.2,
        0.075,
        0.016,
        white,
        px * 1.087,
        1.88,
        pz * 1.087,
      );
      panel.rotation.y = plateAngle;
      for (let j = 0; j < 3; j++) {
        const stripe = box(
          root,
          0.13 - j * 0.02,
          0.006,
          0.019,
          dark,
          px * 1.099,
          1.902 - j * 0.018,
          pz * 1.099,
        );
        stripe.rotation.y = plateAngle;
      }
    }
    // Raised avionics covers with recessed access seams, machined latches and
    // exposed radiator louvers break up the upper equipment deck.
    for (const side of [-1, 1]) {
      box(root, 0.026, 0.34, 0.85, dark, side * 0.616, 2.49, 0);
      box(root, 0.03, 0.3, 0.81, white, side * 0.634, 2.49, 0);
      for (const y of [2.36, 2.62])
        for (const z of [-0.36, 0.36]) {
          const head = cyl(root, 0.021, 0.018, metal, side * 0.655, y, z);
          head.rotation.z = Math.PI / 2;
        }
      for (let j = 0; j < 9; j++)
        box(
          root,
          0.052,
          0.2,
          0.019,
          dark,
          side * 0.66,
          2.49,
          -0.25 + j * 0.0625,
        );
      // Hinged solar-panel roots and the two visible cable connectors.
      cyl(root, 0.075, 0.4, dark, side * 1.16, 2.17).rotation.x = Math.PI / 2;
      for (const z of [-0.17, 0.17]) {
        const hinge = cyl(root, 0.09, 0.045, metal, side * 1.16, 2.17, z);
        hinge.rotation.x = Math.PI / 2;
        cable(
          [
            [side * 0.8, 2.25, z],
            [side * 1.1, 2.32, z],
            [side * 1.4, 2.21, z],
          ],
          0.014,
        );
      }
    }
    // Navigation optics have separate housing, retention ring and recessed glass.
    for (const x of [-0.29, 0.29]) {
      box(root, 0.2, 0.17, 0.08, metal, x, 2.48, -0.568);
      const barrel = cyl(root, 0.067, 0.085, dark, x, 2.48, -0.64);
      barrel.rotation.x = Math.PI / 2;
      const rim = cyl(root, 0.057, 0.014, metal, x, 2.48, -0.689);
      rim.rotation.x = Math.PI / 2;
      const optic = cyl(root, 0.043, 0.018, glass, x, 2.48, -0.699);
      optic.rotation.x = Math.PI / 2;
    }
    for (let i = 0; i < 24; i++) {
      const a = (i * Math.PI) / 12;
      bolt(root, Math.sin(a) * 1.045, 2.27, Math.cos(a) * 1.045, 0.018);
    }
    for (const side of [-1, 1]) {
      cable(
        [
          [side * 0.4, 2.3, 0.45],
          [side * 0.8, 2.25, 0.68],
          [side * 1.02, 1.9, 0.63],
          [side * 0.76, 1.28, 0.61],
        ],
        0.022,
        copper,
      );
      box(root, 0.36, 0.24, 0.04, metal, side * 0.39, 2.48, 0.56);
      for (let j = 0; j < 5; j++)
        box(root, 0.34, 0.016, 0.05, dark, side * 0.39, 2.39 + j * 0.045, 0.59);
    }
    for (const leg of rig.legs) {
      const top = new T.Vector3(leg.x * 0.4, 1.45, leg.z * 0.4),
        end = new T.Vector3(leg.x * 0.76, 0.52, leg.z * 0.76);
      bar(root, top, end, 0.08, metal);
      // Mount the landing-foot fasteners on the animated contact group.
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        bolt(leg.foot, Math.cos(a) * 0.18, 0.09, Math.sin(a) * 0.18, 0.014);
      }
      cyl(leg.foot, 0.11, 0.09, dark, 0, 0.13);
    }
  }
  if (mode === "rover") {
    component="chassis";
    // Fitted thermal blankets have real fold geometry as well as the foil normal map.
    for(const side of [-1,1]) {
      const blanket=new T.PlaneGeometry(2.2,.30,100,16);
      const v=blanket.getAttribute('position');
      for(let i=0;i<v.count;i++) {
        const u=v.getX(i),h=v.getY(i),envelope=Math.sin((h+.15)/.3*Math.PI);
        v.setZ(i,envelope*(Math.sin(u*31+h*39)*.007+Math.sin(u*17-h*51)*.004));
      }
      blanket.computeVertexNormals();const foilPanel=add(root,blanket,gold,side*.861,1.04,0);
      foilPanel.rotation.y=side*Math.PI/2;
      // Machined external frame with diagonal gussets and flanged corners.
      for(const y of [.82,1.26])bar(root,new T.Vector3(side*.89,y,-1.12),new T.Vector3(side*.89,y,1.12),.024,metal);
      for(let j=0;j<4;j++) {
        const z=-.88+j*.58;
        const plate=box(root,.028,.19,.17,metal,side*.916,1.07,z);
        for(const dz of [-.055,.055]) {
          const socket=cyl(root,.018,.012,black,side*.938,1.07,z+dz);socket.rotation.z=Math.PI/2;
        }
        bar(root,new T.Vector3(side*.91,.83,z-.19),new T.Vector3(side*.91,1.26,z+.16),.014,dark);
        plate.userData.component='chassis';
      }
    }
    // Recessed fasteners and a louvered avionics cover on the equipment deck.
    component="avionics";
    box(root,.65,.045,.72,dark,-.35,1.42,.1);
    box(root,.60,.06,.67,white,-.35,1.45,.1);
    for(let j=0;j<13;j++)box(root,.51,.012,.018,dark,-.35,1.485,-.17+j*.042);
    for(const x of [-.62,-.08])for(const z of [-.19,.39])bolt(root,x,1.49,z,.014);
    // Instrument arm: a stowed yoke, two flanged links and a close-up science turret.
    component="science";
    const science=root;
    const joints=[new T.Vector3(-.65,1.06,-1.16),new T.Vector3(-.62,.69,-1.55),new T.Vector3(.30,.61,-1.66)];
    for(let j=0;j<2;j++) {
      const a=joints[j],b=joints[j+1],mid=a.clone().add(b).multiplyScalar(.5);
      const link=box(science,.13,a.distanceTo(b),.13,white,mid.x,mid.y,mid.z);
      link.quaternion.setFromUnitVectors(up,b.clone().sub(a).normalize());
      for(const side of [-1,1]) {
        const rail=bar(science,a.clone().add(new T.Vector3(side*.07,0,0)),b.clone().add(new T.Vector3(side*.07,0,0)),.015,metal);
        rail.userData.component='science';
      }
      const bearing=cyl(science,.105,.17,dark,a.x,a.y,a.z);bearing.rotation.x=Math.PI/2;
      const cap=cyl(science,.075,.185,metal,a.x,a.y,a.z);cap.rotation.x=Math.PI/2;
    }
    const turret=new T.Group();turret.position.copy(joints[2]);science.add(turret);
    cyl(turret,.19,.18,white).rotation.x=Math.PI/2;
    for(let j=0;j<4;j++){
      const a=j*Math.PI/2;
      const optic=cyl(turret,.035,.05,j===0?glass:dark,Math.cos(a)*.12,Math.sin(a)*.12,-.12);optic.rotation.x=Math.PI/2;
    }
    // Lens barrels have stepped retaining rings and recessed coated optical elements.
    component="mast";
    for(const x of [-.22,.22]) {
      for(let j=0;j<4;j++){
        const barrel=cyl(mast,.085-j*.009,.018, j===3?glass:metal,x,1.12,-.208-j*.012);barrel.rotation.x=Math.PI/2;
      }
      for(let j=0;j<8;j++) {
        const a=j*Math.PI/4;const screw=cyl(mast,.009,.016,dark,x+Math.cos(a)*.102,1.12+Math.sin(a)*.102,-.17);screw.rotation.x=Math.PI/2;
      }
    }
    // Bellows, wiring clips and protective joint covers stay on the moving links.
    for(const arm of rig.arms.filter((_,i)=>i%2===0)) {
      const sleeve=new T.Mesh(new T.CylinderGeometry(.069,.069,.15,20),dark);sleeve.userData.component='suspension';arm.mesh.add(sleeve);
      for(let j=0;j<6;j++) {
        const ring=new T.Mesh(new T.TorusGeometry(.07,.008,6,20),metal);ring.rotation.x=Math.PI/2;ring.position.y=(j-2.5)*.025;ring.userData.component='suspension';arm.mesh.add(ring);
      }
    }
  }
  if (typeof CanvasRenderingContext2D !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, 768, 256);
      ctx.fillStyle = "#24302f";
      ctx.font = "500 120px sans-serif";
      ctx.fillText("E G I Z", 25, 135);
      ctx.font = "30px monospace";
      ctx.fillText(
        mode === "rover"
          ? "SURFACE SYSTEMS / R-01"
          : mode === "launch"
            ? "FLIGHT SYSTEMS / LV-01"
            : "EXPLORATION / D-01",
        30,
        205,
      );
      const texture = new T.CanvasTexture(canvas);
      texture.colorSpace = T.SRGBColorSpace;
      const decal = new T.Mesh(
        new T.PlaneGeometry(
          mode === "launch" ? 0.7 : 0.68,
          mode === "launch" ? 0.3 : 0.23,
        ),
        new T.MeshStandardMaterial({
          map: texture,
          transparent: true,
          roughness: 0.7,
          depthWrite: false,
        }),
      );
      if (mode === "rover") decal.position.set(0, 1.1, -1.181);
      else if (mode === "launch") decal.position.set(0, 4.8, -0.735);
      else decal.position.set(0, 2.48, 0.546);
      if (mode !== "descent") decal.rotation.y = Math.PI;
      if (mode !== "eva") root.add(decal);
      else {
        decal.geometry.dispose();
        (decal.material as T.Material).dispose();
        texture.dispose();
      }
    }
  }
  // Merge rigid meshes per material. Animated pivots remain separate.
  const dynamic = new Set([
    ...rig.arms.map((a) => a.mesh),
    ...rig.legs.flatMap((l) => l.rods.map((r) => r.mesh)),
  ]);
  function batch(group: T.Object3D) {
    for (const child of [...group.children])
      if (child instanceof T.Group || dynamic.has(child as T.Mesh)) batch(child);
    const groups = new Map<string, T.Mesh[]>();
    for (const child of group.children)
      if (
        child instanceof T.Mesh &&
        !dynamic.has(child) &&
        !Array.isArray(child.material)
      ) {
        const key = `${child.material.uuid}:${child.userData.component ?? "chassis"}`;
        const list = groups.get(key) ?? [];
        list.push(child);
        groups.set(key, list);
      }
    for (const meshes of groups.values()) {
      const mat=meshes[0].material as T.Material;
      if (meshes.length < 2) continue;
      const parts = meshes.map((m) => {
        m.updateMatrix();
        return (
          m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()
        ).applyMatrix4(m.matrix);
      });
      const merged = mergeGeometries(parts);
      parts.forEach((g) => g.dispose());
      if (merged) {
        const mesh = new T.Mesh(merged, mat);
        mesh.userData.component=meshes[0].userData.component;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        for (const m of meshes) {
          group.remove(m);
          m.geometry.dispose();
        }
      }
    }
  }
  if (mode === "rover") {
    const chassis = new T.Group();
    chassis.name = "chassis";
    const moving = new Set<T.Object3D>([mast, ...rig.wheels.map(w => w.steer), ...rig.arms.map(a => a.mesh)]);
    for (const child of [...root.children]) if (!moving.has(child)) chassis.add(child);
    root.add(chassis);
    rig.chassis = chassis;
    mast.name = "science-mast";
    rig.wheels.forEach((w, i) => w.steer.name = `wheel-${i+1}`);
    if (design) {
      chassis.position.y = design.wheelRadius - 0.41;
      mast.position.y += design.wheelRadius - 0.41;
      for (const w of rig.wheels) {
        w.x = Math.sign(w.x) * design.trackWidth / 2;
        w.z = Math.sign(w.z) * design.wheelbase / 2;
        w.steer.position.set(w.x, design.wheelRadius, w.z);
        w.spin.scale.set(design.wheelWidth / 0.33, design.wheelRadius / 0.41, design.wheelRadius / 0.41);
      }
      for (const a of rig.arms) {
        a.from.x *= design.trackWidth / 2.58;
        a.from.z *= design.wheelbase / 2.24;
        a.from.y += design.wheelRadius - 0.41;
      }
      rig.radius = Math.max(design.trackWidth / 2 + design.wheelWidth, design.wheelbase / 2 + design.wheelRadius) + 0.4;
      rig.height += design.wheelRadius - 0.41;
    }
  }
  batch(root);
  root.name = `EGIZ ${mode} engineering demonstrator`;
  return rig;
}

export function makeHabitat() {
  const group = new T.Group(),
    white = material("#d4d4c7", 0.4, 0.5),
    metal = material("#6a7276", 0.8, 0.3),
    dark = material("#20292e", 0.3, 0.6),
    solar = material("#142b43", 0.5, 0.4);
  const mesh = (
    geo: T.BufferGeometry,
    mat: T.Material,
    x: number,
    y: number,
    z: number,
  ) => {
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  const shell = mesh(new T.CylinderGeometry(1.7, 1.7, 6, 48), white, 0, 2.2, 0);
  shell.rotation.x = Math.PI / 2;
  for (const z of [-2.9, -2, -1, 0, 1, 2, 2.9]) {
    const rib = mesh(new T.TorusGeometry(1.71, 0.045, 8, 48), metal, 0, 2.2, z);
    rib.rotation.z = 0;
  }
  const hatch = mesh(
    new T.CylinderGeometry(0.85, 0.85, 0.12, 32),
    dark,
    0,
    2.2,
    -3.06,
  );
  hatch.rotation.x = Math.PI / 2;
  const window = mesh(
    new T.CylinderGeometry(0.4, 0.4, 0.13, 32),
    solar,
    0,
    2.4,
    -3.08,
  );
  window.rotation.x = Math.PI / 2;
  for (const x of [-1.25, 1.25])
    for (const z of [-2.2, 2.2])
      mesh(new T.CylinderGeometry(0.09, 0.12, 1.5, 16), metal, x, 0.75, z);
  for (const x of [-3.5, 3.5]) {
    mesh(new T.BoxGeometry(2.4, 0.08, 4), metal, x, 1.8, 0);
    mesh(new T.BoxGeometry(2.3, 0.03, 3.9), solar, x, 1.86, 0);
    for (let i = 0; i < 8; i++)
      mesh(
        new T.BoxGeometry(0.015, 0.04, 3.9),
        white,
        x - 1.1 + i * 0.3,
        1.89,
        0,
      );
  }
  return group;
}
