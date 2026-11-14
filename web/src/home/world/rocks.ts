// Boulder geometry: a subdivided icosphere shaped by fracture planes and noise, flattened where it rests.
// One mesh is instanced thousands of times; per-instance rotation and non-uniform scale give the variety.
// AI-assisted implementation; human review pending.
import * as THREE from 'three';

function hash(x: number, y: number, z: number) { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); }
function noise3(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z); const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = (t: number) => t * t * (3 - 2 * t); const ux = u(fx), uy = u(fy), uz = u(fz);
  let v = 0;
  for (let k = 0; k < 8; k++) {
    const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1;
    v += hash(ix + dx, iy + dy, iz + dz) * (dx ? ux : 1 - ux) * (dy ? uy : 1 - uy) * (dz ? uz : 1 - uz);
  }
  return v * 2 - 1;
}

export function makeRockGeometry() {
  const geo = new THREE.IcosahedronGeometry(1, 4);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  // A handful of random fracture planes cut the sphere into a blocky clast.
  const planes: { n: THREE.Vector3; d: number }[] = [];
  for (let i = 0; i < 14; i++) {
    const n = new THREE.Vector3(hash(i, 1, 2) * 2 - 1, (hash(i, 3, 4) * 2 - 1) * .8, hash(i, 5, 6) * 2 - 1).normalize();
    planes.push({ n, d: .48 + hash(i, 7, 8) * .3 });
  }
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let r = 1;
    for (const p of planes) { const k = v.dot(p.n); if (k > p.d) r = Math.min(r, p.d / k); }
    r *= 1 + .1 * noise3(v.x * 2.2, v.y * 2.2, v.z * 2.2) + .04 * noise3(v.x * 6, v.y * 6, v.z * 6) + .015 * noise3(v.x * 15, v.y * 15, v.z * 15);
    v.multiplyScalar(r);
    if (v.y < -.35) v.y = -.35 + (v.y + .35) * .25;               // a flat-ish base where it sits in the regolith
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  const indexed = geo.index ? geo : (() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', pos); return g; })();
  // non-indexed icosphere: merge coincident vertices so normals are smooth within facets but crisp at fractures
  const merged = mergeVertices(indexed);
  merged.computeVertexNormals();
  return merged;
}

function mergeVertices(g: THREE.BufferGeometry) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const map = new Map<string, number>(); const verts: number[] = []; const index: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    let id = map.get(key);
    if (id === undefined) { id = verts.length / 3; map.set(key, id); verts.push(pos.getX(i), pos.getY(i), pos.getZ(i)); }
    index.push(id);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  out.setIndex(index);
  return out;
}
