import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronDown, Info, type LucideIcon } from 'lucide-react';
import { t, useLanguage } from '../i18n';

export function ContextHelp({ label = 'Model & assumptions', children }: { label?: string; children: ReactNode }) {
  useLanguage();
  const host = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (event.target instanceof Node && host.current && !host.current.contains(event.target)) host.current.open = false; };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && host.current?.open) { event.preventDefault(); event.stopPropagation(); host.current.open = false; host.current.querySelector('summary')?.focus(); } };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape, true); };
  }, []);
  return <details ref={host} name="egiz-context" className="context-help"><summary aria-label={t(label)} title={t(label)}><Info size={17} /><span className="sr-only">{t(label)}</span></summary><div className="context-help-body"><h3>{t(label)}</h3>{children}</div></details>;
}

export function DetailSection({ label, children, icon: Icon = Info, count, className = '' }: { label: string; children: ReactNode; icon?: LucideIcon; count?: number; className?: string }) {
  useLanguage();
  return <details className={`detail-section ${className}`}><summary><Icon size={19} /><span>{t(label)}</span>{count !== undefined && <b>{count}</b>}<ChevronDown size={16} /></summary><div className="detail-section-body">{children}</div></details>;
}

export function CoverageRing({ value, pending = false }: { value: number; pending?: boolean }) {
  useLanguage();
  const safe = Math.max(0, Math.min(1, value));
  return <div className="coverage-ring" role="img" aria-label={`${t('Campaign coverage')}: ${pending ? t('Calculating…') : `${Math.round(safe * 100)}%`}`}>
    <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="50" className="coverage-ring-track" /><circle cx="60" cy="60" r="50" className="coverage-ring-value" strokeDasharray={`${safe * 314.159} 314.159`} transform="rotate(-90 60 60)" /></svg><strong>{pending ? '…' : Math.round(safe * 100)}<small>%</small></strong>
  </div>;
}
