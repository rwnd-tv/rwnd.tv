import { z } from 'zod'
import { playMediaSummarySchema } from './plays.js'
import { playSourceSchema, ratingValueSchema, uuidSchema } from './common.js'

/**
 * The four kinds of user action the Activity page (formerly just "History",
 * apps/web/src/routes/HistoryPage.tsx) surfaces in one merged, chronological
 * feed — see GET /activity-feed (apps/api/src/routes/activity.ts). `dropped`
 * shows only "currently dropped" entries, not a log of every drop/undrop —
 * the underlying `droppedShows` row (like `ratings`/`watchlistItems`) is
 * overwritten in place rather than versioned, so there's nothing to show a
 * history of past states from.
 */
export const ACTIVITY_KINDS = ['watch', 'rating', 'watchlist', 'dropped'] as const
export const activityKindSchema = z.enum(ACTIVITY_KINDS)
export type ActivityKind = z.infer<typeof activityKindSchema>

export const ACTIVITY_SORT_KEYS = ['occurredDesc', 'occurredAsc', 'titleAsc', 'titleDesc'] as const
export const activitySortSchema = z.enum(ACTIVITY_SORT_KEYS)
export type ActivitySort = z.infer<typeof activitySortSchema>

/**
 * One normalised row of the merged feed, regardless of which table it came
 * from — `id` is the underlying row's own id (a play/rating/watchlist-item/
 * dropped-show uuid), scoped by `kind` so ids from different tables never
 * collide in the UI (see the `${kind}:${id}` selection key on HistoryPage.tsx).
 * `source`/`rating`/`notes` are only ever present for their one matching
 * `kind` — a discriminated union would be more precise, but the API and the
 * frontend both treat these as one flat entry shape (one tile component),
 * so the looser optional-field shape here matches how it's actually used.
 */
export const activityEntrySchema = z.object({
  id: uuidSchema,
  kind: activityKindSchema,
  occurredAt: z.string().datetime(),
  media: playMediaSummarySchema,
  /** `watch` only. */
  source: playSourceSchema.optional(),
  /** `rating` only, 1-10. */
  rating: ratingValueSchema.optional(),
  /** `watchlist` only — only ever populated by the CSV importer today. */
  notes: z.string().nullable().optional(),
  /** `watchlist` only — which of the user's watchlists this add landed on
   * (e.g. "Default", "Cool Sci-fi Stuff!"). Named lists shipped after
   * `watchlist_items` did (packages/db/src/schema.ts's `watchlists` doc
   * comment), so every pre-existing entry now names "Default" — nothing
   * here is retroactively ambiguous, the list itself is just always known. */
  listName: z.string().optional(),
})
export type ActivityEntry = z.infer<typeof activityEntrySchema>

/**
 * Deliberately not `paginationQuerySchema` (schemas/common.ts) — that
 * cursor is a `plays.watchedAt` datetime, which can't express a title sort
 * or a merged feed's occasional cross-table timestamp ties. Offset/limit
 * instead, same reasoning as GET /activity-feed's doc comment.
 */
export const listActivityQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(60),
  /** Title filter — matched against the show/movie title (see GET
   * /activity-feed's doc comment on why "title" is always the show title for an
   * episode entry, never the episode's own title). */
  q: z.string().trim().min(1).optional(),
  /** Comma-separated subset of ACTIVITY_KINDS, e.g. "watch,rating". Parsed
   * and validated in the route handler, not here — an unknown value is
   * silently dropped rather than rejected, the same tolerant treatment
   * apps/web/src/lib/use-genre-filter-cookie.ts gives a stale filter value. */
  kinds: z.string().optional(),
  sort: activitySortSchema.default('occurredDesc'),
  /** Inclusive bounds on `occurredAt`, as full ISO instants rather than
   * bare dates — the frontend's date-range picker only offers day
   * granularity, but resolves "start of day"/"end of day" against the
   * *browser's* local timezone before sending it here (see
   * apps/web/src/lib/date.ts's localDayStartISO/localDayEndISO), since
   * there's no per-user timezone tracked server-side to do that
   * conversion against instead. */
  after: z.string().datetime().optional(),
  before: z.string().datetime().optional(),
})
export type ListActivityQuery = z.infer<typeof listActivityQuerySchema>

export const listActivityResponseSchema = z.object({
  entries: z.array(activityEntrySchema),
  total: z.number().int(),
  hasMore: z.boolean(),
})
export type ListActivityResponse = z.infer<typeof listActivityResponseSchema>

export const activityEntryRefSchema = z.object({
  kind: activityKindSchema,
  id: uuidSchema,
})

/**
 * Request body for DELETE /activity-feed (HistoryPage.tsx's multi-select bulk
 * remove) — same "always the explicit id list, no separate 'remove all'
 * mode" shape as removeWatchesRequestSchema (schemas/library.ts). `kind`
 * travels alongside each id because the four underlying tables have
 * different removal semantics: a `watch`/`rating`/`watchlist` entry is
 * deleted outright, a `dropped` entry is un-dropped (see
 * apps/api/src/lib/dropped.ts) rather than deleted, since "dropped" is
 * derived state, not a row that's meaningful to remove.
 */
export const removeActivityRequestSchema = z.object({
  entries: z.array(activityEntryRefSchema).min(1),
})
export type RemoveActivityRequest = z.infer<typeof removeActivityRequestSchema>
