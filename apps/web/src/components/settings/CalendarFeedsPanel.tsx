import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CalendarFeed, CalendarFeedType } from '@rwnd/shared'
import { api } from '../../lib/api-client.js'
import { usePublicSettings } from '../../lib/use-public-settings.js'
import { Card } from '../ui/Card.js'
import { Button } from '../ui/Button.js'
import { Dialog } from '../ui/Dialog.js'
import { Spinner } from '../ui/Spinner.js'
import { ChevronDownIcon } from '../icons.js'
import { usePanelOpen } from '../../lib/use-panel-open.js'
import { useCopyFeedback } from '../../lib/use-copy-feedback.js'

function feedUrl(token: string): string {
  return `${window.location.origin}/api/v1/calendar/${token}/feed.ics`
}

// Google Calendar's "From URL" field rejects a `webcal:` scheme outright,
// so the plain https:// URL above is what Copy puts on the clipboard —
// this is only for the Subscribe link, which Apple Calendar and most
// other clients register a handler for.
function webcalUrl(token: string): string {
  return feedUrl(token).replace(/^https?:/, 'webcal:')
}

/** Which settings fields exist per feed type, in display order — the only
 * thing that actually differs between the three settings forms below
 * (feedType and i18n namespace are both already implied by `feed.feedType`
 * itself). Movies is exactly Shows minus `includeDropped` — dropping is a
 * shows-only concept, there is no droppedMovies table. Typed as plain
 * strings, not `keyof CalendarFeed['settings']`: that computes to the
 * *intersection* of the three settings shapes' keys (empty, since no field
 * is common to all three), not their union — TypeScript can't statically
 * verify field access across a discriminated union's branches generically,
 * which is exactly why `values`/`feed.settings` below are treated as a
 * plain string-keyed bag rather than fought into typing. */
const FEED_FIELDS: Record<CalendarFeedType, readonly string[]> = {
  history: ['includeMovies', 'includeShows'],
  shows: ['includeDropped', 'futureOnly', 'includeAllWatched'],
  movies: ['futureOnly', 'includeAllWatched'],
}

/** Save stays disabled until a checkbox actually differs from the saved
 * row — a feed is already fully functional at its server-defaulted
 * settings the moment it's created (see CalendarFeedsPanel.tsx's own doc
 * comment), so an always-enabled Save wrongly implied a required step.
 * One config-driven form for all three feed types (M4 review's
 * `/code-review high` pass, docs/TODO.md) — `values` is seeded from
 * `feed.settings` and only ever iterated over `FEED_FIELDS[feed.feedType]`,
 * so by construction it can never carry a key outside that feed type's own
 * schema (e.g. movies can't accidentally send `includeDropped`), even
 * though the cast below stops TypeScript verifying that statically. */
function FeedSettingsForm({ feed }: { feed: CalendarFeed }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const settings = feed.settings as Record<string, boolean>
  const [values, setValues] = useState(settings)
  const fields = FEED_FIELDS[feed.feedType]
  const dirty = fields.some((field) => values[field] !== settings[field])

  const updateSettings = useMutation({
    mutationFn: () => api.calendarFeeds.update(feed.feedType, values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calendarFeeds'] }),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    updateSettings.mutate()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {fields.map((field) => (
        <div key={field} className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={values[field]}
              onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.checked }))}
            />
            {t(`settings.calendarFeeds.${feed.feedType}.${field}`)}
          </label>
          <p className="text-xs text-[var(--color-fg-muted)]">
            {t(`settings.calendarFeeds.${feed.feedType}.${field}Description`)}
          </p>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!dirty} isLoading={updateSettings.isPending}>
          {t('settings.calendarFeeds.save')}
        </Button>
        {!dirty && updateSettings.isSuccess && (
          <span className="text-sm text-[var(--color-fg-muted)]">
            {t('settings.calendarFeeds.saved')}
          </span>
        )}
      </div>
    </form>
  )
}

/**
 * Shared shell for one feed type's row: the create button before a feed
 * exists, or the URL/settings/regenerate/delete block once it does.
 *
 * Deliberately shows the subscription URL unconditionally, with no
 * `justCreated`-style one-time reveal — this URL has to be re-copyable
 * indefinitely (a new device, a calendar app reinstalled, etc), and
 * Regenerate is the invalidation mechanism here, not one-time reveal.
 * `WebhookCard.tsx`'s own URL row now follows the same shape for the
 * same reason (docs/adr/0007-security-posture.md's 2026-09-14 update) —
 * this file just got there first, back when a webhook token's one-time
 * reveal was still the only precedent in the codebase to contrast with.
 * Getting either backwards would silently reintroduce the exact
 * usability problem this feature exists to avoid.
 */
