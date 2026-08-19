import { useState } from 'react'
import { getCookie, setSessionCookie } from './cookies.js'
import type { GenreFilterMode, GenreFilters } from './library-filter.js'

function isGenreFilterMode(value: unknown): value is GenreFilterMode {
  return value === 'include' || value === 'exclude'
}

/** Tolerant of anything malformed or stale (a genre no longer in the
 * library, a value from a future version of this cookie's shape) — those
 * entries just never match anything rather than breaking the page. */
function parseStoredFilters(raw: string | undefined): GenreFilters {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const result: GenreFilters = {}
    for (const [genre, mode] of Object.entries(parsed)) {
      if (isGenreFilterMode(mode)) result[genre] = mode
    }
    return result
  } catch {
    return {}
  }
}

type GenreFiltersUpdater = GenreFilters | ((prev: GenreFilters) => GenreFilters)

/** Same session-cookie approach as useSortCookie.ts — remembered while
 * browsing, cleared when the browser closes. A separate hook rather than
 * reusing useSortCookie: the valid key set here is the library's own genre
 * names (dynamic, not a fixed union), and the stored value is a map, not a
 * single enum value.
 *
 * Accepts a React-style functional updater, not just a plain value — two
 * toggle clicks fired close enough together (confirmed live: two automated
 * clicks in the same batch) can both fire before this hook's consumer
 * re-renders with the first click's result, so a caller that computes
 * "next" from the `filters` value it was handed can silently overwrite the
 * first click. Resolving the updater inside setGenreFiltersState's own
 * callback uses React's true latest state instead, which is immune to that. */
export function useGenreFilterCookie(
  cookieName: string,
): [GenreFilters, (updater: GenreFiltersUpdater) => void] {
  const [filters, setGenreFiltersState] = useState<GenreFilters>(() =>
    parseStoredFilters(getCookie(cookieName)),
  )

  function update(updater: GenreFiltersUpdater) {
    setGenreFiltersState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      setSessionCookie(cookieName, JSON.stringify(next))
      return next
    })
  }

  return [filters, update]
}
