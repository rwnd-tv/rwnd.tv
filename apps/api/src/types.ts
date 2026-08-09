import type { Database } from '@rwnd/db'
import type { InferSelectModel } from 'drizzle-orm'
import type { users } from '@rwnd/db'
import type { MetadataProvider } from './providers/types.js'

export type UserRecord = InferSelectModel<typeof users>

export type AppEnv = {
  Variables: {
    db: Database
    metadataProvider: MetadataProvider
    /** Populated by requireAuth/optionalAuth; absent means unauthenticated. */
    user?: UserRecord
  }
}
