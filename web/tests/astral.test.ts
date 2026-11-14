// EGIZ ASTRAL · world core, perception, terramechanics, routing, mission and copilot tests.
// Real-data cases read the measured Jezero package from data/world; synthetic arrays appear only as analytic test inputs.
// Lives outside src/ because it reads the packaged world with Node APIs (the app tsconfig has no Node types).
// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ancestorsOf, childKeys, decodeHeights, latLonToLocal, localToLatLon, resolveDrawSet, selectTiles, TileCache, tileIndex, validateManifest, type WorldManifest, type WorldTile } from "../src/astral/world/core";
import { assembleField, fieldRange, gradient, inShadow, lineOfSight, pathLength, polygonArea, profile, roughness, sample, shadowMask, slopeDeg, type Field } from "../src/astral/world/field";
import { classifyTerrain, dataQuality, detectCraters, detectRocks, fitShading, fitTerrainUnits, similarTo, terrainFeatures} from "../src/astral/intelligence/perception";
import { hypothesesAt, retrieve, scienceTargets } from "../src/astral/intelligence/discovery";
import { ask, parseIntent, validateCall, type ToolLog } from "../src/astral/intelligence/copilot";
import { MODELS } from "../src/astral/intelligence/registry";
import { compactionResistance, drive, GRAVITY, ROVERS, sinkage, SOILS, thrustAtSlip, wheelContact } from "../src/astral/sim/terramechanics";
import { BLOCK, buildNavGrid, cellOf } from "../src/astral/sim/traverse";
import { simulateMission, telemetryAt, validateSpec, type MissionSpec, type SimWorld } from "../src/astral/sim/mission";

const ROOT = path.resolve(__dirname, "../../data/world/mars-jezero"), HAS_WORLD = existsSync(path.join(ROOT, "manifest.json"));
const manifest = (): WorldManifest => validateManifest(JSON.parse(readFileSync(path.join(ROOT, "manifest.json"), "utf8")));
const tileHeights = (m: WorldManifest, key: string) => { const b = readFileSync(path.join(ROOT, "h", `${key}.bin`)); return decodeHeights(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, m.encoding); };
const realField = (m: WorldManifest, level: number): Field => assembleField(m, level, new Map(m.tiles.filter(t => t.level === level).map(t => [t.key, tileHeights(m, t.key)])));
/** Analytic field: z = f(x east, y north). */
const analytic = (side: number, posting: number, f: (x: number, y: number) => number): Field => {
  const half = ((side - 1) * posting) / 2, z = new Float32Array(side * side);
  for (let r = 0; r < side; r++) for (let c = 0; c < side; c++) z[r * side + c] = f(-half + c * posting, half - r * posting);
  return { side, posting, west: -half, north: half, z, level: 0, provenance: "measured" };
};

describe("coordinates and tile mathematics", () => {
  const site = { id: "T", name: "t", body: "mars" as const, lat: 18.4446, lon: 77.4509, radius_m: 3396190, frame: "IAU_MARS" };
  it("maps the origin to the site and one kilometre north to the right latitude", () => {
    expect(localToLatLon(site, 0, 0)).toEqual({ lat: 18.4446, lon: 77.4509 });
    const north = localToLatLon(site, 0, 1000);
    expect(north.lat - site.lat).toBeCloseTo((1000 / site.radius_m) * (180 / Math.PI), 9);
    expect(north.lon).toBeCloseTo(site.lon, 9);
    // one kilometre east spans more longitude than on the equator, by 1/cos(lat)
    expect(localToLatLon(site, 1000, 0).lon - site.lon).toBeCloseTo(((1000 / site.radius_m) * (180 / Math.PI)) / Math.cos((site.lat * Math.PI) / 180), 6);
  });
  it("round-trips local ↔ planetocentric coordinates to sub-millimetre", () => {
    for (const [x, y] of [[0, 0], [1024, -1024], [-733.2, 418.9], [9000, 9000]]) { const ll = localToLatLon(site, x, y), back = latLonToLocal(site, ll.lat, ll.lon); expect(back.x).toBeCloseTo(x, 3); expect(back.y).toBeCloseTo(y, 3); }
  });
  it("decodes heights, maps nodata to NaN and rejects wrong sizes", () => {
    const e = { posts: 1, apron: 1, side: 4, dtype: "int16-le" as const, scale_m: 0.02, offset_m: -2500, nodata: -32768, image_px: null, row_order: "", note: "" };
    const raw = new Int16Array(16).fill(50); raw[5] = -32768;
    const out = decodeHeights(raw.buffer, e);
    expect(out[0]).toBeCloseTo(-2499, 5); expect(Number.isNaN(out[5])).toBe(true);
    expect(() => decodeHeights(new ArrayBuffer(10), e)).toThrow(/unexpected size/);
  });
});

