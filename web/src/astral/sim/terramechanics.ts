// EGIZ ASTRAL · wheel–soil interaction (Bekker pressure–sinkage, Janosi–Hanamoto shear) and rover profiles.
// Quasi-static, per-wheel. No dynamic sinkage, slip-sinkage, grousers, multipass or lateral bulldozing.
// Every soil and vehicle number carries its origin; "assumed" values are not site measurements.

export type Origin = "documented" | "approximate" | "assumed";
export interface Soil {
  id: string; name: string; rigid: boolean; origin: Origin; source: string;
  /** Bekker exponent */ n: number; /** N/m^(n+1) */ kc: number; /** N/m^(n+2) */ kphi: number;
  /** Pa */ cohesion: number; /** degrees */ frictionDeg: number; /** shear deformation modulus, m */ K: number;
  /** rigid surfaces only: Coulomb friction and rolling-resistance coefficients */ mu?: number; crr?: number;
}
export const SOILS: Record<string, Soil> = {
  "dry-sand": { id: "dry-sand", name: "Dry sand (LETE) — Earth analog", rigid: false, origin: "assumed",
    source: "Wong, Theory of Ground Vehicles (4th ed.), Table 2.3: LETE sand. Earth laboratory soil used as a loose-sand analog; not measured at this site.",
    n: 1.1, kc: 990, kphi: 1528430, cohesion: 1040, frictionDeg: 28, K: 0.025 },
  "mars-drift": { id: "mars-drift", name: "Weak drift-like fines — conservative", rigid: false, origin: "assumed",
    source: "Shear strength after Moore et al. 1987 (USGS Prof. Paper 1389) Viking 'drift material' (c≈1.6 kPa, φ≈18°); pressure–sinkage borrowed from LETE sand. Composite assumption.",
    n: 1.1, kc: 990, kphi: 1528430, cohesion: 1600, frictionDeg: 18, K: 0.025 },
  "lunar-regolith": { id: "lunar-regolith", name: "Lunar regolith — nominal", rigid: false, origin: "assumed",
    source: "Carrier, Olhoeft & Mendell 1991, Lunar Sourcebook ch. 9: nominal intercrater regolith used for LRV analysis (n=1, kc=1.4 kN/m², kφ=820 kN/m³, c=0.17 kPa, φ=35°, K=1.8 cm). Not a polar-site measurement.",
    n: 1, kc: 1400, kphi: 820000, cohesion: 170, frictionDeg: 35, K: 0.018 },
  bedrock: { id: "bedrock", name: "Competent rock / indurated surface", rigid: true, origin: "assumed",
    source: "Rigid contact with declared Coulomb friction 0.6 and rolling resistance 0.05; no slip or wear model.",
    n: 1, kc: 0, kphi: 0, cohesion: 0, frictionDeg: 31, K: 0.01, mu: 0.6, crr: 0.05 },
};

