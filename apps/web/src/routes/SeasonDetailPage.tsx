import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { EpisodeWatchedStatus, SeasonDetail, SeasonEpisode } from '@rwnd/shared'
import { api, ApiError } from '../lib/api-client.js'
import { invalidateWatchData } from '../lib/query-client.js'
import { markWatchedRequestBody } from '../lib/date.js'
import { useAuth } from '../lib/auth-context.js'
import { PosterGrid } from '../components/library/PosterGrid.js'
import { ProgressBar } from '../components/library/ProgressBar.js'
import { WatchDateDialog } from '../components/library/WatchDateDialog.js'
import { UnwatchConfirmDialog } from '../components/library/UnwatchConfirmDialog.js'
import { Button } from '../components/ui/Button.js'
import { Dialog } from '../components/ui/Dialog.js'
import { Spinner } from '../components/ui/Spinner.js'

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

/** Same TMDB attribution logo used on ShowDetailPage.tsx's rating badge —
 * duplicated rather than shared, matching this file's existing per-file
 * icon precedent (see CheckIcon above). */
const TMDB_LOGO_URL =
  'https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg'

/**
 * One episode tile in the season grid (apps/web/src/routes/SeasonDetailPage.tsx),
 * styled after Plex's own season view — a still image with a checkmark
 * toggle overlaid top-right. Its own component (not inlined in the parent's
 * .map) so it owns its own `useMutation`, the same "one card, one mutation"
 * shape SearchResultCard.tsx already uses — each tile gets independent
 * pending state instead of one mutation shared/racing across the grid.
 */
