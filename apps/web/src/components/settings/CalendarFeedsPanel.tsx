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

// Save stays disabled until a checkbox actually differs from the saved
// row — a feed is already fully functional at its server-defaulted
// settings the moment it's created (see CalendarFeedsPanel.tsx's own doc
// comment), so an always-enabled Save wrongly implied a required step.
function HistorySettingsForm({ feed }: { feed: Extract<CalendarFeed, { feedType: 'history' }> }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [includeMovies, setIncludeMovies] = useState(feed.settings.includeMovies)
  const [includeShows, setIncludeShows] = useState(feed.settings.includeShows)
  const dirty =
    includeMovies !== feed.settings.includeMovies || includeShows !== feed.settings.includeShows

  const updateSettings = useMutation({
    mutationFn: () => api.calendarFeeds.update('history', { includeMovies, includeShows }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calendarFeeds'] }),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    updateSettings.mutate()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={includeMovies}
            onChange={(e) => setIncludeMovies(e.target.checked)}
          />
          {t('settings.calendarFeeds.history.includeMovies')}
        </label>
        <p className="text-xs text-[var(--color-fg-muted)]">
          {t('settings.calendarFeeds.history.includeMoviesDescription')}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={includeShows}
            onChange={(e) => setIncludeShows(e.target.checked)}
          />
          {t('settings.calendarFeeds.history.includeShows')}
        </label>
        <p className="text-xs text-[var(--color-fg-muted)]">
          {t('settings.calendarFeeds.history.includeShowsDescription')}
        </p>
      </div>
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

function ShowsSettingsForm({ feed }: { feed: Extract<CalendarFeed, { feedType: 'shows' }> }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [includeDropped, setIncludeDropped] = useState(feed.settings.includeDropped)
  const [futureOnly, setFutureOnly] = useState(feed.settings.futureOnly)
  const [includeAllWatched, setIncludeAllWatched] = useState(feed.settings.includeAllWatched)
  const dirty =
    includeDropped !== feed.settings.includeDropped ||
    futureOnly !== feed.settings.futureOnly ||
    includeAllWatched !== feed.settings.includeAllWatched

  const updateSettings = useMutation({
    mutationFn: () =>
      api.calendarFeeds.update('shows', { includeDropped, futureOnly, includeAllWatched }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calendarFeeds'] }),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    updateSettings.mutate()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={includeDropped}
            onChange={(e) => setIncludeDropped(e.target.checked)}
          />
          {t('settings.calendarFeeds.shows.includeDropped')}
        </label>
        <p className="text-xs text-[var(--color-fg-muted)]">
          {t('settings.calendarFeeds.shows.includeDroppedDescription')}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={futureOnly}
            onChange={(e) => setFutureOnly(e.target.checked)}
          />
          {t('settings.calendarFeeds.shows.futureOnly')}
        </label>
        <p className="text-xs text-[var(--color-fg-muted)]">
          {t('settings.calendarFeeds.shows.futureOnlyDescription')}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={includeAllWatched}
            onChange={(e) => setIncludeAllWatched(e.target.checked)}
          />
          {t('settings.calendarFeeds.shows.includeAllWatched')}
        </label>
        <p className="text-xs text-[var(--color-fg-muted)]">
          {t('settings.calendarFeeds.shows.includeAllWatchedDescription')}
        </p>
      </div>
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
 * `justCreated`-style one-time reveal the way TokensPanel.tsx's API
 * token is — an API token grants arbitrary API access and is shown once
 * because of that; this URL grants read-only access to one derived view
 * and has to be re-copyable indefinitely (a new device, a calendar app
 * reinstalled, etc). Regenerate is the invalidation mechanism here, not
 * one-time reveal. Getting this backwards would silently reintroduce the
 * exact usability problem this feature exists to avoid.
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
 * apps (History + TV Shows; Movies deferred, see docs/TODO.md — no
 * release-date infrastructure exists yet). Self-gates on
 * `calendarFeedsAvailable`, same shape as InvitesPanel.tsx self-gating on
 * `registrationMode` — this instance has no `ENCRYPTION_KEY` configured,
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
  const [copiedFeedType, setCopiedFeedType] = useState<CalendarFeedType>()
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

  function copyToken(feedType: CalendarFeedType, token: string) {
    void navigator.clipboard.writeText(feedUrl(token))
    setCopiedFeedType(feedType)
    setTimeout(
      () => setCopiedFeedType((current) => (current === feedType ? undefined : current)),
      2000,
    )
  }

  const historyFeed = data?.feeds.find(
    (feed): feed is Extract<CalendarFeed, { feedType: 'history' }> => feed.feedType === 'history',
  )
  const showsFeed = data?.feeds.find(
    (feed): feed is Extract<CalendarFeed, { feedType: 'shows' }> => feed.feedType === 'shows',
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
              copied={copiedFeedType === 'history'}
              onCopy={() => historyFeed && copyToken('history', historyFeed.token)}
              onRegenerate={() => setRegenerateTarget('history')}
              onDelete={() => setDeleteTarget('history')}
              locale={i18n.language}
            >
              {historyFeed && <HistorySettingsForm feed={historyFeed} />}
            </FeedRow>

            <FeedRow
              feed={showsFeed}
              title={t('settings.calendarFeeds.shows.title')}
              description={t('settings.calendarFeeds.shows.description')}
              onCreate={() => createFeed.mutate('shows')}
              creating={createFeed.isPending && createFeed.variables === 'shows'}
              copied={copiedFeedType === 'shows'}
              onCopy={() => showsFeed && copyToken('shows', showsFeed.token)}
              onRegenerate={() => setRegenerateTarget('shows')}
              onDelete={() => setDeleteTarget('shows')}
              locale={i18n.language}
            >
              {showsFeed && <ShowsSettingsForm feed={showsFeed} />}
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
