// EGIZ · the index, folded into one control for full-screen workspaces (Planetary Studio, Mission Studio) that
// draw their own top bar: every workspace, Mission Home first, in the same order and words as the site header.
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LayoutGrid } from 'lucide-react';
import { t } from '../i18n';
import { useAppStore } from '../state/store';
import { contextNote, openWorkspace, WORKSPACES } from '../expedition/nav';

/** `toggleClass` lets the button wear the host bar's own button style; `compact` shows an icon only (tight bars). */
export function WorkspaceSwitcher({ toggleClass = 'eg-switch-toggle', compact = false, label = 'Workspaces' }: { toggleClass?: string; compact?: boolean; label?: string }) {
  const route = useAppStore(a => a.route), [open, setOpen] = useState(false), box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); }, esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return <div className="eg-switch" ref={box}>
    <button className={toggleClass} aria-expanded={open} aria-haspopup="true" aria-label={t(label)} title={t(label)} onClick={() => setOpen(!open)}>{compact ? <LayoutGrid size={15} /> : <>{t(label)}<ChevronDown size={13} /></>}</button>
    {open && <div className="eg-switch-menu" role="menu">
      {WORKSPACES.map((w, i) => <button key={w.route} role="menuitem" aria-current={route === w.route ? 'page' : undefined} onClick={() => { setOpen(false); openWorkspace(w.route); }}>
        <span className="eg-switch-n">{String(i + 1).padStart(2, '0')}</span><b>{t(w.title)}</b><em>{t(contextNote(w.route) ?? w.text)}</em></button>)}
    </div>}
  </div>;
}