function EpisodeCard({
  episode,
  slug,
  seasonNumber,
  tmdbId,
}: {
  episode: SeasonEpisode
  slug: string
  seasonNumber: number
  tmdbId: string | null
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const locale = user?.locale ?? 'en-GB'
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [unwatchConfirmOpen, setUnwatchConfirmOpen] = useState(false)

  // Fetched only while the confirmation dialog is actually open — most
  // episodes have at most one play, so there's no reason to fetch every
  // episode's full watch list up front just to back a dialog most clicks
  // never open.
  const { data: watchesData } = useQuery({
    queryKey: ['show', slug, 'season', seasonNumber, 'episode', episode.episodeNumber, 'watches'],
    queryFn: () => api.library.episodeWatches(slug, seasonNumber, episode.episodeNumber),
    enabled: unwatchConfirmOpen,
  })

  function patchEpisode(status: EpisodeWatchedStatus) {
    // Same cache-patch technique ShowDetailPage's drop/undrop toggle uses —
    // both mutation paths already return the episode's new status, so a
    // full season refetch would be redundant.
    queryClient.setQueryData(
      ['show', slug, 'season', seasonNumber],
      (prev: SeasonDetail | undefined) =>
        prev
          ? {
              ...prev,
              episodes: prev.episodes.map((e) =>
                e.episodeNumber === episode.episodeNumber ? { ...e, ...status } : e,
              ),
            }
          : prev,
    )
  }

  function onMutationSuccess(status: EpisodeWatchedStatus) {
    patchEpisode(status)
    void invalidateWatchData(queryClient)
    // Not covered by invalidateWatchData — the parent show's own progress
    // bar and Seasons grid (ShowDetailPage.tsx) would otherwise go stale
    // after a toggle here.
    void queryClient.invalidateQueries({ queryKey: ['show', slug] })
  }

  // Unwatching doesn't need a date dialog the way marking watched does
  // (see markWatched below) — but it can clear more than one logged play
  // at once, so it's gated behind UnwatchConfirmDialog (which the user can
  // use to tick just some of them) rather than firing immediately on click.
  const unwatch = useMutation({
    mutationFn: (ids: string[]): Promise<EpisodeWatchedStatus> =>
      api.library.unwatchEpisode(slug, seasonNumber, episode.episodeNumber, ids),
    onSuccess: (status) => {
      onMutationSuccess(status)
      setUnwatchConfirmOpen(false)
    },
  })

  const markWatched = useMutation({
    mutationFn: async (watchedAt: string): Promise<EpisodeWatchedStatus> => {
      // POST /plays already resolves/creates the local episode row and
      // returns the logged play — no dedicated "mark watched" endpoint
      // needed (see the plan's backend section).
      const play = await api.plays.create({
        episode: {
          source: 'tmdb',
          showExternalId: tmdbId!,
          seasonNumber,
          episodeNumber: episode.episodeNumber,
        },
        watchedAt,
      })
      return {
        watched: true,
        watchedCount: episode.watchedCount + 1,
        lastWatchedAt: play.watchedAt,
      }
    },
    onSuccess: onMutationSuccess,
  })

  const episodeLabel = t('import.progress.episode', { number: episode.episodeNumber })
  const toggleLabel = t(episode.watched ? 'showDetail.markUnwatched' : 'showDetail.markWatched')
  // Can only mark watched when the show has a TMDB id on record (POST
  // /plays needs it) — unwatching never needs it, so only guarded here.
  const toggleDisabled = unwatch.isPending || markWatched.isPending || (!episode.watched && !tmdbId)

  return (
    <li className="flex flex-col gap-2">
      <div
        className="relative aspect-video w-full overflow-hidden rounded-lg bg-[var(--color-surface)]"
        title={episode.overview ?? undefined}
      >
        {episode.stillPath ? (
          <img
            src={episode.stillPath}
            alt=""
            loading="lazy"
            decoding="async"
            width={300}
            height={169}
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-full items-center justify-center text-xl font-semibold text-[var(--color-fg-muted)]"
          >
            {episode.episodeNumber}
          </div>
        )}
        <button
          type="button"
          aria-pressed={episode.watched}
          aria-label={toggleLabel}
          title={toggleLabel}
          disabled={toggleDisabled}
          onClick={() => (episode.watched ? setUnwatchConfirmOpen(true) : setDialogOpen(true))}
          className={`absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            episode.watched
              ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-fg)]'
              : 'border-white/70 bg-black/40 text-white/90 hover:bg-black/60'
          }`}
        >
          {episode.watchedCount > 1 ? (
            <span className="text-xs font-semibold" aria-hidden="true">
              {episode.watchedCount}
            </span>
          ) : (
            <CheckIcon />
          )}
        </button>
      </div>
      <div>
        <h3 className="truncate text-sm font-medium" title={episode.title ?? episodeLabel}>
          {episode.title ?? episodeLabel}
        </h3>
        <p className="text-xs text-[var(--color-fg-muted)]">{episodeLabel}</p>
        {episode.watchedCount > 1 && (
          <p className="text-xs text-[var(--color-fg-muted)]">
            {t('showDetail.episodeWatchedCount', { count: episode.watchedCount })}
          </p>
        )}
      </div>

      <WatchDateDialog
        open={dialogOpen}
        episodeLabel={episodeLabel}
        episode={{
          title: episode.title,
          runtimeMinutes: episode.runtimeMinutes,
          firstAired: episode.firstAired,
        }}
        locale={locale}
        onConfirm={(watchedAt) => {
          markWatched.mutate(watchedAt)
          setDialogOpen(false)
        }}
        onCancel={() => setDialogOpen(false)}
      />

      <UnwatchConfirmDialog
        open={unwatchConfirmOpen}
        watchedCountHint={episode.watchedCount}
        watches={watchesData?.watches}
        locale={locale}
        onConfirm={(ids) => unwatch.mutate(ids)}
        onCancel={() => setUnwatchConfirmOpen(false)}
      />
    </li>
  )
}

export function SeasonDetailPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const locale = user?.locale ?? 'en-GB'
  const queryClient = useQueryClient()
  const { slug, seasonNumber: seasonNumberParam } = useParams<{
    slug: string
    seasonNumber: string
  }>()
  const seasonNumber = Number(seasonNumberParam)
  const seasonNumberValid = Number.isInteger(seasonNumber)
  const [watchDialogOpen, setWatchDialogOpen] = useState(false)
  const [removeWatchesConfirmOpen, setRemoveWatchesConfirmOpen] = useState(false)

  // Same queryKey ShowDetailPage.tsx/PageTitleEffect.tsx use — shared React
  // Query cache, so this is free if the user navigated here from the show
  // page. Only used for the back-link/poster fallback/tmdbId here; the
  // season's own data comes from the query below.
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
    enabled: Boolean(slug) && seasonNumberValid,
  })

  // The season-scoped equivalent of ShowDetailPage.tsx's "Watched" button
  // pair — logs a new watch for every episode of this season at once (or,
  // once it's showing every episode watched, removes them all). Neither
  // patches a single cached field the way EpisodeCard's per-episode
  // mutations above do: a whole season/show refetch is needed either way.
  const markSeasonWatched = useMutation({
    mutationFn: (watchedAtIso: string) =>
      api.library.markSeasonWatched(slug!, seasonNumber, markWatchedRequestBody(watchedAtIso)),
    onSuccess: () => {
      setWatchDialogOpen(false)
      void invalidateWatchData(queryClient)
      void queryClient.invalidateQueries({ queryKey: ['show', slug] })
    },
  })

  const removeSeasonWatches = useMutation({
    mutationFn: () => api.library.removeSeasonWatches(slug!, seasonNumber),
    onSuccess: () => {
      setRemoveWatchesConfirmOpen(false)
      void invalidateWatchData(queryClient)
      void queryClient.invalidateQueries({ queryKey: ['show', slug] })
    },
  })

  if (isLoading) return <Spinner label={t('common.loading')} />

  if (error) {
    return (
      <p className="text-[var(--color-fg-muted)]">
        {error instanceof ApiError && error.status === 404
          ? t('showDetail.seasonNotFound')
          : t('common.somethingWentWrong')}
      </p>
    )
  }
  if (!season) return null

  // Same fallback chain as the season cards on ShowDetailPage.tsx.
  const seasonName =
    season.name ??
    (season.seasonNumber === 0
      ? t('showDetail.specials')
      : t('import.progress.season', { number: season.seasonNumber }))
  const posterPath = season.posterPath ?? show?.posterPath ?? null
  const seasonYear = season.airDate ? new Date(season.airDate).getFullYear() : null
  const watchedEpisodes = season.episodes.filter((episode) => episode.watched).length
  // Purple/primary once every *aired* episode of this season has been
  // watched — same "Watched" button behaviour as ShowDetailPage.tsx, just
  // scoped to one season (specials included, unlike the show-level
  // button). Compared against aired episodes only, not season.episodes
  // .length, so a currently-airing season can't be "fully watched" while
  // it still has unaired episodes left. The progress bar below is
  // deliberately untouched — it still shows progress against the whole
  // season, aired or not.
  const airedEpisodes = season.episodes.filter(
    (episode) => episode.firstAired !== null && new Date(episode.firstAired) <= new Date(),
  )
  const watchedAiredEpisodes = airedEpisodes.filter((episode) => episode.watched).length
  const fullyWatched = airedEpisodes.length > 0 && watchedAiredEpisodes === airedEpisodes.length

  // show.seasons is already ordered by seasonNumber ascending (see
  // apps/api/src/routes/library.ts) — adjacent array entries are exactly
  // the previous/next season, specials (0) included like ShowDetailPage's
  // own season list.
  const seasonIndex = show?.seasons.findIndex((s) => s.seasonNumber === season.seasonNumber) ?? -1
  const previousSeason = seasonIndex > 0 ? show!.seasons[seasonIndex - 1] : undefined
  const nextSeason =
    seasonIndex !== -1 && seasonIndex < show!.seasons.length - 1
      ? show!.seasons[seasonIndex + 1]
      : undefined

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        {show ? (
          <Link
            to={`/shows/${show.slug}`}
            className="w-fit text-sm text-[var(--color-fg-muted)] hover:underline"
          >
            ← {show.title}
          </Link>
        ) : (
          <span />
        )}
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="secondary"
            className="px-2.5 py-2.5"
            disabled={!previousSeason}
            aria-label={t('showDetail.previousSeason')}
            title={t('showDetail.previousSeason')}
            onClick={() => navigate(`/shows/${show!.slug}/season/${previousSeason!.seasonNumber}`)}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="px-2.5 py-2.5"
            disabled={!nextSeason}
            aria-label={t('showDetail.nextSeason')}
            title={t('showDetail.nextSeason')}
            onClick={() => navigate(`/shows/${show!.slug}/season/${nextSeason!.seasonNumber}`)}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="aspect-[2/3] w-48 flex-shrink-0 overflow-hidden rounded-lg bg-[var(--color-surface)]">
          {posterPath ? (
            <img
              src={posterPath}
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
              {seasonName.charAt(0)}
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <h1 className="text-2xl font-semibold">{seasonName}</h1>
          <div className="flex flex-wrap items-center gap-x-1.5 text-sm text-[var(--color-fg-muted)]">
            {(
              [
                seasonYear,
                season.voteAverage !== null ? (
                  <span className="inline-flex items-center gap-1.5">
                    {show?.tmdbId ? (
                      <a
                        href={`https://www.themoviedb.org/tv/${show.tmdbId}/season/${season.seasonNumber}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={t('showDetail.viewOnTmdb')}
                      >
                        <img src={TMDB_LOGO_URL} alt={t('showDetail.viewOnTmdb')} className="h-3" />
                      </a>
                    ) : (
                      <img src={TMDB_LOGO_URL} alt={t('showDetail.ratingSource')} className="h-3" />
                    )}
                    {season.voteAverage.toFixed(1)}
                  </span>
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
          {season.overview && <p className="max-w-2xl text-sm">{season.overview}</p>}

          <div className="flex max-w-xs flex-col gap-1">
            <ProgressBar
              value={watchedEpisodes}
              max={season.episodes.length}
              label={t('shows.progressAria', {
                title: seasonName,
                watched: watchedEpisodes,
                total: season.episodes.length,
              })}
            />
            <p className="text-xs text-[var(--color-fg-muted)]">
              {t('shows.progress', { watched: watchedEpisodes, total: season.episodes.length })}
            </p>
          </div>

          <div>
            <Button
              variant={fullyWatched ? 'primary' : 'secondary'}
              type="button"
              disabled={!fullyWatched && !show?.tmdbId}
              title={
                !fullyWatched && !show?.tmdbId ? t('showDetail.watchedButtonDisabled') : undefined
              }
              onClick={() =>
                fullyWatched ? setRemoveWatchesConfirmOpen(true) : setWatchDialogOpen(true)
              }
            >
              <CheckIcon />
              {t('showDetail.watchedButton')}
            </Button>
          </div>
        </div>
      </div>

      <WatchDateDialog
        open={watchDialogOpen}
        episodeLabel={seasonName}
        episode={{ title: seasonName, runtimeMinutes: null, firstAired: null }}
        locale={locale}
        allowNowWatching={false}
        allowReleaseDate
        onConfirm={(watchedAt) => markSeasonWatched.mutate(watchedAt)}
        onCancel={() => setWatchDialogOpen(false)}
      />

      <Dialog
        open={removeWatchesConfirmOpen}
        onClose={() => setRemoveWatchesConfirmOpen(false)}
        title={t('showDetail.removeAllWatchesTitle')}
      >
        <div className="mt-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setRemoveWatchesConfirmOpen(false)}
          >
            {t('showDetail.watchDialog.cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            isLoading={removeSeasonWatches.isPending}
            onClick={() => removeSeasonWatches.mutate()}
          >
            {t('showDetail.removeAllWatchesConfirm')}
          </Button>
        </div>
      </Dialog>

      <PosterGrid minTileWidth="16rem">
        {season.episodes.map((episode) => (
          <EpisodeCard
            key={episode.episodeNumber}
            episode={episode}
            slug={slug!}
            seasonNumber={season.seasonNumber}
            tmdbId={show?.tmdbId ?? null}
          />
        ))}
      </PosterGrid>
    </div>
  )
}
