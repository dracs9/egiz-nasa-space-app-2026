// Written with AI assistance (Codex); human review pending.
import { Box3, MathUtils, Vector3 } from "three";

/** Fit all eight world-space corners inside a perspective view, including portrait layouts. */
export function fitRegionalCamera(bounds: Box3, fov: number, aspect: number) {
  const target = bounds.getCenter(new Vector3());
  const direction = new Vector3(0.8, 0.55, 0.95).normalize();
  const right = new Vector3()
    .crossVectors(new Vector3(0, 1, 0), direction)
    .normalize();
  const up = new Vector3().crossVectors(direction, right);
  const tanV = Math.tan(MathUtils.degToRad(fov / 2));
  const tanH = tanV * Math.max(0.1, aspect);
  let distance = 1;
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z]) {
        const p = new Vector3(x, y, z).sub(target);
        distance = Math.max(
          distance,
          Math.abs(p.dot(right)) / tanH + p.dot(direction),
          Math.abs(p.dot(up)) / tanV + p.dot(direction),
        );
      }
  return {
    target,
    position: target.clone().addScaledVector(direction, distance * 1.22),
  };
}

/** Repeatable cinematic framing: a seek to the same mission time has the same target pose. */
export function cinematicAngle(time: number, surface: boolean) {
  return 0.5 + Math.max(0, time) * (surface ? 0.0015 : 0.015);
}
