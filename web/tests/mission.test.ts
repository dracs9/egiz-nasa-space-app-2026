// EGIZ · tests for the connected mission layer: the mission record as shared context (world, site, journey),
// starting another world, changing the site and flagging what went out of date, the expedition URL, the workspace
// registry and record compatibility. Uses the real measured discovery index where the build packages it.
// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DiscoveryBundle } from '../src/discover/types';
import { newInvestigation, parseInvestigation, serializeInvestigation, weightsKey, type AnalysisRecord } from '../src/planet/workspace/investigation';
import { usePlanet } from '../src/planet/workspace/store';
import { resumeStep, staleItems, stepState } from '../src/expedition/journey';
import { readExpeditionUrl, writeExpeditionUrl } from '../src/expedition/url';
import { SECTION_OF, WORKSPACES } from '../src/expedition/nav';
import { challenges } from '../src/expedition/steps/SiteStep';
import { knownUnknown } from '../src/planet/journey/knowledge';

const DATA = path.resolve(__dirname, '../../data'), has = existsSync(path.join(DATA, 'discovery/discovery.json'));
const bundle = has ? JSON.parse(readFileSync(path.join(DATA, 'discovery/discovery.json'), 'utf8')) as DiscoveryBundle : null;
const run = has ? describe : describe.skip;
const fresh = () => { localStorage.clear(); usePlanet.getState().newInvestigation(); usePlanet.getState().set({ bundle }); };
const record = (target: string): AnalysisRecord => ({ target, profile: 'general', weightsKey: weightsKey(usePlanet.getState().weights()), ranUtc: '2026-11-14T00:00:00Z', bundleSha: 'x', top10: ['A'], verdict: 'supported', steps: [], findings: [] });

run('mission context', () => {
  beforeEach(fresh);
  it('choosing a world starts a titled mission and logs it', () => {
    usePlanet.getState().chooseWorld('mars');
    const s = usePlanet.getState();
    expect(s.world()).toBe('mars'); expect(s.inv.title).toBe('Mars mission'); expect(s.inv.trail?.at(-1)?.kind).toBe('world');
    expect(s.target()?.id).toBe('MARS_JEZERO'); // default site while none is chosen
  });
  it('another world with work in progress opens a new record and keeps the old one saved', () => {
    const s = usePlanet.getState(); s.chooseWorld('mars'); s.investigate('MARS_GALE');
    const marsId = usePlanet.getState().inv.id;
    usePlanet.getState().chooseWorld('moon');
    const after = usePlanet.getState();
    expect(after.inv.id).not.toBe(marsId); expect(after.world()).toBe('moon'); expect(after.inv.target).toBeNull();
    expect(after.saved.some(e => e.id === marsId)).toBe(true);
    expect(usePlanet.getState().openInvestigation(marsId)).toBeNull();
    expect(usePlanet.getState().inv.target).toBe('MARS_GALE');
  });
  it('choosing the same world again keeps the mission', () => {
    const s = usePlanet.getState(); s.chooseWorld('moon'); s.investigate('MOON_MONS_MOUTON'); const id = usePlanet.getState().inv.id;
    usePlanet.getState().chooseWorld('moon');
    expect(usePlanet.getState().inv.id).toBe(id); expect(usePlanet.getState().inv.target).toBe('MOON_MONS_MOUTON');
  });
  it('changing the site records the alternative and flags the analysis and analogs as stale', () => {
    const s = usePlanet.getState(); s.chooseWorld('mars'); s.investigate('MARS_JEZERO');
    usePlanet.getState().patchInv({ analysis: record('MARS_JEZERO') });
    usePlanet.getState().toggleCandidate('W1');
    expect(stepState('analysis', usePlanet.getState())).toBe('done');
    expect(stepState('analogs', usePlanet.getState())).toBe('done');
    expect(staleItems(usePlanet.getState())).toEqual([]);
    usePlanet.getState().investigate('MARS_GALE', 'switch');
    const after = usePlanet.getState();
    expect(after.inv.considered).toEqual(expect.arrayContaining(['MARS_JEZERO', 'MARS_GALE']));
    expect(after.inv.trail?.at(-1)?.kind).toBe('switch');
    expect(stepState('analysis', after)).toBe('stale'); expect(stepState('analogs', after)).toBe('stale');
    expect(staleItems(after).map(x => x.fix.step)).toEqual(['analysis', 'analogs']);
    expect(after.inv.candidates).toEqual(['W1']); // kept, not silently deleted
  });
  it('resumes at the first unfinished step and records journey progress', () => {
    const s = usePlanet.getState(); s.chooseWorld('mars');
    expect(resumeStep(usePlanet.getState())).toBe('explore');
    usePlanet.getState().investigate('MARS_JEZERO'); usePlanet.getState().reach('site');
    expect(resumeStep(usePlanet.getState())).toBe('analysis');
    usePlanet.getState().reach('analysis'); usePlanet.getState().enterHome();
    const j = usePlanet.getState().inv.journey!;
    expect(j.reached).toEqual(['site', 'analysis']); expect(j.homeUtc).toBeTruthy();
  });
});

