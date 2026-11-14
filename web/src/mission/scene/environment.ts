// Written with AI assistance (Codex); human review pending.
// Decorative microtexture/rocks are explicitly illustrative, never terrain observations or collision inputs.
import * as T from "three";
import { cellPoint, sampleTerrain, slopeAt } from "../terrain";
import type { MissionTerrain, Point, Scenario } from "../types";
import { drivetrain } from "../mobility";

function engineeringColor(terrain:MissionTerrain,p:Point,s:Scenario,color:T.Color) {
  const slope=slopeAt(terrain,p);
  if(slope===null){color.set("#41484b");return;}
  const drive=drivetrain(s,slope*Math.PI/180,slope);
  const allowed=drive.admissible && slope<=s.rover.maxSlope &&
    Math.tan(slope*Math.PI/180)+s.rover.rollingResistance<=s.rover.traction;
  color.set(allowed ? (drive.motorUtilization>.7?"#bda064":"#598e79") : "#a4483f");
}

export const PALETTES = {
  mars: {
    ground: "#95694e",
    rock: "#68554a",
    sky: "#655047",
    horizon: "#ad8b70",
    sun: "#ffe1bd",
    ambient: "#bbc0c5",
  },
  moon: {
    ground: "#85868a",
    rock: "#64666a",
    sky: "#030509",
    horizon: "#030509",
    sun: "#fff6e4",
    ambient: "#9caab9",
  },
  earth: {
    ground: "#80745a",
    rock: "#54534b",
    sky: "#3b657c",
    horizon: "#b1bcb5",
    sun: "#fff0d4",
    ambient: "#c3dbea",
  },
};
function noise(x: number, y: number) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}
export function surfaceTexture() {
  const size = 256,
    data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const a = noise(x, y),
        b = noise(x >> 2, y >> 2),
        c = noise(x >> 4, y >> 4);
      const v = 150 + a * 70 + b * 24 + c * 10;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  const map = new T.DataTexture(data, size, size, T.RGBAFormat);
  map.wrapS = map.wrapT = T.RepeatWrapping;
  map.repeat.set(1, 1);
  map.needsUpdate = true;
  map.generateMipmaps = true;
  map.minFilter = T.LinearMipmapLinearFilter;
  map.magFilter = T.LinearFilter;
  return map;
}
export function makeTerrain(
  terrain: MissionTerrain,
  datum: number,
  layer: string,
  exaggeration: number,
  scenario?: Scenario,
) {
  const g = terrain.grid,
    positions: number[] = [],
    colors: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const heights = g.elevation_m.filter((z): z is number => z !== null),
    low = Math.min(...heights),
    high = Math.max(...heights);
  const base = new T.Color(PALETTES[terrain.body].ground),
    color = new T.Color();
  for (let i = 0; i < g.elevation_m.length; i++) {
    const p = cellPoint(terrain, i),
      h = g.elevation_m[i] ?? datum,
      ratio = (h - low) / Math.max(1, high - low);
    positions.push(p.x, (h - datum) * exaggeration, -p.y);
    uvs.push(p.x / 8, -p.y / 8);
    if(layer === "mobility" && scenario?.rover.design) engineeringColor(terrain,p,scenario,color);
    else if (layer === "slope") {
      const s = slopeAt(terrain, p) ?? 0;
      color.setHSL(
        0.47 - Math.min(s / 35, 1) * 0.45,
        0.5,
        0.27 + Math.min(s / 35, 1) * 0.2,
      );
    } else if (layer === "elevation")
      color.setHSL(0.1 - ratio * 0.09, 0.3, 0.25 + ratio * 0.37);
    else color.copy(base).multiplyScalar(0.82 + 0.27 * ratio);
    colors.push(color.r, color.g, color.b);
  }
  for (let r = 0; r < g.side - 1; r++)
    for (let c = 0; c < g.side - 1; c++) {
      const a = r * g.side + c,
        b = a + 1,
        d = a + g.side,
        e = d + 1;
      if ([a, b, d, e].every((i) => g.elevation_m[i] !== null))
        indices.push(a, d, b, b, d, e);
    }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const texture = surfaceTexture();
  const material = new T.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    map: texture,
    bumpMap: texture,
    bumpScale: 0.045,
    side: T.DoubleSide,
  });
  const mesh = new T.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return { mesh, texture, low, high };
}
// Close-range patch samples the exact same bilinear measured surface as terrain queries.
// Its central 110 m matches the bilinear model; the outer strip blends to the existing mesh triangles to avoid seams.
export function makeLocalSurface(
  terrain: MissionTerrain,
  datum: number,
  texture: T.Texture,
  layer = "surface",
  route: Point[] = [],
  scenario?: Scenario,
) {
  const size = 180,
    divisions = 60,
    geometry = new T.PlaneGeometry(size, size, divisions, divisions);
  geometry.rotateX(-Math.PI / 2);
  const material = new T.MeshStandardMaterial({
    color: layer === "surface" ? PALETTES[terrain.body].ground : "#ffffff",
    vertexColors: true,
    roughness: 1,
    map: texture,
    bumpMap: texture,
    bumpScale: 0.04,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const originalIndices = Array.from(geometry.index!.array),
    vertexColors = new Float32Array(geometry.attributes.position.count * 3);
  geometry.setAttribute("color", new T.BufferAttribute(vertexColors, 3));
  const color = new T.Color();
  const heights = terrain.grid.elevation_m.filter(
      (z): z is number => z !== null,
    ),
    low = Math.min(...heights),
    high = Math.max(...heights);
  const nearRoute = (p: Point) =>
    route.some((b, i) => {
      const a = route[Math.max(0, i - 1)],
        dx = b.x - a.x,
        dy = b.y - a.y,
        t = Math.max(
          0,
          Math.min(
            1,
            ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
          ),
        );
      return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) < 3.5;
    });
  const patch = new T.Mesh(geometry, material);
  patch.receiveShadow = true;
  patch.frustumCulled = false;
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < uv.count; i++)
    uv.setXY(i, (uv.getX(i) * size) / 8, (uv.getY(i) * size) / 8);
  uv.needsUpdate = true;
  const rockGeo = new T.IcosahedronGeometry(1, 1),
    verts = rockGeo.getAttribute("position");
  for (let i = 0; i < verts.count; i++) {
    const x = verts.getX(i),
      y = verts.getY(i),
      z = verts.getZ(i),
      v = 0.78 + noise(x * 11, z * 19) * 0.3;
    verts.setXYZ(i, x * v, y * v * 0.65, z * v);
  }
  rockGeo.computeVertexNormals();
  const rocks = new T.InstancedMesh(
    rockGeo,
    new T.MeshStandardMaterial({
      color: PALETTES[terrain.body].rock,
      roughness: 1,
      map: texture,
      bumpMap: texture,
      bumpScale: 0.025,
    }),
    160,
  );
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  rocks.frustumCulled = false;
  const obj = new T.Object3D();
  let lastX = Infinity,
    lastY = Infinity;
  const update = (p: Point, force = false) => {
    if (!force && Math.hypot(p.x - lastX, p.y - lastY) < 3) return;
    const x = Math.round(p.x / 3) * 3,
      y = Math.round(p.y / 3) * 3;
    lastX = x;
    lastY = y;
    patch.position.set(x, 0, -y);
    const pos = geometry.getAttribute("position");
    const valid: boolean[] = [];
    for (let i = 0; i < pos.count; i++) {
      const p = { x: x + pos.getX(i), y: y - pos.getZ(i) },
        h = sampleTerrain(terrain, p);
      valid.push(h !== null);
      const edge = Math.max(Math.abs(pos.getX(i)), Math.abs(pos.getZ(i))),
        blend = T.MathUtils.smoothstep(edge, 55, 90);
      const coarse = triangulatedHeight(terrain, p) ?? h ?? datum;
      pos.setY(i, (h ?? datum) * (1 - blend) + coarse * blend - datum + 0.012);
      uv.setXY(i, p.x / 8, -p.y / 8);
      if(layer === "mobility" && scenario?.rover.design) engineeringColor(terrain,p,scenario,color);
      else if (layer === "slope") {
        const slope = slopeAt(terrain, p) ?? 0;
        color.setHSL(
          0.47 - Math.min(slope / 35, 1) * 0.45,
          0.5,
          0.27 + Math.min(slope / 35, 1) * 0.2,
        );
      } else if (layer === "surface")
        color.setScalar(
          0.82 + (0.27 * ((h ?? low) - low)) / Math.max(1, high - low),
        );
      else
        color.setHSL(
          0.1 - (((h ?? low) - low) / Math.max(1, high - low)) * 0.09,
          0.3,
          0.25 + (((h ?? low) - low) / Math.max(1, high - low)) * 0.37,
        );
      vertexColors.set([color.r, color.g, color.b], i * 3);
    }
    const indices: number[] = [];
    for (let i = 0; i < originalIndices.length; i += 3)
      if (
        valid[originalIndices[i]] &&
        valid[originalIndices[i + 1]] &&
        valid[originalIndices[i + 2]]
      )
        indices.push(
          originalIndices[i],
          originalIndices[i + 1],
          originalIndices[i + 2],
        );
    geometry.setIndex(indices);
    geometry.attributes.color.needsUpdate = true;
    uv.needsUpdate = true;
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
    // World-anchored cells keep rocks fixed while traversing; no airborne/wind animation.
    const cellX = Math.floor(x / 12),
      cellY = Math.floor(y / 12);
    for (let i = 0; i < 160; i++) {
      const cx = cellX + (i % 13) - 6,
        cy = cellY + Math.floor(i / 13) - 6;
      const rx = cx * 12 + noise(cx, cy) * 9,
        ry = cy * 12 + noise(cy, cx) * 9;
      const h = sampleTerrain(terrain, { x: rx, y: ry });
      const r = 0.12 + Math.pow(noise(cx + 7, cy), 3) * 0.8;
      obj.position.set(rx, (h ?? datum) - datum + r * 0.13, -ry);
      obj.rotation.set(
        noise(cx, 2) * 0.4,
        noise(cx, cy) * 6.28,
        noise(cy, 3) * 0.3,
      );
      // Keep the fixed planned corridor clear: scenery does not create unmodeled collision hazards.
      const visible = h !== null && !nearRoute({ x: rx, y: ry });
      obj.scale.set(visible ? r : 0, visible ? r : 0, visible ? r * 1.3 : 0);
      obj.updateMatrix();
      rocks.setMatrixAt(i, obj.matrix);
    }
    rocks.instanceMatrix.needsUpdate = true;
  };
  return { patch, rocks, update };
}
export function makeSky(body: MissionTerrain["body"]) {
  const p = PALETTES[body];
  const sky = new T.Mesh(
    new T.SphereGeometry(1, 24, 16),
    new T.ShaderMaterial({
      side: T.BackSide,
      depthWrite: false,
      uniforms: {
        zenith: { value: new T.Color(p.sky) },
        horizon: { value: new T.Color(p.horizon) },
      },
      vertexShader:
        "varying vec3 vDirection; void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
      fragmentShader:
        "varying vec3 vDirection;uniform vec3 zenith;uniform vec3 horizon;void main(){float h=pow(clamp(normalize(vDirection).y,0.,1.),.45);gl_FragColor=vec4(mix(horizon,zenith,h),1.); \n #include <tonemapping_fragment> \n #include <colorspace_fragment> \n }",
    }),
  );
  sky.renderOrder = -10;
  sky.scale.setScalar(180000);
  sky.frustumCulled = false;
  return sky;
}
export function makePlume() {
  const g = new T.Group();
  // Smooth tapered plume, no unsupported shock diamonds or asserted combustion chemistry.
  for (let i = 0; i < 3; i++) {
    const geo = new T.ConeGeometry(0.29 + i * 0.09, 1, 32, 1, true);
    geo.translate(0, 0.5, 0);
    geo.rotateZ(Math.PI);
    const mat = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
      blending: T.AdditiveBlending,
      uniforms: {
        power: { value: 0 },
        clock: { value: 0 },
        tint: {
          value: new T.Color(
            i === 0 ? "#e9f5ff" : i === 1 ? "#9abaff" : "#e8a66b",
          ),
        },
        opacity: { value: 0.6 - i * 0.16 },
      },
      vertexShader:
        "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
      fragmentShader:
        "varying vec2 vUv;uniform float power;uniform float clock;uniform float opacity;uniform vec3 tint;void main(){float edge=pow(sin(vUv.x*3.14159265),2.);float fade=pow(1.-vUv.y,.7);float bands=.8+.2*sin(vUv.y*48.-clock*21.);gl_FragColor=vec4(tint,edge*fade*opacity*power*bands);}",
    });
    const mesh = new T.Mesh(geo, mat);
    mesh.scale.set(1 + i * 0.15, 1 + i * 0.6, 1 + i * 0.15);
    g.add(mesh);
  }
  return {
    group: g,
    update: (power: number, time: number, expansion: number) => {
      g.visible = power > 0;
      g.scale.set(
        0.65 + expansion * 0.3,
        1 + power * 6,
        0.65 + expansion * 0.3,
      );
      for (const c of g.children) {
        const m = (c as T.Mesh).material as T.ShaderMaterial;
        m.uniforms.power.value = power;
        m.uniforms.clock.value = time;
      }
    },
  };
}

