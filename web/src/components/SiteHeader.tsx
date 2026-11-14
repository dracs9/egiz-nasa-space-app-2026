import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Type } from 'lucide-react';
import { t, LanguageSwitcher } from '../i18n';
import { useAppStore, type Route } from '../state/store';
import type { DataMode } from '../data/modes';
import { DataModePicker } from './DataModePicker';
import { DataNotes } from './DataNotes';
import copy from '../content/copy.json';
import { usePlanet } from '../planet/workspace/store';
import { contextNote, openWorkspace, SECTION_OF, WORKSPACES, workspace } from '../expedition/nav';
import './site-header.css';

/** The index, in order: the mission first, then every workspace, then reference. */
const links: Route[] = WORKSPACES.map(w => w.route);
const GROUPS: { id: 'mission' | 'workspace' | 'reference'; label: string }[] = [{ id: 'mission', label: 'Your mission' }, { id: 'workspace', label: 'Workspaces' }, { id: 'reference', label: 'Background' }];
const titleOf = (r: Route) => workspace(r)?.title ?? copy.nav[r as keyof typeof copy.nav] ?? r;

/** EGIZ mark: a world rising over a measured horizon, its orbit and a moon — Earth, before elsewhere. */
export function EgizMark() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10.25" strokeOpacity=".4" strokeWidth="1" />
    <path d="M12 1.3v1.5M22.7 12h-1.5M1.3 12h1.5" strokeOpacity=".75" strokeWidth="1" />
    <path d="M4.9 9.6C6.4 6.9 11.6 5.3 16.4 6.1c2.6.4 3.9 1.4 3.6 2.6" strokeOpacity=".6" strokeWidth=".75" strokeDasharray="0 1.55" />
    <circle cx="19.9" cy="9.1" r=".9" fill="currentColor" stroke="none" />
    <path d="M9.23 15.2A4.7 4.7 0 1 1 14.77 15.2" strokeOpacity=".3" strokeWidth=".7" />
    <circle cx="12" cy="11.4" r="3.3" fill="currentColor" stroke="none" />
    <path d="M3.2 15.2h17.6" />
    <path d="M5.6 17.7h12.8" strokeOpacity=".55" strokeWidth=".9" />
    <path d="M8.4 20.1h7.2" strokeOpacity=".3" strokeWidth=".9" />
  </svg>;
}

/** The mission in one line: world and site. Opens Mission Home. Rendered by every header, including full-screen studios. */
export function MissionChip({ className = '' }: { className?: string }) {
  const world = usePlanet(s => s.world()), siteName = usePlanet(s => (s.inv.target ? s.inv.siteName ?? s.target()?.name.split(' (')[0] ?? null : null)), route = useAppStore(a => a.route);
  if (!world) return null;
  return <button className={`eg-mission-chip ${route === 'mission' ? 'on' : ''} ${className}`} onClick={() => openWorkspace('mission')} title={t('Mission Home')} aria-label={`${t('Mission Home')}: ${t(world === 'moon' ? 'The Moon' : 'Mars')}${siteName ? `, ${siteName}` : ''}`}>
    <i className={`b-${world}`} aria-hidden="true" /><span>{t(world === 'moon' ? 'Moon' : 'Mars')}</span>{siteName && <b>{siteName}</b>}
  </button>;
}

/** One quiet line: the mark, where you are, the mission, the tools you need. The header's bottom rule is a horizon
 *  that fills as you read, with a small sun riding its edge. Every workspace lives in an index behind "Menu". */
export function SiteHeader({ availableModes }: { availableModes: DataMode[] }) {
  const { route } = useAppStore();
  const world = usePlanet(s => s.world()), siteName = usePlanet(s => (s.inv.target ? s.inv.siteName ?? s.target()?.name.split(' (')[0] ?? null : null));
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
    const outside = (event: MouseEvent) => { if (!bar.current?.contains(event.target as Node)) setMenuOpen(false); };
    window.addEventListener('keydown', close); document.addEventListener('mousedown', outside);
    document.documentElement.classList.add('eg-menu-lock');
    return () => { window.removeEventListener('keydown', close); document.removeEventListener('mousedown', outside); document.documentElement.classList.remove('eg-menu-lock'); };
  }, [menuOpen]);
  useEffect(() => { setMenuOpen(false); }, [route]);

  const section = SECTION_OF[route] ?? route, here = links.indexOf(section);
  const classes = ['eg-header', overHero && 'over-hero', scrolled && 'scrolled', tucked && !menuOpen && 'tucked', menuOpen && 'menu-open'].filter(Boolean).join(' ');
  const go = (r: Route) => { setMenuOpen(false); openWorkspace(r); };
  return <header ref={bar} className={classes}>
    <button className="eg-wordmark" aria-label={t('Egiz campaign home')} onClick={() => useAppStore.getState().navigate('home')}><EgizMark /><strong>{copy.brand.name}</strong></button>
    {here >= 0 && route !== 'home' ? <p className="eg-here" aria-hidden="true"><span>{String(here + 1).padStart(2, '0')}</span>{t(titleOf(section))}</p> : null}
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
      {world ? <div className="eg-nav-mission">
        <p className="eg-nav-kicker" aria-hidden="true">{t('Current mission')}</p>
        <p className="eg-nav-mission-line"><i className={`b-${world}`} aria-hidden="true" />{t(world === 'moon' ? 'The Moon' : 'Mars')}{siteName && <> · <b>{siteName}</b></>}</p>
      </div> : <div className="eg-nav-mission">
        <p className="eg-nav-kicker" aria-hidden="true">{t('No mission yet')}</p>
        <button className="eg-nav-start" onClick={() => { setMenuOpen(false); useAppStore.getState().navigate('explore'); }}>{t('The Moon or Mars? Start a mission')}<ArrowRight size={15} /></button>
      </div>}
      {GROUPS.map(g => <div key={g.id} className="eg-nav-group">
        <p className="eg-nav-kicker" aria-hidden="true">{t(g.label)}</p>
        <div className="eg-nav-list">
          {WORKSPACES.filter(w => w.group === g.id).map(w => { const i = links.indexOf(w.route); return <button key={w.route} aria-current={section === w.route ? 'page' : undefined} className={section === w.route ? 'active' : ''} style={{ '--i': i } as React.CSSProperties} onClick={() => go(w.route)} title={t(contextNote(w.route) ?? w.text)}>
            <span className="eg-nav-index" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
            <span className="eg-nav-title">{t(w.title)}</span>
          </button>; })}
        </div>
      </div>)}
    </nav>
  </header>;
}
