import { createDatabase } from './client.js'
import { loadDbEnv } from './env.js'
import { instanceSettings } from './schema.js'

const { databaseUrl, ssl } = loadDbEnv()

async function main() {
  const db = createDatabase(databaseUrl, { ssl })

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