describe.skipIf(!HAS_WORLD)("measured world package (Jezero)", () => {
  const m = HAS_WORLD ? manifest() : (null as unknown as WorldManifest), index = HAS_WORLD ? tileIndex(m) : new Map<string, WorldTile>();
  it("is a complete, fingerprinted, non-synthetic package and tampering is rejected", () => {
    expect(m.site.id).toBe("MARS_JEZERO"); expect(m.levels.at(-1)!.posting_m).toBe(1); expect(m.sources.dtm.pixel_m).toBe(1);
    expect(() => validateManifest({ ...m, synthetic: true })).toThrow(/synthetic/);
    expect(() => validateManifest({ ...m, tiles: m.tiles.slice(1) })).toThrow(/tile count/);
    expect(() => validateManifest({ ...m, sources: { ...m.sources, dtm: { ...m.sources.dtm, window_sha256: "x" } } })).toThrow(/provenance/);
  });
  it("shares edge posts between neighbouring tiles and carries the neighbour's interior in its apron", () => {
    const e = m.encoding, a = tileHeights(m, "4-7-8"), b = tileHeights(m, "4-8-8"), south = tileHeights(m, "4-7-9");
    for (let r = 1; r <= e.posts + 1; r++) {
      expect(a[r * e.side + e.posts + 1]).toBe(b[r * e.side + 1]); // shared east/west edge
      expect(a[r * e.side + e.posts + 2]).toBe(b[r * e.side + 2]); // a's apron = b's first interior post
    }
    for (let c = 1; c <= e.posts + 1; c++) expect(a[(e.posts + 1) * e.side + c]).toBe(south[e.side + c]);
  });
  it("makes coarser levels area averages of the measured grid, not new detail", () => {
    const fine = realField(m, 4), coarse = realField(m, 2);
    let worst = 0, n = 0;
    for (let r = 8; r < coarse.side - 8; r += 7) for (let c = 8; c < coarse.side - 8; c += 7) {
      const fr = r * 4, fc = c * 4; // level 2 posts fall on every fourth level-4 post
      let sum = 0;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) sum += fine.z[(fr + dr) * fine.side + fc + dc];
      worst = Math.max(worst, Math.abs(coarse.z[r * coarse.side + c] - sum / 25)); n++;
    }
    expect(n).toBeGreaterThan(4000);
    expect(worst).toBeLessThan(0.03); // equals the 5×5 box mean of measured posts to within height quantisation
  });
  it("selects coarse tiles far away and the finest level near the eye, covering the site exactly once", () => {
    const view = { viewportHeightPx: 900, fovDeg: 45, maxErrorPx: 2 };
    const far = selectTiles(m, index, { ...view, eye: [0, 0, 60000] });
    expect(far.map(t => t.key)).toEqual(["0-0-0"]);
    const near = selectTiles(m, index, { ...view, eye: [100, 100, m.encoding.offset_m + 30] });
    expect(Math.max(...near.map(t => t.level))).toBe(4);
    expect(near.some(t => t.level < 4)).toBe(true);
    expect(near.reduce((s, t) => s + t.size * t.size, 0)).toBeCloseTo(2048 * 2048, 3);
  });
  it("draws loaded ancestors while leaves stream in, without overlap or gaps", () => {
    const wanted = selectTiles(m, index, { viewportHeightPx: 900, fovDeg: 45, maxErrorPx: 2, eye: [100, 100, m.encoding.offset_m + 30] });
    const area = (keys: string[]) => keys.reduce((s, k) => s + index.get(k)!.size ** 2, 0);
    expect(resolveDrawSet(m, index, wanted, k => k === "0-0-0")).toEqual(["0-0-0"]);
    expect(resolveDrawSet(m, index, wanted, () => true).sort()).toEqual(wanted.map(t => t.key).sort());
    const partial = new Set(["0-0-0", ...ancestorsOf(index, wanted).map(t => t.key), ...wanted.filter((_, i) => i % 3).map(t => t.key)]), draw = resolveDrawSet(m, index, wanted, k => partial.has(k));
    expect(area(draw)).toBeCloseTo(2048 * 2048, 3);
    expect(draw.length).toBeGreaterThan(1); expect(draw.every(k => partial.has(k))).toBe(true);
    for (const k of draw) for (const c of childKeys(index.get(k)!)) expect(draw.includes(c)).toBe(false);
  });
  it("derives consistent slope, relief and shadow from the shared field", () => {
    const f = realField(m, 3), range = fieldRange(f);
    expect(f.side).toBe(1025); expect(range.max - range.min).toBeGreaterThan(20); expect(range.max - range.min).toBeLessThan(200);
    expect(sample(f, { x: 0, y: 0 })).toBeCloseTo(f.z[512 * 1025 + 512], 5);
    expect(sample(f, { x: 5000, y: 0 })).toBeNull();
    const low = shadowMask(f, [-Math.cos(0.05), 0, Math.sin(0.05)], 8), high = shadowMask(f, [0, 0, 1], 8), night = shadowMask(f, [0.9, 0, -0.1], 8);
    const count = (d: Uint8Array) => d.reduce((s, v) => s + v, 0);
    expect(count(high.data)).toBe(0); expect(count(low.data)).toBeGreaterThan(0); expect(count(night.data)).toBe(night.data.length);
  });
});

