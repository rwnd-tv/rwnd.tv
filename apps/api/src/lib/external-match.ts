import { and, eq, or } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import { externalIds, movies, shows } from '@rwnd/db'
import type { MetadataProvider } from '../providers/types.js'
import { pickRefreshTarget } from '../metadata/refresh.js'
import { resolveMovie, resolveSeason, resolveShow } from './media.js'

/**
 * Whichever of a title's external ids a caller happens to have on hand —
 * shared shape between Trakt's own `ids` bundle (`TraktIds`, which already
 * satisfies this structurally: extra `trakt`/`slug` fields don't stop it
 * being assignable here) and a webhook payload's ids (Plex/Tautulli/
 * Jellyfin/Emby/Kodi, none of which know about Trakt at all).
 */
export interface ExternalIdBundle {
  imdb?: string | null
  tmdb?: string | number | null
  tvdb?: string | number | null
}

function ownProviderId(provider: MetadataProvider, ids: ExternalIdBundle): string | null {
  const id = ids[provider.source]
  return id ? String(id) : null
}

/** Tries `ids.imdb`, then `ids.tvdb` (skipped when `provider` *is* TVDB —
 * reverse-looking-up a TVDB id against TVDB itself would be a pointless
 * self-referential call, already covered by `ownProviderId` above),
 * against `provider.findByExternalId`, returning the first hit. `imdb`
 * covers both movies and shows; `tvdb` is TV-only in practice, but there's
 * no harm asking either provider method for either entity type — the
 * provider itself returns null for a source it can't reverse-lookup. */
async function findViaAlternateIds(
  provider: MetadataProvider,
  entityType: 'movie' | 'show',
  ids: ExternalIdBundle,
  locale: string,
): Promise<string | null> {
  if (ids.imdb) {
    const found = await provider.findByExternalId(entityType, 'imdb', ids.imdb, locale)
    if (found) return found
  }
  if (ids.tvdb && provider.source !== 'tvdb') {
    const found = await provider.findByExternalId(entityType, 'tvdb', String(ids.tvdb), locale)
    if (found) return found
  }
  return null
}

/**
 * Walks `providers` in priority order and, for each one, tries `resolve`
 * against that provider's own id first (`ownProviderId`), then — whether
 * that was absent, or present but rejected by the provider (merged/
 * deleted/wrong id) — whatever `findViaAlternateIds` turns up for that
 * same provider. Moves on to the next provider only once the current one
 * has been fully exhausted. `error`/`provider` describe the *last*
 * attempt made, or are null if no candidate id was ever found to try
 * against any provider. Shared by `apps/api/src/import/match.ts` (Trakt
 * import) and this file's own `resolveMovieFromExternalIds`/
 * `resolveShowFromExternalIds` (webhook ingestion) — the only thing that
 * varies between callers is where `ids` comes from.
 */
export async function resolveViaProvider<T>(
  resolve: (provider: MetadataProvider, providerExternalId: string) => Promise<T>,
  providers: MetadataProvider[],
  entityType: 'movie' | 'show',
  ids: ExternalIdBundle,
  locale: string,
): Promise<
  | { ok: true; value: T; provider: MetadataProvider; externalId: string }
  | { ok: false; error: unknown; provider: MetadataProvider | null }
> {
  let lastError: unknown = null
  let lastProvider: MetadataProvider | null = null
  for (const provider of providers) {
    const ownId = ownProviderId(provider, ids)
    if (ownId) {
      lastProvider = provider
      try {
        return { ok: true, value: await resolve(provider, ownId), provider, externalId: ownId }
      } catch (err) {
        lastError = err
      }
    }
    const alternateId = await findViaAlternateIds(provider, entityType, ids, locale)
    if (alternateId) {
      lastProvider = provider
      try {
        return {
          ok: true,
          value: await resolve(provider, alternateId),
          provider,
          externalId: alternateId,
        }
      } catch (err) {
        lastError = err
      }
    }
  }
  return { ok: false, error: lastError, provider: lastProvider }
}

/** Every id in `ids`, tagged with its source — the shape `external_ids`
 * rows actually use. */
function taggedIds(
  ids: ExternalIdBundle,
): Array<{ source: 'tmdb' | 'tvdb' | 'imdb'; externalId: string }> {
  const pairs: Array<{ source: 'tmdb' | 'tvdb' | 'imdb'; externalId: string }> = []
  if (ids.tmdb) pairs.push({ source: 'tmdb', externalId: String(ids.tmdb) })
  if (ids.tvdb) pairs.push({ source: 'tvdb', externalId: String(ids.tvdb) })
  if (ids.imdb) pairs.push({ source: 'imdb', externalId: ids.imdb })
  return pairs
}

/** Which local entity, if any, *any* of `ids` points at — not just one
 * specific provider's id. A webhook payload can hand over several ids at
 * once (e.g. Plex's `Guid` array often carries tmdb *and* tvdb together),
 * and the entity might already be known locally under a different one of
 * them than whichever a naive single-source lookup would check first. */
