import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { loadDbEnv } from './env.js'

const { databaseUrl, ssl } = loadDbEnv()

const migrationClient = postgres(databaseUrl, { max: 1, ssl: ssl ? 'require' : undefined })

async function main() {
  const db = drizzle(migrationClient)
  console.log('Running migrations...')
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) })
  console.log('Migrations complete.')
  await migrationClient.end()
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
