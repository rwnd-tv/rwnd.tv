/**
 * Filter/sort logic for the admin Users list (UsersPanel.tsx, 2026-09-03,
 * docs/TODO_ARCHIVE.md). Pulled out as plain functions — no React, no DOM —
 * same reasoning as library-filter.ts: the only non-trivial logic in this
 * feature worth unit-testing on its own; wiring these into the actual
 * controls belongs in a component test instead, not here.
 */
import type { UserRole } from '@rwnd/shared'
import { foldForSearch, type StatusFilters } from './library-filter.js'

/** Matches against *either* `displayName` or `email` — unlike
 * `filterByTitle` (library-filter.ts), which is single-field, since a name
 * search that ignores email (or vice versa) would miss the obvious case of
 * searching by the part you actually remember. */
export function filterByNameOrEmail<T extends { displayName: string; email: string }>(
  items: T[],
  query: string,
): T[] {
  const trimmed = query.trim()
  if (!trimmed) return items
  const folded = foldForSearch(trimmed)
  return items.filter(
    (item) =>
      foldForSearch(item.displayName).includes(folded) ||
      foldForSearch(item.email).includes(folded),
  )
}

/** Role filter panel (UsersPanel.tsx / RoleFilterPanel.tsx). Same
 * include/exclude shape as `filterByStatus` (library-filter.ts) — reusing
 * its `StatusFilters` type rather than declaring an identical one — over
 * `role` instead of `status`: a single-valued field, but a real one, so
 * "show admins and owners, hide plain users" (two includes, OR'd) is a
 * sensible query, same reasoning status filtering already established. */
export function filterByRole<T extends { role: UserRole }>(
  items: T[],
  filters: StatusFilters,
): T[] {
  const entries = Object.entries(filters)
  const includes = entries.filter(([, mode]) => mode === 'include').map(([role]) => role)
  const excludes = entries.filter(([, mode]) => mode === 'exclude').map(([role]) => role)
  if (includes.length === 0 && excludes.length === 0) return items

  return items.filter((item) => {
    if (includes.length > 0 && !includes.includes(item.role)) return false
    return !excludes.includes(item.role)
  })
}

/** Same tri-state shape as `DroppedFilterMode` (library-filter.ts) — a
 * single boolean condition, not a genre/status-style set of named values —
 * declared as its own type rather than reusing that one directly, matching
 * this codebase's existing precedent of `UnratedMode`/`UnknownWatchedMode`
 * each getting their own identically-shaped type for clarity. */
export const MFA_FILTER_MODES = ['neutral', 'exclude', 'include'] as const
export type MfaFilterMode = (typeof MFA_FILTER_MODES)[number]

export function filterByMfa<T extends { mfaEnabled: boolean }>(
  items: T[],
  mode: MfaFilterMode,
): T[] {
  if (mode === 'neutral') return items
  return items.filter((item) => item.mfaEnabled === (mode === 'include'))
}

export const VERIFIED_FILTER_MODES = ['neutral', 'exclude', 'include'] as const
export type VerifiedFilterMode = (typeof VERIFIED_FILTER_MODES)[number]

export function filterByVerified<T extends { emailVerifiedAt: string | null }>(
  items: T[],
  mode: VerifiedFilterMode,
): T[] {
  if (mode === 'neutral') return items
  return items.filter((item) => (item.emailVerifiedAt !== null) === (mode === 'include'))
}

/** Locale-aware, same `Intl.Collator` recipe as library-filter.ts's
 * `titleComparatorAsc` — deliberately *not* reusing that function itself,
 * since its leading-article stripping ("The", "A") is a show/movie-title
 * convention that has no business touching a person's name. */
export function nameComparatorAsc(
  locale: string,
): (a: { displayName: string }, b: { displayName: string }) => number {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true })
  return (a, b) => collator.compare(a.displayName, b.displayName)
}

export function nameComparatorDesc(
  locale: string,
): (a: { displayName: string }, b: { displayName: string }) => number {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true })
  return (a, b) => collator.compare(b.displayName, a.displayName)
}

/** Privilege order, most-privileged first — `owner` is a strict superset of
 * `admin` (see `isAdminRole`, packages/shared/src/schemas/common.ts), which
 * is itself a superset of `user`. Ties (same role) fall back to a
 * locale-aware name comparison rather than leaving equal-role rows in
 * whatever order they happened to arrive in. */
const ROLE_RANK: Record<UserRole, number> = { owner: 0, admin: 1, user: 2 }

export function roleComparatorAsc(
  locale: string,
): (
  a: { role: UserRole; displayName: string },
  b: { role: UserRole; displayName: string },
) => number {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true })
  return (a, b) =>
    ROLE_RANK[a.role] - ROLE_RANK[b.role] || collator.compare(a.displayName, b.displayName)
}

export function roleComparatorDesc(
  locale: string,
): (
  a: { role: UserRole; displayName: string },
  b: { role: UserRole; displayName: string },
) => number {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true })
  return (a, b) =>
    ROLE_RANK[b.role] - ROLE_RANK[a.role] || collator.compare(a.displayName, b.displayName)
}

/** Nulls ("never signed in") sort last in *both* directions — same
 * reasoning as library-filter.ts's `yearComparatorDesc`: "never" isn't
 * meaningfully more or less recent than anything else, so it shouldn't
 * jump to the front just because the direction flipped. */
export function lastLoginComparatorDesc(
  a: { lastLoginAt: string | null },
  b: { lastLoginAt: string | null },
): number {
  if (a.lastLoginAt === b.lastLoginAt) return 0
  if (a.lastLoginAt === null) return 1
  if (b.lastLoginAt === null) return -1
  return new Date(b.lastLoginAt).getTime() - new Date(a.lastLoginAt).getTime()
}

export function lastLoginComparatorAsc(
  a: { lastLoginAt: string | null },
  b: { lastLoginAt: string | null },
): number {
  if (a.lastLoginAt === b.lastLoginAt) return 0
  if (a.lastLoginAt === null) return 1
  if (b.lastLoginAt === null) return -1
  return new Date(a.lastLoginAt).getTime() - new Date(b.lastLoginAt).getTime()
}

/** `createdAt` is never null (every user has one), so unlike
 * `lastLoginComparator` above there's no "unknown" case to special-case. */
export function createdComparatorDesc(a: { createdAt: string }, b: { createdAt: string }): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
}

export function createdComparatorAsc(a: { createdAt: string }, b: { createdAt: string }): number {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
}
