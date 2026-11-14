// Interactive port of CF_TERRAMECHANICS (pipeline/analog_transfer/counterfactual.py).
// Parity with the Python model is enforced by physics.test.ts against the built bundle.
// Written with AI assistance (Claude); human review pending.
import type { Rover, Soil, TerraCase } from './types';

export const GRAVITY = { earth: 9.80665, moon: 1.62, mars: 3.73 } as const; // NSSDCA; Mars sheet updated 2025-05-19

function positive(values: Record<string, number>) {
  for (const [key, value] of Object.entries(values)) if (!Number.isFinite(value) || value <= 0) throw new Error(`${key} must be positive and finite`);
}

export function bekkerWheel(load: number, d: number, b: number, kc: number, kphi: number, n: number) {
  positive({ load, d, b, kc, kphi, n });
  if (n >= 3) throw new Error('sinkage exponent n must be < 3');
  const z0 = (3 * load / ((3 - n) * (kc + b * kphi) * Math.sqrt(d))) ** (2 / (2 * n + 1));
  const rc = b * (kc / b + kphi) * z0 ** (n + 1) / (n + 1);
  return { sinkage_m: z0, compaction_resistance_n: rc, contact_length_m: Math.sqrt(d * z0) };
}

export function slopeLimitDeg(mass: number, g: number, rover: Rover, soil: Soil): number {
  const phi = soil.phi_deg * Math.PI / 180;
  const margin = (theta: number) => {
    const w = mass * g * Math.cos(theta) / rover.wheels;
    const wheel = bekkerWheel(w, rover.wheel_diameter_m, rover.wheel_width_m, soil.kc, soil.kphi, soil.n);
    const thrust = rover.wheel_width_m * wheel.contact_length_m * soil.c_pa + w * Math.tan(phi);
    return thrust - wheel.compaction_resistance_n - mass * g * Math.sin(theta) / rover.wheels;
  };
  let lo = 0, hi = 60 * Math.PI / 180;
  if (margin(lo) <= 0) return 0;
  if (margin(hi) > 0) return 60;
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (margin(mid) > 0) lo = mid; else hi = mid; }
  return lo * 180 / Math.PI;
}

export function terramechanics(body: 'moon' | 'mars', rover: Rover, soil: Soil): Record<'target' | 'earth_load_matched' | 'earth_mass_matched', TerraCase> {
  positive({ mass: rover.mass_kg, wheels: rover.wheels, diameter: rover.wheel_diameter_m, width: rover.wheel_width_m });
  if (!(soil.phi_deg > 0 && soil.phi_deg < 60) || !(soil.c_pa >= 0)) throw new Error('phi must be in (0,60) deg and cohesion nonnegative');
  const gt = GRAVITY[body], ge = GRAVITY.earth, m = rover.mass_kg;
  const cases = {
    target: { label: `${body === 'moon' ? 'Moon' : 'Mars'} gravity, same soil model`, mass: m, g: gt },
    earth_load_matched: { label: 'Earth test, load-matched (test mass m*g_t/g_E)', mass: m * gt / ge, g: ge },
    earth_mass_matched: { label: 'Earth test, mass-matched (Wong 2012)', mass: m, g: ge },
  };
  const out = {} as Record<keyof typeof cases, TerraCase>;
  for (const key of Object.keys(cases) as (keyof typeof cases)[]) {
    const c = cases[key], load = c.mass * c.g / rover.wheels;
    const wheel = bekkerWheel(load, rover.wheel_diameter_m, rover.wheel_width_m, soil.kc, soil.kphi, soil.n);
    out[key] = { label: c.label, test_mass_kg: c.mass, gravity: c.g, wheel_load_n: load, ...wheel,
      resistance_to_load: wheel.compaction_resistance_n / load, slope_limit_deg: slopeLimitDeg(c.mass, c.g, rover, soil) };
  }
  for (const key of ['earth_load_matched', 'earth_mass_matched'] as const) {
    out[key].sinkage_ratio_vs_target = out[key].sinkage_m / out.target.sinkage_m;
    out[key].slope_limit_error_deg = out[key].slope_limit_deg - out.target.slope_limit_deg;
  }
  return out;
}
