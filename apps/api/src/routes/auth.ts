import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { and, eq, isNull, gt } from 'drizzle-orm'
import {
  loginRequestSchema,
  registerRequestSchema,
  updateProfileRequestSchema,
  userSchema,
} from '@rwnd/shared'
import { users, userCredentials, instanceSettings, invites } from '@rwnd/db'
import type { AppEnv } from '../types.js'
import { loadEnv } from '../env.js'
import { hashPassword, verifyPassword } from '../lib/password.js'
import { createSession, revokeSession } from '../lib/session.js'
import { setSessionCookie, clearSessionCookie } from '../lib/cookies.js'
import { serializeUser } from '../lib/serialize.js'
import { hashSecret } from '../lib/tokens.js'
import { requireAuth } from '../middleware/auth.js'
import { getCookie } from 'hono/cookie'

export const authRoutes = new OpenAPIHono<AppEnv>()

authRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/auth/login',
    summary: 'Log in with email and password',
    request: { body: { content: { 'application/json': { schema: loginRequestSchema } } } },
    responses: {
      200: { description: 'Logged in', content: { 'application/json': { schema: userSchema } } },
      401: { description: 'Invalid credentials' },
    },
  }),
  async (c) => {
    const db = c.get('db')
    const { email, password } = c.req.valid('json')

    const [row] = await db
      .select({ user: users, credential: userCredentials })
      .from(users)
      .innerJoin(
        userCredentials,
        and(eq(userCredentials.userId, users.id), eq(userCredentials.type, 'local')),
      )
      .where(eq(users.email, email))
      .limit(1)

    // Same generic error whether the email is unknown or the password is
    // wrong — don't let login responses reveal which accounts exist.
    if (!row || !row.credential.passwordHash) {
      return c.json({ error: 'Invalid email or password' }, 401)
    }
    const valid = await verifyPassword(row.credential.passwordHash, password)
    if (!valid) {
      return c.json({ error: 'Invalid email or password' }, 401)
    }

    const env = loadEnv()
    const { token, expiresAt } = await createSession(db, row.user.id, {
      userAgent: c.req.header('user-agent'),
      ipAddress: c.req.header('x-forwarded-for') ?? undefined,
    })
    setSessionCookie(c, env, token, expiresAt)

    return c.json(serializeUser(row.user), 200)
  },
)

authRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/auth/register',
    summary: 'Create an account, subject to the instance registration policy',
    request: { body: { content: { 'application/json': { schema: registerRequestSchema } } } },
    responses: {
      201: {
        description: 'Account created',
        content: { 'application/json': { schema: userSchema } },
      },
      403: { description: 'Registration is not open' },
      409: { description: 'Email already in use' },
    },
  }),
  async (c) => {
    const db = c.get('db')
    const body = c.req.valid('json')

    const [settings] = await db.select().from(instanceSettings).limit(1)
    const registrationMode = settings?.registrationMode ?? 'closed'

    let usedInvite: { id: string } | undefined
    if (registrationMode === 'closed') {
      return c.json({ error: 'Registration is not open on this instance' }, 403)
    }
    if (registrationMode === 'invite') {
      if (!body.inviteCode) {
        return c.json({ error: 'An invite code is required' }, 403)
      }
      const [invite] = await db
        .select()
        .from(invites)
        .where(
          and(
            eq(invites.codeHash, hashSecret(body.inviteCode)),
            isNull(invites.usedBy),
            gt(invites.expiresAt, new Date()),
          ),
        )
        .limit(1)
      if (!invite) {
        return c.json({ error: 'Invalid or expired invite code' }, 403)
      }
      usedInvite = invite
    }

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1)
    if (existing) {
      return c.json({ error: 'Email already in use' }, 409)
    }

    const passwordHash = await hashPassword(body.password)
    const [user] = await db
      .insert(users)
      .values({
        email: body.email,
        displayName: body.displayName,
        role: 'user',
        // Falls back to the users.locale column default when the browser's
        // language didn't match a supported locale — see
        // setupRequestSchema's doc comment on `locale`.
        ...(body.locale ? { locale: body.locale } : {}),
      })
      .returning()
    if (!user) throw new Error('Failed to create user')

    await db.insert(userCredentials).values({ userId: user.id, type: 'local', passwordHash })

    if (usedInvite) {
      await db.update(invites).set({ usedBy: user.id }).where(eq(invites.id, usedInvite.id))
    }

    const env = loadEnv()
    const { token, expiresAt } = await createSession(db, user.id, {
      userAgent: c.req.header('user-agent'),
      ipAddress: c.req.header('x-forwarded-for') ?? undefined,
    })
    setSessionCookie(c, env, token, expiresAt)

    return c.json(serializeUser(user), 201)
  },
)

authRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/auth/logout',
    summary: 'End the current session',
    responses: { 204: { description: 'Logged out' } },
  }),
  async (c) => {
    const env = loadEnv()
    const token = getCookie(c, env.SESSION_COOKIE_NAME)
    if (token) await revokeSession(c.get('db'), token)
    clearSessionCookie(c, env)
    return c.body(null, 204)
  },
)

authRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/auth/me',
    summary: 'The current user',
    middleware: [requireAuth] as const,
    responses: {
      200: { description: 'Current user', content: { 'application/json': { schema: userSchema } } },
      401: { description: 'Not logged in' },
    },
  }),
  (c) => c.json(serializeUser(c.get('user')!), 200),
)

authRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/auth/me',
    summary: "Update the current user's profile",
    middleware: [requireAuth] as const,
    request: {
      body: { content: { 'application/json': { schema: updateProfileRequestSchema } } },
    },
    responses: {
      200: { description: 'Updated', content: { 'application/json': { schema: userSchema } } },
      401: { description: 'Not logged in' },
    },
  }),
  async (c) => {
    const db = c.get('db')
    const body = c.req.valid('json')
    const [updated] = await db
      .update(users)
      .set(body)
      .where(eq(users.id, c.get('user')!.id))
      .returning()
    if (!updated) throw new Error('Failed to update user')
    return c.json(serializeUser(updated), 200)
  },
)

/** 2MB — generous for a profile photo (most phone camera apps' own
 * "share"/messaging-size export already lands well under this) without
 * risking an unbounded row in `users.avatar_image`. No resizing/compression
 * happens server-side (no image-processing dependency in this codebase),
 * so this is the only real cap on stored size. */
const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const ALLOWED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

/**
 * Plain routes, not `.openapi()` — same reasoning as
 * `apps/api/src/routes/webhooks.ts`'s Plex route: a `multipart/form-data`
 * upload and a raw-binary response don't fit the typed-JSON-body/response
 * convention every other route here uses.
 */
authRoutes.put('/auth/me/avatar', requireAuth, async (c) => {
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
  if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
    return c.json({ error: 'Unsupported image type — use JPEG, PNG, or WebP' }, 400)
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return c.json({ error: 'Image is too large — 2MB maximum' }, 400)
  }

  const db = c.get('db')
  const buffer = Buffer.from(await file.arrayBuffer())
  const [updated] = await db
    .update(users)
    .set({ avatarImage: buffer, avatarMimeType: file.type, avatarUpdatedAt: new Date() })
    .where(eq(users.id, c.get('user')!.id))
    .returning()
  if (!updated) throw new Error('Failed to update user')
  return c.json(serializeUser(updated), 200)
})

authRoutes.delete('/auth/me/avatar', requireAuth, async (c) => {
  const db = c.get('db')
  const [updated] = await db
    .update(users)
    .set({ avatarImage: null, avatarMimeType: null, avatarUpdatedAt: null })
    .where(eq(users.id, c.get('user')!.id))
    .returning()
  if (!updated) throw new Error('Failed to update user')
  return c.json(serializeUser(updated), 200)
})

authRoutes.get('/auth/me/avatar', requireAuth, async (c) => {
  const db = c.get('db')
  const [row] = await db
    .select({ avatarImage: users.avatarImage, avatarMimeType: users.avatarMimeType })
    .from(users)
    .where(eq(users.id, c.get('user')!.id))
    .limit(1)
  if (!row?.avatarImage || !row.avatarMimeType) {
    return c.json({ error: 'No avatar set' }, 404)
  }
  // Safe to cache aggressively: the frontend always requests this through
  // a `?v=avatarUpdatedAt`-suffixed URL (Avatar.tsx), so a new upload is a
  // new URL, never a stale cache hit.
  c.header('Content-Type', row.avatarMimeType)
  c.header('Cache-Control', 'private, max-age=31536000, immutable')
  // Node's Buffer (ArrayBufferLike-backed) isn't assignable to Hono's
  // Data type (Uint8Array<ArrayBuffer>-backed) — copy into a plain one.
  return c.body(Uint8Array.from(row.avatarImage))
})
