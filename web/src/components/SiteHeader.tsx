import { useEffect, useRef, useState } from 'react';
import { t, LanguageSwitcher } from '../i18n';
import { useAppStore, type Route } from '../state/store';
import type { DataMode } from '../data/modes';
import { DataModePicker } from './DataModePicker';
import { DataNotes } from './DataNotes';
import copy from '../content/copy.json';

const links: Route[] = ['lab', 'campaign', 'twin', 'matrix', 'evidence', 'brief'];

/** EGIZ mark: a horizon line under a partial orbit — Earth, before elsewhere. */
export function EgizMark() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    <circle cx="12" cy="12" r="10.25" strokeOpacity=".45" />
    <path d="M3.2 15.2h17.6" />
    <circle cx="12" cy="11.4" r="3.3" fill="currentColor" stroke="none" />
  </svg>;
}

export function SiteHeader({ availableModes }: { availableModes: DataMode[] }) {
  const { route, navigate } = useAppStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [tucked, setTucked] = useState(false);
  const last = useRef(0);
  const overHero = route === 'home';

  useEffect(() => {
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
    };
    onScroll(); window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [overHero]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); document.getElementById('navigation-toggle')?.focus(); } };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menuOpen]);
  useEffect(() => { setMenuOpen(false); }, [route]);

  const classes = ['eg-header', 'app-header', overHero && 'over-hero', scrolled && 'scrolled', tucked && !menuOpen && 'tucked', menuOpen && 'menu-open'].filter(Boolean).join(' ');
  return <header className={classes}>
    <button className="eg-wordmark brand" aria-label={t('Egiz campaign home')} onClick={() => navigate('home')}><EgizMark /><strong>{copy.brand.name}</strong></button>
    <nav id="primary-navigation" className={`eg-nav ${menuOpen ? 'open' : ''}`} aria-label={t('Main navigation')}>
      {links.map((r, i) => <button key={r} aria-current={route === r ? 'page' : undefined} className={route === r ? 'active' : ''} onClick={() => { navigate(r); setMenuOpen(false); }}>
        <span className="eg-nav-index" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>{t(copy.nav[r as keyof typeof copy.nav])}
      </button>)}
    </nav>
    <div className="eg-header-tools header-right">
      <DataModePicker available={availableModes} compact />
      <LanguageSwitcher />
      <DataNotes />
      <button id="navigation-toggle" className="eg-menu-toggle menu-button" aria-controls="primary-navigation" aria-label={t(menuOpen ? 'Close navigation' : 'Open navigation')} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><span /></button>
    </div>
  </header>;
}
