import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './api-client.js'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
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
