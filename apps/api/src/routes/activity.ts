import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { and, asc, desc, eq, ilike, inArray, sql } from 'drizzle-orm'
import { alias, unionAll } from 'drizzle-orm/pg-core'
import {
  ACTIVITY_KINDS,
  type ActivityEntry,
  type ActivityKind,
  listActivityQuerySchema,
  listActivityResponseSchema,
  removeActivityRequestSchema,
} from '@rwnd/shared'
import type { Database } from '@rwnd/db'
import { droppedShows, episodes, movies, plays, ratings, shows, watchlistItems } from '@rwnd/db'
import type { AppEnv } from '../types.js'
import { requireAuth } from '../middleware/auth.js'
import { episodeDisplayTitle } from '../lib/media.js'
import { effectiveDroppedAtExpr, effectiveDroppedExpr, undropShow } from '../lib/dropped.js'

export const activityRoutes = new OpenAPIHono<AppEnv>()

// Reused by the rating/watchlist branches below, each of which needs `shows`
// joined twice in the same query — once directly (a rating/watchlist entry
// on a whole show) and once via an episode's showId (a rating/watchlist
// entry on one episode). Two distinct aliases of the same table, not two
// separate tables — Postgres (and drizzle) need them named apart to appear
// twice in one FROM clause.
const showViaEpisode = alias(shows, 'show_via_episode')

/**
 * Every branch below projects the exact same column set, wrapped in
 * `sql<T>` casts rather than selected as plain typed columns — required for
 * `unionAll` (drizzle-orm/pg-core) to accept all four as one set-compatible
 * result, and it also keeps every column's TS type identical across
 * branches regardless of which table (or CASE expression) actually produced
 * it. `occurredAt` needs `.mapWith` because a raw `sql` fragment doesn't get
 * postgres.js's automatic timestamptz→Date parsing the way a plain typed
 * column reference does (see the `lastWatchedAt` comment on GET
 * /library/shows, apps/api/src/routes/library.ts).
 *
 * `title`/`posterPath`/`showSlug` are always the *show's* (not the
 * episode's) for an episode entry — that's what a title filter and a
 * title sort should match against, the way a gallery tile reads.
 * `mediaType` and `episodeTitle` are what buildMedia() below uses to turn a
 * row back into the movie/show/episode shape the frontend already knows how
 * to render (playMediaSummarySchema, packages/shared/src/schemas/plays.ts).
 */
function watchBranch(db: Database, userId: string) {
  return db
    .select({
      id: sql<string>`${plays.id}`.as('id'),
      kind: sql<ActivityKind>`'watch'::text`.as('kind'),
      occurredAt: sql`${plays.watchedAt}`.mapWith((v: string) => new Date(v)).as('occurred_at'),
      mediaType: sql<
        'movie' | 'show' | 'episode'
      >`(case when ${movies.id} is not null then 'movie' else 'episode' end)::text`.as(
        'media_type',
      ),
      title: sql<string | null>`coalesce(${movies.title}, ${shows.title})`.as('title'),
      posterPath: sql<string | null>`coalesce(${movies.posterPath}, ${shows.posterPath})`.as(
        'poster_path',
      ),
      showSlug: sql<string | null>`${shows.slug}`.as('show_slug'),
      movieSlug: sql<string | null>`${movies.slug}`.as('movie_slug'),
      seasonNumber: sql<number | null>`${episodes.seasonNumber}`.as('season_number'),
      episodeNumber: sql<number | null>`${episodes.episodeNumber}`.as('episode_number'),
      episodeTitle: sql<string | null>`${episodes.title}`.as('episode_title'),
      source: sql<string | null>`${plays.source}::text`.as('source'),
      rating: sql<number | null>`null::smallint`.as('rating'),
      notes: sql<string | null>`null::text`.as('notes'),
    })
    .from(plays)
    .leftJoin(movies, eq(plays.movieId, movies.id))
    .leftJoin(episodes, eq(plays.episodeId, episodes.id))
    .leftJoin(shows, eq(episodes.showId, shows.id))
    .where(eq(plays.userId, userId))
}

