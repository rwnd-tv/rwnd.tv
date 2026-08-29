import type { Database } from '@rwnd/db'
import type { InferSelectModel } from 'drizzle-orm'
import type { users } from '@rwnd/db'
import type { MetadataProvider } from './providers/types.js'

export type UserRecord = InferSelectModel<typeof users>

export type AppEnv = {
  Variables: {
    db: Database
    /** The primary provider — every request path that doesn't yet do
     * cross-provider fallback (search, resolve, episode/season fetches)
     * uses this one. See `metadataProviders` for the full priority-ordered
     * set, and docs/adr/0006 for why the split exists. */
    metadataProvider: MetadataProvider
    /** Every provider this instance has credentials for, in no particular
     * order — pass to apps/api/src/providers/priority.ts's
     * orderedProviders() wherever fallback across providers actually
     * matters. */
    metadataProviders: MetadataProvider[]
    /** Populated by requireSession; absent means unauthenticated. */
    user?: UserRecord
  }
}
