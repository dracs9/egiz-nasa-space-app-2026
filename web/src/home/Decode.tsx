// Text that resolves out of signal noise, left to right, the moment it becomes active.
// Screen readers get the plain text at once; the scramble is decoration only.
// AI-assisted implementation; human review pending.
import { useEffect, useRef, useState } from 'react';

const GLYPHS = '░▒▓▚▞/\\<>_-=+*#01·:';

export function Decode({ text, on, delay = 0, speed = 26, className, as: Tag = 'span' }: { text: string; on: boolean; delay?: number; speed?: number; className?: string; as?: 'span' | 'h1' | 'h2' | 'p' }) {
  const blank = (x: string) => x.replace(/[^\s]/g, ' ');
  const [shown, setShown] = useState(() => blank(text));
  const timer = useRef(0);
  useEffect(() => {
    window.clearInterval(timer.current);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!on) { setShown(blank(text)); return; }
    if (reduced) { setShown(text); return; }
    const start = performance.now() + delay;
    timer.current = window.setInterval(() => {
      const k = (performance.now() - start) / speed;     // characters settled so far
      if (k < 0) { setShown(blank(text)); return; }
      if (k >= text.length + 6) { setShown(text); window.clearInterval(timer.current); return; }
      let out = '';
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (i < k - 6 || ch === ' ' || ch === '\n') out += ch;
        else if (i < k) out += GLYPHS[(Math.random() * GLYPHS.length) | 0];
        else out += ' ';
      }
      setShown(out);
    }, 33);
    return () => window.clearInterval(timer.current);
  }, [on, text, delay, speed]);
  // the real text for assistive tech and search; the scramble is visual only
  return <Tag className={className}><span className="fa-sr">{text}</span><span className="fa-dec" aria-hidden="true">{shown}</span></Tag>;
}
