// A navigation reticle that trails the pointer on the landing: it locks onto anything you can press.
// Fine pointers only; the system cursor stays (the reticle is a companion, not a replacement).
// AI-assisted implementation; human review pending.
import { useEffect, useRef } from 'react';

export function Reticle() {
  const ring = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fine = window.matchMedia?.('(pointer: fine)').matches && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const el = ring.current; if (!fine || !el) return;
    let x = innerWidth / 2, y = innerHeight / 2, rx = x, ry = y, raf = 0, last = performance.now(), seen = false;
    const move = (e: PointerEvent) => {
      x = e.clientX; y = e.clientY;
      if (!seen) { rx = x; ry = y; seen = true; el.dataset.on = 'true'; }
      const t = e.target instanceof Element ? e.target.closest('a, button, input, select, [role="radio"], [role="button"], .mt-dot') : null;
      el.dataset.lock = String(!!t);
    };
    const leave = () => { el.dataset.on = 'false'; seen = false; };
    const down = () => { el.dataset.press = 'true'; }, up = () => { el.dataset.press = 'false'; };
    const tick = (now: number) => {
      const dt = Math.min(.05, (now - last) / 1000); last = now;
      const k = 1 - Math.exp(-dt * 16); rx += (x - rx) * k; ry += (y - ry) * k;
      el.style.transform = `translate3d(${rx.toFixed(1)}px, ${ry.toFixed(1)}px, 0)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener('pointermove', move, { passive: true }); document.addEventListener('pointerleave', leave);
    window.addEventListener('pointerdown', down); window.addEventListener('pointerup', up);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('pointermove', move); document.removeEventListener('pointerleave', leave); window.removeEventListener('pointerdown', down); window.removeEventListener('pointerup', up); };
  }, []);
  return <div ref={ring} className="rt" aria-hidden="true"><i /><b /></div>;
}
