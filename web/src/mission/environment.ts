import type { Environment, MissionTerrain, Mode, Scenario } from "./types.ts";
import { DEFAULT_DESIGN } from "./mobility.ts";
export const MODEL = "egiz-local-mission-2.0.0";
export const G0 = 9.80665;
// Rounded reference values, not observations at the selected site.
export const ENVIRONMENTS: Record<Environment["planet"], Environment> = {
  earth: {
    planet: "earth",
    gravity: 9.80665,
    density: 1.225,
    scaleHeight: 8500,
    pressureKpa: 101.325,
    temperatureK: 288.15,
  },
  moon: {
    planet: "moon",
    gravity: 1.62,
    density: 0,
    scaleHeight: 1,
    pressureKpa: 0,
    temperatureK: 250,
  },
  mars: {
    planet: "mars",
    gravity: 3.71,
    density: 0.02,
    scaleHeight: 11100,
    pressureKpa: 0.61,
    temperatureK: 210,
  },
};
export function defaultScenario(
  terrain: MissionTerrain,
  mode: Mode = "rover",
): Scenario {
  return {
    version: "1.0.0",
    mode,
    terrainId: terrain.id,
    kind: terrain.body === "earth" ? "earth-analog" : "native",
    environment: { ...ENVIRONMENTS[terrain.body] },
    start: { x: -1800, y: -100 },
    destination: { x: 1800, y: 1500 },
    duration: mode === "rover" || mode === "eva" ? 18000 : 180,
    dt: mode === "rover" || mode === "eva" ? 5 : 0.1,
    seed: 2026,
    vehicle: {
      dryMass: 800,
      fuel: 600,
      thrust: mode === "descent" ? 24000 : 24000,
      isp: 280,
      area: 2,
      cd: 0.5,
      angle: 0,
      initialAltitude: mode === "descent" ? 1200 : 0,
      initialVelocity: mode === "descent" ? -35 : 0,
      ignitionAltitude: 800,
      safeSpeed: 3,
      safeSlope: 10,
    },
    rover: {
      mass: mode === "eva" ? 140 : 900,
      speed: mode === "eva" ? 1 : 0.8,
      maxSlope: mode === "eva" ? 20 : 15,
      traction: 0.6,
      rollingResistance: 0.04,
      efficiency: 0.7,
      idlePower: 80,
      batteryWh: 3000,
      route: "astar",
      ...(mode === "rover" ? { design: { ...DEFAULT_DESIGN } } : {}),
    },
  };
}
export const ASSUMPTIONS = [
  "Measured terrain is averaged to 200 m cells. Interpolation does not add observations; slopes cannot resolve landing pads, rocks or wheel hazards.",
  "Local Cartesian frame: east/north metres and source-datum height. Datum heights are never compared across bodies. Rendering has no effect on physics.",
  "Constant gravity, prescribed thrust direction, no lift, rotation, winds, attitude dynamics, staging, heating or orbital prediction. Flight is bounded to 100 km above launch terrain and 5 km/s.",
  "Atmosphere is a static exponential scenario. Earth reference density is adjusted by datum height; Moon uses vacuum; Mars uses height relative to the start surface. No site weather is observed.",
  "Pressure and temperature are reference context only, not coupled thermodynamics. Sun angle is visualization only; no thermal, power-generation or dust model.",
  "Surface traversal is a regional kinematic screen with slope/traction limits and an energy proxy. No regolith, wheel contact, clearance, rollover or physiological model is resolved.",
  "Demonstration vehicle and operating thresholds are user assumptions, not specifications for real spacecraft or certification criteria.",
  "Deterministic model; seed is recorded for future stochastic adapters but no randomness or success probability is used.",
];
