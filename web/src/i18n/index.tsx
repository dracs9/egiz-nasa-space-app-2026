// UI localization never alters engine inputs, identifiers or exported scientific records.
import { create } from 'zustand';
import ru from './ru.json';
import './language.css';

export type Language = 'en' | 'ru';
export const LANGUAGE_KEY = 'egiz:language';
const dictionary: Record<string, string> = ru;
const uppercaseDictionary = Object.fromEntries(Object.entries(dictionary).map(([key, value]) => [key.toUpperCase(), value.toUpperCase()]));
export const useLanguage = create<{ language: Language }>(() => ({ language: 'en' }));
export function setLanguage(language: Language, persist = true) {
  if (language !== 'ru' && language !== 'en') return;
  useLanguage.setState({ language });
  if (typeof document !== 'undefined') { document.documentElement.lang = language; document.title = language === 'ru' ? 'EGIZ — земные полигоны для Луны и Марса' : 'EGIZ — Training grounds for the Moon and Mars'; }
  if (persist) try { localStorage.setItem(LANGUAGE_KEY, language); } catch { /* Works without browser storage. */ }
}
export function initializeLanguage() {
  let language: Language = 'en';  // English for judges; Russian is a toggle
  try { const saved = localStorage.getItem(LANGUAGE_KEY); if (saved === 'en' || saved === 'ru') language = saved; } catch { /* English is the initial product language. */ }
  setLanguage(language, false);
}
/** Translate rendered strings only. Preserve numbers, elements, IDs and whitespace. */
export function t<T>(value: T): T {
  if (useLanguage.getState().language === 'en') return value;
  if (Array.isArray(value)) return value.map(item => t(item)) as T;
  if (typeof value !== 'string') return value;
  const key = value.trim().replace(/\s+/g, ' ');
  const translated = dictionary[key] ?? (key === key.toUpperCase() ? uppercaseDictionary[key] : undefined);
  if (translated !== undefined) return (value.match(/^\s*/)?.[0] + translated + value.match(/\s*$/)?.[0]) as T;
  return value;
}
export function LanguageSwitcher() {
  const language = useLanguage(state => state.language);
  return <div className="language-switch" role="group" aria-label="Язык / Language">
    <button type="button" lang="ru" aria-label="Русский" aria-pressed={language === 'ru'} onClick={() => setLanguage('ru')}>RU</button>
    <button type="button" lang="en" aria-label="English" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>EN</button>
  </div>;
}
