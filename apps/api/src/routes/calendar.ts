import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { and, eq } from 'drizzle-orm'
import {
  calendarFeedSchema,
  calendarFeedTypeSchema,
  createCalendarFeedRequestSchema,
  listCalendarFeedsResponseSchema,
  updateCalendarFeedRequestSchema,
} from '@rwnd/shared'
import { calendarFeeds } from '@rwnd/db'
import type { AppEnv } from '../types.js'
import { loadEnv } from '../env.js'
import { rateLimit } from '../middleware/rate-limit.js'
import {
  generateCalendarToken,
  resolveCalendarFeed,
  serializeCalendarFeed,
} from '../lib/calendar-feeds.js'
import { buildCalendarEvents } from '../calendar/build.js'
import { buildIcs } from '../lib/ics.js'
import { logSecurityEvent } from '../lib/security-log.js'

export const calendarRoutes = new OpenAPIHono<AppEnv>()

const CALENDAR_NAMES: Record<z.infer<typeof calendarFeedTypeSchema>, string> = {
  history: 'rwnd.tv — History',
  shows: 'rwnd.tv — TV Shows',
  movies: 'rwnd.tv — Movies',
}
const CALENDAR_FILENAMES: Record<z.infer<typeof calendarFeedTypeSchema>, string> = {
  history: 'rwnd-tv-history.ics',
  shows: 'rwnd-tv-tv-shows.ics',
  movies: 'rwnd-tv-movies.ics',
}

// Keyed on the URL token, not IP, for the same reason the Plex webhook
// is (routes/webhooks.ts): this is one person's own recurring poll from
// however many devices and networks they own, so IP isn't the
// meaningful dimension. 120/hour covers roughly 10 devices at Apple
// Calendar's most aggressive user-selectable 5-minute refresh — well
// past any realistic household. A bogus token gets its own harmless
// bucket, same as a real one.
const calendarFeedRateLimit = rateLimit({
  name: 'calendar:feed',
  limit: 120,
  windowMs: 60 * 60 * 1000,
  key: (c) => c.req.param('token') ?? 'unknown',
})

/**
 * A calendar app subscribing to a webcal/iCal URL has no way to attach a
 * custom auth header — same constraint, same solution as the Plex
 * webhook (routes/webhooks.ts): the bearer secret is a URL path segment,
 * and this is a plain route rather than `.openapi()` for the same
 * reason that one is (not part of the JSON API contract the frontend
 * consumes; its body is text/calendar, not JSON).
 *
 * `Cache-Control: no-store` (app.ts's own blanket header) is
 * deliberately left in place, not overridden: the body is one user's
 * private watch history behind a URL-embedded secret, and a subscribing
 * client schedules its own refresh interval regardless of cache
 * headers, so keeping shared caches and the browser bfcache out of it
 * costs nothing.
 */
calendarRoutes.get('/calendar/:token/feed.ics', calendarFeedRateLimit, async (c) => {
  const db = c.get('db')
  const resolved = await resolveCalendarFeed(db, c.req.param('token'))
  // 401, matching the Plex webhook's convention — a bearer credential
  // failed, which is what 401 means, and a revoked/regenerated token is
  // indistinguishable from a fabricated one by design.
  if (!resolved) return c.json({ error: 'Invalid token' }, 401)

  // Only when configured — this project deliberately never guesses its
  // own public URL from a request's Host header behind an arbitrary
  // reverse proxy (see APP_URL's own doc comment, env.ts); an event
  // simply gets no link on an instance that hasn't set it.
  const baseUrl = loadEnv().APP_URL || undefined
  const events = await buildCalendarEvents(db, resolved.user, resolved.feed, baseUrl)
  const body = buildIcs({ name: CALENDAR_NAMES[resolved.feed.feedType], events })

  c.header('Content-Type', 'text/calendar; charset=utf-8')
  c.header(
    'Content-Disposition',
    `inline; filename="${CALENDAR_FILENAMES[resolved.feed.feedType]}"`,
  )
  return c.body(body)
})

const feedTypeParamSchema = z.object({ feedType: calendarFeedTypeSchema })

calendarRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/calendar-feeds',
    summary: "List the current user's calendar feeds",
    responses: {
      200: {
        description: 'Calendar feeds (0-3 entries)',
        content: { 'application/json': { schema: listCalendarFeedsResponseSchema } },
      },
    },
  }),
  async (c) => {
    const env = loadEnv()
    // No ENCRYPTION_KEY, no calendar feeds — see calendarFeedsAvailable's
    // doc comment (packages/shared/src/schemas/settings.ts). A feed row
    // could in principle still exist from before the key was removed,
    // but there'd be no way to decrypt it for display, so it's treated
    // the same as if it didn't exist rather than 500ing on decrypt.
    if (!env.ENCRYPTION_KEY) return c.json({ feeds: [] })

    const rows = await c
      .get('db')
      .select()
      .from(calendarFeeds)
      .where(eq(calendarFeeds.userId, c.get('user')!.id))
    return c.json({ feeds: rows.map((row) => serializeCalendarFeed(row, env.ENCRYPTION_KEY!)) })
  },
)

calendarRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/calendar-feeds',
    summary: 'Create a calendar feed',
    request: {
      body: { content: { 'application/json': { schema: createCalendarFeedRequestSchema } } },
    },
    responses: {
      201: {
        description: 'Feed created',
        content: { 'application/json': { schema: calendarFeedSchema } },
      },
      409: { description: 'A feed of this type already exists' },
      503: { description: 'ENCRYPTION_KEY is not configured on this instance' },
    },
  }),
  async (c) => {
    const env = loadEnv()
    if (!env.ENCRYPTION_KEY) {
      return c.json(
        { error: 'Calendar feeds require ENCRYPTION_KEY to be configured on this instance' },
        503,
      )
    }

    const { feedType } = c.req.valid('json')
    const db = c.get('db')
    const userId = c.get('user')!.id
    const { hash, encrypted } = generateCalendarToken(env.ENCRYPTION_KEY)

    const [row] = await db
      .insert(calendarFeeds)
      .values({ userId, feedType, tokenHash: hash, tokenEncrypted: encrypted })
      .onConflictDoNothing({ target: [calendarFeeds.userId, calendarFeeds.feedType] })
      .returning()
    if (!row) return c.json({ error: 'A feed of this type already exists' }, 409)

    return c.json(serializeCalendarFeed(row, env.ENCRYPTION_KEY), 201)
  },
)

calendarRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/calendar-feeds/{feedType}',
    summary: "Update a calendar feed's settings",
    request: {
      params: feedTypeParamSchema,
      body: { content: { 'application/json': { schema: updateCalendarFeedRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Feed updated',
        content: { 'application/json': { schema: calendarFeedSchema } },
      },
      404: { description: 'Feed not found' },
      503: { description: 'ENCRYPTION_KEY is not configured on this instance' },
    },
  }),
  async (c) => {
    const env = loadEnv()
    if (!env.ENCRYPTION_KEY) {
      return c.json(
        { error: 'Calendar feeds require ENCRYPTION_KEY to be configured on this instance' },
        503,
      )
    }

    const { feedType } = c.req.valid('param')
    const patch = c.req.valid('json')
    const db = c.get('db')
    const userId = c.get('user')!.id

    // Only the keys applicable to this feed's own type ever get written —
    // updateCalendarFeedRequestSchema deliberately accepts every feed
    // type's keys so a caller doesn't need to know which apply, but
    // writing an inapplicable one would be silently meaningless at best.
    // An exhaustive switch, not a ternary — see serializeCalendarFeed's
    // own comment on why, with three feed types now.
    const set = (() => {
      switch (feedType) {
        case 'history':
          return { includeMovies: patch.includeMovies, includeShows: patch.includeShows }
        case 'shows':
          return {
            includeDropped: patch.includeDropped,
            futureOnly: patch.futureOnly,
            includeAllWatched: patch.includeAllWatched,
          }
        case 'movies':
          return { futureOnly: patch.futureOnly, includeAllWatched: patch.includeAllWatched }
      }
    })()

    const where = and(eq(calendarFeeds.userId, userId), eq(calendarFeeds.feedType, feedType))
    // Every applicable key came through as `undefined` (a body of only
    // inapplicable keys, which updateCalendarFeedRequestSchema's own doc
    // comment promises is a no-op) — Drizzle's `.set()` filters undefined
    // values, and an update left with nothing to set emits `update ...
    // set  where ...`, a genuine SQL syntax error at execution time
    // rather than a no-op. Skip the write and just re-select instead.
    const hasChange = Object.values(set).some((value) => value !== undefined)
    const [row] = hasChange
      ? await db.update(calendarFeeds).set(set).where(where).returning()
      : await db.select().from(calendarFeeds).where(where).limit(1)
    if (!row) return c.json({ error: 'Feed not found' }, 404)

    return c.json(serializeCalendarFeed(row, env.ENCRYPTION_KEY))
  },
)

calendarRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/calendar-feeds/{feedType}/regenerate',
    summary: "Rotate a calendar feed's subscription URL",
    request: { params: feedTypeParamSchema },
    responses: {
      200: {
        description: 'Feed regenerated — the previous URL stops working',
        content: { 'application/json': { schema: calendarFeedSchema } },
      },
      404: { description: 'Feed not found' },
      503: { description: 'ENCRYPTION_KEY is not configured on this instance' },
    },
  }),
  async (c) => {
    const env = loadEnv()
    if (!env.ENCRYPTION_KEY) {
      return c.json(
        { error: 'Calendar feeds require ENCRYPTION_KEY to be configured on this instance' },
        503,
      )
    }

    const { feedType } = c.req.valid('param')
    const db = c.get('db')
    const userId = c.get('user')!.id
    const { hash, encrypted } = generateCalendarToken(env.ENCRYPTION_KEY)

    // Updates the token columns in place, not delete-then-recreate (the
    // webhook link-code precedent, routes/tokens.ts) — that shape exists
    // there to supersede a one-shot code; here "at most one live" is
    // already guaranteed by tokenHash being a single column, and
    // settings/createdAt must survive a regenerate. lastAccessedAt is
    // reset: the new URL genuinely hasn't synced to anything yet.
    const [row] = await db
      .update(calendarFeeds)
      .set({ tokenHash: hash, tokenEncrypted: encrypted, lastAccessedAt: null })
      .where(and(eq(calendarFeeds.userId, userId), eq(calendarFeeds.feedType, feedType)))
      .returning()
    if (!row) return c.json({ error: 'Feed not found' }, 404)

    logSecurityEvent('calendar_feed_regenerated', { userId, feedType })
    return c.json(serializeCalendarFeed(row, env.ENCRYPTION_KEY))
  },
)

calendarRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/calendar-feeds/{feedType}',
    summary: 'Delete a calendar feed',
    request: { params: feedTypeParamSchema },
    responses: {
      204: { description: 'Deleted' },
      404: { description: 'Feed not found' },
    },
  }),
  async (c) => {
    const { feedType } = c.req.valid('param')
    const userId = c.get('user')!.id
    const result = await c
      .get('db')
      .delete(calendarFeeds)
      .where(and(eq(calendarFeeds.userId, userId), eq(calendarFeeds.feedType, feedType)))
      .returning({ id: calendarFeeds.id })
    if (result.length === 0) return c.json({ error: 'Feed not found' }, 404)
    return c.body(null, 204)
  },
)
