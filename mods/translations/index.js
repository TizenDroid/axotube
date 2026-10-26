import i18n from 'i18next';
import resources from './i18nResources.js';

i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources,
    debug: false,
    interpolation: {
        escapeValue: false,
    }
});

export default i18n;
