// AI-assisted implementation; human review pending.
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './styles/global.css';
import '@fontsource/sofia-sans-condensed/latin-600.css';
import '@fontsource/sofia-sans-condensed/latin-700.css';
import '@fontsource/sofia-sans-condensed/cyrillic-600.css';
import '@fontsource/sofia-sans-condensed/cyrillic-700.css';
import App from './App';
import { initializeLanguage, LANGUAGE_KEY, setLanguage } from './i18n';
import '@fontsource/inter/cyrillic-400.css';
import '@fontsource/inter/cyrillic-500.css';
import '@fontsource/inter/cyrillic-600.css';
import '@fontsource/inter/cyrillic-700.css';
import '@fontsource/ibm-plex-mono/cyrillic-400.css';
import '@fontsource/ibm-plex-mono/cyrillic-500.css';

initializeLanguage();
window.addEventListener('storage', event => { if (event.key === LANGUAGE_KEY && (event.newValue === 'ru' || event.newValue === 'en')) setLanguage(event.newValue, false); });

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
