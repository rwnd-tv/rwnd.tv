import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api-client.js'
import { UNKNOWN_WATCHED_AT, formatDateTimeInput } from '../lib/date.js'
import { useAuth } from '../lib/auth-context.js'
import { useEpisodeWatchActions } from '../lib/use-episode-watch-actions.js'
import { WatchDateDialog } from '../components/library/WatchDateDialog.js'
import { UnwatchConfirmDialog } from '../components/library/UnwatchConfirmDialog.js'
import { Button } from '../components/ui/Button.js'
import { Spinner } from '../components/ui/Spinner.js'

/** Duplicated from SeasonDetailPage.tsx rather than shared, matching that
 * file's existing per-file icon precedent. */
function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function ChevronLeftIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 6l-6 6 6 6" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

/**
 * One episode's own page — reachable by clicking its thumbnail/title on the
 * season grid (SeasonDetailPage.tsx's EpisodeCard). Sources its data from
 * the same season query that grid already uses (every field this page needs
 * — overview, still image, runtime, watched state — is already on
 * SeasonEpisode) rather than a dedicated endpoint, plus this episode's own
 * watch-history list (already fetched on demand elsewhere for the unwatch
 * dialog, here shown unconditionally).
 */
export function EpisodeDetailPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const locale = user?.locale ?? 'en-GB'
  const {
    slug,
    seasonNumber: seasonNumberParam,
    episodeNumber: episodeNumberParam,
  } = useParams<{ slug: string; seasonNumber: string; episodeNumber: string }>()
  const seasonNumber = Number(seasonNumberParam)
  const episodeNumber = Number(episodeNumberParam)
  const paramsValid = Number.isInteger(seasonNumber) && Number.isInteger(episodeNumber)

  const { data: show } = useQuery({
    queryKey: ['show', slug],
    queryFn: () => api.library.show(slug!),
    enabled: Boolean(slug),
  })

  const {
    data: season,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['show', slug, 'season', seasonNumber],
    queryFn: () => api.library.season(slug!, seasonNumber),
    enabled: Boolean(slug) && paramsValid,
  })

  const episode = season?.episodes.find((e) => e.episodeNumber === episodeNumber)

  const { data: watchesData } = useQuery({
    queryKey: ['show', slug, 'season', seasonNumber, 'episode', episodeNumber, 'watches'],
    queryFn: () => api.library.episodeWatches(slug!, seasonNumber, episodeNumber),
    enabled: Boolean(slug) && paramsValid && Boolean(episode),
  })

  const watchActions = useEpisodeWatchActions(
    slug ?? '',
    seasonNumber,
    episode,
    show?.tmdbId ?? null,
  )

  if (isLoading) return <Spinner label={t('common.loading')} />

  if (error || !paramsValid) {
    return (
      <p className="text-[var(--color-fg-muted)]">
        {error instanceof ApiError && error.status === 404
          ? t('showDetail.seasonNotFound')
          : t('common.somethingWentWrong')}
      </p>
    )
  }
  if (!season) return null

  if (!episode) {
    return <p className="text-[var(--color-fg-muted)]">{t('showDetail.episodeDetail.notFound')}</p>
  }

  const seasonName =
    season.name ??
    (season.seasonNumber === 0
      ? t('showDetail.specials')
      : t('import.progress.season', { number: season.seasonNumber }))
  const episodeLabel = t('import.progress.episode', { number: episode.episodeNumber })
  const toggleLabel = t(episode.watched ? 'showDetail.markUnwatched' : 'showDetail.markWatched')
  const toggleTitle =
    !episode.watched && watchActions.notAiredYet ? t('showDetail.episodeNotAiredYet') : toggleLabel

  // season.episodes is already ordered by episodeNumber ascending (see
  // SeasonDetailPage.tsx's grid, which relies on the same order) — adjacent
  // array entries are exactly the previous/next episode. Scoped to this
  // season only, same as SeasonDetailPage's own previous/next season
  // buttons don't cross into a different show.
  const episodeIndex = season.episodes.findIndex((e) => e.episodeNumber === episode.episodeNumber)
  const previousEpisode = episodeIndex > 0 ? season.episodes[episodeIndex - 1] : undefined
  const nextEpisode =
    episodeIndex !== -1 && episodeIndex < season.episodes.length - 1
      ? season.episodes[episodeIndex + 1]
      : undefined

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <Link
          to={`/shows/${slug}/season/${seasonNumber}`}
          className="w-fit text-sm text-[var(--color-fg-muted)] hover:underline"
        >
          ← {seasonName}
        </Link>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="secondary"
            className="px-2.5 py-2.5"
            disabled={!previousEpisode}
            aria-label={t('showDetail.episodeDetail.previousEpisode')}
            title={t('showDetail.episodeDetail.previousEpisode')}
            onClick={() =>
              navigate(
                `/shows/${slug}/season/${seasonNumber}/episode/${previousEpisode!.episodeNumber}`,
              )
            }
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="px-2.5 py-2.5"
            disabled={!nextEpisode}
            aria-label={t('showDetail.episodeDetail.nextEpisode')}
            title={t('showDetail.episodeDetail.nextEpisode')}
            onClick={() =>
              navigate(
                `/shows/${slug}/season/${seasonNumber}/episode/${nextEpisode!.episodeNumber}`,
              )
            }
          >
            <ChevronRightIcon />
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="aspect-video w-full flex-shrink-0 overflow-hidden rounded-lg bg-[var(--color-surface)] sm:w-96">
          {episode.stillPath ? (
            <img
              src={episode.stillPath}
              alt=""
              width={780}
              height={439}
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex h-full items-center justify-center text-4xl font-semibold text-[var(--color-fg-muted)]"
            >
              {episode.episodeNumber}
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <h1 className="text-2xl font-semibold">{episode.title ?? episodeLabel}</h1>
          <p className="text-sm text-[var(--color-fg-muted)]">{episodeLabel}</p>
          <div className="flex flex-wrap items-center gap-x-1.5 text-sm text-[var(--color-fg-muted)]">
            {episode.firstAired && (
              <span>
                {new Date(episode.firstAired).toLocaleDateString(locale, { dateStyle: 'medium' })}
              </span>
            )}
            {episode.firstAired && episode.runtimeMinutes !== null && (
              <span aria-hidden="true">·</span>
            )}
            {episode.runtimeMinutes !== null && (
              <span>
                {t('showDetail.episodeDetail.runtime', { minutes: episode.runtimeMinutes })}
              </span>
            )}
          </div>
          {episode.overview && <p className="max-w-2xl text-sm">{episode.overview}</p>}

          <div className="flex gap-2">
            <Button
              variant={episode.watched ? 'primary' : 'secondary'}
              type="button"
              disabled={watchActions.toggleDisabled}
              title={toggleTitle}
              aria-pressed={episode.watched}
              onClick={() =>
                episode.watched
                  ? watchActions.setUnwatchConfirmOpen(true)
                  : watchActions.setDialogOpen(true)
              }
            >
              <CheckIcon />
              {toggleLabel}
            </Button>
            {episode.watched && (
              <Button
                variant="secondary"
                type="button"
                className="px-2.5 py-2.5"
                disabled={watchActions.unwatch.isPending || watchActions.markWatched.isPending}
                title={t('showDetail.logAdditionalWatch')}
                aria-label={t('showDetail.logAdditionalWatch')}
                onClick={() => watchActions.setLogAdditionalWatchOpen(true)}
              >
                <PlusIcon />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t('showDetail.episodeDetail.watchHistoryTitle')}</h2>
        {watchesData === undefined ? (
          <Spinner label={t('common.loading')} />
        ) : watchesData.watches.length === 0 ? (
          <p className="text-sm text-[var(--color-fg-muted)]">
            {t('showDetail.episodeDetail.watchHistoryEmpty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm text-[var(--color-fg-muted)]">
            {watchesData.watches.map((watch) => (
              <li key={watch.id}>
                {watch.watchedAt === UNKNOWN_WATCHED_AT
                  ? t('history.unknownDate')
                  : formatDateTimeInput(new Date(watch.watchedAt), locale)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <WatchDateDialog
        open={watchActions.dialogOpen}
        episodeLabel={episodeLabel}
        episode={{
          title: episode.title,
          runtimeMinutes: episode.runtimeMinutes,
          firstAired: episode.firstAired,
        }}
        locale={locale}
        onConfirm={(watchedAt) => {
          watchActions.markWatched.mutate(watchedAt)
          watchActions.setDialogOpen(false)
        }}
        onCancel={() => watchActions.setDialogOpen(false)}
      />

      <WatchDateDialog
        open={watchActions.logAdditionalWatchOpen}
        episodeLabel={episodeLabel}
        episode={{
          title: episode.title,
          runtimeMinutes: episode.runtimeMinutes,
          firstAired: episode.firstAired,
        }}
        locale={locale}
        disableUnknown={episode.hasUnknownWatch}
        onConfirm={(watchedAt) => {
          watchActions.markWatched.mutate(watchedAt)
          watchActions.setLogAdditionalWatchOpen(false)
        }}
        onCancel={() => watchActions.setLogAdditionalWatchOpen(false)}
      />

      <UnwatchConfirmDialog
        open={watchActions.unwatchConfirmOpen}
        watchedCountHint={episode.watchedCount}
        watches={watchActions.watchesData?.watches}
        locale={locale}
        onConfirm={(ids) => watchActions.unwatch.mutate(ids)}
        onCancel={() => watchActions.setUnwatchConfirmOpen(false)}
      />
    </div>
  )
}
