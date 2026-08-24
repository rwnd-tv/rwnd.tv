import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ShowDetail } from '@rwnd/shared'
import { api, ApiError } from '../lib/api-client.js'
import { invalidateWatchData } from '../lib/query-client.js'
import { markWatchedRequestBody } from '../lib/date.js'
import { TMDB_LOGO_URL } from '../lib/tmdb.js'
import { useAuth } from '../lib/auth-context.js'
import { EpisodeCard } from '../components/library/EpisodeCard.js'
import { MetadataAttribution } from '../components/library/MetadataAttribution.js'
import { PosterGrid } from '../components/library/PosterGrid.js'
import { ProgressBar } from '../components/library/ProgressBar.js'
import { SpoilerGuard } from '../components/library/SpoilerGuard.js'
import { WatchDateDialog } from '../components/library/WatchDateDialog.js'
import { Button } from '../components/ui/Button.js'
import { Dialog } from '../components/ui/Dialog.js'
import { Spinner } from '../components/ui/Spinner.js'

/** Same tick used on episode tiles (SeasonDetailPage.tsx's CheckIcon) —
 * duplicated rather than shared/exported, matching this codebase's existing
 * precedent of one small icon component per file. */
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

/** "2012" when the first and last watch land in the same year, otherwise
 * "2012 - 2014" — matches what was asked for over always showing a range,
 * which would read oddly for a show binged entirely within one year. */
function watchedPeriodRange(firstWatchedAt: string, lastWatchedAt: string): string {
  const firstYear = new Date(firstWatchedAt).getFullYear()
  const lastYear = new Date(lastWatchedAt).getFullYear()
  return firstYear === lastYear ? String(firstYear) : `${firstYear} - ${lastYear}`
}