describe("spatial analysis on analytic surfaces", () => {
  const plane = analytic(101, 2, x => 0.1 * x);
  it("measures slope, gradient, profile, area and line of sight", () => {
    expect(slopeDeg(plane, { x: 0, y: 0 })).toBeCloseTo((Math.atan(0.1) * 180) / Math.PI, 4);
    expect(gradient(plane, { x: 10, y: 10 })).toEqual({ gx: expect.closeTo(0.1, 5), gy: expect.closeTo(0, 5) });
    expect(roughness(plane, { x: 0, y: 0 })).toBeCloseTo(0, 4);
    const length = pathLength(plane, [{ x: -50, y: 0 }, { x: 50, y: 0 }]);
    expect(length.plan).toBeCloseTo(100, 6); expect(length.surface).toBeCloseTo(100 * Math.hypot(1, 0.1), 3);
    expect(profile(plane, [{ x: 0, y: 0 }, { x: 20, y: 0 }]).at(-1)!.gradeDeg).toBeCloseTo((Math.atan(0.1) * 180) / Math.PI, 3);
    expect(polygonArea([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }])).toBe(50);
    const wall = analytic(101, 2, x => (Math.abs(x) < 4 ? 20 : 0));
    expect(lineOfSight(wall, { x: -50, y: 0 }, { x: 50, y: 0 }, 2)).toBe("blocked");
    expect(lineOfSight(plane, { x: -50, y: 0 }, { x: 50, y: 0 }, 2)).toBe("clear");
    expect(lineOfSight(plane, { x: -50, y: 0 }, { x: 500, y: 0 })).toBe("unknown");
  });
  it("casts terrain shadow on the side away from the Sun only", () => {
    const wall = analytic(101, 2, x => (Math.abs(x) < 4 ? 20 : 0)), sunFromWest = [-Math.cos(Math.PI / 6), 0, Math.sin(Math.PI / 6)];
    expect(inShadow(wall, { x: 20, y: 0 }, sunFromWest)).toBe(true); // 20 m wall, 30° Sun → 34 m shadow
    expect(inShadow(wall, { x: 60, y: 0 }, sunFromWest)).toBe(false);
    expect(inShadow(wall, { x: -30, y: 0 }, sunFromWest)).toBe(false);
    expect(inShadow(wall, { x: -30, y: 0 }, [0, 0, -1])).toBe(true);
  });
});

