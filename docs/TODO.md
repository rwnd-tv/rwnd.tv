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

## Dashboard

- [ ] **Loading-order layout shift on Dashboard** (2026-08-24 22:35 added)\
      James's observation, live: History appears at the top of the page
      first, then gets shoved down a moment later once Continue Watching
      and Upcoming pop in above it. Root cause is in `DashboardPage.tsx`'s
      three row components (`OnDeckRow.tsx`, `UpNextRow.tsx`,
      `HistoryRow.tsx`) — each deliberately `return null`s while its own
      query is loading or empty (see their shared doc comment), and
      `GET /plays` (History's query) is a plain single-table read that
      resolves much faster than `/library/on-deck`/`/up-next` (per-show
      next-episode resolution, `findNextUnwatchedEpisode`/
      `findNextAiringEpisode` in `apps/api/src/lib/media.ts`), so History
      routinely finishes first despite being rendered last in the JSX.
      Needs a design call, not just a fetch-order tweak: reserve History's
      final position with a skeleton/placeholder until all three rows
      have settled, or hold the whole row group's render until every
      query is done — either fixes the visible shift, but changes the
      page's perceived load speed differently.

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

- [ ] **Build a real landing page for logged-out visitors** (2026-08-23 14:40 added)\
      `LoginPage.tsx` today is just a bare login card — no explanation of
      what rwnd.tv is, no artwork, no link to the GitHub repo, and the
      create-account option only shows up depending on
      `registrationMode`. Wants: an explainer of what the project is/does,
      some real visual identity (see `docs/brand/` for the existing logo
      work), a link to the GitHub repo, the create-account option when
      registration is open, and the log-in option — one inviting page
      instead of a bare form.

## Documentation

- [ ] **Refresh the GitHub-facing docs** (2026-08-23 14:40 added)\
      `README.md`'s "Status" section still says M1 is the only thing
      shipped and Trakt import is "next" — both M1 and M2 are done now
      (see `docs/TODO_ARCHIVE.md` for the real history). Update
      `README.md`/`docs/vision.md`/`docs/ROADMAP.md` to reflect where the
      project actually is, give the roadmap more visibility (right now
      it's just a linked doc, easy to miss from the README), and
      generally make the repo read as more current and inviting to
      someone landing on it cold.

## Import

- [ ] **Investigate importing Trakt's own "Export now" ZIP as an alternative to the OAuth import** (2026-08-24 22:50 added)\
      James's idea, from researching Trakt's free-vs-VIP situation:
      Settings > Data > "Export now" on trakt.tv gives any account
      (free or VIP — confirmed not gated) a ZIP of separate JSON files,
      no API/OAuth connection needed. Real motivation, not just
      convenience: Trakt's 2026 "Community App" policy caps free
      accounts at _one_ connected third-party OAuth app at a time
      (confirmed against Trakt's own forum announcement — any app built
      on their public API counts, no exemption for small/self-hosted
      ones) — a free user who already has a different Trakt-connected
      app (a Plex scrobbler, Kodi
      plugin, etc.) can't also OAuth-connect rwnd.tv's importer without
      disconnecting it first or paying for VIP. A file-upload import
      sidesteps that entirely, since it never touches the Community App
      connection limit at all.\
      Needs investigation before design: what's actually inside the ZIP
      (confirmed grouped-by-category JSON files, but not yet the exact
      schema per category — likely close to but not necessarily
      identical to the `/sync/history`, `/sync/ratings`,
      `/sync/watchlist`, `/users/hidden/dropped` API response shapes
      `apps/api/src/trakt/types.ts` already models), whether it's a
      one-time export or can be regenerated/re-uploaded to pick up new
      history since the last import, and how much of the existing
      `apps/api/src/import/match.ts` matching logic could be reused
      as-is versus needing its own parser for a different input shape.

## Auth & accounts

- [ ] **Profile pictures** (2026-08-24 21:15 added)\
      James's ask, from real multi-account use (switching between his own
      "James Bulman" account and the managed-user "Carol Bulman" account
      while testing Plex webhook attribution): easy to lose track of which
      account you're currently on with nothing but a display name in the
      sidebar/settings to go on. An avatar (uploaded image, or at least a
      generated fallback — initials/color, matching the poster-fallback
      convention the gallery already uses for a show/movie with no poster)
      shown in the sidebar and Settings would make the active account
      obvious at a glance. Needs a design pass: upload vs. generated-only
      for v1, where the image is stored (a new `BACKUP_DIR`-style optional
      volume, or inline in Postgres), and any size/type limits.
- [ ] **Passkey (WebAuthn) support** (2026-08-23 15:45 added)\
      Another `user_credentials` adapter type alongside `local`/`oidc`
      (see [ADR 0003](adr/0003-auth-model.md)) — sign in/register with a
      device passkey instead of a password. Not on ROADMAP.md yet; pairs
      naturally with the OIDC login item below since both plug into the
      same credentials schema, but it's its own protocol (WebAuthn, no
      external identity provider or redirect involved).
- [ ] **"Forgot password" / account recovery** (2026-08-23 15:46 added)\
      No password-reset flow exists for local accounts today — a locked-
      out user has no self-service way back in. Needs outbound email
      (nothing sends email yet) and a reset-token flow. Not related to
      OIDC/passkeys architecturally — this is a gap in the existing
      `local` credential type, not a new adapter.
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
- [ ] **Full data export** (2026-08-23 15:31 added) — M2\
      An open-format export of everything — one of the project's stated
      aims since day one.
- [ ] **Stats and insights** (2026-08-23 15:32 added) — M3\
      The reason to log anything in the first place, per the roadmap's
      own framing of M3.
- [ ] **Calendar of upcoming episodes** (2026-08-23 15:33 added) — M3\
      A view of what's airing next across the shows you're following.
- [ ] **OIDC login** (2026-08-23 15:34 added) — M3\
      The `user_credentials` schema was designed for this from M1 — see
      [ADR 0003](adr/0003-auth-model.md).
- [ ] **Mobile-friendly PWA installability** (2026-08-23 15:37 added) — Not yet scheduled\
      Installable/add-to-home-screen support.
- [ ] **Public/shareable profile pages** (2026-08-23 15:38 added) — Not yet scheduled\
      A public view of a user's watch history/stats.
