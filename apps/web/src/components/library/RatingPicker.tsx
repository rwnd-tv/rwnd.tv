import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { STAR_COUNT, ratingToStars, starsToRating } from '../../lib/rating.js'

const STAR_PATH = 'M12 2l2.9 6.6 7.1.6-5.4 4.8 1.7 7-6.3-3.9-6.3 3.9 1.7-7-5.4-4.8 7.1-.6L12 2Z'

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="100%"
      height="100%"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={STAR_PATH} />
    </svg>
  )
}

/**
 * Shared 5-star rating control for shows, films and episodes — whole stars
 * only, each star worth 2 points on the stored 1-10 scale (see
 * starsToRating/ratingToStars above). Clicking a star sets the rating
 * immediately, matching the one-click Drop/Watched precedent elsewhere in
 * this app; clicking the already-selected star clears it instead. With an
 * odd stored value (an unre-rated Trakt import) no star satisfies that
 * check, so the first click always sets rather than clears — well-defined,
 * not a bug.
 */
export function RatingPicker({
  value,
  onRate,
  onClear,
  disabled = false,
  size = 'md',
  className = '',
  filledClassName = 'text-[var(--color-primary)]',
  mutedClassName = 'text-[var(--color-fg-muted)] hover:text-[var(--color-primary)]',
}: {
  /** The stored 1-10 rating, or null if unrated. */
  value: number | null
  onRate: (rating: number) => void
  onClear: () => void
  disabled?: boolean
  /** 'md' for show/movie/episode detail pages; 'sm' for the compact
   * episode-card overlay, which has no room for the label/clear button. */
  size?: 'sm' | 'md'
  className?: string
  /** Star color overrides — EpisodeCard.tsx uses white-on-black-scrim
   * variants here to match its other overlay buttons, since the default
   * tokens assume a plain page background. */
  filledClassName?: string
  mutedClassName?: string
}) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState<number | null>(null)
  const selectedStars = value !== null ? ratingToStars(value) : null
  const filledCount = hovered ?? selectedStars ?? 0
  const activeStars = hovered ?? selectedStars
  const starSize = size === 'sm' ? 14 : 18

  function handleClick(stars: number) {
    if (disabled) return
    if (selectedStars === stars) {
      onClear()
    } else {
      onRate(starsToRating(stars))
    }
  }

  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      <div
        role="group"
        aria-label={t('rating.groupAria')}
        className="inline-flex items-center gap-0.5"
        onMouseLeave={() => setHovered(null)}
      >
        {Array.from({ length: STAR_COUNT }, (_, i) => i + 1).map((stars) => {
          const label = t(`rating.levels.${stars}.label`)
          const isCurrent = selectedStars === stars
          const starLabel = isCurrent
            ? t('rating.starAriaClear', { stars })
            : t('rating.starAria', { stars, label })
          return (
            <button
              key={stars}
              type="button"
              disabled={disabled}
              aria-pressed={stars <= filledCount}
              aria-label={starLabel}
              title={starLabel}
              onMouseEnter={() => setHovered(stars)}
              onFocus={() => setHovered(stars)}
              onBlur={() => setHovered(null)}
              onClick={() => handleClick(stars)}
              className={`flex items-center justify-center rounded p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                stars <= filledCount ? filledClassName : mutedClassName
              }`}
              style={{ width: starSize + 4, height: starSize + 4 }}
            >
              <StarIcon filled={stars <= filledCount} />
            </button>
          )
        })}
      </div>
      {size === 'md' && (
        // A single text-xs wrapper, not two separately-sized siblings — the
        // label and the Clear button need to read as the same size, and
        // this stays the reserved-height element (see below) regardless of
        // which of the two children are actually showing.
        <span className="flex min-h-[1.25rem] items-center gap-1.5 text-xs text-[var(--color-fg-muted)]">
          {activeStars !== null && t(`rating.levels.${activeStars}.label`)}
          {value !== null && (
            <>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                disabled={disabled}
                aria-label={t('rating.clearAria')}
                onClick={onClear}
                className="text-xs underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t('rating.clear')}
              </button>
            </>
          )}
        </span>
      )}
    </div>
  )
}
