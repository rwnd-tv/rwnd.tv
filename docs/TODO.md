# TODO

Smaller, non-milestone work — things to do, watch, or decide. For the
feature roadmap see [ROADMAP.md](ROADMAP.md); for why past decisions
were made see [adr/](adr/).

Format:

- `- [ ] **Title** (YYYY-MM-DD HH:MM added)\`, then details on the next line (trailing `\` forces the line break).
- An item also tracked in [ROADMAP.md](ROADMAP.md) gets a milestone suffix on the title line — `— M2`, `— M3`, `— Not yet scheduled` — so a listing of this file alone is a complete view of outstanding work, roadmap included. Omit the suffix for TODO-only items.
- Blank line between each item.
- Lists sorted oldest to newest.
- Completed items move to [TODO_ARCHIVE.md](TODO_ARCHIVE.md) rather than staying checked off here.

## Repo hygiene

- [ ] **Hold TS 7 bump** (2026-08-09 20:40)\
      `typescript-eslint` doesn't support TS 7 yet; leave any TS 7.0
      Dependabot bump open until it does.

## TV Shows / Movies gallery follow-ups

- [ ] **Virtualize the gallery grid if libraries grow** (2026-08-19 15:25)\
      Shipped without `content-visibility`/windowing — real libraries are
      ~500 shows/movies, comfortably fine for the DOM. Revisit if a
      self-hoster's library gets meaningfully larger and scroll performance
      suffers.
- [ ] **Title-sort article stripping** (2026-08-19 15:25)\
      The gallery's title sort ("Sort by: Title") is a plain locale-aware
      string compare — "The Wire" sorts under T, not W. Real per-language
      leading-article rules are a bigger job than this feature needed; left
      as a known simplification.

## Documentation

- [ ] **Refresh the GitHub-facing docs, and a self-hosting readiness pass** (2026-08-23 14:40 added, self-hosting pass folded in 2026-08-28) — M3\
      `README.md`'s "Status" section still says M1 is the only thing
      shipped and Trakt import is "next" — both M1 and M2 are done now
      (see `docs/TODO_ARCHIVE.md` for the real history). Update
      `README.md`/`docs/vision.md`/`docs/ROADMAP.md` to reflect where the
      project actually is, give the roadmap more visibility (right now
      it's just a linked doc, easy to miss from the README), and
      generally make the repo read as more current and inviting to
      someone landing on it cold. Last of the M3 content items — run
      after the code review and security review so it describes the
      actual end state instead of needing a second pass. Also confirm
      `docker-compose.yml`/`.env.example`/`docs/self-hosting.md` actually
      work end to end for a real self-hoster.

## Auth & accounts

- [ ] **Passkey (WebAuthn) support** (2026-08-23 15:45 added)\
      Another `user_credentials` adapter type alongside `local`/`oidc`
      (see [ADR 0003](adr/0003-auth-model.md)) — sign in/register with a
      device passkey instead of a password. Not on ROADMAP.md yet; pairs
      naturally with the OIDC login item below since both plug into the
      same credentials schema, but it's its own protocol (WebAuthn, no
      external identity provider or redirect involved).
- [ ] **Explore OAuth device-flow login (for a future TV app)** (2026-08-23 16:00 added)\
      The RFC 8628 device authorization grant — the "enter this code on
      your phone" / QR flow BBC iPlayer, Disney+, and `gh auth login`
      all use for devices with no comfortable keyboard. Only relevant
      once there's an actual rwnd.tv TV app to log into, which doesn't
      exist yet — this is groundwork, not urgent. Needs a device-
      authorization endpoint, a short human-typeable code + polling on
      the device side, and a verification page. Worth designing the
      approval page carefully — device-code flows have a known phishing
      pattern where someone's talked into approving a code that isn't
      theirs, so the page should make clear what's being authorized
      rather than a bare yes/no.

## Self-hosting & deployment

- [ ] **Cut the first tagged release** (2026-08-26 added, GHCR cleanup folded in 2026-08-29) — M3\
      `SECURITY.md` says rwnd.tv is "pre-1.0... until the first stable
      release," and `docker-compose.yml`'s own comment already
      anticipates this: "`edge` tracks main until the first tagged
      release exists, after which `latest` will track the newest release
      instead — see release.yml." M3 — ready for real use — is the
      natural point to actually do this. Needs deciding: version number
      (v1.0.0?), what "stable" means for a pre-1.0 project moving this
      fast (semver commitment level), and whether `release.yml` needs
      changes beyond what the existing comment already implies. Also add
      a GHCR cleanup step (e.g. `actions/delete-package-versions` or
      `dataaxiom/ghcr-cleanup-action`) — every push to `main` leaves the
      previous `edge` digest behind as an untagged version, and the
      multi-arch build (`linux/amd64`+`linux/arm64`) fans each push into
      several untagged per-platform images on top of that, so the
      [pkgs/container/rwnd.tv/versions](https://github.com/rwnd-tv/rwnd.tv/pkgs/container/rwnd.tv/versions)
      page has been accumulating unbounded with no retention policy in
      place.
## Security

- [ ] **Force HTTPS + HSTS on the rwnd.tv reverse proxy** (2026-08-29 added)\
      The one finding the 2026-08-29 security review (see
      `docs/TODO_ARCHIVE.md`) couldn't close: `http://rwnd.tv/` still
      serves the full app with no redirect to HTTPS. This is a
      home-server nginx-pm config change, not something in this
      repository — needs James directly, or explicit go-ahead to do it
      over SSH. The application's own half (sending HSTS once
      `COOKIE_SECURE` confirms HTTPS) already shipped. See
      `docs/security/asvs-l1.md`'s V9.1.1 row.
