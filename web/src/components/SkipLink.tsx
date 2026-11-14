import { t as localizeText, useLanguage } from '../i18n';
// Keep focus navigation independent from the application's hash URL state.
export function SkipLink() {
  useLanguage();
  return <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>{localizeText("Skip to content")}</a>;
}
