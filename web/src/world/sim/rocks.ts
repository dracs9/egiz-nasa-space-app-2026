// ASSUMED rock-hazard statistic. Rocks are not resolved by a 5 m DEM, so obstacle risk is
// expressed as an expected encounter count from a parameterized size-frequency model:
// cumulative fractional area F_k(D) = k exp(-q D), q = 1.79 + 0.152/k (Golombek & Rapp 1997,
// derived for Mars/Earth analogs; applying it to the Moon is an explicit assumption).
// Default k = 0.004 follows the order of the mean lunar regolith rock abundance reported from
// Diviner (Bandfield et al. 2011, rocks ≳ 1 m). Rock height is taken as half the diameter.

/** Number density (m⁻²) of rocks with diameter > d. */
export function rocksPerM2Above(k: number, d: number) {
  const q = 1.79 + 0.152 / k;
  // dN = -(dF/dD) / (π D² / 4) dD, integrated numerically to 20 m.
  let n = 0;
  const steps = 4000, dMax = 20, h = (dMax - d) / steps;
  for (let i = 0; i < steps; i++) {
    const D = d + (i + 0.5) * h;
    n += (k * q * Math.exp(-q * D)) / (Math.PI * D * D / 4) * h;
  }
  return n;
}

/** Expected encounters with rocks taller than the clearance along a path (swath = track + D). */
export function rockHazard(k: number, clearanceM: number, trackWidthM: number, pathM: number) {
  const dCrit = 2 * clearanceM;
  const density = rocksPerM2Above(k, dCrit);
  const expected = density * (trackWidthM + dCrit) * pathM;
  return { criticalDiameterM: dCrit, densityPerKm2: density * 1e6, expected, probability: 1 - Math.exp(-expected) };
}

/** Deterministic illustrative rock placement drawn from the same model (visualization only). */
export function illustrativeRocks(k: number, seed: number, area: { west: number; south: number; size: number }, minD = 0.3, max = 4000) {
  let state = seed >>> 0 || 1;
  const rand = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  const total = rocksPerM2Above(k, minD) * area.size * area.size;
  const count = Math.min(max, Math.round(total));
  const q = 1.79 + 0.152 / k;
  const rocks: { x: number; y: number; d: number; yaw: number }[] = [];
  // Sample diameters by inverse transform on a fine CDF of the number distribution.
  const grid: number[] = [], cdf: number[] = [];
  let acc = 0;
  for (let D = minD; D < 8; D += 0.02) { acc += (k * q * Math.exp(-q * D)) / (D * D); grid.push(D); cdf.push(acc); }
  for (let i = 0; i < count; i++) {
    const u = rand() * acc;
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] < u) lo = m + 1; else hi = m; }
    rocks.push({ x: area.west + rand() * area.size, y: area.south + rand() * area.size, d: grid[lo], yaw: rand() * Math.PI * 2 });
  }
  return rocks;
}