- [ ] **Admin MFA** (2026-08-29 added)\
      No multi-factor authentication exists anywhere in the app —
      `requireAdmin` is password-only. Surfaced by the security review's
      ASVS pass (V4.3.1, `docs/security/asvs-l1.md`) rather than
      previously planned work; a real feature addition (a TOTP adapter,
      most likely, alongside `user_credentials`'
      `local`/`oidc`-adapter design — see [ADR 0003](adr/0003-auth-model.md)),
      not a quick fix.
- [ ] **Session management: list and revoke active sessions** (2026-08-29 added)\
      No UI or route lets a user see or revoke their own other active
      sessions, and sessions have no `lastUsedAt`/sliding expiry — just a
      fixed 30-day TTL with lazy delete-on-resolve. ASVS V3.3.2/3.3.4
      (Level 2), `docs/security/asvs-l1.md`.
- [ ] **Breached-password check on registration/password change** (2026-08-29 added)\
      Password policy is length-only (`min(12)`) — no check against known
      breached passwords (HIBP's k-anonymity API, most likely). Deferred
      during the security review rather than fixed inline: it's a network
      dependency and a design decision (should a self-hosted instance
      call out to a third party on every password change?) bigger than a
      review-scope fix. ASVS V2.1.7.
- [ ] **Notify on password/email change** (2026-08-29 added)\
      No email is sent when a user's password or email address changes —
      unlike the equivalent GitHub/Google-style "someone changed your
      password" pattern. ASVS V2.5.5, surfaced by the security review.
- [ ] **Adopt the `__Host-` cookie prefix** (2026-08-29 added)\
      Session/CSRF cookies don't use the `__Host-` prefix today. It
      mandates `Secure`, which would break a plain-HTTP LAN-only
      deployment (a legitimate, documented configuration —
      `docs/self-hosting.md`) if applied unconditionally, so the security
      review left it out of Stage D rather than gate every self-hoster on
      it. Worth adopting conditionally, once `COOKIE_SECURE` confirms
      HTTPS is actually in use. ASVS V3.4.4, `docs/security/asvs-l1.md`.
- [ ] **Invite-creation route** (2026-08-29 added)\
      `registration_mode: 'invite'` is functionally unreachable — the
      `invites` table and redemption path both exist and are tested (the
      2026-08-29 security review's invite-redemption race fix included),
      but no route anywhere actually creates an invite code for an admin
      to hand out.
- [ ] **Smaller security-review follow-ups** (2026-08-29 added)\
      Left deliberately deferred rather than fixed inline, all from the
      2026-08-29 ASVS pass (`docs/security/asvs-l1.md`): anti-caching
      headers (`Cache-Control: no-store`) on API responses generally
      (V8.2.1) — needs a decision on scope (every response, or just
      auth-sensitive ones); `packages/db`'s `migrate.ts`/`seed.ts`/
      `reset-dev.ts`/`drizzle.config.ts` read `process.env.DATABASE_URL`
      directly rather than the validated `env.ts` loader, and
      `client.ts` has no explicit Postgres `ssl` option; reassess whether
      the password-reset/email-change tokens' 1h TTL genuinely needs to
      match ASVS's 10-minute out-of-band guidance (V2.7.2), which may be
      aimed at true out-of-band channels rather than an emailed link;
      full structured request logging (the review added only minimal
      `[security]`-prefixed event logging on login/admin-settings, not a
      general request-logging pipeline).

## Roadmap

Every open item from [ROADMAP.md](ROADMAP.md) that doesn't already have a
more specific TODO elsewhere in this file. Kept brief — ROADMAP.md is the
source of truth for scope; this is just so a TODO listing is complete.

- [ ] **Tautulli/Jellyfin/Emby/Kodi webhook ingestion** (2026-08-24 16:25 added, un-M2'd 2026-08-24, M4'd 2026-08-28) — M4\
      Plex's own webhook shipped 2026-08-24 (see `docs/TODO_ARCHIVE.md`) —
      the entity-resolution/auth core it's built on
      (`apps/api/src/lib/external-match.ts`,
      `apps/api/src/lib/api-tokens.ts`) is deliberately source-agnostic,
      so each of these is "write one payload parser + one route," not a
      rework. Tautulli's webhook body is fully user-templated (no fixed
      shape — needs its own JSON template + setup docs, unlike Plex's
      fixed format), which is why it wasn't bundled into the same pass.
      James, 2026-08-24: not needed to close out M2 — ROADMAP.md's own M2
      "Plex webhook ingestion" bullet only ever mentioned these in
      passing as future work, not as a separate required checkbox, so
      this was over-tagged M2 when first added. Left unmilestoned rather
      than reassigned to M3 — no strong reason it belongs there either.
- [ ] **Stats and insights** (2026-08-23 15:32 added, un-M3'd 2026-08-26) — Not yet scheduled\
      The reason to log anything in the first place, but not essential to
      the core logging loop M3 was narrowed to (2026-08-26 — see
      ROADMAP.md's M3 framing).
- [ ] **Calendar of upcoming episodes** (2026-08-23 15:33 added, un-M3'd 2026-08-26, M4'd 2026-08-28) — M4\
      A view of what's airing next across the shows you're following.
- [ ] **OIDC login** (2026-08-23 15:34 added, un-M3'd 2026-08-26) — Not yet scheduled\
      The `user_credentials` schema was designed for this from M1 — see
      [ADR 0003](adr/0003-auth-model.md).
- [ ] **Additional locales beyond English** (2026-08-26 added) — Not yet scheduled\
      en-GB/en-US both ship today; more locales is pure expansion, not
      something the core logging loop needs.
- [ ] **Mobile-friendly PWA installability** (2026-08-23 15:37 added) — Not yet scheduled\
      Installable/add-to-home-screen support.
- [ ] **Public/shareable profile pages** (2026-08-23 15:38 added) — Not yet scheduled\
      A public view of a user's watch history/stats.
