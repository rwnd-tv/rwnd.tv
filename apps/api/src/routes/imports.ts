import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { createMiddleware } from 'hono/factory'
import { and, desc, eq, inArray } from 'drizzle-orm'
import {
  createImportJobRequestSchema,
  importJobSchema,
  listImportJobsResponseSchema,
  traktConnectionStatusSchema,
  traktDevicePairingSchema,
  type ImportJob,
  uuidSchema,
} from '@rwnd/shared'
import { importJobs, traktConnections } from '@rwnd/db'
import type { AppEnv } from '../types.js'
import { loadEnv } from '../env.js'
import { encryptSecret } from '../lib/crypto.js'
import { pollDeviceToken, requestDeviceCode } from '../trakt/auth.js'
import { TraktClient } from '../trakt/client.js'
import { runTraktImport, runTraktZipImport } from '../import/trakt.js'
import { TraktZipParseError, parseTraktZip } from '../import/trakt-zip-parse.js'
import { runCsvImport } from '../import/csv.js'
import { CsvZipParseError, parseCsvZip } from '../import/csv-zip-parse.js'

export const importRoutes = new OpenAPIHono<AppEnv>()

// ---------------------------------------------------------------------------
// Device pairing. Trakt's device flow has no callback rwnd.tv's API can
// receive — the server has to poll /oauth/device/token itself. That poll
// loop is tracked here in memory (per-process, keyed by userId) rather
// than persisted: a pairing is short-lived (Trakt's own expires_in is
// typically ~10 minutes) and, unlike an import job, isn't worth surviving
// a server restart — the user just starts pairing again.
// ---------------------------------------------------------------------------

interface PairingState {
  deviceCode: string
  userCode: string
  verificationUrl: string
  expiresAt: Date
  status: 'pending' | 'denied' | 'expired'
}

const pairings = new Map<string, PairingState>()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function pollUntilAuthorized(
  userId: string,
  db: AppEnv['Variables']['db'],
  env: ReturnType<typeof loadEnv>,
  deviceCode: string,
  interval: number,
  expiresInSeconds: number,
) {
  const deadline = Date.now() + expiresInSeconds * 1000
  const authOptions = {
    authBaseUrl: env.TRAKT_AUTH_BASE_URL,
    clientId: env.TRAKT_CLIENT_ID!,
    clientSecret: env.TRAKT_CLIENT_SECRET!,
  }

  while (Date.now() < deadline) {
    await sleep(interval * 1000)
    // The user may have cancelled/restarted pairing while we were asleep.
    const current = pairings.get(userId)
    if (!current || current.deviceCode !== deviceCode) return

    const result = await pollDeviceToken(authOptions, deviceCode)
    if (result.status === 'pending') continue
    if (result.status !== 'authorized') {
      pairings.set(userId, { ...current, status: result.status })
      return
    }

    // Authorized: learn the username, store the connection, done pairing.
    const client = new TraktClient({
      apiBaseUrl: env.TRAKT_API_BASE_URL,
      clientId: env.TRAKT_CLIENT_ID!,
      accessToken: result.token.access_token,
    })
    const settings = await client.getSettings()
    await db
      .insert(traktConnections)
      .values({
        userId,
        traktUsername: settings.user.username,
        accessTokenEncrypted: encryptSecret(result.token.access_token, env.ENCRYPTION_KEY!),
        refreshTokenEncrypted: encryptSecret(result.token.refresh_token, env.ENCRYPTION_KEY!),
        accessTokenExpiresAt: new Date(Date.now() + result.token.expires_in * 1000),
      })
      .onConflictDoUpdate({
        target: traktConnections.userId,
        set: {
          traktUsername: settings.user.username,
          accessTokenEncrypted: encryptSecret(result.token.access_token, env.ENCRYPTION_KEY!),
          refreshTokenEncrypted: encryptSecret(result.token.refresh_token, env.ENCRYPTION_KEY!),
          accessTokenExpiresAt: new Date(Date.now() + result.token.expires_in * 1000),
          updatedAt: new Date(),
        },
      })
    pairings.delete(userId)
    return
  }
  const current = pairings.get(userId)
  if (current && current.deviceCode === deviceCode) {
    pairings.set(userId, { ...current, status: 'expired' })
  }
}

/** 404s when the instance has no Trakt app configured, rather than every
 * route separately checking — a self-hoster who hasn't set TRAKT_CLIENT_ID
 * shouldn't see a working-looking API for a feature that can't function. */
