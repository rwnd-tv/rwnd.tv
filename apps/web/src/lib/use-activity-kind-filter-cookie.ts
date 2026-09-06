import { ACTIVITY_KINDS, type ActivityKind } from '@rwnd/shared'
import { useKindFilterCookie } from './use-kind-filter-cookie.js'

/**
 * Which activity kinds to show on HistoryPage.tsx's activity feed — a thin
 * wrapper over use-kind-filter-cookie.ts's generic form (`kind` is
 * single-valued per entry, unlike a show's several genres, so mixing
 * "include watch" with "exclude rating" has no clean combined meaning the
 * way it does for genres — a checked/unchecked set is what the four fixed
 * kinds actually need, not use-genre-filter-cookie.ts's include/exclude
 * shape).
 */
export function useActivityKindFilterCookie(
  cookieName: string,
): [Set<ActivityKind>, (next: Set<ActivityKind>) => void] {
  return useKindFilterCookie(cookieName, ACTIVITY_KINDS)
}
