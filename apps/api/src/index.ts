import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { loadEnv } from './env.js'

const env = loadEnv()
const app = createApp()

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`rwnd.tv API listening on http://localhost:${info.port}`)
  console.log(`OpenAPI docs: http://localhost:${info.port}/api/docs`)
})
