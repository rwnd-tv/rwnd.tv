import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import nodemailer, { type Transporter } from 'nodemailer'
import type { RegistrationMode } from '@rwnd/shared'
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

// Same light-mode values as apps/web/src/index.css's `--color-*` custom
// properties (`:root`, not the dark-mode overrides — an email client's
// dark-mode handling can't be trusted the way the app's own CSS can, so
// this always renders as the light theme regardless of the recipient's
// system setting). `gradientFrom`/`gradientTo` match the landing page's
// own hero/CTA gradient (apps/web/src/routes/LandingPage.tsx's `GRADIENT`
// constant) rather than the flat `--color-primary` indigo, which on the
// landing page is reserved for plain inline links — the gradient is what
// actually reads as "the rwnd.tv brand" there.
const BRAND = {
  bg: '#f6f6f7',
  card: '#ffffff',
  border: '#e2e2e5',
  text: '#16161a',
  muted: '#5c5c66',
  gradientFrom: '#d946ef',
  gradientTo: '#f59e0b',
}

// Not a webfont — deliberately. Email clients (Outlook especially)
// routinely strip <link>/@font-face/@import, so a real webfont would
// either fail silently or need to be embedded, which most clients also
// block. This is the exact stack Tailwind v4's Preflight applies to the
// app itself (apps/web has no font-family override anywhere), so it's
// already "the app's font" on every platform it actually renders on.
const FONT_STACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

const LOGO_CID = 'rwnd-logo'

// `undefined` = not yet attempted; `null` = attempted and failed (e.g. no
// built web app present, the case for local `pnpm dev:api` without a
// `pnpm build` first) — cached either way so a missing file only ever
// fails once, not on every single email sent.
let cachedLogo: Buffer | null | undefined

/** Reads `apps/web/public/rwnd-mark-128.png` — the same file
 * `apps/api/src/app.ts` serves the built web app from (`./public`
 * relative to the API's own `process.cwd()`), just read directly off
 * disk here instead of over HTTP. Embedded as a CID attachment
 * (`wrapEmailHtml`/`sendMail` below) rather than linked by URL — an
 * email client fetches a linked image from *its own* infrastructure at
 * read time (e.g. Gmail's server-side image proxy), not the recipient's
 * browser, which can't reach an instance that isn't publicly reachable
 * (live-verified 2026-09-02: a broken image icon in Gmail for a
 * dev.rwnd.tv-hosted logo, despite the URL working fine from a plain
 * `curl` — dev.rwnd.tv has a deliberate IP allowlist prod doesn't).
 * Embedding the bytes in the message itself sidesteps that entirely:
 * nothing needs to be fetched from anywhere once the email is delivered. */
async function loadLogoBuffer(): Promise<Buffer | null> {
  if (cachedLogo !== undefined) return cachedLogo
  try {
    cachedLogo = await readFile(join(process.cwd(), 'public', 'rwnd-mark-128.png'))
  } catch {
    cachedLogo = null
  }
  return cachedLogo
}

/**
 * Wraps a sender's own inner HTML — built the same plain `<p>`-per-line
 * way every function below always has — in a shared header/card/footer
 * shell. Table-based layout with only inline styles, no external
 * stylesheet, no CSS Grid/Flexbox: the usual constraints for HTML email
 * that has to survive Outlook's Word-based rendering engine alongside
 * every modern client. Called once, from sendMail() below, so every
 * sender in this file gets the same look automatically rather than each
 * one needing to remember to wrap its own content. `hasLogo` decides
 * whether the header references the CID attachment sendMail() adds —
 * omitted entirely rather than left as a broken `<img>` when the file
 * couldn't be read (see loadLogoBuffer's doc comment).
 */
function wrapEmailHtml(innerHtml: string, hasLogo: boolean): string {
  const logoImg = hasLogo
    ? `<img src="cid:${LOGO_CID}" width="24" height="24" alt="" style="display:block;" />`
    : ''
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1" /></head>` +
    `<body style="margin:0;padding:32px 16px;background-color:${BRAND.bg};font-family:${FONT_STACK};">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;">` +
    `<tr><td style="padding:0 4px 20px;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0"><tr>` +
    `<td style="vertical-align:middle;padding-right:8px;">${logoImg}</td>` +
    `<td style="vertical-align:middle;font-size:16px;font-weight:600;color:${BRAND.text};">rwnd.tv</td>` +
    `</tr></table>` +
    `</td></tr>` +
    `<tr><td style="background-color:${BRAND.card};border:1px solid ${BRAND.border};border-radius:12px;padding:28px;">` +
    `<div style="font-size:15px;line-height:1.6;color:${BRAND.text};">${innerHtml}</div>` +
    `</td></tr>` +
    `<tr><td style="padding:20px 4px 0;font-size:12px;color:${BRAND.muted};">Sent by rwnd.tv, a free, self-hosted watch-history tracker.</td></tr>` +
    `</table></body></html>`
  )
}

