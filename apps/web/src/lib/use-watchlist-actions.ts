import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MovieDetail, ShowDetail, WatchlistMembershipStatus } from '@rwnd/shared'
import { api } from './api-client.js'
import { invalidateWatchData } from './query-client.js'

/**
 * Watchlist membership for one show/movie — shared by ShowDetailPage.tsx
 * and MovieDetailPage.tsx's WatchlistButton (components/library/
 * WatchlistButton.tsx), the "one hook, two consumers" shape
 * useEpisodeWatchActions/useEpisodeRatingActions already use elsewhere.
 * Bundles the list-membership mutations *and* the custom-lists dialog's
 * own open/new-list-name state, since both pages render the identical
 * button+dialog markup and neither owns anything about it beyond passing
 * in `mediaType`/`slug`/`myWatchlistIds`.
 *
 * The watchlists list itself (`useQuery(['watchlists'])`) is fetched
 * unconditionally here, not lazily on dialog open — unlike
 * UnwatchConfirmDialog's on-demand fetch, the one-click Default toggle
 * needs to know the Default list's id before the dialog ever opens.
 */
export function useWatchlistActions(
  mediaType: 'show' | 'movie',
  slug: string,
  myWatchlistIds: string[],
) {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [newListName, setNewListName] = useState('')

  const { data } = useQuery({
    queryKey: ['watchlists'],
    queryFn: () => api.watchlists.list(),
  })
  const watchlists = data?.watchlists ?? []
  const defaultWatchlistId = watchlists.find((w) => w.isDefault)?.id

  function patchMembership(status: WatchlistMembershipStatus) {
    queryClient.setQueryData([mediaType, slug], (prev: ShowDetail | MovieDetail | undefined) =>
      prev ? { ...prev, myWatchlistIds: status.myWatchlistIds } : prev,
    )
    void invalidateWatchData(queryClient)
  }

  const add = useMutation({
    mutationFn: (watchlistId: string) =>
      mediaType === 'show'
        ? api.library.addShowToWatchlist(slug, watchlistId)
        : api.library.addMovieToWatchlist(slug, watchlistId),
    onSuccess: patchMembership,
  })
  const remove = useMutation({
    mutationFn: (watchlistId: string) =>
      mediaType === 'show'
        ? api.library.removeShowFromWatchlist(slug, watchlistId)
        : api.library.removeMovieFromWatchlist(slug, watchlistId),
    onSuccess: patchMembership,
  })

  function toggle(watchlistId: string) {
    if (myWatchlistIds.includes(watchlistId)) remove.mutate(watchlistId)
    else add.mutate(watchlistId)
  }

  // Creating a list and adding the current title to it are two requests —
  // deliberately not a combined endpoint, since POST /watchlists already
  // exists for the Watchlists page's own "+ New list" and reusing it here
  // keeps there being exactly one way to create a list.
  const createAndAdd = useMutation({
    mutationFn: async (name: string) => {
      const created = await api.watchlists.create({ name })
      return api.library[mediaType === 'show' ? 'addShowToWatchlist' : 'addMovieToWatchlist'](
        slug,
        created.id,
      )
    },
    onSuccess: (status) => {
      patchMembership(status)
      setNewListName('')
    },
  })

  return {
    watchlists,
    defaultWatchlistId,
    onDefault: defaultWatchlistId ? myWatchlistIds.includes(defaultWatchlistId) : false,
    toggleDefault: () => defaultWatchlistId && toggle(defaultWatchlistId),
    toggleList: toggle,
    togglePending: add.isPending || remove.isPending,
    dialogOpen,
    setDialogOpen,
    newListName,
    setNewListName,
    createAndAdd: () => createAndAdd.mutate(newListName),
    createPending: createAndAdd.isPending,
    createError: createAndAdd.isError,
  }
}
