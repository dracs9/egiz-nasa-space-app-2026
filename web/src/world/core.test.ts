// @vitest-environment node
// World core: codec, coordinates (Python parity), tile pyramid, seams, LOD, geometry, illumination.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestWorld } from './testing';
import type { World } from './core/world';
import { aeqdToEnu, aeqdToLonLat, enuToAeqd, lonLatToAeqd, lunarLocalTime } from './core/coordinates';
import { decodeElevation } from './core/codec';
import { slopeAt, profile, lineOfSight, fitPlane, roughnessAt } from './analysis/terrain';
import { bodiesAt, diskFraction, nextLocalNoon, sunVisibleFraction, horizonClearance, SUN_ANGULAR_RADIUS_RAD } from './analysis/illumination';
import { buildTileGeometry, selectTiles, screenSpaceError, tileBounds, toThree } from './render/tiles';

let w: World;
beforeAll(async () => { w = await loadTestWorld(); await w.ensureOperational(); }, 60000);
const R = 1737400;

describe('coordinates', () => {
  // Reference values from pipeline/world/geodesy.py (whose inverse AEQD matches pyproj to 1e-12°).
  const ref = [[1000, 2000, 5000, 1002.8775866097487, 2005.7551732194975, 4998.556927412981, 32.150472638298424, -85.36050455086426], [-7000, 6500, 4200.5, -7016.888498584135, 6515.682177256696, 4174.176072272006, 28.979135715347866, -85.20667090268871]];
  it('matches the Python geodesy (ENU with curvature, inverse AEQD)', () => {
    for (const [x, y, h, e, n, u, lon, lat] of ref) {
      const p = aeqdToEnu(x, y, h, R), ll = aeqdToLonLat(x, y, 31.7427611534, -85.4265772804, R);
      expect(p.e).toBeCloseTo(e, 6); expect(p.n).toBeCloseTo(n, 6); expect(p.u).toBeCloseTo(u, 6);
      expect(ll.lon).toBeCloseTo(lon, 9); expect(ll.lat).toBeCloseTo(lat, 9);
    }
  });
  it('round-trips map ↔ ENU and lon/lat ↔ map', () => {
    for (const [x, y, h] of [[0, 0, 0], [7600, -7600, 6000], [-3000, 120, 1500]]) {
      const p = aeqdToEnu(x, y, h, R), back = enuToAeqd(p.e, p.n, p.u, R);
      expect(back.x).toBeCloseTo(x, 6); expect(back.y).toBeCloseTo(y, 6); expect(back.h).toBeCloseTo(h, 6);
      const ll = aeqdToLonLat(x, y, 31.74, -85.43, R), m = lonLatToAeqd(ll.lon, ll.lat, 31.74, -85.43, R);
      expect(m.x).toBeCloseTo(x, 5); expect(m.y).toBeCloseTo(y, 5);
    }
  });
  it('applies the spherical curvature drop (≈ r²/2R)', () => {
    expect(aeqdToEnu(7680, 0, 0, R).u).toBeCloseTo(-(7680 ** 2) / (2 * R), 1);
  });
  it('computes lunar local time from the Sun azimuth', () => {
    expect(lunarLocalTime(0, true)).toBeCloseTo(12); expect(lunarLocalTime(90, true)).toBeCloseTo(6); expect(lunarLocalTime(270, true)).toBeCloseTo(18);
    expect(lunarLocalTime(180, false)).toBeCloseTo(12); expect(lunarLocalTime(90, false)).toBeCloseTo(6);
  });
});

