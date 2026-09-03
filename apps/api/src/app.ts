import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { OpenAPIHono } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import type { MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'
import { csrf } from 'hono/csrf'
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import { serveStatic } from '@hono/node-server/serve-static'
import { createDatabase, type Database } from '@rwnd/db'
import type { AppEnv } from './types.js'
import type { MetadataProvider } from './providers/types.js'
import { loadEnv } from './env.js'
import { APP_VERSION } from './version.js'
import { requireSession } from './middleware/auth.js'
import { jsonBodyLimit } from './lib/body-limit.js'
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
import { libraryRoutes } from './routes/library/index.js'
import { watchlistRoutes } from './routes/watchlists.js'
import { accountRoutes } from './routes/account.js'
import { backupRoutes } from './routes/backups.js'
import { webhookRoutes } from './routes/webhooks.js'
import { webhookLinkRoutes } from './routes/webhook-links.js'
import { inviteRoutes } from './routes/invites.js'
import { mfaRoutes } from './routes/mfa.js'
import { adminUserRoutes } from './routes/admin-users.js'

/**
 * `services` lets index.ts share the same db connection pool and provider
 * instances it builds for import-job restart recovery, instead of this
 * function creating a second pool. Tests (testApp()) call createApp() with
 * no argument and get fresh ones, same as before.
 */
export function createApp(services?: { db: Database; metadataProviders: MetadataProvider[] }) {
  const env = loadEnv()
  const db = services?.db ?? createDatabase(env.DATABASE_URL, { ssl: env.DATABASE_SSL })
  const metadataProviders = services?.metadataProviders ?? createMetadataProviders(env)
  // The primary provider — every request path that doesn't yet do
  // cross-provider fallback (search, resolve, episode/season fetches) uses
  // this one. Priority-ordered fallback (refresh, import matching) reads
  // the full `metadataProviders` list instead — see docs/adr/0006.
  const metadataProvider = metadataProviders[0]!

  const app = new OpenAPIHono<AppEnv>()

  // Without this, an uncaught exception in a handler becomes a bare 500
  // with nothing in the logs to debug from. HTTPException is special-cased
  // first — hono/csrf throws one on rejection with its own pre-built
  // response (403), and letting it fall through to the generic handler
  // below would turn that into a misleading 500.
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse()
    console.error(err)
    return c.json({ error: 'Internal Server Error' }, 500)
  })

  // Mounted outermost (on '*', before anything else) so it covers error
  // responses and the static SPA too, not just /api/*. The build emits no
  // inline scripts or styles (Vite + @tailwindcss/vite both produce
  // external hashed bundles — verified against apps/web/dist/index.html),
  // so script-src/style-src can be 'self' with no 'unsafe-inline'. React's
  // `style={{...}}` prop writes through the CSSOM (element.style), which
  // CSP's style-src doesn't govern, so that's unaffected. img-src needs
  // the metadata providers' own image CDNs, since posters/stills are
  // fetched directly by the browser rather than proxied through this API.
  // HSTS is sent only once COOKIE_SECURE confirms this instance is
  // actually on HTTPS — emitting it from a plain-HTTP LAN deployment can
  // wedge a self-hoster's browser onto a scheme nothing is listening on.
  app.use(
    '*',
    secureHeaders({
      xFrameOptions: 'DENY',
      referrerPolicy: 'strict-origin-when-cross-origin',
      // Legacy header, superseded by CSP — can itself introduce an XSS
      // vector in old IE versions when left on.
      xXssProtection: false,
      strictTransportSecurity: env.COOKIE_SECURE,
      permissionsPolicy: {
        camera: [],
        microphone: [],
        geolocation: [],
        payment: [],
      },
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https://image.tmdb.org', 'https://artworks.thetvdb.com'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
    }),
  )

  if (env.CORS_ORIGINS.length > 0) {
    app.use('/api/*', cors({ origin: env.CORS_ORIGINS, credentials: true }))
  }

  // hono/csrf only enforces itself on state-changing requests whose
  // Content-Type is form-encodable (multipart/form-data,
  // application/x-www-form-urlencoded, text/plain) — see its source. Every
  // other route here is application/json, so this lands on the 5
  // cookie-authenticated hand-written multipart routes (avatar, imports)
  // that JSON's preflight requirement + SameSite=Lax don't otherwise
  // cover. Origin is widened to CORS_ORIGINS for dev's cross-port setup;
  // default (same-origin only) is correct for production's single-origin
  // serving. The Plex webhook is deliberately exempt: it's bearer-token
  // authenticated in the URL, not cookie-authenticated, and Plex itself
  // (a server, not a browser) never sends Origin/Sec-Fetch-Site — CSRF
  // exists to protect ambient browser credentials, which this route has
  // none of, so applying it here would only ever break the real feature.
  const csrfMiddleware: MiddlewareHandler<AppEnv> = csrf({
    origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : undefined,
  })
  app.use(
    '/api/*',
    createMiddleware<AppEnv>(async (c, next) => {
      if (c.req.path.startsWith('/api/v1/webhooks/plex/')) return next()
      return csrfMiddleware(c, next)
    }),
  )

  // A default cap for the ordinary JSON API — nothing bounded request
  // bodies before this. The four routes that legitimately need more
  // (avatar upload, the two ZIP imports, the Plex webhook) carry their own
  // wider bodyLimit directly on the route instead of being caught by this
  // one; a single global limit can't be "overridden" wider downstream,
  // since whichever bodyLimit runs first and rejects wins.
  const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024 // 1MB
  const bodyLimitExempt = (path: string) =>
    path === '/api/v1/auth/me/avatar' ||
    path === '/api/v1/import/trakt/zip' ||
    path === '/api/v1/import/csv' ||
    path.startsWith('/api/v1/webhooks/plex/')
  const defaultBodyLimit: MiddlewareHandler<AppEnv> = jsonBodyLimit(DEFAULT_BODY_LIMIT_BYTES)
  app.use(
    '/api/*',
    createMiddleware<AppEnv>(async (c, next) => {
      if (bodyLimitExempt(c.req.path)) return next()
      return defaultBodyLimit(c, next)
    }),
  )

  // Blanket `no-store` on every API response (M3 security review follow-up,
  // docs/TODO.md, ASVS V8.2.1) — nothing under /api/* is safe for a shared
  // cache or browser back-forward cache to keep around by default (session
  // data, watch history, tokens). Set before the route handlers run, not
  // after, so the one deliberate exception — the avatar route's own
  // `private, max-age=31536000, immutable` (routes/auth.ts) — overwrites
  // this rather than the other way around; `c.header()` replaces a
  // previously-set value unless called with `{ append: true }`.
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    await next()
  })

  app.use('*', async (c, next) => {
    c.set('db', db)
    c.set('metadataProvider', metadataProvider)
    c.set('metadataProviders', metadataProviders)
    await next()
  })

  const v1 = new OpenAPIHono<AppEnv>()
  // Fail closed: every route below requires a session unless it's in
  // requireSession's PUBLIC_ROUTES allow-list — see middleware/auth.ts.
  // Mounted before any route registration so it's the first thing in the
  // chain for every request under /api/v1.
  v1.use('*', requireSession)
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
  v1.route('/', webhookLinkRoutes)
  v1.route('/', inviteRoutes)
  v1.route('/', mfaRoutes)
  v1.route('/', adminUserRoutes)

  v1.doc('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'rwnd.tv API',
      version: APP_VERSION,
      description: 'Self-hosted tracking for what you watch.',
    },
  })

  app.route('/api/v1', v1)
  // Full route-surface disclosure otherwise (F-10, M3 security review) —
  // requireSession also covers /api/v1/openapi.json since that's mounted
  // on v1 itself via v1.doc() above.
  app.get('/api/docs', requireSession, swaggerUI({ url: '/api/v1/openapi.json' }))

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