describe("perception baselines", () => {
  it("recovers the illumination azimuth and zero registration offset from shading", () => {
    const f = analytic(257, 2, (x, y) => 6 * Math.sin(x / 23) * Math.cos(y / 31) + 3 * Math.sin((x + y) / 11));
    const az = (250 * Math.PI) / 180, el = (40 * Math.PI) / 180, s = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
    const side = 512, data = new Uint8Array(side * side);
    for (let r = 0; r < side; r++) for (let c = 0; c < side; c++) { const g = gradient(f, { x: f.west + c + 0.5, y: f.north - r - 0.5 }, 1) ?? { gx: 0, gy: 0 }; data[r * side + c] = Math.max(1, Math.min(254, Math.round((180 * (s[2] - g.gx * s[0] - g.gy * s[1])) / Math.hypot(g.gx, g.gy, 1)))); }
    const fit = fitShading(f, { side, pixelM: 1, west: f.west, north: f.north, data })!;
    expect(Math.abs(fit.azimuthDeg - 250)).toBeLessThan(6); expect(fit.r2).toBeGreaterThan(0.8); expect(fit.offsetM).toEqual({ x: 0, y: -0 });
    const shifted = new Uint8Array(side * side); for (let r = 0; r < side; r++) for (let c = 8; c < side; c++) shifted[r * side + c] = data[r * side + c - 8];
    expect(fitShading(f, { side, pixelM: 1, west: f.west, north: f.north, data: shifted.map(v => v || 1) })!.offsetM.x).toBe(8); // detects an 8 m eastward misregistration
  });
  it("finds a rimmed bowl and nothing on a plane", () => {
    const bowl = analytic(201, 2, (x, y) => { const d = Math.hypot(x - 40, y + 30) / 30; return 0.02 * x + (d < 1 ? -6 * (1 - d * d) : d < 1.4 ? 1.2 * (1.4 - d) / 0.4 : 0); });
    const craters = detectCraters(bowl);
    expect(craters.length).toBeGreaterThanOrEqual(1);
    expect(Math.hypot(craters[0].x - 40, craters[0].y + 30)).toBeLessThan(8); expect(craters[0].radiusM).toBeGreaterThanOrEqual(24); expect(craters[0].radiusM).toBeLessThanOrEqual(48);
    expect(detectCraters(analytic(201, 2, x => 0.05 * x))).toEqual([]);
  });
  it("detects a rock from its shadow and ignores flat texture", () => {
    const w = 128, data = new Uint8Array(w * w).fill(120);
    for (let i = 0; i < data.length; i++) data[i] += (i * 7919) % 5; // mild texture
    // Sun in the west (azimuth 270°): lit face on the west, shadow extending east
    for (let r = 60; r < 68; r++) { for (let c = 60; c < 76; c++) data[r * w + c] = 35; for (let c = 55; c < 60; c++) data[r * w + c] = 200; }
    const rocks = detectRocks({ width: w, height: w, pixelM: 0.25, west: 0, north: 32, data, tileKey: "t" }, 270);
    expect(rocks).toHaveLength(1);
    expect(rocks[0].diameterM).toBeCloseTo(2, 1); expect(rocks[0].shadowLengthM).toBeCloseTo(4, 1); expect(rocks[0].litFace).toBe(true); expect(rocks[0].confidence).toBeGreaterThan(0.5);
    expect(rocks[0].x).toBeLessThan(15.2); expect(rocks[0].x).toBeGreaterThan(13); // at the sunward (west) end of the shadow
    expect(detectRocks({ width: w, height: w, pixelM: 0.25, west: 0, north: 32, data: new Uint8Array(w * w).fill(120), tileKey: "t" }, 270)).toEqual([]);
  });
  it("classifies, clusters deterministically and scores outliers", () => {
    const f = analytic(257, 2, (x, y) => (x > 100 ? (x - 100) * 0.5 : 0) + (y > 150 ? 1.2 * Math.sin(x * 1.3) * Math.sin(y * 1.7) : 0));
    const g = terrainFeatures(f, null), classes = classifyTerrain(g), k = (x: number, y: number) => Math.floor((f.north - y) / g.cellM) * g.side + Math.floor((x - f.west) / g.cellM);
    expect(classes[k(180, -100)]).toBe(1); // 26.6° ramp → steep
    expect(classes[k(-150, -150)]).toBe(7); // flat → smooth
    expect(classes[k(-150, 200)]).toBe(3); // 1.2 m bumps → rough
    const a = fitTerrainUnits(g, 4, 7), b = fitTerrainUnits(g, 4, 7);
    expect(Array.from(a.assignment)).toEqual(Array.from(b.assignment)); expect(a.centroids).toEqual(b.centroids);
    expect(a.sizes.reduce((s, n) => s + n, 0)).toBe(a.trainedCells); expect(a.features).toEqual(["slope_deg", "roughness_m", "tpi_m"]);
    expect(a.centroids.map(c => c[0])).toEqual([...a.centroids.map(c => c[0])].sort((p, q) => p - q)); // units ordered by slope
    const ref = k(-150, -150), sim = similarTo(g, a, ref);
    expect(sim[ref]).toBe(1); expect(sim[k(-200, -200)]).toBeGreaterThan(0.95); expect(sim[k(180, -100)]).toBeLessThan(0.7);
    expect(dataQuality(f, null, null).find(q => q.check === "Imagery")!.status).toBe("warning");
  });
});

