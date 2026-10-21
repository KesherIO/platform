import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import es from '../../assets/i18n/es.json';
import en from '../../assets/i18n/en.json';

export type Language = 'en' | 'es';

const stored = localStorage.getItem('lang');
const initialLanguage: Language =
  stored === 'en' || stored === 'es'
    ? stored
    : navigator.language?.toLowerCase().startsWith('es')
    ? 'es'
    : 'en';

/** Switches the UI language and remembers the choice on this device. */
export function setLanguage(lng: Language) {
  i18n.changeLanguage(lng);
  localStorage.setItem('lang', lng);
}

i18n.use(initReactI18next).init({
  resources: {
    es: { translation: es },
    en: { translation: en },
  },
  lng: initialLanguage,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