function FeedRow({
  feed,
  title,
  description,
  onCreate,
  creating,
  copied,
  onCopy,
  onRegenerate,
  onDelete,
  locale,
  children,
}: {
  feed: CalendarFeed | undefined
  title: string
  description: string
  onCreate: () => void
  creating: boolean
  copied: boolean
  onCopy: () => void
  onRegenerate: () => void
  onDelete: () => void
  locale: string
  children: ReactNode
}) {
  const { t } = useTranslation()

  return (
    <div className="rounded-md border border-[var(--color-border)] p-4">
      <h3 className="mb-1 text-base font-semibold">{title}</h3>
      <p className="mb-3 text-sm text-[var(--color-fg-muted)]">{description}</p>

      {!feed ? (
        <Button type="button" onClick={onCreate} isLoading={creating}>
          {t('settings.calendarFeeds.create')}
        </Button>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            {feed.token ? (
              <>
                <div className="flex items-center gap-2">
                  <code className="block flex-1 truncate rounded-md bg-[var(--color-surface)] px-2 py-1 text-xs">
                    {feedUrl(feed.token)}
                  </code>
                  <Button type="button" variant="secondary" onClick={onCopy}>
                    {copied ? t('settings.calendarFeeds.copied') : t('settings.calendarFeeds.copy')}
                  </Button>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <a href={webcalUrl(feed.token)} className="text-sm underline hover:no-underline">
                    {t('settings.calendarFeeds.subscribe')}
                  </a>
                  <p className="text-xs text-[var(--color-fg-muted)]">
                    {feed.lastAccessedAt
                      ? t('settings.calendarFeeds.lastSynced', {
                          date: new Date(feed.lastAccessedAt).toLocaleString(locale),
                        })
                      : t('settings.calendarFeeds.neverSynced')}
                  </p>
                </div>
              </>
            ) : (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-[var(--color-fg-muted)]">
                  {t('settings.calendarFeeds.urlUnavailable')}
                </p>
                <p className="text-xs text-[var(--color-fg-muted)]">
                  {feed.lastAccessedAt
                    ? t('settings.calendarFeeds.lastSynced', {
                        date: new Date(feed.lastAccessedAt).toLocaleString(locale),
                      })
                    : t('settings.calendarFeeds.neverSynced')}
                </p>
              </div>
            )}
          </div>

          {children}

          <div className="flex gap-2 border-t border-[var(--color-border)] pt-3">
            <Button type="button" variant="secondary" onClick={onRegenerate}>
              {t('settings.calendarFeeds.regenerate')}
            </Button>
            <Button type="button" variant="danger" onClick={onDelete}>
              {t('settings.calendarFeeds.delete')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Subscription feeds for Google/Apple/other webcal-compatible calendar
 * apps: History, TV Shows, and Movies. Self-gates on
 * `calendarFeedsAvailable`, same shape as MfaCard.tsx self-gating on
 * `mfaAvailable` — this instance has no `ENCRYPTION_KEY` configured,
 * so there's nowhere to durably store a re-copyable token (see
 * `calendarFeedsAvailable`'s doc comment,
 * packages/shared/src/schemas/settings.ts). Collapsed by default like
 * every other panel on this page except AboutPanel.tsx (2026-09-02) —
 * see account/AdvancedPreferencesCard.tsx's doc comment for why
 * `<details>` over a bespoke show/hide component.
 */
export function CalendarFeedsPanel() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = usePanelOpen('panelSettingsCalendarFeeds')
  const { data: publicSettings } = usePublicSettings()
  const { isCopied: isFeedTypeCopied, copy: copyToken } = useCopyFeedback<CalendarFeedType>()
  const [regenerateTarget, setRegenerateTarget] = useState<CalendarFeedType>()
  const [deleteTarget, setDeleteTarget] = useState<CalendarFeedType>()

  const enabled = publicSettings?.calendarFeedsAvailable ?? false

  const { data, isLoading } = useQuery({
    queryKey: ['calendarFeeds'],
    queryFn: () => api.calendarFeeds.list(),
    enabled,
  })

  const createFeed = useMutation({
    mutationFn: (feedType: CalendarFeedType) => api.calendarFeeds.create({ feedType }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calendarFeeds'] }),
  })

  const regenerateFeed = useMutation({
    mutationFn: (feedType: CalendarFeedType) => api.calendarFeeds.regenerate(feedType),
    onSuccess: () => {
      setRegenerateTarget(undefined)
      void queryClient.invalidateQueries({ queryKey: ['calendarFeeds'] })
    },
  })

  const deleteFeed = useMutation({
    mutationFn: (feedType: CalendarFeedType) => api.calendarFeeds.delete(feedType),
    onSuccess: () => {
      setDeleteTarget(undefined)
      void queryClient.invalidateQueries({ queryKey: ['calendarFeeds'] })
    },
  })

  if (!enabled) return null

  const historyFeed = data?.feeds.find(
    (feed): feed is Extract<CalendarFeed, { feedType: 'history' }> => feed.feedType === 'history',
  )
  const showsFeed = data?.feeds.find(
    (feed): feed is Extract<CalendarFeed, { feedType: 'shows' }> => feed.feedType === 'shows',
  )
  const moviesFeed = data?.feeds.find(
    (feed): feed is Extract<CalendarFeed, { feedType: 'movies' }> => feed.feedType === 'movies',
  )

  return (
    <Card>
      <details className="group" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center justify-between text-lg font-semibold [&::-webkit-details-marker]:hidden">
          {t('settings.calendarFeeds.title')}
          <ChevronDownIcon className="h-5 w-5 flex-shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-4 mb-4 border-t border-[var(--color-border)]" />
        <p className="mb-4 text-sm text-[var(--color-fg-muted)]">
          {t('settings.calendarFeeds.description')}
        </p>

        {isLoading ? (
          <Spinner label={t('common.loading')} />
        ) : (
          <div className="flex flex-col gap-4">
            <FeedRow
              feed={historyFeed}
              title={t('settings.calendarFeeds.history.title')}
              description={t('settings.calendarFeeds.history.description')}
              onCreate={() => createFeed.mutate('history')}
              creating={createFeed.isPending && createFeed.variables === 'history'}
              copied={isFeedTypeCopied('history')}
              onCopy={() => historyFeed?.token && copyToken(feedUrl(historyFeed.token), 'history')}
              onRegenerate={() => setRegenerateTarget('history')}
              onDelete={() => setDeleteTarget('history')}
              locale={i18n.language}
            >
              {historyFeed && <FeedSettingsForm feed={historyFeed} />}
            </FeedRow>

            <FeedRow
              feed={showsFeed}
              title={t('settings.calendarFeeds.shows.title')}
              description={t('settings.calendarFeeds.shows.description')}
              onCreate={() => createFeed.mutate('shows')}
              creating={createFeed.isPending && createFeed.variables === 'shows'}
              copied={isFeedTypeCopied('shows')}
              onCopy={() => showsFeed?.token && copyToken(feedUrl(showsFeed.token), 'shows')}
              onRegenerate={() => setRegenerateTarget('shows')}
              onDelete={() => setDeleteTarget('shows')}
              locale={i18n.language}
            >
              {showsFeed && <FeedSettingsForm feed={showsFeed} />}
            </FeedRow>

            <FeedRow
              feed={moviesFeed}
              title={t('settings.calendarFeeds.movies.title')}
              description={t('settings.calendarFeeds.movies.description')}
              onCreate={() => createFeed.mutate('movies')}
              creating={createFeed.isPending && createFeed.variables === 'movies'}
              copied={isFeedTypeCopied('movies')}
              onCopy={() => moviesFeed?.token && copyToken(feedUrl(moviesFeed.token), 'movies')}
              onRegenerate={() => setRegenerateTarget('movies')}
              onDelete={() => setDeleteTarget('movies')}
              locale={i18n.language}
            >
              {moviesFeed && <FeedSettingsForm feed={moviesFeed} />}
            </FeedRow>
          </div>
        )}
      </details>

      <Dialog
        open={Boolean(regenerateTarget)}
        onClose={() => setRegenerateTarget(undefined)}
        title={t('settings.calendarFeeds.regenerateConfirmTitle')}
      >
        <p className="text-sm text-[var(--color-fg-muted)]">
          {t('settings.calendarFeeds.regenerateConfirmBody')}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setRegenerateTarget(undefined)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            isLoading={regenerateFeed.isPending}
            onClick={() => regenerateTarget && regenerateFeed.mutate(regenerateTarget)}
          >
            {t('settings.calendarFeeds.regenerate')}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(undefined)}
        title={t('settings.calendarFeeds.deleteConfirmTitle')}
      >
        <p className="text-sm text-[var(--color-fg-muted)]">
          {t('settings.calendarFeeds.deleteConfirmBody')}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setDeleteTarget(undefined)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            isLoading={deleteFeed.isPending}
            onClick={() => deleteTarget && deleteFeed.mutate(deleteTarget)}
          >
            {t('settings.calendarFeeds.delete')}
          </Button>
        </div>
      </Dialog>
    </Card>
  )
}
