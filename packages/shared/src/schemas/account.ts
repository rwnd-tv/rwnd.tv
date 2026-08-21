import { z } from 'zod'

/**
 * POST /account/clear-data (Settings > Database — see
 * apps/web/src/components/settings/DatabasePanel.tsx). Scoped to the
 * current user's own data only, not an instance-wide admin action — see
 * that route's doc comment for why. Defaults false, unlike
 * createImportJobRequestSchema's default-true: there's no sane default
 * for "what should I destroy", the frontend always sends explicit values.
 */
export const clearDataRequestSchema = z.object({
  watchHistory: z.boolean().default(false),
  ratings: z.boolean().default(false),
  watchlist: z.boolean().default(false),
  droppedShows: z.boolean().default(false),
})
export type ClearDataRequest = z.infer<typeof clearDataRequestSchema>

/**
 * GET /account/data-counts — row counts behind DatabasePanel.tsx's
 * checkbox labels. Each is a plain `count(*)` of that whole table scoped
 * to the current user, matching exactly what a checked box's clear
 * actually deletes (e.g. `droppedShows` counts every row ever touched by
 * a manual toggle or Trakt import, not just shows currently dropped —
 * see droppedShows's split traktDropped/manualDropped design in
 * packages/db/src/schema.ts, a row can exist with both null).
 */
export const accountDataCountsSchema = z.object({
  watchHistory: z.number().int(),
  ratings: z.number().int(),
  watchlist: z.number().int(),
  droppedShows: z.number().int(),
})
export type AccountDataCounts = z.infer<typeof accountDataCountsSchema>
