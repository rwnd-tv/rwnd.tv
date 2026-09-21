import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { CalendarEvent } from '@rwnd/shared'
import { CALENDAR_KIND_DOT_CLASS, calendarHref } from './calendar-shared.js'

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
 * One event row: kind dot, a small poster thumbnail, the title, and a
 * right-aligned meta column (episode code, watch time, or "Releases").
 * Extracted from CalendarAgenda.tsx (M5's mobile/responsive pass) so the
 * Month view's day sheet (CalendarMonthGrid.tsx) can reuse the exact same
 * row rather than a second, drifting copy.
 *
 * Owns its own spoiler-reveal state — an `episode` event's own title needs
 * a per-row click-to-reveal that only this component can hold. Same
 * substitution as EpisodeCard.tsx's own precedent rather than
 * SpoilerGuard.tsx's blur: a generic "Episode N" label swapped in, plus a
 * small reveal button. The show title, the episode code and the thumbnail
 * are never guarded, only the episode's own title.
 *
 * The thumbnail is a 2:3 box like PosterTile.tsx's, at w-8 rather than a
 * grid cell's full width, and falls back to the title's first character on
 * the same surface colour when the provider has no artwork.
 */
export function CalendarEventRow({ event, locale }: { event: CalendarEvent; locale: string }) {
  const { t } = useTranslation()
  const [revealed, setRevealed] = useState(false)
  const hidden = event.spoilerHidden && !revealed

  const primary =
    event.media.type === 'episode'
      ? (event.media.showTitle ?? event.media.title)
      : event.media.title

  const secondary =
    event.media.type === 'episode'
      ? hidden
        ? t('calendar.episodeFallbackLabel', { number: event.media.episodeNumber })
        : event.media.title
      : undefined

  const episodeCode =
    event.media.seasonNumber !== undefined && event.media.episodeNumber !== undefined
      ? t('calendar.episodeCode', {
          season: event.media.seasonNumber,
          episode: event.media.episodeNumber,
        })
      : undefined

  let meta: string
  if (event.kind === 'watch') {
    const time = new Date(event.endsAt).toLocaleTimeString(locale, {
      hour: 'numeric',
      minute: '2-digit',
    })
    meta = episodeCode ? `${episodeCode} · ${time}` : time
  } else if (event.kind === 'episode') {
    meta = episodeCode ?? ''
  } else {
    meta = t('calendar.release')
  }

  const href = calendarHref(event)
  const body = (
    <>
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${CALENDAR_KIND_DOT_CLASS[event.kind]}`}
        aria-hidden="true"
      />
      <span className="h-12 w-8 shrink-0 overflow-hidden rounded bg-[var(--color-surface)]">
        {event.media.posterPath ? (
          <img
            src={event.media.posterPath}
            // Decorative: the title sits right beside it as visible text,
            // same reasoning as PosterTile.tsx's own alt="".
            alt=""
            loading="lazy"
            decoding="async"
            width={342}
            height={513}
            className="h-full w-full object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-full items-center justify-center text-sm font-semibold text-[var(--color-fg-muted)]"
          >
            {primary.charAt(0)}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">
        <span className="font-medium">{primary}</span>
        {secondary !== undefined && (
          <>
            {/* Separator kept in its own node so the episode title is a
                text node of its own, rather than " · Title" glued
                together. */}
            <span className="text-[var(--color-fg-muted)]" aria-hidden="true">
              {' · '}
            </span>
            <span className="text-[var(--color-fg-muted)]">{secondary}</span>
          </>
        )}
      </span>
      {meta !== '' && <span className="shrink-0 text-xs text-[var(--color-fg-muted)]">{meta}</span>}
    </>
  )

  return (
    <li className="flex items-center gap-2">
      {href ? (
        <Link
          to={href}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-[var(--color-surface)]"
        >
          {body}
        </Link>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-3 px-2 py-1.5">{body}</span>
      )}
      {hidden && (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          title={t('spoiler.reveal')}
          aria-label={t('spoiler.reveal')}
          className="shrink-0 pr-2 text-[var(--color-fg-muted)] hover:text-[var(--color-primary)]"
        >
          <EyeIcon />
        </button>
      )}
    </li>
  )
}