describe("terramechanics", () => {
  const sand = SOILS["dry-sand"], rover = ROVERS["m2020-class"];
  it("reproduces the Bekker rigid-wheel sinkage formula for a worked case", () => {
    // W = 1025 kg × 3.721 m/s² / 6 = 635.7 N, b = 0.4 m, D = 0.525 m, LETE sand: z = [3W / ((3−n)(kc + b·kφ)√D)]^(2/(2n+1)) = 22.2 mm
    const W = (1025 * 3.721) / 6, z = sinkage(sand, W, 0.2625, 0.4);
    expect(z).toBeCloseTo(((3 * W) / (1.9 * (990 + 0.4 * 1528430) * Math.sqrt(0.525))) ** (2 / 3.2), 12);
    expect(z).toBeGreaterThan(0.0215); expect(z).toBeLessThan(0.023);
    expect(compactionResistance(sand, W, 0.2625, 0.4)).toBeCloseTo(((990 + 0.4 * 1528430) * z ** 2.1) / 2.1, 9);
    expect(sinkage(SOILS.bedrock, W, 0.2625, 0.4)).toBe(0);
  });
  it("has monotonic thrust–slip behaviour and solves slip to meet demand", () => {
    let last = -1;
    for (let i = 0.02; i <= 1; i += 0.02) { const h = thrustAtSlip(sand, 600, 0.4, 0.1, i); expect(h).toBeGreaterThan(last); last = h; }
    expect(last).toBeLessThan(0.4 * 0.1 * sand.cohesion + 600 * Math.tan((28 * Math.PI) / 180)); // never exceeds the Mohr–Coulomb limit
    const w = wheelContact(sand, 600, 0.2625, 0.4, 60);
    expect(thrustAtSlip(sand, 600, 0.4, w.contactLength, w.slip)).toBeCloseTo(60 + w.compactionN, 3);
    expect(wheelContact(sand, 600, 0.2625, 0.4, 5000).slip).toBe(1);
  });
  it("responds physically to slope, load, gravity and surface", () => {
    const flat = drive(rover, sand, GRAVITY.mars, 0, 0), climb = drive(rover, sand, GRAVITY.mars, (10 * Math.PI) / 180, 0), down = drive(rover, sand, GRAVITY.mars, (-10 * Math.PI) / 180, 0);
    expect(flat.admissible).toBe(true); expect(climb.meanSlip).toBeGreaterThan(flat.meanSlip); expect(climb.electricalW).toBeGreaterThan(flat.electricalW); expect(down.electricalW).toBeLessThan(flat.electricalW);
    expect(climb.speed).toBeLessThan(flat.speed); // slip reduces ground speed
    expect(climb.wheels[4].load).toBeGreaterThan(climb.wheels[0].load); // weight shifts to the rear wheels when climbing
    expect(drive(rover, sand, GRAVITY.mars, (33 * Math.PI) / 180, 0).admissible).toBe(false);
    expect(drive(rover, sand, GRAVITY.earth, 0, 0).maxSinkage).toBeGreaterThan(flat.maxSinkage);
    expect(drive({ ...rover, mass: 2000 }, sand, GRAVITY.mars, 0, 0).maxSinkage).toBeGreaterThan(flat.maxSinkage);
    expect(drive(rover, SOILS["mars-drift"], GRAVITY.mars, (12 * Math.PI) / 180, 0).maxSlip).toBeGreaterThan(drive(rover, sand, GRAVITY.mars, (12 * Math.PI) / 180, 0).maxSlip);
    expect(drive(rover, SOILS.bedrock, GRAVITY.mars, (12 * Math.PI) / 180, 0).maxSinkage).toBe(0);
    expect(drive(rover, sand, GRAVITY.mars, 0, (40 * Math.PI) / 180).reason).toMatch(/tilt|unloading|traction/);
  });
});

