import type { Env } from '../env.js'
import { TmdbProvider } from './tmdb.js'
import type { MetadataProvider } from './types.js'

export type { MetadataProvider } from './types.js'

export function createMetadataProvider(env: Env): MetadataProvider {
  switch (env.METADATA_PROVIDER) {
    case 'tmdb': {
      if (!env.TMDB_API_KEY) throw new Error('TMDB_API_KEY is required for the tmdb provider')
      return new TmdbProvider({
        apiKey: env.TMDB_API_KEY,
        apiBaseUrl: env.TMDB_API_BASE_URL,
        imageBaseUrl: env.TMDB_IMAGE_BASE_URL,
      })
    }
    default:
      throw new Error(`Unknown metadata provider: ${env.METADATA_PROVIDER}`)
  }
}
