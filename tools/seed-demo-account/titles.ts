/**
 * Curated seed data for the demo account: hand-picked, not pulled from a
 * "trending now" API, so a reseed produces the same shape of library every
 * time regardless of when it's run. Update this list every year or so to
 * keep "the last few years" actually recent; there's no mechanism that does
 * that automatically, and there shouldn't be. See README.md.
 *
 * Titles are resolved against the configured metadata provider (TMDB) by
 * title/year search at seed time (seed.ts), not by hardcoded external id.
 * A title search.ts can't find is skipped with a warning rather than
 * failing the whole run, same convention as the screenshot tool.
 */

export interface WatchedMovie {
  title: string
  year: number
}

export interface WatchedShow {
  title: string
  year: number
  /** Season 1 episodes to log: kept short (a handful, not a full series),
   * since "doesn't have to be super detailed" per the brief this tool
   * exists for. An episode number that doesn't exist (or hasn't aired) is
   * skipped with a warning rather than failing the run. */
  episodes: number[]
}

// Roughly the last three years, real and well-known enough to be a safe
// TMDB search match. Order doesn't matter; seed.ts assigns watch dates.
export const WATCHED_MOVIES: WatchedMovie[] = [
  { title: 'Oppenheimer', year: 2023 },
  { title: 'Barbie', year: 2023 },
  { title: 'Poor Things', year: 2023 },
  { title: 'Killers of the Flower Moon', year: 2023 },
  { title: 'Dune: Part Two', year: 2024 },
  { title: 'Anora', year: 2024 },
  { title: 'The Substance', year: 2024 },
  { title: 'Wicked', year: 2024 },
  { title: 'Deadpool & Wolverine', year: 2024 },
  { title: 'Conclave', year: 2024 },
  { title: 'Sinners', year: 2025 },
  { title: 'The Odyssey', year: 2026 },
]

// Deliberately short of each season's real episode count. The Dashboard's
// Continue Watching row (apps/api/src/routes/library/queue.ts's On Deck)
// only shows a show with a real unwatched-but-aired episode still ahead of
// it, so "watched all of it" here means "never appears there". Keep every
// one of these a couple of episodes short of the season's actual length.
export const WATCHED_SHOWS: WatchedShow[] = [
  { title: 'The Last of Us', year: 2023, episodes: [1, 2, 3, 4, 5, 6, 7] }, // of 9
  { title: 'Shogun', year: 2024, episodes: [1, 2, 3, 4, 5, 6] }, // of 10
  { title: 'The Bear', year: 2022, episodes: [1, 2, 3, 4, 5, 6] }, // of 8
  { title: 'Fallout', year: 2024, episodes: [1, 2, 3, 4, 5] }, // of 8
  { title: 'Ripley', year: 2024, episodes: [1, 2, 3, 4] }, // of 8
  { title: '3 Body Problem', year: 2024, episodes: [1, 2, 3, 4, 5] }, // of 8
  { title: 'Slow Horses', year: 2022, episodes: [1, 2, 3, 4] }, // of 6
  { title: 'House of the Dragon', year: 2022, episodes: [1, 2, 3, 4, 5, 6, 7, 8] }, // of 10
  { title: 'Silo', year: 2023, episodes: [1, 2, 3, 4, 5] }, // of 10
  { title: 'Reacher', year: 2022, episodes: [1, 2, 3, 4] }, // of 8
  { title: 'Squid Game', year: 2021, episodes: [1, 2, 3, 4, 5, 6] }, // of 9
  { title: 'Star Trek: Strange New Worlds', year: 2022, episodes: [1, 2, 3, 4, 5] }, // of 10
]

// Not watched: resolved and watchlisted only, for the "upcoming" feel.
export const WATCHLISTED_MOVIES: { title: string; year?: number }[] = [
  { title: 'Avengers: Doomsday' },
  { title: 'Dune: Part Three' },
  { title: 'Spider-Man: Beyond the Spider-Verse' },
  { title: 'The Batman Part II' },
  { title: 'Avatar 4' },
]

export const WATCHLISTED_SHOWS: { title: string; year?: number }[] = [
  { title: 'Stranger Things' },
  { title: 'Severance' },
  { title: 'The Boys' },
]

export interface CustomWatchlist {
  name: string
  movies: string[]
  shows: string[]
}

// Names deliberately in the "a real person's personal list" register, not
// generic category names. See the brief this tool was built for.
export const CUSTOM_WATCHLISTS: CustomWatchlist[] = [
  {
    name: 'My favourite Sci-Fi movies',
    movies: ['Dune: Part Two', 'Poor Things', 'The Substance', 'Dune: Part Three'],
    shows: [],
  },
  {
    name: 'Prestige TV binges',
    movies: [],
    shows: ['The Bear', 'Shogun', 'Ripley', 'Slow Horses'],
  },
  {
    name: 'Weekend rewatches',
    movies: ['Barbie', 'Deadpool & Wolverine', 'Wicked'],
    shows: [],
  },
]
