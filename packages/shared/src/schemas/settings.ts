import { z } from 'zod'
import { localeSchema, metadataProviderSourceSchema } from './common.js'

export const registrationModeSchema = z.enum(['open', 'invite', 'closed'])
export type RegistrationMode = z.infer<typeof registrationModeSchema>

export const instanceSettingsSchema = z.object({
  instanceName: z.string(),
  registrationMode: registrationModeSchema,
  defaultLocale: localeSchema,
  // Admin-configured metadata provider preference order, highest priority
  // first — see docs/adr/0006. Always contains every provider this
  // instance has credentials for (server-side, never empty); left in (not
  // omitted below) so it's patchable via the same
  // instanceSettingsSchema.omit().partial() derivation every other
  // admin-editable field uses.
  metadataProviderPriority: z.array(metadataProviderSourceSchema).min(1),
  // Which providers this instance actually has credentials for — env-
  // derived, not admin-editable (same convention as environmentLabel
  // below). Lets the Settings UI show what a priority edit is choosing
  // among, and lets the API reject a priority list naming something this
  // instance can't actually use.
  availableMetadataProviders: z.array(metadataProviderSourceSchema),
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
  // True when this instance has SMTP_HOST (+ its required companions —
  // apps/api/src/env.ts) configured. Gates the two routes that actually
  // send mail (POST /auth/forgot-password, POST /auth/resend-verification
  // — both 404 when false, apps/api/src/routes/auth.ts's
  // requireEmailConfigured) and, on the web app, LoginPage's "Forgot
  // password?" link and ProfilePage's resend-verification action.
  // Redeeming a token you already have (POST /auth/reset-password,
  // POST /auth/verify-email) isn't gated by this — that only needs the
  // token to still be valid, not SMTP to be configured right now.
  emailConfigured: z.boolean(),
  // True when this instance has ENCRYPTION_KEY configured — same reasoning
  // as traktConfigured/backupsConfigured above. TOTP secrets are encrypted
  // at rest the same way Trakt tokens are (apps/api/src/lib/crypto.ts), so
  // the web app hides the Account page's "Enable MFA" option when false
  // rather than letting someone start enrolling into a feature that'll
  // 503 on confirmation.
  mfaAvailable: z.boolean(),
  // This package's own package.json `version` — see apps/api/src/version.ts.
  // Derived, not admin-editable, same convention as environmentLabel above.
  appVersion: z.string(),
  // Optional admin-set contact address, null until set. Deliberately on
  // this public schema (not instanceAboutSchema below) — same reasoning
  // as instanceName/registrationMode: it's meant to be readable by an
  // anonymous visitor (e.g. "trouble signing up? contact ___"), and an
  // operator who doesn't want that just never sets it.
  adminEmail: z.string().trim().email().nullable(),
})
export type InstanceSettings = z.infer<typeof instanceSettingsSchema>

export const updateInstanceSettingsRequestSchema = instanceSettingsSchema
  .omit({
    availableMetadataProviders: true,
    environmentLabel: true,
    traktConfigured: true,
    backupsConfigured: true,
    emailConfigured: true,
    mfaAvailable: true,
    appVersion: true,
  })
  .partial()
export type UpdateInstanceSettingsRequest = z.infer<typeof updateInstanceSettingsRequestSchema>

// Richer runtime diagnostics for the Settings > About panel — deliberately
// on its own authenticated-only route (GET /settings/about), not folded
// into instanceSettingsSchema above: that one is intentionally readable
// pre-login (the login/setup screens need instanceName/registrationMode
// before anyone's authenticated), and letting an anonymous internet
// visitor fingerprint the exact Node/Postgres versions this instance runs
// is a materially different exposure than a bare app version number.
export const instanceAboutSchema = z.object({
  nodeVersion: z.string(),
  postgresVersion: z.string(),
  // Count of applied drizzle migrations (drizzle.__drizzle_migrations),
  // not a migration name/tag — apps/api has no access to
  // packages/db/drizzle/meta/_journal.json's tag names at runtime (a
  // separate deployed package, see docker-entrypoint.sh), and the DB
  // itself is the only thing that can say what's actually applied here
  // anyway, same reasoning as reading everything else in this schema live
  // rather than from a build-time constant.
  migrationCount: z.number(),
  uptimeSeconds: z.number(),
  environmentLabel: z.string().nullable(),
})
export type InstanceAbout = z.infer<typeof instanceAboutSchema>
