import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MovieDetail, WatchedStatus } from '@rwnd/shared'
import { api } from './api-client.js'
import { invalidateWatchData } from './query-client.js'

/**
 * Watch-toggle/log-additional-watch/unwatch behaviour for one movie — the
 * movie counterpart of use-episode-watch-actions.ts. A movie is structurally
 * an episode (one thing, N plays), not a show, so this mirrors that hook's
 * shape rather than ShowDetailPage's blunt "remove all watches" confirm —
 * see MovieDetailPage.tsx.
 */
export function useMovieWatchActions(
  slug: string,
  movie: MovieDetail | undefined,
  tmdbId: string | null,
) {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [logAdditionalWatchOpen, setLogAdditionalWatchOpen] = useState(false)
  const [unwatchConfirmOpen, setUnwatchConfirmOpen] = useState(false)

  // Fetched only while the confirmation dialog is actually open — same
  // "most have at most one play" reasoning as the episode hook's own
  // watches query.
  const { data: watchesData } = useQuery({
    queryKey: ['movie', slug, 'watches'],
    queryFn: () => api.library.movieWatches(slug),
    enabled: unwatchConfirmOpen,
  })

  function onMutationSuccess(status: WatchedStatus) {
    // Patches the three fields the route already returns rather than
    // waiting on a refetch — same technique the episode hook uses. Also
    // invalidates: firstWatchedAt/hasUnknownWatchDate can change too (e.g.
    // this was the first watch, or an unknown-date watch was added/
    // removed) and aren't part of WatchedStatus, so the patch alone
    // wouldn't catch them. Cheap here — unlike ShowDetailPage's
    // prefix-invalidate-avoidance, a movie page has no season pages under
    // it to protect from an extra refetch.
    queryClient.setQueryData(['movie', slug], (prev: MovieDetail | undefined) =>
      prev ? { ...prev, ...status } : prev,
    )
    void invalidateWatchData(queryClient)
    void queryClient.invalidateQueries({ queryKey: ['movie', slug] })
  }

  const unwatch = useMutation({
    mutationFn: (ids: string[]): Promise<WatchedStatus> => api.library.unwatchMovie(slug, ids),
    onSuccess: (status) => {
      onMutationSuccess(status)
      setUnwatchConfirmOpen(false)
    },
  })

  const markWatched = useMutation({
    mutationFn: async (watchedAt: string): Promise<WatchedStatus> => {
      // Same "POST /plays already resolves/creates the local row, no
      // dedicated mark-watched endpoint needed" reasoning as the episode
      // hook.
      const play = await api.plays.create({
        movie: { source: 'tmdb', externalId: tmdbId! },
        watchedAt,
      })
      return {
        watched: true,
        watchedCount: (movie?.watchedCount ?? 0) + 1,
        lastWatchedAt: play.watchedAt,
      }
    },
    onSuccess: onMutationSuccess,
  })

  // Can only mark watched once the movie has a TMDB id on record (POST
  // /plays needs it) — no air-date guard, unlike the episode hook's
  // notAiredYet, since a movie has no equivalent unaired state to check
  // here (see plays.ts's doc comment on why POST /plays doesn't gate movies
  // on a release date). Unwatching needs neither, so only guarded here.
  const toggleDisabled =
    !movie || unwatch.isPending || markWatched.isPending || (!movie.watched && !tmdbId)

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
    toggleDisabled,
  }
}
