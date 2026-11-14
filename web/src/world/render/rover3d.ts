// Parametric rover model built from the RoverProfile dimensions (EGIZ scenario asset, true scale).
// Geometry is a design visualization; the physics uses only the profile parameters.
import * as T from 'three';
import type { RoverProfile } from '../sim/rover';
import { wheelContacts } from '../sim/rover';

export interface RoverModel { root: T.Group; body: T.Group; wheels: T.Group[]; profile: RoverProfile; dispose(): void }

const mat = (color: string, metalness: number, roughness: number) => new T.MeshStandardMaterial({ color, metalness, roughness });

export function buildRover(profile: RoverProfile): RoverModel {
  const root = new T.Group(), body = new T.Group();
  root.name = `rover:${profile.id}`;
  const white = mat('#d9d7cf', 0.1, 0.55), dark = mat('#2a2d31', 0.5, 0.5), metal = mat('#9aa3aa', 0.85, 0.35), cell = mat('#16233f', 0.6, 0.25), gold = mat('#b8975a', 0.9, 0.35);
  const L = profile.wheelbaseM + profile.wheelRadiusM * 1.2, W = profile.trackWidthM - profile.wheelWidthM * 1.4;
  const chassisH = 0.32, chassisY = profile.wheelRadiusM + profile.groundClearanceM * 0.5 + chassisH / 2;
  const chassis = new T.Mesh(new T.BoxGeometry(L, chassisH, W), white); chassis.position.y = chassisY; body.add(chassis);
  const deck = new T.Mesh(new T.BoxGeometry(L * 0.9, 0.04, W * 0.92), gold); deck.position.y = chassisY + chassisH / 2 + 0.02; body.add(deck);
  // Vertical solar panels per profile (rover frame: +X forward, +Z left in three local space).
  const panelH = Math.max(0.6, profile.panelCentreHeightM * 0.9);
  for (const p of profile.panels) {
    const width = p.areaM2 / panelH;
    const panel = new T.Mesh(new T.BoxGeometry(width, panelH, 0.03), cell);
    const yaw = p.normalYawDeg * Math.PI / 180;
    const off = p.name === 'rear' ? L / 2 + 0.02 : W / 2 + 0.02;
    panel.position.set(Math.cos(yaw) * off, chassisY + chassisH / 2 + panelH / 2 + 0.05, -Math.sin(yaw) * off);
    panel.rotation.y = yaw - Math.PI / 2;
    body.add(panel);
  }
  // Mast with camera head and a high-gain antenna.
  const mastTop = profile.mastHeightM;
  const mast = new T.Mesh(new T.CylinderGeometry(0.035, 0.045, mastTop - chassisY, 12), metal);
  mast.position.set(L * 0.32, (mastTop + chassisY) / 2, 0); body.add(mast);
  const head = new T.Mesh(new T.BoxGeometry(0.18, 0.14, 0.42), dark); head.position.set(L * 0.32, mastTop, 0); body.add(head);
  for (const z of [-0.13, 0.13]) { const lens = new T.Mesh(new T.CylinderGeometry(0.035, 0.035, 0.05, 16), metal); lens.rotation.z = Math.PI / 2; lens.position.set(L * 0.32 + 0.1, mastTop, z); body.add(lens); }
  const dish = new T.Mesh(new T.SphereGeometry(0.22, 24, 12, 0, Math.PI * 2, 0, Math.PI / 3.2), white); dish.position.set(-L * 0.25, chassisY + chassisH / 2 + 0.55, -W * 0.25); dish.rotation.x = -0.9; body.add(dish);
  const dishPole = new T.Mesh(new T.CylinderGeometry(0.025, 0.025, 0.5, 8), metal); dishPole.position.set(-L * 0.25, chassisY + chassisH / 2 + 0.28, -W * 0.25); body.add(dishPole);
  root.add(body);
  // Wheels with grousers at the exact contact layout used by the simulator.
  const wheels: T.Group[] = [];
  const rimGeo = new T.CylinderGeometry(profile.wheelRadiusM, profile.wheelRadiusM, profile.wheelWidthM, 32, 1, true);
  const hubGeo = new T.CylinderGeometry(profile.wheelRadiusM * 0.35, profile.wheelRadiusM * 0.35, profile.wheelWidthM * 1.05, 16);
  const grouserGeo = new T.BoxGeometry(0.02, profile.wheelWidthM, 0.03);
  for (const [fx, fy] of wheelContacts(profile)) {
    const steer = new T.Group(), spin = new T.Group();
    steer.position.set(fx, profile.wheelRadiusM, -fy);
    const rim = new T.Mesh(rimGeo, metal); rim.rotation.x = Math.PI / 2; spin.add(rim);
    const hub = new T.Mesh(hubGeo, dark); hub.rotation.x = Math.PI / 2; spin.add(hub);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, g = new T.Mesh(grouserGeo, dark);
      g.position.set(Math.cos(a) * profile.wheelRadiusM, Math.sin(a) * profile.wheelRadiusM, 0); g.rotation.z = a; g.rotation.x = Math.PI / 2;
      spin.add(g);
    }
    steer.add(spin); root.add(steer); wheels.push(spin);
    const strut = new T.Mesh(new T.BoxGeometry(0.06, chassisY - profile.wheelRadiusM, 0.06), metal);
    strut.position.set(fx, (chassisY + profile.wheelRadiusM) / 2, -fy * 0.85); body.add(strut);
  }
  root.traverse(o => { if ((o as T.Mesh).isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return {
    root, body, wheels, profile,
    dispose() { root.traverse(o => { const m = o as T.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as T.Material).dispose(); } }); },
  };
}
