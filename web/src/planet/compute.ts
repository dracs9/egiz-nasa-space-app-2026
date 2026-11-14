// EGIZ Planetary Studio · compute jobs. Heavy terrain and simulation work runs in a Web Worker so the 3D view
// stays interactive; the same functions run on the main thread where workers are unavailable (tests, old browsers).
import { fieldRange, type Field } from '../astral/world/field';
import type { SpiceGeometry } from '../mission/types';
import { curvatureRaster, insolation, roughnessRaster, shadowRaster, slopeAspect, summarize, coarsen, tpiRaster, type Raster, type SiteSummary } from './terrain/derive';
import { sunAt, sunSteps } from './terrain/solar';
import type { Body } from './terrain/site';
import { acrossBodies, runTwin, sensitivity, type MissionPlan, type NumericKey, type SensitivityRow, type TwinConfig, type TwinRun } from './twin/twin';

export interface ComputeSite { key: string; id: string; body: Body; radiusM: number; field: Field; context: Field | null; sun: SpiceGeometry | null; sha256: string | null; delivery: string }
export interface LayerSet { slope: Raster; aspect: Raster; roughness: Raster; curvature: Raster; tpi: Raster; summary: SiteSummary }
export interface Jobs {
  layers: { in: { baselineM: number; tpiRadiusM: number }; out: LayerSet };
  shadow: { in: { t: number; stride: number }; out: { side: number; cell: number; data: Uint8Array } | null };
  insolation: { in: { fromS: number; toS: number; count: number; stride: number }; out: { lit: Raster; irradiance: Raster } | null };
  summary: { in: { baselineM: number; postingM: number }; out: SiteSummary };
  twin: { in: { config: TwinConfig; plan: MissionPlan }; out: TwinRun };
  sensitivity: { in: { config: TwinConfig; plan: MissionPlan; keys: (NumericKey | 'payloadKg')[]; fraction: number }; out: { base: TwinRun; rows: SensitivityRow[] } };
  bodies: { in: { config: TwinConfig; plan: MissionPlan }; out: Record<Body, TwinRun> };
}
export type JobName = keyof Jobs;
const twinOf = (s: ComputeSite) => ({ key: s.key, id: s.id, body: s.body, field: s.field, sun: s.sun, sha256: s.sha256, delivery: s.delivery });

export function runJob<K extends JobName>(site: ComputeSite, name: K, input: Jobs[K]['in'], onProgress?: (done: number, total: number) => void): Jobs[K]['out'] {
  const occluder = site.context ?? site.field;
  const run: { [N in JobName]: (i: Jobs[N]['in']) => Jobs[N]['out'] } = {
    layers: i => { const sa = slopeAspect(site.field, i.baselineM); return { slope: sa.slope, aspect: sa.aspect, roughness: roughnessRaster(site.field, 2), curvature: curvatureRaster(site.field, Math.max(i.baselineM, site.field.posting * 2)), tpi: tpiRaster(site.field, i.tpiRadiusM), summary: summarize(site.field, i.baselineM) }; },
    shadow: i => (site.sun ? shadowRaster(site.field, occluder, sunAt(site.sun, i.t).sunEnu, site.radiusM, i.stride) : null),
    insolation: i => (site.sun ? insolation(site.field, occluder, sunSteps(site.sun, site.body, i.fromS, i.toS, i.count), site.radiusM, i.stride, onProgress) : null),
    summary: i => summarize(coarsen(site.field, Math.max(1, Math.round(i.postingM / site.field.posting))), i.baselineM),
    twin: i => runTwin(twinOf(site), i.config, i.plan),
    sensitivity: i => sensitivity(twinOf(site), i.config, i.plan, i.keys, i.fraction, onProgress),
    bodies: i => acrossBodies(twinOf(site), i.config, i.plan),
  };
  return run[name](input);
}

type Reply = { id: number; ok: true; out: unknown } | { id: number; ok: false; error: string } | { id: number; progress: [number, number] };
/** Promise interface over the worker. Obsolete requests of the same job are superseded (their promises reject with 'superseded'). */
export class Compute {
  private worker: Worker | null = null; private seq = 0; private waiting = new Map<number, { resolve(v: unknown): void; reject(e: Error): void; progress?: (d: number, t: number) => void; name: string }>();
  constructor(private site: ComputeSite) {
    try {
      if (typeof Worker === 'undefined') return;
      this.worker = new Worker(new URL('./planet.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (ev: MessageEvent<Reply>) => {
        const m = ev.data, w = this.waiting.get(m.id);
        if (!w) return;
        if ('progress' in m) { w.progress?.(m.progress[0], m.progress[1]); return; }
        this.waiting.delete(m.id);
        if (m.ok) w.resolve(m.out); else w.reject(new Error(m.error));
      };
      this.worker.onerror = ev => { const error = new Error(ev.message || 'The compute worker failed.'); for (const w of this.waiting.values()) w.reject(error); this.waiting.clear(); this.worker?.terminate(); this.worker = null; };
      this.worker.postMessage({ init: site });
    } catch { this.worker = null; }
  }
  run<K extends JobName>(name: K, input: Jobs[K]['in'], opts: { progress?: (d: number, t: number) => void; supersede?: boolean } = {}): Promise<Jobs[K]['out']> {
    if (opts.supersede) for (const [id, w] of this.waiting) if (w.name === name) { this.waiting.delete(id); w.reject(new Error('superseded')); }
    if (!this.worker) return new Promise((resolve, reject) => setTimeout(() => { try { resolve(runJob(this.site, name, input, opts.progress)); } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); } }, 0));
    const id = ++this.seq;
    return new Promise((resolve, reject) => { this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject, progress: opts.progress, name }); this.worker!.postMessage({ id, name, input }); });
  }
  dispose() { this.worker?.terminate(); this.worker = null; for (const w of this.waiting.values()) w.reject(new Error('superseded')); this.waiting.clear(); }
}
export const computeSite = (s: { key: string; id: string; body: Body; radiusM: number; field: Field; context: Field | null; sun: SpiceGeometry | null; provenance: { sha256: string | null; delivery: string } }): ComputeSite =>
  ({ key: s.key, id: s.id, body: s.body, radiusM: s.radiusM, field: s.field, context: s.context, sun: s.sun, sha256: s.provenance.sha256, delivery: s.provenance.delivery });
export { fieldRange };
