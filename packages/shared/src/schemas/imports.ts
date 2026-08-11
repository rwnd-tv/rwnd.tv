import { z } from 'zod'

export const importJobStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
])
export type ImportJobStatus = z.infer<typeof importJobStatusSchema>

/** What the user sees while pairing — never the device_code or any token. */
export const traktDevicePairingSchema = z.object({
  userCode: z.string(),
  verificationUrl: z.string(),
  expiresAt: z.string().datetime(),
  interval: z.number().int().positive(),
})
export type TraktDevicePairing = z.infer<typeof traktDevicePairingSchema>

/** GET /import/trakt/connection. Tokens never appear in an API response —
 * only whether a connection exists and the username it's for. `pairing` is
 * present while a device-flow pairing started by this user is still in
 * flight (or just finished denied/expired) — the UI polls this to know
 * when to stop showing the user_code screen. */
export const traktConnectionStatusSchema = z.object({
  connected: z.boolean(),
  username: z.string().nullable(),
  pairing: z
    .object({
      userCode: z.string(),
      verificationUrl: z.string(),
      expiresAt: z.string().datetime(),
      status: z.enum(['pending', 'denied', 'expired']),
    })
    .optional(),
})
export type TraktConnectionStatus = z.infer<typeof traktConnectionStatusSchema>

export const createImportJobRequestSchema = z.object({
  history: z.boolean().default(true),
  ratings: z.boolean().default(true),
  watchlist: z.boolean().default(true),
})
export type CreateImportJobRequest = z.infer<typeof createImportJobRequestSchema>

/**
 * `show`/`season`/`episode` are only present for episode-level (and, for
 * `season`, season-level) failures — they're what let the UI group
 * failures into a show > season > episode tree instead of a flat list,
 * without having to parse them back out of `title`.
 */
export const importJobFailureSchema = z.object({
  phase: z.string(),
  reason: z.string(),
  title: z.string().optional(),
  show: z.string().optional(),
  season: z.number().int().optional(),
  episode: z.number().int().optional(),
})
export type ImportJobFailure = z.infer<typeof importJobFailureSchema>

export const importJobSchema = z.object({
  id: z.string().uuid(),
  status: importJobStatusSchema,
  includeHistory: z.boolean(),
  includeRatings: z.boolean(),
  includeWatchlist: z.boolean(),
  itemsTotal: z.number().int().nullable(),
  itemsProcessed: z.number().int(),
  itemsImported: z.number().int(),
  itemsSkipped: z.number().int(),
  failures: z.array(importJobFailureSchema),
  error: z.string().nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})
export type ImportJob = z.infer<typeof importJobSchema>

export const listImportJobsResponseSchema = z.object({
  jobs: z.array(importJobSchema),
})
export type ListImportJobsResponse = z.infer<typeof listImportJobsResponseSchema>
