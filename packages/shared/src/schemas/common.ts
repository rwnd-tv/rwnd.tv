import { z } from 'zod'

/** Locales the UI ships translations for. `en-GB` is authoritative;
 * `en-US` is a deliberate fork (Movie vs Film, plus the handful of
 * genuine UK/US spelling differences) confirmed word-by-word with a
 * native British English speaker — see docs/TODO_ARCHIVE.md. `fr-FR`
 * was dropped 2026-08-23 — added speculatively in M1 with no
 * verification and never checked by a French speaker; don't repeat
 * that for a future locale — only add one there's someone to check. */
export const SUPPORTED_LOCALES = ['en-GB', 'en-US'] as const
export const localeSchema = z.enum(SUPPORTED_LOCALES)
export type Locale = z.infer<typeof localeSchema>

export const themeSchema = z.enum(['system', 'light', 'dark'])
export type Theme = z.infer<typeof themeSchema>

export const userRoleSchema = z.enum(['admin', 'user'])
export type UserRole = z.infer<typeof userRoleSchema>

/** How a play was logged — matches `playSourceEnum` in packages/db/src/schema.ts.
 * Shared by plays.ts, library.ts, activity.ts, and backups.ts, all of which
 * report a play's source. */
export const playSourceSchema = z.enum(['manual', 'plex', 'import'])
export type PlaySource = z.infer<typeof playSourceSchema>

/** Which metadata provider fetched a title's cached fields, or is being
 * asked to. Deliberately a *subset* of the DB's 4-value
 * `external_id_source` enum (packages/db/src/schema.ts) — `imdb`/`trakt`
 * are id namespaces things get looked up *by*, not systems metadata is
 * ever fetched *from*, so they don't belong in this narrower list. Still
 * assignable to the `externalIds.source` column type. See
 * apps/api/src/providers/tvdb.ts for the TVDB implementation. */
export const metadataProviderSourceSchema = z.enum(['tmdb', 'tvdb'])
export type MetadataProviderSource = z.infer<typeof metadataProviderSourceSchema>

export const uuidSchema = z.string().uuid()

/** A TMDB or TVDB id, as it flows from a search/resolve response back
 * into a resolve/play/import request — both providers only ever hand out
 * `String(numericId)` (see apps/api/src/providers/tmdb.ts and tvdb.ts's
 * `externalId: String(...)`), so an unconstrained `z.string()` here was
 * wider than the value can ever legitimately be. It's interpolated
 * straight into a provider request's URL *path*
 * (`/movie/${externalId}`), so this also bounds what an attacker-
 * supplied value could otherwise smuggle into that path segment (M3
 * security review, F-18) — the host itself was never attacker-
 * controlled (it's env-configured), so this was endpoint confusion
 * within api.themoviedb.org/api4.thetvdb.com, not classic SSRF. 12
 * digits is generous headroom over either provider's current id range. */
export const providerExternalIdSchema = z
  .string()
  .regex(/^\d{1,12}$/, 'Must be a numeric provider id')

/** A user's 1-10 rating for a show/movie/episode — matches the DB's
 * `ratings_rating_range BETWEEN 1 AND 10` check (packages/db/src/schema.ts).
 * Compose with `.nullable()`/`.optional()` as each call site needs — the
 * response side is nullable (unrated), the request side is usually bare. */
export const ratingValueSchema = z.number().int().min(1).max(10)

export const paginationQuerySchema = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})
export type PaginationQuery = z.infer<typeof paginationQuerySchema>
