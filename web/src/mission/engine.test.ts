import { describe, expect, it } from "vitest";
import { defaultScenario, ENVIRONMENTS, G0 } from "./environment";
import { frameAt, simulate, validateScenario } from "./engine";
import {
  cellPoint,
  lineOfSight,
  sampleTerrain,
  slopeAt,
  validateTerrain,
} from "./terrain";
import { planRoute } from "./routing";
import { parseExperiment, report, verifyImportedTerrain } from "./storage";
import type { MissionTerrain, Scenario, TerrainBundle } from "./types";
import pilot from "../../../data/pilot/mission_terrain.json";
import results from "../../../data/pilot/results.json";

function flat(
  body: MissionTerrain["body"] = "moon",
  gradient = 0,
): MissionTerrain {
  return {
    id: "REFERENCE",
    name: "Analytical reference plane (synthetic test only)",
    body,
    lon: 0,
    lat: 0,
    source: {
      url: "https://example.org/analytical-test",
      sha256: "a".repeat(64),
      native_crs: "test",
    },
    local_crs: "test metres",
    local_origin: [0, 0],
    source_pixel_m: 200,
    grid: {
      side: 31,
      cell_m: 200,
      west_m: -3000,
      north_m: 3000,
      valid_fraction: 1,
      elevation_m: Array.from(
        { length: 961 },
        (_, i) => ((i % 31) - 15) * 200 * gradient,
      ),
    },
  };
}
function descent(t: MissionTerrain): Scenario {
  const s = defaultScenario(t, "descent");
  s.start = { x: 0, y: 0 };
  s.destination = { x: 1000, y: 0 };
  s.environment.density = 0;
  s.vehicle.thrust = 0;
  s.vehicle.initialAltitude = 1000;
  s.vehicle.initialVelocity = 0;
  s.duration = 10;
  return s;
}
describe("flight numerical benchmarks", () => {
  it("splits at off-grid throttle changes and matches integrated impulse and rocket-equation velocity", () => {
    const t = flat(),
      s = defaultScenario(t, "launch");
    s.duration = 12;
    s.dt = 0.5;
    s.thrustProgram = [
      { time: 0, throttle: 1 },
      { time: 3.37, throttle: 0.25 },
      { time: 7.13, throttle: 0 },
    ];
    const run = simulate(s, t);
    const used =
      (s.vehicle.thrust * (3.37 + (7.13 - 3.37) * 0.25)) / (s.vehicle.isp * G0);
    const mass = s.vehicle.dryMass + s.vehicle.fuel;
    expect(run.metrics.fuelUsed).toBeCloseTo(used, 9);
    expect(run.frames.at(-1)!.verticalSpeed).toBeCloseTo(
      s.vehicle.isp * G0 * Math.log(mass / (mass - used)) - 1.62 * s.duration,
      6,
    );
    expect(
      run.events.filter((e) => e.type === "Throttle change").map((e) => e.t),
    ).toEqual([3.37, 7.13]);
    expect(run.frames.find((f) => f.t === 7.13)!.thrust).toBe(0);
  });
  it("holds a delayed ignition on the pad without consuming fuel", () => {
    const t = flat(),
      s = defaultScenario(t, "launch");
    s.duration = 6;
    s.dt = 0.5;
    s.thrustProgram = [
      { time: 0, throttle: 0 },
      { time: 2.35, throttle: 1 },
    ];
    const run = simulate(s, t);
    expect(
      run.frames
        .filter((f) => f.t <= 2.35)
        .every((f) => f.propellant === s.vehicle.fuel && f.altitude === 0),
    ).toBe(true);
    expect(run.events.find((e) => e.type === "Liftoff")!.t).toBe(2.35);
    expect(run.metrics.fuelUsed).toBeCloseTo(
      (s.vehicle.thrust * (6 - 2.35)) / (s.vehicle.isp * G0),
      9,
    );
  });
  it("rejects unordered, out-of-range and empty launch programs", () => {
    const t = flat(),
      s = defaultScenario(t, "launch");
    for (const thrustProgram of [
      [],
      [{ time: 1, throttle: 1 }],
      [{ time: 0, throttle: 1.1 }],
      [
        { time: 0, throttle: 1 },
        { time: 0, throttle: 0 },
      ],
    ])
      expect(
        validateScenario({ ...s, thrustProgram }, t).length,
      ).toBeGreaterThan(0);
    const original = simulate(s, t);
    expect(
      simulate({ ...s, thrustProgram: [{ time: 0, throttle: 1 }] }, t).frames,
    ).toEqual(original.frames);
  });
  it("matches the analytic vacuum ballistic trajectory to floating point precision", () => {
    const t = flat(),
      s = descent(t),
      run = simulate(s, t),
      end = run.frames.at(-1)!;
    expect(end.altitude).toBeCloseTo(1000 - 0.5 * 1.62 * 100, 9);
    expect(end.verticalSpeed).toBeCloseTo(-1.62 * 10, 10);
    expect(end.propellant).toBe(s.vehicle.fuel);
  });
  it("locates a zero-thrust ground intersection analytically", () => {
    const t = flat(),
      s = descent(t);
    s.duration = 80;
    const run = simulate(s, t);
    expect(run.outcome).toBe("hard_landing");
    expect(run.metrics.duration).toBeCloseTo(Math.sqrt(2000 / 1.62), 7);
    expect(run.metrics.touchdownSpeed).toBeCloseTo(Math.sqrt(2000 * 1.62), 7);
    expect(run.frames.at(-1)!.altitude).toBe(0);
  });
  it("matches the ideal rocket equation minus gravity loss, including exact burnout", () => {
    const t = flat(),
      s = defaultScenario(t, "launch");
    s.start = { x: 0, y: 0 };
    s.vehicle.fuel = 43;
    s.vehicle.thrust = 24000;
    const burn = (s.vehicle.fuel * s.vehicle.isp * G0) / s.vehicle.thrust;
    s.duration = burn;
    s.dt = 0.07;
    const run = simulate(s, t),
      expected =
        s.vehicle.isp *
          G0 *
          Math.log((s.vehicle.dryMass + 43) / s.vehicle.dryMass) -
        1.62 * burn;
    expect(run.frames.at(-1)!.verticalSpeed).toBeCloseTo(expected, 7);
    expect(run.metrics.fuelUsed).toBeCloseTo(43, 10);
    expect(
      run.frames.every((f) => f.propellant >= 0 && f.mass >= s.vehicle.dryMass),
    ).toBe(true);
    expect(run.events.some((e) => e.type === "Propellant depleted")).toBe(true);
  });
  it("has lower speed with atmospheric drag than the identical vacuum descent", () => {
    const t = flat("earth"),
      s = descent(t);
    s.vehicle.area = 30;
    s.vehicle.cd = 1.5;
    const vacuum = simulate(s, t);
    s.environment.density = 1.225;
    const air = simulate(s, t);
    expect(air.metrics.maxSpeed).toBeLessThan(vacuum.metrics.maxSpeed);
    expect(air.metrics.maxQ).toBeGreaterThan(0);
  });
  it("converges under timestep refinement for smooth drag dynamics", () => {
    const t = flat("earth"),
      s = descent(t);
    s.environment.density = 1.225;
    s.vehicle.area = 30;
    s.vehicle.cd = 1.5;
    s.duration = 12;
    const end = (dt: number) =>
      simulate({ ...s, dt }, t).frames.at(-1)!.altitude;
    const reference = end(0.01),
      coarse = Math.abs(end(0.5) - reference),
      fine = Math.abs(end(0.25) - reference);
    expect(fine).toBeLessThan(coarse / 8);
    expect(fine).toBeLessThan(0.001);
  });
  it("calculates meaningfully different flights for Earth, Moon and Mars", () => {
    const heights = (["earth", "moon", "mars"] as const).map((body) => {
      const t = flat(body),
        s = defaultScenario(t, "launch");
      s.duration = 20;
      return simulate(s, t).metrics.maxAltitude;
    });
    expect(heights[1]).toBeGreaterThan(heights[2]);
    expect(heights[2]).toBeGreaterThan(heights[0]);
  });
  it("keeps an underpowered launch on its pad until burnout", () => {
    const t = flat("earth"),
      s = defaultScenario(t, "launch");
    s.vehicle.thrust = 100;
    s.vehicle.fuel = 1;
    s.duration = 60;
    const run = simulate(s, t);
    expect(run.outcome).toBe("no_liftoff");
    expect(run.metrics.maxAltitude).toBe(0);
    expect(run.metrics.fuelUsed).toBeCloseTo(1, 10);
  });
  it("lands under the explicit speed and slope limits on a flat lunar reference", () => {
    const t = flat(),
      s = defaultScenario(t, "descent");
    s.start = { x: 0, y: 0 };
    s.duration = 180;
    const run = simulate(s, t);
    expect(run.outcome).toBe("soft_landing");
    expect(run.metrics.touchdownSpeed).toBeLessThan(s.vehicle.safeSpeed);
  });
  it("classifies excessive landing slope even when speed is safe", () => {
    const t = flat("moon", 0.4),
      s = defaultScenario(t, "descent");
    s.start = { x: 0, y: 0 };
    expect(simulate(s, t).outcome).toBe("slope_exceeded");
  });
  it("has exactly reproducible telemetry and frame lookup independent of run identifiers", () => {
    const t = flat(),
      s = descent(t),
      a = simulate(s, t),
      b = simulate(s, t);
    expect(a.frames).toEqual(b.frames);
    expect(a.metrics).toEqual(b.metrics);
    expect(a.id).not.toBe(b.id);
    expect(frameAt(a, 3.025).t).toBeCloseTo(3, 10);
    expect(frameAt(a, 1000)).toEqual(a.frames.at(-1));
  });
});
describe("measured terrain and surface operations", () => {
  it("validates the measured bundle and rejects stale fingerprints", () => {
    expect(validateTerrain(pilot, results.inputs).entries).toHaveLength(11);
    expect(() =>
      validateTerrain(pilot, {
        ...results.inputs,
        targets_sha256: "f".repeat(64),
      }),
    ).toThrow(/stale/);
    expect(() =>
      validateTerrain({ ...pilot, synthetic: true }, results.inputs),
    ).toThrow();
  });
  it("samples planar heights and slopes without generating sub-grid relief", () => {
    const t = flat("moon", 0.1);
    expect(sampleTerrain(t, { x: 123, y: 456 })).toBeCloseTo(12.3, 10);
    expect(slopeAt(t, { x: 123, y: 456 })).toBeCloseTo(
      (Math.atan(0.1) * 180) / Math.PI,
      10,
    );
    expect(sampleTerrain(t, { x: 5000, y: 0 })).toBeNull();
  });
  it("preserves nodata in sampling and refuses paths through it", () => {
    const t = flat();
    for (let r = 0; r < 31; r++) t.grid.elevation_m[r * 31 + 15] = null;
    expect(sampleTerrain(t, { x: 0, y: 0 })).toBeNull();
    const s = defaultScenario(t);
    s.start = { x: -1000, y: 0 };
    s.destination = { x: 1000, y: 0 };
    expect(planRoute(t, s)).toEqual([]);
  });
  it("matches the flat-path rolling resistance and idle-power energy calculation", () => {
    const t = flat(),
      s = defaultScenario(t);
    s.start = { x: 0, y: 0 };
    s.destination = { x: 1000, y: 0 };
    s.rover.route = "direct";
    const run = simulate(s, t),
      r = s.rover;
    expect(run.outcome).toBe("destination_reached");
    expect(run.metrics.distance).toBeCloseTo(1000, 8);
    expect(run.metrics.duration).toBeCloseTo(1000 / r.speed, 8);
    const expected =
      (r.mass * s.environment.gravity * r.rollingResistance * 1000) /
        r.efficiency /
        3600 +
      (r.idlePower * (1000 / r.speed)) / 3600;
    expect(run.metrics.energyWh).toBeCloseTo(expected, 8);
  });
  it("stops exactly at the energy budget without overshoot", () => {
    const t = flat(),
      s = defaultScenario(t);
    s.rover.batteryWh = 1;
    const run = simulate(s, t);
    expect(run.outcome).toBe("energy_limit");
    expect(run.metrics.energyWh).toBeCloseTo(1, 9);
    expect(run.metrics.distance).toBeLessThan(100);
  });
  it("blocks steep terrain and low traction instead of animating through it", () => {
    const t = flat("moon", 0.5),
      s = defaultScenario(t);
    s.rover.maxSlope = 10;
    expect(simulate(s, t).outcome).toBe("route_blocked");
    s.rover.maxSlope = 40;
    s.rover.traction = 0.2;
    expect(simulate(s, t).outcome).toBe("route_blocked");
  });
  it("A* routes around a missing-data obstacle and has no invalid segments", () => {
    const t = flat(),
      s = defaultScenario(t);
    s.start = { x: -1000, y: 0 };
    s.destination = { x: 1000, y: 0 };
    for (let r = 13; r <= 17; r++)
      for (let c = 13; c <= 17; c++) t.grid.elevation_m[r * 31 + c] = null;
    s.rover.route = "direct";
    expect(simulate(s, t).outcome).toBe("route_blocked");
    s.rover.route = "astar";
    const run = simulate(s, t);
    expect(run.outcome).toBe("destination_reached");
    expect(run.metrics.distance).toBeGreaterThan(2000);
    expect(run.frames.every((f) => sampleTerrain(t, f) !== null)).toBe(true);
  });
  it("distinguishes clear, blocked and unknown regional lines of sight", () => {
    const t = flat(),
      a = { x: -1000, y: 0 },
      b = { x: 1000, y: 0 };
    expect(lineOfSight(t, a, b)).toBe("clear");
    t.grid.elevation_m[15 * 31 + 15] = 100;
    expect(lineOfSight(t, a, b)).toBe("blocked");
    t.grid.elevation_m[15 * 31 + 15] = null;
    expect(lineOfSight(t, a, b)).toBe("unknown");
  });
  it("uses real Jezero and eligible Earth grids for a complete analog experiment", () => {
    const terrains = (pilot as TerrainBundle).entries.filter((t) =>
      ["MARS_JEZERO", "PILOT_ICELAND", "PILOT_WADI_RUM"].includes(t.id),
    );
    expect(terrains).toHaveLength(3);
    const runs = terrains.flatMap((t) => {
      const s = defaultScenario(t);
      return t.body === "earth"
        ? [
            simulate(s, t, results.inputs),
            simulate(
              {
                ...s,
                kind: "counterfactual",
                environment: { ...ENVIRONMENTS.mars },
              },
              t,
              results.inputs,
            ),
          ]
        : [simulate(s, t, results.inputs)];
    });
    expect(runs).toHaveLength(5);
    expect(runs[0].frames.length).toBeGreaterThan(1);
    for (const run of runs)
      expect(
        run.frames.every((f) =>
          Object.values(f).every(
            (v) => typeof v !== "number" || Number.isFinite(v),
          ),
        ),
      ).toBe(true);
    const earth = runs.filter((r) => r.terrain.body === "earth");
    for (let i = 0; i < earth.length; i += 2) {
      expect(earth[i].route).toEqual(earth[i + 1].route);
      if (earth[i].metrics.distance > 0)
        expect(earth[i].metrics.energyWh).toBeGreaterThan(
          earth[i + 1].metrics.energyWh,
        );
    }
  });
  it("has north-up grid centers, not cell corners", () => {
    const t = pilot.entries[0] as MissionTerrain;
    expect(cellPoint(t, 0)).toEqual({ x: -9900, y: 9900 });
    expect(cellPoint(t, 9999)).toEqual({ x: 9900, y: -9900 });
  });
});
describe("reproduction and invalid input", () => {
  it("rejects non-finite values, negative fuel, invalid timesteps and hidden Earth gravity substitution", () => {
    const t = flat("earth"),
      s = defaultScenario(t, "launch");
    s.vehicle.fuel = -1;
    s.dt = 0;
    s.vehicle.thrust = NaN;
    s.environment.gravity = 1.62;
    expect(validateScenario(s, t).length).toBeGreaterThanOrEqual(4);
    expect(() => simulate(s, t)).toThrow();
  });
  it("requires explicit counterfactual labeling", () => {
    const t = flat("earth"),
      s = defaultScenario(t);
    s.environment = { ...ENVIRONMENTS.mars };
    expect(validateScenario(s, t).join(" ")).toContain("Earth physics");
    s.kind = "counterfactual";
    expect(validateScenario(s, t)).toEqual([]);
  });
  it("exports embedded inputs and reproduces parsed scenarios", () => {
    const terrain = pilot.entries.find(
        (t) => t.id === "MARS_JEZERO",
      ) as MissionTerrain,
      s = defaultScenario(terrain, "launch");
    s.duration = 2;
    const run = simulate(s, terrain, results.inputs),
      parsed = parseExperiment(JSON.stringify(run));
    expect(
      simulate(parsed.scenario, parsed.terrain, parsed.inputs).frames,
    ).toEqual(run.frames);
    expect(report(run)).toContain(terrain.source.sha256);
    expect(report(run)).toContain("not the full experiment archive");
    expect(() =>
      parseExperiment(JSON.stringify({ ...run, model: "future-version" })),
    ).toThrow();
  });
});

