// EGIZ Planetary Studio · scientific colour scales. One function colours both the draped texture and the
// legend, so what is drawn is exactly what the legend says. Sequential maps are perceptually ordered.
export type Colormap = 'viridis' | 'magma' | 'terrain' | 'slope' | 'diverging' | 'cyclic' | 'ice';
const STOPS: Record<Colormap, [number, number, number][]> = {
  viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
  magma: [[0, 0, 4], [81, 18, 124], [183, 55, 121], [252, 137, 97], [252, 253, 191]],
  terrain: [[38, 70, 83], [42, 122, 110], [138, 163, 109], [214, 196, 138], [176, 122, 84], [236, 232, 226]],
  slope: [[36, 96, 104], [112, 160, 122], [224, 190, 96], [214, 120, 62], [178, 44, 44]],
  diverging: [[44, 92, 168], [146, 180, 214], [236, 234, 228], [222, 160, 120], [168, 52, 44]],
  cyclic: [[214, 84, 72], [226, 190, 88], [84, 168, 122], [70, 110, 190], [214, 84, 72]],
  ice: [[14, 22, 46], [44, 78, 142], [112, 164, 204], [214, 232, 240]],
};
export function colorAt(map: Colormap, t: number): [number, number, number] {
  const s = STOPS[map], x = Math.max(0, Math.min(1, t)) * (s.length - 1), i = Math.min(s.length - 2, Math.floor(x)), f = x - i;
  return [s[i][0] + (s[i + 1][0] - s[i][0]) * f, s[i][1] + (s[i + 1][1] - s[i][1]) * f, s[i][2] + (s[i + 1][2] - s[i][2]) * f];
}
/** Continuous raster → RGBA (alpha 0 where there is no data). */
export function colorize(data: ArrayLike<number>, map: Colormap, lo: number, hi: number): Uint8Array {
  const out = new Uint8Array(data.length * 4), span = hi - lo || 1;
  for (let i = 0; i < data.length; i++) { const v = data[i]; if (!Number.isFinite(v)) continue; const c = colorAt(map, (v - lo) / span); out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = 255; }
  return out;
}
/** Class raster → RGBA. `colors[k] = null` leaves a class transparent; class 255 is no data. */
export function colorizeClasses(data: ArrayLike<number>, colors: ([number, number, number, number] | null)[]): Uint8Array {
  const out = new Uint8Array(data.length * 4);
  for (let i = 0; i < data.length; i++) { const c = colors[data[i]]; if (!c) continue; out.set(c, i * 4); }
  return out;
}
export const cssGradient = (map: Colormap) => `linear-gradient(90deg, ${STOPS[map].map(c => `rgb(${c.join(',')})`).join(', ')})`;
export const cssColor = (map: Colormap, t: number) => `rgb(${colorAt(map, t).map(Math.round).join(',')})`;
