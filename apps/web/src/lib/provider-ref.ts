import type { MetadataProviderSource } from '@rwnd/shared'

/** The provider id a show/movie's watch gets logged against (POST /plays'
 * `source` + external id — see createPlayRequestSchema's doc comment in
 * packages/shared/src/schemas/plays.ts). Prefers whichever provider this
 * page's metadata actually came from, since that's the provider whose
 * season/episode numbering the page is showing; falls back to any id on
 * record otherwise. Null only when there's no provider id at all, the one
 * case a watch genuinely can't be logged. */
export function providerRef(media: {
  tmdbId: string | null
  tvdbId: string | null
  metadataSource: MetadataProviderSource | null
}): { source: MetadataProviderSource; externalId: string } | null {
  const ids: Record<MetadataProviderSource, string | null> = {
    tmdb: media.tmdbId,
    tvdb: media.tvdbId,
  }
  const order: MetadataProviderSource[] = media.metadataSource
    ? [media.metadataSource, ...(['tmdb', 'tvdb'] as const)]
    : ['tmdb', 'tvdb']
  for (const source of order) {
    const externalId = ids[source]
    if (externalId) return { source, externalId }
  }
  return null
}
