import { and, eq } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import { episodes, externalIds } from '@rwnd/db'
import type { MetadataProvider } from '../providers/types.js'
import { upsertExternalId } from './media.js'

/** Same query as routes/library/shared.ts's getExternalId, inlined rather
 * than imported — that helper lives under routes/ and only handles
 * 'show' | 'movie', while this needs 'episode'; lib/ importing from
 * routes/ would also invert this codebase's usual dependency direction. */
async function existingImdbId(db: Database, episodeId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ externalId: externalIds.externalId })
    .from(externalIds)
    .where(
      and(
        eq(externalIds.entityType, 'episode'),
        eq(externalIds.entityId, episodeId),
        eq(externalIds.source, 'imdb'),
      ),
    )
    .limit(1)
  return row?.externalId
}

// An episode's IMDb id, once found, never changes — no reason to ever
// re-ask for one we already have. This is only about the negative case:
// how long to trust "we checked and the provider had none" before asking
// again (a provider can gain external-ids coverage for a title over time).
const IMDB_RECHECK_MS = 30 * 24 * 60 * 60 * 1000

/**
 * An episode's IMDb id, fetched and cached lazily — the counterpart to
 * resolveMovie/resolveShow's free imdb id (apps/api/src/lib/media.ts),
 * which TMDB can't offer for episodes: its season endpoint carries no
 * per-episode external ids, so getting one costs one provider call per
 * episode (see TmdbProvider.getSeason's own comment). Used by the episode
 * detail route (apps/api/src/routes/library/seasons.ts) rather than
 * folded into the season payload, precisely to avoid ~25 provider calls
 * on a single season page view.
 *
 * `episode.id` is null when no local `episodes` row exists yet (a show
 * nobody's logged anything for) — the id is still returned in that case,
 * just never persisted. Materializing an `episodes` row for every episode
 * of every show just to cache a deep link isn't a trade this makes — same
 * "only as a side effect of specific actions" principle as
 * docs/TODO_ARCHIVE.md's "Per-episode data is never resolved proactively"
 * entry.
 */
export async function resolveEpisodeImdbId(
  db: Database,
  provider: MetadataProvider,
  showExternalId: string,
  episode: {
    id: string | null
    seasonNumber: number
    episodeNumber: number
    imdbCheckedAt: Date | null
  },
  locale: string,
): Promise<string | null> {
  if (episode.id) {
    const existing = await existingImdbId(db, episode.id)
    if (existing) return existing

    // Negative cache: already checked recently and the provider had
    // nothing — don't ask again on every page view.
    if (episode.imdbCheckedAt && Date.now() - episode.imdbCheckedAt.getTime() < IMDB_RECHECK_MS) {
      return null
    }
  }

  let imdbId: string | null
  try {
    const fetched = await provider.getEpisode(
      showExternalId,
      episode.seasonNumber,
      episode.episodeNumber,
      locale,
    )
    imdbId = fetched.imdbId
  } catch {
    // Network hiccup or no matching episode on the provider's side — never
    // fail a page over a supplementary link, same convention as the
    // season route's own best-effort TVDB lookup
    // (apps/api/src/routes/library/seasons.ts).
    return null
  }

  if (episode.id) {
    if (imdbId) {
      await upsertExternalId(db, 'episode', episode.id, 'imdb', imdbId, { correct: false })
    }
    await db.update(episodes).set({ imdbCheckedAt: new Date() }).where(eq(episodes.id, episode.id))
  }

  return imdbId
}
