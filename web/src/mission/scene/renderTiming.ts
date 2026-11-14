import type { WebGLRenderer } from "three";

/** Non-blocking GPU queries. CPU time is command submission, not total frame time. */
export function createRenderTiming(renderer: WebGLRenderer) {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const extension = gl.getExtension("EXT_disjoint_timer_query_webgl2") as {
    TIME_ELAPSED_EXT: number;
    GPU_DISJOINT_EXT: number;
  } | null;
  let pending: WebGLQuery | null = null;
  let gpuMs: number | null = null;
  let cpuTotal = 0,
    samples = 0,
    count = 0;

  return {
    render(draw: () => void) {
      if (pending && extension) {
        const disjoint = gl.getParameter(extension.GPU_DISJOINT_EXT);
        const available = gl.getQueryParameter(
          pending,
          gl.QUERY_RESULT_AVAILABLE,
        );
        if (disjoint || available) {
          if (!disjoint) {
            const measurement =
              gl.getQueryParameter(pending, gl.QUERY_RESULT) / 1e6;
            gpuMs =
              gpuMs === null ? measurement : gpuMs * 0.75 + measurement * 0.25;
          } else gpuMs = null;
          gl.deleteQuery(pending);
          pending = null;
        }
      }
      // Sample every sixteen renders; never synchronously wait for GPU completion.
      const query =
        extension && !pending && count++ % 16 === 0 ? gl.createQuery() : null;
      if (query && extension) gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
      const start = performance.now();
      try {
        draw();
      } finally {
        if (query && extension) {
          gl.endQuery(extension.TIME_ELAPSED_EXT);
          pending = query;
        }
      }
      const cost = performance.now() - start;
      cpuTotal += cost;
      samples++;
      return cost;
    },
    read() {
      const result = { cpuMs: samples ? cpuTotal / samples : 0, gpuMs };
      cpuTotal = 0;
      samples = 0;
      return result;
    },
    dispose() {
      if (pending) gl.deleteQuery(pending);
      pending = null;
    },
  };
}
