// EGIZ · on-screen translation of titles the analysis engine writes in English. The investigation record keeps the
// English originals (they are part of the reproducible output); only what is displayed is translated.
import { t } from '../i18n';

export function trTitle(title: string): string {
  let m = /^Closest Earth analog: (.*)$/.exec(title); if (m) return `${t('Closest Earth analog')}: ${m[1]}`;
  m = /^(\d+) of (\d+) dimensions have no evidence$/.exec(title); if (m) return `${m[1]} ${t('of')} ${m[2]} ${t('dimensions have no evidence')}`;
  m = /^Critic: (.*)$/.exec(title); if (m) return `${t('Critic')}: ${t(m[1])}`;
  return t(title);
}
