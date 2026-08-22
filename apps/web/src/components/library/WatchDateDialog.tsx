import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  clampDate,
  formatDateTimeInput,
  parseDateTimeInput,
  RELEASE_DATE_WATCHED_AT,
  toDateInputValue,
  toTimeInputValue,
  UNKNOWN_WATCHED_AT,
} from '../../lib/date.js'
import { Dialog } from '../ui/Dialog.js'
import { Field } from '../ui/Field.js'
import { Button } from '../ui/Button.js'

type Mode = 'nowWatching' | 'justFinished' | 'releaseDate' | 'unknown' | 'other'

/**
 * "When did you watch this?" — shown when marking a season episode watched
 * (see SeasonDetailPage.tsx) rather than always silently logging "now".
 * Written generically enough (takes plain episode fields, not a
 * SeasonEpisode) that it also backs the show/season-level bulk "Watched"
 * button (ShowDetailPage.tsx/SeasonDetailPage.tsx), via `allowNowWatching`/
 * `allowReleaseDate` below — a bulk action has no single episode to be
 * "now watching" or have "the release date" of.
 */
export function WatchDateDialog({
  open,
  episodeLabel,
  episode,
  locale,
  /** "Now watching" (now + runtime) only makes sense for one episode at a
   * time — hidden for the bulk "Watched" button's dialog. */
  allowNowWatching = true,
  /** Offers "Release date" even though `episode.firstAired` is null (the
   * bulk dialog has no single date — every episode gets its own). Selecting
   * it resolves `onConfirm` to RELEASE_DATE_WATCHED_AT instead of a literal
   * ISO string; ignored when `episode.firstAired` is actually set, since
   * that already shows its own real-dated "Release date" option below. */
  allowReleaseDate = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  episodeLabel: string
  episode: { title: string | null; runtimeMinutes: number | null; firstAired: string | null }
  locale: string
  allowNowWatching?: boolean
  allowReleaseDate?: boolean
  onConfirm: (watchedAtIso: string) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  // Radio inputs are grouped by `name` across the *whole document*, not
  // just within this component — and every episode's dialog stays mounted
  // (just hidden) at once, so a literal shared name here would make every
  // episode's radios fight over one page-wide group. useId() scopes each
  // dialog's group to itself.
  const radioGroupName = useId()
  const [mode, setMode] = useState<Mode>('justFinished')
  // The date/time this dialog would log if confirmed right now — shown in
  // the always-visible text field below regardless of mode (James: it
  // should stay visible above Cancel/Log watch, not just for "Other
  // date"). Only "Other date" lets the user edit it directly; every other
  // mode keeps it in sync automatically below.
  const [previewDate, setPreviewDate] = useState(() => new Date())
  const [previewText, setPreviewText] = useState(() => formatDateTimeInput(new Date(), locale))

  // Reset to sensible defaults every time the dialog opens, rather than
  // carrying over whatever was left selected from a previous episode.
  useEffect(() => {
    if (!open) return
    setMode('justFinished')
  }, [open])

  // Keeps previewDate/previewText in sync with whichever non-"other" mode
  // is selected — computed once when the mode is (re)selected, not a
  // live-ticking clock, so "Now watching"/"Just finished" don't drift
  // while the dialog just sits open.
  useEffect(() => {
    if (!open) return
    let next: Date | null = null
    if (mode === 'nowWatching') {
      next = new Date(Date.now() + (episode.runtimeMinutes ?? 0) * 60_000)
    } else if (mode === 'justFinished') {
      next = new Date()
    } else if (mode === 'releaseDate' && episode.firstAired) {
      next = new Date(episode.firstAired)
    }
    if (next) {
      setPreviewDate(next)
      setPreviewText(formatDateTimeInput(next, locale))
    }
  }, [open, mode, episode.runtimeMinutes, episode.firstAired, locale])

  // "Other date" is the only mode where the user can enter an arbitrary
  // value — bounded to between the episode's air date and "now" plus its
  // runtime (James: can't have watched it before it aired, or in the
  // future). No lower bound when the air date isn't known. Computed fresh
  // on every render rather than stored in state — cheap, and `maxDate`
  // needs to reflect the actual current time regardless of how long the
  // dialog has been open.
  const minDate = episode.firstAired ? new Date(episode.firstAired) : null
  const maxDate = new Date(Date.now() + (episode.runtimeMinutes ?? 0) * 60_000)

  function updatePreviewDate(next: Date) {
    const clamped = clampDate(next, minDate, maxDate)
    setPreviewDate(clamped)
    setPreviewText(formatDateTimeInput(clamped, locale))
  }

  function handleTextChange(text: string) {
    // The text field itself always reflects exactly what's typed — only
    // the parsed value (and the date/time inputs) update when it resolves
    // to something valid, so the field never fights the user mid-keystroke
    // (including when it's clamped — the underlying value used on confirm
    // is kept in range, but what's on screen stays exactly what was typed).
    setPreviewText(text)
    const parsed = parseDateTimeInput(text, locale)
    if (parsed) setPreviewDate(clampDate(parsed, minDate, maxDate))
  }

  function handleConfirm() {
    if (mode === 'unknown') {
      onConfirm(UNKNOWN_WATCHED_AT)
      return
    }
    if (mode === 'releaseDate' && !episode.firstAired) {
      onConfirm(RELEASE_DATE_WATCHED_AT)
      return
    }
    // Defensive clamp — every other mode's previewDate is already in
    // range by construction, but "other" came from user input.
    onConfirm(clampDate(previewDate, minDate, maxDate).toISOString())
  }

  const releaseDateLabel = episode.firstAired
    ? t('showDetail.watchDialog.releaseDate', {
        date: new Date(episode.firstAired).toLocaleDateString(locale, { dateStyle: 'medium' }),
      })
    : allowReleaseDate
      ? t('showDetail.watchDialog.releaseDatePerEpisode')
      : null

  const options: { value: Mode; label: string }[] = [
    { value: 'justFinished', label: t('showDetail.watchDialog.justFinished') },
    ...(allowNowWatching
      ? [{ value: 'nowWatching' as const, label: t('showDetail.watchDialog.nowWatching') }]
      : []),
    ...(releaseDateLabel ? [{ value: 'releaseDate' as const, label: releaseDateLabel }] : []),
    { value: 'unknown', label: t('showDetail.watchDialog.unknown') },
    { value: 'other', label: t('showDetail.watchDialog.otherDate') },
  ]

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={t('showDetail.watchDialog.title', { episode: episode.title ?? episodeLabel })}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">{t('showDetail.watchDialog.legend')}</legend>
        {options.map(({ value, label }) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={radioGroupName}
              value={value}
              checked={mode === value}
              onChange={() => setMode(value)}
              className="accent-[var(--color-primary)]"
            />
            {label}
          </label>
        ))}
      </fieldset>

      {mode === 'other' && (
        <div className="mt-4 flex gap-3">
          <Field
            label={t('showDetail.watchDialog.otherDateDateLabel')}
            hideLabel
            type="date"
            min={minDate ? toDateInputValue(minDate) : undefined}
            max={toDateInputValue(maxDate)}
            value={toDateInputValue(previewDate)}
            onChange={(e) => {
              if (!e.target.value) return
              const [year, month, day] = e.target.value.split('-').map(Number)
              const next = new Date(previewDate)
              next.setFullYear(year!, month! - 1, day!)
              updatePreviewDate(next)
            }}
          />
          <Field
            label={t('showDetail.watchDialog.otherDateTimeLabel')}
            hideLabel
            type="time"
            value={toTimeInputValue(previewDate)}
            onChange={(e) => {
              if (!e.target.value) return
              const [hours, minutes] = e.target.value.split(':').map(Number)
              const next = new Date(previewDate)
              next.setHours(hours!, minutes!)
              updatePreviewDate(next)
            }}
          />
        </div>
      )}

      <Field
        className="mt-4"
        label={t('showDetail.watchDialog.otherDateTextLabel')}
        hideLabel
        type="text"
        readOnly={mode !== 'other'}
        value={
          mode === 'unknown'
            ? t('showDetail.watchDialog.unknown')
            : mode === 'releaseDate' && !episode.firstAired
              ? t('showDetail.watchDialog.releaseDatePerEpisode')
              : previewText
        }
        onChange={(e) => handleTextChange(e.target.value)}
      />

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t('showDetail.watchDialog.cancel')}
        </Button>
        <Button type="button" variant="primary" onClick={handleConfirm}>
          {t('showDetail.watchDialog.confirm')}
        </Button>
      </div>
    </Dialog>
  )
}
