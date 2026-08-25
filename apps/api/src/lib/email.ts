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