describe.skipIf(!HAS_WORLD)("routing and mission simulation on the measured site", () => {
  const m = HAS_WORLD ? manifest() : (null as unknown as WorldManifest), f = HAS_WORLD ? realField(m, 3) : (null as unknown as Field);
  const world: SimWorld = { siteId: "MARS_JEZERO", gravity: GRAVITY.mars, field: f, obstacles: [], solar: null };
  const spec: MissionSpec = { version: "1.0.0", siteId: "MARS_JEZERO", roverId: "m2020-class", surface: "dry-sand", start: { x: 0, y: 0 }, destination: { x: 250, y: 300 }, waypoints: [{ id: "w1", label: "S1", x: 120, y: 160, activity: "imaging" }], objective: "safest", maxSlopeDeg: 18, reserveFraction: 0.25, startTimeS: 0, requireDaylight: false, fidelity: "fast" };
  const run = HAS_WORLD ? simulateMission(spec, world) : null!;
  it("plans admissible routes whose trade-offs match their objectives", () => {
    const grid = buildNavGrid(f, ROVERS["m2020-class"], { maxSlopeDeg: 18, gravity: GRAVITY.mars, soilId: "dry-sand" });
    const [safest, energy, shortest] = run.alternatives;
    for (const r of run.alternatives) { expect(r.points).not.toBeNull(); for (const p of r.points!) { const i = cellOf(grid, p); expect(grid.blocked[i]).toBe(BLOCK.none); expect(grid.slope[i]).toBeLessThanOrEqual(18); } }
    if (!safest.points || !energy.points || !shortest.points) throw new Error("routes expected");
    expect(shortest.metrics.lengthM).toBeLessThanOrEqual(safest.metrics.lengthM + 1e-6);
    expect(safest.metrics.riskExposure).toBeLessThanOrEqual(shortest.metrics.riskExposure + 1e-6);
    expect(energy.metrics.driveEnergyWh).toBeLessThanOrEqual(shortest.metrics.driveEnergyWh + 1e-6);
    expect(safest.metrics.lengthM).toBeGreaterThan(Math.hypot(120, 160) + Math.hypot(130, 140) - 4); // cannot beat the straight legs
  });
  it("simulates a complete, self-consistent and reproducible traverse", () => {
    expect(run.outcome).toBe("completed"); expect(run.metrics.scienceStops).toBe(1);
    expect(run.metrics.distanceM).toBeGreaterThan(run.route!.metrics.lengthM * 0.98);
    expect(run.metrics.durationS).toBeCloseTo(run.metrics.driveTimeS + ROVERS["m2020-class"].scienceStopS, 3);
    expect(run.metrics.finalBatteryWh).toBeCloseTo(2400 - run.metrics.energyUsedWh + run.metrics.energyGeneratedWh, 3); // energy balance closes
    expect(run.metrics.distanceM / run.metrics.driveTimeS).toBeLessThan(ROVERS["m2020-class"].maxSpeed); // slip slows the rover below its rim speed
    expect(run.events[0].type).toBe("start"); expect(run.events.at(-1)!.type).toBe("complete"); expect(run.events.some(e => e.type === "data-gap")).toBe(true);
    for (let i = 1; i < run.frames.length; i++) expect(run.frames[i].t).toBeGreaterThanOrEqual(run.frames[i - 1].t);
    expect(JSON.stringify(simulateMission(spec, world))).toBe(JSON.stringify(run));
    const mid = telemetryAt(run, run.metrics.durationS / 2)!; expect(mid.distance).toBeGreaterThan(0); expect(mid.distance).toBeLessThan(run.metrics.distanceM);
  });
  it("lets vehicle, energy, surface and obstacles change the result", () => {
    const small = simulateMission(spec, world, { ...ROVERS, "m2020-class": { ...ROVERS["m2020-class"], batteryWh: 400 } });
    expect(small.outcome).toBe("reserve-violated"); expect(small.metrics.distanceM).toBeLessThan(run.metrics.distanceM);
    const scout = simulateMission({ ...spec, roverId: "egiz-scout" }, world);
    expect(scout.metrics.driveTimeS).toBeLessThan(run.metrics.driveTimeS); expect(scout.metrics.energyGeneratedWh).toBe(0); // solar array without a SPICE record generates nothing
    const weak = simulateMission({ ...spec, surface: "mars-drift" }, world);
    expect(weak.metrics.maxSlip).toBeGreaterThan(run.metrics.maxSlip);
    const detailed = simulateMission({ ...spec, fidelity: "detailed" }, world);
    expect(detailed.model.stepM).toBe(0.25); expect(Math.abs(detailed.metrics.distanceM - run.metrics.distanceM)).toBeLessThan(0.05 * run.metrics.distanceM);
    const mid = run.route!.points[Math.floor(run.route!.points.length / 3)], blocked = simulateMission(spec, { ...world, obstacles: [{ id: "rock:test", x: mid.x, y: mid.y, radius: 2, height: null }] });
    expect(blocked.route!.points.every(p => Math.hypot(p.x - mid.x, p.y - mid.y) > 2)).toBe(true);
  });
  it("rejects invalid specifications instead of simulating them", () => {
    expect(validateSpec(spec, world)).toEqual([]);
    expect(validateSpec({ ...spec, destination: { x: 5000, y: 0 } }, world).join()).toMatch(/outside measured terrain/);
    expect(validateSpec({ ...spec, roverId: "x", maxSlopeDeg: 80, reserveFraction: 2 }, world)).toHaveLength(3);
    expect(validateSpec({ ...spec, surface: "classified" }, world).join()).toMatch(/terrain-unit analysis/);
    const bad = simulateMission({ ...spec, siteId: "OTHER" }, world); expect(bad.outcome).toBe("invalid"); expect(bad.frames).toEqual([]);
    const steep = simulateMission({ ...spec, maxSlopeDeg: 1 }, world); expect(["no-route", "invalid"]).toContain(steep.outcome);
  });
  it("turns real scene statistics into ranked targets and structured hypotheses", () => {
    const g = terrainFeatures(f, null), units = fitTerrainUnits(g), craters = detectCraters(f), classes = classifyTerrain(g);
    expect(craters.length).toBeGreaterThan(3); // the site contains several obvious craters
    const targets = scienceTargets(g, units, craters, () => true, 6);
    expect(targets).toHaveLength(6); expect(targets.every(t => t.status === "computational suggestion")).toBe(true);
    for (let i = 1; i < targets.length; i++) expect(Math.hypot(targets[i].x - targets[0].x, targets[i].y - targets[0].y)).toBeGreaterThanOrEqual(60);
    const h = hypothesesAt(g, classes, units, craters, craters[0]);
    expect(h[0].status).toBe("computational hypothesis"); for (const key of ["observation", "interpretation", "alternative", "prediction", "falsification", "measurement"] as const) expect(h[0][key].length).toBeGreaterThan(10);
  });
});