function ratingBranch(db: Database, userId: string) {
  return db
    .select({
      id: sql<string>`${ratings.id}`.as('id'),
      kind: sql<ActivityKind>`'rating'::text`.as('kind'),
      occurredAt: sql`${ratings.ratedAt}`.mapWith((v: string) => new Date(v)).as('occurred_at'),
      mediaType: sql<'movie' | 'show' | 'episode'>`${ratings.entityType}::text`.as('media_type'),
      title: sql<
        string | null
      >`coalesce(${movies.title}, ${shows.title}, ${showViaEpisode.title})`.as('title'),
      posterPath: sql<
        string | null
      >`coalesce(${movies.posterPath}, ${shows.posterPath}, ${showViaEpisode.posterPath})`.as(
        'poster_path',
      ),
      showSlug: sql<string | null>`coalesce(${shows.slug}, ${showViaEpisode.slug})`.as('show_slug'),
      movieSlug: sql<string | null>`${movies.slug}`.as('movie_slug'),
      seasonNumber: sql<number | null>`${episodes.seasonNumber}`.as('season_number'),
      episodeNumber: sql<number | null>`${episodes.episodeNumber}`.as('episode_number'),
      episodeTitle: sql<string | null>`${episodes.title}`.as('episode_title'),
      source: sql<string | null>`null::text`.as('source'),
      rating: sql<number | null>`${ratings.rating}`.as('rating'),
      notes: sql<string | null>`null::text`.as('notes'),
    })
    .from(ratings)
    .leftJoin(movies, and(eq(ratings.entityType, 'movie'), eq(ratings.entityId, movies.id)))
    .leftJoin(shows, and(eq(ratings.entityType, 'show'), eq(ratings.entityId, shows.id)))
    .leftJoin(episodes, and(eq(ratings.entityType, 'episode'), eq(ratings.entityId, episodes.id)))
    .leftJoin(showViaEpisode, eq(episodes.showId, showViaEpisode.id))
    .where(eq(ratings.userId, userId))
}

function watchlistBranch(db: Database, userId: string) {
  return db
    .select({
      id: sql<string>`${watchlistItems.id}`.as('id'),
      kind: sql<ActivityKind>`'watchlist'::text`.as('kind'),
      occurredAt: sql`${watchlistItems.listedAt}`
        .mapWith((v: string) => new Date(v))
        .as('occurred_at'),
      mediaType: sql<'movie' | 'show' | 'episode'>`${watchlistItems.entityType}::text`.as(
        'media_type',
      ),
      title: sql<
        string | null
      >`coalesce(${movies.title}, ${shows.title}, ${showViaEpisode.title})`.as('title'),
      posterPath: sql<
        string | null
      >`coalesce(${movies.posterPath}, ${shows.posterPath}, ${showViaEpisode.posterPath})`.as(
        'poster_path',
      ),
      showSlug: sql<string | null>`coalesce(${shows.slug}, ${showViaEpisode.slug})`.as('show_slug'),
      movieSlug: sql<string | null>`${movies.slug}`.as('movie_slug'),
      seasonNumber: sql<number | null>`${episodes.seasonNumber}`.as('season_number'),
      episodeNumber: sql<number | null>`${episodes.episodeNumber}`.as('episode_number'),
      episodeTitle: sql<string | null>`${episodes.title}`.as('episode_title'),
      source: sql<string | null>`null::text`.as('source'),
      rating: sql<number | null>`null::smallint`.as('rating'),
      notes: sql<string | null>`${watchlistItems.notes}`.as('notes'),
    })
    .from(watchlistItems)
    .leftJoin(
      movies,
      and(eq(watchlistItems.entityType, 'movie'), eq(watchlistItems.entityId, movies.id)),
    )
    .leftJoin(
      shows,
      and(eq(watchlistItems.entityType, 'show'), eq(watchlistItems.entityId, shows.id)),
    )
    .leftJoin(
      episodes,
      and(eq(watchlistItems.entityType, 'episode'), eq(watchlistItems.entityId, episodes.id)),
    )
    .leftJoin(showViaEpisode, eq(episodes.showId, showViaEpisode.id))
    .where(eq(watchlistItems.userId, userId))
}