/**
 * The one primary action a sender wants attention on, styled as a real
 * button — used alongside, never instead of, that action's own plain-
 * URL paragraph (every sender below still includes one): some clients
 * strip images and background styling entirely, and showing the literal
 * destination as text is a transparency convention this file already
 * followed before any of this styling existed. `background-color` is
 * the fallback for clients that don't render the `background-image`
 * gradient (older Outlook builds); the two are deliberately layered
 * rather than relying on the gradient alone.
 */
function emailButton(url: string, label: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr>` +
    `<td style="border-radius:8px;background-color:${BRAND.gradientFrom};background-image:linear-gradient(135deg, ${BRAND.gradientFrom} 0%, ${BRAND.gradientTo} 100%);">` +
    `<a href="${url}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${label}</a>` +
    `</td></tr></table>`
  )
}

/** The "or copy and paste this link" fallback paragraph every button
 * above is paired with. */
function fallbackLinkParagraph(url: string): string {
  return `<p style="font-size:13px;color:${BRAND.muted};">Or copy and paste this link: <a href="${url}" style="color:${BRAND.muted};">${url}</a></p>`
}

async function sendMail(to: string, subject: string, text: string, html: string): Promise<void> {
  const logo = await loadLogoBuffer()
  await getTransport().sendMail({
    from: loadEnv().SMTP_FROM,
    to,
    subject,
    text,
    html: wrapEmailHtml(html, Boolean(logo)),
    attachments: logo
      ? [{ filename: 'rwnd-mark.png', content: logo, cid: LOGO_CID, contentDisposition: 'inline' }]
      : [],
  })
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const url = `${loadEnv().APP_URL}/verify-email?token=${encodeURIComponent(token)}`
  const hours = EMAIL_VERIFICATION_TTL_MS / (60 * 60 * 1000)
  await sendMail(
    to,
    'Verify your rwnd.tv email address',
    `Verify your email address by visiting this link (expires in ${hours} hours):\n${url}\n\nIf you didn't create an rwnd.tv account, you can ignore this email.`,
    `<p>Verify your email address by clicking the button below. This link expires in ${hours} hours.</p>` +
      emailButton(url, 'Verify email address') +
      fallbackLinkParagraph(url) +
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
    `<p>Reset your password by clicking the button below. This link expires in ${minutes} minutes.</p>` +
      emailButton(url, 'Reset password') +
      fallbackLinkParagraph(url) +
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
    `<p>Someone requested changing an rwnd.tv account's email address to this one. Confirm the change by clicking the button below. This link expires in ${minutes} minutes.</p>` +
      emailButton(url, 'Confirm new email address') +
      fallbackLinkParagraph(url) +
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

/** Registration instructions worded per the instance's own registration
 * mode — instance-wide, not chosen per-recipient, so it adds no
 * account-enumeration signal (the same reasoning `sendAccountAlreadyExistsNotice`
 * above already applies). Plain language, no product jargon — the
 * recipient of `sendWebhookLinkEmail` below may have no idea what this
 * app even is yet. Returns both a plaintext and an HTML form since the
 * `open` case's link needs to render as a real `<a>` in the HTML body,
 * not just raw URL text (it wasn't before — found 2026-09-02).
 * `adminEmail` — null unless an admin has actually set one
 * (`instance_settings.admin_email`, packages/db/src/schema.ts) — turns
 * the 'invite'/'closed' cases' vague "ask whoever runs it" into an
 * actual address to write to when one's configured. */
function registrationInstructions(
  registrationMode: RegistrationMode,
  instanceName: string,
  adminEmail: string | null,
): { text: string; html: string } {
  const contactText = adminEmail ? ` (contact: ${adminEmail})` : ''
  const contactHtml = adminEmail
    ? ` (contact: <a href="mailto:${adminEmail}">${adminEmail}</a>)`
    : ''
  // A self-hoster's chosen instanceName can itself contain something that
  // looks like a domain (e.g. "Dev rwnd.tv Instance" — a real example,
  // 2026-09-02) — Gmail's own link auto-detection then underlines just
  // that substring and points it at whatever bare domain it parsed out,
  // not this instance's actual APP_URL, which is actively wrong for
  // anything other than the literal rwnd.tv production instance.
  // Wrapping every instanceName mention in a real anchor up front (same
  // fix as the "connect it to your ... login" sentence in
  // sendWebhookLinkEmail below) pre-empts that: clients don't further
  // auto-link text already inside an `<a>`.
  const instanceHtml = `<a href="${loadEnv().APP_URL}">${instanceName}</a>`
  switch (registrationMode) {
    case 'open': {
      const registerUrl = `${loadEnv().APP_URL}/register`
      return {
        text: `If you don't already have an account, you can create one here: ${registerUrl}`,
        html: `If you don't already have an account, you can <a href="${registerUrl}">create one here</a>.`,
      }
    }
    case 'invite':
      return {
        text: `If you don't already have an account, ask whoever runs ${instanceName} for an invite first${contactText}.`,
        html: `If you don't already have an account, ask whoever runs ${instanceHtml} for an invite first${contactHtml}.`,
      }
    case 'closed':
      return {
        text: `If you don't already have an account, ask whoever runs ${instanceName} to set one up for you${contactText}.`,
        html: `If you don't already have an account, ask whoever runs ${instanceHtml} to set one up for you${contactHtml}.`,
      }
  }
}

/** Sent when a webhook token owner generates a one-time code
 * (`POST /tokens/{id}/webhook-links/{linkId}/link-code`) so the person
 * an external account actually belongs to can link it themselves
 * rather than the token owner assigning it directly — see
 * `docs/adr/0007-security-posture.md`'s addendum. Written for a
 * recipient who may have no idea what rwnd.tv is: no "webhook",
 * "claim", or "redeem" — just "link your Plex account" (the function
 * name itself was `sendWebhookClaimEmail` until 2026-09-02, when the
 * whole feature was renamed from "claim" to "link" throughout — this
 * copy already said "link" even before that, which is what prompted the
 * rename). `instanceName` (the admin-configurable
 * `instance_settings.instance_name`, not the literal string "rwnd.tv")
 * is what identifies *which* deployment this is about, since
 * self-hosting means there can be more than one — confirmed 2026-09-02
 * that generic "rwnd.tv" mentions ahead of the actual link read as
 * confusingly inconsistent.
 *
 * A single link, the same shape as `sendVerificationEmail`/
 * `sendPasswordResetEmail` above, rather than a code to copy and paste
 * elsewhere (2026-09-02: the original code-only version was confusing).
 * The link (`/link-account?code=...`) is session-authenticated, not
 * bearer-by-token like verify-email/reset-password — `LinkWebhookAccountPage.tsx`
 * sits behind `ProtectedRoute`, so a not-yet-logged-in recipient is sent
 * through `/login` first (which now honours a `next` redirect back to
 * this same link) rather than the click silently doing nothing.
 *
 * Deliberately takes no account name or other detail about the watching
 * account — nothing here should repeat attacker-influenceable text (an
 * external account's display name) into an unescaped HTML body, unlike
 * this file's other senders which only ever interpolate values the app
 * itself generated. Always includes both the "don't have an account" and
 * "already have one" instructions regardless of whether `to` matches a
 * real account, for the same reason.
 *
 * Opens with what the app *is* (a free, private watch-history tracker)
 * before what just happened to the recipient — James, 2026-09-02: an
 * earlier draft led straight with "X keeps track of what you've
 * watched, and someone there has spotted a Plex account...", which read
 * as surveillance-flavored to someone with zero context on rwnd.tv,
 * rather than as an invitation. */
export async function sendWebhookLinkEmail(
  to: string,
  code: string,
  registrationMode: RegistrationMode,
  instanceName: string,
  adminEmail: string | null,
): Promise<void> {
  const appUrl = loadEnv().APP_URL
  const linkUrl = `${appUrl}/link-account?code=${encodeURIComponent(code)}`
  const instructions = registrationInstructions(registrationMode, instanceName, adminEmail)
  await sendMail(
    to,
    `Link your Plex account on ${instanceName}`,
    `${instanceName} is a free tool that helps you privately keep track of the TV shows and movies you watch.\n\nSomeone there has spotted a Plex account that looks like it might be yours. If that's right, open this link to connect it to your ${instanceName} login (${appUrl}) and your future Plex viewing will be automatically tracked. Nothing happens until you do this yourself:\n${linkUrl}\n\n${instructions.text}\n\nThis link expires in 7 days and can only be used once. If you don't recognize this, you can safely ignore this email.`,
    `<p><a href="${appUrl}">${instanceName}</a> is a free tool that helps you privately keep track of the TV shows and movies you watch.</p>` +
      `<p>Someone there has spotted a Plex account that looks like it might be yours. If that's right, click the button below to connect it to your <a href="${appUrl}">${instanceName}</a> login and your future Plex viewing will be automatically tracked. Nothing happens until you do this yourself.</p>` +
      emailButton(linkUrl, 'Link this account') +
      fallbackLinkParagraph(linkUrl) +
      `<p>${instructions.html}</p>` +
      `<p>This link expires in 7 days and can only be used once. If you don't recognize this, you can safely ignore this email.</p>`,
  )
}

/** Sent when an admin generates a registration invite code
 * (`POST /invites`, `apps/api/src/routes/invites.ts`) and chooses to
 * email it rather than (or as well as) copying it to hand over
 * themselves. Unlike `sendWebhookLinkEmail` above, no registrationMode
 * branching is needed here — generating an invite only ever happens
 * while this instance's registration mode already is `invite`, so the
 * recipient's one path is always "register with this code." */
export async function sendInviteEmail(to: string, code: string): Promise<void> {
  const registerUrl = `${loadEnv().APP_URL}/register`
  await sendMail(
    to,
    "You've been invited to rwnd.tv",
    `Someone has invited you to create an account on rwnd.tv.\n\nRegister at ${registerUrl} using this invite code:\n${code}\n\nThis code expires in 7 days and can only be used once. If you don't recognize this, you can ignore it — nothing happens until the code is redeemed.`,
    `<p>Someone has invited you to create an account on rwnd.tv.</p>` +
      emailButton(registerUrl, 'Create your account') +
      fallbackLinkParagraph(registerUrl) +
      `<p>Use this invite code when you register:</p>` +
      `<p><code style="background-color:${BRAND.bg};padding:2px 6px;border-radius:4px;">${code}</code></p>` +
      `<p>This code expires in 7 days and can only be used once. If you don't recognize this, you can ignore it — nothing happens until the code is redeemed.</p>`,
  )
}

/** Sent to the *old* address once an email change is confirmed
 * (POST /auth/confirm-email-change) — the new address already went
 * through sendEmailChangeVerification above to prove ownership before the
 * change happened at all; this is the compensating notice for whoever
 * held the *old* address, the one who'd actually want to know if this
 * wasn't them (ASVS V2.5.5). `newEmail` is shown so the old address's
 * owner has something concrete to report if this wasn't them, without
 * this email itself being a link anyone could act on. `instanceName` is
 * linked to `APP_URL` in the HTML body, same reasoning as
 * `sendWebhookLinkEmail`'s own instance-name link (2026-09-02: a self-
 * hoster's chosen instanceName can itself contain what looks like a
 * domain, e.g. "Dev rwnd.tv Instance" — leaving it unlinked lets Gmail's
 * own auto-detection underline just that substring and point it at the
 * wrong place). `adminEmail` — null unless an admin has set one — turns
 * "contact this instance's admin" into an actual address when available. */
export async function sendEmailChangedNotice(
  oldEmail: string,
  newEmail: string,
  instanceName: string,
  adminEmail: string | null,
): Promise<void> {
  const appUrl = loadEnv().APP_URL
  const adminContactText = adminEmail
    ? `contact this instance's admin at ${adminEmail}`
    : `contact this instance's admin`
  const adminContactHtml = adminEmail
    ? `contact this instance's admin at <a href="mailto:${adminEmail}">${adminEmail}</a>`
    : `contact this instance's admin`
  await sendMail(
    oldEmail,
    `Your ${instanceName} email address was changed`,
    `Your ${instanceName} account's email address was just changed to ${newEmail}.\n\nIf this was you, no action is needed: you'll need to use the new address to log in from now on. If it wasn't you, someone else may have access to your account; ${adminContactText}.`,
    `<p>Your <a href="${appUrl}">${instanceName}</a> account's email address was just changed to <strong>${newEmail}</strong>.</p>` +
      `<p>If this was you, no action is needed: you'll need to use the new address to log in from now on. If it wasn't you, someone else may have access to your account; ${adminContactHtml}.</p>`,
  )
}
