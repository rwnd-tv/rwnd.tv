import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../lib/use-auth.js'

/** Applies the logged-in user's theme and locale preferences to the document. */
export function PreferencesEffect() {
  const { user } = useAuth()
  const { i18n } = useTranslation()

  useEffect(() => {
    if (!user || user.theme === 'system') {
      document.documentElement.removeAttribute('data-theme')
    } else {
      document.documentElement.setAttribute('data-theme', user.theme)
    }
  }, [user])

  useEffect(() => {
    if (user?.locale && i18n.language !== user.locale) {
      void i18n.changeLanguage(user.locale)
      document.documentElement.lang = user.locale
    }
  }, [user, i18n])

  return null
}
