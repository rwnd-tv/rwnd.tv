import type { MetadataProviderSource } from '@rwnd/shared'
import type { Env } from '../env.js'
import { TmdbProvider } from './tmdb.js'
import { TvdbProvider } from './tvdb.js'
import type { MetadataProvider } from './types.js'

export type { MetadataProvider } from './types.js'

/**
 * Every metadata provider this instance actually has credentials for, in no
 * particular order — see docs/adr/0006 and apps/api/src/providers/priority.ts
 * for how they're ordered into a preference list. Which providers exist is
 * derived from which API keys are set (parseEnv in apps/api/src/env.ts
 * already guarantees at least one is), not from a separate explicit-choice
 * setting — a self-hoster who adds a second provider's key later doesn't
 * need to flip anything else on to have it picked up.
 */
export function createMetadataProviders(env: Env): MetadataProvider[] {
  const providers: MetadataProvider[] = []
  if (env.TMDB_API_KEY) {
    providers.push(
      new TmdbProvider({
        apiKey: env.TMDB_API_KEY,
        apiBaseUrl: env.TMDB_API_BASE_URL,
        imageBaseUrl: env.TMDB_IMAGE_BASE_URL,
      }),
    )
  }
  if (env.TVDB_API_KEY) {
    providers.push(
      new TvdbProvider({
        apiKey: env.TVDB_API_KEY,
        pin: env.TVDB_PIN,
        apiBaseUrl: env.TVDB_API_BASE_URL,
      }),
    )
  }
  if (providers.length === 0) {
    // parseEnv() already validates this can't happen with a real process
    // env, but createMetadataProviders() is also callable directly (tests,
    // scripts) with an env object that skipped that check.
    throw new Error('No metadata provider is configured')
  }
  return providers
}

/** Just the `source` tags from createMetadataProviders(), for contexts that
 * need to know what's available without constructing provider instances
 * (e.g. validating an admin-submitted priority list against reality — see
 * apps/api/src/routes/settings.ts). */
export function availableProviderSources(env: Env): MetadataProviderSource[] {
  return createMetadataProviders(env).map((provider) => provider.source)
}
