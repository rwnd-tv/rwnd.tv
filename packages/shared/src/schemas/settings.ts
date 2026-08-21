import { z } from 'zod'
import { localeSchema } from './common.js'

export const registrationModeSchema = z.enum(['open', 'invite', 'closed'])
export type RegistrationMode = z.infer<typeof registrationModeSchema>

export const instanceSettingsSchema = z.object({
  instanceName: z.string(),
  registrationMode: registrationModeSchema,
  defaultLocale: localeSchema,
  // Set via the ENVIRONMENT_LABEL env var at deploy time, not admin-editable
  // here — see apps/api/src/env.ts.
  environmentLabel: z.string().nullable(),
  // True when this instance has TRAKT_CLIENT_ID/SECRET configured — the web
  // app hides the /import page entirely when false, since none of its
  // routes would work without a Trakt app registered.
  traktConfigured: z.boolean(),
  // True when this instance has BACKUP_DIR configured — same reasoning as
  // traktConfigured above. The web app hides the Backups section of the
  // Database panel when false, since /backups has nowhere to write.
  backupsConfigured: z.boolean(),
})
export type InstanceSettings = z.infer<typeof instanceSettingsSchema>

export const updateInstanceSettingsRequestSchema = instanceSettingsSchema
  .omit({ environmentLabel: true, traktConfigured: true, backupsConfigured: true })
  .partial()
export type UpdateInstanceSettingsRequest = z.infer<typeof updateInstanceSettingsRequestSchema>