describe("copilot", () => {
  it("maps the documented requests to typed tool calls", () => {
    const one = (text: string) => parseIntent(text)[0];
    expect(one("Explain the geological structure of this area").tool).toBe("explain_area");
    expect(one("Find potential rover hazards around this point")).toEqual({ tool: "find_hazards", args: { place: { name: "selection" } } });
    expect(one("Which geological formations deserve further investigation?").tool).toBe("find_science_targets");
    expect(one("Show all terrain slopes above 20 degrees")).toEqual({ tool: "show_layer", args: { layer: "slope", slopeAbove: 20 } });
    expect(one("Highlight possible boulder fields").tool).toBe("find_hazards");
    expect(one("Fly to the largest crater")).toEqual({ tool: "fly_to", args: { place: { name: "largest crater" } } });
    expect(one("Change the solar time to local noon")).toEqual({ tool: "set_time", args: { moment: "noon" } });
    expect(one("Start a rover simulation").tool).toBe("run_simulation");
    expect(one("What changes if the rover has a smaller energy budget?")).toEqual({ tool: "what_if", args: { batteryScale: 0.6 } });
    expect(one("What if the battery is 30% smaller?")).toEqual({ tool: "what_if", args: { batteryScale: 0.7 } });
    expect(one("Find evidence contradicting this assessment").tool).toBe("stress_test");
    expect(one("What measurements are missing?").tool).toBe("missing_data");
    expect(one("Explain why this route was selected")).toEqual({ tool: "evidence", args: { topic: "mission" } });
    expect(one("Compare this area with Bozjyra").tool).toBe("open_analogs");
    expect(one("Generate a report").tool).toBe("generate_dossier");
    expect(one("Plan a rover survey starting at the western landing area, avoiding slopes above 18 degrees, prioritizing geological diversity, and preserving 25% energy reserve")).toEqual(
      { tool: "plan_mission", args: { from: { name: "western landing" }, maxSlopeDeg: 18, reservePercent: 25, scienceStops: 3 } });
    expect(one("Find a route to 250, 300 that minimizes terrain risk and includes three science stops")).toEqual({ tool: "plan_mission", args: { to: { x: 250, y: 300 }, objective: "safest", scienceStops: 3 } });
    expect(parseIntent("tell me a joke about geese")).toEqual([]);
  });
  it("rejects calls outside the allow-list or schema", () => {
    expect(validateCall({ tool: "shell", args: { cmd: "rm -rf /" } })).toEqual(["Unknown tool: shell"]);
    expect(validateCall({ tool: "show_layer", args: { layer: "slope", slopeAbove: 500 } })[0]).toMatch(/between 0 and 60/);
    expect(validateCall({ tool: "show_layer", args: { layer: "secrets" } })[0]).toMatch(/one of/);
    expect(validateCall({ tool: "fly_to", args: {} })).toEqual(["Missing argument: place"]);
    expect(validateCall({ tool: "plan_mission", args: { exec: "x" } })).toEqual(["Unexpected argument: exec"]);
    expect(validateCall({ tool: "plan_mission", args: { to: { x: 1, y: 2 }, maxSlopeDeg: 18 } })).toEqual([]);
  });
  it("executes only validated calls, asks before destructive ones and logs everything", async () => {
    const log: ToolLog[] = [], ran: string[] = [], run = (c: { tool: string }) => { ran.push(c.tool); return { ok: true, title: c.tool, sections: [] }; };
    expect((await ask("sing", run, log)).unknown).toBe(true);
    const pending = await ask("reset the mission", run, log);
    expect(pending.needsConfirmation?.message).toMatch(/clears/); expect(ran).toEqual([]);
    await ask("reset the mission", run, log, { confirmed: true }); expect(ran).toEqual(["reset_mission"]);
    const bad = await ask("x", run, log, { provider: { id: "test", plan: () => [{ tool: "set_time", args: { localHour: 99 } }] } });
    expect(bad.results[0].ok).toBe(false); expect(ran).toEqual(["reset_mission"]);
    const failing = await ask("generate a report", () => { throw new Error("disk full"); }, log);
    expect(failing.results[0]).toMatchObject({ ok: false, title: "Tool failed" });
    expect(log.map(l => [l.call.tool, l.ok])).toEqual([["reset_mission", true], ["set_time", false], ["generate_dossier", false]]);
  });
  it("cites only library references and reports model status honestly", () => {
    expect(retrieve("how is wheel slip computed?").map(r => r.id)).toContain("ref:janosi");
    expect(retrieve("zzz")).toEqual([]);
    const ids = MODELS.map(c => c.id); expect(new Set(ids).size).toBe(ids.length);
    expect(MODELS.find(c => c.id === "remote-llm")!.status).toBe("not-configured");
    expect(MODELS.filter(c => /prithvi|terramind/.test(c.id)).every(c => c.status === "incompatible" && c.runsOn.length === 0)).toBe(true);
    expect(MODELS.filter(c => c.status === "inference-ready" || c.status === "trains-in-session").every(c => c.inference.includes(".ts"))).toBe(true);
  });
});

