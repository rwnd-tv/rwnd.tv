import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { RatingStatus, SeasonDetail, SeasonEpisode } from '@rwnd/shared'
import { api } from './api-client.js'
import { invalidateWatchData } from './query-client.js'

/**
 * Rating behaviour for one episode — shared by the season grid's
 * EpisodeCard and EpisodeDetailPage, same "one hook, two consumers" shape
 * as useEpisodeWatchActions for the watched toggle. A separate hook rather
 * than folded into that one: rating shares none of its state (no date
 * dialog, no watched-status guard — rating is independent of watched
 * status) and adding four more fields to that hook's return would make
 * both call sites' destructuring unreadable. This hook has no aired-date
 * check of its own, but both call sites still hide `RatingPicker` entirely
 * for an unaired episode using `useEpisodeWatchActions`' own `notAiredYet`
 * — an unaired episode can't be rated at all, which is a different rule
 * from the watched-status decoupling this comment used to describe alone.
 */
export function useEpisodeRatingActions(
  slug: string,
  seasonNumber: number,
  // Undefined while the season query is still loading — see
  // useEpisodeWatchActions' identical parameter doc comment.
  episode: SeasonEpisode | undefined,
) {
  const queryClient = useQueryClient()

  const setRating = useMutation({
    mutationFn: (rating: number | null): Promise<RatingStatus> =>
      rating === null
        ? api.library.clearEpisodeRating(slug, seasonNumber, episode!.episodeNumber)
        : api.library.rateEpisode(slug, seasonNumber, episode!.episodeNumber, rating),
    onSuccess: (status) => {
      // Same season-list cache patch as useEpisodeWatchActions' patchEpisode.
      queryClient.setQueryData(
        ['show', slug, 'season', seasonNumber],
        (prev: SeasonDetail | undefined) =>
          prev
            ? {
                ...prev,
                episodes: prev.episodes.map((e) =>
                  e.episodeNumber === episode?.episodeNumber
                    ? { ...e, myRating: status.rating }
                    : e,
                ),
              }
            : prev,
      )
      void invalidateWatchData(queryClient)
    },
  })

  return { setRating, ratingDisabled: !episode || setRating.isPending }
}