const requireTraktConfigured = createMiddleware<AppEnv>(async (c, next) => {
  const env = loadEnv()
  if (!env.TRAKT_CLIENT_ID || !env.TRAKT_CLIENT_SECRET) {
    return c.json({ error: 'Trakt import is not configured on this instance' }, 404)
  }
  await next()
  return
})

importRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/import/trakt/device',
    summary: 'Start pairing this account with Trakt (device flow)',
    middleware: [requireTraktConfigured] as const,
    responses: {
      202: {
        description: 'Pairing started',
        content: { 'application/json': { schema: traktDevicePairingSchema } },
      },
    },
  }),
  async (c) => {
    const env = loadEnv()
    const db = c.get('db')
    const userId = c.get('user')!.id

    const codes = await requestDeviceCode({
      authBaseUrl: env.TRAKT_AUTH_BASE_URL,
      clientId: env.TRAKT_CLIENT_ID!,
      clientSecret: env.TRAKT_CLIENT_SECRET!,
    })
    const expiresAt = new Date(Date.now() + codes.expires_in * 1000)
    pairings.set(userId, {
      deviceCode: codes.device_code,
      userCode: codes.user_code,
      verificationUrl: codes.verification_url,
      expiresAt,
      status: 'pending',
    })

    // Fire-and-forget: the poll loop runs for the lifetime of the pairing
    // (bounded by Trakt's own expires_in) independent of this request.
    void pollUntilAuthorized(
      userId,
      db,
      env,
      codes.device_code,
      codes.interval,
      codes.expires_in,
    ).catch((err: unknown) => console.error('Trakt device pairing failed:', err))

    return c.json(
      {
        userCode: codes.user_code,
        verificationUrl: codes.verification_url,
        expiresAt: expiresAt.toISOString(),
        interval: codes.interval,
      },
      202,
    )
  },
)

importRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/import/trakt/connection',
    summary: 'Current Trakt connection / pairing status',
    responses: {
      200: {
        description: 'Connection status',
        content: { 'application/json': { schema: traktConnectionStatusSchema } },
      },
    },
  }),
  async (c) => {
    const userId = c.get('user')!.id
    const [connection] = await c
      .get('db')
      .select()
      .from(traktConnections)
      .where(eq(traktConnections.userId, userId))
      .limit(1)

    const pairing = pairings.get(userId)

    return c.json({
      connected: Boolean(connection),
      username: connection?.traktUsername ?? null,
      ...(pairing && {
        pairing: {
          userCode: pairing.userCode,
          verificationUrl: pairing.verificationUrl,
          expiresAt: pairing.expiresAt.toISOString(),
          status: pairing.status,
        },
      }),
    })
  },
)

importRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/import/trakt/connection',
    summary: 'Disconnect Trakt (deletes stored tokens)',
    responses: { 204: { description: 'Disconnected' } },
  }),
  async (c) => {
    const userId = c.get('user')!.id
    pairings.delete(userId)
    await c.get('db').delete(traktConnections).where(eq(traktConnections.userId, userId))
    return c.body(null, 204)
  },
)

// ---------------------------------------------------------------------------
// ZIP-upload import (docs/TODO.md's "Build ZIP-upload import from Trakt's
// own 'Export now' file") — a file-based alternative to the OAuth device
// flow above, for the case that can't use it at all: Trakt's 2026
// "Community App" policy caps a free account at one connected third-party
// OAuth app at a time, so a free user with a different Trakt-connected app
// (a Plex scrobbler, Kodi plugin, etc.) can't also pair rwnd.tv without
// disconnecting it first or paying for VIP. Deliberately not behind
// requireTraktConfigured — unlike device pairing, this needs no
// TRAKT_CLIENT_ID/SECRET on this instance at all.
// ---------------------------------------------------------------------------

/** Trakt's own export is plain JSON inside a ZIP — a real 11,261-item, many-
 * years history compresses to ~1.1MB, so this leaves generous headroom
 * without risking an unbounded in-memory unzip. */
const MAX_ZIP_UPLOAD_BYTES = 25 * 1024 * 1024

/**
 * Plain route, not `.openapi()` — same multipart-upload reasoning as
 * `PUT /auth/me/avatar` (apps/api/src/routes/auth.ts): a `multipart/form-
 * data` upload doesn't fit the typed-JSON-body convention every other route
 * here uses. `history`/`ratings`/`watchlist`/`dropped` mirror
 * createImportJobRequestSchema's own fields (sent as `'true'`/`'false'` form
 * values, not JSON booleans, since this is a form).
 */