export function makeDisturbance(body: MissionTerrain["body"]) {
  const data = new Float32Array(96 * 3),
    geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.BufferAttribute(data, 3));
  const material = new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      tint: { value: new T.Color(body === "moon" ? "#a8a8a1" : "#ae8666") },
      opacity: { value: 0 },
    },
    vertexShader:
      "void main(){vec4 p=modelViewMatrix*vec4(position,1.);gl_PointSize=clamp(160./max(.1,-p.z),1.,25.);gl_Position=projectionMatrix*p;}",
    fragmentShader:
      "uniform vec3 tint;uniform float opacity;void main(){float r=length(gl_PointCoord-.5)*2.;if(r>1.)discard;gl_FragColor=vec4(tint,pow(1.-r,2.)*opacity);}",
  });
  const points = new T.Points(geometry, material);
  points.frustumCulled = false;
  return {
    points,
    update: (time: number, strength: number, gravity: number) => {
      points.visible = strength > 0.001;
      material.uniforms.opacity.value = 0.24 * Math.min(1, strength);
      for (let i = 0; i < 96; i++) {
        const age = (time * 0.7 + i * 0.6180339) % 1,
          angle = i * 2.39996;
        const lift = 0.35 + strength * 0.8,
          life = (2 * lift) / Math.max(0.1, gravity),
          t = age * life;
        const r = 1.1 + age * (2 + strength * 6);
        data[i * 3] = Math.cos(angle) * r;
        data[i * 3 + 1] = Math.max(0, lift * t - gravity * t * t * 0.5) + 0.06;
        data[i * 3 + 2] = Math.sin(angle) * r;
      }
      geometry.attributes.position.needsUpdate = true;
    },
  };
}

// Same triangle split as the measured regional mesh. Used only to join the detail patch at its edge.
export function triangulatedHeight(
  terrain: MissionTerrain,
  p: Point,
): number | null {
  const g = terrain.grid,
    col = (p.x - g.west_m) / g.cell_m,
    row = (g.north_m - p.y) / g.cell_m;
  if (col < 0 || row < 0 || col > g.side - 1 || row > g.side - 1) return null;
  const c = Math.min(g.side - 2, Math.floor(col)),
    r = Math.min(g.side - 2, Math.floor(row)),
    i = r * g.side + c;
  const a = g.elevation_m[i],
    b = g.elevation_m[i + 1],
    d = g.elevation_m[i + g.side],
    e = g.elevation_m[i + g.side + 1];
  if (a === null || b === null || d === null || e === null) return null;
  const u = col - c,
    v = row - r;
  return u + v <= 1
    ? a + u * (b - a) + v * (d - a)
    : e + (1 - u) * (d - e) + (1 - v) * (b - e);
}
