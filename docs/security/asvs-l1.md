# ASVS 4.0.3 Level 1 coverage

The audit record for rwnd.tv's M3 security review (see `docs/TODO_ARCHIVE.md`'s
"Full security review before M3 closes" entry for the staged-commit summary,
and `docs/adr/0007-security-posture.md` for the trust model and accepted-risk
reasoning). One table per in-scope
[OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
4.0.3 chapter, Level 1 requirements plus the handful of Level 2 items called
out explicitly where relevant to a self-hosted multi-user app (session
revocation UI, `__Host-` cookies).

- **Review started:** 2026-08-29
- **Review completed:** 2026-08-29 (Stages A–J, ten staged commits)
- **ASVS version:** [4.0.3](https://github.com/OWASP/ASVS/blob/master/4.0/docs_en/OWASP%20Application%20Security%20Verification%20Standard%204.0.3-en.pdf)
- **Reviewed against commit:** `6fd743a7aab30df92b065b170ca1c4075bab795e` (Stage I; this record itself lands in Stage J — see `git log` for the current HEAD)
- **Target level:** L1 throughout, plus named L2 items
- **See also:** `docs/adr/0007-security-posture.md` for the trust model and the reasoning behind every accepted-risk row below
- **In scope:** `apps/api`, `apps/web`, `packages/db`, `packages/shared`, CI (`.github/workflows`), Docker packaging (`Dockerfile`, `docker-compose.yml`)
- **Out of scope:** host OS hardening, the reverse proxy itself (only its expected config is documented), Postgres server hardening, the metadata providers' own security (TMDB/TVDB/Trakt)

Status vocabulary (closed set): `Pass` / `Fail → fixed Stage X` / `Deferred`
/ `Accepted risk` / `N/A`. Every non-`Pass` row links to a file, a
`docs/TODO.md` item title, or an ADR. This file is the durable audit
record — update it in place as further items are addressed, rather than
superseding it with a new document, so a future reviewer can diff against
a known baseline.

## V1 — Architecture, Design and Threat Modeling

Mostly process/documentation requirements rather than code-verifiable ones;
`docs/adr/0007-security-posture.md` (Stage J) is where the trust-model
threat-modeling requirements (V1.1.2, V1.1.4) actually get answered for this
project, rather than scattering that reasoning across this table.

| Req            | Status                 | Evidence / rationale                                                                                                                 |
| -------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| V1.1.4         | Deferred → Stage J     | Trust boundaries/data flows documented in `docs/adr/0007-security-posture.md` rather than here                                       |
| V1.2.3         | Pass                   | Single auth mechanism (local credentials); `docs/adr/0003-auth-model.md`                                                             |
| V1.4.1         | Pass                   | All access control enforced server-side in `apps/api`; nothing client-trusted                                                        |
| V1.4.4         | Fail → fixed Stage B   | Auth is opt-in per route today (100 sites/17 files) rather than one vetted enforcement point — `apps/api/src/middleware/auth.ts`     |
| V1.6.1         | Pass                   | `apps/api/src/lib/crypto.ts` — AES-256-GCM for the one secret class needing recovery (Trakt tokens); `docs/adr/0004-trakt-import.md` |
| V1.9.1         | N/A (deployment)       | TLS is the reverse proxy's responsibility; `docs/self-hosting.md`                                                                    |
| V1.12.2        | Fail → fixed Stage D/F | Avatar served with a client-supplied `Content-Type` and no `Content-Disposition` — `apps/api/src/routes/auth.ts:557`                 |
| V1.14.3        | Fail → fixed Stage H   | No dependency/build warning step beyond Dependabot; CodeQL + audit added                                                             |
| Other V1 items | N/A                    | SDLC/org-process requirements outside this repo's scope                                                                              |

## V2 — Authentication

| Req                | Status                    | Evidence / rationale                                                                                                                                                                                                                                                                                                                 |
| ------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| V2.1.1             | Pass                      | `passwordSchema = z.string().min(12).max(256)` — `packages/shared/src/schemas/auth.ts:8`                                                                                                                                                                                                                                             |
| V2.1.2             | Pass                      | Long passwords aren't truncated (Argon2id hashes the full input); the 256-char cap satisfies the requirement's intent (permit 64+, deny unbounded) without the specific 128 threshold being load-bearing                                                                                                                             |
| V2.1.3             | Pass                      | Argon2id via `@node-rs/argon2` never truncates input                                                                                                                                                                                                                                                                                 |
| V2.1.7             | Fail → fixed              | `isPasswordPwned()` (`apps/api/src/lib/hibp.ts`) checks HIBP's k-anonymity range API on registration, `/setup`, password change, and password reset — only a 5-char hash prefix ever leaves the instance. Fails open (allows the password) on any network error, timeout, or non-200, so an offline self-hosted instance still works |
| V2.1.9–11          | Pass                      | No composition rules, no rotation requirement, no paste-blocking anywhere in `apps/web`                                                                                                                                                                                                                                              |
| V2.2.1             | Fail → fixed Stage E      | No rate limiting/lockout anywhere — confirmed by repo-wide grep                                                                                                                                                                                                                                                                      |
| V2.4.1             | Pass                      | Argon2id, `apps/api/src/lib/password.ts` — `memoryCost: 19456, timeCost: 2, parallelism: 1`                                                                                                                                                                                                                                          |
| V2.4.2             | Pass                      | `@node-rs/argon2` generates a unique random salt per hash internally                                                                                                                                                                                                                                                                 |
| V2.5.3             | Pass                      | Reset flow never reveals the current password; generic responses throughout                                                                                                                                                                                                                                                          |
| V2.5.4             | Pass                      | No shared/default accounts; first admin created via one-time `POST /setup`                                                                                                                                                                                                                                                           |
| V2.5.5             | Fail → fixed              | `sendPasswordChangedNotice`/`sendEmailChangedNotice` (`apps/api/src/lib/email.ts`), sent from `POST /auth/me/password` and `POST /auth/confirm-email-change` — the email-changed notice goes to the _old_ address, the one that actually needs to know                                                                               |
| V2.5.6             | Pass                      | Token-based reset via `apps/api/src/lib/account-tokens.ts`, 1h TTL, single-use                                                                                                                                                                                                                                                       |
| V2.6.1–3           | Pass                      | Account-recovery tokens are 256-bit CSPRNG (`generateSecret(32)`), single-use, hashed at rest                                                                                                                                                                                                                                        |
| V2.7.2             | Pass (reassessed)         | Password-reset/email-change tokens keep their 1h TTL — ASVS's 10-minute guidance targets a true out-of-band channel (SMS, push), not an emailed link the user may not open immediately; see `apps/api/src/lib/account-tokens.ts`                                                                                                     |
| V4.3.1 (admin MFA) | Deferred → `docs/TODO.md` | No MFA exists anywhere in the app; `requireAdmin` is password-only. Real feature gap, not a quick fix — log as a follow-up                                                                                                                                                                                                           |

## V3 — Session Management

| Req    | Status                   | Evidence / rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V3.1.1 | Pass                     | Session token only ever in the cookie, never a URL                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| V3.2.1 | Pass                     | `createSession` mints a fresh token on every login — `apps/api/src/lib/session.ts:8`                                                                                                                                                                                                                                                                                                                                                                                                   |
| V3.2.2 | Pass                     | 256-bit CSPRNG token (`generateSecret(32)`), far above the 64-bit minimum                                                                                                                                                                                                                                                                                                                                                                                                              |
| V3.2.3 | Pass                     | httpOnly cookie; `apps/api/src/lib/cookies.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| V3.3.1 | Pass                     | Logout deletes the session row; password reset/change revoke sessions — `session.test.ts`                                                                                                                                                                                                                                                                                                                                                                                              |
| V3.3.2 | Fail → fixed             | A session's TTL now slides forward on use (throttled to once/minute, both the DB row and the cookie's own `Expires`) instead of being fixed from login — `apps/api/src/lib/session.ts`'s `resolveSession()`. An idle session still expires on schedule; nothing renews it if nobody's using it. `GET`/`DELETE /auth/me/sessions` (F-24, Level 2) shipped alongside, letting a user see and revoke their own other active sessions — `apps/web/src/components/account/SessionsCard.tsx` |
| V3.4.1 | **Fail → fixed Stage I** | `docker-compose.yml`'s `${COOKIE_SECURE:-false}` overrides `env.ts`'s production default — session cookie ships without `Secure` on the documented deployment path (F-01)                                                                                                                                                                                                                                                                                                              |
| V3.4.2 | Pass                     | `httpOnly: true` — `apps/api/src/lib/cookies.ts:7`                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| V3.4.3 | Pass                     | `sameSite: 'Lax'` — `apps/api/src/lib/cookies.ts:9`                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| V3.4.4 | Fail → fixed             | `__Host-` prefix applied whenever `COOKIE_SECURE` is true — `apps/api/src/lib/cookies.ts`'s `sessionCookieName()`. Left plain on a self-hoster's LAN-only, plain-HTTP deployment, where the prefix's mandatory `Secure` would make the browser drop the cookie entirely                                                                                                                                                                                                                |
| V3.4.5 | Accepted risk            | `path: '/'` rather than a narrower path — the SPA and API share one origin, so a narrower path isn't meaningful here                                                                                                                                                                                                                                                                                                                                                                   |
| V3.7.1 | Pass                     | Password/email change and account deletion all re-verify `currentPassword` — `apps/api/src/routes/auth.ts:302,357,472`                                                                                                                                                                                                                                                                                                                                                                 |

## V4 — Access Control

| Req           | Status                                  | Evidence / rationale                                                                                                                                                                                       |
| ------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V4.1.1        | Pass                                    | All checks in `apps/api` handlers, nothing client-enforced                                                                                                                                                 |
| V4.1.2        | Pass                                    | `user.role` read from the resolved session/DB, never from client input                                                                                                                                     |
| V4.1.3        | Pass                                    | Every query scoped by `userId` — `library.test.ts`, `watchlists.test.ts`, `imports.test.ts`, `backups.test.ts` isolation tests                                                                             |
| V4.1.5        | Pass                                    | `requireAuth` fails closed (401) on any resolution failure                                                                                                                                                 |
| V4.2.1 (IDOR) | Pass, with two accepted-risk exceptions | Cross-user isolation extensively tested; `assignableUsers`/cross-user webhook attribution (F-14/F-15) is documented intentional multi-user-Plex design, not IDOR — see `docs/adr/0007-security-posture.md` |
| V4.2.2 (CSRF) | Fail → fixed Stage C                    | No CSRF defence at all; 6 multipart routes reachable with a session cookie (F-05)                                                                                                                          |
| V4.3.1        | Deferred → `docs/TODO.md`               | See V2 table — no MFA exists for admin actions                                                                                                                                                             |
| V4.3.2        | Pass                                    | No directory browsing; `serveStatic` only serves real files under `public/`, falls through to the SPA                                                                                                      |

## V5 — Validation, Sanitization and Encoding

| Req           | Status               | Evidence / rationale                                                                                                                                                                        |
| ------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V5.1.3        | Fail → fixed Stage F | 87/93 routes are Zod-validated; 6 hand-written multipart routes are not (`PUT                                                                                                               | DELETE | GET /auth/me/avatar`, `GET /account/export`, `POST /import/trakt/zip`, `POST /import/csv`, `POST /webhooks/plex/:token`) |
| V5.1.4        | Pass                 | Zod schemas centralised in `packages/shared/src/schemas/`                                                                                                                                   |
| V5.2.4        | Pass                 | No `eval`/`new Function` anywhere in the repo (grep confirmed)                                                                                                                              |
| V5.2.6 (SSRF) | Fail → fixed Stage F | `externalId` is unconstrained `z.string()` interpolated into provider URL paths — host is env-fixed so this is endpoint confusion rather than classic SSRF, still worth constraining (F-18) |
| V5.3.3 (XSS)  | Pass                 | React auto-escapes JSX; zero `dangerouslySetInnerHTML`/`innerHTML` in `apps/web`                                                                                                            |
| V5.3.4        | Pass                 | Drizzle ORM parameterized queries throughout; no raw SQL string concatenation                                                                                                               |
| V5.5.4        | Pass                 | `JSON.parse`, never `eval`, including the hand-rolled webhook payload parser                                                                                                                |

## V7 — Error Handling and Logging

| Req    | Status               | Evidence / rationale                                                                                                                                                                                            |
| ------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V7.1.1 | Fail → fixed Stage G | No credentials/tokens logged, but user email addresses are — `apps/api/src/routes/auth.ts:202,612` (F-17); `TMDB_API_KEY` reachable via a stringified request URL — `apps/api/src/providers/tmdb.ts:156` (F-09) |
| V7.4.1 | Pass                 | `app.onError` returns a generic `{error: 'Internal Server Error'}` — `apps/api/src/app.ts:48`                                                                                                                   |

## V8 — Data Protection

| Req    | Status                                               | Evidence / rationale                                                                                                                                                                                                                    |
| ------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V8.2.1 | Fail → fixed                                         | `Cache-Control: no-store` on every `/api/*` response by default (`apps/api/src/app.ts`), set before route handlers run so the avatar route's own long-lived, private value still overrides it                                           |
| V8.2.2 | Pass                                                 | Zero real `localStorage`/`sessionStorage` use in `apps/web` (confirmed by grep); auth state lives only in the httpOnly cookie + in-memory React Query cache                                                                             |
| V8.2.3 | Pass                                                 | React Query cache is reset on logout — `apps/web/src/lib/reset-auth-cache.ts`                                                                                                                                                           |
| V8.3.1 | Accepted risk (webhook), Fail → fixed Stage G (TMDB) | Plex webhook token is a URL path segment by necessity (Plex allows no custom headers) — documented rationale in `apps/api/src/routes/webhooks.ts:12-22`; `TMDB_API_KEY` in the outbound query string is unrelated and gets fixed (F-09) |
| V8.3.2 | Pass                                                 | Full CSV export (`GET /account/export`) and account deletion both exist                                                                                                                                                                 |

## V9 — Communication

| Req      | Status                               | Evidence / rationale                                                                                                                                                                                                                                                                                                                                                               |
| -------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V9.1.1   | **Fail — live instance, still open** | `http://rwnd.tv/` still serves the full app with no HTTPS redirect (re-confirmed at review close-out, 2026-08-29). This is a home-server reverse-proxy config change, not something in this repository — needs James's hands on the proxy, or explicit go-ahead to do it over SSH. The application's own half (HSTS, sent once `COOKIE_SECURE` confirms HTTPS) shipped in Stage D. |
| V9.1.2–3 | Pass                                 | Observed live via `openssl s_client -connect rwnd.tv:443`: negotiates TLS 1.3 (TLS_AES_256_GCM_SHA384) by default; TLS 1.2 also available with a strong cipher (ECDHE-ECDSA-AES256-GCM-SHA384); Let's Encrypt certificate, correct CN                                                                                                                                              |

## V12 — Files and Resources

| Req     | Status               | Evidence / rationale                                                                                                                                                                |
| ------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V12.1.1 | Fail → fixed Stage C | Plex webhook `parseBody()` has no size cap at all; no global body-limit middleware (F-07)                                                                                           |
| V12.3.x | N/A                  | No user-controlled filesystem paths from uploads — avatars are stored as `bytea` in Postgres, not written to disk; backup filenames go through `isValidBackupId`'s allow-list regex |
| V12.4.1 | N/A                  | Same reason — nothing untrusted is written to the filesystem                                                                                                                        |

## V13 — API and Web Service

| Req            | Status                                               | Evidence / rationale                                              |
| -------------- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| V13.1.3        | Accepted risk (webhook), Fail → fixed Stage G (TMDB) | Same as V8.3.1                                                    |
| V13.2.1        | Pass                                                 | Hono routes declare explicit methods; no unexpected verbs enabled |
| V13.2.2        | Fail → fixed Stage F                                 | Same 6 routes as V5.1.3                                           |
| V13.2.3 (CSRF) | Fail → fixed Stage C                                 | Same as V4.2.2                                                    |

## V14 — Configuration

| Req     | Status                              | Evidence / rationale                                                                                                                                                                                                                                             |
| ------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V14.2.1 | Fail → fixed Stage H                | Dependabot exists but no CodeQL, `pnpm audit`, or image scan in CI (F-19)                                                                                                                                                                                        |
| V14.3.2 | Pass                                | `NODE_ENV=production` set in `Dockerfile:38`; no debug endpoints found                                                                                                                                                                                           |
| V14.3.3 | Pass                                | Swagger UI's `info.version: '1.0.0'` is static metadata, not a real version leak — and `/api/docs`/`/openapi.json` are gated behind a session now (Stage B, F-10), so this is unauthenticated-unreachable regardless; no other version/build info exposure found |
| V14.4.1 | Pass                                | Hono sets `Content-Type` on every response                                                                                                                                                                                                                       |
| V14.4.2 | Fail → fixed Stage D/F              | No `Content-Disposition` on the avatar response (F-06)                                                                                                                                                                                                           |
| V14.4.3 | Fail → fixed Stage D                | No CSP anywhere (F-04)                                                                                                                                                                                                                                           |
| V14.4.4 | Fail → fixed Stage D                | No `X-Content-Type-Options: nosniff` anywhere (F-04)                                                                                                                                                                                                             |
| V14.4.5 | App fixed Stage D; proxy still open | HSTS now sent by the app once `COOKIE_SECURE` confirms HTTPS (F-04); the reverse proxy itself still needs the HTTP→HTTPS redirect — see V9.1.1 above (F-00)                                                                                                      |
| V14.4.6 | Fail → fixed Stage D                | No `Referrer-Policy` (F-04)                                                                                                                                                                                                                                      |
| V14.4.7 | Fail → fixed Stage D                | No `X-Frame-Options`/`frame-ancestors` (F-04)                                                                                                                                                                                                                    |
| V14.5.2 | Pass                                | Auth decisions are session-cookie-based, never derived from the `Origin` header                                                                                                                                                                                  |

## Still open at review close-out

**V9.1.1 — plain HTTP still served on the live instance.** The one finding
this review could not close: it's a home-server reverse-proxy
configuration change, not something in this repository. Needs either
James directly, or explicit go-ahead to make the change over SSH.

## Deferred items (tracked in `docs/TODO.md`'s Security section)

Accepted-risk items (F-14, F-15) are documented in `docs/adr/0007-security-
posture.md`, not tracked as open TODO work — see that ADR for why each
one is a deliberate decision, not an oversight. Genuine follow-up work,
logged to `docs/TODO.md`:

- V4.3.1 — admin MFA (no MFA exists anywhere in the app)
- Full structured request logging remains out of scope — this review (and
  the 2026-08-29 follow-up pass closing the rest of this list) only ever
  added minimal `[security]`-prefixed event logging, not a general
  request-logging pipeline; that stays a real gap, not a narrowing worth
  hiding

Closed in the 2026-08-29 follow-up pass (see `docs/TODO_ARCHIVE.md`):
F-25 (`packages/db`'s scripts now share one validated `env.ts` loader, plus
an explicit `DATABASE_SSL` option), V8.2.1 (blanket `Cache-Control: no-store`
on `/api/*`), V2.7.2 (1h token TTL reassessed and kept, see the V2.7.2 row
above), V3.4.4 (`__Host-` cookie prefix, conditional on `COOKIE_SECURE` —
see the V3.4.4 row above), F-24 / V3.3.2 (sliding session expiry plus a
session list/revoke UI — see the V3.3.2 row above), F-22 (`POST`/`GET`/
`DELETE /invites`, `apps/api/src/routes/invites.ts` — `registration_mode:
'invite'` is finally reachable), V2.5.5 (password/email-change notification
emails — see the V2.5.5 row above), and F-27 / V2.1.7 (breached-password
check, HIBP k-anonymity — see the V2.1.7 row above). Image signing (cosign/
OIDC keyless) and
`read_only: true` on the `app` container were also closed,
in an earlier same-day pass — see `docs/TODO_ARCHIVE.md`'s "Further
container hardening"
entry — this list had gone stale rather than being updated at the time.
