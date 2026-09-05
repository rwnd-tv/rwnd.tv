import { and, desc, eq, gt, max } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import { movies, plays, watchlistItems, watchlists } from '@rwnd/db'

/**
 * "Which movies does this user follow" — the Movies calendar feed's
 * counterpart to followed-shows.ts's `getFollowedShows`, minus the
 * dropped-show concept (dropping is shows-only; there is no
 * droppedMovies table).
 */

/** Mirrors FOLLOWED_SHOW_WINDOW_DAYS (followed-shows.ts). */
const FOLLOWED_MOVIE_WINDOW_DAYS = 30

export interface FollowedMovie {
  id: string
  slug: string
  title: string
  year: number | null
  posterPath: string | null
}

export interface FollowedMovieOptions {
  /** Default FOLLOWED_MOVIE_WINDOW_DAYS. Pass `null` to drop the recency
   * window entirely — any movie with a play at all counts as "recently
   * watched", no matter how long ago. Only meaningful for
   * getRecentlyWatchedMovies/getFollowedMovies — getWatchlistedMovies has
   * no recency window by design (a watchlist entry is a standing "I care
   * about this"). */
  windowDays?: number | null
}

/**
 * Movies the current user watched within the window. No CTE needed here,
 * unlike getRecentlyWatchedShows: that one binds its cutoff against a
 * raw-SQL-derived CTE column (`::timestamptz` gotcha, see its own
 * comment) — this is a direct join against `plays.watchedAt`, a real
 * typed column, so no such cast is needed and none should be "restored"
 * here by analogy.
 *
 * Deliberately does NOT exclude the 1900-01-01 "unknown date" Trakt
 * sentinel the way getRecentlyWatchedShows unconditionally does — a
 * small, intentional divergence. With a real cutoff the sentinel can
 * never pass anyway (1900 is always older than "N days ago"), and with
 * `windowDays: null` ("include every movie I've ever watched"), excluding
 * it would contradict that setting for a Trakt-imported movie with no
 * known watch date. Worth aligning the shows helper the same way in a
 * follow-up, not fixed here.
 */
async function getRecentlyWatchedMovies(
  db: Database,
  userId: string,
  opts: FollowedMovieOptions = {},
): Promise<FollowedMovie[]> {
  const windowDays = opts.windowDays === undefined ? FOLLOWED_MOVIE_WINDOW_DAYS : opts.windowDays
  const cutoff =
    windowDays === null ? null : new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)

  return db
    .select({
      id: movies.id,
      slug: movies.slug,
      title: movies.title,
      year: movies.year,
      posterPath: movies.posterPath,
    })
    .from(plays)
    .innerJoin(movies, eq(movies.id, plays.movieId))
    .where(and(eq(plays.userId, userId), cutoff ? gt(plays.watchedAt, cutoff) : undefined))
    .groupBy(movies.id)
    .orderBy(desc(max(plays.watchedAt)))
}

/**
 * Movies on any of the current user's watchlists — the second candidate
 * source `getFollowedMovies` below merges in, so a watchlisted movie
 * still counts as followed with no watch history at all. Not exported:
 * `getFollowedMovies` is the only caller the calendar feed needs. Not
 * restricted to any recency window — a watchlist entry is an explicit,
 * standing "I care about this".
 */
async function getWatchlistedMovies(db: Database, userId: string): Promise<FollowedMovie[]> {
  return db
    .selectDistinct({
      id: movies.id,
      slug: movies.slug,
      title: movies.title,
      year: movies.year,
      posterPath: movies.posterPath,
    })
    .from(watchlistItems)
    .innerJoin(watchlists, eq(watchlistItems.watchlistId, watchlists.id))
    .innerJoin(movies, eq(watchlistItems.entityId, movies.id))
    .where(and(eq(watchlists.userId, userId), eq(watchlistItems.entityType, 'movie')))
}

/**
 * Union of the two sources above, deduped by movie id — a movie can be
 * both recently watched and watchlisted at once, and shouldn't count
 * twice.
 */
export async function getFollowedMovies(
  db: Database,
  userId: string,
  opts: FollowedMovieOptions = {},
): Promise<FollowedMovie[]> {
  const recentlyWatched = await getRecentlyWatchedMovies(db, userId, opts)
  const watchlisted = await getWatchlistedMovies(db, userId)
  const recentlyWatchedIds = new Set(recentlyWatched.map((movie) => movie.id))
  return [...recentlyWatched, ...watchlisted.filter((movie) => !recentlyWatchedIds.has(movie.id))]
}
