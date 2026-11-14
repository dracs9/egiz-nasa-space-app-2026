import { useEffect, useRef } from 'react';
import { ArrowRight, Info } from 'lucide-react';
import { t, useLanguage } from '../i18n';
import { message } from '../i18n/messages';
import { useAppStore } from '../state/store';
import { hasSyntheticData } from '../data/load';
import { dataModeInfo } from '../data/modes';
import copy from '../content/copy.json';

const NASA_DATA = [
  'LOLA 5 m/px DEMs of the lunar south pole (NASA GSFC Planetary Geodesy Data Archive, PGDA)',
  'MOLA (NASA Mars Global Surveyor), inside the USGS HRSC/MOLA blended Mars DEM (200 m)',
  'NASA POWER climatology 2001–2025 (2 m air temperature, precipitation)',
  'HiRISE (NASA MRO) Jezero terrain via USGS, used for the Mission Studio world',
  'SPICE kernels from NASA NAIF (Sun and Earth geometry, lighting)',
];
const PARTNER_DATA = [
  'Copernicus DEM GLO-30 (ESA / Copernicus programme) — Earth terrain',
  'ESA WorldCover 2021 v200 — Earth land cover',
];

/** Source context stays available on demand, without competing with the workspace. */
export function DataNotes() {
  useLanguage();
  const { data, dataMode, route, navigate } = useAppStore();
  const disclosure = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (disclosure.current) disclosure.current.open = false; }, [route, dataMode]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !disclosure.current?.contains(event.target) && disclosure.current) disclosure.current.open = false; };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && disclosure.current?.open) { disclosure.current.open = false; disclosure.current.querySelector('summary')?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, []);
  if (!data) return null;
  const synthetic = hasSyntheticData(data);
  return <details ref={disclosure} name="egiz-context" className="data-notes">
    <summary title={t('About data')}><Info size={18} /><span className="sr-only">{t('About data')}</span></summary>
    <div className="data-notes-panel">
      <h2>{t('Data & method')}</h2>
      <p>{t(dataModeInfo[dataMode].description)}</p>
      {synthetic ? <div className="synthetic-banner" role="status"><strong>{t(copy.common.synthetic)}</strong><p>{t(copy.common.syntheticDetail)}</p></div> : <div className="measured-banner" role="status">
        <strong>{t(dataMode === 'pilot' ? 'MEASURED TERRAIN PILOT — EXPLORATORY, UNVALIDATED' : 'OBSERVED DATA — CHECK VALIDATION AND MISSING INPUTS')}</strong>
        <p>{dataMode === 'pilot' ? message('{sites} Earth windows · {targets} targets. ESA WorldCover land cover included. Climate, seasonal snow and target temperatures are missing; this is not a global search.', '{sites} участков Земли · {targets} цели. Включён земной покров ESA WorldCover. Климат, сезонный снег и температуры целей отсутствуют; это не глобальный поиск.', { sites: data.candidates.tiles.length, targets: data.targets.targets.length }) : t('Source provenance and recorded validation apply to this dataset only.')}</p>
      </div>}
      <h3>{t('NASA data')}</h3>
      <ul className="data-notes-sources">{NASA_DATA.map(x => <li key={x}>{t(x)}</li>)}</ul>
      <h3>{t('Space agency partner data (ESA)')}</h3>
      <ul className="data-notes-sources">{PARTNER_DATA.map(x => <li key={x}>{t(x)}</li>)}</ul>
      <p className="data-notes-attribution">{t(copy.common.independent)}</p>
      <button onClick={() => navigate('evidence')}>{t('Sources & limitations')}<ArrowRight size={15} /></button>
    </div>
  </details>;
}
