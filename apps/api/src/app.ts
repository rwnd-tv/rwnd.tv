import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { OpenAPIHono } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import { createDatabase, type Database } from '@rwnd/db'
import type { AppEnv } from './types.js'
import type { MetadataProvider } from './providers/types.js'
import { loadEnv } from './env.js'
import { createMetadataProviders } from './providers/index.js'
import { healthRoutes } from './routes/health.js'
import { setupRoutes } from './routes/setup.js'
import { authRoutes } from './routes/auth.js'
import { tokenRoutes } from './routes/tokens.js'
import { searchRoutes } from './routes/search.js'
import { playRoutes } from './routes/plays.js'
import { activityRoutes } from './routes/activity.js'
import { settingsRoutes } from './routes/settings.js'
import { importRoutes } from './routes/imports.js'
import { libraryRoutes } from './routes/library.js'
import { watchlistRoutes } from './routes/watchlists.js'
import { accountRoutes } from './routes/account.js'
import { backupRoutes } from './routes/backups.js'
import { webhookRoutes } from './routes/webhooks.js'

/**
 * `services` lets index.ts share the same db connection pool and provider
 * instances it builds for import-job restart recovery, instead of this
 * function creating a second pool. Tests (testApp()) call createApp() with
 * no argument and get fresh ones, same as before.
 */
export function createApp(services?: { db: Database; metadataProviders: MetadataProvider[] }) {
  const env = loadEnv()
  const db = services?.db ?? createDatabase(env.DATABASE_URL)
  const metadataProviders = services?.metadataProviders ?? createMetadataProviders(env)
  // The primary provider — every request path that doesn't yet do
  // cross-provider fallback (search, resolve, episode/season fetches) uses
  // this one. Priority-ordered fallback (refresh, import matching) reads
  // the full `metadataProviders` list instead — see docs/adr/0006.
  const metadataProvider = metadataProviders[0]!

  const app = new OpenAPIHono<AppEnv>()

  // Without this, an uncaught exception in a handler becomes a bare 500
  // with nothing in the logs to debug from.
  app.onError((err, c) => {
    console.error(err)
    return c.json({ error: 'Internal Server Error' }, 500)
  })

  if (env.CORS_ORIGINS.length > 0) {
    app.use('/api/*', cors({ origin: env.CORS_ORIGINS, credentials: true }))
  }

  app.use('*', async (c, next) => {
    c.set('db', db)
    c.set('metadataProvider', metadataProvider)
    c.set('metadataProviders', metadataProviders)
    await next()
  })

  const v1 = new OpenAPIHono<AppEnv>()
  v1.route('/', healthRoutes)
  v1.route('/', setupRoutes)
  v1.route('/', authRoutes)
  v1.route('/', tokenRoutes)
  v1.route('/', searchRoutes)
  v1.route('/', playRoutes)
  v1.route('/', activityRoutes)
  v1.route('/', settingsRoutes)
  v1.route('/', importRoutes)
  v1.route('/', libraryRoutes)
  v1.route('/', watchlistRoutes)
  v1.route('/', accountRoutes)
  v1.route('/', backupRoutes)
  v1.route('/', webhookRoutes)

  v1.doc('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'rwnd.tv API',
      version: '1.0.0',
      description: 'Self-hosted tracking for what you watch.',
    },
  })

  app.route('/api/v1', v1)
  app.get('/api/docs', swaggerUI({ url: '/api/v1/openapi.json' }))

  // In production the API serves the built SPA itself, so a self-hosted
  // instance is a single container. In dev, the Vite dev server (5173)
  // handles the frontend and this directory won't exist.
  const webDistDir = join(process.cwd(), 'public')
  if (existsSync(webDistDir)) {
    // Serves any real file under public/ (hashed /assets/* bundles, and
    // root-level files like favicon.svg); falls through to the SPA
    // fallback below for anything that isn't an actual file on disk.
    app.use('*', serveStatic({ root: 'public' }))
    app.get('*', async (c) => {
      const html = await readFile(join(webDistDir, 'index.html'), 'utf-8')
      return c.html(html)
    })
  }

  return app
}
