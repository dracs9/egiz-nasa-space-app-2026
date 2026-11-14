// Node built-ins are available in Vitest; the app tsconfig intentionally has no @types/node.
// @ts-expect-error untyped node built-in
import { existsSync, readFileSync } from 'node:fs';
// @ts-expect-error untyped node built-in
import { resolve } from 'node:path';
declare const process: { cwd(): string };
import { describe, expect, it } from 'vitest';
import { bekkerWheel, terramechanics } from './physics';
import type { AtlasBundle } from './types';

const bundlePath = [resolve(process.cwd(), '../data/pilot/atlas_pi.json'), resolve(process.cwd(), 'data/pilot/atlas_pi.json')].find((p: string) => existsSync(p)) ?? '';
const bundle: AtlasBundle | null = bundlePath ? JSON.parse(readFileSync(bundlePath, 'utf8')) : null;

describe('CF_TERRAMECHANICS TypeScript port', () => {
  it.skipIf(!bundle)('matches the Python model recorded in the bundle (parity)', () => {
    for (const body of ['moon', 'mars'] as const) {
      const ref = bundle!.counterfactual.terramechanics[body];
      const got = terramechanics(body, ref.inputs.rover, ref.inputs.soil);
      for (const key of ['target', 'earth_load_matched', 'earth_mass_matched'] as const) {
        for (const field of ['sinkage_m', 'compaction_resistance_n', 'wheel_load_n', 'slope_limit_deg', 'resistance_to_load'] as const) {
          expect(got[key][field]).toBeCloseTo(ref.cases[key][field], 4);
        }
      }
    }
  });
  it('reproduces the analytical mass-matched sinkage ratio (n = 1)', () => {
    const soil = { kc: 1400, kphi: 820000, n: 1, phi_deg: 35, c_pa: 0 };
    const r = terramechanics('moon', { mass_kg: 900, wheels: 6, wheel_diameter_m: 0.82, wheel_width_m: 0.33 }, soil);
    expect(r.earth_load_matched.sinkage_ratio_vs_target).toBeCloseTo(1, 12);
    expect(r.earth_mass_matched.sinkage_ratio_vs_target).toBeCloseTo((9.80665 / 1.62) ** (2 / 3), 9);
  });
  it('rejects nonphysical inputs instead of returning a result', () => {
    expect(() => bekkerWheel(-1, 0.8, 0.3, 1400, 820000, 1)).toThrow();
    expect(() => terramechanics('mars', { mass_kg: Number.NaN, wheels: 6, wheel_diameter_m: 0.8, wheel_width_m: 0.3 }, { kc: 1400, kphi: 820000, n: 1, phi_deg: 35, c_pa: 0 })).toThrow();
    expect(() => terramechanics('mars', { mass_kg: 900, wheels: 6, wheel_diameter_m: 0.8, wheel_width_m: 0.3 }, { kc: 1400, kphi: 820000, n: 1, phi_deg: 75, c_pa: 0 })).toThrow();
  });
});
