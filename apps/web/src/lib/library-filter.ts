/**
 * Filter/sort logic for the TV Shows and Movies gallery pages. Pulled out
 * as plain functions — with no React, no DOM — because it's the only
 * non-trivial logic in this feature worth unit-testing on its own;
 * component-level behavior (wiring these into the actual filter panels)
 * belongs in a component test instead, not here.
 */

/** Case- and accent-insensitive: "amelie" should match "Amélie" — matters
 * regardless of UI locale, since a title itself (from TMDB) can carry
 * diacritics the user typing a search query might not bother with. */
function foldForSearch(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

function matchesFilter(title: string, query: string): boolean {
  const trimmed = query.trim()
  if (!trimmed) return true
  return foldForSearch(title).includes(foldForSearch(trimmed))
}

export function filterByTitle<T extends { title: string }>(items: T[], query: string): T[] {
  if (!query.trim()) return items
  return items.filter((item) => matchesFilter(item.title, query))
}

/** Leading-article stripping is inherently per-language (which words count
 * as articles varies, and plenty of languages have none), so there's no
 * locale-agnostic algorithm for it. Only English ships as a UI locale
 * today, so this only handles "the"/"a"/"an"; extend with more language
 * tables if/when non-English locales ship. */
const ENGLISH_LEADING_ARTICLE = /^(the|an?)\s+/i

function sortKeyFor(locale: string, title: string): string {
  return locale.startsWith('en') ? title.replace(ENGLISH_LEADING_ARTICLE, '') : title
}

/** Locale-aware title comparator — `numeric: true` so "Season 2" sorts
 * before "Season 10", `sensitivity: 'base'` so case/accents don't affect
 * order (only whether something matches search). Strips a leading English
 * article ("The Wire" sorts under W) for English locales; see
 * `sortKeyFor`. `Desc` is a plain swap of the same collator, not a
 * separate comparator — there's no null/unknown case for a title to
 * handle specially. */
export function titleComparatorAsc(
  locale: string,
): (a: { title: string }, b: { title: string }) => number {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true })
  return (a, b) => collator.compare(sortKeyFor(locale, a.title), sortKeyFor(locale, b.title))
}

export function titleComparatorDesc(
  locale: string,
): (a: { title: string }, b: { title: string }) => number {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true })
  return (a, b) => collator.compare(sortKeyFor(locale, b.title), sortKeyFor(locale, a.title))
}

/** Items with no year sort last in *both* directions — "unknown" isn't
 * meaningfully older or newer than anything else, so it shouldn't jump to
 * the front just because the direction flipped. That's why `Asc` isn't
 * simply `-Desc`: negating would put nulls first instead of last. */
export function yearComparatorDesc(a: { year: number | null }, b: { year: number | null }): number {
  if (a.year === b.year) return 0
  if (a.year === null) return 1
  if (b.year === null) return -1
  return b.year - a.year
}

export function yearComparatorAsc(a: { year: number | null }, b: { year: number | null }): number {
  if (a.year === b.year) return 0
  if (a.year === null) return 1
  if (b.year === null) return -1
  return a.year - b.year
}

/** By an ISO datetime field — Desc is most-recently-watched first, Asc is
 * least-recently-watched (i.e. longest-untouched) first. Every show in this
 * list has at least one play, so unlike the year comparators there's no
 * null/unknown case to sort specially — even a 1900-01-01 (Trakt's "I don't
 * remember when" sentinel) watch is still a real, comparable timestamp
 * here, just an old one. */
export function lastWatchedComparatorDesc<T extends { lastWatchedAt: string }>(a: T, b: T): number {
  return new Date(b.lastWatchedAt).getTime() - new Date(a.lastWatchedAt).getTime()
}

export function lastWatchedComparatorAsc<T extends { lastWatchedAt: string }>(a: T, b: T): number {
  return new Date(a.lastWatchedAt).getTime() - new Date(b.lastWatchedAt).getTime()
}

