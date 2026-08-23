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

## Movies

- [ ] **Bring Movies up to parity with TV Shows, where appropriate** (2026-08-23 15:05 added)\
      Shows picked up a lot this cycle that Movies never got: a per-show
      page (Movies has no per-movie page at all — gallery tiles in
      `MoviesPage.tsx` aren't even links), Watched/Drop buttons, the
      manual refresh-metadata action, a TMDB rating badge + link, genre
      and release-year gallery filters plus the extra sort options
      (deliberately scoped to Shows only when the gallery shipped — see
      `docs/adr/`), dropped-title greyscale on the gallery, and Dashboard
      search results linking straight to the detail page instead of
      logging a watch inline. Spoiler protection and On Deck/Up Next
      don't translate directly (no episodes to spoil or step through),
      but most of the rest does. Needs a design pass on what's actually
      worth carrying over rather than copying wholesale — a movie is one
      watch, not a show/season/episode tree, so even "Watched" may need
      to look different rather than identical.

## Metadata & matching

- [ ] **Multi-provider metadata (tmdb/imdb/tvdb)** (2026-08-11 22:20) — M2\
      Right now tmdb id is the only key — a title with no tmdb id
      can't be imported even if it has imdb/tvdb ids (hit this live
      importing Formula 1 via Trakt; TMDB doesn't carry it). Idea: a
      new internal id independent of any single provider, an
      admin-configurable provider priority order, and a manual
      per-title "refresh metadata" action rather than silent
      background updates (explicit preference — don't want metadata
      changing behind anyone's back). Also want a UI indicator on
      show/movie pages showing which provider the current metadata
      came from. Fairly fundamental, which is why it's tracked as M2
      rather than deferred to "not yet scheduled". This is the
      plumbing only — it doesn't require a second provider to exist
      yet; actually adding one (Wikidata/TVDB) is the separate
      "not yet scheduled" item below, which this would need to land
      first.

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

- [ ] **Link the header mark/wordmark to the site's base URL** (2026-08-23 14:40 added)\
      `Layout.tsx`'s top bar renders the mark (`/favicon.svg`) and
      wordmark (`app.name`) as plain elements — clicking them does
      nothing right now. Should link to the instance's own base URL
      (`https://rwnd.tv` in prod, `https://dev.rwnd.tv` on dev) — worth
      deciding at build time whether that's a real anchor to the current
      origin or an in-app route, since `/` already redirects to
      `/dashboard`.

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

## Auth & accounts

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

## Roadmap

Every open item from [ROADMAP.md](ROADMAP.md) that doesn't already have a
more specific TODO elsewhere in this file (multi-provider metadata and
ratings/watchlist above both double as their M2/M3 entries). Kept brief —
ROADMAP.md is the source of truth for scope; this is just so a TODO
listing is complete.

- [ ] **Plex/Tautulli webhook ingestion** (2026-08-23 15:30 added) — M2\
      Watches log themselves as you watch, authenticated via the
      per-user API tokens already built in M1 for this.
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
- [ ] **Additional locales beyond English/French** (2026-08-23 15:35 added) — M3\
      UI is only translated to `en-GB`/`fr-FR` right now.
- [ ] **Wikidata/TVDB metadata provider alongside TMDB** (2026-08-23 15:36 added) — Not yet scheduled\
      The second provider itself, not the infrastructure to support
      one — that's the "Multi-provider metadata" M2 item above, and
      needs to land first.
- [ ] **Mobile-friendly PWA installability** (2026-08-23 15:37 added) — Not yet scheduled\
      Installable/add-to-home-screen support.
- [ ] **Public/shareable profile pages** (2026-08-23 15:38 added) — Not yet scheduled\
      A public view of a user's watch history/stats.
