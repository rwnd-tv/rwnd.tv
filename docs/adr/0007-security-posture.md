# 0007: Security posture and trust model (M3 review)

## Status

Accepted

## Context

`docs/TODO.md` carried "Full security review before M3 closes" with scope deliberately left open. James, 2026-08-26: wanted a full review, not just `SECURITY.md`'s existing reporting policy, before M3 could be called "ready for real use." rwnd.tv is small and self-hosted, but it's already publicly deployed (rwnd.tv), multi-user by design, and holds personal data (email addresses, watch history, avatars, encrypted Trakt OAuth tokens): that combination is why a structured pass mattered more here than for a typical pre-1.0 side project.

The review ran as a structured OWASP ASVS 4.0.3 Level 1 pass (see `docs/security/asvs-l1.md`, the audit record every finding below traces back to), delivered as ten staged, individually-verified commits, each gated on the full test suite plus lint/typecheck/format/knip, and several verified against a live deploy rather than code review alone. This ADR is where the _decisions_ from that review live: which findings got fixed, and, just as importantly, which were deliberately accepted as-is, and why. Recording the reasoning here is what stops an accepted risk from being re-raised as a new finding in some future review.

## Decision

### Trust model

Every account on an rwnd.tv instance is **mutually trusted for webhook attribution**. The Plex webhook's multi-user support (`apps/api/src/routes/tokens.ts`, M2) deliberately lets any token owner assign a pending webhook event (or reassign a claimed one) to _any_ user on the instance, and `GET /tokens/{id}/webhook-links` returns every instance user's id and display name as `assignableUsers`, not just the token owner's own household. This is real, designed functionality (`docs/TODO_ARCHIVE.md`'s multi-user Plex attribution entry): one Plex server, multiple household members, each claimed to their own rwnd.tv account, by whoever manages the API token. It is **not** an IDOR: `ownsToken()` gates every one of these routes to the token's actual owner, but it does mean rwnd.tv's security boundary is the _instance_, not the individual account, for this one feature. An instance is assumed to be run for a household or a small trusted group, matching `instance_settings.registration_mode` defaulting to `closed` (below). A future "confirm before attributing to me" step is a real product improvement, not a security fix; logged in `docs/TODO.md`.

**Registration defaults to closed.** The very first account is created through the one-time `POST /setup` flow; after that, nobody else can register until an admin explicitly opens registration or switches to invite-only (`docs/adr/0003-auth-model.md`). A self-hosted instance exposed to the internet doesn't accidentally accept public signups.

**TLS is the operator's responsibility, not the application's.** rwnd.tv never terminates TLS itself: `docs/self-hosting.md` documents a reverse proxy as a requirement for anything beyond local-network access, and `COOKIE_SECURE`/`TRUST_PROXY` (Stage I) exist specifically to let the application behave correctly once that proxy is in place, without the application ever handling certificates itself. This is a standard self-hosted-app boundary, not a gap: the alternative (bundling TLS termination) would take on certificate management the project has no comparative advantage doing.

**Bearer secrets are hashed, not encrypted, except where the raw value must be recoverable.** Session tokens, API tokens, and the three account-recovery token types (`apps/api/src/lib/tokens.ts`) are all 256-bit CSPRNG values, hashed with a single unsalted SHA-256 round before storage. This is correct, not a shortcut: these are high-entropy random secrets, not human-chosen passwords, so there's no dictionary/brute-force surface a salt or a slow KDF would meaningfully defend against: the same reasoning `docs/adr/0004-trakt-import.md` already applied when it chose AES-256-GCM _encryption_ (not hashing) specifically for Trakt OAuth tokens, the one secret class that must be recovered in cleartext to make authenticated requests on a user's behalf. Passwords, the one secret class that _is_ human-chosen and _is_ dictionary-attackable, use Argon2id (`apps/api/src/lib/password.ts`): a different algorithm for a different threat model, not an inconsistency.

### Accepted risks