run('site challenges', () => {
  it('are stated from the fingerprint with their thresholds', () => {
    const mouton = bundle!.targets.find(t => t.id === 'MOON_MONS_MOUTON')!, ch = challenges(mouton, knownUnknown(bundle!, mouton), true);
    expect(ch.find(c => c.title === 'The Sun stays low')?.text).toMatch(/never rises above \d/);
    for (const c of ch) expect(c.text).not.toMatch(/NaN|undefined/);
  });
});

describe('expedition URL', () => {
  it('reads and writes body, step and site in the hash without dropping other keys', () => {
    window.location.hash = '#/explore?data=pilot&k=3';
    writeExpeditionUrl({ body: 'moon', step: 'analysis', site: 'MOON_MONS_MOUTON' });
    expect(readExpeditionUrl()).toEqual({ body: 'moon', step: 'analysis', site: 'MOON_MONS_MOUTON' });
    expect(window.location.hash).toContain('data=pilot');
    window.location.hash = '#/explore?body=venus&step=nowhere';
    expect(readExpeditionUrl()).toEqual({ body: null, step: null, site: null });
  });
});

describe('workspace registry', () => {
  it('names every required section once, with Mission Home first', () => {
    const routes = WORKSPACES.map(w => w.route);
    expect(routes[0]).toBe('mission'); expect(new Set(routes).size).toBe(routes.length);
    for (const r of ['explore', 'discover', 'atlas', 'astral', 'studio', 'lab', 'campaign', 'evidence', 'home'] as const) expect(routes).toContain(r);
    expect(SECTION_OF.brief).toBe('campaign');
  });
});

describe('mission record compatibility', () => {
  it('accepts records without journey fields and rejects a malformed journey', () => {
    const inv = newInvestigation('Old', '2026-01-01T00:00:00Z');
    expect(parseInvestigation(serializeInvestigation(inv)).journey).toBeUndefined();
    const ok = { ...inv, journey: { step: 'analysis', reached: ['site'] } };
    expect(parseInvestigation(JSON.stringify(ok)).journey?.step).toBe('analysis');
    expect(() => parseInvestigation(JSON.stringify({ ...inv, journey: { step: 'warp', reached: [] } }))).toThrow(/journey/);
  });
});

describe('surface enhancement window', async () => {
  const { windowFor } = await import('../src/expedition/enhance');
  it('is centred on the place and widens in longitude toward the poles', () => {
    const eq = windowFor(18.44, 77.45, 4096, 2048, 128), polar = windowFor(-85.43, 31.74, 4096, 2048, 128);
    expect((eq.box.latMin + eq.box.latMax) / 2).toBeCloseTo(18.44, 6); expect((eq.box.lonMin + eq.box.lonMax) / 2).toBeCloseTo(77.45, 6);
    expect(eq.box.latMax - eq.box.latMin).toBeCloseTo(11.25, 6); expect(eq.h).toBe(128);
    expect(polar.box.lonMax - polar.box.lonMin).toBeGreaterThan(eq.box.lonMax - eq.box.lonMin);
    expect(polar.w).toBeLessThanOrEqual(256);
  });
  it('never crosses a pole', () => {
    const p = windowFor(-89.8, -171.9, 4096, 2048, 128);
    expect(p.box.latMin).toBe(-90); expect(p.box.latMax - p.box.latMin).toBeCloseTo(11.25, 6);
  });
});
