// Wheel-soil interaction for rigid wheels on deformable regolith.
// FAST:      Bekker pressure-sinkage + compaction resistance, Janosi-Hanamoto thrust (closed form).
// DETAILED:  Wong-Reece stress integration over the contact arc (numerical), with slip-dependent
//            maximum-stress angle; sinkage solved from vertical equilibrium.
// Parameter values are literature values for lunar soil (assumed for this site, never measured here).
export type Fidelity = 'fast' | 'detailed';

export interface RegolithProfile {
  id: string; name: string; kc: number; kphi: number; n: number; cohesionPa: number; phiDeg: number; shearModulusK: number;
  densityKgM3: number; evidenceClass: 'assumed'; source: string;
}

export const REGOLITH: RegolithProfile[] = [
  { id: 'lunar-nominal', name: 'Lunar regolith — nominal literature values', kc: 1400, kphi: 820000, n: 1.0, cohesionPa: 170, phiDeg: 35, shearModulusK: 0.018, densityKgM3: 1500,
    evidenceClass: 'assumed', source: 'Bekker-model lunar soil values (n=1, kc=1.4 kN/m², kφ=820 kN/m³, c=0.17 kPa, φ=35°) as tabulated in Wong, Theory of Ground Vehicles (4th ed., 2008) after Lunar Sourcebook (Heiken et al. 1991); K = 0.018 m assumed.' },
  { id: 'lunar-loose', name: 'Loose regolith — sensitivity case', kc: 1400, kphi: 410000, n: 1.0, cohesionPa: 100, phiDeg: 30, shearModulusK: 0.025, densityKgM3: 1300,
    evidenceClass: 'assumed', source: 'EGIZ sensitivity variant: kφ halved, lower c and φ (no site measurement).' },
  { id: 'lunar-firm', name: 'Compacted regolith — sensitivity case', kc: 1400, kphi: 1640000, n: 1.0, cohesionPa: 500, phiDeg: 42, shearModulusK: 0.012, densityKgM3: 1800,
    evidenceClass: 'assumed', source: 'EGIZ sensitivity variant: kφ doubled, higher c and φ (no site measurement).' },
];

export interface WheelState { slip: number; sinkageM: number; drawbarN: number; thrustN: number; resistanceN: number; torqueNm: number; immobile: boolean }

const RAD = Math.PI / 180;

/** Closed-form Bekker sinkage of a rigid wheel (diameter d, width b) under load W (N). */
export function bekkerSinkage(W: number, d: number, b: number, soil: RegolithProfile) {
  const n = soil.n, k = soil.kc + b * soil.kphi;
  return (3 * W / ((3 - n) * k * Math.sqrt(d))) ** (2 / (2 * n + 1));
}

function fastAt(W: number, slip: number, r: number, b: number, soil: RegolithProfile) {
  const d = 2 * r, z = bekkerSinkage(W, d, b, soil), l = Math.sqrt(d * z);
  const Rc = b * (soil.kc / b + soil.kphi) * z ** (soil.n + 1) / (soil.n + 1);
  const Hmax = b * l * soil.cohesionPa + W * Math.tan(soil.phiDeg * RAD);
  const sl = Math.max(1e-9, slip * l);
  const H = Hmax * (1 - soil.shearModulusK / sl * (1 - Math.exp(-sl / soil.shearModulusK)));
  return { z, H, Rc, DP: H - Rc, T: H * r };
}

/** Wong-Reece stresses integrated over the contact arc for a given entry angle and slip. */
function wongReeceForces(theta1: number, slip: number, r: number, b: number, soil: RegolithProfile) {
  const c1 = 0.43, c2 = 0.32; // Wong & Reece (1967) maximum-stress angle coefficients
  const thetaM = (c1 + c2 * slip) * theta1, k = (soil.kc / b + soil.kphi) * r ** soil.n, tanPhi = Math.tan(soil.phiDeg * RAD);
  const N = 48, h = theta1 / N;
  let Fz = 0, Fx = 0, T = 0;
  for (let i = 0; i <= N; i++) {
    const th = i * h, w = i === 0 || i === N ? 1 : i % 2 ? 4 : 2;
    const eq = th >= thetaM ? th : theta1 - (th / Math.max(1e-9, thetaM)) * (theta1 - thetaM);
    const sigma = k * Math.max(0, Math.cos(eq) - Math.cos(theta1)) ** soil.n;
    const j = r * ((theta1 - th) - (1 - slip) * (Math.sin(theta1) - Math.sin(th)));
    const tau = (soil.cohesionPa + sigma * tanPhi) * (1 - Math.exp(-Math.max(0, j) / soil.shearModulusK));
    Fz += w * (sigma * Math.cos(th) + tau * Math.sin(th));
    Fx += w * (tau * Math.cos(th) - sigma * Math.sin(th));
    T += w * tau;
  }
  const s = h / 3;
  return { Fz: r * b * Fz * s, DP: r * b * Fx * s, T: r * r * b * T * s };
}