| Finding                                                                                                                                                      | Disposition                                                          | Why                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `assignableUsers` lists every instance user                                                                                                                  | Accepted                                                             | Required by the multi-user Plex trust model above: the alternative (hiding other users) would break the claiming UI entirely.                                                                                                                                                                                                                    |
| Webhook plays attributable to another account without their consent                                                                                          | Accepted, with a follow-up logged                                    | Same trust model. A "notify/confirm" step is a real improvement, tracked in `docs/TODO.md` rather than treated as a fix owed by this review.                                                                                                                                                                                                     |
| No `__Host-` cookie prefix                                                                                                                                   | Accepted for now                                                     | `__Host-` mandates `Secure`, which would break a plain-HTTP LAN-only deployment (a legitimate, documented configuration, see `docs/self-hosting.md`). Worth adopting conditionally on `COOKIE_SECURE` being true; not done in this review to keep Stage D's header changes to what's unconditionally safe.                                       |
| Invite mode is currently unreachable (no route creates an invite)                                                                                            | Accepted as a known gap                                              | A feature-completeness gap, not a security hole: the schema and redemption path are correct and tested; nothing generates a code to redeem. Logged to `docs/TODO.md`.                                                                                                                                                                            |
| No session list/revoke-my-sessions UI, no sliding expiry                                                                                                     | Accepted for now                                                     | ASVS 3.3.2/3.3.4 (L2): a real UI feature, not a targeted fix. Logged to `docs/TODO.md`.                                                                                                                                                                                                                                                          |
| CodeQL alert #1: `hashSecret()`'s unsalted SHA-256 flagged as a weak password hash (`js/insufficient-password-hash`)                                         | Dismissed as a false positive                                        | `hashSecret()` only ever hashes 256-bit CSPRNG values (session/API/recovery tokens), never a password: see "Bearer secrets are hashed, not encrypted" above and the comment on `hashSecret()` itself (`apps/api/src/lib/tokens.ts`). CodeQL's static rule can't see that distinction.                                                            |
| CodeQL alerts #2–#7: `isPasswordPwned()`'s SHA-1 hash (and every test file recomputing it) flagged as a weak password hash (`js/insufficient-password-hash`) | Dismissed as false positives (#2, real code) / used-in-tests (#3–#7) | `isPasswordPwned()` (`apps/api/src/lib/hibp.ts`, added with the HIBP breached-password check below) SHA-1s the password only to query HaveIBeenPwned's k-anonymity range API; the password/hash never leaves the server, just a 5-hex-char prefix. Not password storage or verification (still Argon2id). Same false-positive class as alert #1. |

### What actually changed

Summarized here; `docs/security/asvs-l1.md` has the full requirement-by-requirement record. Ten staged commits: characterization tests first (Stage A); a fail-closed global auth gate replacing 100 opt-in `requireAuth` call sites (Stage B); CSRF + body-size limits (Stage C); security response headers and a strict CSP (Stage D); rate limiting plus DB-backed per-account login lockout (Stage E); input-validation hardening (avatar magic-byte sniffing, atomic invite redemption, the register-enumeration/notification tradeoff below, login timing) (Stage F); secret and log hygiene (Stage G); CI guardrails, CodeQL, dependency scanning, SHA-pinned actions (Stage H); and deployment/config hardening, including the `COOKIE_SECURE` default bug below (Stage I).

**One deliberate deviation from the review's own plan, decided with James mid-review:** `POST /auth/register`'s distinct 409 "Email already in use" was _not_ replaced with a generic response. GitHub does the same; Google's Identity Platform has moved the other way and enables enumeration protection by default: a genuine, live split in industry practice, not a settled question. The UX cost of full generality is real (a legitimate user gets no signal to log in instead), so the compensating control is a notification email to the _existing_ account when someone tries to register with its address (`sendAccountAlreadyExistsNotice`, Stage F), rate-limited to one per target address per day so registration can't become an inbox-bombing vector. This trades pure enumeration-hiding for the account owner actually knowing they're being targeted, arguably more valuable than hiding it for a small self-hosted instance.

**The highest-impact single finding was a deployment-config bug, not an application one:** `docker-compose.yml`'s `COOKIE_SECURE: ${COOKIE_SECURE:-false}` silently overrode `env.ts`'s own NODE_ENV-based default on every real deployment, and a second, independent form of the same bug (an empty-but-defined string from a real `.env` file) would have survived even the first fix: caught only by an actual end-to-end Docker deploy, not code review (Stage I). The same testing pass also surfaced a genuinely pre-existing crash (`APP_URL`'s eager `.url()` validation, unrelated to this review's own changes) that would have broken any self-hosted instance that didn't configure SMTP. Both are why Stage I's verification leaned on real deploys rather than trusting the code.

### Left to the repository owner, not this ADR

