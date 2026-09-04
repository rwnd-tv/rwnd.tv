import { and, desc, eq, sql } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import { droppedShows, episodes, plays, shows, watchlistItems, watchlists } from '@rwnd/db'
import { effectiveDroppedExpr } from './dropped.js'
import { watchedRangeFragments } from '../routes/library/shared.js'

/**
 * "Which shows does this user follow" — the candidate rules the
 * Dashboard's On Deck/Up Next rows established
 * (apps/api/src/routes/library/queue.ts, which these were extracted
 * from) and which the calendar feeds now share
 * (apps/api/src/calendar/build.ts). Deliberately stops short of
 * resolving each show to a metadata provider: queue.ts needs that (it
 * does a live per-show provider fetch to find the next episode), the
 * calendar feed must NOT (it only ever reads local `episodes` rows, and
 * dropping a show with no recorded provider id — which
 * pickRefreshTargets does — would silently omit it from a calendar for
 * no reason). See queue.ts's own `hydrateProviderTargets` for the other
 * half of what used to be one function here.
 */

/** How far back a play counts toward "recently watched" (was queue.ts's
 * DASHBOARD_ROW_WINDOW_DAYS). `FollowedShowOptions.windowDays` exists as
 * a parameter rather than every caller hardcoding this default, since
 * the calendar feed plausibly wants a wider window later (see
 * docs/TODO.md) without a second refactor. */
const FOLLOWED_SHOW_WINDOW_DAYS = 30

export interface FollowedShow {
  id: string
  slug: string
  title: string
  posterPath: string | null
  /** Highest non-special season number this user has a watch in — where
   * to start scanning forward from. Null if every recent watch was a
   * special, or (for a watchlisted-only candidate) there's no watch at
   * all. */
  maxWatchedSeason: number | null
  /** Highest episode number watched within `maxWatchedSeason`. Only
   * On Deck (queue.ts) uses this. Null exactly when maxWatchedSeason is
   * null. */
  maxWatchedEpisodeInMaxSeason: number | null
}

export interface FollowedShowOptions {
  /** Default false — a dropped show isn't followed. */
  includeDropped?: boolean
  /** Default FOLLOWED_SHOW_WINDOW_DAYS. Pass `null` to drop the recency
   * window entirely — any show with a play at all counts as "recently
   * watched", no matter how long ago. Only meaningful for
   * getRecentlyWatchedShows/getFollowedShows — getWatchlistedShows has
   * no recency window by design (a watchlist entry is a standing "I
   * care about this"). */
  windowDays?: number | null
}

/**
 * Shows the current user watched within the window, not dropped (unless
 * `includeDropped`). Shared by On Deck, Up Next, and the History-
 * adjacent TV Shows calendar feed — all three start from the same "what
 * has this person been watching lately" set.
 */