export function ShowDetailPage() {
  const { t } = useTranslation()
  const { slug } = useParams<{ slug: string }>()
  const { user } = useAuth()
  const locale = user?.locale ?? 'en-GB'
  const queryClient = useQueryClient()
  const [watchDialogOpen, setWatchDialogOpen] = useState(false)
  const [logAdditionalWatchOpen, setLogAdditionalWatchOpen] = useState(false)
  const [removeWatchesConfirmOpen, setRemoveWatchesConfirmOpen] = useState(false)
  const [overviewRevealed, setOverviewRevealed] = useState(false)

  const {
    data: show,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['show', slug],
    queryFn: () => api.library.show(slug!),
    enabled: Boolean(slug),
  })

  // A show with exactly one season skips the season-picker grid below and
  // shows that season's own episodes right here instead — picking a season
  // to then see one card in it isn't worth the extra click. Same queryKey
  // SeasonDetailPage.tsx uses for this season, so navigating there and back
  // shares one cache entry rather than fetching twice. Declared before the
  // `!show` early return below (hooks can't be conditional) — `enabled`
  // just stays false until `show` itself has loaded.
  const singleSeasonNumber =
    show && show.seasons.length === 1 ? show.seasons[0]!.seasonNumber : undefined
  const {
    data: singleSeason,
    isLoading: singleSeasonLoading,
    error: singleSeasonError,
  } = useQuery({
    queryKey: ['show', slug, 'season', singleSeasonNumber],
    queryFn: () => api.library.season(slug!, singleSeasonNumber!),
    enabled: Boolean(slug) && singleSeasonNumber !== undefined,
  })

  // Toggles between the two endpoints based on current cache state rather
  // than needing a separate "drop"/"undrop" mutation pair — mutate() takes
  // no arguments either way, and the button's own label already reflects
  // which action is next.
  const toggleDropped = useMutation({
    mutationFn: () => (show?.dropped ? api.library.undropShow(slug!) : api.library.dropShow(slug!)),
    onSuccess: (status) => {
      // Patches the two changed fields into the already-cached ShowDetail
      // rather than refetching — the endpoint already returns them, so a
      // second round trip would be redundant (see droppedStatusSchema's
      // doc comment in packages/shared/src/schemas/library.ts).
      queryClient.setQueryData(['show', slug], (prev: ShowDetail | undefined) =>
        prev ? { ...prev, ...status } : prev,
      )
      // The gallery's own cached list needs the same update, but isn't
      // held here — invalidate rather than patch, same reasoning as
      // invalidateWatchData in lib/query-client.ts.
      void queryClient.invalidateQueries({ queryKey: ['library'] })
    },
  })

  // Manual "refresh metadata" button — for when TMDB itself has something
  // wrong (a bad poster, a stale status/episode count) rather than waiting
  // on the background sweep's own schedule (apps/api/src/metadata/refresh.ts).
  // No response body to patch in, unlike toggleDropped above — a refresh can
  // touch almost any cached field (title, poster, genres, season counts...),
  // so a real refetch is simpler and more correct than guessing what changed.
  const refreshMetadata = useMutation({
    mutationFn: () => api.library.refreshShow(slug!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['show', slug] })
      void queryClient.invalidateQueries({ queryKey: ['library'] })
    },
  })

  // Logs a new watch for every non-special episode of the show at once —
  // the show-level equivalent of EpisodeCard's markWatched in
  // SeasonDetailPage.tsx. Unlike toggleDropped above, there's no single
  // changed field to patch into the cache: watched counts, per-season
  // progress, and history all need a real refetch. Shared by both the
  // "Watched" button (fills in only what's missing) and the "log an
  // additional watch" button below (`additional: true` — every episode
  // gets a new play regardless of current watched state, see
  // logMissingWatches's doc comment in apps/api/src/routes/library.ts).
  const markWatched = useMutation({
    mutationFn: ({ watchedAtIso, additional }: { watchedAtIso: string; additional?: true }) =>
      api.library.markShowWatched(slug!, {
        ...markWatchedRequestBody(watchedAtIso),
        ...(additional ? { additional } : {}),
      }),
    onSuccess: () => {
      setWatchDialogOpen(false)
      setLogAdditionalWatchOpen(false)
      void invalidateWatchData(queryClient)
      // Prefix match — invalidates this show's own detail query and any
      // cached season pages under it (['show', slug, 'season', N]) in one
      // call, since every one of them just went stale.
      void queryClient.invalidateQueries({ queryKey: ['show', slug] })
    },
  })

  // The other half of the "Watched" button: once it's showing every
  // non-special episode watched (purple, see `fullyWatched` below),
  // clicking it opens this confirmation instead of the watch-date dialog.
  const removeWatches = useMutation({
    mutationFn: () => api.library.removeShowWatches(slug!),
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
          ? t('showDetail.notFound')
          : t('common.somethingWentWrong')}
      </p>
    )
  }
  if (!show) return null

  // Purple/primary once every *aired* non-special episode has been watched
  // — both counts already exclude specials (see showDetailSchema's doc
  // comment in packages/shared/src/schemas/library.ts). Compared against
  // `airedEpisodes`, not `totalEpisodes` (the eventual/planned total), so a
  // currently-airing show can't be "fully watched" while it still has
  // unaired episodes left. `airedEpisodes` is null until the metadata
  // refresher has computed it and 0 for a show with only specials; neither
  // should read as "fully watched".
  const fullyWatched =
    show.airedEpisodes !== null &&
    show.airedEpisodes > 0 &&
    show.watchedEpisodes === show.airedEpisodes

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="aspect-[2/3] w-48 flex-shrink-0 overflow-hidden rounded-lg bg-[var(--color-surface)]">
          {show.posterPath ? (
            <img
              src={show.posterPath}
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
              {show.title.charAt(0)}
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <h1 className="text-2xl font-semibold">{show.title}</h1>
          <div className="flex flex-wrap items-center gap-x-1.5 text-sm text-[var(--color-fg-muted)]">
            {(
              [
                show.year,
                show.genres.length > 0 ? show.genres.join(', ') : null,
                show.status,
                show.dropped ? t('showDetail.droppedFact') : null,
                show.voteAverage !== null ? (
                  <span className="inline-flex items-center gap-1.5">
                    {show.tmdbId ? (
                      <a
                        href={`https://www.themoviedb.org/tv/${show.tmdbId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={t('showDetail.viewOnTmdb.show')}
                      >
                        <img
                          src={TMDB_LOGO_URL}
                          alt={t('showDetail.viewOnTmdb.show')}
                          className="h-3"
                        />
                      </a>
                    ) : (
                      <img src={TMDB_LOGO_URL} alt={t('showDetail.ratingSource')} className="h-3" />
                    )}
                    {show.voteAverage.toFixed(1)}
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
          {show.overview && (
            <SpoilerGuard
              hidden={Boolean(user?.spoilerProtectionEnabled) && !fullyWatched}
              revealed={overviewRevealed}
              onReveal={() => setOverviewRevealed(true)}
              revealLabel={t('spoiler.reveal')}
              blurClassName="blur-sm"
              className="max-w-2xl"
              overlayClassName="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]/90 text-[var(--color-fg)] hover:bg-[var(--color-surface)]"
            >
              <p className="text-sm">{show.overview}</p>
            </SpoilerGuard>
          )}
          {show.metadataSource && (
            // Distinct from the rating badge above — that answers "where
            // did this 8.4 come from and where do I click through"; this
            // answers "where did the rest of this page's metadata come
            // from". Its own line rather than folded into the fact line, so
            // it doesn't compete with year/genres/status for attention.
            <MetadataAttribution
              source={show.metadataSource}
              refreshedAt={show.metadataRefreshedAt}
              locale={locale}
            />
          )}

          {show.totalEpisodes !== null ? (
            <div className="flex max-w-xs flex-col gap-1">
              <ProgressBar
                value={show.watchedEpisodes}
                max={show.totalEpisodes}
                label={t('shows.progressAria', {
                  title: show.title,
                  watched: show.watchedEpisodes,
                  total: show.totalEpisodes,
                })}
              />
              <p className="text-xs text-[var(--color-fg-muted)]">
                {t('shows.progress', { watched: show.watchedEpisodes, total: show.totalEpisodes })}
              </p>
            </div>
          ) : (
            <p className="text-xs text-[var(--color-fg-muted)]">
              {t('shows.progressUnknown', { count: show.watchedEpisodes })}
            </p>
          )}

          <div className="flex gap-2">
            <Button
              variant={fullyWatched ? 'primary' : 'secondary'}
              type="button"
              disabled={!fullyWatched && !show.tmdbId}
              title={
                !fullyWatched && !show.tmdbId
                  ? t('showDetail.watchedButtonDisabled')
                  : t(
                      fullyWatched
                        ? 'showDetail.watchedButtonTooltip.removeShow'
                        : 'showDetail.watchedButtonTooltip.addShow',
                    )
              }
              onClick={() =>
                fullyWatched ? setRemoveWatchesConfirmOpen(true) : setWatchDialogOpen(true)
              }
            >
              <CheckIcon />
              {t('showDetail.watchedButton')}
            </Button>
            {show.firstWatchedAt && (
              <Button
                variant="secondary"
                type="button"
                className="px-2.5 py-2.5"
                disabled={markWatched.isPending || !show.tmdbId}
                title={t('showDetail.addWatchTooltip.show')}
                aria-label={t('showDetail.addWatchTooltip.show')}
                onClick={() => setLogAdditionalWatchOpen(true)}
              >
                <PlusIcon />
              </Button>
            )}
            <Button
              variant="secondary"
              type="button"
              disabled={toggleDropped.isPending}
              title={t(show.dropped ? 'showDetail.undropTooltip' : 'showDetail.dropTooltip')}
              onClick={() => toggleDropped.mutate()}
            >
              {t(show.dropped ? 'showDetail.undrop' : 'showDetail.drop')}
            </Button>
            <Button
              variant="secondary"
              type="button"
              className="px-2.5 py-2.5"
              disabled={refreshMetadata.isPending || !show.metadataSource}
              title={
                show.metadataSource
                  ? t('showDetail.refreshMetadataTooltip')
                  : t('showDetail.refreshMetadataDisabled')
              }
              aria-label={t('showDetail.refreshMetadataTooltip')}
              onClick={() => refreshMetadata.mutate()}
            >
              <RefreshIcon />
            </Button>
          </div>

          {refreshMetadata.isSuccess && (
            <p className="text-xs text-[var(--color-fg-muted)]">
              {t('showDetail.refreshMetadataDone')}
            </p>
          )}
          {refreshMetadata.isError && (
            <p className="text-xs text-[var(--color-danger)]">{t('common.somethingWentWrong')}</p>
          )}

          {show.firstWatchedAt && show.lastWatchedAt ? (
            <p className="text-xs text-[var(--color-fg-muted)]">
              {t('showDetail.watchedPeriod', {
                range: watchedPeriodRange(show.firstWatchedAt, show.lastWatchedAt),
              })}
            </p>
          ) : (
            show.hasUnknownWatchDate && (
              <p className="text-xs text-[var(--color-fg-muted)]">
                {t('showDetail.watchedUnknown')}
              </p>
            )
          )}
        </div>
      </div>

      <WatchDateDialog
        open={watchDialogOpen}
        episodeLabel={show.title}
        episode={{ title: show.title, runtimeMinutes: null, firstAired: null }}
        locale={locale}
        allowNowWatching={false}
        allowReleaseDate
        onConfirm={(watchedAt) => markWatched.mutate({ watchedAtIso: watchedAt })}
        onCancel={() => setWatchDialogOpen(false)}
      />

      <WatchDateDialog
        open={logAdditionalWatchOpen}
        episodeLabel={show.title}
        episode={{ title: show.title, runtimeMinutes: null, firstAired: null }}
        locale={locale}
        allowNowWatching={false}
        allowReleaseDate
        onConfirm={(watchedAt) => markWatched.mutate({ watchedAtIso: watchedAt, additional: true })}
        onCancel={() => setLogAdditionalWatchOpen(false)}
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
            isLoading={removeWatches.isPending}
            onClick={() => removeWatches.mutate()}
          >
            {t('showDetail.removeAllWatchesConfirm')}
          </Button>
        </div>
      </Dialog>

      {show.seasons.length === 1 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">
            {show.seasons[0]!.name ??
              (show.seasons[0]!.seasonNumber === 0
                ? t('showDetail.specials')
                : t('import.progress.season', { number: show.seasons[0]!.seasonNumber }))}
          </h2>
          {singleSeasonLoading ? (
            <Spinner label={t('common.loading')} />
          ) : singleSeasonError || !singleSeason ? (
            <p className="text-[var(--color-fg-muted)]">{t('common.somethingWentWrong')}</p>
          ) : (
            <PosterGrid minTileWidth="16rem">
              {singleSeason.episodes.map((episode) => (
                <EpisodeCard
                  key={episode.episodeNumber}
                  episode={episode}
                  slug={slug!}
                  seasonNumber={singleSeason.seasonNumber}
                  tmdbId={show.tmdbId}
                />
              ))}
            </PosterGrid>
          )}
        </div>
      )}

      {show.seasons.length > 1 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t('showDetail.seasonsTitle')}</h2>
          <PosterGrid>
            {show.seasons.map((season) => {
              const seasonName =
                season.name ??
                (season.seasonNumber === 0
                  ? t('showDetail.specials')
                  : t('import.progress.season', { number: season.seasonNumber }))
              const posterPath = season.posterPath ?? show.posterPath
              // Specials don't get a premiere year — a "Specials" season is
              // a grab-bag TMDB backdates to the show's own start, which
              // would misleadingly imply a real season aired then.
              const seasonYear =
                season.seasonNumber > 0 && season.airDate
                  ? new Date(season.airDate).getUTCFullYear()
                  : null
              return (
                <li key={season.seasonNumber} className="flex flex-col gap-2">
                  <Link
                    to={`/shows/${show.slug}/season/${season.seasonNumber}`}
                    className="flex flex-col gap-2 rounded-lg"
                  >
                    <div className="aspect-[2/3] w-full overflow-hidden rounded-lg bg-[var(--color-surface)]">
                      {posterPath ? (
                        <img
                          src={posterPath}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          width={342}
                          height={513}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div
                          aria-hidden="true"
                          className="flex h-full items-center justify-center text-2xl font-semibold text-[var(--color-fg-muted)]"
                        >
                          {seasonName.charAt(0)}
                        </div>
                      )}
                    </div>
                    <div>
                      <h3 className="truncate text-sm font-medium" title={seasonName}>
                        {seasonName}
                      </h3>
                      <p className="text-xs text-[var(--color-fg-muted)]">
                        {[
                          t('shows.progress', {
                            watched: season.watchedEpisodes,
                            total: season.episodeCount,
                          }),
                          seasonYear,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                  </Link>
                  <ProgressBar
                    value={season.watchedEpisodes}
                    max={season.episodeCount}
                    label={t('showDetail.seasonProgressAria', {
                      season: seasonName,
                      watched: season.watchedEpisodes,
                      total: season.episodeCount,
                    })}
                  />
                </li>
              )
            })}
          </PosterGrid>
        </div>
      )}
    </div>
  )
}
