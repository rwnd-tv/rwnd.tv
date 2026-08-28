import { OpenAPIHono } from '@hono/zod-openapi'
import type { AppEnv } from '../../types.js'
import { showRoutes } from './shows.js'
import { movieRoutes } from './movies.js'
import { seasonRoutes } from './seasons.js'
import { ratingRoutes } from './ratings.js'
import { queueRoutes } from './queue.js'

export const libraryRoutes = new OpenAPIHono<AppEnv>()
libraryRoutes.route('/', showRoutes)
libraryRoutes.route('/', movieRoutes)
libraryRoutes.route('/', seasonRoutes)
libraryRoutes.route('/', ratingRoutes)
libraryRoutes.route('/', queueRoutes)
