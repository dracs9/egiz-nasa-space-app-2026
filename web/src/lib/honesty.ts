// Display-honesty rules applied to packaged pilot data without rewriting the files (their hashes and
// generated_at stay untouched). Every label below is computed from values in the data.
import type { MissionTemplates } from '../types/contracts';

/** Attributes that describe exposure and relief only; an objective scored from these alone is not "geology". */
const EXPOSURE_RELIEF_ATTRS = new Set(['bare_frac', 'relief_m', 'frac_lt20_r']);

export function honestObjectiveName(name: string, attrs: string[]): string {
  if (!/geolog/i.test(name) || !attrs.length || !attrs.every(a => EXPOSURE_RELIEF_ATTRS.has(a))) return name;
  return /^EVA/i.test(name) ? 'EVA terrain: exposure & relief (geology proxy)' : 'Exposure & relief (geology proxy)';
}

/** Renames objectives in place and keeps the packaged name as `source_name`. */
export function applyHonestObjectiveNames(templates: MissionTemplates): MissionTemplates {
  for (const template of templates.templates) for (const o of template.objectives) {
    const next = honestObjectiveName(o.name, o.attributes.map(a => a.attr));
    if (next !== o.name) { (o as typeof o & { source_name?: string }).source_name = o.name; o.name = next; }
  }
  return templates;
}

export const MOSTLY_VEGETATED_BARE_MAX = 0.2;

/** "Mostly vegetated" when bare ground is below 20 % and the remainder is not water, built-up or snow. */
export function vegetationFlag(attrs: Record<string, number | null | undefined>, context?: Record<string, number | null | undefined>): { bare: number; label: string } | null {
  const bare = attrs.bare_frac;
  if (typeof bare !== 'number' || !Number.isFinite(bare) || bare >= MOSTLY_VEGETATED_BARE_MAX) return null;
  const other = ['water_frac', 'built_frac', 'snow_frac'].map(k => context?.[k]);
  const known = other.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (known.length === other.length && 1 - bare - known.reduce((a, v) => a + v, 0) >= 0.5)
    return { bare, label: 'mostly vegetated' };
  return { bare, label: 'little bare ground' };
}
