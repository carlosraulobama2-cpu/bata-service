import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { es } from './es';

// Spanish by default; other languages are added as new resource files.
void i18n.use(initReactI18next).init({
  resources: { es: { translation: es } },
  lng: 'es',
  fallbackLng: 'es',
  interpolation: { escapeValue: false },
  returnNull: false
});

export default i18n;
