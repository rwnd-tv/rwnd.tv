import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { OpenAPIHono } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import { createDatabase } from '@rwnd/db'
import type { AppEnv } from './types.js'
import { loadEnv } from './env.js'
import { createMetadataProvider } from './providers/index.js'
import { healthRoutes } from './routes/health.js'
import { setupRoutes } from './routes/setup.js'
import { authRoutes } from './routes/auth.js'
import { tokenRoutes } from './routes/tokens.js'
import { searchRoutes } from './routes/search.js'
import { playRoutes } from './routes/plays.js'
import { settingsRoutes } from './routes/settings.js'

export function createApp() {
  const env = loadEnv()
  const db = createDatabase(env.DATABASE_URL)
  const metadataProvider = createMetadataProvider(env)

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
    await next()
  })

  const v1 = new OpenAPIHono<AppEnv>()
  v1.route('/', healthRoutes)
  v1.route('/', setupRoutes)
  v1.route('/', authRoutes)
  v1.route('/', tokenRoutes)
  v1.route('/', searchRoutes)
  v1.route('/', playRoutes)
  v1.route('/', settingsRoutes)

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
