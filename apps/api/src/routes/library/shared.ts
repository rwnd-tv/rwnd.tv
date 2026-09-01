import { and, eq, inArray, sql } from 'drizzle-orm'
import { UNKNOWN_WATCHED_AT } from '@rwnd/shared'
import type { Database } from '@rwnd/db'
import { episodes, externalIds, movies, plays, shows, watchlistItems } from '@rwnd/db'
import type { ResolvedEpisode } from '../../lib/media.js'

/** Looks up a show by slug — the "does this show exist, and what's its
 * current row" check every show-scoped route needs before doing anything
 * else. Returns the full row (not just `id`) since a couple of callers
 * (the show detail route) need it and a single indexed-slug lookup is cheap
 * enough that there's no real cost to callers that only want `.id`. */
export async function getShowBySlug(db: Database, slug: string) {
  const [show] = await db.select().from(shows).where(eq(shows.slug, slug)).limit(1)
  return show
}

/** Movie counterpart of getShowBySlug above. */
export async function getMovieBySlug(db: Database, slug: string) {
  const [movie] = await db.select().from(movies).where(eq(movies.slug, slug)).limit(1)
  return movie
}

/** Looks up the local row for one specific episode (show id + season +
 * episode number) — the "does a local row already exist for this episode"
 * check, distinct from resolveEpisode (lib/media.ts), which creates the row
 * if it doesn't exist yet. Returns just the id, which is all every caller
 * needs. */
export async function getEpisodeIdByNumbers(
  db: Database,
  showId: string,
  seasonNumber: number,
  episodeNumber: number,
) {
  const [episode] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(
      and(
        eq(episodes.showId, showId),
        eq(episodes.seasonNumber, seasonNumber),
        eq(episodes.episodeNumber, episodeNumber),
      ),
    )
    .limit(1)
  return episode?.id
}

/** Looks up one provider's external id for a show/movie/episode — backs
 * the TMDB/TVDB/IMDb deep links on the show/movie/season/episode detail
 * pages. An entity can have any subset of these ids on record, or none. */
export async function getExternalId(
  db: Database,
  entityType: 'show' | 'movie' | 'episode',
  entityId: string,
  source: 'tmdb' | 'tvdb' | 'imdb',
) {
  const [row] = await db
    .select({ externalId: externalIds.externalId })
    .from(externalIds)
    .where(
      and(
        eq(externalIds.entityType, entityType),
        eq(externalIds.entityId, entityId),
        eq(externalIds.source, source),
      ),
    )
    .limit(1)
  return row?.externalId
}

/** Adds a show/movie to one of the current user's watchlists — the DB
 * write shared by PUT .../watchlists/{watchlistId} in shows.ts/movies.ts.
 * `onConflictDoNothing` (not `onConflictDoUpdate`, unlike the rating
 * routes): there's no field to update on a repeat add — `listedAt`
 * deliberately keeps the original add time, not the most recent one.
 * Callers still do their own `getOwnedWatchlist` check and
 * `getMyWatchlistIds` response — those need a route-specific 404 message,
 * so only the write itself lives here. */
export async function addToWatchlist(
  db: Database,
  userId: string,
  watchlistId: string,
  entityType: 'show' | 'movie',
  entityId: string,
) {
  await db
    .insert(watchlistItems)
    .values({ userId, watchlistId, entityType, entityId, listedAt: new Date() })
    .onConflictDoNothing({
      target: [watchlistItems.watchlistId, watchlistItems.entityType, watchlistItems.entityId],
    })
}

/** Removes a show/movie from one of the current user's watchlists — the DB
 * write shared by DELETE .../watchlists/{watchlistId} in
 * shows.ts/movies.ts. A no-op (nothing to delete) if it wasn't on the list,
 * same convention as DELETE .../rating. Not scoped by `userId` in the
 * `WHERE` — ownership of `watchlistId` is enforced by the caller's
 * `getOwnedWatchlist` check first, same as the pre-extraction code. */
export async function removeFromWatchlist(
  db: Database,
  watchlistId: string,
  entityType: 'show' | 'movie',
  entityId: string,
) {
  await db
    .delete(watchlistItems)
    .where(
      and(
        eq(watchlistItems.watchlistId, watchlistId),
        eq(watchlistItems.entityType, entityType),
        eq(watchlistItems.entityId, entityId),
      ),
    )
}

