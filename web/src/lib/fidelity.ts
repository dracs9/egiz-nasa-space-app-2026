// AI-assisted port of MATHEMATICAL_SPECIFICATION §6; human scientific review pending.
export interface FidelitySpec { fn: string; needs_target?: boolean; params?: Record<string, number | undefined> }
export function attributeFidelity(spec: FidelitySpec, earth: number | null, target: number | null = null): number | null {
  const fn = spec.fn; const params = spec.params ?? {};
  if (!['match', 'logmatch', 'at_most', 'at_least', 'colder', 'light', 'impossible'].includes(fn)) throw new Error(`Unsupported fidelity function: ${fn}`);
  if (fn === 'impossible') return 0;
  const needsTarget = spec.needs_target ?? ['match', 'logmatch', 'colder'].includes(fn);
  if (earth == null || !Number.isFinite(earth) || (needsTarget && (target == null || !Number.isFinite(target)))) return null;
  if (fn === 'light') { if (earth < 0 || earth > 1) throw new Error('Light fidelity must be in [0,1]'); return earth; }
  const positive = (name: string) => { const n = params[name]; if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) throw new Error(`${name} must be positive and finite`); return n; };
  let delta: number;
  if (fn === 'match' || fn === 'logmatch') {
    const sigma = positive('sigma'); if (target == null || !Number.isFinite(target)) return null;
    if (fn === 'logmatch' && (earth <= 0 || target <= 0)) return null;
    delta = fn === 'match' ? (earth - target) / sigma : (Math.log10(earth) - Math.log10(target)) / sigma;
  } else {
    const tau = positive('tau'); const threshold = fn === 'colder' ? target : params.a;
    if (threshold == null || !Number.isFinite(threshold)) throw new Error('Threshold must be finite');
    delta = Math.max(0, fn === 'at_least' ? threshold - earth : earth - threshold) / tau;
  }
  return Math.exp(-.5 * delta * delta);
}
