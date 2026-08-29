import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
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
} from '@rwnd/shared'
import { users, userCredentials, instanceSettings, invites } from '@rwnd/db'
import type { AppEnv } from '../types.js'
import { loadEnv } from '../env.js'
import { jsonBodyLimit } from '../lib/body-limit.js'
import { rateLimit, tryConsume } from '../middleware/rate-limit.js'
import { isLoginLocked, recordFailedLogin, clearLoginAttempts } from '../lib/login-lockout.js'
import { hashPassword, verifyPassword, verifyDummyPassword } from '../lib/password.js'
import { sniffImageType, extensionFor } from '../lib/image-sniff.js'
import {
  createSession,
  revokeSession,
  revokeAllSessions,
  revokeOtherSessions,
} from '../lib/session.js'
import { setSessionCookie, clearSessionCookie } from '../lib/cookies.js'
import { serializeUser } from '../lib/serialize.js'
import { hashSecret } from '../lib/tokens.js'
import { ensureDefaultWatchlist } from '../lib/watchlists.js'
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
} from '../lib/email.js'
import { getCookie } from 'hono/cookie'

export const authRoutes = new OpenAPIHono<AppEnv>()

/** Thrown inside POST /auth/register's transaction to roll it back when
 * an invite code can't be claimed — see that route for why the user row
 * is created before the claim is attempted. */
class InvalidInviteCodeError extends Error {}

/** Gates the routes that actually send mail (forgot-password,
 * resend-verification, and initiating an email change) — see
 * instanceSettingsSchema's `emailConfigured` doc comment for why redeeming
 * a token you already have isn't gated the same way. Same shape as
 * `apps/api/src/routes/backups.ts`'s `requireBackupsConfigured`. */
const requireEmailConfigured = createMiddleware<AppEnv>(async (c, next) => {
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
      return c.json({ error: 'Invalid email or password' }, 401)
    }
    const valid = await verifyPassword(row.credential.passwordHash, password)
    if (!valid) {
      await recordFailedLogin(db, email)
      return c.json({ error: 'Invalid email or password' }, 401)
    }
    await clearLoginAttempts(db, email)

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
    path: '/auth/register',
    summary: 'Create an account, subject to the instance registration policy',
    middleware: [rateLimit({ name: 'auth:register', limit: 5, windowMs: 60 * 60 * 1000 })] as const,
    request: { body: { content: { 'application/json': { schema: registerRequestSchema } } } },
    responses: {
      201: {
        description: 'Account created',
        content: { 'application/json': { schema: userSchema } },
      },
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

    const passwordHash = await hashPassword(body.password)

    // The invite claim and user creation happen in one transaction so a
    // concurrent double-redemption of the same invite code can't create
    // two accounts from it — the UPDATE's WHERE usedBy IS NULL clause is
    // what makes the claim itself atomic; a plain select-then-update had
    // a race between the two steps (M3 security review, F-13). The user
    // has to be created *before* the claim, not after — `invites.usedBy`
    // has a foreign key to `users.id`, so claiming with a not-yet-real id
    // would violate it. If the claim then fails, throwing rolls back the
    // user/credential/watchlist inserts too, so a losing race leaves no
    // orphaned account behind.
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
            .set({ usedBy: created.id })
            .where(
              and(
                eq(invites.codeHash, hashSecret(body.inviteCode!)),
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
      console.error(`Failed to send verification email to ${user.email}:`, err)
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
    const token = getCookie(c, env.SESSION_COOKIE_NAME)
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
      400: { description: 'Current password is incorrect' },
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

    const passwordHash = await hashPassword(newPassword)
    await db
      .update(userCredentials)
      .set({ passwordHash })
      .where(eq(userCredentials.id, credential.id))

    // Keeps the session making this request alive — see
    // revokeOtherSessions's doc comment in session.ts for why that's
    // different from the forgot-password reset's revokeAllSessions.
    const env = loadEnv()
    const currentToken = getCookie(c, env.SESSION_COOKIE_NAME)
    if (currentToken) await revokeOtherSessions(db, user.id, currentToken)

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

    // The confirmation click itself is what proves ownership of the new
    // address — already verified the moment it's set, same as a
    // freshly-redeemed registration link.
    await db
      .update(users)
      .set({ email: redeemed.newEmail, emailVerifiedAt: new Date() })
      .where(eq(users.id, redeemed.userId))

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
      400: { description: "Current password is incorrect, or the email doesn't match" },
      401: { description: 'Not logged in' },
      403: { description: 'Admin accounts cannot delete themselves' },
    },
  }),
  async (c) => {
    const db = c.get('db')
    const user = c.get('user')!
    const { email, currentPassword } = c.req.valid('json')

    // Blanket block, not just a sole-admin check — James, 2026-08-25: a
    // deliberately blunt first step while a more considered answer (e.g.
    // requiring another admin to be promoted first, once that route
    // exists — docs/TODO.md) gets thought through. Checked before the
    // password/email work below since it's unconditional either way, not
    // dependent on what was typed.
    if (user.role === 'admin') {
      return c.json({ error: "Admin accounts can't be deleted" }, 403)
    }

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

    // Every other table referencing this user cascades on delete —
    // plays, ratings, watchlist_items, dropped_shows, sessions,
    // api_tokens (and in turn its own webhook_account_links/
    // pending_webhook_events), user_credentials, trakt_connections,
    // import_jobs, and the three account-token tables. See each table's
    // own `userId` FK in packages/db/src/schema.ts.
    await db.delete(users).where(eq(users.id, user.id))

    const env = loadEnv()
    clearSessionCookie(c, env)

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
        console.error(`Failed to send password reset email to ${row.user.email}:`, err)
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
      400: { description: 'Invalid or expired reset link' },
    },
  }),
  async (c) => {
    const db = c.get('db')
    const { token, password } = c.req.valid('json')

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
