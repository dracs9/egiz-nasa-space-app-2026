// EGIZ · a quiet disclosure: the arrow hides text that is needed but noisy (methods, data sources, long tables),
// so the essential result stays in front. Native <details>, so it works with keyboard and screen readers.
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { t } from '../i18n';

export function More({ label, open = false, className = '', children, aside }: { label: string; open?: boolean; className?: string; children: ReactNode; aside?: ReactNode }) {
  return <details className={`xp-more ${className}`} open={open}>
    <summary><ChevronRight size={14} className="xp-more-arrow" aria-hidden="true" /><span>{t(label)}</span>{aside && <em>{aside}</em>}</summary>
    <div className="xp-more-body">{children}</div>
  </details>;
}