importRoutes.post('/import/trakt/zip', async (c) => {
  const db = c.get('db')
  const metadataProviders = c.get('metadataProviders')
  const userId = c.get('user')!.id

  let form: Awaited<ReturnType<typeof c.req.parseBody>>
  try {
    form = await c.req.parseBody()
  } catch {
    return c.json({ error: 'Malformed request body' }, 400)
  }
  const file = form.file
  if (!(file instanceof File)) {
    return c.json({ error: 'Missing file field' }, 400)
  }
  if (file.size > MAX_ZIP_UPLOAD_BYTES) {
    return c.json({ error: 'File is too large — 25MB maximum' }, 400)
  }

  // Same reasoning as POST /import/trakt's own check above — a clean 409
  // instead of a raw constraint-violation 500 from import_jobs_user_active_idx.
  const [existingActive] = await db
    .select({ id: importJobs.id })
    .from(importJobs)
    .where(and(eq(importJobs.userId, userId), inArray(importJobs.status, ['pending', 'running'])))
    .limit(1)
  if (existingActive) {
    return c.json({ error: 'An import is already in progress' }, 409)
  }

  let parsed: ReturnType<typeof parseTraktZip>
  try {
    parsed = parseTraktZip(new Uint8Array(await file.arrayBuffer()))
  } catch (err) {
    if (err instanceof TraktZipParseError) return c.json({ error: err.message }, 400)
    throw err
  }

  const [job] = await db
    .insert(importJobs)
    .values({
      userId,
      source: 'trakt_zip',
      includeHistory: form.history !== 'false',
      includeRatings: form.ratings !== 'false',
      includeWatchlist: form.watchlist !== 'false',
      includeDropped: form.dropped !== 'false',
    })
    .returning()
  if (!job) throw new Error('Failed to create import job')

  void runTraktZipImport(db, metadataProviders, job.id, parsed).catch((err: unknown) =>
    console.error('Trakt ZIP import failed:', err),
  )

  return c.json(serializeJob(job), 202)
})

// ---------------------------------------------------------------------------
// CSV import — the round-trip path for rwnd.tv's own data export
// (Settings > Database > Export data, apps/api/src/export/build.ts). Lets a
// user re-import that same zip, either back into this instance or into a
// fresh one — see apps/api/src/import/csv-match.ts's doc comment for why
// this doesn't share the Trakt engine above. Same "not behind any
// requireXConfigured gate" reasoning as the Trakt ZIP route: needs no
// external service configured on this instance at all, only the metadata
// providers already configured for everything else.
// ---------------------------------------------------------------------------

/** Same cap as the Trakt ZIP upload — rwnd.tv's own export is far smaller
 * in practice (a real ~11,300-item export zips to ~230KB), but there's no
 * reason to give this a different ceiling. */
const MAX_CSV_ZIP_UPLOAD_BYTES = 25 * 1024 * 1024

/**
 * Plain route, not `.openapi()` — same multipart-upload reasoning as
 * `POST /import/trakt/zip` above.
 */
importRoutes.post('/import/csv', async (c) => {
  const db = c.get('db')
  const metadataProviders = c.get('metadataProviders')
  const userId = c.get('user')!.id

  let form: Awaited<ReturnType<typeof c.req.parseBody>>
  try {
    form = await c.req.parseBody()
  } catch {
    return c.json({ error: 'Malformed request body' }, 400)
  }
  const file = form.file
  if (!(file instanceof File)) {
    return c.json({ error: 'Missing file field' }, 400)
  }
  if (file.size > MAX_CSV_ZIP_UPLOAD_BYTES) {
    return c.json({ error: 'File is too large — 25MB maximum' }, 400)
  }

  const [existingActive] = await db
    .select({ id: importJobs.id })
    .from(importJobs)
    .where(and(eq(importJobs.userId, userId), inArray(importJobs.status, ['pending', 'running'])))
    .limit(1)
  if (existingActive) {
    return c.json({ error: 'An import is already in progress' }, 409)
  }

  let parsed: ReturnType<typeof parseCsvZip>
  try {
    parsed = parseCsvZip(new Uint8Array(await file.arrayBuffer()))
  } catch (err) {
    if (err instanceof CsvZipParseError) return c.json({ error: err.message }, 400)
    throw err
  }

  const [job] = await db
    .insert(importJobs)
    .values({
      userId,
      source: 'csv',
      includeHistory: form.history !== 'false',
      includeRatings: form.ratings !== 'false',
      includeWatchlist: form.watchlist !== 'false',
      includeDropped: form.dropped !== 'false',
    })
    .returning()
  if (!job) throw new Error('Failed to create import job')

  void runCsvImport(db, metadataProviders, job.id, parsed).catch((err: unknown) =>
    console.error('CSV import failed:', err),
  )

  return c.json(serializeJob(job), 202)
})

