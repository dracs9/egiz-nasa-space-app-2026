// AI-assisted implementation; human review pending.
import type { AttrKey, EarthTile } from '../types/contracts';

export const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fullMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const decimal = (value: number | null | undefined, digits = 2) => value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
export const coords = (lat: number, lon: number) => `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? 'S' : 'N'} · ${Math.abs(lon).toFixed(2)}° ${lon < 0 ? 'W' : 'E'}`;
export const siteName = (tile: EarthTile) => tile.name || `${tile.country || 'Earth'} · ${Math.abs(tile.lat).toFixed(1)}°${tile.lat < 0 ? 'S' : 'N'}`;
export const safeUrl = (url: string) => /^https?:\/\//i.test(url) ? url : undefined;
export const attrLabels: Record<string, string> = {
  slope_f100_p50_deg: 'Median slope · 100 m', slope_f100_p90_deg: '90th percentile slope · 100 m', frac_lt10_f100: 'Terrain below 10° · 100 m', frac_lt20_f100: 'Terrain below 20° · 100 m', tri_f100_m: 'Terrain ruggedness · 100 m',
  slope_f400_p50_deg: 'Median slope · 400 m', slope_f400_p90_deg: '90th percentile slope · 400 m', frac_lt10_f400: 'Terrain below 10° · 400 m', frac_lt20_f400: 'Terrain below 20° · 400 m', tri_f400_m: 'Terrain ruggedness · 400 m',
  slope_r_p50_deg: 'Median regional slope', slope_r_p90_deg: '90th percentile regional slope', frac_lt20_r: 'Regional terrain below 20°', relief_m: 'Elevation range', elev_min_m: 'Minimum elevation', precip_mm: 'Annual precipitation', bare_frac: 'Bare ground', t_min_c: 'Minimum temperature', t_max_c: 'Maximum temperature', light: 'Low-Sun window', shadow: 'Shadow similarity', geology: 'Geological context',
};
export function attrValue(attr: string, value: number | null | undefined): string {
  if (value == null) return 'missing';
  if (attr.includes('frac')) return `${decimal(value * 100, 1)} %`;
  if (attr.endsWith('_deg')) return `${decimal(value, 1)}°`;
  if (attr.endsWith('_c')) return `${decimal(value, 1)} °C`;
  if (attr.endsWith('_mm')) return `${decimal(value, 1)} mm/yr`;
  if (attr.endsWith('_m')) return `${decimal(value, 1)} m`;
  return decimal(value);
}
export const readAttr = (attrs: Partial<Record<AttrKey, number | null>>, attr: string) => attrs[attr as AttrKey];
export function fidelityColor(value: number | null | undefined): string {
  if (value == null) return '#4a5560';
  const stops = [[0, 34, 78], [67, 78, 107], [124, 123, 120], [185, 170, 111], [254, 232, 56]];
  const t = Math.max(0, Math.min(1, value)) * 4; const i = Math.min(3, Math.floor(t)); const f = t - i;
  return `rgb(${stops[i].map((v, j) => Math.round(v + (stops[i + 1][j] - v) * f)).join(',')})`;
}
