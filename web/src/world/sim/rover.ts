// Parameterized rover digital twins. Both profiles are EGIZ scenario vehicles (hypothetical);
// no profile represents a real NASA rover. Values are explicit configuration, not specifications.
export interface RoverProfile {
  id: string; name: string; evidenceClass: 'assumed'; note: string;
  massKg: number; wheels: number; wheelRadiusM: number; wheelWidthM: number;
  trackWidthM: number; wheelbaseM: number; cgHeightM: number; groundClearanceM: number;
  maxSpeedMs: number; wheelStallTorqueNm: number; drivetrainEfficiency: number;
  avionicsW: number; batteryWh: number;
  /** Vertical panels, normals in rover frame (x forward, y left); area m² each. */
  panels: { name: string; normalYawDeg: number; areaM2: number }[]; panelEfficiency: number;
  mastHeightM: number; panelCentreHeightM: number;
  instruments: { id: string; name: string; powerW: number }[];
}

export const ROVERS: RoverProfile[] = [
  {
    id: 'egiz-lr1', name: 'EGIZ LR-1 polar prospector (scenario)', evidenceClass: 'assumed',
    note: 'Hypothetical 4-wheel polar rover configured for low Sun: three vertical solar panels. Not a model of any flown or planned vehicle.',
    massKg: 450, wheels: 4, wheelRadiusM: 0.25, wheelWidthM: 0.20, trackWidthM: 1.45, wheelbaseM: 1.45, cgHeightM: 0.75, groundClearanceM: 0.30,
    maxSpeedMs: 0.2, wheelStallTorqueNm: 140, drivetrainEfficiency: 0.55, avionicsW: 120, batteryWh: 3000,
    panels: [{ name: 'left', normalYawDeg: 90, areaM2: 1.6 }, { name: 'right', normalYawDeg: -90, areaM2: 1.6 }, { name: 'rear', normalYawDeg: 180, areaM2: 1.6 }],
    panelEfficiency: 0.28, mastHeightM: 2.4, panelCentreHeightM: 1.0,
    instruments: [{ id: 'nss', name: 'Neutron spectrometer (generic)', powerW: 15 }, { id: 'nirvss', name: 'Near-IR spectrometer (generic)', powerW: 45 }, { id: 'drill', name: '1 m drill (generic)', powerW: 280 }, { id: 'cams', name: 'Stereo cameras', powerW: 20 }],
  },
  {
    id: 'egiz-lr6', name: 'EGIZ LR-6 heavy traverse rover (scenario)', evidenceClass: 'assumed',
    note: 'Hypothetical 6-wheel 900 kg rover; larger wheels and battery. Not a model of any real vehicle.',
    massKg: 900, wheels: 6, wheelRadiusM: 0.41, wheelWidthM: 0.33, trackWidthM: 2.2, wheelbaseM: 2.24, cgHeightM: 0.95, groundClearanceM: 0.45,
    maxSpeedMs: 0.3, wheelStallTorqueNm: 300, drivetrainEfficiency: 0.6, avionicsW: 200, batteryWh: 8000,
    panels: [{ name: 'left', normalYawDeg: 90, areaM2: 3.0 }, { name: 'right', normalYawDeg: -90, areaM2: 3.0 }, { name: 'rear', normalYawDeg: 180, areaM2: 2.0 }],
    panelEfficiency: 0.28, mastHeightM: 2.2, panelCentreHeightM: 1.2,
    instruments: [{ id: 'nss', name: 'Neutron spectrometer (generic)', powerW: 15 }, { id: 'nirvss', name: 'Near-IR spectrometer (generic)', powerW: 45 }, { id: 'drill', name: '1 m drill (generic)', powerW: 400 }, { id: 'cams', name: 'Stereo cameras', powerW: 25 }],
  },
];

export const LUNAR_GRAVITY = 1.62; // m/s², NSSDCA lunar fact sheet

/** Static tip-over angle from support half-span and CG height (conservative, no dynamics). */
export function tipAngleDeg(r: RoverProfile) { return Math.atan(Math.min(r.trackWidthM, r.wheelbaseM) / (2 * r.cgHeightM)) * 180 / Math.PI; }

/** Wheel contact points in the rover frame (x forward, y left). */
export function wheelContacts(r: RoverProfile): [number, number][] {
  const rows = r.wheels / 2, out: [number, number][] = [];
  for (let i = 0; i < rows; i++) {
    const x = rows === 1 ? 0 : r.wheelbaseM / 2 - (i * r.wheelbaseM) / (rows - 1);
    out.push([x, r.trackWidthM / 2], [x, -r.trackWidthM / 2]);
  }
  return out;
}

export function validateRover(r: RoverProfile) {
  const errors: string[] = [];
  const positive: (keyof RoverProfile)[] = ['massKg', 'wheelRadiusM', 'wheelWidthM', 'trackWidthM', 'wheelbaseM', 'cgHeightM', 'maxSpeedMs', 'wheelStallTorqueNm', 'batteryWh'];
  for (const k of positive) if (!(Number(r[k]) > 0) || !Number.isFinite(Number(r[k]))) errors.push(`${k} must be positive`);
  if (![4, 6].includes(r.wheels)) errors.push('wheels must be 4 or 6');
  if (!(r.drivetrainEfficiency > 0 && r.drivetrainEfficiency <= 1)) errors.push('drivetrainEfficiency must be in (0,1]');
  if (r.massKg > 5000) errors.push('massKg outside supported range (≤ 5000 kg)');
  return errors;
}
