import { t as localizeText, useLanguage, LanguageSwitcher } from './i18n';
// Written with AI assistance (Codex); human review pending.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, LoaderCircle, Menu, Orbit, TriangleAlert, X } from 'lucide-react';
import { DataLoadError, loadData, loadDatasetCatalog } from './data/load';
import { dataModeInfo, type DataMode } from './data/modes';
import { useAppStore, type Route } from './state/store';
import { useLiveCampaign } from './lib/useLiveCampaign';
import { BriefPage } from './components/BriefPage';
import { CampaignPage } from './components/CampaignPage';
import { MatrixPage } from './components/MatrixPage';
import { EvidencePage } from './components/EvidencePage';
import { SiteDrawer } from './components/SiteDrawer';
import { TwinPage } from './components/TwinPage';
import { SkipLink } from './components/SkipLink';
import { DataModePicker } from './components/DataModePicker';
import copy from './content/copy.json';
import { DataNotes } from './components/DataNotes';
import { InterfaceGuide } from './guide/InterfaceGuide';
import './styles/workspace.css';
import './styles/clarity.css';

const MissionLab = lazy(() => import('./mission/MissionLab'));

function Workspace({ availableModes }: { availableModes: DataMode[] }) {
  useLanguage();
  const { route, selectedSite, navigate } = useAppStore(); const model = useLiveCampaign(); const [menuOpen, setMenuOpen] = useState(false);
  const previousRoute = useRef(route);
  useEffect(() => { if (previousRoute.current !== route) { const heading = document.querySelector<HTMLElement>('#main-content h1'); if (heading) { heading.tabIndex = -1; heading.focus(); } previousRoute.current = route; } }, [route]);
  useEffect(() => { if (!menuOpen) return; const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); document.getElementById('navigation-toggle')?.focus(); } }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [menuOpen]);
  const links: Route[] = ['brief', 'campaign', 'lab', 'twin', 'matrix', 'evidence'];
  return <><SkipLink /><header className={`app-header ${route === 'lab' ? 'ex-app-header' : ''}`}><button className="brand" aria-label={localizeText("Egiz campaign home")} onClick={() => navigate('campaign')}><span className="brand-mark"><Orbit size={27} strokeWidth={1.35} /></span><strong>{localizeText(copy.brand.name)}</strong></button><nav className={menuOpen ? 'open' : ''} aria-label={localizeText("Main navigation")}>{localizeText(links.map(r => <button key={r} className={route === r ? 'active' : ''} aria-current={route === r ? 'page' : undefined} onClick={() => { navigate(r); setMenuOpen(false); }}>{localizeText(copy.nav[r])}{localizeText(r === 'evidence' && <span className="nav-status" />)}</button>))}</nav><div className="header-right"><DataModePicker available={availableModes} compact /><LanguageSwitcher /><DataNotes /><button id="navigation-toggle" className="icon-button menu-button" aria-label={localizeText(menuOpen ? 'Close navigation' : 'Open navigation')} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{localizeText(menuOpen ? <X size={20} /> : <Menu size={20} />)}</button></div></header>
    <div id="main-content" className="focused-workspace" tabIndex={-1}>{localizeText(route === 'lab' ? <Suspense fallback={<main className="page"><h1>{localizeText("Loading Mission Lab…")}</h1></main>}><MissionLab model={model} /></Suspense> : route === 'brief' ? <BriefPage /> : route === 'matrix' ? <MatrixPage model={model} /> : route === 'evidence' ? <EvidencePage /> : route === 'twin' ? <TwinPage /> : <CampaignPage model={model} />)}</div>
    <InterfaceGuide route={route}/>
    {localizeText(selectedSite && <SiteDrawer model={model} />)}
  </>;
}
export default function App() {
  useLanguage();
  const { data, dataMode, initialize, restoreUrl, setDataMode } = useAppStore(); const [error, setError] = useState<Error | null>(null); const [attempt, setAttempt] = useState(0); const [availableModes, setAvailableModes] = useState<DataMode[]>(['demo', 'pilot']);
  const retry = useCallback(() => { setError(null); setAttempt(n => n + 1); }, []);
  useEffect(() => {
    let active = true; const controller = new AbortController(); setError(null);
    Promise.all([loadData(fetch, dataMode, controller.signal), loadDatasetCatalog(fetch, controller.signal)]).then(([loaded, modes]) => {
      if (!active) return;
      setAvailableModes(modes);
      if (!modes.includes(dataMode)) throw new DataLoadError('schema', 'datasets.json', `Dataset ${dataMode} is not available`);
      initialize(loaded, dataMode);
    }).catch(e => { if (active) setError(e instanceof Error ? e : new Error(String(e))); });
    return () => { active = false; controller.abort(); };
  }, [initialize, attempt, dataMode]);
  useEffect(() => { window.addEventListener('hashchange', restoreUrl); window.addEventListener('popstate', restoreUrl); return () => { window.removeEventListener('hashchange', restoreUrl); window.removeEventListener('popstate', restoreUrl); }; }, [restoreUrl]);
  if (error) return <main className="load-screen"><LanguageSwitcher /><TriangleAlert size={32} /><span className="eyebrow">{localizeText(dataModeInfo[dataMode].label.toUpperCase())}{localizeText(" UNAVAILABLE")}</span><h1>{localizeText("Data failed to load")}</h1><p role="alert">{localizeText(error.message)}</p>{localizeText(error instanceof DataLoadError && <code>{error.file}{error.path ? ` → ${error.path}` : ''}</code>)}<div className="mode-recovery"><button className="primary-button" onClick={retry}>{localizeText(copy.common.retry)}<ArrowRight size={15} /></button>{localizeText(dataMode !== 'demo' && <button className="outline-button" onClick={() => setDataMode('demo')}>{localizeText("Reset to synthetic demo")}</button>)}</div><DataModePicker available={availableModes} /><p className="muted small-copy">{localizeText("Choose another dataset or retry. The selected source was not silently replaced.")}</p></main>;
  if (!data) return <main className="load-screen"><LanguageSwitcher /><Orbit size={48} className="earth-color" /><span className="eyebrow">{localizeText(dataModeInfo[dataMode].label.toUpperCase())}</span><h1>{localizeText(copy.common.loading)}</h1><LoaderCircle className="loading-spinner" size={20} /><DataModePicker available={availableModes} /></main>;
  return <Workspace key={dataMode} availableModes={availableModes} />;
}
