import { t, useLanguage } from './index';
/** Explicit interpolation for UI prose; scientific records stay in their source language. */
export function message(en: string, ru: string, values: Record<string, string | number> = {}): string {
  const template = useLanguage.getState().language === 'ru' ? ru : en;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(t(values[key] ?? `{${key}}`)));
}