function detailedAt(W: number, slip: number, r: number, b: number, soil: RegolithProfile) {
  let lo = 1e-4, hi = Math.PI / 2.2;
  if (wongReeceForces(hi, slip, r, b, soil).Fz < W) return { z: r * (1 - Math.cos(hi)), DP: -Infinity, T: Infinity, H: 0, Rc: Infinity };
  for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (wongReeceForces(m, slip, r, b, soil).Fz < W) lo = m; else hi = m; }
  const theta1 = (lo + hi) / 2, f = wongReeceForces(theta1, slip, r, b, soil);
  return { z: r * (1 - Math.cos(theta1)), DP: f.DP, T: f.T, H: f.T / r, Rc: f.T / r - f.DP };
}

/** Solve the slip at which drawbar pull equals the required tractive force per wheel. */
export function solveWheel(W: number, required: number, r: number, b: number, soil: RegolithProfile, fidelity: Fidelity): WheelState {
  const at = fidelity === 'fast' ? fastAt : detailedAt;
  const zero = at(W, 1e-4, r, b, soil);
  if (required <= zero.DP) {
    // Downhill: gravity supplies at least the compaction resistance, so no driving slip; motors hold or brake.
    return { slip: 0, sinkageM: zero.z, drawbarN: required, thrustN: Math.max(0, required + zero.Rc), resistanceN: zero.Rc, torqueNm: Math.max(0, required + zero.Rc) * r, immobile: false };
  }
  const max = at(W, 0.95, r, b, soil);
  if (!(max.DP >= required)) return { slip: 1, sinkageM: max.z, drawbarN: max.DP, thrustN: max.H, resistanceN: max.Rc, torqueNm: max.T, immobile: true };
  let lo = 1e-4, hi = 0.95;
  for (let k = 0; k < 36; k++) { const m = (lo + hi) / 2; if (at(W, m, r, b, soil).DP < required) lo = m; else hi = m; }
  const s = (lo + hi) / 2, f = at(W, s, r, b, soil);
  return { slip: s, sinkageM: f.z, drawbarN: f.DP, thrustN: f.H, resistanceN: f.Rc, torqueNm: f.T, immobile: false };
}

export interface GradeTable { gradesDeg: number[]; states: WheelState[]; fidelity: Fidelity; soilId: string }

/** Precompute wheel states over along-track grade for one rover/soil/gravity (used by planner and simulator). */
export function gradeTable(massKg: number, gravity: number, wheels: number, r: number, b: number, soil: RegolithProfile, fidelity: Fidelity, stepDeg = 0.5, maxDeg = 40): GradeTable {
  const gradesDeg: number[] = [], states: WheelState[] = [];
  for (let g = -maxDeg; g <= maxDeg + 1e-9; g += stepDeg) {
    const th = g * RAD, W = massKg * gravity * Math.cos(th) / wheels, required = massKg * gravity * Math.sin(th) / wheels;
    gradesDeg.push(+g.toFixed(4)); states.push(solveWheel(W, required, r, b, soil, fidelity));
  }
  return { gradesDeg, states, fidelity, soilId: soil.id };
}

export function lookupGrade(table: GradeTable, gradeDeg: number): WheelState {
  const g = table.gradesDeg, step = g[1] - g[0];
  const f = Math.min(g.length - 1.000001, Math.max(0, (gradeDeg - g[0]) / step)), i = Math.floor(f), t = f - i;
  const a = table.states[i], b = table.states[i + 1];
  if (a.immobile || b.immobile) return t < 0.5 ? a : b;
  const mix = (u: number, v: number) => u + (v - u) * t;
  return { slip: mix(a.slip, b.slip), sinkageM: mix(a.sinkageM, b.sinkageM), drawbarN: mix(a.drawbarN, b.drawbarN), thrustN: mix(a.thrustN, b.thrustN), resistanceN: mix(a.resistanceN, b.resistanceN), torqueNm: mix(a.torqueNm, b.torqueNm), immobile: false };
}

/** Lateral traction utilization on a cross-slope (Coulomb limit of the contact patches). */
export function lateralUtilization(massKg: number, gravity: number, crossDeg: number, contactArea: number, soil: RegolithProfile) {
  const W = massKg * gravity * Math.cos(crossDeg * RAD);
  const capacity = contactArea * soil.cohesionPa + W * Math.tan(soil.phiDeg * RAD);
  return massKg * gravity * Math.sin(Math.abs(crossDeg) * RAD) / Math.max(1e-9, capacity);
}
