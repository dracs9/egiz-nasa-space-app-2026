import { useEffect, useRef, useState } from 'react';
import { Type } from 'lucide-react';
import { t, LanguageSwitcher } from '../i18n';
import { useAppStore, type Route } from '../state/store';
import type { DataMode } from '../data/modes';
import { DataModePicker } from './DataModePicker';
import { DataNotes } from './DataNotes';
import copy from '../content/copy.json';
import './site-header.css';

// Mission Studio and Lunar World are superseded by the Planetary Studio and stay reachable from its Tools menu.
const links: Route[] = ['planet', 'discover', 'lab', 'campaign', 'atlas', 'evidence', 'twin'];

/** EGIZ mark: a horizon line under a partial orbit — Earth, before elsewhere. */
export function EgizMark() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    <circle cx="12" cy="12" r="10.25" strokeOpacity=".45" />
    <path d="M3.2 15.2h17.6" />
    <circle cx="12" cy="11.4" r="3.3" fill="currentColor" stroke="none" />
  </svg>;
}

/** One quiet line: the mark, where you are, the tools you need. The header's bottom rule is a horizon
 *  that fills as you read, with a small sun riding its edge. The workspaces live in an index behind "Menu". */
export function SiteHeader({ availableModes }: { availableModes: DataMode[] }) {
  const { route, navigate } = useAppStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notes, setNotes] = useState(false);
  // Explanatory copy is hidden by default on every workspace page; this switch shows it (styles/minimal.css).
  useEffect(() => { document.documentElement.classList.toggle('eg-notes', notes); return () => document.documentElement.classList.remove('eg-notes'); }, [notes]);
  const [scrolled, setScrolled] = useState(false);
  const [tucked, setTucked] = useState(false);
  const last = useRef(0);
  const bar = useRef<HTMLElement>(null);
  const overHero = route === 'home';

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 24);
      // Hide while reading downward, return on any upward intent (home only; tools keep the bar).
      setTucked(prev => {
        if (!overHero || y < 80 || y < last.current - 4) return false;
        if (y > window.innerHeight * .6 && y > last.current + 4) return true;
        return prev;
      });
      last.current = y;
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        bar.current?.style.setProperty('--horizon', String(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0));
      });
    };
    onScroll(); window.addEventListener('scroll', onScroll, { passive: true }); window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); if (frame) cancelAnimationFrame(frame); };
  }, [overHero, route]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); document.getElementById('navigation-toggle')?.focus(); } };
    window.addEventListener('keydown', close);
    document.documentElement.classList.add('eg-menu-lock');
    return () => { window.removeEventListener('keydown', close); document.documentElement.classList.remove('eg-menu-lock'); };
  }, [menuOpen]);
  useEffect(() => { setMenuOpen(false); }, [route]);

  const here = links.indexOf(route);
  const classes = ['eg-header', overHero && 'over-hero', scrolled && 'scrolled', tucked && !menuOpen && 'tucked', menuOpen && 'menu-open'].filter(Boolean).join(' ');
  return <header ref={bar} className={classes}>
    <button className="eg-wordmark" aria-label={t('Egiz campaign home')} onClick={() => navigate('home')}><EgizMark /><strong>{copy.brand.name}</strong></button>
    {here >= 0 && <p className="eg-here" aria-hidden="true"><span>{String(here + 1).padStart(2, '0')}</span>{t(copy.nav[route as keyof typeof copy.nav])}</p>}
    <div className="eg-header-tools">
      <DataModePicker available={availableModes} compact />
      <button className="eg-notes-toggle" aria-pressed={notes} aria-label={t('Show explanations')} title={t('Show explanations')} onClick={() => setNotes(!notes)}><Type size={15} /></button>
      <LanguageSwitcher />
      <DataNotes />
      <button id="navigation-toggle" className="eg-menu-toggle" aria-controls="primary-navigation" aria-label={t(menuOpen ? 'Close navigation' : 'Open navigation')} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
        <span className="eg-menu-word" aria-hidden="true">{t(menuOpen ? 'Close' : 'Menu')}</span>
        <span className="eg-menu-count" aria-hidden="true">{String(links.length).padStart(2, '0')}</span>
      </button>
    </div>
    <span className="eg-horizon" aria-hidden="true"><i /></span>
    <nav id="primary-navigation" className={`eg-nav ${menuOpen ? 'open' : ''}`} aria-label={t('Main navigation')} data-lenis-prevent>
      <p className="eg-nav-kicker" aria-hidden="true">{t('Index')}</p>
      <div className="eg-nav-list">
        {links.map((r, i) => <button key={r} aria-current={route === r ? 'page' : undefined} className={route === r ? 'active' : ''} style={{ '--i': i } as React.CSSProperties} onClick={() => { navigate(r); setMenuOpen(false); }}>
          <span className="eg-nav-index" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
          <span className="eg-nav-title">{t(copy.nav[r as keyof typeof copy.nav])}</span>
        </button>)}
      </div>
    </nav>
  </header>;
}
