import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SeasonDetail, SeasonEpisode, WatchedStatus } from '@rwnd/shared'
import { api } from './api-client.js'
import { invalidateWatchData } from './query-client.js'

/**
 * Watch-toggle/log-additional-watch/unwatch behaviour for one episode —
 * shared by the season grid's EpisodeCard (SeasonDetailPage.tsx) and
 * EpisodeDetailPage.tsx, so the aired/unknown-watch guard rules (and any
 * future fix to them) apply identically in both places rather than risking
 * the two drifting out of sync, the way the identical-timestamp unwatch bug
 * did when this logic only lived in one place.
 */
export function useEpisodeWatchActions(
  slug: string,
  seasonNumber: number,
  // Undefined while the season query backing the episode is still loading
  // (EpisodeDetailPage.tsx calls this hook before it knows whether the
  // episode number in the URL even exists) — every mutation/derived value
  // below stays disabled/inert until it resolves, since React's rules of
  // hooks mean this can't be called conditionally once the caller knows.
  episode: SeasonEpisode | undefined,
  tmdbId: string | null,
) {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [logAdditionalWatchOpen, setLogAdditionalWatchOpen] = useState(false)
  const [unwatchConfirmOpen, setUnwatchConfirmOpen] = useState(false)

  // Fetched only while the confirmation dialog is actually open — most
  // episodes have at most one play, so there's no reason to fetch every
  // episode's full watch list up front just to back a dialog most clicks
  // never open.
  const { data: watchesData } = useQuery({
    queryKey: ['show', slug, 'season', seasonNumber, 'episode', episode?.episodeNumber, 'watches'],
    queryFn: () => api.library.episodeWatches(slug, seasonNumber, episode!.episodeNumber),
    enabled: unwatchConfirmOpen && Boolean(episode),
  })

  function patchEpisode(status: WatchedStatus) {
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
                e.episodeNumber === episode?.episodeNumber ? { ...e, ...status } : e,
              ),
            }
          : prev,
    )
  }

  function onMutationSuccess(status: WatchedStatus) {
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
    mutationFn: (ids: string[]): Promise<WatchedStatus> =>
      api.library.unwatchEpisode(slug, seasonNumber, episode!.episodeNumber, ids),
    onSuccess: (status) => {
      onMutationSuccess(status)
      setUnwatchConfirmOpen(false)
    },
  })

  const markWatched = useMutation({
    mutationFn: async (watchedAt: string): Promise<WatchedStatus> => {
      // POST /plays already resolves/creates the local episode row and
      // returns the logged play — no dedicated "mark watched" endpoint
      // needed (see the plan's backend section).
      const play = await api.plays.create({
        episode: {
          source: 'tmdb',
          showExternalId: tmdbId!,
          seasonNumber,
          episodeNumber: episode!.episodeNumber,
        },
        watchedAt,
      })
      return {
        watched: true,
        watchedCount: episode!.watchedCount + 1,
        lastWatchedAt: play.watchedAt,
      }
    },
    onSuccess: onMutationSuccess,
  })

  // An unaired episode (no known firstAired, or one still in the future)
  // can't have been watched yet — same rule the bulk "Watched" button's
  // logMissingWatches enforces server-side (apps/api/src/routes/library.ts),
  // now enforced here too so the toggle never opens a dialog whose only
  // possible outcome is the POST /plays 400 this would otherwise hit.
  const notAiredYet =
    !episode || episode.firstAired === null || new Date(episode.firstAired) > new Date()
  // Can only mark watched when the show has a TMDB id on record (POST
  // /plays needs it) and the episode has actually aired — unwatching needs
  // neither, so only guarded here. Also disabled outright while `episode`
  // itself hasn't resolved yet (see the param doc comment above).
  const toggleDisabled =
    !episode ||
    unwatch.isPending ||
    markWatched.isPending ||
    (!episode.watched && (!tmdbId || notAiredYet))

  return {
    dialogOpen,
    setDialogOpen,
    logAdditionalWatchOpen,
    setLogAdditionalWatchOpen,
    unwatchConfirmOpen,
    setUnwatchConfirmOpen,
    watchesData,
    markWatched,
    unwatch,
    notAiredYet,
    toggleDisabled,
  }
}
