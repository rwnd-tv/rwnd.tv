import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { createMiddleware } from 'hono/factory'
import { and, eq, isNull, gt } from 'drizzle-orm'
import {
  loginRequestSchema,
  registerRequestSchema,
  updateProfileRequestSchema,
  forgotPasswordRequestSchema,
  resetPasswordRequestSchema,
  verifyEmailRequestSchema,
  changePasswordRequestSchema,
  changeEmailRequestSchema,
  confirmEmailChangeRequestSchema,
  deleteAccountRequestSchema,
  userSchema,
  listSessionsResponseSchema,
  loginMfaRequestSchema,
  transferOwnershipRequestSchema,
  type MfaRequiredResponse,
} from '@rwnd/shared'
import { users, userCredentials, instanceSettings, invites } from '@rwnd/db'
import type { AppEnv } from '../types.js'
import { loadEnv } from '../env.js'
import { jsonBodyLimit } from '../lib/body-limit.js'
import { rateLimit, tryConsume } from '../middleware/rate-limit.js'
import { isLoginLocked, recordFailedLogin, clearLoginAttempts } from '../lib/login-lockout.js'
import { hashPassword, verifyPassword, verifyDummyPassword } from '../lib/password.js'
import { isPasswordPwned } from '../lib/hibp.js'
import { decryptSecret } from '../lib/crypto.js'
import { verifyTotp } from '../lib/totp.js'
import { getUserTotp, consumeRecoveryCode } from '../lib/mfa.js'
import {
  createMfaChallenge,
  deleteMfaChallenge,
  getMfaChallengeUserId,
} from '../lib/mfa-challenge.js'
import { sniffImageType, extensionFor } from '../lib/image-sniff.js'
import { logSecurityEvent } from '../lib/security-log.js'
import {
  createSession,
  revokeSession,
  revokeAllSessions,
  revokeOtherSessions,
  findSessionId,
  listSessions,
  revokeSessionById,
} from '../lib/session.js'
import { setSessionCookie, clearSessionCookie, getSessionToken } from '../lib/cookies.js'
import { serializeUser } from '../lib/serialize.js'
import { hashSecret } from '../lib/tokens.js'
import { ensureDefaultWatchlist } from '../lib/watchlists.js'
import { assertNotLastAdmin, LastAdminError } from '../lib/admins.js'
import { requireOwner } from '../middleware/auth.js'
import {
  createPasswordResetToken,
  redeemPasswordResetToken,
  createEmailVerificationToken,
  redeemEmailVerificationToken,
  createEmailChangeToken,
  redeemEmailChangeToken,
} from '../lib/account-tokens.js'
import {
  isEmailConfigured,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendEmailChangeVerification,
  sendAccountAlreadyExistsNotice,
  sendPasswordChangedNotice,
  sendEmailChangedNotice,
} from '../lib/email.js'

export const authRoutes = new OpenAPIHono<AppEnv>()

/** Thrown inside POST /auth/register's transaction to roll it back when
 * an invite code can't be claimed — see that route for why the user row
 * is created before the claim is attempted. */
class InvalidInviteCodeError extends Error {}

/** Gates the routes that actually send mail (forgot-password,
 * resend-verification, and initiating an email change) — see
 * instanceSettingsSchema's `emailConfigured` doc comment for why redeeming
 * a token you already have isn't gated the same way. Same shape as
 * `apps/api/src/routes/backups.ts`'s `requireBackupsConfigured`. Exported
 * (unlike that one) because routes/admin-users.ts's admin-triggered
 * password reset reuses it verbatim rather than duplicating the check. */
export const requireEmailConfigured = createMiddleware<AppEnv>(async (c, next) => {
  if (!isEmailConfigured()) {
    return c.json({ error: 'Email is not configured on this instance' }, 404)
  }
  await next()
  return
})

authRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/auth/login',
    summary: 'Log in with email and password',
    // Paired with the per-account backoff below (lib/login-lockout.ts) —
    // this catches broad guessing across many accounts from one IP, the
    // lockout catches sustained guessing against one account from
    // anywhere. Neither existed before the M3 security review (F-02).
    middleware: [rateLimit({ name: 'auth:login', limit: 10, windowMs: 15 * 60 * 1000 })] as const,
    request: { body: { content: { 'application/json': { schema: loginRequestSchema } } } },
    responses: {
      200: { description: 'Logged in', content: { 'application/json': { schema: userSchema } } },
      401: { description: 'Invalid credentials' },
    },
  }),
  async (c) => {
    const db = c.get('db')
    const { email, password } = c.req.valid('json')

    // Same generic error as a wrong password below — a distinct response
    // here would turn the lockout itself into a new account-enumeration
    // oracle ("keep guessing until it locks" reveals the email exists).
    if (await isLoginLocked(db, email)) {
      logSecurityEvent('login_locked_out')
      return c.json({ error: 'Invalid email or password' }, 401)
    }

    const [row] = await db
      .select({ user: users, credential: userCredentials })
      .from(users)
      .innerJoin(
        userCredentials,
        and(eq(userCredentials.userId, users.id), eq(userCredentials.type, 'local')),
      )
      .where(eq(users.email, email))
      .limit(1)

    // Same generic error whether the email is unknown or the password is
    // wrong — don't let login responses reveal which accounts exist. The
    // dummy verify on the unknown branch does the same Argon2id work a
    // real check would, so the two cases don't differ in response time
    // either (M3 security review, F-12) — without it, this branch
    // returns as soon as the DB lookup misses, well before a wrong-
    // password branch that has to hash first.
    if (!row || !row.credential.passwordHash) {
      await verifyDummyPassword(password)
      await recordFailedLogin(db, email)
      logSecurityEvent('login_failure', { reason: 'unknown_email' })
      return c.json({ error: 'Invalid email or password' }, 401)
    }
    const valid = await verifyPassword(row.credential.passwordHash, password)
    if (!valid) {
      await recordFailedLogin(db, email)
      logSecurityEvent('login_failure', { reason: 'wrong_password', userId: row.user.id })
      return c.json({ error: 'Invalid email or password' }, 401)
    }
    await clearLoginAttempts(db, email)
    logSecurityEvent('login_success', { userId: row.user.id })

    // A confirmed TOTP enrollment means the password alone isn't a
    // complete login — no session is created yet. See POST /auth/login/mfa
    // below for the second step.
    const totp = await getUserTotp(db, row.user.id)
    if (totp?.confirmedAt) {
      const { token: challengeToken } = await createMfaChallenge(db, row.user.id)
      return c.json({ mfaRequired: true, challengeToken } satisfies MfaRequiredResponse, 200)
    }

    const env = loadEnv()
    const { token, expiresAt } = await createSession(db, row.user.id, {
      userAgent: c.req.header('user-agent'),
      ipAddress: c.req.header('x-forwarded-for') ?? undefined,
    })
    setSessionCookie(c, env, token, expiresAt)

    return c.json(serializeUser(row.user), 200)
  },
)

authRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/auth/login/mfa',
    summary: 'Complete a login for an account with TOTP MFA, using a code from POST /auth/login',
    // A wrong code doesn't burn the challenge (see getMfaChallengeUserId's
    // doc comment) — this rate limit, plus the challenge's own 5-minute
    // expiry, is what actually bounds how many guesses are possible.
    middleware: [
      rateLimit({ name: 'auth:login-mfa', limit: 10, windowMs: 15 * 60 * 1000 }),
    ] as const,
    request: { body: { content: { 'application/json': { schema: loginMfaRequestSchema } } } },
    responses: {
      200: { description: 'Logged in', content: { 'application/json': { schema: userSchema } } },
      401: { description: 'Invalid or expired challenge, or the code is incorrect' },
    },
  }),
  async (c) => {
    const db = c.get('db')
    const { challengeToken, code } = c.req.valid('json')

    const userId = await getMfaChallengeUserId(db, challengeToken)
    if (!userId) {
      return c.json({ error: 'This login attempt has expired — please log in again' }, 401)
    }

    const [row] = await db.select({ user: users }).from(users).where(eq(users.id, userId)).limit(1)
    const totp = await getUserTotp(db, userId)
    // Shouldn't happen (the challenge was only ever created for a
    // confirmed-TOTP account), but MFA having been disabled in the few
    // minutes between the challenge being issued and redeemed is at least
    // conceivable — fail closed rather than assume.
    if (!row || !totp?.confirmedAt) {
      return c.json({ error: 'This login attempt has expired — please log in again' }, 401)
    }

    const env = loadEnv()
    let usedVia: 'totp' | 'recovery' | null = null
    if (
      /^\d{6}$/.test(code) &&
      verifyTotp(decryptSecret(totp.secretEncrypted, env.ENCRYPTION_KEY!), code)
    ) {
      usedVia = 'totp'
    } else if (await consumeRecoveryCode(db, userId, code)) {
      usedVia = 'recovery'
    }
    if (!usedVia) {
      logSecurityEvent('mfa_challenge_failed', { userId })
      return c.json({ error: 'Incorrect code' }, 401)
    }
    await deleteMfaChallenge(db, challengeToken)
    if (usedVia === 'recovery') {
      logSecurityEvent('recovery_code_used', { userId })
    }

    logSecurityEvent('mfa_login_success', { userId })
    const { token, expiresAt } = await createSession(db, userId, {
      userAgent: c.req.header('user-agent'),
      ipAddress: c.req.header('x-forwarded-for') ?? undefined,
    })
    setSessionCookie(c, env, token, expiresAt)

    return c.json(serializeUser(row.user), 200)
  },
)

authRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/auth/register',
    summary: 'Create an account, subject to the instance registration policy',
    middleware: [rateLimit({ name: 'auth:register', limit: 5, windowMs: 60 * 60 * 1000 })] as const,
    request: { body: { content: { 'application/json': { schema: registerRequestSchema } } } },
    responses: {
      201: {
        description: 'Account created',
        content: { 'application/json': { schema: userSchema } },
      },
      400: { description: 'Password has appeared in a known data breach' },
      403: { description: 'Registration is not open, or email is not configured' },
      409: { description: 'Email already in use' },
    },
  }),
  async (c) => {
    const db = c.get('db')
    const body = c.req.valid('json')

    // Registration always needs to send a verification email, so it can
    // only ever be open once SMTP is — independent of registrationMode.
    if (!isEmailConfigured()) {
      return c.json({ error: 'Registration requires email to be configured on this instance' }, 403)
    }

    const [settings] = await db.select().from(instanceSettings).limit(1)
    const registrationMode = settings?.registrationMode ?? 'closed'

    if (registrationMode === 'closed') {
      return c.json({ error: 'Registration is not open on this instance' }, 403)
    }
    if (registrationMode === 'invite' && !body.inviteCode) {
      return c.json({ error: 'An invite code is required' }, 403)
    }

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1)
    if (existing) {
      // Kept distinct (not the generic pattern login/forgot-password use)
      // — GitHub takes the same approach, and the UX cost of hiding it
      // here is real (a real user has no way to know to log in instead).
      // The compensating control is the notice below: the account owner
      // gets told someone tried this, rather than the attempt being
      // invisible. Rate-limited to one such email per address per day so
      // registration itself can't become an inbox-bombing vector.
      if (tryConsume(`auth:register:already-exists-notice:${body.email}`, 1, 24 * 60 * 60 * 1000)) {
        try {
          await sendAccountAlreadyExistsNotice(body.email)
        } catch (err) {
          console.error(`Failed to send "already exists" notice to ${existing.id}:`, err)
        }
      }
      return c.json({ error: 'Email already in use' }, 409)
    }

    if (await isPasswordPwned(body.password)) {
      return c.json(
        { error: 'This password has appeared in a data breach — please choose a different one' },
        400,
      )
    }

    const passwordHash = await hashPassword(body.password)

    // The invite claim and user creation happen in one transaction so a
    // concurrent double-redemption of the same invite code can't create
    // two accounts from it — the UPDATE's WHERE clause is what makes the
    // claim itself atomic; a plain select-then-update had a race between
    // the two steps (M3 security review, F-13). The user has to be
    // created *before* the claim, not after — `invites.usedBy` has a
    // foreign key to `users.id`, so claiming with a not-yet-real id would
    // violate it. If the claim then fails, throwing rolls back the
    // user/credential/watchlist inserts too, so a losing race leaves no
    // orphaned account behind.
    //
    // `usedAt`, not `usedBy`, is the real one-shot gate (2026-09-03):
    // `usedBy` is a nullable FK to `users` with `ON DELETE set null`, so
    // gating solely on it meant deleting the redeemer silently revived
    // their code for the rest of its TTL. `usedAt` is never touched by
    // that cascade — both are still set together, `usedBy` just for
    // attribution/display (Settings > Invites).
    let user: typeof users.$inferSelect
    try {
      user = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(users)
          .values({
            email: body.email,
            displayName: body.displayName,
            role: 'user',
            // Falls back to the users.locale column default when the
            // browser's language didn't match a supported locale — see
            // setupRequestSchema's doc comment on `locale`.
            ...(body.locale ? { locale: body.locale } : {}),
          })
          .returning()
        if (!created) throw new Error('Failed to create user')

        await tx.insert(userCredentials).values({ userId: created.id, type: 'local', passwordHash })
        await ensureDefaultWatchlist(tx, created.id)

        if (registrationMode === 'invite') {
          const [claimed] = await tx
            .update(invites)
            .set({ usedBy: created.id, usedAt: new Date() })
            .where(
              and(
                eq(invites.codeHash, hashSecret(body.inviteCode!)),
                isNull(invites.usedAt),
                isNull(invites.usedBy),
                gt(invites.expiresAt, new Date()),
              ),
            )
            .returning({ id: invites.id })
          if (!claimed) throw new InvalidInviteCodeError()
        }

        return created
      })
    } catch (err) {
      if (err instanceof InvalidInviteCodeError) {
        return c.json({ error: 'Invalid or expired invite code' }, 403)
      }
      throw err
    }

    // Best-effort: a transient SMTP relay failure shouldn't fail the
    // registration itself, since the account was already created
    // successfully — logged server-side so a self-hoster can notice a
    // real delivery problem, but not surfaced to the new user as an error.
    // (Email being configured at all was already required above.)
    try {
      const verificationToken = await createEmailVerificationToken(db, user.id)
      await sendVerificationEmail(user.email, verificationToken)
    } catch (err) {
      console.error(`Failed to send verification email to user ${user.id}:`, err)
    }

    const env = loadEnv()
    const { token, expiresAt } = await createSession(db, user.id, {
      userAgent: c.req.header('user-agent'),
      ipAddress: c.req.header('x-forwarded-for') ?? undefined,
    })
    setSessionCookie(c, env, token, expiresAt)

    return c.json(serializeUser(user), 201)
  },
)

authRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/auth/logout',
    summary: 'End the current session',
    responses: { 204: { description: 'Logged out' } },
  }),
  async (c) => {
    const env = loadEnv()
    const token = getSessionToken(c, env)
    if (token) await revokeSession(c.get('db'), token)
    clearSessionCookie(c, env)
    return c.body(null, 204)
  },
)

authRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/auth/me',
    summary: 'The current user',
    responses: {
      200: { description: 'Current user', content: { 'application/json': { schema: userSchema } } },
      401: { description: 'Not logged in' },
    },
  }),
  (c) => c.json(serializeUser(c.get('user')!), 200),
)

authRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/auth/me',
    summary: "Update the current user's profile",
    request: {
      body: { content: { 'application/json': { schema: updateProfileRequestSchema } } },
    },
    responses: {
      200: { description: 'Updated', content: { 'application/json': { schema: userSchema } } },
      401: { description: 'Not logged in' },
    },
  }),
  async (c) => {
    const db = c.get('db')
    const body = c.req.valid('json')
    const [updated] = await db
      .update(users)
      .set(body)
      .where(eq(users.id, c.get('user')!.id))
      .returning()
    if (!updated) throw new Error('Failed to update user')
    return c.json(serializeUser(updated), 200)
  },
)

authRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/auth/me/password',
    summary: "Change the current user's password",
    request: {
      body: { content: { 'application/json': { schema: changePasswordRequestSchema } } },
    },
    responses: {
      204: { description: 'Password changed' },
      400: { description: 'Current password is incorrect, or the new one has been breached' },
      401: { description: 'Not logged in' },
    },
  }),
  async (c) => {
    const db = c.get('db')
    const user = c.get('user')!
    const { currentPassword, newPassword } = c.req.valid('json')

    const [credential] = await db
      .select()
      .from(userCredentials)
      .where(and(eq(userCredentials.userId, user.id), eq(userCredentials.type, 'local')))
      .limit(1)
    // No local credential to change — an OIDC-only account, once that
    // adapter exists (docs/adr/0003-auth-model.md). Same message as a
    // wrong password: nothing a caller could usefully do differently
    // either way, and no reason to reveal which case it is.
    if (
      !credential?.passwordHash ||
      !(await verifyPassword(credential.passwordHash, currentPassword))
    ) {
      return c.json({ error: 'Current password is incorrect' }, 400)
    }

    if (await isPasswordPwned(newPassword)) {
      return c.json(
        { error: 'This password has appeared in a data breach — please choose a different one' },
        400,
      )
    }

    const passwordHash = await hashPassword(newPassword)
    await db
      .update(userCredentials)
      .set({ passwordHash })
      .where(eq(userCredentials.id, credential.id))

    // Keeps the session making this request alive — see
    // revokeOtherSessions's doc comment in session.ts for why that's
    // different from the forgot-password reset's revokeAllSessions.
    const env = loadEnv()
    const currentToken = getSessionToken(c, env)
    if (currentToken) await revokeOtherSessions(db, user.id, currentToken)

    // Best-effort, same reasoning as every other send in this file — a
    // delivery failure shouldn't undo (and structurally can't undo) a
    // password change that already happened. Unlike registration, this
    // route works whether or not email is configured at all, so this is
    // an explicit `isEmailConfigured()` check rather than something
    // already guaranteed by a route-level gate (ASVS V2.5.5).
    if (isEmailConfigured()) {
      try {
        await sendPasswordChangedNotice(user.email)
      } catch (err) {
        console.error(`Failed to send password-changed notice to user ${user.id}:`, err)
      }
    }

    return c.body(null, 204)
  },
)

/**
 * Session management (M3 security review follow-up, F-24, ASVS V3.3.2),
 * docs/TODO.md. Lets a user see and revoke their own other active sessions
 * — there was previously no way to do either short of "log out
 * everywhere" (revokeAllSessions via password reset).
 */
authRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/auth/me/sessions',
    summary: "List the current user's active sessions, newest first",
    responses: {
      200: {
        description: 'Sessions',
        content: { 'application/json': { schema: listSessionsResponseSchema } },
      },
    },
  }),
  async (c) => {
    const db = c.get('db')
    const user = c.get('user')!
    const env = loadEnv()

    const currentToken = getSessionToken(c, env)
    const currentSessionId = currentToken ? await findSessionId(db, currentToken) : null

    const rows = await listSessions(db, user.id)
    return c.json({
      sessions: rows.map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        ipAddress: s.ipAddress,
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt?.toISOString() ?? null,
        expiresAt: s.expiresAt.toISOString(),
        current: s.id === currentSessionId,
      })),
    })
  },
)

authRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/auth/me/sessions/{id}',
    summary: 'Revoke one of the current user’s sessions',
    // Deliberately allows revoking the caller's own current session, same
    // as any other — no special-casing. Doing so just means the next
    // request with that cookie 401s, the same outcome POST /auth/logout
    // produces; simpler than inventing a distinct "can't revoke yourself"
    // rule for one row in the list.
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      204: { description: 'Revoked' },
      404: { description: 'Session not found' },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const db = c.get('db')
    const user = c.get('user')!

    const revoked = await revokeSessionById(db, user.id, id)
    if (!revoked) return c.json({ error: 'Session not found' }, 404)

    logSecurityEvent('session_revoked', { userId: user.id })
    return c.body(null, 204)
  },
)

authRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/auth/me/email',
    summary: "Request changing the current user's email address",
    middleware: [requireEmailConfigured] as const,
    request: {
      body: { content: { 'application/json': { schema: changeEmailRequestSchema } } },
    },
    responses: {
      204: { description: 'Verification email sent to the new address' },
      400: { description: 'Current password is incorrect, or the new address is unchanged' },
      401: { description: 'Not logged in' },
      404: { description: 'Email is not configured on this instance' },
      409: { description: 'Email already in use' },
    },
  }),
  async (c) => {
    const db = c.get('db')
    const user = c.get('user')!
    const { newEmail, currentPassword } = c.req.valid('json')

    const [credential] = await db
      .select()
      .from(userCredentials)
      .where(and(eq(userCredentials.userId, user.id), eq(userCredentials.type, 'local')))
      .limit(1)
    // Same reasoning as POST /auth/me/password's identical check — a
    // sensitive account change re-proves the current password, so a
    // stolen session cookie alone can't redirect where password-reset
    // links go.
    if (
      !credential?.passwordHash ||
      !(await verifyPassword(credential.passwordHash, currentPassword))
    ) {
      return c.json({ error: 'Current password is incorrect' }, 400)
    }

    // emailSchema already normalizes newEmail to lowercase; user.email is
    // stored as citext (case-insensitive at the DB level) but returned
    // however it was originally cased, so compare case-insensitively too.
    if (newEmail === user.email.toLowerCase()) {
      return c.json({ error: "That's already your email address" }, 400)
    }

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, newEmail))
      .limit(1)
    if (existing) {
      return c.json({ error: 'Email already in use' }, 409)
    }

    const token = await createEmailChangeToken(db, user.id, newEmail)
    await sendEmailChangeVerification(newEmail, token)

    return c.body(null, 204)
  },
)

authRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/auth/confirm-email-change',
    summary: "Confirm the current user's pending email change",
    request: {
      body: { content: { 'application/json': { schema: confirmEmailChangeRequestSchema } } },
    },
    responses: {
      204: { description: 'Email address updated' },
      400: { description: 'Invalid or expired confirmation link' },
      409: { description: 'Email already in use' },
    },
  }),
  async (c) => {
    const db = c.get('db')
    const { token } = c.req.valid('json')

    const redeemed = await redeemEmailChangeToken(db, token)
    if (!redeemed) {
      return c.json({ error: 'This confirmation link is invalid or has expired' }, 400)
    }

    // Re-checked here, not just at request time — someone else could have
    // registered or changed into this exact address in the meantime.
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, redeemed.newEmail))
      .limit(1)
    if (existing) {
      return c.json({ error: 'Email already in use' }, 409)
    }

    // Read before overwriting — this is the only place the *old* address
    // is available, and the notice below (ASVS V2.5.5) has to go to it,
    // not the new one (which already proved ownership via this very link).
    const [before] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, redeemed.userId))
      .limit(1)

    // The confirmation click itself is what proves ownership of the new
    // address — already verified the moment it's set, same as a
    // freshly-redeemed registration link.
    await db
      .update(users)
      .set({ email: redeemed.newEmail, emailVerifiedAt: new Date() })
      .where(eq(users.id, redeemed.userId))

    // Best-effort, same reasoning as every other send in this file — the
    // address change already happened by the time this runs. Guarded on
    // isEmailConfigured() defensively, even though initiating the change
    // (POST /auth/me/email) already required it — a self-hoster could in
    // principle unset SMTP_HOST between the two steps.
    if (before && isEmailConfigured()) {
      try {
        const [settings] = await db.select().from(instanceSettings).limit(1)
        await sendEmailChangedNotice(
          before.email,
          redeemed.newEmail,
          settings?.instanceName ?? 'rwnd.tv',
          settings?.adminEmail ?? null,
        )
      } catch (err) {
        console.error(`Failed to send email-changed notice for user ${redeemed.userId}:`, err)
      }
    }

    return c.body(null, 204)
  },
)

authRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/auth/me',
    summary: "Permanently delete the current user's account",
    request: {
      body: { content: { 'application/json': { schema: deleteAccountRequestSchema } } },
    },
    responses: {
      204: { description: 'Account deleted' },
      400: {
        description:
          "Current password is incorrect, the email doesn't match, you're the last remaining admin, or you're the owner",
      },
      401: { description: 'Not logged in' },
    },
  }),
  async (c) => {
    const db = c.get('db')
    const user = c.get('user')!
    const { email, currentPassword } = c.req.valid('json')

    const [credential] = await db
      .select()
      .from(userCredentials)
      .where(and(eq(userCredentials.userId, user.id), eq(userCredentials.type, 'local')))
      .limit(1)
    // Same "re-prove the current password" reasoning as
    // POST /auth/me/password and POST /auth/me/email — this is the most
    // sensitive account action there is.
    if (
      !credential?.passwordHash ||
      !(await verifyPassword(credential.passwordHash, currentPassword))
    ) {
      return c.json({ error: 'Current password is incorrect' }, 400)
    }

    // Same case-insensitive comparison reasoning as POST /auth/me/email's
    // unchanged-address check. This confirmation step isn't itself a
    // security check (the password above is) — it's a deliberate extra
    // step against an accidental click, same as GitHub's "type the repo
    // name to confirm" pattern.
    if (email !== user.email.toLowerCase()) {
      return c.json({ error: "That doesn't match your account's email address" }, 400)
    }

    // The owner can never delete their own account directly — doing so
    // would leave the instance with no owner at all. They have to step
    // down first (POST /auth/me/transfer-ownership below), which demotes
    // them to a plain admin, at which point this route's ordinary
    // last-admin-aware delete applies to them like anyone else.
    if (user.role === 'owner') {
      return c.json(
        { error: 'Transfer ownership to another admin before deleting your account' },
        400,
      )
    }

    // Used to be a blanket "admins can't delete themselves at all" block
    // here — James, 2026-08-25: a deliberately blunt first step while a
    // more considered answer got thought through. M4's admin
    // user-management work (docs/TODO_ARCHIVE.md) is that answer: an
    // admin can now delete their own account, provided at least one other
    // admin exists to keep administering the instance. assertNotLastAdmin
    // is a no-op for a non-admin caller, and runs inside the same
    // transaction as the delete itself so a concurrent demotion elsewhere
    // can't race past it — see lib/admins.ts.
    try {
      await db.transaction(async (tx) => {
        await assertNotLastAdmin(tx, user.id)
        // Every other table referencing this user cascades on delete —
        // plays, ratings, watchlist_items, dropped_shows, sessions,
        // api_tokens (and in turn its own pending_webhook_events),
        // user_credentials, trakt_connections, import_jobs, and the
        // three account-token tables. Two exceptions: if this user had
        // redeemed a webhook link code against *someone else's* token,
        // that link's `userId` only sets back to null (2026-09-03; was
        // `cascade`) rather than deleting the row, reverting it to
        // "seen, not yet linked" for the token owner rather than costing
        // them the detected account's history; and if this user had
        // redeemed an invite, `invites.usedBy` sets back to null too, but
        // harmlessly — `invites.usedAt` (2026-09-03) is the real one-shot
        // gate and isn't touched by this cascade. See each table's own
        // FK in packages/db/src/schema.ts.
        await tx.delete(users).where(eq(users.id, user.id))
        // Not a cascade — login_attempts is keyed by email with no FK
        // (see its doc comment), so it would otherwise silently outlive
        // the account and apply to anyone who later reuses this address.
        await clearLoginAttempts(tx, user.email)
      })
    } catch (err) {
      if (err instanceof LastAdminError) {
        return c.json({ error: err.message }, 400)
      }
      throw err
    }

    const env = loadEnv()
    clearSessionCookie(c, env)

    return c.body(null, 204)
  },
)

/**
 * The only way the `owner` role ever moves (M4, docs/TODO_ARCHIVE.md) — an
 * ordinary admin can never promote/demote/delete the owner
 * (routes/admin-users.ts), so the owner has to hand the role on
 * themselves. Demotes the caller to `admin` in the same atomic action, so
 * there is always exactly one owner. Target must already be an admin
 * (decided: not any user — a safety rail against transferring ultimate
 * control to someone who was never even trusted with admin access).
 */
authRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/auth/me/transfer-ownership',
    summary: 'Transfer ownership of this instance to another admin (owner only)',
    middleware: [requireOwner] as const,
    request: {
      body: { content: { 'application/json': { schema: transferOwnershipRequestSchema } } },
    },
    responses: {
      204: { description: 'Ownership transferred' },
      400: { description: 'Current password is incorrect, or the target is not an admin' },
      403: { description: 'Owner only' },
      404: { description: 'Target user not found' },
    },
  }),
  async (c) => {
    const db = c.get('db')
    const owner = c.get('user')!
    const { targetUserId, currentPassword } = c.req.valid('json')

    const [credential] = await db
      .select()
      .from(userCredentials)
      .where(and(eq(userCredentials.userId, owner.id), eq(userCredentials.type, 'local')))
      .limit(1)
    // Same "re-prove the current password" reasoning as DELETE /auth/me —
    // this is the single highest-privilege action in the app.
    if (
      !credential?.passwordHash ||
      !(await verifyPassword(credential.passwordHash, currentPassword))
    ) {
      return c.json({ error: 'Current password is incorrect' }, 400)
    }

    const [target] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1)
    if (!target) return c.json({ error: 'Target user not found' }, 404)
    if (target.role !== 'admin') {
      return c.json({ error: 'Ownership can only be transferred to an existing admin' }, 400)
    }

    // Locks the owner row before swapping — guards the same
    // double-transfer race assertNotLastAdmin guards elsewhere (two
    // concurrent transfers could otherwise both read "I'm still the
    // owner" and both proceed). requireOwner already confirmed the
    // caller's session says they're the owner; this re-checks under the
    // lock rather than trusting that alone.
    await db.transaction(async (tx) => {
      const [currentOwner] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, 'owner'))
        .for('update')
      if (currentOwner?.id !== owner.id) {
        throw new Error('Ownership changed concurrently — caller is no longer the owner')
      }
      await tx.update(users).set({ role: 'admin' }).where(eq(users.id, owner.id))
      await tx.update(users).set({ role: 'owner' }).where(eq(users.id, targetUserId))
    })

    logSecurityEvent('owner_transferred', { fromUserId: owner.id, toUserId: targetUserId })
    return c.body(null, 204)
  },
)

/** 2MB — generous for a profile photo (most phone camera apps' own
 * "share"/messaging-size export already lands well under this) without
 * risking an unbounded row in `users.avatar_image`. No resizing/compression
 * happens server-side (no image-processing dependency in this codebase).
 * Enforced twice: jsonBodyLimit below rejects an oversized request before
 * `parseBody()` ever buffers it into memory; the `file.size` check further
 * down is what actually applies once parsed (a multipart body's overall
 * size includes headers/boundaries, not just the file itself). */
const MAX_AVATAR_BYTES = 2 * 1024 * 1024

/**
 * Plain routes, not `.openapi()` — same reasoning as
 * `apps/api/src/routes/webhooks.ts`'s Plex route: a `multipart/form-data`
 * upload and a raw-binary response don't fit the typed-JSON-body/response
 * convention every other route here uses.
 */
authRoutes.put('/auth/me/avatar', jsonBodyLimit(MAX_AVATAR_BYTES), async (c) => {
  let form: Awaited<ReturnType<typeof c.req.parseBody>>
  try {
    form = await c.req.parseBody()
  } catch {
    return c.json({ error: 'Malformed request body' }, 400)
  }
  const file = form.file
  if (!(file instanceof File)) {
    return c.json({ error: 'Missing file field' }, 400)
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return c.json({ error: 'Image is too large — 2MB maximum' }, 400)
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  // The client-declared `file.type` is never trusted (M3 security
  // review, F-06) — what actually gets stored and later served back as
  // Content-Type is derived from the file's own signature bytes.
  const sniffedType = sniffImageType(buffer)
  if (!sniffedType) {
    return c.json({ error: 'Unsupported image type — use JPEG, PNG, or WebP' }, 400)
  }

  const db = c.get('db')
  const [updated] = await db
    .update(users)
    .set({ avatarImage: buffer, avatarMimeType: sniffedType, avatarUpdatedAt: new Date() })
    .where(eq(users.id, c.get('user')!.id))
    .returning()
  if (!updated) throw new Error('Failed to update user')
  return c.json(serializeUser(updated), 200)
})

authRoutes.delete('/auth/me/avatar', async (c) => {
  const db = c.get('db')
  const [updated] = await db
    .update(users)
    .set({ avatarImage: null, avatarMimeType: null, avatarUpdatedAt: null })
    .where(eq(users.id, c.get('user')!.id))
    .returning()
  if (!updated) throw new Error('Failed to update user')
  return c.json(serializeUser(updated), 200)
})

authRoutes.get('/auth/me/avatar', async (c) => {
  const db = c.get('db')
  const [row] = await db
    .select({ avatarImage: users.avatarImage, avatarMimeType: users.avatarMimeType })
    .from(users)
    .where(eq(users.id, c.get('user')!.id))
    .limit(1)
  if (!row?.avatarImage || !row.avatarMimeType) {
    return c.json({ error: 'No avatar set' }, 404)
  }
  // Safe to cache aggressively: the frontend always requests this through
  // a `?v=avatarUpdatedAt`-suffixed URL (Avatar.tsx), so a new upload is a
  // new URL, never a stale cache hit.
  c.header('Content-Type', row.avatarMimeType)
  c.header('Cache-Control', 'private, max-age=31536000, immutable')
  // `inline` (not `attachment`) — the frontend renders this directly as
  // an <img src>, not a download. Explicit Content-Disposition rather
  // than leaving it unset (M3 security review, ASVS V14.4.2).
  c.header('Content-Disposition', `inline; filename="avatar.${extensionFor(row.avatarMimeType)}"`)
  // Node's Buffer (ArrayBufferLike-backed) isn't assignable to Hono's
  // Data type (Uint8Array<ArrayBuffer>-backed) — copy into a plain one.
  return c.body(Uint8Array.from(row.avatarImage))
})

authRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/auth/forgot-password',
    summary: 'Request a password reset email',
    middleware: [
      requireEmailConfigured,
      rateLimit({ name: 'auth:forgot-password', limit: 5, windowMs: 60 * 60 * 1000 }),
    ] as const,
    request: { body: { content: { 'application/json': { schema: forgotPasswordRequestSchema } } } },
    responses: {
      204: { description: 'Always returned, whether or not the email matched an account' },
      404: { description: 'Email is not configured on this instance' },
      429: { description: 'Too many requests, either from this IP or for this email address' },
    },
  }),
  async (c) => {
    const db = c.get('db')
    const { email } = c.req.valid('json')

    // A second dimension alongside the IP limit above — this one catches
    // requests spread across many IPs but aimed at one target address.
    // Safe from an enumeration standpoint: it counts any submitted email
    // identically whether or not it belongs to a real account, same as
    // the "always 204" response below.
    if (!tryConsume(`auth:forgot-password:email:${email}`, 5, 60 * 60 * 1000)) {
      return c.json({ error: 'Too many requests — please try again later' }, 429)
    }

    const [row] = await db
      .select({ user: users, credential: userCredentials })
      .from(users)
      .innerJoin(
        userCredentials,
        and(eq(userCredentials.userId, users.id), eq(userCredentials.type, 'local')),
      )
      .where(eq(users.email, email))
      .limit(1)

    // Same reasoning as login's generic error: responding differently for
    // an unknown email (or one with no local password to reset — an
    // OIDC-only account, once that adapter exists) would let this route
    // be used to enumerate which accounts exist.
    if (row) {
      try {
        const token = await createPasswordResetToken(db, row.user.id)
        await sendPasswordResetEmail(row.user.email, token)
      } catch (err) {
        console.error(`Failed to send password reset email to user ${row.user.id}:`, err)
      }
    }

    return c.body(null, 204)
  },
)

authRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/auth/reset-password',
    summary: 'Complete a password reset',
    request: { body: { content: { 'application/json': { schema: resetPasswordRequestSchema } } } },
    responses: {
      204: { description: 'Password reset' },
      400: { description: 'Invalid or expired reset link, or the password has been breached' },
    },
  }),
  async (c) => {
    const db = c.get('db')
    const { token, password } = c.req.valid('json')

    // Checked before redeeming the token, deliberately — the token is
    // single-use, and burning it on a rejected weak password would force
    // a whole new "forgot password" round trip just to pick a different
    // one, rather than letting the same link be retried.
    if (await isPasswordPwned(password)) {
      return c.json(
        { error: 'This password has appeared in a data breach — please choose a different one' },
        400,
      )
    }

    const userId = await redeemPasswordResetToken(db, token)
    if (!userId) {
      return c.json({ error: 'This reset link is invalid or has expired' }, 400)
    }

    const passwordHash = await hashPassword(password)
    const [updated] = await db
      .update(userCredentials)
      .set({ passwordHash })
      .where(and(eq(userCredentials.userId, userId), eq(userCredentials.type, 'local')))
      .returning({ id: userCredentials.id })
    // The token was valid but the account has no local credential to reset
    // (shouldn't happen — forgot-password only ever issues tokens for
    // accounts that have one) — same generic error rather than a 500,
    // there's nothing a caller could usefully do differently either way.
    if (!updated) {
      return c.json({ error: 'This reset link is invalid or has expired' }, 400)
    }

    // Standard "changing your password logs out everyone else" practice —
    // see revokeAllSessions's doc comment in session.ts.
    await revokeAllSessions(db, userId)

    return c.body(null, 204)
  },
)

authRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/auth/verify-email',
    summary: "Confirm the current user's email address via a verification link",
    request: { body: { content: { 'application/json': { schema: verifyEmailRequestSchema } } } },
    responses: {
      204: { description: 'Email verified' },
      400: { description: 'Invalid or expired verification link' },
    },
  }),
  async (c) => {
    const db = c.get('db')
    const { token } = c.req.valid('json')

    const userId = await redeemEmailVerificationToken(db, token)
    if (!userId) {
      return c.json({ error: 'This verification link is invalid or has expired' }, 400)
    }

    await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId))

    return c.body(null, 204)
  },
)

authRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/auth/resend-verification',
    summary: "Resend the current user's email verification link",
    middleware: [requireEmailConfigured] as const,
    responses: {
      204: { description: 'Verification email sent' },
      400: { description: 'Email is already verified' },
      401: { description: 'Not logged in' },
      404: { description: 'Email is not configured on this instance' },
    },
  }),
  async (c) => {
    const db = c.get('db')
    const user = c.get('user')!
    if (user.emailVerifiedAt) {
      return c.json({ error: 'Email is already verified' }, 400)
    }

    const token = await createEmailVerificationToken(db, user.id)
    await sendVerificationEmail(user.email, token)

    return c.body(null, 204)
  },
)
