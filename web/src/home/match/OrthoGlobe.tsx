// A planet seen from space, centred on one place: an orthographic projection of an equirectangular map,
// drawn on a canvas. Zooming flies in from the whole globe to the site. Correct at any latitude,
// which a flat map is not near the poles (Mons Mouton sits at 85° S).
// AI-assisted implementation; human review pending.
import { useEffect, useRef } from 'react';

const textures = new Map<string, Promise<ImageData | null>>();
function loadTexture(src: string, width: number) {
  const key = `${src}@${width}`;
  if (!textures.has(key)) textures.set(key, new Promise(resolve => {
    const img = new Image(); img.crossOrigin = 'anonymous'; img.decoding = 'async';
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = width; c.height = width / 2;
        const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(img, 0, 0, c.width, c.height);
        resolve(g.getImageData(0, 0, c.width, c.height));
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  }));
  return textures.get(key)!;
}

export function OrthoGlobe({ src, lat, lon, zoom, label }: { src: string; lat: number; lon: number; zoom: number; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef({ zoom: 1, tex: null as ImageData | null, raf: 0 });

  useEffect(() => {
    let alive = true;
    const small = Math.min(window.innerWidth, window.innerHeight) < 600;
    loadTexture(src, small ? 2048 : 4096).then(t => { if (alive) { state.current.tex = t; draw(); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const draw = () => {
    const cv = canvas.current, tex = state.current.tex; if (!cv || !tex) return;
    const rect = cv.getBoundingClientRect(); if (!rect.width) return;
    const scale = Math.min(window.devicePixelRatio || 1, 1.5) * .75;   // the globe is soft by nature; 3/4 resolution keeps it fast
    const W = Math.max(2, Math.round(rect.width * scale)), H = Math.max(2, Math.round(rect.height * scale));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d')!; const out = g.createImageData(W, H); const o = out.data;
    const R = Math.min(W, H) * .44 * state.current.zoom;
    const p0 = lat * Math.PI / 180, l0 = lon * Math.PI / 180, sp = Math.sin(p0), cp = Math.cos(p0);
    const tw = tex.width, th = tex.height, td = tex.data;
    const sun = [-.55, .35, .76];   // soft light from the upper left, so relief reads at globe scale
    for (let y = 0; y < H; y++) {
      const ny = (H / 2 - y) / R;
      for (let x = 0; x < W; x++) {
        const nx = (x - W / 2) / R; const r2 = nx * nx + ny * ny; const i = (y * W + x) * 4;
        if (r2 >= 1) { o[i] = o[i + 1] = o[i + 2] = 0; o[i + 3] = 255; continue; }
        const nz = Math.sqrt(1 - r2);
        // view-space normal → planet latitude/longitude (inverse orthographic)
        const la = Math.asin(nz * sp + ny * cp);
        const lo = l0 + Math.atan2(nx, nz * cp - ny * sp);
        const u = ((lo / (2 * Math.PI) + .5) % 1 + 1) % 1, v = .5 - la / Math.PI;
        // bilinear sample
        const fx = u * tw - .5, fy = Math.min(th - 1.001, Math.max(0, v * th - .5));
        const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
        const xa = ((x0 % tw) + tw) % tw, xb = (xa + 1) % tw, yb = Math.min(th - 1, y0 + 1);
        const a = (y0 * tw + xa) * 4, b = (y0 * tw + xb) * 4, c = (yb * tw + xa) * 4, d = (yb * tw + xb) * 4;
        const shade = Math.max(.12, nx * sun[0] + ny * sun[1] + nz * sun[2]) * .85 + .15 * nz;
        for (let k = 0; k < 3; k++) {
          const top = td[a + k] + (td[b + k] - td[a + k]) * ax, bot = td[c + k] + (td[d + k] - td[c + k]) * ax;
          o[i + k] = (top + (bot - top) * ay) * shade;
        }
        o[i + 3] = 255;
      }
    }
    g.putImageData(out, 0, 0);
  };

  // fly in: ease the zoom over ~1.4 s, redrawing as it goes
  useEffect(() => {
    const s = state.current; cancelAnimationFrame(s.raf);
    const from = s.zoom, to = zoom, t0 = performance.now(), dur = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 1400;
    const step = () => {
      const k = dur ? Math.min(1, (performance.now() - t0) / dur) : 1; const e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      s.zoom = from * Math.pow(to / from, e); draw();
      if (k < 1) s.raf = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(s.raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, lat, lon]);

  useEffect(() => {
    const ro = new ResizeObserver(() => draw()); if (canvas.current) ro.observe(canvas.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvas} className="mt-globe" role="img" aria-label={label} />;
}
