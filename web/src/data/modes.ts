// Written with AI assistance (Codex); human review pending.
export const DATA_MODES = ['demo', 'pilot', 'observed'] as const;
export type DataMode = typeof DATA_MODES[number];
export const MODE_STORAGE_KEY = 'egiz:data-mode';
export const dataModeInfo: Record<DataMode, { label: string; description: string; path: string }> = {
  demo: { label: 'Synthetic demo', description: 'Invented software fixtures. Not observations or validated recommendations.', path: 'data/demo' },
  pilot: { label: 'Measured terrain pilot', description: 'Nine Earth windows, two targets and classified land cover. Exploratory; climate and target temperatures are missing.', path: 'data/pilot' },
  observed: { label: 'Observed dataset', description: 'Explicitly loaded processed observations. Review missing data, provenance and validation.', path: 'data/observed' },
};
export function isDataMode(value: unknown): value is DataMode { return DATA_MODES.includes(value as DataMode); }
export function initialDataMode(): DataMode {
  if (typeof window === 'undefined') return 'pilot';
  const query = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  if (query.has('data')) return isDataMode(query.get('data')) ? query.get('data') as DataMode : 'demo';
  try { const saved = window.localStorage.getItem(MODE_STORAGE_KEY); return isDataMode(saved) ? saved : 'pilot'; } catch { return 'pilot'; }
}
export function rememberDataMode(mode: DataMode) { try { window.localStorage.setItem(MODE_STORAGE_KEY, mode); } catch { /* Preference persistence is optional. */ } }
