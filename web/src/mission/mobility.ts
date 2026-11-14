import type { RoverDesign, Scenario } from "./types.ts";

export const DEFAULT_DESIGN: RoverDesign = {
  wheelRadius: 0.41, wheelWidth: 0.33, trackWidth: 2.58, wheelbase: 2.24,
  cgHeight: 0.95, suspensionTravel: 0.3,
  stallTorque: 90, noLoadRpm: 60, motorPower: 300,
  solarArea: 1.5, solarEfficiency: 0.24, transmission: 0.7,
};

/** Conservative static screen using the smaller support half-span; no dynamic rollover. */
export function tipAngle(d: RoverDesign): number {
  return Math.atan(Math.min(d.trackWidth, d.wheelbase) / (2 * d.cgHeight)) * 180 / Math.PI;
}

/** Six equally loaded driven wheels; ideal linear DC torque-speed curve at wheel shaft.
 * signedGrade is the along-track angle. Cross-slope enters the static screen separately.
 * Descent uses ideal dissipative braking without regeneration, not free acceleration.
 */
export function drivetrain(s: Scenario, signedGrade: number, surfaceSlope: number) {
  const r = s.rover, d = r.design!;
  const normal = r.mass * s.environment.gravity * Math.cos(signedGrade);
  const signedForce = r.mass * s.environment.gravity *
    (r.rollingResistance * Math.cos(signedGrade) + Math.sin(signedGrade));
  const force = Math.abs(signedForce);
  const staticForce = 6 * d.stallTorque / d.wheelRadius;
  const freeSpeed = d.noLoadRpm * 2 * Math.PI * d.wheelRadius / 60;
  const motorUtilization = force / staticForce;
  const tractionUtilization = force / Math.max(1e-9, normal * r.traction);
  const stabilityMarginDeg = tipAngle(d) - surfaceSlope;
  const speed = Math.max(0, Math.min(r.speed,
    freeSpeed * (1 - motorUtilization),
    force > 0 ? 6 * d.motorPower / force : Infinity));
  return {
    speed,
    electricalPowerW: Math.max(0, signedForce) * speed / r.efficiency + r.idlePower,
    wheelTorqueNm: force * d.wheelRadius / 6,
    motorRpm: speed / d.wheelRadius * 60 / (2 * Math.PI),
    motorUtilization, tractionUtilization, stabilityMarginDeg,
    admissible: speed > 1e-8 && tractionUtilization <= 1 && stabilityMarginDeg > 0,
  };
}
