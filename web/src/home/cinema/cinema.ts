// Cinematic plates for the landing: reads the scene manifest and finds which files actually exist.
// Nothing is assumed: a scene shows only when its video or still is really on the server.
// AI-assisted implementation; human review pending.

/** plate: plays over the world · handoff: plays once, then dissolves into the live world ·
 *  scrub: the scroll position IS the frame · inline: placed by its own section */
export type CinemaMode = 'plate' | 'handoff' | 'scrub' | 'inline';
export interface CinemaScene {
  id: string; name: string; group: string; base: string; mode: CinemaMode;
  window: [number, number]; loop: boolean; focus: string; role: string; status: string;
}
export interface CinemaAsset extends CinemaScene {
  /** video sources that exist, best first */
  sources: { src: string; type: string }[];
  /** still / poster, if it exists */
  still: string | null;
}

const ROOT = `${import.meta.env.BASE_URL}media/cinematic/`;

/** True only when the server answers with real media (SPA fallbacks return HTML with 200). */
async function exists(url: string, kind: 'video' | 'image', signal: AbortSignal) {
  try {
    const r = await fetch(url, { method: 'HEAD', signal, cache: 'no-cache' });
    const type = r.headers.get('content-type') ?? '';
    return r.ok && type.startsWith(`${kind}/`);
  } catch { return false; }
}

export async function loadCinema(signal: AbortSignal): Promise<CinemaAsset[]> {
  if (typeof fetch === 'undefined') return [];
  let scenes: CinemaScene[] = [];
  try {
    const r = await fetch(`${ROOT}manifest.json`, { signal, cache: 'no-cache' });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return [];
    scenes = (await r.json()).scenes ?? [];
  } catch { return []; }
  const found = await Promise.all(scenes.map(async s => {
    const base = ROOT + s.base;
    const [webm, mp4, jpg] = await Promise.all([exists(`${base}.webm`, 'video', signal), exists(`${base}.mp4`, 'video', signal), exists(`${base}.jpg`, 'image', signal)]);
    const sources = [...(webm ? [{ src: `${base}.webm`, type: 'video/webm' }] : []), ...(mp4 ? [{ src: `${base}.mp4`, type: 'video/mp4' }] : [])];
    return { ...s, sources, still: jpg ? `${base}.jpg` : null } as CinemaAsset;
  }));
  return found.filter(a => a.sources.length || a.still);
}

/** Opacity of a windowed scene at chapter position c (soft edges, hero window opens at 0). */
export function windowAlpha(w: [number, number], c: number, edge = .07) {
  const a = w[0] <= 0 ? 1 : Math.min(1, Math.max(0, (c - w[0]) / edge));
  const b = Math.min(1, Math.max(0, (w[1] - c) / edge));
  return a * b;
}

/** Visitors who asked for less motion or less data get stills instead of video. */
export function prefersStills() {
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const save = typeof navigator !== 'undefined' && (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  return !!(reduced || save);
}
