// EGIZ Mission Lab · AI-assisted independent development, 2026-10-18.
export type Planet = "earth" | "moon" | "mars";
export type Mode = "launch" | "descent" | "rover" | "eva";
export type ExperimentKind = "native" | "earth-analog" | "counterfactual";
export interface Point {
  x: number;
  y: number;
}
export interface MissionTerrain {
  id: string;
  name: string;
  body: Planet;
  lon: number;
  lat: number;
  source: { url: string; sha256: string; native_crs: string };
  local_crs: string;
  local_origin: number[];
  source_pixel_m: number;
  grid: {
    side: number;
    cell_m: number;
    west_m: number;
    north_m: number;
    elevation_m: (number | null)[];
    valid_fraction: number;
  };
}
export interface TerrainBundle {
  schema: "egiz.mission_terrain";
  version: "1.0.0";
  synthetic: false;
  generated_at: string;
  inputs: Record<string, string>;
  method: string;
  entries: MissionTerrain[];
}
export interface Environment {
  planet: Planet;
  gravity: number;
  density: number;
  scaleHeight: number;
  pressureKpa: number;
  temperatureK: number;
}
export interface RoverDesign {
  wheelRadius: number;
  wheelWidth: number;
  trackWidth: number;
  wheelbase: number;
  cgHeight: number;
  suspensionTravel: number;
  stallTorque: number; // N m per wheel, at the wheel shaft
  noLoadRpm: number; // wheel shaft, not motor rotor
  motorPower: number; // W mechanical per wheel
  solarArea: number;
  solarEfficiency: number;
  transmission: number; // assumed surface irradiance / top-of-atmosphere
}
export interface SolarSample {
  t: number;
  sunEnu: number[];
  elevationDeg: number;
  azimuthDeg: number;
  solarFluxWm2: number;
  earthElevationDeg: number | null;
  earthRangeKm: number | null;
}
export interface SpiceGeometry {
  schema: "egiz.spice_geometry";
  version: "1.0.0";
  engine: string;
  siteId: string;
  body: Planet;
  lat: number;
  lon: number;
  epochUtc: string;
  frame: string;
  observer: string;
  aberration: "NONE";
  duration: number;
  step: number;
  kernels: { name: string; url: string; sha256: string }[];
  samples: SolarSample[];
  limitations: string[];
}
export interface Scenario {
  version: "1.0.0";
  mode: Mode;
  kind: ExperimentKind;
  terrainId: string;
  environment: Environment;
  start: Point;
  destination: Point;
  duration: number;
  dt: number;
  seed: number;
  /** Piecewise-constant launch throttle; omitted preserves constant full thrust. */
  thrustProgram?: { time: number; throttle: number }[];
  solar?: SpiceGeometry;
  vehicle: {
    dryMass: number;
    fuel: number;
    thrust: number;
    isp: number;
    area: number;
    cd: number;
    angle: number;
    initialAltitude: number;
    initialVelocity: number;
    ignitionAltitude: number;
    safeSpeed: number;
    safeSlope: number;
  };
  rover: {
    mass: number;
    speed: number;
    maxSlope: number;
    traction: number;
    rollingResistance: number;
    efficiency: number;
    idlePower: number;
    batteryWh: number;
    route: "direct" | "astar" | "astar-energy";
    design?: RoverDesign;
  };
}
export interface Frame extends Point {
  t: number;
  elevation: number;
  altitude: number;
  speed: number;
  verticalSpeed: number;
  acceleration: number;
  mass: number;
  propellant: number;
  thrust: number;
  dynamicPressure: number;
  distance: number;
  energyWh: number;
  slope: number;
  phase: string;
  mobility?: {
    motorRpm: number;
    wheelTorqueNm: number;
    motorUtilization: number;
    tractionUtilization: number;
    stabilityMarginDeg: number;
    electricalPowerW: number;
    solarPowerW: number;
    generatedWh: number;
    batteryRemainingWh: number;
  };
}
export interface MissionEvent {
  t: number;
  type: string;
  detail: string;
}
export interface RunResult {
  schema: "egiz.experiment";
  version: "1.0.0";
  model: string;
  id: string;
  createdAt: string;
  scenario: Scenario;
  terrain: MissionTerrain;
  inputs: Record<string, string>;
  integrator: string;
  assumptions: string[];
  frames: Frame[];
  events: MissionEvent[];
  route: Point[];
  outcome: string;
  explanation: string;
  metrics: {
    maxAltitude: number;
    maxSpeed: number;
    maxQ: number;
    fuelUsed: number;
    distance: number;
    duration: number;
    energyWh: number;
    maxSlope: number;
    touchdownSpeed: number | null;
  };
}
