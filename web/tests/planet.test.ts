// EGIZ Planetary Studio · scientific and integration tests (Phase II).
// Real-data cases read the packaged world, discovery and ATLAS-Π files; synthetic arrays appear only as analytic
// reference inputs with known answers.
// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { localToLatLon, type WorldManifest } from "../src/astral/world/core";
import { sample, slopeDeg, type Field } from "../src/astral/world/field";
import { coarsen, curvatureRaster, histogram, insolation, mobilityClasses, roughnessRaster, shadowRaster, slopeAspect, stats, summarize, sunVisible, tpiRaster, wasserstein1 } from "../src/planet/terrain/derive";
import { decodeTerrarium, mercatorPixel, streamEarthField, streamEarthSite, zoomFor } from "../src/planet/terrain/earthStream";
import { fieldSource, heightAt, listSites, loadSite, siteLatLon, siteLocal, type Site } from "../src/planet/terrain/site";
import { analyticSunEarth, beamTransmission, sunAt, sunSteps } from "../src/planet/terrain/solar";
import { acrossBodies, buildRover, compareRuns, cropField, defaultConfig, fingerprint, reproduce, runTwin, sensitivity, toExperiment, twinSite, type MissionPlan } from "../src/planet/twin/twin";
import { drive, ROVERS, SOILS } from "../src/astral/sim/terramechanics";
import { adjustedRand, eigenSym, fitCandidateSpace, kmeans, mahalanobis, mmr, mulberry32, pca, silhouette, standardize } from "../src/planet/intel/ml";
import { ask, callIntel, planQuestion, rankingStability, review, type IntelContext } from "../src/planet/intel/engine";
import { computeSite, runJob } from "../src/planet/compute";
import { colorize, colorizeClasses } from "../src/planet/render/colormaps";
import { buildReport, candidateFeatures, FEATURES, parseInvestigation, serializeInvestigation, newInvestigation } from "../src/planet/workspace/investigation";
import type { ToolContext } from "../src/discover/copilot";
import type { DiscoveryBundle, ScoreShard, ValidationDoc } from "../src/discover/types";
import type { AtlasBundle } from "../src/atlas/types";

const DATA = path.resolve(__dirname, "../../data"), HAS = (p: string) => existsSync(path.join(DATA, p));
const analytic = (side: number, posting: number, f: (x: number, y: number) => number): Field => {
  const half = ((side - 1) * posting) / 2, z = new Float32Array(side * side);
  for (let r = 0; r < side; r++) for (let c = 0; c < side; c++) z[r * side + c] = f(-half + c * posting, half - r * posting);
  return { side, posting, west: -half, north: half, z, level: 0, provenance: "measured" };
};
const at = (f: Field, x: number, y: number) => Math.round((f.north - y) / f.posting) * f.side + Math.round((x - f.west) / f.posting);

