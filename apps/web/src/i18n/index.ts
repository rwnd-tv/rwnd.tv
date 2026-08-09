import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { SUPPORTED_LOCALES } from '@rwnd/shared'
import enGB from './locales/en-GB/common.json'
import frFR from './locales/fr-FR/common.json'

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      'en-GB': { common: enGB },
      'fr-FR': { common: frFR },
    },
    fallbackLng: 'en-GB',
    supportedLngs: SUPPORTED_LOCALES,
    defaultNS: 'common',
    interpolation: { escapeValue: false },
  })

export default i18n