/**
 * Genre filter panel (ShowsPage.tsx / GenreFilterPanel.tsx). A genre with no
 * entry in `filters` has no rule applied. The two modes combine
 * differently across multiple selections:
 *  - `'include'`: OR across every included genre — an item needs at least
 *    one of them, not all of them (e.g. Include Comedy + Include Drama
 *    shows anything that's either).
 *  - `'exclude'`: hidden if it has *any* excluded genre — equivalent to
 *    ANDing together "must not have Comedy" and "must not have Drama", so
 *    this one didn't need a separate code path from a naive per-genre AND.
 * Include and exclude still combine with each other via AND: an item must
 * clear the include set (if any) *and* clear every exclude.
 */
export type GenreFilterMode = 'include' | 'exclude'
export type GenreFilters = Record<string, GenreFilterMode>

export function filterByGenres<T extends { genres: string[] }>(
  items: T[],
  filters: GenreFilters,
): T[] {
  const entries = Object.entries(filters)
  const includes = entries.filter(([, mode]) => mode === 'include').map(([genre]) => genre)
  const excludes = entries.filter(([, mode]) => mode === 'exclude').map(([genre]) => genre)
  if (includes.length === 0 && excludes.length === 0) return items

  return items.filter((item) => {
    if (includes.length > 0 && !includes.some((genre) => item.genres.includes(genre))) {
      return false
    }
    return !excludes.some((genre) => item.genres.includes(genre))
  })
}

/** Every distinct genre present across the library, alphabetically —
 * what the filter panel offers is scoped to genres you actually have
 * something in, not TMDB's full fixed vocabulary. */
export function collectGenres<T extends { genres: string[] }>(
  items: T[],
  locale: string,
): string[] {
  const set = new Set<string>()
  for (const item of items) for (const genre of item.genres) set.add(genre)
  const collator = new Intl.Collator(locale, { sensitivity: 'base' })
  return [...set].sort((a, b) => collator.compare(a, b))
}

/**
 * "Status" filter panel (ShowsPage.tsx / StatusFilterPanel.tsx). Same
 * include/exclude shape as the genre filter above — reusing its mode type
 * rather than redeclaring an identical union — but over a single-valued
 * field (`status`) instead of an array, since a show only ever has one
 * status. A null status (not yet cached by the metadata refresher) never
 * matches an include or exclude rule, same treatment as a genre-less show
 * against the genre filter: invisible to a specific rule, not specially
 * hidden or shown by it.
 */
export type StatusFilterMode = GenreFilterMode
export type StatusFilters = GenreFilters

export function filterByStatus<T extends { status: string | null }>(
  items: T[],
  filters: StatusFilters,
): T[] {
  const entries = Object.entries(filters)
  const includes = entries.filter(([, mode]) => mode === 'include').map(([status]) => status)
  const excludes = entries.filter(([, mode]) => mode === 'exclude').map(([status]) => status)
  if (includes.length === 0 && excludes.length === 0) return items

  return items.filter((item) => {
    if (includes.length > 0 && (item.status === null || !includes.includes(item.status))) {
      return false
    }
    return item.status === null || !excludes.includes(item.status)
  })
}

/** Every distinct status present across the library. Returned as TMDB's raw
 * canonical strings, unsorted by display order — ShowsPage.tsx sorts these
 * by their *translated* label before handing them to the panel, since the
 * display text is locale-dependent (TMDB doesn't localize `status` itself)
 * and this module stays free of i18n/React per the file docstring. */
export function collectStatuses<T extends { status: string | null }>(items: T[]): string[] {
  const set = new Set<string>()
  for (const item of items) if (item.status !== null) set.add(item.status)
  return [...set]
}

/** "Released" filter panel (ShowsPage.tsx / ReleaseYearFilterPanel.tsx). */
export interface YearRange {
  min: number
  max: number
}

/** The After/Before sliders' own min and max — the earliest and latest
 * release years actually present in the library, not an arbitrary fixed
 * range. `null` when no item has a known year at all (nothing to build a
 * slider range from), which is what tells the caller not to render the
 * section rather than showing a broken zero-width slider. */
