import type { QueryClient } from '@tanstack/react-query'

/**
 * Drop every OTHER cached query (library, history, on-deck, show/episode
 * pages, ...) — all keyed without a userId, so the next login (a different
 * account, same browser/session) would otherwise see this account's data
 * until each query's own staleTime lapsed. Deliberately NOT
 * queryClient.clear() here: that also destroys auth/me's own query object,
 * and clear() + an immediate invalidate/refetch of that same key race
 * against React re-subscribing AuthProvider's observer — the refetch call
 * can find nothing to refetch and silently no-op, leaving `user` stuck
 * until a hard refresh (live-verified 2026-08-24: exactly this, on dev
 * only — confirmed via an A/B test against prod's plain-invalidate
 * version, which has never had this problem). Removing every *other*
 * query leaves auth/me's own observer untouched, so the plain invalidate
 * below refetches it the same reliable way it always has.
 */
export async function resetAuthCache(queryClient: QueryClient) {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth' })
  await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
}