async function localEntityIdForAnyExternalId(
  db: Database,
  entityType: 'movie' | 'show',
  ids: ExternalIdBundle,
): Promise<string | null> {
  const pairs = taggedIds(ids)
  if (pairs.length === 0) return null
  const [row] = await db
    .select({ id: externalIds.entityId })
    .from(externalIds)
    .where(
      and(
        eq(externalIds.entityType, entityType),
        or(
          ...pairs.map((p) =>
            and(eq(externalIds.source, p.source), eq(externalIds.externalId, p.externalId)),
          ),
        ),
      ),
    )
    .limit(1)
  return row?.id ?? null
}

/** Backfills whichever of `ids` aren't already recorded, so a future event
 * carrying a *different* one of them still hits the fast path above
 * instead of walking providers again. Unlike `match.ts`'s own
 * `backfillExternalIds`, never writes a `trakt` row — callers here don't
 * have one. */
async function backfillExternalIdBundle(
  db: Database,
  entityType: 'movie' | 'show' | 'episode',
  entityId: string,
  ids: ExternalIdBundle,
): Promise<void> {
  const pairs = taggedIds(ids)
  if (pairs.length === 0) return
  await db
    .insert(externalIds)
    .values(
      pairs.map((p) => ({ entityType, entityId, source: p.source, externalId: p.externalId })),
    )
    .onConflictDoNothing()
}

/**
 * Resolves a movie from whatever external ids a webhook (or any future
 * non-Trakt caller) has on hand: an `external_ids` hit under *any* of them
 * wins outright (no provider call); failing that, walks `providers` via
 * `resolveViaProvider` to find one that recognizes the title at all, then
 * backfills every other id in the bundle so next time hits the fast path.
 * Returns null when nothing matches — a genuinely unresolvable title
 * (Formula-1-style), not this function's problem to solve further.
 */
export async function resolveMovieFromExternalIds(
  db: Database,
  providers: MetadataProvider[],
  ids: ExternalIdBundle,
  locale: string,
): Promise<{ id: string; slug: string; title: string; posterPath: string | null } | null> {
  const localId = await localEntityIdForAnyExternalId(db, 'movie', ids)
  if (localId) {
    const [movie] = await db.select().from(movies).where(eq(movies.id, localId)).limit(1)
    if (movie) {
      await backfillExternalIdBundle(db, 'movie', movie.id, ids)
      return movie
    }
  }

  const result = await resolveViaProvider(
    (provider, externalId) => resolveMovie(db, provider, externalId, locale),
    providers,
    'movie',
    ids,
    locale,
  )
  if (!result.ok) return null
  await backfillExternalIdBundle(db, 'movie', result.value.id, ids)
  return result.value
}

/** Show counterpart of `resolveMovieFromExternalIds`. Also resolves which
 * configured provider (and its id) should be used for episode-level
 * lookups under this show — `pickRefreshTarget`'s own convention (used by
 * the background refresher and Trakt import alike) on the already-local
 * path, or the provider that actually resolved it. Returns null both when
 * the title can't be matched at all, and when it's known locally but no
 * *configured* provider has a usable id for it (nothing to resolve
 * episodes against either way). */
export async function resolveShowFromExternalIds(
  db: Database,
  providers: MetadataProvider[],
  ids: ExternalIdBundle,
  locale: string,
): Promise<{
  id: string
  title: string
  slug: string
  provider: MetadataProvider
  providerExternalId: string
} | null> {
  const localId = await localEntityIdForAnyExternalId(db, 'show', ids)
  if (localId) {
    const [show] = await db.select().from(shows).where(eq(shows.id, localId)).limit(1)
    if (show) {
      await backfillExternalIdBundle(db, 'show', show.id, ids)
      const target = await pickRefreshTarget(db, 'show', show.id, providers)
      if (!target) return null
      return {
        id: show.id,
        title: show.title,
        slug: show.slug,
        provider: target.provider,
        providerExternalId: target.externalId,
      }
    }
  }

  const result = await resolveViaProvider(
    (provider, externalId) => resolveShow(db, provider, externalId, locale),
    providers,
    'show',
    ids,
    locale,
  )
  if (!result.ok) return null
  await backfillExternalIdBundle(db, 'show', result.value.id, ids)
  return {
    id: result.value.id,
    title: result.value.title,
    slug: result.value.slug,
    provider: result.provider,
    // result.value.externalId — resolveShow's own corrected id — not
    // result.externalId (whatever id resolveViaProvider happened to call it
    // with). The two differ when the provider had to redirect internally
    // (see resolveShow's own doc comment); every subsequent episode/season
    // lookup needs the real one.
    providerExternalId: result.value.externalId,
  }
}

/**
 * Soft episode lookup for a resolved show — unlike `media.ts`'s own
 * `resolveEpisode`, never throws when the provider simply doesn't have
 * this episode (a webhook firing for something not in the provider's
 * season data shouldn't 500 the whole request). Uses `resolveSeason`
 * (already doesn't throw on a merely-empty season) and finds the matching
 * episode number locally — absent means null, a soft "not found."
 */
export async function resolveEpisodeSoft(
  db: Database,
  show: { id: string; provider: MetadataProvider; providerExternalId: string },
  seasonNumber: number,
  episodeNumber: number,
  locale: string,
): Promise<{ id: string } | null> {
  const seasonEpisodes = await resolveSeason(
    db,
    show.provider,
    show.id,
    show.providerExternalId,
    seasonNumber,
    locale,
  )
  return seasonEpisodes.find((e) => e.episodeNumber === episodeNumber) ?? null
}