beforeAll(() => {
  // Serve data/world as the app's /world/ path (copy-world.mjs publishes it there; index.json is rebuilt the same way).
  vi.stubGlobal("fetch", async (url: string) => {
    const rel = String(url).replace(/^\/?world\//, "");
    if (rel === "index.json") return new Response(JSON.stringify({ sites: ["earth-gx_e088.238_n37.969", "earth-pilot_boszhira", "mars-jezero"].filter(d => HAS(`world/${d}/manifest.json`)).map(dir => ({ dir })) }));
    const file = path.join(DATA, "world", rel);
    if (!existsSync(file)) return new Response("missing", { status: 404 });
    const b = readFileSync(file); return new Response(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  });
});
afterAll(() => vi.unstubAllGlobals());

describe("terrain-derived products against analytic references", () => {
  const plane = analytic(65, 10, (x, y) => 100 + 0.2 * x + 0.1 * y);
  it("slope and aspect of a plane are exact", () => {
    const { slope, aspect } = slopeAspect(plane, 10), i = at(plane, 0, 0);
    expect(slope.data[i]).toBeCloseTo((Math.atan(Math.hypot(0.2, 0.1)) * 180) / Math.PI, 4);
    // Downslope points toward decreasing z: (−0.2, −0.1) → azimuth atan2(−0.2, −0.1) = 243.43°.
    expect(aspect.data[i]).toBeCloseTo(243.435, 2);
    expect(slope.data[0]).toBeNaN(); // no central difference on the border: not extrapolated
    expect(slopeAspect(plane, 40).slope.baselineM).toBe(40);
  });
  it("roughness and TPI of a plane vanish; a paraboloid has Laplacian 4k", () => {
    const i = at(plane, 50, -50);
    expect(roughnessRaster(plane, 2).data[i]).toBeLessThan(1e-3);
    expect(Math.abs(tpiRaster(plane, 50).data[i])).toBeLessThan(1e-3);
    const bowl = analytic(65, 10, (x, y) => 0.001 * (x * x + y * y));
    expect(curvatureRaster(bowl, 10).data[at(bowl, 30, 30)]).toBeCloseTo(0.004, 5);
    expect(tpiRaster(bowl, 50).data[at(bowl, 0, 0)]).toBeLessThan(0); // the floor lies below its neighbourhood mean
  });
  it("roughness equals the RMS of a known residual", () => {
    const f = analytic(33, 1, (x, y) => 0.3 * x + ((Math.round(x) + Math.round(y)) % 2 === 0 ? 0.05 : -0.05));
    expect(roughnessRaster(f, 2).data[at(f, 0, 0)]).toBeGreaterThan(0.045);
    expect(roughnessRaster(f, 2).data[at(f, 0, 0)]).toBeLessThan(0.055);
  });
  it("missing data propagates instead of being filled", () => {
    const f = analytic(33, 5, x => x); f.z[at(f, 0, 0)] = NaN;
    expect(slopeAspect(f).slope.data[at(f, 5, 0)]).toBeNaN();
    expect(roughnessRaster(f, 2).data[at(f, 5, 5)]).toBeNaN();
    expect(stats(f.z).valid).toBe(33 * 33 - 1);
    expect(mobilityClasses(slopeAspect(f).slope, roughnessRaster(f, 2), { maxSlopeDeg: 20, maxStepM: 0.3 })[at(f, 5, 0)]).toBe(255);
  });
  it("statistics, histogram and Wasserstein distance", () => {
    const a = Float32Array.from({ length: 1000 }, (_, i) => i / 100), b = a.map(v => v + 2.5);
    expect(wasserstein1(a, b)).toBeCloseTo(2.5, 6);
    expect(wasserstein1(a, a)).toBe(0);
    expect(stats(a).p50).toBeCloseTo(5, 1);
    expect(histogram(a, 0, 10, 10).reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
  });
  it("a ridge of height H casts a shadow H / tan(elevation) long", () => {
    // 40 m wall along x ∈ [0, 10]; Sun due east at 20° elevation → shadow reaches 40 / tan 20° = 109.9 m west of the wall.
    const f = analytic(201, 5, x => (x >= 0 && x <= 10 ? 40 : 0)), el = (20 * Math.PI) / 180, sun = [Math.cos(el), 0, Math.sin(el)];
    const lit = (x: number) => sunVisible(f, 40, x, 0, 0, sun, 1e12);
    expect(lit(-90)).toBe(false); expect(lit(-125)).toBe(true); expect(lit(60)).toBe(true);
    const m = shadowRaster(f, f, sun, 1e12, 1);
    expect(m.data[at(f, -60, 100)]).toBe(1); expect(m.data[at(f, -200, 100)]).toBe(0);
    expect(shadowRaster(f, f, [0.9, 0, -0.1], 1e12, 4).data.every(v => v === 1)).toBe(true); // Sun below the horizon
  });
  it("body curvature lowers distant relief: a far ridge shadows on a flat plane but not on a small sphere", () => {
    const f = analytic(401, 25, x => (x > 4000 ? 60 : 0)), el = (0.5 * Math.PI) / 180, sun = [Math.cos(el), 0, Math.sin(el)];
    expect(sunVisible(f, 60, -4000, 0, 0, sun, 1e12)).toBe(true); // 8 km away the 0.5° ray is already 70 m up: above the 60 m ridge
    expect(sunVisible(f, 60, 0, 0, 0, sun, 1e12)).toBe(false); // 4 km away: ray height 35 m < 60 m → shadowed on a plane
    expect(sunVisible(f, 60, 0, 0, 0, sun, 100000)).toBe(true); // on a 100 km body the ridge drops 80 m below the tangent plane
  });
  it("insolation on a horizontal plane is flux × sin(elevation)", () => {
    const flat = analytic(33, 10, () => 5), el = (30 * Math.PI) / 180, r = insolation(flat, flat, [{ sunEnu: [0, Math.cos(el), Math.sin(el)], fluxWm2: 1000, transmission: 1 }, { sunEnu: [0, 0.99, -0.14], fluxWm2: 1000, transmission: 1 }], 1e12, 4);
    expect(r.lit.data[10]).toBeCloseTo(0.5, 9); expect(r.irradiance.data[10]).toBeCloseTo(250, 3); // one of two samples lit
    const tilt = analytic(33, 10, (_x, y) => 0.5774 * y); // faces south at 30°: Sun from the north at 30° is grazing-perpendicular
    expect(insolation(tilt, tilt, [{ sunEnu: [0, -Math.cos(el), Math.sin(el)], fluxWm2: 1000, transmission: 1 }], 1e12, 4).irradiance.data[20]).toBeCloseTo(1000 * Math.cos((30 * Math.PI) / 180), 0);
  });
  it("summaries are comparable only at a common posting", () => {
    const fine = analytic(257, 4, (x, y) => 20 * Math.sin(x / 30) * Math.cos(y / 40)), coarse = coarsen(fine, 8);
    expect(coarse.posting).toBe(32); expect(coarse.side).toBe(33);
    expect(summarize(coarse, 32).slope.p90).toBeLessThan(summarize(fine, 4).slope.p90); // averaging removes fine slope
    expect(summarize(fine, 4).slopeHist.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });
  it("colour scales mark no-data as transparent", () => {
    const rgba = colorize(Float32Array.from([0, NaN, 1]), "viridis", 0, 1);
    expect([rgba[3], rgba[7], rgba[11]]).toEqual([255, 0, 255]);
    expect(colorizeClasses(Uint8Array.from([0, 2, 255]), [null, null, [200, 40, 40, 255]])[7]).toBe(255);
  });
});

describe("Sun geometry", () => {
  it("the analytic ephemeris agrees with the packaged CSPICE record", () => {
    if (!HAS("world/earth-pilot_boszhira/illumination.json")) return;
    const rec = JSON.parse(readFileSync(path.join(DATA, "world/earth-pilot_boszhira/illumination.json"), "utf8")); let worst = 0, worstAz = 0;
    for (const s of rec.samples) {
      const a = analyticSunEarth(new Date(Date.parse(rec.epochUtc) + s.t * 1000), rec.lat, rec.lon);
      worst = Math.max(worst, Math.abs(a.elevationDeg - s.elevationDeg));
      if (Math.abs(s.elevationDeg) < 60) worstAz = Math.max(worstAz, Math.abs(((a.azimuthDeg - s.azimuthDeg + 540) % 360) - 180) * Math.cos((s.elevationDeg * Math.PI) / 180));
      expect(Math.abs(a.fluxWm2 - s.solarFluxWm2)).toBeLessThan(3);
    }
    expect(worst).toBeLessThan(0.3); expect(worstAz).toBeLessThan(0.3);
  });
  it("known cases: equinox noon on the equator, polar night", () => {
    expect(analyticSunEarth(new Date("2026-03-20T12:07:00Z"), 0, 0).elevationDeg).toBeGreaterThan(88);
    expect(analyticSunEarth(new Date("2026-12-21T12:00:00Z"), 80, 0).elevationDeg).toBeLessThan(0);
    const s = analyticSunEarth(new Date("2026-06-21T06:00:00Z"), 45, 0);
    expect(Math.hypot(...s.sunEnu)).toBeCloseTo(1, 9); expect(s.sunEnu[0]).toBeGreaterThan(0); // morning Sun is in the east
  });
  it("beam transmission is bounded and ordered", () => {
    expect(beamTransmission("moon", 5)).toBe(1); expect(beamTransmission("mars", -1)).toBe(0);
    expect(beamTransmission("mars", 60)).toBeGreaterThan(beamTransmission("mars", 10));
    expect(beamTransmission("earth", 90)).toBeCloseTo(0.7, 6);
  });
});

describe("streamed Earth terrain georeferencing", () => {
  const truth = (lat: number, lon: number) => 800 + 300 * Math.sin((lat * Math.PI) / 180 * 400) + 200 * Math.cos((lon * Math.PI) / 180 * 300);
  const fake = async (z: number, x: number, y: number) => {
    const out = new Float32Array(256 * 256), n = 256 * 2 ** z;
    for (let r = 0; r < 256; r++) for (let c = 0; c < 256; c++) { const px = x * 256 + c + 0.5, py = y * 256 + r + 0.5; out[r * 256 + c] = truth((Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / n))) * 180) / Math.PI, (px / n) * 360 - 180); }
    return out;
  };
  it("Web-Mercator tiles are resampled onto the local metric grid at the right places", async () => {
    const lat = 43.4, lon = 54.2, { field, meta } = await streamEarthField(lat, lon, { fetchTile: fake, side: 129, postingM: 64 });
    const site = { lat, lon, radius_m: 6371008.8 } as WorldManifest["site"]; let worst = 0;
    for (const [x, y] of [[0, 0], [-4096, 4096], [4096, -4096], [1280, 640], [-3000, -2500]]) { const ll = localToLatLon(site, x, y); worst = Math.max(worst, Math.abs(sample(field, { x, y })! - truth(ll.lat, ll.lon))); }
    expect(worst).toBeLessThan(0.5); // smooth truth, sub-pixel registration
    expect(meta.groundResolutionM).toBeLessThanOrEqual(64); expect(meta.tiles.length).toBeGreaterThan(0); expect(meta.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("terrarium decoding, tile addressing and zoom selection", () => {
    expect(Array.from(decodeTerrarium(Uint8Array.from([128, 0, 0, 255, 131, 232, 128, 255])))).toEqual([0, 1000.5]);
    expect(mercatorPixel(0, 0, 0)).toEqual({ px: 128, py: 128 });
    expect(zoomFor(0, 32)).toBe(13); expect(zoomFor(60, 32)).toBe(12);
    return expect(streamEarthField(88, 0, { fetchTile: fake })).rejects.toThrow(/84/);
  });
  it("a streamed site is a complete, labelled Site", async () => {
    const s = await streamEarthSite("KZ_TEST", "Test window", 43.4, 54.2, { fetchTile: fake, epochUtc: "2026-11-14T00:00:00Z" });
    expect(s.provenance.delivery).toBe("streamed"); expect(s.sun!.engine).toMatch(/^Analytic/); expect(s.sun!.engine).not.toMatch(/CSPICE/); expect(s.field.side).toBe(513);
    expect(s.tiles.maxLevel).toBe(2); expect(s.tiles.children(s.tiles.roots[0])).toHaveLength(4);
    const leaf = s.tiles.children(s.tiles.children(s.tiles.roots[0])[3])[3], h = await s.tiles.heights(leaf), n = s.tiles.cells + 3;
    expect(leaf.error).toBe(0); expect(h[1 * n + 1]).toBe(sample(s.field, { x: leaf.west, y: leaf.north }));
  });
});

describe("unified site model on the packaged worlds", () => {
  const sites: Record<string, Site> = {};
  const open = async (key: string, format: "scene" | "pyramid") => (sites[key] ??= await loadSite({ key, format }, "/"));
  it("lists every packaged site with its body, posting and discovery link", async () => {
    const refs = await listSites("/");
    if (!HAS("world/mars-jezero/manifest.json")) return;
    expect(refs.find(r => r.key === "mars-jezero")).toMatchObject({ body: "mars", format: "scene", postingM: 1 });
    expect(refs.find(r => r.key === "earth-pilot_boszhira")?.discoveryWindow).toBe("PILOT_BOSZHIRA");
    if (HAS("world/moon-mons-mouton/manifest.json")) expect(refs[0]).toMatchObject({ key: "moon-mons-mouton", body: "moon", format: "pyramid", postingM: 5 });
  });
  it("Mars: analysis grid is the 2 m level, coordinates round-trip, tiles meet exactly at seams", async () => {
    if (!HAS("world/mars-jezero/manifest.json")) return;
    const s = await open("mars-jezero", "scene");
    expect(s.field.posting).toBe(2); expect(s.field.side).toBe(1025); expect(s.imagery).toBe(true); expect(s.sun!.engine).toMatch(/CSPICE/);
    const ll = siteLatLon(s, { x: 500, y: -300 }), back = siteLocal(s, ll.lat, ll.lon);
    expect(back.x).toBeCloseTo(500, 6); expect(back.y).toBeCloseTo(-300, 6);
    const kids = s.tiles.children(s.tiles.roots[0]), n = s.tiles.cells + 3, [a, b] = await Promise.all([s.tiles.heights(kids[0]), s.tiles.heights(kids[1])]);
    for (let r = 1; r < n - 1; r += 16) expect(a[r * n + n - 2]).toBe(b[r * n + 1]); // east edge of the west tile = west edge of the east tile
    expect(kids[0].image).toMatch(/img\/1-0-0\.jpg$/);
  }, 30000);
  it("Earth: the finest level is the analysis grid and is labelled measured", async () => {
    if (!HAS("world/earth-pilot_boszhira/manifest.json")) return;
    const s = await open("earth-pilot_boszhira", "scene");
    expect(s.field.posting).toBe(32); expect(s.field.side).toBe(513); expect(s.field.provenance).toBe("measured"); expect(s.imagery).toBe(false);
    expect(s.provenance.product).toMatch(/Copernicus/); expect(heightAt(s, { x: 0, y: 0 })).not.toBeNull(); expect(heightAt(s, { x: 9000, y: 0 })).toBeNull();
  });
  it("Moon: 5 m analysis grid equals the native tile posts; the horizon grid is the occluder", async () => {
    if (!HAS("world/moon-mons-mouton/manifest.json")) return;
    const s = await open("moon-mons-mouton", "pyramid");
    expect(s.field.posting).toBe(5); expect(s.field.side).toBe(1153); expect(s.context!.posting).toBe(20);
    const leaf = s.tiles.children(s.tiles.roots[0]); expect(leaf).toHaveLength(4);
    let t = s.tiles.roots[0]; while (s.tiles.children(t).length) t = s.tiles.children(t).find(c => c.west <= 0 && c.west + c.size > 0 && c.north >= 0 && c.north - c.size < 0)!;
    expect(t.posting).toBe(5);
    const h = await s.tiles.heights(t), n = s.tiles.cells + 3;
    expect(sample(s.field, { x: t.west + 10 * 5, y: t.north - 20 * 5 })).toBeCloseTo(h[21 * n + 11], 3);
    expect(Math.abs(heightAt(s, { x: 6000, y: 6000 })! - heightAt(s, { x: 6010, y: 6000 })!)).toBeLessThan(40); // context grid outside the operational box
    const el = s.sun!.samples.map(x => x.elevationDeg);
    expect(Math.min(...el)).toBeCloseTo(-3.1247, 2); expect(Math.max(...el)).toBeCloseTo(6.1108, 2);
    expect(s.objects.filter(o => o.kind === "crater").length).toBe(117);
  }, 60000);
  it("compute jobs produce layers, a shadow mask and insolation from real terrain", async () => {
    if (!HAS("world/earth-pilot_boszhira/manifest.json")) return;
    const s = await open("earth-pilot_boszhira", "scene"), cs = computeSite(s), layers = runJob(cs, "layers", { baselineM: 32, tpiRadiusM: 320 });
    expect(layers.summary.slope.p50).toBeGreaterThan(0); expect(layers.summary.validFraction).toBe(1);
    expect(layers.slope.data[at(s.field, 0, 0)]).toBeCloseTo(slopeDeg(s.field, { x: 0, y: 0 })!, 3); // raster equals the point query
    const noon = s.sun!.samples.reduce((a, b) => (b.elevationDeg > a.elevationDeg ? b : a)), mask = runJob(cs, "shadow", { t: noon.t, stride: 4 })!;
    expect(mask.side).toBe(129); expect(mask.data.reduce((a, v) => a + (v === 1 ? 1 : 0), 0) / mask.data.length).toBeLessThan(0.2);
    const ins = runJob(cs, "insolation", { fromS: 0, toS: 86400, count: 12, stride: 8 })!;
    const mean = stats(ins.irradiance.data).mean; expect(mean).toBeGreaterThan(20); expect(mean).toBeLessThan(400);
    expect(sunSteps(s.sun!, "earth", 0, 86400, 4)).toHaveLength(4); expect(sunAt(s.sun!, 1e9).t).toBe(s.sun!.duration);
  }, 60000);
  it("the quadtree over a field reproduces its posts at every level", async () => {
    const f = analytic(257, 8, (x, y) => x * 0.01 + y * 0.02), src = fieldSource(f), kids = src.children(src.roots[0]), n = src.cells + 3;
    expect(src.maxLevel).toBe(1); expect(src.roots[0].posting).toBe(16); expect(src.roots[0].error).toBe(8); expect(kids[0].error).toBe(0);
    const root = await src.heights(src.roots[0]), k3 = await src.heights(kids[3]);
    expect(root[(1 + 64) * n + 1 + 64]).toBeCloseTo(sample(f, { x: 0, y: 0 })!, 5);
    expect(k3[1 * n + 1]).toBeCloseTo(sample(f, { x: kids[3].west, y: kids[3].north })!, 5);
    expect(() => fieldSource(analytic(100, 5, () => 0))).toThrow(/quadtree/);
  });

  describe("digital twin on measured Earth terrain", () => {
    let site: Site, plan: MissionPlan;
    beforeAll(async () => {
      if (!HAS("world/earth-pilot_boszhira/manifest.json")) return;
      site = await open("earth-pilot_boszhira", "scene");
      const { slope } = slopeAspect(site.field), f = site.field, gentle: { x: number; y: number }[] = [];
      for (let r = 60; r < f.side - 60; r += 4) for (let c = 60; c < f.side - 60; c += 4) if (slope.data[r * f.side + c] < 1.5) gentle.push({ x: f.west + c * f.posting, y: f.north - r * f.posting });
      const start = gentle[0], end = gentle.filter(p => Math.hypot(p.x - start.x, p.y - start.y) > 900 && Math.hypot(p.x - start.x, p.y - start.y) < 1600)[0];
      plan = { start, destination: end, waypoints: [], hazards: [], objective: "energy", maxSlopeDeg: 15, reserveFraction: 0.2, startTimeS: 0, requireDaylight: false, fidelity: "fast" };
    }, 60000);
    it("runs, is deterministic, and reproduces a saved experiment", () => {
      if (!site) return;
      const ts = twinSite(site), cfg = defaultConfig("earth"), a = runTwin(ts, cfg, plan), b = runTwin(ts, cfg, plan);
      expect(a.result.outcome).toBe("completed"); expect(a.fingerprint).toBe(b.fingerprint);
      expect(a.summary.distanceM).toBeGreaterThan(900); expect(a.timeline[0].type).toBe("start"); expect(a.timeline.at(-1)!.type).toBe("complete");
      expect(a.warnings.some(w => /coarser than the vehicle/.test(w))).toBe(true); // 32 m posts vs a 2 m rover is flagged, never hidden
      for (const fr of a.result.frames) expect(Math.abs(fr.z - sample(site.field, fr)!)).toBeLessThan(1e-3); // the rover sits on the measured surface
      const exp = JSON.parse(JSON.stringify(toExperiment(ts, cfg, plan, a, "baseline", "e1", "2026-11-14T00:00:00Z")));
      expect(reproduce(ts, exp).reproduced).toBe(true);
      expect(reproduce(ts, { ...exp, config: { ...exp.config, payloadKg: 200 } }).reproduced).toBe(false);
      expect(reproduce({ ...ts, sha256: "other" }, exp).reason).toMatch(/terrain grid differs/);
    }, 120000);
    it("physical parameters change the outcome in the expected direction", () => {
      if (!site) return;
      const ts = { ...twinSite(site), field: cropField(site.field, [plan.start, plan.destination], 500) }, cfg = defaultConfig("earth"), base = runTwin(ts, cfg, plan);
      const heavy = runTwin(ts, { ...cfg, payloadKg: 300 }, plan), cmp = compareRuns(base, heavy);
      expect(heavy.summary.energyUsedWh).toBeGreaterThan(base.summary.energyUsedWh); expect(heavy.summary.maxSinkageM).toBeGreaterThan(base.summary.maxSinkageM);
      expect(cmp.deltas.find(d => d.key === "energyUsedWh")!.change).toBeGreaterThan(0);
      const bodies = acrossBodies(ts, cfg, plan);
      expect(bodies.moon.summary.maxSinkageM).toBeLessThan(bodies.earth.summary.maxSinkageM); // lighter wheel loads sink less in the same soil
      expect(bodies.moon.warnings.some(w => /Counterfactual/.test(w))).toBe(true);
      const blocked = runTwin(ts, cfg, { ...plan, objective: "shortest", hazards: [{ id: "h1", label: "keep-out", x: (plan.start.x + plan.destination.x) / 2, y: (plan.start.y + plan.destination.y) / 2, radiusM: 250 }] });
      const direct = runTwin(ts, cfg, { ...plan, objective: "shortest" });
      expect(blocked.result.outcome).toBe("completed"); expect(blocked.summary.distanceM).toBeGreaterThan(direct.summary.distanceM + 50); // the route detours around the keep-out
      for (const p of blocked.result.route!.points) expect(Math.hypot(p.x - (plan.start.x + plan.destination.x) / 2, p.y - (plan.start.y + plan.destination.y) / 2)).toBeGreaterThan(250);
    }, 120000);
    it("sensitivity ranks parameters by elasticity; invalid configurations are refused", () => {
      if (!site) return;
      const s = sensitivity(twinSite(site), defaultConfig("earth"), plan, ["mass", "driveEfficiency", "batteryWh"], 0.2);
      const eff = s.rows.find(r => r.param === "driveEfficiency")!, batt = s.rows.find(r => r.param === "batteryWh")!;
      expect(eff.elasticity.energyUsedWh!).toBeLessThan(0); // better drivetrain → less energy
      // Battery size does not change consumption unless the smaller battery ends the mission early at its reserve.
      expect(batt.outcomeLow !== "completed" || Math.abs(batt.elasticity.energyUsedWh ?? 0) < 0.02).toBe(true);
      expect(s.rows[0].strength).toBeGreaterThanOrEqual(s.rows.at(-1)!.strength);
      const bad = runTwin(twinSite(site), { ...defaultConfig("earth"), overrides: { mass: -5 } }, plan);
      expect(bad.result.outcome).toBe("invalid"); expect(bad.result.explanation).toMatch(/Dry mass/);
      expect(buildRover({ ...defaultConfig("earth"), wheels: 4 }, "earth").rover.wheels).toBe(4);
    }, 120000);
  });
});

describe("wheel-count generalisation of the drive model", () => {
  it("six wheels reproduce the original load transfer; four and eight conserve the normal load", () => {
    const r6 = ROVERS["m2020-class"], pitch = (8 * Math.PI) / 180, roll = (5 * Math.PI) / 180, g = 3.721, n = r6.mass * g * Math.cos(pitch) * Math.cos(roll);
    const d6 = drive(r6, SOILS["mars-drift"], g, pitch, roll);
    // Original closed form for the front-left wheel: N/6 + a·(wb/2) + b·(track/2).
    const a = (-r6.mass * g * Math.sin(pitch) * r6.cgHeight) / r6.wheelbase ** 2, b = (-r6.mass * g * Math.sin(roll) * r6.cgHeight) / (1.5 * r6.track ** 2);
    expect(d6.wheels[0].load).toBeCloseTo(n / 6 + (a * r6.wheelbase) / 2 + (b * r6.track) / 2, 6);
    for (const wheels of [4, 6, 8] as const) { const d = drive({ ...r6, wheels }, SOILS["mars-drift"], g, pitch, roll); expect(d.wheels).toHaveLength(wheels); expect(d.wheels.reduce((s, w) => s + w.load, 0)).toBeCloseTo(n, 6); }
    expect(drive({ ...r6, wheels: 4 }, SOILS["mars-drift"], g, 0, 0).maxSinkage).toBeGreaterThan(drive(r6, SOILS["mars-drift"], g, 0, 0).maxSinkage); // fewer wheels, higher load each
  });
  it("fingerprints are stable and sensitive", () => {
    expect(fingerprint({ a: 1, b: [1.0000000001, "x"] })).toBe(fingerprint({ a: 1, b: [1, "x"] })); // below 9 significant digits
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 })); expect(fingerprint({ a: 1 })).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe("unsupervised candidate-space ML on controlled data", () => {
  const rand = mulberry32(11), gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  const centres = [[0, 0, 0], [6, 0, 1], [0, 7, -2]], truth: number[] = [], x: number[][] = [], lon: number[] = [], lat: number[] = [];
  for (let i = 0; i < 600; i++) { const c = i % 3; truth.push(c); x.push(centres[c].map(v => v + gauss() * 0.7)); lon.push(-180 + rand() * 360); lat.push(-60 + rand() * 120); }
  it("eigen-decomposition and PCA match known results", () => {
    const e = eigenSym([[2, 1], [1, 2]]);
    expect(e.values[0]).toBeCloseTo(3, 9); expect(e.values[1]).toBeCloseTo(1, 9); expect(Math.abs(e.vectors[0][0])).toBeCloseTo(Math.SQRT1_2, 9);
    const p = pca(standardize(x).z, 2); expect(p.explained[0] + p.explained[1]).toBeGreaterThan(0.9); expect(p.scores).toHaveLength(600);
  });
  it("k-means recovers planted groups, deterministically", () => {
    const z = standardize(x).z, a = kmeans(z, 3, 2026), b = kmeans(z, 3, 2026);
    expect(adjustedRand(a.labels, truth)).toBeGreaterThan(0.97); expect(a.labels).toEqual(b.labels);
    expect(silhouette(z, a.labels)).toBeGreaterThan(0.6); expect(adjustedRand(truth, truth)).toBe(1);
    const coin = mulberry32(5); expect(Math.abs(adjustedRand(truth, truth.map(() => Math.floor(coin() * 3))))).toBeLessThan(0.05); // unrelated labels score ≈ 0
  });
  it("selects k, survives a geographic hold-out, and flags a planted outlier", () => {
    const clean = fitCandidateSpace(x, ["a", "b", "c"], lon, lat);
    expect(clean.k).toBe(3); // silhouette picks the planted number of groups
    expect(clean.geographicHoldoutAri).toBeGreaterThan(0.9); expect(clean.seedStabilityAri).toBeGreaterThan(0.9);
    // A gross outlier distorts k-means (a known failure mode, listed in the model limitations); it must still be flagged.
    const withOutlier = [...x, [40, -40, 30]], sp = fitCandidateSpace(withOutlier, ["a", "b", "c"], [...lon, 10], [...lat, 10], 3);
    expect(sp.outlier[600]).toBeGreaterThan(sp.outlierThreshold); expect(sp.holdout.fitRows + sp.holdout.testRows).toBe(601);
    expect(mahalanobis(standardize(withOutlier).z)[600]).toBeGreaterThan(50);
  });
  it("drops incomplete rows instead of imputing, and diversifies a shortlist", () => {
    const st = standardize([[1, 2], [null, 3], [3, 4], [5, 9]]); expect(st.rows).toEqual([0, 2, 3]);
    expect(() => fitCandidateSpace([[1, 2], [2, 3]], ["a", "b"], [0, 1], [0, 1])).toThrow(/too few/);
    const z = standardize(x).z, score = x.map((_, i) => (i % 3 === 0 ? 1 - i * 1e-4 : 0.5)), plain = [0, 3, 6], diverse = mmr(score, z, 3, 0.2);
    expect(new Set(plain.map(i => truth[i])).size).toBe(1); expect(new Set(diverse.map(i => truth[i])).size).toBe(3);
  });
});

describe("intelligence layer on the real engines", () => {
  const has = HAS("discovery/discovery.json") && HAS("discovery/scores/MARS_JEZERO.json");
  let d: ToolContext, atlas: AtlasBundle | null = null, ctx: IntelContext;
  beforeAll(async () => {
    if (!has) return;
    const bundle = JSON.parse(readFileSync(path.join(DATA, "discovery/discovery.json"), "utf8")) as DiscoveryBundle, target = bundle.targets.find(t => t.id === "MARS_JEZERO")!;
    d = { bundle, target, shard: JSON.parse(readFileSync(path.join(DATA, "discovery", target.shard), "utf8")) as ScoreShard, weights: { ...bundle.profiles.rover_mobility.weights }, selected: "PILOT_BOSZHIRA", compare: [], validation: HAS("discovery/validation.json") ? JSON.parse(readFileSync(path.join(DATA, "discovery/validation.json"), "utf8")) as ValidationDoc : null };
    if (HAS("pilot/atlas_pi.json")) atlas = JSON.parse(readFileSync(path.join(DATA, "pilot/atlas_pi.json"), "utf8"));
    ctx = { site: null, layers: null, selection: null, timeS: 0, config: null, plan: null, run: null, sensitivity: null, discovery: d, atlas, compare: null, space: null };
  });
  it("routes questions to engines by intent, in English and Russian", () => {
    if (!has) return;
    expect(planQuestion("Which Kazakhstan regions are promising analog candidates for Martian rover mobility?", ctx).map(p => p.tool)).toEqual(["rank_candidates", "ranking_sensitivity"]);
    expect(planQuestion("What measurements would reduce uncertainty?", ctx)[0].tool).toBe("next_measurements");
    expect(planQuestion("Какие допущения влияют на рейтинг?", ctx)[0].tool).toBe("ranking_sensitivity");
    expect(planQuestion("Why was this candidate rejected?", ctx)[0].tool).toBe("transfer_status");
    expect(planQuestion("Identify locations where our models are least reliable", ctx)[0].tool).toBe("least_reliable");
    expect(planQuestion("Compare these two candidate sites", ctx)[0].tool).toBe("compare_candidates");
  });
  it("answers from computed results with evidence classes, and the critic reviews independently", () => {
    if (!has) return;
    const a = ask("Which Kazakhstan regions are promising analog candidates for Martian rover mobility?", ctx);
    expect(a.results[0].ok).toBe(true); expect(a.results[0].windows!.length).toBeGreaterThan(0);
    for (const w of a.results[0].windows!) expect(d.bundle.windows.country[d.bundle.windows.id.indexOf(w)]).toBe("KAZ");
    expect(a.results.every(r => r.facts.every(f => f.evidence.length > 0))).toBe(true);
    expect(a.findings.some(f => f.code === "missing-dims")).toBe(true); expect(a.findings.some(f => f.code === "geology")).toBe(true);
    expect(["conditional", "rejected"]).toContain(a.verdict); // four dimensions are not assessed: never plainly "supported"
    expect(a.context).toMatch(/MARS_JEZERO/);
  });
  it("ranking stability is a real recomputation with the user's weights", () => {
    if (!has) return;
    const st = rankingStability(d, 10, "PILOT_BOSZHIRA");
    expect(st.leaders).toHaveLength(10); expect(st.minJaccard).toBeGreaterThanOrEqual(0); expect(st.minJaccard).toBeLessThanOrEqual(1);
    expect(st.rows.every(r => r.jaccard >= 0 && r.jaccard <= 1)).toBe(true); expect(st.baseRank).toBeGreaterThan(0);
    const flat = rankingStability({ ...d, weights: Object.fromEntries(d.shard.dims.map(k => [k, k === "terrain_fine" ? 1 : 0])) }, 10);
    expect(flat.rows.find(r => r.change === "doubled")!.jaccard).toBe(1); // doubling the only weight cannot change a geometric-mean ranking
  });
  it("ATLAS-Π transferability and measurement planning are read from the bundle", () => {
    if (!has || !atlas) return;
    const t = callIntel(ctx, "transfer_status", { window: "PILOT_BOSZHIRA" });
    expect(t.ok).toBe(true); expect(t.facts.length).toBe(atlas.tensor.cells.filter(c => c.site === "PILOT_BOSZHIRA" && c.target === "MARS_JEZERO").length);
    expect(callIntel(ctx, "transfer_status", { window: "SM_E000.385_N42.222" }).ok).toBe(false); // honest gap: no task cells for uncatalogued windows
    const m = callIntel(ctx, "next_measurements"); expect(m.ok).toBe(true); expect(m.facts[0].value).toMatch(/EVPI/);
  });
  it("refuses unknown tools and reports missing context instead of guessing", () => {
    if (!has) return;
    expect(callIntel(ctx, "delete_everything").ok).toBe(false);
    expect(callIntel(ctx, "terrain_summary").summary).toMatch(/Open a site/);
    expect(callIntel(ctx, "mission_status").ok).toBe(false); expect(callIntel(ctx, "candidate_space").ok).toBe(false);
    expect(review([callIntel(ctx, "mission_status")], ctx).findings[0].code).toMatch(/unanswered/);
  });
  it("fits the candidate space on the measured index with a geographic hold-out", () => {
    if (!has) return;
    const { x, lon, lat } = candidateFeatures(d.bundle), sp = fitCandidateSpace(x, FEATURES.map(f => f.label), lon, lat);
    expect(sp.nRows).toBeGreaterThan(3000); expect(sp.k).toBeGreaterThanOrEqual(3); expect(sp.sizes.reduce((a, b) => a + b, 0)).toBe(sp.nRows);
    expect(sp.geographicHoldoutAri).toBeGreaterThan(0.5); // groups fitted on half of the world's blocks transfer to the other half
    expect(Number.isFinite(sp.silhouette)).toBe(true);
    const r = callIntel({ ...ctx, space: sp }, "candidate_space"); expect(r.ok).toBe(true); expect(r.facts.find(f => f.label.startsWith("Geographic"))).toBeTruthy();
  }, 120000);

  it("full workflow: region → terrain → inspect → ask → design → simulate → compare → save → reproduce", async () => {
    if (!has || !HAS("world/earth-pilot_boszhira/manifest.json")) return;
    const site = await loadSite({ key: "earth-pilot_boszhira", format: "scene" }, "/"), cs = computeSite(site), layers = runJob(cs, "layers", { baselineM: 32, tpiRadiusM: 320 });
    const p = { x: 320, y: -640, h: heightAt(site, { x: 320, y: -640 })! }, c2: IntelContext = { ...ctx, site, layers, selection: p };
    expect(callIntel(c2, "inspect_point").facts.find(f => f.label === "Elevation")!.value).toContain(p.h.toFixed(2));
    expect(ask("Describe the terrain of this site", c2).results[0].tool).toBe("terrain_summary");
    expect(ask("How much direct Sun does this point get?", c2).results[0].facts.find(f => f.label.startsWith("Direct Sun"))).toBeTruthy();
    const design = ask("Design a mission scenario for this region", c2).results[0]; expect(design.ok).toBe(true);
    const proposal = design.actions.find(a => a.kind === "apply-plan")!.payload as Partial<MissionPlan>;
    const plan: MissionPlan = { hazards: [], objective: "safest", reserveFraction: 0.2, startTimeS: 0, requireDaylight: false, fidelity: "fast", maxSlopeDeg: 12, waypoints: [], start: proposal.start!, destination: proposal.destination!, ...proposal };
    for (const q of [plan.start, plan.destination, ...plan.waypoints]) expect(slopeDeg(site.field, q)!).toBeLessThan(12);
    const cfg = defaultConfig("earth"), run = runJob(cs, "twin", { config: cfg, plan }), c3 = { ...c2, config: cfg, plan, run };
    expect(["completed", "reserve-violated", "immobilized", "no-route"]).toContain(run.result.outcome);
    const answer = ask("What happened in the simulation?", c3);
    expect(answer.results[0].tool).toBe("mission_status"); expect(answer.findings.some(f => f.code === "unvalidated-sim")).toBe(true);
    if (run.result.outcome === "completed") expect(answer.verdict).toBe("rejected"); // 32 m posts cannot certify a 2 m vehicle's route
    const alt = runJob(cs, "twin", { config: { ...cfg, payloadKg: 150 }, plan }); expect(compareRuns(run, alt).deltas.length).toBe(7);
    const inv = newInvestigation("Analogs for Jezero mobility", "2026-11-14T00:00:00Z");
    inv.target = "MARS_JEZERO"; inv.siteKey = site.key; inv.candidates = ["PILOT_BOSZHIRA"]; inv.weights = d.weights;
    inv.experiments.push(toExperiment(twinSite(site), cfg, plan, run, "baseline", "e1", "2026-11-14T00:00:00Z")); inv.answers.push(answer);
    const again = parseInvestigation(serializeInvestigation(inv));
    expect(again.experiments[0].fingerprint).toBe(run.fingerprint); expect(reproduce(twinSite(site), again.experiments[0]).reproduced).toBe(true);
    expect(() => parseInvestigation('{"schema":"other"}')).toThrow(/investigation/);
    const report = buildReport(again, { site, layers, discovery: d, atlasVersion: atlas?.version ?? null });
    for (const part of ["Research question", "Dataset provenance", "Assumptions", "Limitations", "Reproducibility", run.fingerprint, site.provenance.product, "Copernicus"]) expect(report).toContain(part);
  }, 180000);
});
