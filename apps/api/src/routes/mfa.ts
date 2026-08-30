import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { and, eq } from 'drizzle-orm'
import {
  confirmTotpRequestSchema,
  confirmTotpResponseSchema,
  disableTotpRequestSchema,
  enrollTotpResponseSchema,
  totpStatusSchema,
} from '@rwnd/shared'
import { userCredentials } from '@rwnd/db'
import type { AppEnv } from '../types.js'
import { loadEnv } from '../env.js'
import { encryptSecret, decryptSecret } from '../lib/crypto.js'
import { generateTotpSecret, otpauthUri, verifyTotp } from '../lib/totp.js'
import { generateRecoveryCodes, hashRecoveryCode } from '../lib/recovery-codes.js'
import { verifyPassword } from '../lib/password.js'
import { logSecurityEvent } from '../lib/security-log.js'
import {
  confirmTotpAndSetRecoveryCodes,
  consumeRecoveryCode,
  deleteTotp,
  getUserTotp,
  replaceRecoveryCodes,
  upsertUnconfirmedTotp,
} from '../lib/mfa.js'

export const mfaRoutes = new OpenAPIHono<AppEnv>()

/** Verifies the "prove you're still you" step shared by disable and
 * regenerate-recovery-codes below: the account's current password, plus
 * either a current TOTP code or an unused recovery code — accepting a
 * recovery code here too, since someone disabling MFA because they lost
 * their authenticator app wouldn't have a TOTP code to give. Returns which
 * kind of code was used (or `null` on failure) so the caller can log
 * `recovery_code_used` distinctly rather than lumping it in with a normal
 * TOTP-confirmed action. */
async function verifyPasswordAndCode(
  db: AppEnv['Variables']['db'],
  userId: string,
  secretEncrypted: string,
  currentPassword: string,
  code: string,
): Promise<'totp' | 'recovery' | null> {
  const [credential] = await db
    .select()
    .from(userCredentials)
    .where(and(eq(userCredentials.userId, userId), eq(userCredentials.type, 'local')))
    .limit(1)
  if (
    !credential?.passwordHash ||
    !(await verifyPassword(credential.passwordHash, currentPassword))
  ) {
    return null
  }

  const env = loadEnv()
  if (
    /^\d{6}$/.test(code) &&
    verifyTotp(decryptSecret(secretEncrypted, env.ENCRYPTION_KEY!), code)
  ) {
    return 'totp'
  }
  if (await consumeRecoveryCode(db, userId, code)) {
    return 'recovery'
  }
  return null
}

mfaRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/auth/mfa/totp',
    summary: 'Whether the current user has TOTP MFA enabled',
    responses: {
      200: { description: 'Status', content: { 'application/json': { schema: totpStatusSchema } } },
    },
  }),
  async (c) => {
    const row = await getUserTotp(c.get('db'), c.get('user')!.id)
    return c.json({ enabled: Boolean(row?.confirmedAt) })
  },
)

mfaRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/auth/mfa/totp/enroll',
    summary: 'Start TOTP enrollment — not active until confirmed',
    responses: {
      200: {
        description: 'Secret and otpauth:// URI for a QR code',
        content: { 'application/json': { schema: enrollTotpResponseSchema } },
      },
      403: { description: 'MFA is already enabled — disable it first to re-enroll' },
      503: { description: 'ENCRYPTION_KEY is not configured on this instance' },
    },
  }),
  async (c) => {
    const db = c.get('db')
    const user = c.get('user')!
    const env = loadEnv()

    if (!env.ENCRYPTION_KEY) {
      return c.json({ error: 'MFA requires ENCRYPTION_KEY to be configured on this instance' }, 503)
    }

    const existing = await getUserTotp(db, user.id)
    if (existing?.confirmedAt) {
      return c.json({ error: 'MFA is already enabled — disable it first to re-enroll' }, 403)
    }

    const secret = generateTotpSecret()
    await upsertUnconfirmedTotp(db, user.id, encryptSecret(secret, env.ENCRYPTION_KEY))
    return c.json({ secret, otpauthUri: otpauthUri(secret, user.email) })
  },
)

mfaRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/auth/mfa/totp/confirm',
    summary: 'Confirm TOTP enrollment with a code, activating it',
    request: { body: { content: { 'application/json': { schema: confirmTotpRequestSchema } } } },
    responses: {
      200: {
        description: 'MFA enabled — recovery codes shown once',
        content: { 'application/json': { schema: confirmTotpResponseSchema } },
      },
      400: { description: 'No enrollment in progress, or the code is incorrect' },
    },
  }),
  async (c) => {
    const db = c.get('db')
    const user = c.get('user')!
    const { code } = c.req.valid('json')
    const env = loadEnv()

    const row = await getUserTotp(db, user.id)
    if (!row || row.confirmedAt) {
      return c.json({ error: 'No enrollment in progress' }, 400)
    }
    if (!verifyTotp(decryptSecret(row.secretEncrypted, env.ENCRYPTION_KEY!), code)) {
      return c.json({ error: 'Incorrect code' }, 400)
    }

    const recoveryCodes = generateRecoveryCodes()
    await confirmTotpAndSetRecoveryCodes(db, user.id, recoveryCodes.map(hashRecoveryCode))
    logSecurityEvent('mfa_enrolled', { userId: user.id })
    return c.json({ recoveryCodes })
  },
)

mfaRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/auth/mfa/totp/disable',
    summary: 'Disable TOTP MFA',
    request: { body: { content: { 'application/json': { schema: disableTotpRequestSchema } } } },
    responses: {
      204: { description: 'Disabled' },
      400: { description: 'MFA is not enabled' },
      403: { description: 'Current password or code is incorrect' },
    },
  }),
  async (c) => {
    const db = c.get('db')
    const user = c.get('user')!
    const { currentPassword, code } = c.req.valid('json')

    const row = await getUserTotp(db, user.id)
    if (!row?.confirmedAt) {
      return c.json({ error: 'MFA is not enabled' }, 400)
    }

    const usedVia = await verifyPasswordAndCode(
      db,
      user.id,
      row.secretEncrypted,
      currentPassword,
      code,
    )
    if (!usedVia) {
      return c.json({ error: 'Current password or code is incorrect' }, 403)
    }

    await deleteTotp(db, user.id)
    logSecurityEvent('mfa_disabled', { userId: user.id })
    if (usedVia === 'recovery') {
      logSecurityEvent('recovery_code_used', { userId: user.id })
    }
    return c.body(null, 204)
  },
)

mfaRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/auth/mfa/totp/recovery-codes',
    summary: 'Invalidate existing recovery codes and generate a fresh set',
    request: {
      body: { content: { 'application/json': { schema: disableTotpRequestSchema } } },
    },
    responses: {
      200: {
        description: 'New recovery codes, shown once',
        content: { 'application/json': { schema: confirmTotpResponseSchema } },
      },
      400: { description: 'MFA is not enabled' },
      403: { description: 'Current password or code is incorrect' },
    },
  }),
  async (c) => {
    const db = c.get('db')
    const user = c.get('user')!
    const { currentPassword, code } = c.req.valid('json')

    const row = await getUserTotp(db, user.id)
    if (!row?.confirmedAt) {
      return c.json({ error: 'MFA is not enabled' }, 400)
    }

    const usedVia = await verifyPasswordAndCode(
      db,
      user.id,
      row.secretEncrypted,
      currentPassword,
      code,
    )
    if (!usedVia) {
      return c.json({ error: 'Current password or code is incorrect' }, 403)
    }

    const recoveryCodes = generateRecoveryCodes()
    await replaceRecoveryCodes(db, user.id, recoveryCodes.map(hashRecoveryCode))
    logSecurityEvent('mfa_recovery_codes_regenerated', { userId: user.id })
    if (usedVia === 'recovery') {
      logSecurityEvent('recovery_code_used', { userId: user.id })
    }
    return c.json({ recoveryCodes })
  },
)
