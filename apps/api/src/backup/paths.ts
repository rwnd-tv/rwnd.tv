import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { loadEnv } from '../env.js'
import { slugify } from '../lib/slug.js'

/** Kept short enough that even a full-width `--<slug>` addition stays
 * comfortably under ext4's 255-byte filename limit alongside the
 * `<timestamp>-<hex>.json` part it's appended to. */
const MAX_SLUG_LENGTH = 50

/**
 * Same pattern `backupIdSchema` in packages/shared/src/schemas/backups.ts
 * validates a route's `{id}` param against — kept as a second, literal
 * check here since this is the one function anything actually joins onto a
 * filesystem path. The route-level check means a malformed id never
 * reaches a handler at all; this one is defence in depth, not the primary
 * guard. The optional `--<slug>` suffix is deliberately restricted to the
 * same `[a-z0-9-]` charset generateBackupId() below produces — bounded in
 * length too, so this stays a strict allow-list rather than merely ruling
 * out `/`.
 */
const BACKUP_ID_RE = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}(--[a-z0-9-]{1,50})?$/

export function isValidBackupId(id: string): boolean {
  return BACKUP_ID_RE.test(id)
}

/**
 * `<compact-ISO-timestamp>-<8 hex>`, optionally followed by `--<slug of
 * the description>`, e.g. `20260821T174213Z-a1b2c3d4--before-trakt-reimport`
 * — makes the file recognisable in a directory listing without opening
 * it, on top of `sanitizeEmailForPath()`'s already-readable directory
 * name. The timestamp-hex part alone still guarantees uniqueness (and
 * keeps the listing sortable by creation time even with the suffix
 * attached), so the slug is purely cosmetic: dropped entirely if the
 * description slugifies to nothing (e.g. all emoji/punctuation) rather
 * than leaving a dangling `--`.
 */
export function generateBackupId(now: Date, description: string): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
  const id = `${stamp}-${randomBytes(4).toString('hex')}`
  const slug = slugify(description).slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '')
  return slug ? `${id}--${slug}` : id
}

/** Everything except this small allow-list gets percent-escaped below —
 * covers every character that actually shows up in a real email address
 * (letters, digits, `@ . _ + -`) so an ordinary email passes through
 * unchanged and reads as itself in a directory listing. */
const SAFE_EMAIL_PATH_CHAR = /[A-Za-z0-9@._+-]/

/**
 * Filesystem-safe form of a user's email, for the backups directory name
 * — see backupUserDir() below. Email is unique (schema.ts's citext unique
 * index) and, unlike displayName, has no route that lets a user change it
 * (see updateProfileRequestSchema), so it's a stable, human-recognizable
 * per-user label — nicer to browse than the raw user id.
 *
 * Escaping (not just trusting the input) is deliberate: Zod's `.email()`
 * doesn't rule out RFC 5322's unquoted local-part allowing `/` (e.g.
 * `a/b@example.com`), which would otherwise land as a stray subdirectory.
 * `%`-escaping every other byte too keeps the whole function injective —
 * two different emails can never collide on the same escaped path — so
 * this still holds the same "one user can never see another's backups"
 * guarantee the userId-keyed version had, without needing a suffix.
 */
function sanitizeEmailForPath(email: string): string {
  return [...email]
    .map((ch) =>
      SAFE_EMAIL_PATH_CHAR.test(ch) ? ch : `%${ch.charCodeAt(0).toString(16).padStart(2, '0')}`,
    )
    .join('')
}

export function backupUserDir(email: string): string {
  const dir = loadEnv().BACKUP_DIR
  if (!dir) throw new Error('BACKUP_DIR is not configured')
  return join(dir, sanitizeEmailForPath(email))
}

export function backupFilePath(email: string, id: string): string {
  if (!isValidBackupId(id)) throw new Error(`Invalid backup id: ${id}`)
  return join(backupUserDir(email), `${id}.json`)
}
