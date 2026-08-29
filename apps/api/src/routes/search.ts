import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { searchQuerySchema, searchResponseSchema } from '@rwnd/shared'
import type { AppEnv } from '../types.js'

export const searchRoutes = new OpenAPIHono<AppEnv>()

searchRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/search',
    summary: 'Search for movies and shows via the configured metadata provider',
    request: { query: searchQuerySchema },
    responses: {
      200: {
        description: 'Search results',
        content: { 'application/json': { schema: searchResponseSchema } },
      },
    },
  }),
  async (c) => {
    const { q, type } = c.req.valid('query')
    const provider = c.get('metadataProvider')
    const user = c.get('user')!

    const results = await provider.searchMulti(q, user.locale)
    const filtered = type === 'all' ? results : results.filter((r) => r.type === type)

    return c.json({
      results: filtered.map((r) => ({
        type: r.type,
        source: provider.source,
        externalId: r.externalId,
        title: r.title,
        year: r.year,
        overview: r.overview,
        posterPath: r.posterPath,
      })),
    })
  },
)