export function yearRange<T extends { year: number | null }>(items: T[]): YearRange | null {
  const years = items.map((item) => item.year).filter((year): year is number => year !== null)
  if (years.length === 0) return null
  return { min: Math.min(...years), max: Math.max(...years) }
}

/** Inclusive on both ends. An item with no known year is never hidden by
 * this filter — there's no basis to place it inside or outside a range it
 * has no value for, so it's left for every other filter/search to decide
 * on instead (same reasoning as a show with no cached episode total not
 * being penalised for it elsewhere in this feature). */
export function filterByReleaseYear<T extends { year: number | null }>(
  items: T[],
  after: number,
  before: number,
): T[] {
  return items.filter((item) => item.year === null || (item.year >= after && item.year <= before))
}

/**
 * "Rating" filter panel (ShowsPage.tsx / RatingFilterPanel.tsx) and the
 * Rating sort options. TMDB's `voteAverage` (0-10, one decimal of real
 * precision) — reuses `YearRange`'s shape rather than a new interface, it's
 * just a min/max pair either way.
 */
export function ratingRange<T extends { voteAverage: number | null }>(
  items: T[],
): YearRange | null {
  const ratings = items.map((item) => item.voteAverage).filter((r): r is number => r !== null)
  if (ratings.length === 0) return null
  return { min: Math.min(...ratings), max: Math.max(...ratings) }
}

/** Inclusive on both ends. Same "no basis to place it" treatment as
 * filterByReleaseYear above for a show with no cached rating yet. */
export function filterByRating<T extends { voteAverage: number | null }>(
  items: T[],
  after: number,
  before: number,
): T[] {
  return items.filter(
    (item) =>
      item.voteAverage === null || (item.voteAverage >= after && item.voteAverage <= before),
  )
}

/** Same "unknown sorts last in both directions" treatment as
 * yearComparatorDesc/Asc above. */
export function ratingComparatorDesc(
  a: { voteAverage: number | null },
  b: { voteAverage: number | null },
): number {
  if (a.voteAverage === b.voteAverage) return 0
  if (a.voteAverage === null) return 1
  if (b.voteAverage === null) return -1
  return b.voteAverage - a.voteAverage
}

export function ratingComparatorAsc(
  a: { voteAverage: number | null },
  b: { voteAverage: number | null },
): number {
  if (a.voteAverage === b.voteAverage) return 0
  if (a.voteAverage === null) return 1
  if (b.voteAverage === null) return -1
  return a.voteAverage - b.voteAverage
}

/**
 * "My rating" filter panel (ShowsPage.tsx / MyRatingFilterPanel.tsx) and the
 * My Rating sort options — the current user's own 1-10 rating, deliberately
 * parallel to and independent from the TMDB `voteAverage` filter/sort just
 * above (a title can have either, both, or neither). Same shape as
 * ratingRange (observed min/max), but most of a library starts out unrated
 * — unlike voteAverage, which the metadata refresher populates for nearly
 * everything — so unlike filterByRating, "hide/only show unrated" is a real,
 * likely-wanted query here, hence the extra UnratedMode below rather than
 * just letting null always pass through.
 */
export function myRatingRange<T extends { myRating: number | null }>(items: T[]): YearRange | null {
  const ratings = items.map((item) => item.myRating).filter((r): r is number => r !== null)
  if (ratings.length === 0) return null
  return { min: Math.min(...ratings), max: Math.max(...ratings) }
}

/** Same tri-state shape as UnknownWatchedMode/DroppedFilterMode above. */
export const UNRATED_MODES = ['neutral', 'exclude', 'include'] as const
export type UnratedMode = (typeof UNRATED_MODES)[number]

/** Inclusive on both ends for a known rating. An unrated item is governed
 * entirely by `unratedMode` instead — same tri-state treatment as
 * filterByWatchedYear's unknownMode below. */
export function filterByMyRating<T extends { myRating: number | null }>(
  items: T[],
  after: number,
  before: number,
  unratedMode: UnratedMode,
): T[] {
  return items.filter((item) => {
    if (item.myRating === null) return unratedMode !== 'exclude'
    return unratedMode !== 'include' && item.myRating >= after && item.myRating <= before
  })
}

