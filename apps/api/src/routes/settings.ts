import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import {
  SUPPORTED_LOCALES,
  instanceSettingsSchema,
  updateInstanceSettingsRequestSchema,
  type InstanceSettings,
  type MetadataProviderSource,
} from '@rwnd/shared'
import { instanceSettings } from '@rwnd/db'
import type { AppEnv } from '../types.js'
import { requireAdmin, requireAuth } from '../middleware/auth.js'
import { loadEnv } from '../env.js'
import { availableProviderSources } from '../providers/index.js'
import { isProviderSource } from '../lib/provider-source.js'

export const settingsRoutes = new OpenAPIHono<AppEnv>()

const DEFAULT_SETTINGS = {
  instanceName: 'rwnd.tv',
  registrationMode: 'closed' as const,
  defaultLocale: 'en-US' as const,
  metadataProviderPriority: ['tmdb'] as MetadataProviderSource[],
}

function isSupportedLocale(value: string): value is InstanceSettings['defaultLocale'] {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/** Narrows a DB row's free-form `defaultLocale`/`metadataProviderPriority`
 * columns to the unions the API promises. */
function serializeSettings(row?: {
  instanceName: string
  registrationMode: InstanceSettings['registrationMode']
  defaultLocale: string
  metadataProviderPriority: string[]
}): InstanceSettings {
  const source = row ?? DEFAULT_SETTINGS
  const available = availableProviderSources(loadEnv())
  const availableSet = new Set(available)
  // Drops anything the stored list names that this instance doesn't (or no
  // longer) have credentials for — isProviderSource alone only checks it's
  // a real MetadataProviderSource *type* (e.g. rejects 'not-a-real-
  // provider'), not that it's actually configured *here*, so a plain type
  // guard would wrongly keep a provider whose credentials were since
  // removed. Then appends any available provider the stored list doesn't
  // mention — same "newly-available, not yet invisible" behaviour as
  // orderedProviders() (apps/api/src/providers/priority.ts), and required
  // here too: this is the only list the Settings UI's reorder controls
  // ever see, so a provider missing from it can't be discovered or
  // reordered from the UI at all, only by editing the DB row directly.
  // Since `available` is always non-empty (guaranteed at boot), the result
  // is always non-empty too — no separate empty-list fallback needed.
  const stored = source.metadataProviderPriority.filter(
    (value): value is MetadataProviderSource => isProviderSource(value) && availableSet.has(value),
  )
  const priority = [...stored, ...available.filter((s) => !stored.includes(s))]
  return {
    instanceName: source.instanceName,
    registrationMode: source.registrationMode,
    defaultLocale: isSupportedLocale(source.defaultLocale)
      ? source.defaultLocale
      : DEFAULT_SETTINGS.defaultLocale,
    metadataProviderPriority: priority,
    availableMetadataProviders: available,
    environmentLabel: loadEnv().ENVIRONMENT_LABEL ?? null,
    traktConfigured: Boolean(loadEnv().TRAKT_CLIENT_ID && loadEnv().TRAKT_CLIENT_SECRET),
    backupsConfigured: Boolean(loadEnv().BACKUP_DIR),
    emailConfigured: Boolean(loadEnv().SMTP_HOST),
  }
}

// Instance name / registration mode / default locale are not sensitive —
// the login and setup screens need to read them before anyone is
// authenticated (e.g. to decide whether to show a "Register" link). PATCH
// below is gated on admin explicitly in its own handler chain, rather than
// via app.use('/settings', ...), since that would match this GET too.
settingsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/settings',
    summary: 'Public instance settings',
    responses: {
      200: {
        description: 'Instance settings',
        content: { 'application/json': { schema: instanceSettingsSchema } },
      },
    },
  }),
  async (c) => {
    const [row] = await c.get('db').select().from(instanceSettings).limit(1)
    return c.json(serializeSettings(row))
  },
)

settingsRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/settings',
    summary: 'Update instance settings (admin only)',
    middleware: [requireAuth, requireAdmin] as const,
    request: {
      body: { content: { 'application/json': { schema: updateInstanceSettingsRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Updated',
        content: { 'application/json': { schema: instanceSettingsSchema } },
      },
      400: {
        description:
          'metadataProviderPriority names a provider this instance has no credentials for',
      },
      403: { description: 'Admin only' },
    },
  }),
  async (c) => {
    const body = c.req.valid('json')
    const db = c.get('db')

    if (body.metadataProviderPriority) {
      // Zod's own metadataProviderSourceSchema already rejects a value
      // outside the type; this is the further "must be configured on
      // *this* instance" check that can't be expressed declaratively.
      const available = new Set(availableProviderSources(loadEnv()))
      const unknown = body.metadataProviderPriority.filter((source) => !available.has(source))
      if (unknown.length > 0) {
        return c.json({ error: `Not configured on this instance: ${unknown.join(', ')}` }, 400)
      }
    }

    const [updated] = await db
      .insert(instanceSettings)
      .values({ id: 1, ...DEFAULT_SETTINGS, ...body })
      .onConflictDoUpdate({ target: instanceSettings.id, set: { ...body, updatedAt: new Date() } })
      .returning()
    if (!updated) throw new Error('Failed to update instance settings')
    return c.json(serializeSettings(updated))
  },
)