export async function getRecentlyWatchedShows(
  db: Database,
  userId: string,
  opts: FollowedShowOptions = {},
): Promise<FollowedShow[]> {
  const windowDays = opts.windowDays === undefined ? FOLLOWED_SHOW_WINDOW_DAYS : opts.windowDays
  const cutoff =
    windowDays === null ? null : new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)

  // A play dated exactly 1900-01-01 is Trakt's "I don't remember when"
  // backfill sentinel (see showDetailSchema's doc comment), not real
  // recent activity — excluded from both aggregates the same way the
  // show page's own watchedRange query excludes it (watchedRangeFragments,
  // routes/library/shared.ts).
  const recentWatch = db.$with('recent_watch').as(
    db
      .select({
        showId: episodes.showId,
        lastWatchedAt: watchedRangeFragments.lastWatchedAt
          .mapWith((v: string) => new Date(v))
          .as('last_watched_at'),
        maxWatchedSeason: sql<
          number | null
        >`max(case when ${episodes.seasonNumber} > 0 then ${episodes.seasonNumber} end)`.as(
          'max_watched_season',
        ),
      })
      .from(plays)
      .innerJoin(episodes, eq(plays.episodeId, episodes.id))
      .where(eq(plays.userId, userId))
      .groupBy(episodes.showId),
  )

  // Per (show, season), the highest episode number this user has watched —
  // joined below against recentWatch.maxWatchedSeason to get "the latest
  // episode watched, in air order" without a nested aggregate (Postgres
  // doesn't allow one aggregate's result to feed another within the same
  // GROUP BY).
  const watchedEpisodesBySeason = db.$with('watched_episodes_by_season').as(
    db
      .select({
        showId: episodes.showId,
        seasonNumber: episodes.seasonNumber,
        maxWatchedEpisode: sql<number>`max(${episodes.episodeNumber})`.as('max_watched_episode'),
      })
      .from(plays)
      .innerJoin(episodes, eq(plays.episodeId, episodes.id))
      .where(eq(plays.userId, userId))
      .groupBy(episodes.showId, episodes.seasonNumber),
  )

  return (
    db
      .with(recentWatch, watchedEpisodesBySeason)
      .select({
        id: shows.id,
        slug: shows.slug,
        title: shows.title,
        posterPath: shows.posterPath,
        maxWatchedSeason: recentWatch.maxWatchedSeason,
        maxWatchedEpisodeInMaxSeason: watchedEpisodesBySeason.maxWatchedEpisode,
      })
      .from(recentWatch)
      .innerJoin(shows, eq(shows.id, recentWatch.showId))
      .leftJoin(
        droppedShows,
        and(eq(droppedShows.showId, shows.id), eq(droppedShows.userId, userId)),
      )
      // Left, not inner — recentWatch.maxWatchedSeason is null whenever every
      // recent watch was a special, and NULL never equality-matches NULL in
      // SQL, so this naturally yields no row (maxWatchedEpisodeInMaxSeason
      // stays null) exactly when there's nothing meaningful to report.
      .leftJoin(
        watchedEpisodesBySeason,
        and(
          eq(watchedEpisodesBySeason.showId, recentWatch.showId),
          eq(watchedEpisodesBySeason.seasonNumber, recentWatch.maxWatchedSeason),
        ),
      )
      .where(
        and(
          // A bare Date doesn't survive being bound as a parameter against a
          // raw-sql-derived CTE column the way it does against a real typed
          // column (postgres.js has no type hint to serialize it by) — needs
          // `.toISOString()` plus an explicit cast, same gotcha as the
          // dropped-show CASE expression in shows.ts's dropped-toggle route.
          // Omitted entirely (not just a very early cutoff) when the caller
          // passed `windowDays: null` — every recently-watched show, no
          // matter when, should count.
          cutoff
            ? sql`${recentWatch.lastWatchedAt} > ${cutoff.toISOString()}::timestamptz`
            : undefined,
          // LEFT JOIN + coalesce, not an anti-join: a show with no
          // droppedShows row at all is not dropped, and effectiveDroppedExpr
          // already encodes that (coalesce(manual, trakt, false)).
          opts.includeDropped ? undefined : sql`not ${effectiveDroppedExpr()}`,
        ),
      )
      .orderBy(desc(recentWatch.lastWatchedAt))
  )
}

/**
 * Shows on any of the current user's watchlists, not dropped (unless
 * `includeDropped`) — the second candidate source `getFollowedShows`
 * below merges in, so a watchlisted show still counts as followed even
 * with no recent (or any) watch history. Not exported: `getFollowedShows`
 * is the only caller either the Up Next route or a calendar feed
 * actually needs. `maxWatchedSeason`/`maxWatchedEpisodeInMaxSeason` are
 * always null here (unlike a recently-watched candidate, there's no
 * "where the viewer got to" to start from). Not restricted to any
 * recency window — a watchlist entry is an explicit, standing "I care
 * about this", not something that should fall out after N days.
 */
async function getWatchlistedShows(
  db: Database,
  userId: string,
  opts: Pick<FollowedShowOptions, 'includeDropped'> = {},
): Promise<FollowedShow[]> {
  return db
    .selectDistinct({
      id: shows.id,
      slug: shows.slug,
      title: shows.title,
      posterPath: shows.posterPath,
      maxWatchedSeason: sql<number | null>`null`,
      maxWatchedEpisodeInMaxSeason: sql<number | null>`null`,
    })
    .from(watchlistItems)
    .innerJoin(watchlists, eq(watchlistItems.watchlistId, watchlists.id))
    .innerJoin(shows, eq(watchlistItems.entityId, shows.id))
    .leftJoin(droppedShows, and(eq(droppedShows.showId, shows.id), eq(droppedShows.userId, userId)))
    .where(
      and(
        eq(watchlists.userId, userId),
        eq(watchlistItems.entityType, 'show'),
        opts.includeDropped ? undefined : sql`not ${effectiveDroppedExpr()}`,
      ),
    )
}

/**
 * Union of the two sources above, deduped by show id — a show can be
 * both recently watched and watchlisted at once, and shouldn't count
 * twice. Recently-watched wins on a tie: it carries a real
 * maxWatchedSeason, where a watchlisted-only candidate's is always
 * null, and that lets a caller's episode scan start further forward.
 */
export async function getFollowedShows(
  db: Database,
  userId: string,
  opts: FollowedShowOptions = {},
): Promise<FollowedShow[]> {
  const recentlyWatched = await getRecentlyWatchedShows(db, userId, opts)
  const watchlisted = await getWatchlistedShows(db, userId, opts)
  const recentlyWatchedIds = new Set(recentlyWatched.map((show) => show.id))
  return [...recentlyWatched, ...watchlisted.filter((show) => !recentlyWatchedIds.has(show.id))]
}
