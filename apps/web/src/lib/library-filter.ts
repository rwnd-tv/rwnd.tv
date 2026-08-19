/**
 * Filter/sort logic for the TV Shows and Movies gallery pages. Pulled out
 * as plain functions — with no React, no DOM — for two reasons: it's the
 * only non-trivial logic in the web layer worth unit-testing, and apps/web
 * has no test project set up yet (no vitest config, no jsdom), so a
 * DOM-free pure function is the one piece of this feature that can be
 * covered without standing that up first.
 */

/** Case- and accent-insensitive: "amelie" should match "Amélie", and this
 * matters more than usual here since fr-FR is a first-class locale. */
export function foldForSearch(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

export function matchesFilter(title: string, query: string): boolean {
  const trimmed = query.trim()
  if (!trimmed) return true
  return foldForSearch(title).includes(foldForSearch(trimmed))
}

export function filterByTitle<T extends { title: string }>(items: T[], query: string): T[] {
  if (!query.trim()) return items
  return items.filter((item) => matchesFilter(item.title, query))
}

/** Locale-aware title comparator — `numeric: true` so "Season 2" sorts
 * before "Season 10", `sensitivity: 'base'` so case/accents don't affect
 * order (only whether something matches search). Deliberately doesn't
 * strip leading articles ("The Wire" sorts under T, not W) — real per-
 * language rules for that are a bigger job than this feature needs.
 * `Desc` is a plain swap of the same collator, not a separate comparator —
 * there's no null/unknown case for a title to handle specially. */
export function titleComparatorAsc(
  locale: string,
): (a: { title: string }, b: { title: string }) => number {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true })
  return (a, b) => collator.compare(a.title, b.title)
}

export function titleComparatorDesc(
  locale: string,
): (a: { title: string }, b: { title: string }) => number {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true })
  return (a, b) => collator.compare(b.title, a.title)
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

/** Descending by an ISO datetime field — most-recently-watched first. */
export function lastWatchedComparator<T extends { lastWatchedAt: string }>(a: T, b: T): number {
  return new Date(b.lastWatchedAt).getTime() - new Date(a.lastWatchedAt).getTime()
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
  return [...set].sort(new Intl.Collator(locale, { sensitivity: 'base' }).compare)
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
