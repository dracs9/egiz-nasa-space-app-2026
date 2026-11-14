// Written with AI assistance (Codex); human review pending.
import { describe, expect, it, vi } from "vitest";
import * as T from "three";
import { defaultScenario } from "../environment";
import { simulate } from "../engine";
import type { MissionTerrain, TerrainBundle } from "../types";
import pilot from "../../../../data/pilot/mission_terrain.json";
import {
  headingAt,
  propulsion,
  replayFrame,
  surfacePose,
  terminalState,
} from "./replay";
import { makeVehicle } from "./vehicles";
const terrain = (pilot as TerrainBundle).entries.find(
  (t) => t.body === "mars",
)!;

describe("recorded-state visualization", () => {
  it("interpolates positions continuously without anticipating discrete ignition or mutating snapshots", () => {
    const s = defaultScenario(terrain, "launch");
    s.duration = 10;
    s.dt = 0.5;
    s.thrustProgram = [
      { time: 0, throttle: 0 },
      { time: 3.37, throttle: 1 },
      { time: 7.13, throttle: 0 },
    ];
    const r = simulate(s, terrain),
      before = JSON.stringify(r.frames);
    expect(replayFrame(r, 3.369).thrust).toBe(0);
    expect(replayFrame(r, 3.37).thrust).toBe(s.vehicle.thrust);
    expect(replayFrame(r, 7.129).thrust).toBe(s.vehicle.thrust);
    expect(replayFrame(r, 7.13).thrust).toBe(0);
    const a = r.frames.find((f) => f.t > 4)!,
      b = r.frames[r.frames.indexOf(a) + 1],
      f = replayFrame(r, (a.t + b.t) / 2);
    expect(f.elevation).toBeCloseTo((a.elevation + b.elevation) / 2, 9);
    expect(f.propellant).toBeCloseTo((a.propellant + b.propellant) / 2, 9);
    expect(JSON.stringify(r.frames)).toBe(before);
    expect(replayFrame(r, -4)).toBe(r.frames[0]);
    expect(replayFrame(r, 1e6)).toBe(r.frames.at(-1));
  });
  it("does not show propulsion after computed contact and preserves a failed touchdown", () => {
    const s = defaultScenario(terrain, "descent");
    s.vehicle.thrust = 0;
    s.vehicle.initialAltitude = 50;
    const r = simulate(s, terrain),
      f = r.frames.at(-1)!;
    expect(r.outcome).toBe("hard_landing");
    expect(terminalState(r, f.t - 0.01)).toBe("pending");
    expect(terminalState(r, f.t)).toBe("failure");
    expect(
      propulsion(
        { ...f, thrust: 24000 },
        { ...s, vehicle: { ...s.vehicle, thrust: 24000 } },
        r,
      ),
    ).toBe(0);
  });
  it("replaying backward recovers the same propulsion and wheel-distance inputs", () => {
    const s = defaultScenario(terrain, "launch");
    s.duration = 15;
    const r = simulate(s, terrain);
    const a = replayFrame(r, 4.25);
    replayFrame(r, 12);
    const b = replayFrame(r, 4.25);
    expect(a).toEqual(b);
    expect(propulsion(a, s, r)).toBe(propulsion(b, s, r));
    const rover = simulate(defaultScenario(terrain, "rover"), terrain);
    expect(replayFrame(rover, 200).distance).toBeGreaterThan(
      replayFrame(rover, 100).distance,
    );
    expect(
      Number.isFinite(
        headingAt(rover, 100, rover.scenario.start, rover.scenario.destination),
      ),
    ).toBe(true);
  });
  it("aligns rover pitch and roll to an analytical plane in every cardinal direction", () => {
    const t: MissionTerrain = {
      ...terrain,
      grid: {
        side: 5,
        cell_m: 10,
        west_m: -20,
        north_m: 20,
        valid_fraction: 1,
        elevation_m: Array.from({ length: 25 }, (_, i) => ((i % 5) - 2) * 2),
      },
    };
    expect(surfacePose(t, { x: 0, y: 0 }, 0).roll).toBeCloseTo(
      Math.atan(0.2),
      8,
    );
    expect(surfacePose(t, { x: 0, y: 0 }, -Math.PI / 2).pitch).toBeCloseTo(
      Math.atan(0.2),
      8,
    );
    expect(headingAt(null, 0, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(
      -Math.PI / 2,
    );
  });
});

describe("renderable original vehicle assemblies", () => {
  for (const mode of ["rover", "launch", "descent", "eva"] as const)
    it(`${mode} builds finite, batched geometry without geometry compatibility errors`, () => {
      const error = vi.spyOn(console, "error");
      const rig = makeVehicle(mode),
        bounds = new T.Box3().setFromObject(rig.root),
        size = bounds.getSize(new T.Vector3());
      expect(error).not.toHaveBeenCalled();
      expect(size.y).toBeGreaterThan(1.5);
      expect(size.y).toBeLessThan(15);
      expect(size.x).toBeGreaterThan(0.5);
      expect(size.x).toBeLessThan(8);
      let meshes = 0;
      rig.root.traverse((obj) => {
        if (obj instanceof T.Mesh) {
          meshes++;
          const p = obj.geometry.getAttribute("position");
          expect(Array.from(p.array).every(Number.isFinite)).toBe(true);
        }
      });
      expect(meshes).toBeLessThan(90);
      if (mode === "rover") expect(rig.wheels).toHaveLength(6);
      if (mode === "launch") expect(rig.engines).toHaveLength(1);
      if (mode === "descent") expect(rig.engines).toHaveLength(4);
      error.mockRestore();
    });
});
