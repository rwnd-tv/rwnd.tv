import nodemailer, { type Transporter } from 'nodemailer'
import { loadEnv } from '../env.js'
import {
  PASSWORD_RESET_TTL_MS,
  EMAIL_VERIFICATION_TTL_MS,
  EMAIL_CHANGE_TTL_MS,
} from './account-tokens.js'

export function isEmailConfigured(): boolean {
  return Boolean(loadEnv().SMTP_HOST)
}

let cachedTransport: Transporter | undefined

function getTransport(): Transporter {
  const env = loadEnv()
  if (!env.SMTP_HOST) throw new Error('SMTP is not configured on this instance')
  if (!cachedTransport) {
    cachedTransport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // 465 is the implicit-TLS port (connect already encrypted); every
      // other port (587, 25, ...) is plaintext-then-STARTTLS, which
      // nodemailer negotiates on its own when `secure` is false.
      secure: env.SMTP_PORT === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    })
  }
  return cachedTransport
}

async function sendMail(to: string, subject: string, text: string, html: string): Promise<void> {
  await getTransport().sendMail({ from: loadEnv().SMTP_FROM, to, subject, text, html })
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const url = `${loadEnv().APP_URL}/verify-email?token=${encodeURIComponent(token)}`
  const hours = EMAIL_VERIFICATION_TTL_MS / (60 * 60 * 1000)
  await sendMail(
    to,
    'Verify your rwnd.tv email address',
    `Verify your email address by visiting this link (expires in ${hours} hours):\n${url}\n\nIf you didn't create an rwnd.tv account, you can ignore this email.`,
    `<p>Verify your email address by clicking the link below. This link expires in ${hours} hours.</p>` +
      `<p><a href="${url}">${url}</a></p>` +
      `<p>If you didn't create an rwnd.tv account, you can ignore this email.</p>`,
  )
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const url = `${loadEnv().APP_URL}/reset-password?token=${encodeURIComponent(token)}`
  const minutes = PASSWORD_RESET_TTL_MS / (60 * 1000)
  await sendMail(
    to,
    'Reset your rwnd.tv password',
    `Reset your password by visiting this link (expires in ${minutes} minutes):\n${url}\n\nIf you didn't request this, you can ignore this email — your password won't be changed.`,
    `<p>Reset your password by clicking the link below. This link expires in ${minutes} minutes.</p>` +
      `<p><a href="${url}">${url}</a></p>` +
      `<p>If you didn't request this, you can ignore this email — your password won't be changed.</p>`,
  )
}

/** Sent to an *existing* account when someone tries to register a new
 * account with its email address (POST /auth/register). rwnd.tv keeps
 * the "email already in use" response on that route rather than hiding
 * it (GitHub takes the same approach) — the UX cost of a fully generic
 * response is real, and this is the compensating control: the account
 * owner gets visibility into being targeted, which matters more for a
 * small self-hosted instance than pure enumeration-hiding does. Rate-
 * limited to one per targeted email per day (routes/auth.ts) so
 * registration itself can't be turned into an inbox-bombing vector. */
export async function sendAccountAlreadyExistsNotice(to: string): Promise<void> {
  await sendMail(
    to,
    'Someone tried to sign up with your rwnd.tv email address',
    `Someone just tried to create a new rwnd.tv account using this email address, which already has an account.\n\nIf this was you, log in instead — or reset your password if you've forgotten it.\n\nIf it wasn't you, no action is needed: no account was created, and nothing about your existing account has changed.`,
    `<p>Someone just tried to create a new rwnd.tv account using this email address, which already has an account.</p>` +
      `<p>If this was you, log in instead — or reset your password if you've forgotten it.</p>` +
      `<p>If it wasn't you, no action is needed: no account was created, and nothing about your existing account has changed.</p>`,
  )
}

/** Sent to the *new* address someone's asked to change their account's
 * email to (POST /auth/me/email) — never to the account's current
 * address, since the whole point is confirming ownership of this new
 * one before anything on the account actually changes. */
export async function sendEmailChangeVerification(to: string, token: string): Promise<void> {
  const url = `${loadEnv().APP_URL}/confirm-email-change?token=${encodeURIComponent(token)}`
  const minutes = EMAIL_CHANGE_TTL_MS / (60 * 1000)
  await sendMail(
    to,
    'Confirm your new rwnd.tv email address',
    `Someone requested changing an rwnd.tv account's email address to this one. Confirm the change by visiting this link (expires in ${minutes} minutes):\n${url}\n\nIf this wasn't you, you can ignore this email — your address won't be used.`,
    `<p>Someone requested changing an rwnd.tv account's email address to this one. Confirm the change by clicking the link below. This link expires in ${minutes} minutes.</p>` +
      `<p><a href="${url}">${url}</a></p>` +
      `<p>If this wasn't you, you can ignore this email — your address won't be used.</p>`,
  )
}

/** Sent to the account's own address once a password change actually
 * completes (POST /auth/me/password) — ASVS V2.5.5, the same
 * "someone changed your password" pattern GitHub/Google use. Best-effort,
 * same as every other send in this file: the password was already
 * changed by the time this is called, so a delivery failure here shouldn't
 * (and structurally can't, given how the caller awaits it) undo that. */
export async function sendPasswordChangedNotice(to: string): Promise<void> {
  await sendMail(
    to,
    'Your rwnd.tv password was changed',
    `Your rwnd.tv account's password was just changed.\n\nIf this was you, no action is needed. If it wasn't, someone else may have access to your account — reset your password immediately using "Forgot password?" on the login page, which signs out every other active session too.`,
    `<p>Your rwnd.tv account's password was just changed.</p>` +
      `<p>If this was you, no action is needed. If it wasn't, someone else may have access to your account — reset your password immediately using "Forgot password?" on the login page, which signs out every other active session too.</p>`,
  )
}

/** Sent to the *old* address once an email change is confirmed
 * (POST /auth/confirm-email-change) — the new address already went
 * through sendEmailChangeVerification above to prove ownership before the
 * change happened at all; this is the compensating notice for whoever
 * held the *old* address, the one who'd actually want to know if this
 * wasn't them (ASVS V2.5.5). `newEmail` is shown so the old address's
 * owner has something concrete to report if this wasn't them, without
 * this email itself being a link anyone could act on. */
export async function sendEmailChangedNotice(oldEmail: string, newEmail: string): Promise<void> {
  await sendMail(
    oldEmail,
    'Your rwnd.tv email address was changed',
    `Your rwnd.tv account's email address was just changed to ${newEmail}.\n\nIf this was you, no action is needed — you'll need to use the new address to log in from now on. If it wasn't you, someone else may have access to your account; contact this instance's admin.`,
    `<p>Your rwnd.tv account's email address was just changed to <strong>${newEmail}</strong>.</p>` +
      `<p>If this was you, no action is needed — you'll need to use the new address to log in from now on. If it wasn't you, someone else may have access to your account; contact this instance's admin.</p>`,
  )
}
