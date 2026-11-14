// Written with AI assistance (Codex); human review pending.
import { expect, it } from "vitest";
import type { MissionTerrain, TerrainBundle } from "../types";
import pilot from "../../../../data/pilot/mission_terrain.json";
import { sampleTerrain } from "../terrain";
import {
  makeLocalSurface,
  surfaceTexture,
  triangulatedHeight,
} from "./environment";
function saddle(): MissionTerrain {
  return {
    ...(pilot as TerrainBundle).entries[0],
    grid: {
      side: 5,
      cell_m: 100,
      west_m: -200,
      north_m: 200,
      valid_fraction: 1,
      elevation_m: Array.from(
        { length: 25 },
        (_, i) => ((i % 5) - 2) * (Math.floor(i / 5) - 2) * 20,
      ),
    },
  };
}
it("uses the model surface at vehicle scale and joins the regional mesh without an edge step", () => {
  const terrain = saddle(),
    local = makeLocalSurface(terrain, 0, surfaceTexture());
  local.update({ x: 30, y: 30 }, true);
  const p = local.patch.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const point = {
      x: local.patch.position.x + p.getX(i),
      y: -local.patch.position.z - p.getZ(i),
    };
    if (Math.abs(p.getX(i)) < 55 && Math.abs(p.getZ(i)) < 55)
      expect(p.getY(i)).toBeCloseTo(sampleTerrain(terrain, point)! + 0.012, 4);
    if (Math.abs(p.getX(i)) === 90 || Math.abs(p.getZ(i)) === 90)
      expect(p.getY(i)).toBeCloseTo(
        triangulatedHeight(terrain, point)! + 0.012,
        4,
      );
  }
});
it("does not manufacture local faces across missing observations or beyond the measured footprint", () => {
  const terrain = saddle();
  terrain.grid.elevation_m[12] = null;
  const local = makeLocalSurface(terrain, 0, surfaceTexture());
  local.update({ x: 0, y: 0 }, true);
  expect(local.patch.geometry.index!.count).toBe(0);
  local.update({ x: 900, y: 900 }, true);
  expect(local.patch.geometry.index!.count).toBe(0);
  expect(triangulatedHeight(terrain, { x: 0, y: 0 })).toBeNull();
});
