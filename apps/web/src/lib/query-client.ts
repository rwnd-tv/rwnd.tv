import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './api-client.js'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Any 4xx is the server telling us the request itself won't
        // succeed no matter how many times it's repeated (not found,
        // forbidden, bad input, ...) — retrying only delays showing the
        // real error. Only worth retrying on 5xx/network failures, which
        // can be transient.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          return false
        }
        return failureCount < 2
      },
      staleTime: 30_000,
    },
  },
})

/**
 * Everything derived from the plays table: History (now the Activity page)
 * plus both gallery pages (apps/web/src/routes/ShowsPage.tsx, MoviesPage.tsx).
 * Logging, editing or removing a play — or a rating/watchlist/drop, which
 * the Activity page now also shows (`['activity']`) — changes what these
 * should show, so every call site that mutates one should invalidate
 * through here rather than a single query key by itself — easy to miss
 * otherwise, since the gallery/activity pages didn't exist when some call
 * sites were first written.
 */
export function invalidateWatchData(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['plays'] }),
    queryClient.invalidateQueries({ queryKey: ['activity'] }),
    queryClient.invalidateQueries({ queryKey: ['library'] }),
  ]).then(() => undefined)
}
