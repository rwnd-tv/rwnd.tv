import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api-client.js'
import { invalidateWatchData } from '../lib/query-client.js'
import { markWatchedRequestBody } from '../lib/date.js'
import { TVDB_LOGO_DARK_BG_URL, TVDB_LOGO_LIGHT_BG_URL, tvdbSeasonUrl } from '../lib/tvdb.js'
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

/** Icon for the icon-only "log an additional watch" button below —
 * duplicated rather than shared, matching this file's existing per-file
 * icon precedent (see CheckIcon above). */
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

/** Icon for the "reveal all episodes" button below — duplicated from
 * EpisodeCard.tsx's own EyeIcon rather than shared, same per-file icon
 * precedent as PlusIcon above. */
function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
      <circle cx="12" cy="12" r="3" />
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
 * icon precedent (see CheckIcon above). Self-hosted — see TMDB_LOGO_URL's
 * own doc comment in lib/tmdb.ts for why. */
const TMDB_LOGO_URL = '/attribution/tmdb-logo.svg'

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
  const [logAdditionalWatchOpen, setLogAdditionalWatchOpen] = useState(false)
  const [removeWatchesConfirmOpen, setRemoveWatchesConfirmOpen] = useState(false)
  const [overviewRevealed, setOverviewRevealed] = useState(false)
  // Separate from overviewRevealed above — this season might have no
  // overview at all to reveal (common with TVDB, especially for
  // sports/reality content), but its episode tiles below still each have
  // their own spoiler-hidden still/title (EpisodeCard.tsx) that's tedious
  // to reveal one at a time, hovering + clicking each tile individually,
  // on a season with dozens of episodes. This reveals every tile at once;
  // EpisodeCard's own per-tile reveal button still works independently of
  // it (e.g. to reveal just one before this is clicked).
  const [episodesRevealed, setEpisodesRevealed] = useState(false)

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
  // Shared with the "log an additional watch" button below the same way
  // ShowDetailPage.tsx's markWatched is — see that mutation's doc comment.
  const markSeasonWatched = useMutation({
    mutationFn: ({ watchedAtIso, additional }: { watchedAtIso: string; additional?: true }) =>
      api.library.markSeasonWatched(slug!, seasonNumber, {
        ...markWatchedRequestBody(watchedAtIso),
        ...(additional ? { additional } : {}),
      }),
    onSuccess: () => {
      setWatchDialogOpen(false)
      setLogAdditionalWatchOpen(false)
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
  // Whether the "reveal all episodes" button below has anything to do —
  // same condition each EpisodeCard uses itself (spoilerHidden), just
  // checked across the whole season rather than per-tile.
  const hasHiddenEpisodes =
    Boolean(user?.spoilerProtectionEnabled) &&
    !episodesRevealed &&
    season.episodes.some((episode) => !episode.watched)
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
                        title={t('showDetail.viewOnTmdb.season')}
                      >
                        <img
                          src={TMDB_LOGO_URL}
                          alt={t('showDetail.viewOnTmdb.season')}
                          className="h-3"
                        />
                      </a>
                    ) : (
                      <img src={TMDB_LOGO_URL} alt={t('showDetail.ratingSource')} className="h-3" />
                    )}
                    {season.voteAverage.toFixed(1)}
                  </span>
                ) : null,
                // See ShowDetailPage.tsx's own tvdbId fact for why this is
                // just the logo/link rather than a rating badge. Uses this
                // season's own tvdbSeasonId (a live, best-effort lookup —
                // see the season route's doc comment), not the show's
                // tvdbId, so it opens this exact season on TVDB.
                season.tvdbSeasonId ? (
                  <a
                    href={tvdbSeasonUrl(season.tvdbSeasonId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={t('showDetail.viewOnTvdb.season')}
                  >
                    <img
                      src={TVDB_LOGO_LIGHT_BG_URL}
                      alt={t('showDetail.viewOnTvdb.season')}
                      className="tvdb-logo-light h-[0.9rem]"
                    />
                    <img
                      src={TVDB_LOGO_DARK_BG_URL}
                      alt={t('showDetail.viewOnTvdb.season')}
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
          {season.overview && (
            <SpoilerGuard
              hidden={Boolean(user?.spoilerProtectionEnabled) && !fullyWatched}
              revealed={overviewRevealed}
              onReveal={() => setOverviewRevealed(true)}
              revealLabel={t('spoiler.reveal')}
              blurClassName="blur-sm"
              className="max-w-2xl"
              overlayClassName="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]/90 text-[var(--color-fg)] hover:bg-[var(--color-surface)]"
            >
              <p className="text-sm">{season.overview}</p>
            </SpoilerGuard>
          )}
          {show?.metadataSource && (
            // Inherited from the show — a season has no metadata source of
            // its own.
            <MetadataAttribution
              source={show.metadataSource}
              refreshedAt={show.metadataRefreshedAt}
              locale={locale}
            />
          )}

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

          <div className="flex gap-2">
            <Button
              variant={fullyWatched ? 'primary' : 'secondary'}
              type="button"
              disabled={!fullyWatched && !show?.tmdbId}
              title={
                !fullyWatched && !show?.tmdbId
                  ? t('showDetail.watchedButtonDisabled')
                  : t(
                      fullyWatched
                        ? 'showDetail.watchedButtonTooltip.removeSeason'
                        : 'showDetail.watchedButtonTooltip.addSeason',
                    )
              }
              onClick={() =>
                fullyWatched ? setRemoveWatchesConfirmOpen(true) : setWatchDialogOpen(true)
              }
            >
              <CheckIcon />
              {t('showDetail.watchedButton')}
            </Button>
            {watchedEpisodes > 0 && (
              <Button
                variant="secondary"
                type="button"
                className="px-2.5 py-2.5"
                disabled={markSeasonWatched.isPending || !show?.tmdbId}
                title={t('showDetail.addWatchTooltip.season')}
                aria-label={t('showDetail.addWatchTooltip.season')}
                onClick={() => setLogAdditionalWatchOpen(true)}
              >
                <PlusIcon />
              </Button>
            )}
            {hasHiddenEpisodes && (
              <Button
                variant="secondary"
                type="button"
                title={t('spoiler.revealEpisodes')}
                onClick={() => setEpisodesRevealed(true)}
              >
                <EyeIcon />
                {t('spoiler.revealEpisodes')}
              </Button>
            )}
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
        onConfirm={(watchedAt) => markSeasonWatched.mutate({ watchedAtIso: watchedAt })}
        onCancel={() => setWatchDialogOpen(false)}
      />

      <WatchDateDialog
        open={logAdditionalWatchOpen}
        episodeLabel={seasonName}
        episode={{ title: seasonName, runtimeMinutes: null, firstAired: null }}
        locale={locale}
        allowNowWatching={false}
        allowReleaseDate
        onConfirm={(watchedAt) =>
          markSeasonWatched.mutate({ watchedAtIso: watchedAt, additional: true })
        }
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
            revealed={episodesRevealed}
          />
        ))}
      </PosterGrid>
    </div>
  )
}
