import { serve } from '@hono/node-server'
import { eq } from 'drizzle-orm'
import { createDatabase, importJobs } from '@rwnd/db'
import { createApp } from './app.js'
import { loadEnv } from './env.js'
import { createMetadataProviders } from './providers/index.js'
import { runTraktImport } from './import/trakt.js'
import { scheduleMetadataRefresh } from './metadata/refresh.js'

const env = loadEnv()
const db = createDatabase(env.DATABASE_URL)
const metadataProviders = createMetadataProviders(env)
const metadataProvider = metadataProviders[0]!
const app = createApp({ db, metadataProviders })

// Resume import jobs that were mid-flight when the process last stopped.
// Deliberately not inside createApp() — that runs in every test via
// testApp(), and job recovery must not fire there. A job's `running`
// status only means "was running when we last checked in" (there's no
// process-liveness signal), so on boot every such job gets flipped back to
// `pending` and resumed from its stored {phase, page} cursor — see
// apps/api/src/import/trakt.ts.
async function resumeInterruptedImports() {
  const interrupted = await db
    .update(importJobs)
    .set({ status: 'pending' })
    .where(eq(importJobs.status, 'running'))
    .returning({ id: importJobs.id })
  for (const job of interrupted) {
    void runTraktImport(db, metadataProvider, env, job.id).catch((err: unknown) =>
      console.error(`Failed to resume import job ${job.id}:`, err),
    )
  }
}
void resumeInterruptedImports()

// Same reasoning as resumeInterruptedImports above: deliberately not inside
// createApp(), since testApp() runs createApp() in every test and this must
// not fire there. Covers the initial season-count backfill, ongoing airing
// shows, and TMDB's 6-month cache-retention limit — see
// apps/api/src/metadata/refresh.ts.
scheduleMetadataRefresh(db, metadataProviders)

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`rwnd.tv API listening on http://localhost:${info.port}`)
  console.log(`OpenAPI docs: http://localhost:${info.port}/api/docs`)
})
