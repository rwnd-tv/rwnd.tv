import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { SUPPORTED_LOCALES } from '@rwnd/shared'
import enGB from './locales/en-GB/common.json'
import enUS from './locales/en-US/common.json'

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      'en-GB': { common: enGB },
      'en-US': { common: enUS },
    },
    fallbackLng: 'en-US',
    supportedLngs: SUPPORTED_LOCALES,
    defaultNS: 'common',
    interpolation: { escapeValue: false },
  })

export default i18n