export interface RoverProfile {
  id: string; name: string; kind: "reference" | "hypothetical"; note: string;
  mass: number; wheels: 4 | 6 | 8; wheelRadius: number; wheelWidth: number; wheelbase: number; track: number; cgHeight: number;
  groundClearance: number; maxSpeed: number; /** per wheel, N·m */ wheelTorqueLimit: number;
  maxTiltDeg: number; /** climbable step / rock height, m */ maxObstacle: number;
  batteryWh: number; idlePowerW: number; driveEfficiency: number;
  generation: { kind: "rtg"; powerW: number } | { kind: "solar"; areaM2: number; efficiency: number; transmission: number };
  sciencePowerW: number; scienceStopS: number;
  origins: Record<string, Origin>;
}
export const ROVERS: Record<string, RoverProfile> = {
  "m2020-class": {
    id: "m2020-class", name: "Mars 2020-class rover (published figures)", kind: "reference",
    note: "Mass, wheel diameter, top speed, tilt capability, MMRTG power and battery capacity follow NASA/JPL Mars 2020 public fact sheets. Wheel width, wheelbase, CG height, torque limit, efficiencies and loads are approximations or assumptions. This is not a JPL engineering model.",
    mass: 1025, wheels: 6, wheelRadius: 0.2625, wheelWidth: 0.4, wheelbase: 2.2, track: 2.3, cgHeight: 0.9,
    groundClearance: 0.6, maxSpeed: 0.042, wheelTorqueLimit: 400, maxTiltDeg: 30, maxObstacle: 0.4,
    batteryWh: 2400, idlePowerW: 150, driveEfficiency: 0.55,
    generation: { kind: "rtg", powerW: 110 }, sciencePowerW: 250, scienceStopS: 1800,
    origins: { mass: "documented", wheelRadius: "documented", maxSpeed: "documented", generation: "documented", batteryWh: "approximate",
      maxTiltDeg: "documented", maxObstacle: "documented", wheelWidth: "approximate", wheelbase: "approximate", track: "approximate",
      groundClearance: "approximate", cgHeight: "assumed", wheelTorqueLimit: "assumed", idlePowerW: "assumed", driveEfficiency: "assumed",
      sciencePowerW: "assumed", scienceStopS: "assumed" },
  },
  "egiz-scout": {
    id: "egiz-scout", name: "EGIZ Scout (hypothetical solar rover)", kind: "hypothetical",
    note: "EGIZ scenario asset. Every parameter is a design assumption for trade studies; it does not describe an existing vehicle.",
    mass: 180, wheels: 6, wheelRadius: 0.15, wheelWidth: 0.16, wheelbase: 1.1, track: 1.0, cgHeight: 0.45,
    groundClearance: 0.3, maxSpeed: 0.1, wheelTorqueLimit: 60, maxTiltDeg: 25, maxObstacle: 0.2,
    batteryWh: 1200, idlePowerW: 35, driveEfficiency: 0.6,
    generation: { kind: "solar", areaM2: 1.6, efficiency: 0.28, transmission: 0.6 }, sciencePowerW: 60, scienceStopS: 900,
    origins: {},
  },
};

export interface WheelState { load: number; sinkage: number; contactLength: number; compactionN: number; thrustN: number; maxThrustN: number; slip: number; torqueNm: number }

/** Bekker static sinkage of a rigid wheel, metres. */
export function sinkage(soil: Soil, load: number, radius: number, width: number): number {
  if (soil.rigid || load <= 0) return 0;
  return ((3 * load) / ((3 - soil.n) * (soil.kc + width * soil.kphi) * Math.sqrt(2 * radius))) ** (2 / (2 * soil.n + 1));
}
/** Compaction (rolling) resistance, newtons. */
export function compactionResistance(soil: Soil, load: number, radius: number, width: number): number {
  if (soil.rigid) return (soil.crr ?? 0) * Math.max(0, load);
  const z = sinkage(soil, load, radius, width);
  return ((soil.kc + width * soil.kphi) * z ** (soil.n + 1)) / (soil.n + 1);
}
/** Janosi–Hanamoto tractive thrust at slip i over contact length ℓ, newtons. */
export function thrustAtSlip(soil: Soil, load: number, width: number, contactLength: number, slip: number): number {
  const max = width * contactLength * soil.cohesion + load * Math.tan((soil.frictionDeg * Math.PI) / 180);
  if (slip <= 0) return 0;
  const j = (slip * contactLength) / soil.K;
  return max * (1 - (1 - Math.exp(-j)) / j);
}
/** One wheel delivering `demandN` of net forward force (drawbar pull). */
export function wheelContact(soil: Soil, load: number, radius: number, width: number, demandN: number): WheelState {
  const compactionN = compactionResistance(soil, load, radius, width), need = demandN + compactionN;
  if (soil.rigid) {
    const maxThrustN = (soil.mu ?? 0) * Math.max(0, load);
    return { load, sinkage: 0, contactLength: 0, compactionN, thrustN: Math.max(0, need), maxThrustN, slip: need > maxThrustN ? 1 : 0, torqueNm: Math.max(0, need) * radius };
  }
  const z = sinkage(soil, load, radius, width), contactLength = Math.sqrt(2 * radius * z);
  const maxThrustN = thrustAtSlip(soil, load, width, contactLength, 1);
  let slip = 0;
  if (need > 0) {
    if (need >= maxThrustN) slip = 1;
    else { let lo = 0, hi = 1; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (thrustAtSlip(soil, load, width, contactLength, mid) < need) lo = mid; else hi = mid; } slip = hi; }
  }
  return { load, sinkage: z, contactLength, compactionN, thrustN: Math.max(0, need), maxThrustN, slip, torqueNm: Math.max(0, need) * radius };
}

