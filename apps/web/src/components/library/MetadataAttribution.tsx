import { useTranslation } from 'react-i18next'
import type { MetadataProviderSource } from '@rwnd/shared'
import { formatDateTimeInput } from '../../lib/date.js'
import { PROVIDER_LABELS } from '../../lib/provider-labels.js'

interface MetadataAttributionProps {
  source: MetadataProviderSource
  refreshedAt: string
  locale: string
}

/**
 * "Where did this page's metadata come from" line — shown on the Show,
 * Movie, Season, and Episode detail pages (Season/Episode inherit their
 * show's source; see those callers). For TMDB this is plain text: TMDB's
 * own attribution requirement is already met by the separate rating-badge
 * logo/link next to the vote average elsewhere on the page. TVDB has no
 * equivalent badge — it never populates voteAverage (see
 * apps/api/src/providers/tvdb.ts) — and its terms require "a direct link to
 * TheTVDB.com" displayed wherever its metadata is shown
 * (https://www.thetvdb.com/api-information), so this whole line becomes
 * that link, carrying TVDB's required attribution text verbatim, when the
 * source is TVDB.
 */
export function MetadataAttribution({ source, refreshedAt, locale }: MetadataAttributionProps) {
  const { t } = useTranslation()
  const tooltip = t('metadata.sourceTooltip', {
    date: formatDateTimeInput(new Date(refreshedAt), locale),
  })

  if (source === 'tvdb') {
    return (
      <a
        href="https://www.thetvdb.com"
        target="_blank"
        rel="noopener noreferrer"
        title={tooltip}
        className="text-sm text-[var(--color-fg-muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--color-fg)]"
      >
        {t('metadata.tvdbAttribution')}
      </a>
    )
  }

  return (
    <p className="text-sm text-[var(--color-fg-muted)]" title={tooltip}>
      {t('metadata.source', { provider: PROVIDER_LABELS[source] })}
    </p>
  )
}