These are GitHub repository settings, not files this review can commit; naming them here so they aren't assumed done because `codeql.yml` exists. Status as of 2026-08-29: private vulnerability reporting, secret scanning alerts, push protection (block, not just alert, on a recognized secret pattern), and `main`'s branch protection rule requiring both the `ci` and `analyze` (CodeQL) checks to pass before merging are **enabled**; Dependabot security updates remain **not enabled**: declined deliberately, to keep dependency bumps reviewed rather than auto-merged. Admins keep bypass rights on the branch protection rule (direct pushes to `main` are still this project's normal workflow); the rule's real effect is gating a future external contributor's PR, not today's solo flow.

## Consequences

- Future findings against the accepted-risk items above should check this ADR before being re-raised as new: the reasoning here is the answer, not a placeholder for a future fix.
- The webhook multi-user trust model means an instance should not be shared across mutually-distrusting users. This was already implicitly true (any authenticated user can see every other user's display name via `assignableUsers`, and instance settings are instance-wide, not per-tenant); this ADR makes it explicit.
- `docs/security/asvs-l1.md` is now the durable audit record; it should be updated (not superseded by a new document) as further ASVS items are addressed, so a future reviewer can diff against a known baseline rather than starting over.

## Update (2026-08-30)

Three rows in the Accepted risks table above were closed the day after this
ADR was written, in the 2026-08-29 follow-up pass; see
`docs/security/asvs-l1.md` for the current status of each:

- **No `__Host-` cookie prefix**: now applied whenever `COOKIE_SECURE` is
  true (V3.4.4), left plain otherwise so a LAN-only plain-HTTP deployment
  isn't broken.
- **Invite mode unreachable**: `POST`/`GET`/`DELETE /invites`
  (`apps/api/src/routes/invites.ts`, F-22) now exist, so
  `registration_mode: 'invite'` is a real path, not just a schema value.
- **No session list/revoke UI, no sliding expiry**: both shipped (V3.3.2,
  F-24): `GET`/`DELETE /auth/me/sessions` and
  `apps/web/src/components/account/SessionsCard.tsx`.

Left as a historical record above rather than rewritten in place; the
table reflects what was actually decided on 2026-08-26, and `asvs-l1.md`
is the file to trust for current status.

## Update (2026-09-02): webhook attribution consent rework

The two remaining rows most relevant to this ADR's trust model
(`assignableUsers` listing every instance user, and webhook plays
attributable to another account without their consent) are now closed.
The "confirm before attributing to me" step this ADR's Trust model
section named as the intended follow-up was never actually written into
`docs/TODO.md` as promised; it sat as a known, un-acted-on gap until this
pass, prompted by M4's webhook-ingestion work about to add three more
sources onto the same mechanism.

**What changed.** `GET /tokens/{id}/webhook-links` no longer returns
`assignableUsers` at all, and the direct-assign `PATCH` on a link is
removed entirely: a token owner can no longer see every user on the
instance, nor attribute a detected external account to any of them
directly. In its place, a token owner can link an account to
_themselves_ instantly (no consent step needed for attributing to
yourself), or generate a one-time code (`webhook_link_codes`,
`packages/db/src/schema.ts`) for anyone else, which the actual target
redeems from their own account (`POST /webhook-links/redeem`,
`apps/api/src/routes/webhook-links.ts`). Modelled closely on the
existing `invites` mechanism, using the same hashed-code, shown-once,
7-day-TTL shape. See that route file and `apps/api/src/routes/tokens.ts`
for the implementation. (Originally built and named around "claim"
throughout: routes, DB table, UI copy; then renamed to "link" later the
same day. James felt "link" is the term users would actually
understand, and the UI copy already used it in places before the rest
of the naming caught up.)

**What this does and doesn't fix.** Nobody's watch history can be
written to, and no user can enumerate the instance's users, without that
person's own action. It remains true, unchanged from the original trust
model, that a token owner can route another person's plays into their
_own_ account by generating a code and redeeming it themselves; that was
never the threat this addresses, and the instance-as-trust-boundary
framing in the Trust model section above still holds for what a
malicious token owner can do to their _own_ account. `POST /tokens` also
remains open to non-admins, deliberately: once attribution requires a
code the target redeems, a non-admin token owner can no longer attribute
anything to anyone else anyway, so gating token creation itself would
only stop a household member wiring up their own media server, for no
consent benefit.

This supersedes the `assignableUsers`/no-consent-attribution rows in the
Accepted risks table above; that table is left as the historical record
of what was decided on 2026-08-26, per the note on the previous update.