/** Same "unknown/unrated sorts last in both directions" treatment as
 * ratingComparatorDesc/Asc above. */
export function myRatingComparatorDesc(
  a: { myRating: number | null },
  b: { myRating: number | null },
): number {
  if (a.myRating === b.myRating) return 0
  if (a.myRating === null) return 1
  if (b.myRating === null) return -1
  return b.myRating - a.myRating
}

export function myRatingComparatorAsc(
  a: { myRating: number | null },
  b: { myRating: number | null },
): number {
  if (a.myRating === b.myRating) return 0
  if (a.myRating === null) return 1
  if (b.myRating === null) return -1
  return a.myRating - b.myRating
}

/**
 * "Watched" filter panel (ShowsPage.tsx / WatchedYearFilterPanel.tsx).
 * `lastWatchedAt` dated exactly 1900-01-01 is Trakt's "I don't remember
 * when" sentinel (see ShowDetailPage.tsx/HistoryPage.tsx's own handling of
 * it) — treated as "unknown", not a real year, everywhere in this filter.
 * Checked via UTC year so it can't be thrown off by the browser's timezone
 * shifting the calendar day around midnight.
 */
function watchedYearOf(item: { lastWatchedAt: string }): number | null {
  const year = new Date(item.lastWatchedAt).getUTCFullYear()
  return year === 1900 ? null : year
}

/** Same shape as yearRange() above, but over known watched years only —
 * 1900 is excluded from the range itself, not just clamped into it, so the
 * "After" slider can never be dragged back to it. `null` when every item's
 * watched year is unknown (nothing to build a slider range from). */
export function watchedYearRange<T extends { lastWatchedAt: string }>(
  items: T[],
): YearRange | null {
  const years = items.map(watchedYearOf).filter((year): year is number => year !== null)
  if (years.length === 0) return null
  return { min: Math.min(...years), max: Math.max(...years) }
}

/** The "Unknown" control in the Watched filter section (see
 * WatchedYearFilterPanel.tsx) — a tri-state condition, not a genre-style set
 * of named items, so it gets its own mode type rather than reusing
 * GenreFilterMode's two-value union: `'neutral'` shows both known
 * (in-range) and unknown shows (the default), `'exclude'` hides unknown
 * entirely, and `'include'` shows *only* unknown shows, ignoring the
 * After/Before range entirely. */
export const UNKNOWN_WATCHED_MODES = ['neutral', 'exclude', 'include'] as const
export type UnknownWatchedMode = (typeof UNKNOWN_WATCHED_MODES)[number]

/** Inclusive on both ends for known years. An unknown watched year (see
 * watchedYearOf) is governed entirely by `unknownMode` instead — it's
 * categorical, not a value the After/Before range could meaningfully place
 * inside or outside of. */
export function filterByWatchedYear<T extends { lastWatchedAt: string }>(
  items: T[],
  after: number,
  before: number,
  unknownMode: UnknownWatchedMode,
): T[] {
  return items.filter((item) => {
    const year = watchedYearOf(item)
    if (year === null) return unknownMode !== 'exclude'
    return unknownMode !== 'include' && year >= after && year <= before
  })
}

/**
 * "Dropped" filter panel (ShowsPage.tsx / DroppedFilterPanel.tsx). Same
 * tri-state shape as `UnknownWatchedMode` above — a single condition, not a
 * genre-style set of named items — but a different default: dropped shows
 * are meant to be hidden unless asked for, so ShowsPage.tsx seeds this
 * cookie at `'exclude'` rather than `'neutral'`.
 */
export const DROPPED_FILTER_MODES = ['neutral', 'exclude', 'include'] as const
export type DroppedFilterMode = (typeof DROPPED_FILTER_MODES)[number]

export function filterByDropped<T extends { dropped: boolean }>(
  items: T[],
  mode: DroppedFilterMode,
): T[] {
  if (mode === 'neutral') return items
  return items.filter((item) => item.dropped === (mode === 'include'))
}
