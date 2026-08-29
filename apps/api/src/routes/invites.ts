import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { desc, eq } from 'drizzle-orm'
import {
  createInviteResponseSchema,
  listInvitesResponseSchema,
  type InviteStatus,
} from '@rwnd/shared'
import { invites } from '@rwnd/db'
import type { AppEnv } from '../types.js'
import { requireAdmin } from '../middleware/auth.js'
import { generateSecret, hashSecret } from '../lib/tokens.js'
import { logSecurityEvent } from '../lib/security-log.js'

export const inviteRoutes = new OpenAPIHono<AppEnv>()

// A week is generous enough to actually hand off (in person, over chat,
// whenever the recipient gets around to it) without leaving a stale code
// valid indefinitely. Not configurable — nothing in the TODO item asked for
// that, and an admin can always create a fresh one.
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

function statusOf(invite: { usedBy: string | null; expiresAt: Date }): InviteStatus {
  if (invite.usedBy) return 'used'
  if (invite.expiresAt.getTime() < Date.now()) return 'expired'
  return 'pending'
}

/**
 * `registration_mode: 'invite'` was functionally unreachable before this —
 * the `invites` table and redemption path (`POST /auth/register`) both
 * existed and were tested, but nothing anywhere actually created a code
 * for an admin to hand out (F-22, M3 security review follow-up,
 * docs/TODO.md). Instance-wide, not scoped to the creating admin — a
 * self-hoster with multiple admins should see every outstanding invite,
 * not just their own, to avoid duplicating one by accident.
 */
inviteRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/invites',
    summary: 'Create an invite code (admin only)',
    middleware: [requireAdmin] as const,
    responses: {
      201: {
        description: 'Invite created — the code is shown only in this response',
        content: { 'application/json': { schema: createInviteResponseSchema } },
      },
      403: { description: 'Admin only' },
    },
  }),
  async (c) => {
    const db = c.get('db')
    const user = c.get('user')!
    const code = generateSecret(9)
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS)

    const [created] = await db
      .insert(invites)
      .values({ codeHash: hashSecret(code), createdBy: user.id, expiresAt })
      .returning({ id: invites.id })
    if (!created) throw new Error('Failed to create invite')

    logSecurityEvent('invite_created', { userId: user.id })
    return c.json({ id: created.id, code, expiresAt: expiresAt.toISOString() }, 201)
  },
)

inviteRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/invites',
    summary: 'List invite codes, newest first (admin only)',
    middleware: [requireAdmin] as const,
    responses: {
      200: {
        description: 'Invites',
        content: { 'application/json': { schema: listInvitesResponseSchema } },
      },
      403: { description: 'Admin only' },
    },
  }),
  async (c) => {
    const db = c.get('db')
    const rows = await db
      .select({
        id: invites.id,
        usedBy: invites.usedBy,
        expiresAt: invites.expiresAt,
        createdAt: invites.createdAt,
      })
      .from(invites)
      .orderBy(desc(invites.createdAt))

    return c.json({
      invites: rows.map((row) => ({
        id: row.id,
        status: statusOf(row),
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      })),
    })
  },
)

inviteRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/invites/{id}',
    summary: 'Revoke an invite code (admin only)',
    middleware: [requireAdmin] as const,
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      204: { description: 'Revoked' },
      403: { description: 'Admin only' },
      404: { description: 'Invite not found' },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const db = c.get('db')
    const user = c.get('user')!

    const deleted = await db.delete(invites).where(eq(invites.id, id)).returning({ id: invites.id })
    if (deleted.length === 0) return c.json({ error: 'Invite not found' }, 404)

    logSecurityEvent('invite_revoked', { userId: user.id })
    return c.body(null, 204)
  },
)
