// AI-assisted test; human review pending.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadCinema, windowAlpha } from './cinema';

describe('cinema windows', () => {
  it('fades in and out softly, and the hero window opens at once', () => {
    expect(windowAlpha([1, 2], .5)).toBe(0);
    expect(windowAlpha([1, 2], 1.5)).toBe(1);
    expect(windowAlpha([1, 2], 1.035)).toBeCloseTo(.5, 2);
    expect(windowAlpha([0, .5], 0)).toBe(1);
    expect(windowAlpha([0, .5], .6)).toBe(0);
  });
});

describe('loadCinema', () => {
  afterEach(() => vi.unstubAllGlobals());
  const manifest = { scenes: [
    { id: 'A', base: 'hero/a', mode: 'handoff', window: [0, .5] },
    { id: 'B', base: 'mars/b', mode: 'plate', window: [3, 3.5] },
  ] };
  it('keeps only scenes whose media really exists (an HTML fallback page is not a video)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const type = url.endsWith('manifest.json') ? 'application/json'
        : url.endsWith('hero/a-1080.mp4') ? 'video/mp4' : url.endsWith('hero/a.jpg') ? 'image/jpeg' : 'text/html';
      return { ok: true, headers: new Headers({ 'content-type': type }), json: async () => manifest } as unknown as Response;
    }));
    const found = await loadCinema(new AbortController().signal);
    expect(found.map(f => f.id)).toEqual(['A']);
    expect(found[0].sources.map(s => s.src)).toEqual([expect.stringMatching(/hero\/a-1080\.mp4$/)]);
    expect(found[0].still).toMatch(/hero\/a\.jpg$/);
  });
});
