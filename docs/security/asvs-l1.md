# ASVS 4.0.3 Level 1 coverage

The audit record for rwnd.tv's M3 security review (see `docs/TODO.md` / the
"Full security review before M3 closes" item). One table per in-scope
[OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
4.0.3 chapter, Level 1 requirements plus the handful of Level 2 items called
out explicitly where relevant to a self-hosted multi-user app (session
revocation UI, `__Host-` cookies).

- **Review started:** 2026-08-29
- **ASVS version:** [4.0.3](https://github.com/OWASP/ASVS/blob/master/4.0/docs_en/OWASP%20Application%20Security%20Verification%20Standard%204.0.3-en.pdf)
- **Reviewed against commit:** `16e867464ed709195caf3e44bd1218c47026d029` (updated as later stages land)
- **Target level:** L1 throughout, plus named L2 items
- **In scope:** `apps/api`, `apps/web`, `packages/db`, `packages/shared`, CI (`.github/workflows`), Docker packaging (`Dockerfile`, `docker-compose.yml`)
- **Out of scope:** host OS hardening, the reverse proxy itself (only its expected config is documented), Postgres server hardening, the metadata providers' own security (TMDB/TVDB/Trakt)

Status vocabulary (closed set): `Pass` / `Fail → fixed Stage X` / `Deferred`
/ `Accepted risk` / `N/A` / `Pending`. Every non-`Pass`, non-`Pending` row
links to a file, a `docs/TODO.md` item title, or an ADR. `Pending` rows are
filled in as later stages land; none should remain by Stage J. This file is
the single source of truth for review status — the findings register in the
plan is a working document, this is the record.

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

| Req                | Status                    | Evidence / rationale                                                                                                                              |
| ------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| V2.1.1             | Pass                      | `passwordSchema = z.string().min(12).max(256)` — `packages/shared/src/schemas/auth.ts:8`                                                          |
| V2.1.2             | Pending                   | Long passwords aren't truncated (Argon2id hashes the full input), but nothing explicitly denies >128 chars beyond the 256 cap — assess in Stage F |
| V2.1.3             | Pass                      | Argon2id via `@node-rs/argon2` never truncates input                                                                                              |
| V2.1.7             | Deferred → `docs/TODO.md` | No breached-password check (HIBP k-anonymity) — a network dependency + design decision, not a quick fix                                           |
| V2.1.9–11          | Pass                      | No composition rules, no rotation requirement, no paste-blocking anywhere in `apps/web`                                                           |
| V2.2.1             | Fail → fixed Stage E      | No rate limiting/lockout anywhere — confirmed by repo-wide grep                                                                                   |
| V2.4.1             | Pass                      | Argon2id, `apps/api/src/lib/password.ts` — `memoryCost: 19456, timeCost: 2, parallelism: 1`                                                       |
| V2.4.2             | Pass                      | `@node-rs/argon2` generates a unique random salt per hash internally                                                                              |
| V2.5.3             | Pass                      | Reset flow never reveals the current password; generic responses throughout                                                                       |
| V2.5.4             | Pass                      | No shared/default accounts; first admin created via one-time `POST /setup`                                                                        |
| V2.5.5             | Pending                   | No email notification is sent when a password or email address changes — assess whether to add in Stage G                                         |
| V2.5.6             | Pass                      | Token-based reset via `apps/api/src/lib/account-tokens.ts`, 1h TTL, single-use                                                                    |
| V2.6.1–3           | Pass                      | Account-recovery tokens are 256-bit CSPRNG (`generateSecret(32)`), single-use, hashed at rest                                                     |
| V2.7.2             | Fail → fixed Stage F      | Password-reset/email-change tokens are 1h, not the 10-minute out-of-band window ASVS specifies — reassess TTL                                     |
| V4.3.1 (admin MFA) | Deferred → `docs/TODO.md` | No MFA exists anywhere in the app; `requireAdmin` is password-only. Real feature gap, not a quick fix — log as a follow-up                        |

## V3 — Session Management

| Req    | Status                           | Evidence / rationale                                                                                                                                                      |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V3.1.1 | Pass                             | Session token only ever in the cookie, never a URL                                                                                                                        |
| V3.2.1 | Pass                             | `createSession` mints a fresh token on every login — `apps/api/src/lib/session.ts:8`                                                                                      |
| V3.2.2 | Pass                             | 256-bit CSPRNG token (`generateSecret(32)`), far above the 64-bit minimum                                                                                                 |
| V3.2.3 | Pass                             | httpOnly cookie; `apps/api/src/lib/cookies.ts`                                                                                                                            |
| V3.3.1 | Pass                             | Logout deletes the session row; password reset/change revoke sessions — `session.test.ts`                                                                                 |
| V3.3.2 | Pending                          | No re-authentication on idle/periodic basis (30-day fixed TTL, no sliding expiry) — assess as part of F-24                                                                |
| V3.4.1 | **Fail → fixed Stage I**         | `docker-compose.yml`'s `${COOKIE_SECURE:-false}` overrides `env.ts`'s production default — session cookie ships without `Secure` on the documented deployment path (F-01) |
| V3.4.2 | Pass                             | `httpOnly: true` — `apps/api/src/lib/cookies.ts:7`                                                                                                                        |
| V3.4.3 | Pass                             | `sameSite: 'Lax'` — `apps/api/src/lib/cookies.ts:9`                                                                                                                       |
| V3.4.4 | Fail → fixed-with-caveat Stage D | No `__Host-` prefix; adopt conditionally on `COOKIE_SECURE`, after F-01 (`__Host-` mandates `Secure`, which would break plain-HTTP LAN self-hosters)                      |
| V3.4.5 | Accepted risk                    | `path: '/'` rather than a narrower path — the SPA and API share one origin, so a narrower path isn't meaningful here                                                      |
| V3.7.1 | Pass                             | Password/email change and account deletion all re-verify `currentPassword` — `apps/api/src/routes/auth.ts:302,357,472`                                                    |

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
| V8.2.1 | Pending                                              | No explicit anti-caching headers on API responses generally (only the avatar route sets `Cache-Control` deliberately, for a different reason) — assess in Stage D                                                                       |
| V8.2.2 | Pass                                                 | Zero real `localStorage`/`sessionStorage` use in `apps/web` (confirmed by grep); auth state lives only in the httpOnly cookie + in-memory React Query cache                                                                             |
| V8.2.3 | Pass                                                 | React Query cache is reset on logout — `apps/web/src/lib/reset-auth-cache.ts`                                                                                                                                                           |
| V8.3.1 | Accepted risk (webhook), Fail → fixed Stage G (TMDB) | Plex webhook token is a URL path segment by necessity (Plex allows no custom headers) — documented rationale in `apps/api/src/routes/webhooks.ts:12-22`; `TMDB_API_KEY` in the outbound query string is unrelated and gets fixed (F-09) |
| V8.3.2 | Pass                                                 | Full CSV export (`GET /account/export`) and account deletion both exist                                                                                                                                                                 |

## V9 — Communication

| Req      | Status                   | Evidence / rationale                                                                                                                                               |
| -------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| V9.1.1   | **Fail — live instance** | `http://rwnd.tv/` serves the full app with no HTTPS redirect and no HSTS (F-00). Fixed on the reverse proxy, not in this repo — see the plan's "Note on the proxy" |
| V9.1.2–3 | Pending                  | TLS cipher/version posture not yet observed against the live instance — `openssl s_client -connect rwnd.tv:443` or testssl.sh, per the plan's verification section |

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

| Req     | Status                 | Evidence / rationale                                                                                                                      |
| ------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| V14.2.1 | Fail → fixed Stage H   | Dependabot exists but no CodeQL, `pnpm audit`, or image scan in CI (F-19)                                                                 |
| V14.3.2 | Pass                   | `NODE_ENV=production` set in `Dockerfile:38`; no debug endpoints found                                                                    |
| V14.3.3 | Pending                | Swagger UI's `info.version: '1.0.0'` is static metadata, not a real version leak — confirm nothing else exposes build/dependency versions |
| V14.4.1 | Pass                   | Hono sets `Content-Type` on every response                                                                                                |
| V14.4.2 | Fail → fixed Stage D/F | No `Content-Disposition` on the avatar response (F-06)                                                                                    |
| V14.4.3 | Fail → fixed Stage D   | No CSP anywhere (F-04)                                                                                                                    |
| V14.4.4 | Fail → fixed Stage D   | No `X-Content-Type-Options: nosniff` anywhere (F-04)                                                                                      |
| V14.4.5 | Fail → fixed Stage D/I | No HSTS in the app; also missing at the proxy (F-00, F-04)                                                                                |
| V14.4.6 | Fail → fixed Stage D   | No `Referrer-Policy` (F-04)                                                                                                               |
| V14.4.7 | Fail → fixed Stage D   | No `X-Frame-Options`/`frame-ancestors` (F-04)                                                                                             |
| V14.5.2 | Pass                   | Auth decisions are session-cookie-based, never derived from the `Origin` header                                                           |

## Deferred items (tracked in `docs/TODO.md`)

F-14, F-15 (accepted risk, documented in ADR 0007 not TODO), F-22 (invite
mode unreachable), F-24 (session `lastUsedAt`/sliding expiry/revoke-my-
sessions UI, V3.3.2), F-25 (`packages/db` env unification, Postgres SSL),
F-27 (breached-password check, V2.1.7), V4.3.1/admin MFA (new gap surfaced
by this table, not yet in the findings register — add it), V2.5.5 (no
change-notification email), V2.7.2 (1h token TTL vs ASVS's 10-minute
out-of-band guidance — reassess whether that guidance actually applies to
email-based links vs. true out-of-band channels before treating as a gap).
