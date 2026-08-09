import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { AppEnv } from '../types.js'

export const healthRoutes = new OpenAPIHono<AppEnv>()

healthRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/health',
    summary: 'Liveness check',
    responses: {
      200: {
        description: 'The API is up',
        content: { 'application/json': { schema: z.object({ status: z.literal('ok') }) } },
      },
    },
  }),
  (c) => c.json({ status: 'ok' as const }),
)
