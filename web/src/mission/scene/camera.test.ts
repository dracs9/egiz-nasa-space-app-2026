// Written with AI assistance (Codex); human review pending.
import { expect, it } from "vitest";
import { Box3, PerspectiveCamera, Vector3 } from "three";
import { fitRegionalCamera } from "./camera";

it("keeps a full 100 km flight and its terrain inside landscape and portrait views", () => {
  const bounds = new Box3(
    new Vector3(-10000, -200, -10000),
    new Vector3(10000, 100000, 10000),
  );
  for (const aspect of [0.45, 1, 1.9]) {
    const camera = new PerspectiveCamera(42, aspect, 10, 500000);
    const fit = fitRegionalCamera(bounds, camera.fov, aspect);
    camera.position.copy(fit.position);
    camera.lookAt(fit.target);
    camera.updateMatrixWorld();
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) {
          const projected = new Vector3(x, y, z).project(camera);
          expect(Math.abs(projected.x)).toBeLessThan(0.9);
          expect(Math.abs(projected.y)).toBeLessThan(0.9);
          expect(Math.abs(projected.z)).toBeLessThan(1);
        }
  }
});