describe("tile streaming cache", () => {
  const tiles = (n: number): WorldTile[] => Array.from({ length: n }, (_, i) => ({ key: `1-${i}-0`, level: 1, col: i, row: 0, west: 0, north: 0, size: 1, posting_m: 1, valid_fraction: 1, min_m: 0, max_m: 0, height_sha256: "", height_bytes: 0 }));
  it("bounds concurrency, cancels unwanted loads and evicts least-recently-used tiles", async () => {
    const resolvers = new Map<string, (v: string) => void>(), aborted: string[] = [], disposed: string[] = [];
    const cache = new TileCache<string>((t, signal) => new Promise(resolve => { resolvers.set(t.key, resolve); signal.addEventListener("abort", () => aborted.push(t.key)); }), d => disposed.push(d), { maxConcurrent: 2, maxTiles: 3 });
    const all = tiles(6);
    cache.request(all); expect(cache.pendingCount).toBe(2); expect([...resolvers.keys()]).toEqual(["1-0-0", "1-1-0"]);
    cache.request(all.slice(1)); expect(aborted).toEqual(["1-0-0"]); expect(cache.pendingCount).toBe(2);
    for (let round = 0; round < 6; round++) { for (const [key, resolve] of resolvers) resolve(key); resolvers.clear(); await Promise.resolve(); await Promise.resolve(); cache.request(all.slice(1)); }
    expect(all.slice(1).every(t => cache.get(t.key) === t.key)).toBe(true); expect(cache.get("1-0-0")).toBeUndefined();
    cache.request(all.slice(4)); expect(cache.entries.size).toBe(3); expect(disposed).toHaveLength(3); expect(disposed).toContain("1-0-0"); // the cancelled load's late result is released too
    cache.clear(); expect(cache.entries.size).toBe(0);
  });
});
