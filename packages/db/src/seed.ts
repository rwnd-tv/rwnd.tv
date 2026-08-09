import { createDatabase } from './client.js'
import { instanceSettings } from './schema.js'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is required to run the seed script')
}

async function main() {
  const db = createDatabase(connectionString!)

  // Ensure the singleton settings row exists. Actual first-run admin
  // creation happens through the API's POST /setup flow, not here.
  await db.insert(instanceSettings).values({ id: 1 }).onConflictDoNothing()

  console.log('Seed complete.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
