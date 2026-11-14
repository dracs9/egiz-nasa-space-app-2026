import { describe, expect, it } from 'vitest';
import { applyHonestObjectiveNames, honestObjectiveName, vegetationFlag } from './honesty';
import templates from '../../../data/pilot/mission_templates.json';
import candidates from '../../../data/pilot/earth_candidates.json';
import type { MissionTemplates } from '../types/contracts';

describe('display honesty rules', () => {
  it('renames geology objectives scored only from exposure and relief', () => {
    expect(honestObjectiveName('Field geology', ['bare_frac', 'relief_m'])).toBe('Exposure & relief (geology proxy)');
    expect(honestObjectiveName('EVA and field geology', ['frac_lt20_r', 'relief_m', 'bare_frac'])).toBe('EVA terrain: exposure & relief (geology proxy)');
    expect(honestObjectiveName('Field geology', ['bare_frac', 'geology'])).toBe('Field geology');
    expect(honestObjectiveName('Rover routes', ['relief_m'])).toBe('Rover routes');
    const t = applyHonestObjectiveNames(structuredClone(templates) as unknown as MissionTemplates);
    const names = t.templates.flatMap(x => x.objectives.map(o => o.name));
    expect(names.some(n => /geolog/i.test(n) && !/proxy/.test(n))).toBe(false);
    const m3 = t.templates.flatMap(x => x.objectives).find(o => o.id === 'M3') as { name: string; source_name?: string };
    expect(m3.source_name).toBe('Field geology');
  });
  it('flags pilot windows with little bare ground from their own land-cover values', () => {
    const tiles = (candidates as unknown as { tiles: { id: string; attrs: Record<string, number | null>; context: Record<string, number | null> }[] }).tiles;
    const flag = (id: string) => { const x = tiles.find(t => t.id === id)!; return vegetationFlag(x.attrs, x.context); };
    expect(flag('PILOT_RIO_TINTO')?.label).toBe('mostly vegetated');
    expect(flag('PR_JETT_SP_CRATER')).not.toBeNull();
    expect(flag('PILOT_WADI_RUM')).toBeNull();
    expect(vegetationFlag({ bare_frac: null })).toBeNull();
  });
});
