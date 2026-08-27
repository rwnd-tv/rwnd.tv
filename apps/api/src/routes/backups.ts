import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { createMiddleware } from 'hono/factory'
import {
  BACKUP_FORMAT_VERSION,
  backupFileSchema,
  backupFileSchemaV1,
  backupFileSchemaV2,
  backupIdSchema,
  backupSummarySchema,
  createBackupRequestSchema,
  diffBackupResponseSchema,
  listBackupsResponseSchema,
  restoreBackupResponseSchema,
} from '@rwnd/shared'
import type { AppEnv } from '../types.js'
import { requireAuth } from '../middleware/auth.js'
import { loadEnv } from '../env.js'
import { buildBackupFile } from '../backup/build.js'
import { restoreBackupFile } from '../backup/restore.js'
import { computeBackupDiff } from '../backup/diff.js'
import { migrateLegacyBackupFile, migrateV2BackupFile } from '../backup/legacy.js'
import {
  backupFilePath,
  backupUserDir,
  generateBackupId,
  isValidBackupId,
} from '../backup/paths.js'

export const backupRoutes = new OpenAPIHono<AppEnv>()

/** Reads and validates one backup file, shared by the restore and diff
 * routes below — both need the exact same "not found" / "corrupt" /
 * "incompatible version" handling before they can do anything with the
 * file's contents. An older file parses fine against its own frozen schema
 * (backups-v1.ts/backups-v2.ts) and is up-converted before being handed
 * back — see legacy.ts's doc comments for why each transition is safe to
 * do silently, unlike a version this code doesn't know how to migrate. */
async function loadBackupFile(
  email: string,
  id: string,
): Promise<
  | { ok: true; data: ReturnType<typeof backupFileSchema.parse> }
  | { ok: false; status: 404 | 400; error: string }
> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(backupFilePath(email, id), 'utf-8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, status: 404, error: 'Backup not found' }
    }
    return { ok: false, status: 400, error: 'Backup file is corrupt' }
  }

  const parsed = backupFileSchema.safeParse(raw)
  if (parsed.success) return { ok: true, data: parsed.data }

  const v2 = backupFileSchemaV2.safeParse(raw)
  if (v2.success) return { ok: true, data: migrateV2BackupFile(v2.data) }

  const v1 = backupFileSchemaV1.safeParse(raw)
  if (v1.success) return { ok: true, data: migrateLegacyBackupFile(v1.data) }

  // A stale/foreign formatVersion is by far the most likely reason every
  // parse failed, and the one worth naming — everything else collapses to
  // "corrupt", same as the JSON.parse failure above. Checked before
  // reporting the generic error, not instead of full-shape validation.
  const knownVersions: unknown[] = [BACKUP_FORMAT_VERSION, 1, 2]
  const versionMismatch =
    typeof raw === 'object' &&
    raw !== null &&
    'formatVersion' in raw &&
    !knownVersions.includes((raw as { formatVersion: unknown }).formatVersion)
  return {
    ok: false,
    status: 400,
    error: versionMismatch
      ? 'This backup was written by an incompatible version of rwnd.tv'
      : 'Backup file is corrupt',
  }
}

/** 404s when the instance has no BACKUP_DIR configured, same reasoning and
 * shape as requireTraktConfigured in apps/api/src/routes/imports.ts — a
 * self-hoster who hasn't mounted a backup directory shouldn't see a
 * working-looking API for a feature that has nowhere to write. */
const requireBackupsConfigured = createMiddleware<AppEnv>(async (c, next) => {
  if (!loadEnv().BACKUP_DIR) {
    return c.json({ error: 'Backups are not configured on this instance' }, 404)
  }
  await next()
})

/**
 * Backs the Database panel's Backups section
 * (apps/web/src/components/settings/DatabasePanel.tsx). Reads every file's
 * full contents to get its header fields — see backupFileSchema's doc
 * comment in packages/shared/src/schemas/backups.ts for why a per-user
 * backup file is small enough that this is cheap.
 */
backupRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/backups',
    summary: "List the current user's database backups, newest first",
    middleware: [requireAuth, requireBackupsConfigured] as const,
    responses: {
      200: {
        description: 'Backups',
        content: { 'application/json': { schema: listBackupsResponseSchema } },
      },
    },
  }),
  async (c) => {
    const dir = backupUserDir(c.get('user')!.email)

    let filenames: string[]
    try {
      filenames = await readdir(dir)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return c.json({ backups: [] })
      throw err
    }

    const summaries = await Promise.all(
      filenames
        .filter((name) => name.endsWith('.json'))
        .map(async (name) => {
          const id = name.slice(0, -'.json'.length)
          if (!isValidBackupId(id)) return null
          let raw: unknown
          try {
            raw = JSON.parse(await readFile(`${dir}/${name}`, 'utf-8'))
          } catch {
            return null // corrupt/foreign file — skip rather than fail the whole list
          }
          const parsed = backupFileSchema.safeParse(raw)
          if (!parsed.success) return null
          return {
            id,
            createdAt: parsed.data.createdAt,
            description: parsed.data.description,
            counts: parsed.data.counts,
            skipped: parsed.data.skipped,
          }
        }),
    )

    const backups = summaries
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

    return c.json({ backups })
  },
)

backupRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/backups',
    summary: "Create a backup of the current user's watch history/ratings/watchlist/dropped shows",
    middleware: [requireAuth, requireBackupsConfigured] as const,
    request: { body: { content: { 'application/json': { schema: createBackupRequestSchema } } } },
    responses: {
      201: {
        description: 'Backup created',
        content: { 'application/json': { schema: backupSummarySchema } },
      },
    },
  }),
  async (c) => {
    const { description } = c.req.valid('json')
    const user = c.get('user')!
    const db = c.get('db')
    const now = new Date()

    const file = await buildBackupFile(db, user.id, description, now, c.get('metadataProviders'))
    const id = generateBackupId(now, description)

    await mkdir(backupUserDir(user.email), { recursive: true })
    await writeFile(backupFilePath(user.email, id), JSON.stringify(file), 'utf-8')

    return c.json(
      {
        id,
        createdAt: file.createdAt,
        description: file.description,
        counts: file.counts,
        skipped: file.skipped,
      },
      201,
    )
  },
)

backupRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/backups/{id}/restore',
    summary:
      "Wipe and rewrite the current user's watch history/ratings/watchlist/dropped shows from a backup",
    middleware: [requireAuth, requireBackupsConfigured] as const,
    request: { params: z.object({ id: backupIdSchema }) },
    responses: {
      200: {
        description: 'Restored',
        content: { 'application/json': { schema: restoreBackupResponseSchema } },
      },
      400: { description: 'Backup file is corrupt or incompatible' },
      404: { description: 'Backup not found' },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const user = c.get('user')!
    const db = c.get('db')

    const loaded = await loadBackupFile(user.email, id)
    if (!loaded.ok) return c.json({ error: loaded.error }, loaded.status)

    const counts = await restoreBackupFile(db, user.id, loaded.data)
    return c.json({ counts })
  },
)

backupRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/backups/{id}/diff',
    summary:
      "Compare a backup against the current user's live watch history/ratings/watchlist/dropped shows",
    middleware: [requireAuth, requireBackupsConfigured] as const,
    request: { params: z.object({ id: backupIdSchema }) },
    responses: {
      200: {
        description: 'Diff',
        content: { 'application/json': { schema: diffBackupResponseSchema } },
      },
      400: { description: 'Backup file is corrupt or incompatible' },
      404: { description: 'Backup not found' },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const user = c.get('user')!
    const db = c.get('db')

    const loaded = await loadBackupFile(user.email, id)
    if (!loaded.ok) return c.json({ error: loaded.error }, loaded.status)

    const diff = await computeBackupDiff(db, user.id, loaded.data, c.get('metadataProviders'))
    return c.json({ diff })
  },
)

backupRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/backups/{id}',
    summary: 'Delete one of the current user’s database backups',
    middleware: [requireAuth, requireBackupsConfigured] as const,
    request: { params: z.object({ id: backupIdSchema }) },
    responses: {
      204: { description: 'Deleted' },
      404: { description: 'Backup not found' },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const email = c.get('user')!.email

    try {
      await unlink(backupFilePath(email, id))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return c.json({ error: 'Backup not found' }, 404)
      }
      throw err
    }

    return c.body(null, 204)
  },
)
