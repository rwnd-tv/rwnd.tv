import { asc, eq } from 'drizzle-orm'
import { createDatabase } from './client.js'
import { loadDbEnv } from './env.js'
import { instanceSettings, users } from './schema.js'

const { databaseUrl, ssl } = loadDbEnv()

async function main() {
  const db = createDatabase(databaseUrl, { ssl })

  // Ensure the singleton settings row exists. Actual first-run admin
  // creation happens through the API's POST /setup flow, not here.
  await db.insert(instanceSettings).values({ id: 1 }).onConflictDoNothing()

  // Backfill: promote the oldest-created admin to owner if this instance
  // has no owner yet (M4 "owner" role work, docs/TODO_ARCHIVE.md).
  // POST /setup only assigns 'owner' to a *new* first account, so an
  // instance that was already set up before this feature existed would
  // otherwise end up with zero owners. Idempotent — a no-op once an owner
  // exists (including a truly fresh, not-yet-set-up instance, where
  // there's no admin to promote either). Deliberately not a SQL migration:
  // Postgres forbids using a just-added enum value (ALTER TYPE ... ADD
  // VALUE 'owner') within the same transaction that added it, and
  // drizzle's migrator runs every pending migration file in one
  // transaction — this runs afterward, as a separate connection, once
  // that's safely committed.
  const [existingOwner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'owner'))
    .limit(1)
  if (!existingOwner) {
    const [oldestAdmin] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'admin'))
      .orderBy(asc(users.createdAt))
      .limit(1)
    if (oldestAdmin) {
      await db.update(users).set({ role: 'owner' }).where(eq(users.id, oldestAdmin.id))
      console.log(`Promoted ${oldestAdmin.id} to owner.`)
    }
  }

  console.log('Seed complete.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