/**
 * Only "currently dropped" rows — see removeActivityRequestSchema's doc
 * comment (packages/shared/src/schemas/activity.ts) for why this feed shows
 * current state rather than a drop/undrop event log. Trusts that
 * effectiveDroppedExpr() = true always comes with a non-null
 * effectiveDroppedAtExpr() — true by construction of the manual/Trakt toggle
 * routes (apps/api/src/lib/dropped.ts), never sets one without the other.
 */
function droppedBranch(db: Database, userId: string) {
  return db
    .select({
      id: sql<string>`${droppedShows.id}`.as('id'),
      kind: sql<ActivityKind>`'dropped'::text`.as('kind'),
      occurredAt: effectiveDroppedAtExpr()
        .mapWith((v: string) => new Date(v))
        .as('occurred_at'),
      mediaType: sql<'movie' | 'show' | 'episode'>`'show'::text`.as('media_type'),
      title: sql<string | null>`${shows.title}`.as('title'),
      posterPath: sql<string | null>`${shows.posterPath}`.as('poster_path'),
      showSlug: sql<string | null>`${shows.slug}`.as('show_slug'),
      movieSlug: sql<string | null>`null::text`.as('movie_slug'),
      seasonNumber: sql<number | null>`null::int`.as('season_number'),
      episodeNumber: sql<number | null>`null::int`.as('episode_number'),
      episodeTitle: sql<string | null>`null::text`.as('episode_title'),
      source: sql<string | null>`null::text`.as('source'),
      rating: sql<number | null>`null::smallint`.as('rating'),
      notes: sql<string | null>`null::text`.as('notes'),
    })
    .from(droppedShows)
    .innerJoin(shows, eq(droppedShows.showId, shows.id))
    .where(and(eq(droppedShows.userId, userId), effectiveDroppedExpr()))
}

function buildMedia(row: {
  mediaType: 'movie' | 'show' | 'episode'
  title: string | null
  posterPath: string | null
  showSlug: string | null
  movieSlug: string | null
  seasonNumber: number | null
  episodeNumber: number | null
  episodeTitle: string | null
}): ActivityEntry['media'] {
  if (row.mediaType === 'movie') {
    return {
      type: 'movie',
      title: row.title ?? '',
      posterPath: row.posterPath,
      movieSlug: row.movieSlug ?? undefined,
    }
  }
  if (row.mediaType === 'show') {
    return {
      type: 'show',
      title: row.title ?? '',
      posterPath: row.posterPath,
      showSlug: row.showSlug ?? undefined,
    }
  }
  return {
    type: 'episode',
    title: episodeDisplayTitle(
      row.episodeTitle,
      row.seasonNumber ?? undefined,
      row.episodeNumber ?? undefined,
    ),
    posterPath: row.posterPath,
    showSlug: row.showSlug ?? undefined,
    showTitle: row.title ?? undefined,
    seasonNumber: row.seasonNumber ?? undefined,
    episodeNumber: row.episodeNumber ?? undefined,
  }
}

function parseKinds(raw: string | undefined): ActivityKind[] | undefined {
  if (!raw) return undefined
  const known = new Set<string>(ACTIVITY_KINDS)
  const kinds = raw.split(',').filter((k): k is ActivityKind => known.has(k))
  return kinds.length > 0 ? kinds : undefined
}

activityRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/activity-feed',
    summary: "List the current user's activity (watches, ratings, watchlist adds, drops)",
    middleware: [requireAuth] as const,
    request: { query: listActivityQuerySchema },
    responses: {
      200: {
        description: 'Activity',
        content: { 'application/json': { schema: listActivityResponseSchema } },
      },
    },
  }),
  async (c) => {
    const { offset, limit, q, kinds: kindsRaw, sort, after, before } = c.req.valid('query')
    const userId = c.get('user')!.id
    const db = c.get('db')
    const kinds = parseKinds(kindsRaw)

    const activity = db
      .$with('activity')
      .as(
        unionAll(
          watchBranch(db, userId),
          ratingBranch(db, userId),
          watchlistBranch(db, userId),
          droppedBranch(db, userId),
        ),
      )

    const filters = [
      q ? ilike(activity.title, `%${q}%`) : undefined,
      kinds ? inArray(activity.kind, kinds) : undefined,
      // Raw SQL rather than gte()/lte() with a JS `Date` — `occurredAt` is a
      // `sql<T>`-cast CTE column (see the comment above watchBranch()), so
      // it carries no column type info for drizzle/postgres.js to encode a
      // bound `Date` parameter against; that failed at the wire level
      // (postgres.js's bind step expects a string/Buffer, not a Date,
      // without that type info — found via a live 500 on dev.rwnd.tv).
      // `after`/`before` arrive as full ISO instants already resolved
      // against the browser's local day boundary (listActivityQuerySchema's
      // doc comment) — casting the string to `::timestamptz` in SQL text
      // sidesteps the parameter-encoding issue without any further
      // day-boundary math needed here.
      after ? sql`${activity.occurredAt} >= ${after}::timestamptz` : undefined,
      before ? sql`${activity.occurredAt} <= ${before}::timestamptz` : undefined,
    ].filter((f) => f !== undefined)

    const orderBy = {
      occurredDesc: [desc(activity.occurredAt), asc(activity.id)],
      occurredAsc: [asc(activity.occurredAt), asc(activity.id)],
      titleAsc: [asc(activity.title), desc(activity.occurredAt), asc(activity.id)],
      titleDesc: [desc(activity.title), desc(activity.occurredAt), asc(activity.id)],
    }[sort]

    const [rows, totalRows] = await Promise.all([
      db
        .with(activity)
        .select()
        .from(activity)
        .where(and(...filters))
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
      db
        .with(activity)
        .select({ total: sql<number>`count(*)`.mapWith(Number) })
        .from(activity)
        .where(and(...filters)),
    ])
    // count(*) with no GROUP BY always returns exactly one row.
    const total = totalRows[0]?.total ?? 0

    const entries: ActivityEntry[] = rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      occurredAt: row.occurredAt.toISOString(),
      media: buildMedia(row),
      source:
        row.kind === 'watch' ? ((row.source ?? undefined) as ActivityEntry['source']) : undefined,
      rating: row.kind === 'rating' ? (row.rating ?? undefined) : undefined,
      notes: row.kind === 'watchlist' ? row.notes : undefined,
    }))

    return c.json({ entries, total, hasMore: offset + entries.length < total })
  },
)

activityRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/activity-feed',
    summary: 'Remove one or more activity entries',
    middleware: [requireAuth] as const,
    request: { body: { content: { 'application/json': { schema: removeActivityRequestSchema } } } },
    responses: {
      204: { description: 'Removed' },
    },
  }),
  async (c) => {
    const { entries } = c.req.valid('json')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const idsByKind: Record<ActivityKind, string[]> = {
      watch: [],
      rating: [],
      watchlist: [],
      dropped: [],
    }
    for (const entry of entries) idsByKind[entry.kind].push(entry.id)

    // One transaction so a bulk selection spanning several kinds doesn't
    // end up half-removed if one statement fails — same reasoning as
    // POST /account/clear-data (apps/api/src/routes/account.ts). A stray id
    // (wrong owner, or already gone) is silently ignored rather than
    // erroring — same "re-scoped by userId in the WHERE clause" convention
    // as the bulk watch-removal routes in apps/api/src/routes/library.ts.
    await db.transaction(async (tx) => {
      if (idsByKind.watch.length > 0) {
        await tx
          .delete(plays)
          .where(and(eq(plays.userId, userId), inArray(plays.id, idsByKind.watch)))
      }
      if (idsByKind.rating.length > 0) {
        await tx
          .delete(ratings)
          .where(and(eq(ratings.userId, userId), inArray(ratings.id, idsByKind.rating)))
      }
      if (idsByKind.watchlist.length > 0) {
        await tx
          .delete(watchlistItems)
          .where(
            and(eq(watchlistItems.userId, userId), inArray(watchlistItems.id, idsByKind.watchlist)),
          )
      }
      if (idsByKind.dropped.length > 0) {
        const droppedRows = await tx
          .select({ showId: droppedShows.showId })
          .from(droppedShows)
          .where(and(eq(droppedShows.userId, userId), inArray(droppedShows.id, idsByKind.dropped)))
        for (const row of droppedRows) await undropShow(tx, userId, row.showId)
      }
    })

    return c.body(null, 204)
  },
)
