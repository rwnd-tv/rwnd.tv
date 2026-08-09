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
      .values({ email: body.email, displayName: body.displayName, role: 'user' })
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
