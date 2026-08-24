import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api-client.js'
import { useAuth } from '../lib/auth-context.js'
import { useEpisodeWatchActions } from '../lib/use-episode-watch-actions.js'
import { TVDB_LOGO_DARK_BG_URL, TVDB_LOGO_LIGHT_BG_URL, tvdbEpisodeUrl } from '../lib/tvdb.js'
import { MetadataAttribution } from '../components/library/MetadataAttribution.js'
import { SpoilerGuard } from '../components/library/SpoilerGuard.js'
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

/** Same TMDB attribution logo used on ShowDetailPage.tsx/SeasonDetailPage.tsx's
 * rating badge — duplicated rather than shared, matching those files'
 * existing per-file icon precedent (see CheckIcon below). */
const TMDB_LOGO_URL =
  'https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg'

/**
 * One episode's own page — reachable by clicking its thumbnail/title on the
 * season grid (SeasonDetailPage.tsx's EpisodeCard). Sources its data from
 * the same season query that grid already uses — every field this page
 * needs (overview, still image, runtime, watched state, TMDB rating) is
 * already on SeasonEpisode — rather than a dedicated endpoint.
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
  const [spoilersRevealed, setSpoilersRevealed] = useState(false)

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
  // Same generic-label swap as SeasonDetailPage.tsx's EpisodeCard, and same
  // condition as the still/overview below — revealing either of those also
  // reveals the title, since `spoilersRevealed` is shared across all three.
  const spoilerHidden = Boolean(user?.spoilerProtectionEnabled) && !episode.watched
  const titleHidden = spoilerHidden && !spoilersRevealed
  const displayTitle = titleHidden ? episodeLabel : (episode.title ?? episodeLabel)
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
        <div className="flex w-fit items-center gap-1.5 text-sm text-[var(--color-fg-muted)]">
          <span aria-hidden="true">←</span>
          {show && (
            <>
              <Link to={`/shows/${slug}`} className="hover:underline">
                {show.title}
              </Link>
              <span aria-hidden="true">·</span>
            </>
          )}
          <Link to={`/shows/${slug}/season/${seasonNumber}`} className="hover:underline">
            {seasonName}
          </Link>
        </div>
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
          <SpoilerGuard
            hidden={spoilerHidden}
            revealed={spoilersRevealed}
            onReveal={() => setSpoilersRevealed(true)}
            revealLabel={t('spoiler.reveal')}
            className="h-full w-full"
            overlayClassName="rounded-lg bg-black/50 text-white/90 hover:bg-black/60"
          >
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
          </SpoilerGuard>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <h1 className="text-2xl font-semibold">{displayTitle}</h1>
          <p className="text-sm text-[var(--color-fg-muted)]">{episodeLabel}</p>
          <div className="flex flex-wrap items-center gap-x-1.5 text-sm text-[var(--color-fg-muted)]">
            {(
              [
                episode.firstAired
                  ? new Date(episode.firstAired).toLocaleDateString(locale, { dateStyle: 'medium' })
                  : null,
                episode.runtimeMinutes !== null
                  ? t('showDetail.episodeDetail.runtime', { minutes: episode.runtimeMinutes })
                  : null,
                episode.voteAverage !== null ? (
                  <span className="inline-flex items-center gap-1.5">
                    {show?.tmdbId ? (
                      <a
                        href={`https://www.themoviedb.org/tv/${show.tmdbId}/season/${seasonNumber}/episode/${episodeNumber}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={t('showDetail.viewOnTmdb.episode')}
                      >
                        <img
                          src={TMDB_LOGO_URL}
                          alt={t('showDetail.viewOnTmdb.episode')}
                          className="h-3"
                        />
                      </a>
                    ) : (
                      <img src={TMDB_LOGO_URL} alt={t('showDetail.ratingSource')} className="h-3" />
                    )}
                    {episode.voteAverage.toFixed(1)}
                  </span>
                ) : null,
                // See ShowDetailPage.tsx's own tvdbId fact for why this is
                // just the logo/link rather than a rating badge. Uses this
                // episode's own tvdbEpisodeId (a live, best-effort lookup —
                // see the season route's doc comment), not the show's
                // tvdbId, so it opens this exact episode on TVDB.
                episode.tvdbEpisodeId ? (
                  <a
                    href={tvdbEpisodeUrl(episode.tvdbEpisodeId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={t('showDetail.viewOnTvdb.episode')}
                  >
                    <img
                      src={TVDB_LOGO_LIGHT_BG_URL}
                      alt={t('showDetail.viewOnTvdb.episode')}
                      className="tvdb-logo-light h-[0.9rem]"
                    />
                    <img
                      src={TVDB_LOGO_DARK_BG_URL}
                      alt={t('showDetail.viewOnTvdb.episode')}
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
          {episode.overview && (
            <SpoilerGuard
              hidden={spoilerHidden}
              revealed={spoilersRevealed}
              onReveal={() => setSpoilersRevealed(true)}
              revealLabel={t('spoiler.reveal')}
              blurClassName="blur-sm"
              className="max-w-2xl"
              overlayClassName="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]/90 text-[var(--color-fg)] hover:bg-[var(--color-surface)]"
            >
              <p className="text-sm">{episode.overview}</p>
            </SpoilerGuard>
          )}
          {show?.metadataSource && (
            // Inherited from the show — an episode has no metadata source
            // of its own.
            <MetadataAttribution
              source={show.metadataSource}
              refreshedAt={show.metadataRefreshedAt}
              locale={locale}
            />
          )}

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
                title={t('showDetail.addWatchTooltip.episode')}
                aria-label={t('showDetail.addWatchTooltip.episode')}
                onClick={() => watchActions.setLogAdditionalWatchOpen(true)}
              >
                <PlusIcon />
              </Button>
            )}
          </div>
        </div>
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
