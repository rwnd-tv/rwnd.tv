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
 * Everything derived from the plays table: History plus both gallery pages
 * (apps/web/src/routes/ShowsPage.tsx, MoviesPage.tsx). Logging or removing
 * a play changes what both should show, so every call site that mutates a
 * play should invalidate through here rather than just `['plays']` — easy
 * to miss otherwise, since the gallery pages didn't exist when those call
 * sites were first written.
 */
export function invalidateWatchData(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['plays'] }),
    queryClient.invalidateQueries({ queryKey: ['library'] }),
  ]).then(() => undefined)
}
