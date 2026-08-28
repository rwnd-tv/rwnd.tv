import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MovieDetail } from '@rwnd/shared'
import { api, ApiError } from '../lib/api-client.js'
import { useAuth } from '../lib/use-auth.js'
import { UNKNOWN_WATCHED_AT, formatHistoryDate } from '../lib/date.js'
import { invalidateWatchData } from '../lib/query-client.js'
import { useMovieWatchActions } from '../lib/use-movie-watch-actions.js'
import { TMDB_LOGO_URL } from '../lib/tmdb.js'
import { TVDB_LOGO_DARK_BG_URL, TVDB_LOGO_LIGHT_BG_URL, tvdbMovieUrl } from '../lib/tvdb.js'
import { MetadataAttribution } from '../components/library/MetadataAttribution.js'
import { RatingPicker } from '../components/library/RatingPicker.js'
import { UnwatchConfirmDialog } from '../components/library/UnwatchConfirmDialog.js'
import { WatchDateDialog } from '../components/library/WatchDateDialog.js'
import { WatchlistButton } from '../components/library/WatchlistButton.js'
import { Button } from '../components/ui/Button.js'
import { Dialog } from '../components/ui/Dialog.js'
import { Spinner } from '../components/ui/Spinner.js'

/** Same tick used on the show page's Watched button (ShowDetailPage.tsx's
 * own CheckIcon) — duplicated rather than shared/exported, matching this
 * codebase's existing precedent of one small icon component per file. */
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

/** Icon for the icon-only "log an additional watch" button below. */
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

/** Icon for the icon-only "refresh metadata" button below. */
function RefreshIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v6h-6" />
    </svg>
  )
}

/** Same "2012" / "2012 - 2014" shape as ShowDetailPage's own
 * watchedPeriodRange — duplicated rather than shared, since sharing a
 * two-line pure function isn't worth a new file either page would need to
 * import from. */
function watchedPeriodRange(firstWatchedAt: string, lastWatchedAt: string): string {
  const firstYear = new Date(firstWatchedAt).getFullYear()
  const lastYear = new Date(lastWatchedAt).getFullYear()
  return firstYear === lastYear ? String(firstYear) : `${firstYear} - ${lastYear}`
}

/**
 * The per-movie page — linked to from the movies gallery, Dashboard
 * search, and History. Much flatter than ShowDetailPage.tsx: a movie has
 * no season/episode tree, no spoiler-worthy overview (a movie's own
 * synopsis isn't treated as a spoiler the way an unwatched show's is), and
 * no Drop action (dropped_shows is deliberately shows-only — see
 * packages/db/src/schema.ts). Its Watched/unwatch UI instead mirrors
 * EpisodeCard.tsx: a movie is structurally one thing with N plays, same as
 * an episode, not a show/season/episode tree — see
 * use-movie-watch-actions.ts.
 */
