import { z } from 'zod'

/**
 * Named lists a user keeps titles on (apps/web/src/routes/WatchlistsPage.tsx,
 * WatchlistDetailPage.tsx) — see `watchlists`' doc comment in
 * packages/db/src/schema.ts for the Default-list/cover-art/per-user-unique-
 * name design this backs.
 */

export const watchlistNameSchema = z.string().trim().min(1).max(100)

export const watchlistSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  /** The one list that always exists, can't be renamed or deleted — see
   * packages/db/src/schema.ts's `watchlists` doc comment. */
  isDefault: z.boolean(),
  itemCount: z.number().int(),
  /** The cover shown on the Watchlists index tile: the pinned item's
   * poster if the user chose one (see `coverItemId` on watchlistDetailSchema
   * below), otherwise the most recently added item's poster. Null when the
   * list is empty, or its one candidate item has no poster cached yet. */
  coverPosterPath: z.string().nullable(),
})
export type WatchlistSummary = z.infer<typeof watchlistSummarySchema>

export const listWatchlistsResponseSchema = z.object({
  watchlists: z.array(watchlistSummarySchema),
})
export type ListWatchlistsResponse = z.infer<typeof listWatchlistsResponseSchema>

export const createWatchlistRequestSchema = z.object({
  name: watchlistNameSchema,
})
export type CreateWatchlistRequest = z.infer<typeof createWatchlistRequestSchema>

export const updateWatchlistRequestSchema = z.object({
  /** Renames the list. Omit to leave the name unchanged; rejected on the
   * Default list (400) — it's never renameable. */
  name: watchlistNameSchema.optional(),
  /** Pins one of the list's own items (its `itemId`, from
   * watchlistItemMediaSchema below — not the show/movie id) as the cover.
   * `null` clears the pin back to "most recently added". Omit to leave the
   * cover unchanged. */
  coverItemId: z.string().uuid().nullable().optional(),
})
export type UpdateWatchlistRequest = z.infer<typeof updateWatchlistRequestSchema>

/**
 * One title on a list, shaped for a gallery tile (PosterTile.tsx) rather
 * than the fuller libraryShowSchema/libraryMovieSchema (schemas/library.ts)
 * — a watchlisted title may never have been watched at all, so this only
 * carries what a tile needs to render and link out, not watch-progress
 * fields that assume `plays` rows exist. Only ever `movie`/`show` — an
 * episode-level watchlist entry (the schema allows one, see
 * packages/db/src/schema.ts) is left out of this list entirely rather than
 * represented here, since there's no episode page for a watchlist tile to
 * link to yet (docs/TODO.md).
 */
export const watchlistItemMediaSchema = z.object({
  /** The underlying `watchlist_items.id` — what `coverItemId` above targets.
   * Distinct from the show/movie's own id, which this doesn't expose: `type`
   * + `slug` are enough to link out, and removal from the list goes through
   * the same per-title DELETE /library/{shows,movies}/{slug}/watchlists/{id}
   * route the detail page's own toggle uses, not a separate route here. */
  itemId: z.string().uuid(),
  type: z.enum(['movie', 'show']),
  slug: z.string(),
  title: z.string(),
  year: z.number().int().nullable(),
  posterPath: z.string().nullable(),
  listedAt: z.string().datetime(),
})
export type WatchlistItemMedia = z.infer<typeof watchlistItemMediaSchema>

export const watchlistDetailSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isDefault: z.boolean(),
  coverItemId: z.string().uuid().nullable(),
  items: z.array(watchlistItemMediaSchema),
})
export type WatchlistDetail = z.infer<typeof watchlistDetailSchema>

/**
 * Response for PUT/DELETE /library/{shows,movies}/{slug}/watchlists/{watchlistId}
 * (apps/api/src/routes/library.ts) — the full, current membership rather
 * than just the one list that changed, so the show/movie detail page's
 * cache can be replaced outright the same way setting a rating replaces
 * `myRating` (see showDetailSchema's `myWatchlistIds`, schemas/library.ts).
 */
export const watchlistMembershipStatusSchema = z.object({
  myWatchlistIds: z.array(z.string().uuid()),
})
export type WatchlistMembershipStatus = z.infer<typeof watchlistMembershipStatusSchema>