// ---------------------------------------------------------------------------
// Import jobs
// ---------------------------------------------------------------------------

function serializeJob(row: typeof importJobs.$inferSelect): ImportJob {
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    includeHistory: row.includeHistory,
    includeRatings: row.includeRatings,
    includeWatchlist: row.includeWatchlist,
    includeDropped: row.includeDropped,
    itemsTotal: row.itemsTotal,
    itemsProcessed: row.itemsProcessed,
    itemsImported: row.itemsImported,
    itemsSkipped: row.itemsSkipped,
    failures: row.failures,
    error: row.error,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

importRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/import/trakt',
    summary: 'Start a Trakt import job',
    middleware: [requireTraktConfigured] as const,
    request: {
      body: { content: { 'application/json': { schema: createImportJobRequestSchema } } },
    },
    responses: {
      202: {
        description: 'Import started',
        content: { 'application/json': { schema: importJobSchema } },
      },
      404: { description: 'No Trakt connection for this user' },
      409: { description: 'An import is already in progress' },
    },
  }),
  async (c) => {
    const body = c.req.valid('json')
    const db = c.get('db')
    const metadataProviders = c.get('metadataProviders')
    const env = loadEnv()
    const userId = c.get('user')!.id

    const [connection] = await db
      .select({ id: traktConnections.id })
      .from(traktConnections)
      .where(eq(traktConnections.userId, userId))
      .limit(1)
    if (!connection) {
      return c.json({ error: 'Connect a Trakt account before importing' }, 404)
    }

    // Mirrors the partial unique index import_jobs_user_active_idx — this
    // check just gives a clean 409 instead of a raw constraint-violation
    // 500 for the common case of double-clicking "import".
    const [existingActive] = await db
      .select({ id: importJobs.id })
      .from(importJobs)
      .where(and(eq(importJobs.userId, userId), inArray(importJobs.status, ['pending', 'running'])))
      .limit(1)
    if (existingActive) {
      return c.json({ error: 'An import is already in progress' }, 409)
    }

    const [job] = await db
      .insert(importJobs)
      .values({
        userId,
        includeHistory: body.history,
        includeRatings: body.ratings,
        includeWatchlist: body.watchlist,
        includeDropped: body.dropped,
      })
      .returning()
    if (!job) throw new Error('Failed to create import job')

    void runTraktImport(db, metadataProviders, env, job.id).catch((err: unknown) =>
      console.error('Trakt import failed:', err),
    )

    return c.json(serializeJob(job), 202)
  },
)

importRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/import/jobs',
    summary: "List the current user's import jobs, newest first",
    responses: {
      200: {
        description: 'Jobs',
        content: { 'application/json': { schema: listImportJobsResponseSchema } },
      },
    },
  }),
  async (c) => {
    const rows = await c
      .get('db')
      .select()
      .from(importJobs)
      .where(eq(importJobs.userId, c.get('user')!.id))
      .orderBy(desc(importJobs.createdAt))
    return c.json({ jobs: rows.map(serializeJob) })
  },
)

importRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/import/jobs/{id}',
    summary: 'Get one import job',
    request: { params: z.object({ id: uuidSchema }) },
    responses: {
      200: { description: 'Job', content: { 'application/json': { schema: importJobSchema } } },
      404: { description: 'Job not found' },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const [job] = await c
      .get('db')
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.id, id), eq(importJobs.userId, c.get('user')!.id)))
      .limit(1)
    if (!job) return c.json({ error: 'Job not found' }, 404)
    return c.json(serializeJob(job))
  },
)

importRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/import/jobs/{id}/cancel',
    summary: 'Cancel an in-progress import job',
    request: { params: z.object({ id: uuidSchema }) },
    responses: {
      200: {
        description: 'Cancelled',
        content: { 'application/json': { schema: importJobSchema } },
      },
      404: { description: 'Job not found or not cancellable' },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const db = c.get('db')
    // Filtering by status in the WHERE clause (not after the fact) makes
    // this a single atomic conditional update — a job that's already
    // completed/failed/cancelled just doesn't match and the update is a
    // no-op, rather than racing the import runner's own writes.
    const [updated] = await db
      .update(importJobs)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(
        and(
          eq(importJobs.id, id),
          eq(importJobs.userId, c.get('user')!.id),
          inArray(importJobs.status, ['pending', 'running']),
        ),
      )
      .returning()
    if (!updated) return c.json({ error: 'Job not found' }, 404)
    return c.json(serializeJob(updated))
  },
)
