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

## Ratings & watchlist

- [ ] **Explore how ratings should work** (2026-08-23 14:15 added) — M3\
      Trakt import already brings in per-show/movie ratings (1-10,
      the `ratings` table) and Clear database/Backup/Restore already
      treat them as a first-class category, but nothing in the UI
      surfaces or lets you set one — no rating shown on the show/movie
      page, no manual rate action, no gallery filter/sort by _your_
      rating (distinct from the TMDB rating badge already shown there,
      which is TMDB's own average, not the user's). Needs a design pass
      before building: where a rating shows up, how you set/change one,
      whether rating something implies it's watched.

- [ ] **Explore how the watchlist should work** (2026-08-23 14:15 added) — M3\
      Trakt import already brings in watchlist entries (with an optional
      note, the `watchlist_items` table) and Clear database/Backup/Restore
      already treat it as a first-class category, but nothing in the UI
      surfaces it — no watchlist page, no way to add/remove a title
      manually, no "on my watchlist" indicator on a show/movie page. Needs
      a design pass before building: its own page (like History), a
      gallery filter, or both. ROADMAP.md bundles "custom lists" in with
      this under M3 — worth deciding whether that's the same feature or a
      separate one when the design pass happens.

## Landing page & branding

- [ ] **Build a real landing page for logged-out visitors** (2026-08-23 14:40 added) — M3\
      `LoginPage.tsx` today is just a bare login card — no explanation of
      what rwnd.tv is, no artwork, no link to the GitHub repo, and the
      create-account option only shows up depending on
      `registrationMode`. Wants: an explainer of what the project is/does,
      some real visual identity (see `docs/brand/` for the existing logo
      work), a link to the GitHub repo, the create-account option when
      registration is open, and the log-in option — one inviting page
      instead of a bare form.

## Documentation

- [ ] **Refresh the GitHub-facing docs** (2026-08-23 14:40 added) — M3\
      `README.md`'s "Status" section still says M1 is the only thing
      shipped and Trakt import is "next" — both M1 and M2 are done now
      (see `docs/TODO_ARCHIVE.md` for the real history). Update
      `README.md`/`docs/vision.md`/`docs/ROADMAP.md` to reflect where the
      project actually is, give the roadmap more visibility (right now
      it's just a linked doc, easy to miss from the README), and
      generally make the repo read as more current and inviting to
      someone landing on it cold.

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

- [ ] **Cut the first tagged release** (2026-08-26 added) — M3\
      `SECURITY.md` says rwnd.tv is "pre-1.0... until the first stable
      release," and `docker-compose.yml`'s own comment already
      anticipates this: "`edge` tracks main until the first tagged
      release exists, after which `latest` will track the newest release
      instead — see release.yml." M3 — ready for real use — is the
      natural point to actually do this. Needs deciding: version number
      (v1.0.0?), what "stable" means for a pre-1.0 project moving this
      fast (semver commitment level), and whether `release.yml` needs
      changes beyond what the existing comment already implies.

## Security

- [ ] **Full security review before M3 closes** (2026-08-26 added) — M3\
      James, 2026-08-26: wants a full security review as part of "ready
      for real use," not just the existing `SECURITY.md` policy
      (reporting process) and its named areas of interest (session
      handling, API token handling, multi-user data isolation). Scope not
      yet defined — worth deciding whether this is a self-review, an
      external audit, or a structured pass (e.g. OWASP ASVS/Top 10
      checklist) against auth, session/cookie handling, API tokens,
      webhook ingestion auth, multi-user data isolation, secrets handling
      (`ENCRYPTION_KEY`, SMTP/OAuth credentials), and dependency
      vulnerabilities, before scheduling the work itself.

## Roadmap

Every open item from [ROADMAP.md](ROADMAP.md) that doesn't already have a
more specific TODO elsewhere in this file (ratings/watchlist above
double as their M3 entry). Kept brief — ROADMAP.md is the source of
truth for scope; this is just so a TODO listing is complete.

- [ ] **Tautulli/Jellyfin/Emby/Kodi webhook ingestion** (2026-08-24 16:25 added, un-M2'd 2026-08-24)\
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
- [ ] **Calendar of upcoming episodes** (2026-08-23 15:33 added, un-M3'd 2026-08-26) — Not yet scheduled\
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
