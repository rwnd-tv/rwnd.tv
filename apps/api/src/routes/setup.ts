import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { inArray } from 'drizzle-orm'
import { setupRequestSchema, userSchema } from '@rwnd/shared'
import { users, userCredentials } from '@rwnd/db'
import type { AppEnv } from '../types.js'
import { loadEnv } from '../env.js'
import { rateLimit } from '../middleware/rate-limit.js'
import { hashPassword } from '../lib/password.js'
import { isPasswordPwned } from '../lib/hibp.js'
import { createSession } from '../lib/session.js'
import { setSessionCookie } from '../lib/cookies.js'
import { serializeUser } from '../lib/serialize.js'
import { isEmailConfigured } from '../lib/email.js'
import { ensureDefaultWatchlist } from '../lib/watchlists.js'

export const setupRoutes = new OpenAPIHono<AppEnv>()

// Counts `owner` alongside `admin` (M4 "owner" role work,
// docs/TODO_ARCHIVE.md) — the very first account created here is now
// `owner`, not `admin` (see the insert below), so checking `role = 'admin'`
// alone would make setup think it still needs to run after it just did.
async function adminExists(db: AppEnv['Variables']['db']): Promise<boolean> {
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.role, ['admin', 'owner']))
    .limit(1)
  return Boolean(admin)
}

setupRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/setup',
    summary: 'Whether first-run setup still needs to be completed',
    responses: {
      200: {
        description: 'Setup status',
        content: { 'application/json': { schema: z.object({ required: z.boolean() }) } },
      },
    },
  }),
  async (c) => {
    const required = !(await adminExists(c.get('db')))
    return c.json({ required })
  },
)

setupRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/setup',
    summary: 'Create the first admin account',
    middleware: [rateLimit({ name: 'setup', limit: 5, windowMs: 60 * 60 * 1000 })] as const,
    request: { body: { content: { 'application/json': { schema: setupRequestSchema } } } },
    responses: {
      201: {
        description: 'Admin account created',
        content: { 'application/json': { schema: userSchema } },
      },
      400: { description: 'Password has appeared in a known data breach' },
      403: { description: 'Email is not configured on this instance' },
      409: { description: 'Setup has already been completed' },
    },
  }),
  async (c) => {
    const db = c.get('db')
    if (await adminExists(db)) {
      return c.json({ error: 'Setup has already been completed' }, 409)
    }

    // The first admin's address goes through the same account-management
    // machinery as everyone else's (change-email, password reset), all of
    // which needs SMTP — so this instance can't be set up at all without
    // it, rather than quietly leaving the admin's own email unconfirmable.
    if (!isEmailConfigured()) {
      return c.json({ error: 'Email must be configured before this instance can be set up' }, 403)
    }

    const body = c.req.valid('json')

    // Same breach check as /auth/register (ASVS V2.1.7, docs/TODO.md) — the
    // first admin account is the highest-value credential on a self-hosted
    // instance, no reason to exempt it.
    if (await isPasswordPwned(body.password)) {
      return c.json(
        { error: 'This password has appeared in a data breach — please choose a different one' },
        400,
      )
    }

    const passwordHash = await hashPassword(body.password)

    const [user] = await db
      .insert(users)
      .values({
        email: body.email,
        displayName: body.displayName,
        // The very first account is the owner, not a plain admin (M4
        // "owner" role work, docs/TODO_ARCHIVE.md) — the person physically
        // deploying this instance is exactly who the owner role protects:
        // no other admin can ever demote or delete them, only they can
        // hand the role on (POST /auth/me/transfer-ownership).
        role: 'owner',
        // Pre-verified rather than sent a verification email like a normal
        // registration (auth.ts's /auth/register) would — this is the
        // person physically deploying/configuring the instance, not
        // someone whose address needs confirming, and SMTP likely isn't
        // even configured yet at this point in a fresh deployment anyway.
        emailVerifiedAt: new Date(),
        // See registerRequestSchema's doc comment on `locale`.
        ...(body.locale ? { locale: body.locale } : {}),
      })
      .returning()
    if (!user) throw new Error('Failed to create admin user')

    await db.insert(userCredentials).values({ userId: user.id, type: 'local', passwordHash })
    await ensureDefaultWatchlist(db, user.id)

    const env = loadEnv()
    const { token, expiresAt } = await createSession(db, user.id, {
      userAgent: c.req.header('user-agent'),
      ipAddress: c.req.header('x-forwarded-for') ?? undefined,
    })
    setSessionCookie(c, env, token, expiresAt)

    return c.json(serializeUser(user), 201)
  },
)