describe('world package and tile pyramid', () => {
  it('is measured, versioned and complete', () => {
    const m = w.manifest;
    expect(m.synthetic).toBe(false);
    expect(m.pyramid.postingsM).toEqual([160, 80, 40, 20, 10, 5]);
    expect(m.pyramid.tiles.length).toBe(1 + 4 + 16 + 64 + 36 + 144);
    expect(m.source.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('decodes tiles inside their recorded range and quantization', async () => {
    const t = await w.tile('5/9_9');
    expect(t.n).toBe(99);
    let min = Infinity, max = -Infinity;
    for (let r = 1; r < 98; r++) for (let c = 1; c < 98; c++) { const v = t.posts[r * 99 + c]; min = Math.min(min, v); max = Math.max(max, v); }
    expect(min).toBeCloseTo(t.desc.minH, 1); expect(max).toBeCloseTo(t.desc.maxH, 1);
    expect(t.posts.every(Number.isFinite)).toBe(true);
  });
  it('rejects a wrong magic header', () => { expect(() => decodeElevation(new Uint8Array(64))).toThrow(/EGT1/); });
  it('has continuous seams: shared posts of same-level neighbours are identical', async () => {
    const a = await w.tile('5/9_9'), b = await w.tile('5/10_9'), c = await w.tile('5/9_10');
    for (let r = 1; r < 98; r++) expect(Math.abs(a.posts[r * 99 + 97] - b.posts[r * 99 + 1])).toBeLessThan(1e-6);
    for (let k = 1; k < 98; k++) expect(Math.abs(a.posts[97 * 99 + k] - c.posts[99 + k])).toBeLessThan(1e-6);
  });
  it('reports geometric error that shrinks with level and is zero at native posting', () => {
    const median = (l: number) => { const v = w.manifest.pyramid.tiles.filter(t => t.level === l).map(t => t.geometricErrorMax).sort((a, b) => a - b); return v[v.length >> 1]; };
    for (let l = 1; l < 6; l++) expect(median(l)).toBeLessThan(median(l - 1));
    expect(median(5)).toBe(0);
  });
  it('samples heights bilinearly and exactly at posts', async () => {
    const t = await w.tile('5/9_9');
    const x = t.desc.west + 10 * 5, y = t.desc.north - 20 * 5;
    expect(w.heightAt(x, y)).toBeCloseTo(t.posts[21 * 99 + 11], 4);
    expect(w.analysisLevel({ x, y })).toBe(5);
    expect(w.analysisLevel({ x: 6000, y: -6000 })).toBe(3);
    expect(w.heightAt(9000, 0)).toBeNull();
  });
});

describe('terrain analysis', () => {
  it('derives slope with central differences on the analysis surface', () => {
    const s = slopeAt(w, -1600, 2100)!;
    const h = (dx: number, dy: number) => w.heightAt(-1600 + dx, 2100 + dy)!;
    const gx = (h(5, 0) - h(-5, 0)) / 10, gy = (h(0, 5) - h(0, -5)) / 10;
    expect(s.slopeDeg).toBeCloseTo(Math.atan(Math.hypot(gx, gy)) * 180 / Math.PI, 9);
    expect(s.baselineM).toBe(5);
  });
  it('fits planes and computes roughness and profiles', () => {
    const p = fitPlane([[0, 0, 1], [1, 0, 3], [0, 1, 5], [1, 1, 7]]);
    expect(p.a).toBeCloseTo(2); expect(p.b).toBeCloseTo(4); expect(p.c).toBeCloseTo(1);
    expect(roughnessAt(w, -1600, 2100)).toBeGreaterThan(0);
    const pr = profile(w, [{ x: -2000, y: 2000 }, { x: -1000, y: 2000 }]);
    expect(pr.length).toBeCloseTo(1000); expect(pr.points.length).toBeGreaterThan(190);
    expect(pr.ascent - pr.descent).toBeCloseTo(pr.points.at(-1)!.h - pr.points[0].h, 6);
  });
  it('computes line of sight', () => {
    const tall = lineOfSight(w, { x: -2000, y: 2000 }, { x: -1000, y: 2500 }, 2000, 2000)!;
    expect(tall.visible).toBe(true); expect(tall.minClearanceM).toBeGreaterThan(0);
    const low = lineOfSight(w, { x: -2000, y: 2000 }, { x: -1000, y: 2500 }, 0.1, 0.1)!;
    expect(low.minClearanceM).toBeLessThan(tall.minClearanceM);
  });
});

describe('SPICE illumination and shadows', () => {
  it('interpolates recorded vectors exactly at samples and rejects out-of-record times', () => {
    const s = w.illumination.samples[10], b = bodiesAt(w.illumination, s[0]);
    expect(b.sun[0]).toBeCloseTo(s[1], 8); expect(b.sun[2]).toBeCloseTo(s[3], 8);
    expect(() => bodiesAt(w.illumination, -1)).toThrow(); expect(() => bodiesAt(w.illumination, w.illumination.duration + 10)).toThrow();
  });
  it('finds local noon as the maximum Sun elevation', () => {
    const t = nextLocalNoon(w.illumination, 0), el = bodiesAt(w.illumination, t).sunElevationDeg;
    expect(el).toBeGreaterThanOrEqual(Math.max(...w.illumination.samples.map(s => Math.asin(s[3]) * 180 / Math.PI)) - 1e-6);
  });
  it('models the solar disk partially occluded by the horizon', () => {
    expect(diskFraction(1, SUN_ANGULAR_RADIUS_RAD)).toBe(1); expect(diskFraction(-1, SUN_ANGULAR_RADIUS_RAD)).toBe(0);
    expect(diskFraction(0, SUN_ANGULAR_RADIUS_RAD)).toBeCloseTo(0.5, 9);
  });
  it('lights a zenith Sun and shadows a Sun below the horizon', () => {
    const h = w.heightAt(-1600, 2100)!;
    expect(sunVisibleFraction(w, -1600, 2100, h, [0, 0, 1])).toBe(1);
    expect(sunVisibleFraction(w, -1600, 2100, h, [0, 0.999, -0.04])).toBe(0);
    // A grazing Sun toward rising terrain is occluded: clearance decreases as the Sun lowers.
    const hi = horizonClearance(w, -1600, 2100, h, [0, Math.cos(0.05), Math.sin(0.05)]), lo = horizonClearance(w, -1600, 2100, h, [0, Math.cos(0.01), Math.sin(0.01)]);
    expect(hi).toBeGreaterThan(lo);
  });
});

describe('render tiles and LOD', () => {
  it('builds crack-free, curvature-correct geometry with unit normals', async () => {
    const a = await w.tile('5/9_9'), b = await w.tile('5/10_9');
    const ga = buildTileGeometry(w, a, 4), gb = buildTileGeometry(w, b, 4), side = 97;
    expect(ga.vertexCount).toBe(side * side + 4 * 96);
    for (let r = 0; r < side; r++) {
      const ia = (r * side + 96) * 3, ib = (r * side) * 3;
      for (let k = 0; k < 3; k++) expect(ga.positions[ia + k]).toBeCloseTo(gb.positions[ib + k], 2);
      for (let k = 0; k < 3; k++) expect(ga.normals[ia + k]).toBeCloseTo(gb.normals[ib + k], 2);
    }
    for (let i = 0; i < side * side; i++) expect(Math.hypot(ga.normals[i * 3], ga.normals[i * 3 + 1], ga.normals[i * 3 + 2])).toBeCloseTo(1, 5);
    const [x, y, z] = toThree(...Object.values(aeqdToEnu(a.desc.west, a.desc.north, a.posts[100], R)) as [number, number, number]);
    expect(ga.positions[0]).toBeCloseTo(x, 2); expect(ga.positions[1]).toBeCloseTo(y, 2); expect(ga.positions[2]).toBeCloseTo(z, 2);
  });
  it('selects finer levels near the camera and never leaves holes while streaming', () => {
    const loaded = new Set(w.manifest.pyramid.tiles.map(t => t.key));
    const target = aeqdToEnu(-1600, 2100, w.heightAt(-1600, 2100)! + 200, R);
    const near = selectTiles(w, { position: toThree(target.e, target.n, target.u), fovYRad: 0.73, viewportHeightPx: 900 }, 2, k => loaded.has(k));
    expect(near.maxLevel).toBe(5);
    const far = selectTiles(w, { position: [0, 60000, 0], fovYRad: 0.73, viewportHeightPx: 900 }, 2, k => loaded.has(k));
    expect(far.maxLevel).toBeLessThan(3);
    // Only the root is loaded: the root is rendered and its children are requested.
    const cold = selectTiles(w, { position: toThree(target.e, target.n, target.u), fovYRad: 0.73, viewportHeightPx: 900 }, 2, k => k === '0/0_0');
    expect(cold.render.map(t => t.key)).toEqual(['0/0_0']); expect(cold.request.length).toBe(4);
    expect(screenSpaceError(10, 1000, { position: [0, 0, 0], fovYRad: Math.PI / 2, viewportHeightPx: 1000 })).toBeCloseTo(5);
    const b = tileBounds(w, w.descriptor('0/0_0')!);
    expect(b.max[1]).toBeGreaterThan(b.min[1]);
  });
});