export interface DriveState {
  admissible: boolean; reason: string | null; speed: number; meanSlip: number; maxSlip: number; maxSinkage: number;
  mechanicalW: number; electricalW: number; tractionUtilization: number; torqueUtilization: number; minWheelLoad: number; wheels: WheelState[];
}
/** Longitudinal axle positions (m, forward positive), evenly spaced over the wheelbase: 2, 3 or 4 axles. */
export function axleOffsets(rover: Pick<RoverProfile, "wheels" | "wheelbase">): number[] {
  const rows = rover.wheels / 2;
  return Array.from({ length: rows }, (_, i) => rover.wheelbase / 2 - (i * rover.wheelbase) / (rows - 1));
}
/** Quasi-static drive (4, 6 or 8 wheels) on a plane with along-track pitch and cross-track roll (radians, pitch > 0 = climbing). */
export function drive(rover: RoverProfile, soil: Soil, gravity: number, pitch: number, roll: number, commandedSpeed = rover.maxSpeed): DriveState {
  const weight = rover.mass * gravity, normal = weight * Math.cos(pitch) * Math.cos(roll);
  // Static load transfer by moment balance over the wheel contacts: a·Σx² = −W·sin(pitch)·h, b·Σy² = −W·|sin(roll)|·h.
  // For six wheels Σx² = wheelbase² and Σy² = 1.5·track², the original closed form.
  const xs = axleOffsets(rover), n = rover.wheels;
  const a = (-weight * Math.sin(pitch) * rover.cgHeight) / (2 * xs.reduce((s, x) => s + x * x, 0));
  const b = (-weight * Math.abs(Math.sin(roll)) * rover.cgHeight) / (n * (rover.track / 2) ** 2);
  const grade = weight * Math.sin(pitch), lateral = weight * Math.abs(Math.sin(roll));
  const loads: number[] = [];
  for (const x of xs) for (const y of [rover.track / 2, -rover.track / 2]) loads.push(normal / n + a * x + b * y);
  const minWheelLoad = Math.min(...loads);
  const wheels = loads.map(load => wheelContact(soil, Math.max(0, load), rover.wheelRadius, rover.wheelWidth, (grade * Math.max(0, load)) / normal));
  const capacity = wheels.reduce((s, w) => s + w.maxThrustN, 0), demand = wheels.reduce((s, w) => s + w.thrustN, 0);
  const tractionUtilization = Math.hypot(demand, lateral) / Math.max(1e-9, capacity);
  const torqueUtilization = Math.max(...wheels.map(w => w.torqueNm)) / rover.wheelTorqueLimit;
  const maxSlip = Math.max(...wheels.map(w => w.slip)), meanSlip = wheels.reduce((s, w) => s + w.slip, 0) / n;
  const tilt = (Math.acos(Math.cos(pitch) * Math.cos(roll)) * 180) / Math.PI;
  const reason = minWheelLoad <= 0 ? "wheel unloading (static tip-over margin exhausted)"
    : tilt > rover.maxTiltDeg ? `tilt ${tilt.toFixed(1)}° exceeds the ${rover.maxTiltDeg}° limit`
    : tractionUtilization >= 1 || maxSlip >= 1 ? "traction exhausted (100% slip)"
    : torqueUtilization > 1 ? "wheel torque limit exceeded" : null;
  // Wheels turn at the commanded rim speed; slip reduces ground progress, not wheel power.
  const speed = reason ? 0 : commandedSpeed * (1 - meanSlip);
  const mechanicalW = reason ? 0 : wheels.reduce((s, w) => s + w.thrustN * commandedSpeed, 0);
  return { admissible: !reason, reason, speed, meanSlip, maxSlip, maxSinkage: Math.max(...wheels.map(w => w.sinkage)), mechanicalW,
    electricalW: mechanicalW / rover.driveEfficiency, tractionUtilization, torqueUtilization, minWheelLoad, wheels };
}
export const GRAVITY: Record<string, number> = { earth: 9.80665, moon: 1.62, mars: 3.721 };