/** The three `sql` fragments behind `watchedRange` in shows.ts's/movies.ts's
 * GET detail routes — excludes Trakt's 1900-01-01 "I don't remember when"
 * backfill sentinel (see showDetailSchema's doc comment) from both the
 * first/last-watched aggregates and reports whether it was ever seen at
 * all, via `hasUnknownWatchDate`. Drizzle `sql` fragments are portable
 * objects, not tied to one query, so this can be spread into a `.select()`
 * alongside whatever else that query needs (movies.ts also wants a
 * `watchedCount`; shows.ts doesn't). */
export const watchedRangeFragments = {
  firstWatchedAt: sql<
    string | null
  >`min(${plays.watchedAt}) FILTER (WHERE extract(year from ${plays.watchedAt}) <> 1900)`,
  lastWatchedAt: sql<
    string | null
  >`max(${plays.watchedAt}) FILTER (WHERE extract(year from ${plays.watchedAt}) <> 1900)`,
  hasUnknownWatchDate: sql<boolean>`coalesce(bool_or(extract(year from ${plays.watchedAt}) = 1900), false)`,
}

/**
 * Shared by the show- and season-level "Watched" button routes (shows.ts,
 * seasons.ts). `resolvedEpisodes` is every episode in scope (already
 * resolved to local rows) — this excludes ones that haven't aired yet
 * (unknown or future `firstAired` — never guess a watch for an episode that
 * isn't out) and, unless `body.additional` is set, ones the user has already
 * watched too (the default "fill in what's missing" mode). `additional`
 * skips that second filter — every aired episode gets a new play regardless
 * of current watched state, which is what the "log an additional watch"
 * button (ShowDetailPage.tsx/SeasonDetailPage.tsx) needs for a rewatch.
 * Either way, the new plays land at the same `watchedAt`, or (when
 * `useReleaseDate` is set) each at its own episode's release date. When
 * `watchedAt` is exactly the "unknown date" sentinel (UNKNOWN_WATCHED_AT),
 * an episode that already has an unknown-date watch is excluded too —
 * regardless of `additional` — since a second one would be indistinguishable
 * from the first and add nothing (see plays.ts's POST /plays, which
 * enforces the same rule for the single-episode flow). Returns how many
 * plays were actually logged.
 */
export async function logMissingWatches(
  db: Database,
  userId: string,
  resolvedEpisodes: ResolvedEpisode[],
  body: { watchedAt?: string; useReleaseDate?: true; additional?: true },
): Promise<number> {
  if (resolvedEpisodes.length === 0) return 0

  const episodeIds = resolvedEpisodes.map((e) => e.id)
  const alreadyWatched = body.additional
    ? new Set<string>()
    : new Set(
        (
          await db
            .select({ episodeId: plays.episodeId })
            .from(plays)
            .where(and(eq(plays.userId, userId), inArray(plays.episodeId, episodeIds)))
        ).map((row) => row.episodeId),
      )

  const alreadyHasUnknownWatch =
    body.watchedAt === UNKNOWN_WATCHED_AT
      ? new Set(
          (
            await db
              .select({ episodeId: plays.episodeId })
              .from(plays)
              .where(
                and(
                  eq(plays.userId, userId),
                  inArray(plays.episodeId, episodeIds),
                  eq(plays.watchedAt, new Date(UNKNOWN_WATCHED_AT)),
                ),
              )
          ).map((row) => row.episodeId),
        )
      : new Set<string>()

  const now = new Date()
  const targets = resolvedEpisodes.filter(
    (e): e is ResolvedEpisode & { firstAired: string } =>
      !alreadyWatched.has(e.id) &&
      !alreadyHasUnknownWatch.has(e.id) &&
      e.firstAired !== null &&
      new Date(e.firstAired) <= now,
  )

  const values = targets.map((e) => ({
    userId,
    episodeId: e.id,
    watchedAt: body.useReleaseDate ? new Date(e.firstAired) : new Date(body.watchedAt!),
    source: 'manual' as const,
  }))

  if (values.length > 0) await db.insert(plays).values(values)
  return values.length
}
