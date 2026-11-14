import { t as localizeText, useLanguage, LanguageSwitcher } from './i18n';
// Written with AI assistance (Codex); human review pending.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, TriangleAlert } from 'lucide-react';
import { DataLoadError, loadData, loadDatasetCatalog } from './data/load';
import { dataModeInfo, type DataMode } from './data/modes';
import { useAppStore } from './state/store';
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
import { SiteHeader, EgizMark } from './components/SiteHeader';
import { HomePage } from './home/HomePage';
import { InterfaceGuide } from './guide/InterfaceGuide';
import './styles/workspace.css';
import './styles/clarity.css';
import './styles/theme.css';

const MissionLab = lazy(() => import('./mission/MissionLab'));
const AtlasLab = lazy(() => import('./atlas/AtlasLab'));
const AstralStudio = lazy(() => import('./studio/AstralStudio'));
const MissionStudio = lazy(() => import('./astral/studio/MissionStudio'));
const DiscoverPage = lazy(() => import('./discover/DiscoverPage'));

function Workspace({ availableModes }: { availableModes: DataMode[] }) {
  useLanguage();
  const { route, selectedSite } = useAppStore(); const model = useLiveCampaign();
  const previousRoute = useRef(route);
  useEffect(() => { if (previousRoute.current !== route) { const heading = document.querySelector<HTMLElement>('#main-content h1'); if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); } previousRoute.current = route; } }, [route]);
  useEffect(() => { document.documentElement.dataset.route = route; }, [route]);
  if (route === 'astral') return <Suspense fallback={<main className="page eg-loading"><span className="eg-loading-bar" aria-hidden="true" /><h1>{localizeText("Loading Mission Studio…")}</h1></main>}><MissionStudio /></Suspense>;
  return <><SkipLink /><SiteHeader availableModes={availableModes} />
    <div id="main-content" className={`focused-workspace route-${route}`} tabIndex={-1}>{localizeText(route === 'home' ? <HomePage /> : route === 'lab' ? <Suspense fallback={<main className="page eg-loading"><span className="eg-loading-bar" aria-hidden="true" /><h1>{localizeText("Loading Mission Lab…")}</h1></main>}><MissionLab model={model} /></Suspense> : route === 'studio' ? <Suspense fallback={<main className="page eg-loading"><span className="eg-loading-bar" aria-hidden="true" /><h1>{localizeText("Loading Mission Studio…")}</h1></main>}><AstralStudio /></Suspense> : route === 'discover' ? <Suspense fallback={<main className="page eg-loading"><span className="eg-loading-bar" aria-hidden="true" /><h1>{localizeText("Loading the Earth-wide index…")}</h1></main>}><DiscoverPage /></Suspense> : route === 'atlas' ? <Suspense fallback={<main className="page eg-loading"><span className="eg-loading-bar" aria-hidden="true" /><h1>{localizeText("Loading ATLAS-Π…")}</h1></main>}><AtlasLab /></Suspense> : route === 'brief' ? <BriefPage /> : route === 'matrix' ? <MatrixPage model={model} /> : route === 'evidence' ? <EvidencePage /> : route === 'twin' ? <TwinPage /> : <CampaignPage model={model} />)}</div>
    {route !== 'home' && route !== 'studio' && <InterfaceGuide route={route}/>}
    {localizeText(selectedSite && route !== 'home' && <SiteDrawer model={model} />)}
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
  if (!data) return <main className="load-screen"><LanguageSwitcher /><span className="eg-load-mark"><EgizMark /></span><span className="eyebrow">{localizeText(dataModeInfo[dataMode].label.toUpperCase())}</span><h1>{localizeText(copy.common.loading)}</h1><span className="eg-loading-bar" aria-hidden="true" /><DataModePicker available={availableModes} /></main>;
  return <Workspace key={dataMode} availableModes={availableModes} />;
}
