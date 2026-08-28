import { and, eq, inArray } from 'drizzle-orm'
import { UNKNOWN_WATCHED_AT } from '@rwnd/shared'
import type { Database } from '@rwnd/db'
import { plays } from '@rwnd/db'
import type { ResolvedEpisode } from '../../lib/media.js'

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
