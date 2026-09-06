import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CalendarEvent } from '@rwnd/shared'
import { PosterTile } from '../library/PosterTile.js'
import { calendarHref } from './calendar-shared.js'

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

/**
 * One tile in the calendar's Agenda/Month views (CalendarAgenda.tsx,
 * CalendarMonthGrid.tsx) — wraps PosterTile.tsx the way ActivityTile.tsx
 * does, but owns its own spoiler-reveal state rather than taking a
 * pre-formatted caption from the caller: an `episode` event's own title
 * needs a per-tile click-to-reveal control, which only this component (not
 * the page) can meaningfully hold.
 *
 * Spoiler handling deliberately does NOT reuse SpoilerGuard.tsx's blur —
 * follows EpisodeCard.tsx's own precedent instead (a generic "Episode N"
 * label swapped in for the real title, plus a small reveal button) since
 * this is the same compact-tile shape EpisodeCard already solved this for.
 * Unlike EpisodeCard, no `stopPropagation` is needed on the reveal button:
 * PosterTile's `children` render as a sibling of its `<Link>`, not nested
 * inside an absolutely-positioned one the way EpisodeCard's elements are.
 *
 * The show title, and the S{{season}} E{{episode}} code, are never
 * spoiler-guarded — only the episode's own title is. A `watch` event is
 * never guarded at all (`event.spoilerHidden` is always false for one,
 * computed server-side in apps/api/src/calendar/build.ts), and a `release`
 * event never guards its movie title (this app never hides movie titles
 * anywhere).
 */
export function CalendarEventTile({ event, locale }: { event: CalendarEvent; locale: string }) {
  const { t } = useTranslation()
  const [revealed, setRevealed] = useState(false)
  const hidden = event.spoilerHidden && !revealed

  const title =
    event.media.type === 'episode'
      ? (event.media.showTitle ?? event.media.title)
      : event.media.title

  const episodeCode =
    event.media.seasonNumber !== undefined && event.media.episodeNumber !== undefined
      ? t('calendar.episodeCode', {
          season: event.media.seasonNumber,
          episode: event.media.episodeNumber,
        })
      : undefined

  let caption: string
  if (event.kind === 'watch') {
    const time = new Date(event.endsAt).toLocaleTimeString(locale, {
      hour: 'numeric',
      minute: '2-digit',
    })
    caption = episodeCode ? `${episodeCode} · ${time}` : time
  } else if (event.kind === 'episode') {
    const episodeTitle = hidden
      ? t('calendar.episodeFallbackLabel', { number: event.media.episodeNumber })
      : event.media.title
    caption = episodeCode ? `${episodeCode} · ${episodeTitle}` : episodeTitle
  } else {
    caption = t('calendar.release')
  }

  return (
    <PosterTile
      title={title}
      year={null}
      posterPath={event.media.posterPath}
      to={calendarHref(event)}
    >
      <div className="flex items-center gap-1.5 text-xs text-[var(--color-fg-muted)]">
        <span
          className="min-w-0 flex-1 truncate"
          title={hidden ? undefined : (event.overview ?? undefined)}
        >
          {caption}
        </span>
        {hidden && (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            title={t('spoiler.reveal')}
            aria-label={t('spoiler.reveal')}
            className="shrink-0 hover:text-[var(--color-primary)]"
          >
            <EyeIcon />
          </button>
        )}
      </div>
    </PosterTile>
  )
}
