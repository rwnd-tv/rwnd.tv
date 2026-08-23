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

export const uuidSchema = z.string().uuid()

export const paginationQuerySchema = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})
export type PaginationQuery = z.infer<typeof paginationQuerySchema>
