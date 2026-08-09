import { useEffect } from 'react'
import { usePublicSettings } from '../lib/use-public-settings.js'

/** Prefixes the browser tab title with ENVIRONMENT_LABEL, if set — see EnvironmentBadge. */
export function EnvironmentTitleEffect() {
  const { data: settings } = usePublicSettings()

  useEffect(() => {
    document.title = settings?.environmentLabel
      ? `[${settings.environmentLabel}] rwnd.tv`
      : 'rwnd.tv'
  }, [settings?.environmentLabel])

  return null
}
