// Mounts the landing world behind the page and relays scroll, pointer and launcher state to it.
// AI-assisted implementation; human review pending.
import { useEffect, useRef, useState } from 'react';
import type { WorldEngine, Shot, LaunchState, LabelSpec, ProbeReadout, Vec3 } from './engine';
import type { StageData } from './terrainData';

export interface StageApi {
  engine: WorldEngine | null;
  stage: StageData | null;
}

export function canRenderWorld() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (/jsdom/i.test(navigator.userAgent)) return false;
  try { const c = document.createElement('canvas'); return !!c.getContext('webgl2'); } catch { return false; }
}

interface Props {
  analogues: { moon?: string; mars?: string };
  shots: (stage: StageData | null) => Shot[];
  labels: (stage: StageData | null, engine: WorldEngine) => LabelSpec[];
  apiRef: React.MutableRefObject<StageApi>;
  onProbe: (p: ProbeReadout) => void;
  onReady: (ok: boolean) => void;
  launch: LaunchState | null;
}

export function WorldStage({ analogues, shots, labels, apiRef, onProbe, onReady, launch }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const launchRef = useRef(launch); launchRef.current = launch;

  useEffect(() => {
    if (!canRenderWorld()) { setFailed(true); onReady(false); return; }
    const controller = new AbortController(); let engine: WorldEngine | null = null; let disposed = false;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    (async () => {
      const [{ WorldEngine }, { loadStage }] = await Promise.all([import('./engine'), import('./terrainData')]);
      const stage = await loadStage(analogues, controller.signal).catch(() => null);
      if (disposed || !canvas.current) return;
      try {
        engine = new WorldEngine(canvas.current, stage, shots(stage), { reduced });
      } catch { setFailed(true); onReady(false); return; }
      engine.onProbe = onProbe;
      engine.setLaunch(launchRef.current);
      apiRef.current = { engine, stage };
      if (import.meta.env.DEV) (window as unknown as { __wd: unknown }).__wd = engine;
      engine.setLabels(labels(stage, engine));
      onReady(true);
    })();
    return () => { disposed = true; controller.abort(); engine?.dispose(); apiRef.current = { engine: null, stage: null }; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { apiRef.current.engine?.setLaunch(launch); }, [launch, apiRef]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const engine = apiRef.current.engine; if (!engine) return;
      engine.setPointer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1, true);
    };
    const leave = () => apiRef.current.engine?.setPointer(0, 0, false);
    const down = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.button !== 0 || target?.closest('button, a, input, select, label, [data-no-probe]')) return;
      apiRef.current.engine?.setPointerDown(true);
    };
    const up = () => apiRef.current.engine?.setPointerDown(false);
    window.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerleave', leave);
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up); window.addEventListener('blur', up);
    return () => {
      window.removeEventListener('pointermove', move); document.removeEventListener('pointerleave', leave);
      window.removeEventListener('pointerdown', down); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); window.removeEventListener('blur', up);
    };
  }, [apiRef]);

  return <div className={`wd-stage ${failed ? 'is-fallback' : ''}`} aria-hidden="true">
    {!failed && <canvas ref={canvas} className="wd-canvas" />}
  </div>;
}

export type { Shot, Vec3, LabelSpec, ProbeReadout, LaunchState };
