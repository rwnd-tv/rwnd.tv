import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { and, eq } from 'drizzle-orm'
import {
  apiTokenSchema,
  createApiTokenRequestSchema,
  createApiTokenResponseSchema,
} from '@rwnd/shared'
import { apiTokens } from '@rwnd/db'
import type { AppEnv } from '../types.js'
import { requireAuth } from '../middleware/auth.js'
import { generateApiToken } from '../lib/tokens.js'

export const tokenRoutes = new OpenAPIHono<AppEnv>()

function serializeToken(row: typeof apiTokens.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

tokenRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/tokens',
    summary: "List the current user's API tokens",
    middleware: [requireAuth] as const,
    responses: {
      200: {
        description: 'Tokens',
        content: { 'application/json': { schema: z.object({ tokens: z.array(apiTokenSchema) }) } },
      },
    },
  }),
  async (c) => {
    const rows = await c
      .get('db')
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.userId, c.get('user')!.id))
    return c.json({ tokens: rows.map(serializeToken) })
  },
)

tokenRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/tokens',
    summary: 'Create a new API token (shown once)',
    middleware: [requireAuth] as const,
    request: {
      body: { content: { 'application/json': { schema: createApiTokenRequestSchema } } },
    },
    responses: {
      201: {
        description: 'Token created',
        content: { 'application/json': { schema: createApiTokenResponseSchema } },
      },
    },
  }),
  async (c) => {
    const { name } = c.req.valid('json')
    const { token, hash } = generateApiToken()
    const [row] = await c
      .get('db')
      .insert(apiTokens)
      .values({ userId: c.get('user')!.id, name, tokenHash: hash })
      .returning()
    if (!row) throw new Error('Failed to create token')
    return c.json({ ...serializeToken(row), token }, 201)
  },
)

tokenRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/tokens/{id}',
    summary: 'Revoke an API token',
    middleware: [requireAuth] as const,
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      204: { description: 'Revoked' },
      404: { description: 'Token not found' },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const result = await c
      .get('db')
      .delete(apiTokens)
      .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, c.get('user')!.id)))
      .returning({ id: apiTokens.id })
    if (result.length === 0) return c.json({ error: 'Token not found' }, 404)
    return c.body(null, 204)
  },
)
