import { useEffect, useRef } from 'react';
import { Check, ChevronDown, Database, FlaskConical } from 'lucide-react';
import { t, useLanguage } from '../i18n';
import { dataModeInfo, isDataMode, type DataMode } from '../data/modes';
import { useAppStore } from '../state/store';
import './DataMode.css';

const labels: Record<DataMode, string> = { pilot: 'Real terrain', demo: 'Example data', observed: 'Imported observations' };
const explanations: Record<DataMode, string> = { pilot: 'Measured elevations from NASA and Copernicus.', demo: 'Invented inputs for learning and software testing.', observed: 'Your processed observation dataset.' };
export function DataModePicker({ available = ['demo', 'pilot'], compact = false }: { available?: DataMode[]; compact?: boolean }) {
  useLanguage();
  const { dataMode, setDataMode } = useAppStore();
  const host = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && host.current && !host.current.contains(event.target)) host.current.open = false; };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && host.current?.open) { host.current.open = false; host.current.querySelector('summary')?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, []);
  const modes: DataMode[] = ['pilot', 'demo', ...(available.includes('observed') || dataMode === 'observed' ? ['observed' as const] : [])];
  if (!compact) return <section className="data-mode-bar" aria-label={t('Dataset selection')}><label htmlFor="dataset-mode"><span className="eyebrow">{t('DATA SOURCE')}</span><select id="dataset-mode" aria-label={t('Dataset source')} value={dataMode} onChange={event => { if (isDataMode(event.target.value)) setDataMode(event.target.value); }}>{modes.map(mode => <option key={mode} value={mode} disabled={!available.includes(mode)}>{t(dataModeInfo[mode].label)}{!available.includes(mode) ? t(' (unavailable)') : ''}</option>)}</select></label><p>{t(dataModeInfo[dataMode].description)}</p></section>;
  const CurrentIcon = dataMode === 'demo' ? FlaskConical : Database;
  return <details ref={host} name="egiz-context" className={`dataset-switch ${dataMode === 'demo' ? 'example-mode' : ''}`}>
    <summary title={t('Dataset source')} aria-label={`${t('Dataset source')}: ${t(labels[dataMode])}`}><CurrentIcon size={16} /><span className="dataset-selected-label">{t(labels[dataMode])}</span><ChevronDown size={12} /></summary>
    <div className="dataset-menu" role="radiogroup" aria-label={t('Dataset selection')}><h3>{t('Dataset source')}</h3>{modes.map(mode => {
      const Icon = mode === 'demo' ? FlaskConical : Database;
      return <button key={mode} role="radio" aria-checked={dataMode === mode} data-dataset-mode={mode} disabled={!available.includes(mode)} onClick={() => { if (host.current) host.current.open = false; setDataMode(mode); }}><Icon size={21} /><span><strong>{t(labels[mode])}</strong><small>{t(explanations[mode])}</small></span>{dataMode === mode && <Check size={17} />}</button>;
    })}</div>
  </details>;
}
