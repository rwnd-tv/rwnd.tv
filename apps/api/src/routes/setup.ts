import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { eq } from 'drizzle-orm'
import { setupRequestSchema, userSchema } from '@rwnd/shared'
import { users, userCredentials } from '@rwnd/db'
import type { AppEnv } from '../types.js'
import { loadEnv } from '../env.js'
import { hashPassword } from '../lib/password.js'
import { createSession } from '../lib/session.js'
import { setSessionCookie } from '../lib/cookies.js'
import { serializeUser } from '../lib/serialize.js'

export const setupRoutes = new OpenAPIHono<AppEnv>()

async function adminExists(db: AppEnv['Variables']['db']): Promise<boolean> {
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'admin'))
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
    request: { body: { content: { 'application/json': { schema: setupRequestSchema } } } },
    responses: {
      201: {
        description: 'Admin account created',
        content: { 'application/json': { schema: userSchema } },
      },
      409: { description: 'Setup has already been completed' },
    },
  }),
  async (c) => {
    const db = c.get('db')
    if (await adminExists(db)) {
      return c.json({ error: 'Setup has already been completed' }, 409)
    }

    const body = c.req.valid('json')
    const passwordHash = await hashPassword(body.password)

    const [user] = await db
      .insert(users)
      .values({
        email: body.email,
        displayName: body.displayName,
        role: 'admin',
        // See registerRequestSchema's doc comment on `locale`.
        ...(body.locale ? { locale: body.locale } : {}),
      })
      .returning()
    if (!user) throw new Error('Failed to create admin user')

    await db.insert(userCredentials).values({ userId: user.id, type: 'local', passwordHash })

    const env = loadEnv()
    const { token, expiresAt } = await createSession(db, user.id, {
      userAgent: c.req.header('user-agent'),
      ipAddress: c.req.header('x-forwarded-for') ?? undefined,
    })
    setSessionCookie(c, env, token, expiresAt)

    return c.json(serializeUser(user), 201)
  },
)