export function MovieDetailPage() {
  const { t } = useTranslation()
  const { slug } = useParams<{ slug: string }>()
  const { user } = useAuth()
  const locale = user?.locale ?? 'en-GB'
  const queryClient = useQueryClient()

  const {
    data: movie,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['movie', slug],
    queryFn: () => api.library.movie(slug!),
    enabled: Boolean(slug),
  })

  const {
    dialogOpen,
    setDialogOpen,
    logAdditionalWatchOpen,
    setLogAdditionalWatchOpen,
    unwatchConfirmOpen,
    setUnwatchConfirmOpen,
    watchesData,
    markWatched,
    unwatch,
    toggleDisabled,
  } = useMovieWatchActions(slug!, movie, movie?.tmdbId ?? null)

  const [selectedWatchIds, setSelectedWatchIds] = useState<Set<string>>(new Set())
  const [deleteSelectedConfirmOpen, setDeleteSelectedConfirmOpen] = useState(false)

  // Same queryKey useMovieWatchActions' own watchesData query uses (see
  // that hook's doc comment) — that one only fetches while the unwatch
  // dialog is open. This page only ever renders one movie, so it's fine to
  // fetch unconditionally once there's at least one watch to show; sharing
  // the queryKey means the two consumers share one cached fetch rather than
  // duplicating it. Named separately from the hook's own `watchesData` to
  // avoid shadowing it.
  const { data: historyWatchesData } = useQuery({
    queryKey: ['movie', slug, 'watches'],
    queryFn: () => api.library.movieWatches(slug!),
    enabled: Boolean(slug) && Boolean(movie) && movie!.watchedCount > 0,
  })

  function toggleWatchSelected(id: string) {
    setSelectedWatchIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Manual "refresh metadata" button — same reasoning as ShowDetailPage's
  // own refreshMetadata: a refresh can touch almost any cached field
  // (title, poster, genres, rating...), so a real refetch is simpler and
  // more correct than guessing what changed.
  const refreshMetadata = useMutation({
    mutationFn: () => api.library.refreshMovie(slug!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['movie', slug] })
      void queryClient.invalidateQueries({ queryKey: ['library'] })
    },
  })

  // See ShowDetailPage.tsx's identical mutation for the full reasoning —
  // fully independent of watched status, never touches plays.
  const setRating = useMutation({
    mutationFn: (rating: number | null) =>
      rating === null ? api.library.clearMovieRating(slug!) : api.library.rateMovie(slug!, rating),
    onSuccess: (status) => {
      queryClient.setQueryData(['movie', slug], (prev: MovieDetail | undefined) =>
        prev ? { ...prev, myRating: status.rating } : prev,
      )
      void invalidateWatchData(queryClient)
    },
  })

  if (isLoading) return <Spinner label={t('common.loading')} />

  if (error) {
    return (
      <p className="text-[var(--color-fg-muted)]">
        {error instanceof ApiError && error.status === 404
          ? t('movieDetail.notFound')
          : t('common.somethingWentWrong')}
      </p>
    )
  }
  if (!movie) return null

  return (
    <div className="flex flex-col gap-8">
      {/* lg:items-start is load-bearing, not decorative — see
          EpisodeDetailPage.tsx's own still-image container for the full
          explanation: flex's default align-items:stretch would otherwise
          force this aspect-[2/3] poster box to match the text column's
          height once they sit side by side, distorting the poster's real
          crop. lg, not sm, so the switch to row layout itself only
          happens once there's enough width for the text column to
          comfortably fit next to it. */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="aspect-[2/3] w-48 flex-shrink-0 overflow-hidden rounded-lg bg-[var(--color-surface)]">
          {movie.posterPath ? (
            <img
              src={movie.posterPath}
              alt=""
              width={342}
              height={513}
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex h-full items-center justify-center text-4xl font-semibold text-[var(--color-fg-muted)]"
            >
              {movie.title.charAt(0)}
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <h1 className="text-2xl font-semibold">{movie.title}</h1>
          <div className="flex flex-wrap items-center gap-x-1.5 text-sm text-[var(--color-fg-muted)]">
            {(
              [
                movie.year,
                movie.genres.length > 0 ? movie.genres.join(', ') : null,
                movie.runtimeMinutes !== null
                  ? t('movieDetail.runtime', { minutes: movie.runtimeMinutes })
                  : null,
                movie.voteAverage !== null ? (
                  <span className="inline-flex items-center gap-1.5">
                    {movie.tmdbId ? (
                      <a
                        href={`https://www.themoviedb.org/movie/${movie.tmdbId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={t('movieDetail.viewOnTmdb')}
                      >
                        <img
                          src={TMDB_LOGO_URL}
                          alt={t('movieDetail.viewOnTmdb')}
                          className="h-3"
                        />
                      </a>
                    ) : (
                      <img
                        src={TMDB_LOGO_URL}
                        alt={t('movieDetail.ratingSource')}
                        className="h-3"
                      />
                    )}
                    {movie.voteAverage.toFixed(1)}
                  </span>
                ) : null,
                // See ShowDetailPage.tsx's own tvdbId fact for why this is
                // just the logo/link rather than a rating badge.
                movie.tvdbId ? (
                  <a
                    href={tvdbMovieUrl(movie.tvdbId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={t('movieDetail.viewOnTvdb')}
                  >
                    <img
                      src={TVDB_LOGO_LIGHT_BG_URL}
                      alt={t('movieDetail.viewOnTvdb')}
                      className="tvdb-logo-light h-[0.9rem]"
                    />
                    <img
                      src={TVDB_LOGO_DARK_BG_URL}
                      alt={t('movieDetail.viewOnTvdb')}
                      className="tvdb-logo-dark h-[0.9rem]"
                    />
                  </a>
                ) : null,
              ] satisfies (ReactNode | null)[]
            )
              .filter((fact) => fact !== null)
              .map((fact, index) => (
                <span key={index} className="flex items-center gap-1.5">
                  {index > 0 && <span aria-hidden="true">·</span>}
                  {fact}
                </span>
              ))}
          </div>

          {movie.overview && <p className="max-w-2xl text-sm">{movie.overview}</p>}
          {movie.metadataSource && (
            // See ShowDetailPage.tsx's own metadataSource block for why
            // this is separate from the rating badge above and on its own
            // line rather than folded into the fact line.
            <MetadataAttribution
              source={movie.metadataSource}
              refreshedAt={movie.metadataRefreshedAt}
              locale={locale}
            />
          )}

          <div className="flex gap-2">
            <Button
              variant={movie.watched ? 'primary' : 'secondary'}
              type="button"
              disabled={!movie.watched && !movie.tmdbId}
              title={
                !movie.watched && !movie.tmdbId
                  ? t('movieDetail.watchedButtonDisabled')
                  : t(
                      movie.watched
                        ? 'movieDetail.watchedButtonTooltip.remove'
                        : 'movieDetail.watchedButtonTooltip.add',
                    )
              }
              onClick={() => (movie.watched ? setUnwatchConfirmOpen(true) : setDialogOpen(true))}
            >
              <CheckIcon />
              {t('movieDetail.watchedButton')}
            </Button>
            {movie.watched && (
              <Button
                variant="secondary"
                type="button"
                className="px-2.5 py-2.5"
                disabled={toggleDisabled}
                title={t('movieDetail.addWatchTooltip')}
                aria-label={t('movieDetail.addWatchTooltip')}
                onClick={() => setLogAdditionalWatchOpen(true)}
              >
                <PlusIcon />
              </Button>
            )}
            <WatchlistButton
              mediaType="movie"
              slug={movie.slug}
              myWatchlistIds={movie.myWatchlistIds}
            />
            <Button
              variant="secondary"
              type="button"
              className="px-2.5 py-2.5"
              disabled={refreshMetadata.isPending || !movie.metadataSource}
              title={
                movie.metadataSource
                  ? t('movieDetail.refreshMetadataTooltip')
                  : t('movieDetail.refreshMetadataDisabled')
              }
              aria-label={t('movieDetail.refreshMetadataTooltip')}
              onClick={() => refreshMetadata.mutate()}
            >
              <RefreshIcon />
            </Button>
          </div>

          <RatingPicker
            value={movie.myRating}
            onRate={(rating) => setRating.mutate(rating)}
            onClear={() => setRating.mutate(null)}
            disabled={setRating.isPending}
          />

          {refreshMetadata.isSuccess && (
            <p className="text-xs text-[var(--color-fg-muted)]">
              {t('movieDetail.refreshMetadataDone')}
            </p>
          )}
          {refreshMetadata.isError && (
            <p className="text-xs text-[var(--color-danger)]">{t('common.somethingWentWrong')}</p>
          )}

          {movie.firstWatchedAt && movie.lastWatchedAt ? (
            <p className="text-xs text-[var(--color-fg-muted)]">
              {t('movieDetail.watchedPeriod', {
                range: watchedPeriodRange(movie.firstWatchedAt, movie.lastWatchedAt),
              })}
            </p>
          ) : (
            movie.hasUnknownWatchDate && (
              <p className="text-xs text-[var(--color-fg-muted)]">
                {t('movieDetail.watchedUnknown')}
              </p>
            )
          )}
          {movie.watchedCount > 1 && (
            <p className="text-xs text-[var(--color-fg-muted)]">
              {t('movieDetail.watchedCount', { count: movie.watchedCount })}
            </p>
          )}
        </div>
      </div>

      {movie.watchedCount > 0 && (
        // Native <details>/<summary> — same collapsible pattern as
        // EpisodeDetailPage.tsx's own History table (closed by default, no
        // extra state to manage).
        <details>
          <summary className="cursor-pointer text-lg font-semibold">
            {t('showDetail.historyTable.title')}
          </summary>
          {historyWatchesData === undefined ? (
            <Spinner label={t('common.loading')} />
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              <div className="max-w-2xl overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-[var(--color-fg-muted)]">
                      <th className="w-8 py-1.5" />
                      <th className="py-1.5 pr-4 font-medium">
                        {t('showDetail.historyTable.dateColumn')}
                      </th>
                      <th className="py-1.5 pr-4 font-medium">
                        {t('showDetail.historyTable.timeColumn')}
                      </th>
                      <th className="py-1.5 font-medium">
                        {t('showDetail.historyTable.typeColumn')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyWatchesData.watches.map((watch) => {
                      const isUnknown = watch.watchedAt === UNKNOWN_WATCHED_AT
                      const watchedAt = new Date(watch.watchedAt)
                      return (
                        <tr key={watch.id} className="border-t border-[var(--color-border)]">
                          <td className="py-2">
                            <input
                              type="checkbox"
                              checked={selectedWatchIds.has(watch.id)}
                              onChange={() => toggleWatchSelected(watch.id)}
                              aria-label={t('showDetail.unwatchDialog.remove')}
                            />
                          </td>
                          <td className="py-2 pr-4">
                            {isUnknown
                              ? t('history.unknownDate')
                              : formatHistoryDate(watchedAt, locale, t)}
                          </td>
                          <td className="py-2 pr-4">
                            {isUnknown
                              ? ''
                              : watchedAt.toLocaleTimeString(locale, {
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })}
                          </td>
                          <td className="py-2">{t(`history.sourceLabel.${watch.source}`)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <Button
                type="button"
                variant="danger"
                className="w-fit"
                disabled={selectedWatchIds.size === 0}
                onClick={() => setDeleteSelectedConfirmOpen(true)}
              >
                {t('showDetail.historyTable.deleteSelectedWatches')}
              </Button>
            </div>
          )}
        </details>
      )}

      <Dialog
        open={deleteSelectedConfirmOpen}
        onClose={() => setDeleteSelectedConfirmOpen(false)}
        title={t('showDetail.unwatchDialog.titleSelected')}
      >
        <div className="mt-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setDeleteSelectedConfirmOpen(false)}
          >
            {t('showDetail.watchDialog.cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            isLoading={unwatch.isPending}
            onClick={() =>
              unwatch.mutate([...selectedWatchIds], {
                onSuccess: () => {
                  setDeleteSelectedConfirmOpen(false)
                  setSelectedWatchIds(new Set())
                },
              })
            }
          >
            {t('showDetail.unwatchDialog.removeSelected')}
          </Button>
        </div>
      </Dialog>

      <WatchDateDialog
        open={dialogOpen}
        episodeLabel={movie.title}
        episode={{ title: movie.title, runtimeMinutes: movie.runtimeMinutes, firstAired: null }}
        locale={locale}
        onConfirm={(watchedAt) => {
          markWatched.mutate(watchedAt)
          setDialogOpen(false)
        }}
        onCancel={() => setDialogOpen(false)}
      />

      <WatchDateDialog
        open={logAdditionalWatchOpen}
        episodeLabel={movie.title}
        episode={{ title: movie.title, runtimeMinutes: movie.runtimeMinutes, firstAired: null }}
        locale={locale}
        disableUnknown={movie.hasUnknownWatchDate}
        onConfirm={(watchedAt) => {
          markWatched.mutate(watchedAt)
          setLogAdditionalWatchOpen(false)
        }}
        onCancel={() => setLogAdditionalWatchOpen(false)}
      />

      <UnwatchConfirmDialog
        open={unwatchConfirmOpen}
        watchedCountHint={movie.watchedCount}
        watches={watchesData?.watches}
        locale={locale}
        onConfirm={(ids) => unwatch.mutate(ids)}
        onCancel={() => setUnwatchConfirmOpen(false)}
      />
    </div>
  )
}