it("rejects an uploaded modified heightmap that retains a genuine source fingerprint", () => {
  const terrain = pilot.entries.find(
    (t) => t.id === "MARS_JEZERO",
  ) as MissionTerrain;
  const scenario = defaultScenario(terrain, "launch");
  scenario.duration = 1;
  const run = simulate(scenario, terrain, (pilot as TerrainBundle).inputs);
  expect(() =>
    verifyImportedTerrain(run, pilot as TerrainBundle),
  ).not.toThrow();
  run.terrain.grid.elevation_m[5000] = 99999;
  expect(() => verifyImportedTerrain(run, pilot as TerrainBundle)).toThrow(
    /does not match/,
  );
});

describe("energy accounting on measured pilot terrain", () => {
  it("reports energy equal to the time integral of electrical power, and battery = budget - energy", () => {
    let checked = 0;
    for (const t of pilot.entries as MissionTerrain[]) {
      const s = defaultScenario(t);
      if (!s.rover.design) continue;
      const r = simulate(s, t);
      if (r.frames.length < 3) continue;
      let integral = 0;
      for (let k = 1; k < r.frames.length; k++) {
        // Each recorded step holds the electrical power of the step that ends at that frame.
        integral += (r.frames[k].mobility?.electricalPowerW ?? 0) * (r.frames[k].t - r.frames[k - 1].t) / 3600;
      }
      expect(r.metrics.energyWh).toBeCloseTo(integral, 6);
      const last = r.frames.at(-1)!;
      expect(last.energyWh).toBeCloseTo(r.metrics.energyWh, 9);
      expect(last.mobility!.batteryRemainingWh).toBeCloseTo(s.rover.batteryWh - r.metrics.energyWh + last.mobility!.generatedWh, 6);
      // Mean bus load over the run is energy / time, not the instantaneous readout at one replay time.
      const meanW = r.metrics.energyWh * 3600 / r.metrics.duration;
      expect(meanW).toBeGreaterThanOrEqual(s.rover.idlePower);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
