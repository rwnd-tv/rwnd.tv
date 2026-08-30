# Security Policy

## Supported Versions

rwnd.tv is at v1.0.0, a small, part-time-maintained project moving quickly.
Only the latest tagged release (`:latest` image) and `main` (`:edge` image)
receive fixes — there's no support for older tagged versions once a new one
ships. Self-hosters should upgrade promptly; see
[docs/self-hosting.md](docs/self-hosting.md#upgrading).

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, use [GitHub's private vulnerability reporting](https://github.com/rwnd-tv/rwnd.tv/security/advisories/new)
for this repository, or email james.bulman@rwnd.tv with details. Please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce it
- Any relevant logs or proof-of-concept code

You should get an acknowledgement within a few days. This is a small,
part-time-maintained project, so please be patient — but reports are taken
seriously and fixes are prioritised over new features.

## Scope

Areas of particular interest given how rwnd.tv is used:

- Authentication and session handling (`apps/api/src/lib/session.ts`,
  `apps/api/src/middleware/auth.ts`)
- API token handling for webhook ingestion (`apps/api/src/lib/tokens.ts`
  mints/hashes tokens; `apps/api/src/lib/api-tokens.ts` resolves one on an
  incoming webhook request)
- Multi-user data isolation (every query that touches `plays`, `api_tokens`,
  etc. should be scoped to the authenticated user)
- Two-factor authentication (`apps/api/src/lib/totp.ts`,
  `apps/api/src/routes/mfa.ts`)
- Invite-only registration (`apps/api/src/routes/invites.ts`)
- CSRF protection on the hand-written multipart routes (avatar upload,
  imports) — see the comment in `apps/api/src/app.ts` for why
- Avatar upload and per-user backup/restore (`apps/api/src/routes/backups.ts`)

A structured security review (OWASP ASVS 4.0.3 Level 1) was completed for
M3 — see `docs/security/asvs-l1.md` for the requirement-by-requirement
record and `docs/adr/0007-security-posture.md` for the trust model and
which findings were fixed vs. deliberately accepted.
