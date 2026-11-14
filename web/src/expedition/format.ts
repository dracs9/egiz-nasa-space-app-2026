// EGIZ · small display helpers shared by the expedition and Mission Home.
export const fmtLat = (v: number) => `${Math.abs(v).toFixed(v > -1 && v < 1 ? 3 : 2)}° ${v >= 0 ? 'N' : 'S'}`;
export const fmtLon = (v: number) => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? 'E' : 'W'}`;
export const KIND: Record<string, string> = { base_region: 'Candidate base region', landing_site: 'Landing site' };
/** "Jezero crater (Perseverance landing site)" → "Jezero crater". */
export const short = (name: string) => name.split(' (')[0];
export const fmtMs = (ms: number) => (ms < 1 ? '<1 ms' : ms < 1000 ? `${ms.toFixed(ms < 10 ? 1 : 0)} ms` : `${(ms / 1000).toFixed(2)} s`);
export const utcShort = (iso: string) => iso.replace('T', ' ').slice(0, 16) + ' UTC';
