# TODO

Smaller, non-milestone work: things to do, watch, or decide. For the
feature roadmap see [ROADMAP.md](ROADMAP.md); for why past decisions
were made see [adr/](adr/).

Format:

- `- [ ] **Title** (YYYY-MM-DD HH:MM added)`, then a blank line, then the body.
- Break the body into short paragraphs at its natural seams (what/why, what's blocking it, the decision) rather than one dense block, each separated by a real blank line (indented the same as the surrounding text), not a trailing `\`. A trailing `\` only shows up as a break in a rendered Markdown view; a real blank line reads correctly in a raw, unrendered view too (e.g. GitHub Desktop's diff view). Same convention as `I:\Game\Akari\TODO.md`.
- An item also tracked in [ROADMAP.md](ROADMAP.md) gets a milestone tag folded into the trailing date parenthetical, e.g. `(2026-08-23 added; M2)` or `(2026-08-23 added; Not yet scheduled)`, so a listing of this file alone is a complete view of outstanding work, roadmap included. Omit the tag for TODO-only items.
- Blank line between each item too, same as between paragraphs within one; a new item is distinguished by its un-indented `- [ ]` marker, not by the blank line alone.
- Lists sorted oldest to newest.
- Completed items move to [TODO_ARCHIVE.md](TODO_ARCHIVE.md) rather than staying checked off here.

## Repo hygiene

- [ ] **Hold TS 7 bump** (2026-08-09 20:40 added, ignore rule added 2026-08-30)

      `typescript-eslint` doesn't support TS 7 yet. A Dependabot PR
      (`dev-dependencies` group) bundled a `typescript` 5.9.3→7.0.2 bump in
      with 13 unrelated safe updates, failing CI (lint) for the whole
      group. Added a `typescript` major-version `ignore` rule to
      `.github/dependabot.yml` so Dependabot stops proposing it; remove
      that ignore once `typescript-eslint` supports TS 7.

## TV Shows / Movies gallery follow-ups

- [ ] **Virtualize the gallery grid if libraries grow** (2026-08-19 15:25)

      Shipped without `content-visibility`/windowing: real libraries are
      ~500 shows/movies, comfortably fine for the DOM. Revisit if a
      self-hoster's library gets meaningfully larger and scroll performance
      suffers.

## Auth & accounts

- [ ] **Passkey (WebAuthn) support** (2026-08-23 15:45 added)

      Another `user_credentials` adapter type alongside `local`/`oidc`
      (see [ADR 0003](adr/0003-auth-model.md)): sign in/register with a
      device passkey instead of a password. Not on ROADMAP.md yet; pairs
      naturally with the OIDC login item below since both plug into the
      same credentials schema, but it's its own protocol (WebAuthn, no
      external identity provider or redirect involved).

- [ ] **Explore OAuth device-flow login (for a future TV app)** (2026-08-23 16:00 added)

      The RFC 8628 device authorization grant: the "enter this code on
      your phone" / QR flow BBC iPlayer, Disney+, and `gh auth login`
      all use for devices with no comfortable keyboard. Only relevant
      once there's an actual rwnd.tv TV app to log into, which doesn't
      exist yet; this is groundwork, not urgent. Needs a device-
      authorization endpoint, a short human-typeable code + polling on
      the device side, and a verification page.

      Worth designing the approval page carefully: device-code flows have
      a known phishing pattern where someone's talked into approving a
      code that isn't theirs, so the page should make clear what's being
      authorized rather than a bare yes/no.

- [ ] **Admin user list has no per-user avatars** (2026-09-03 added)

      `/admin`'s user list falls back to the generated-initials avatar
      for every row (`avatarUpdatedAt: null`, `UserRow.tsx`) rather than
      an uploaded photo. `Avatar.tsx`/`GET /auth/me/avatar` only ever
      serve the *caller's own* image, so showing another user's would
      need a new admin-only avatar-serving endpoint
      (`GET /admin/users/{id}/avatar`), which felt like its own small
      unit of work rather than something to fold into the first pass.

- [ ] **Search, filters, and sort on the admin Users list** (2026-09-03 11:24 added)

      `/admin`'s Users panel (`UsersPanel.tsx`) is a flat list today, no
      search box, no filter panel, no sort control, unlike the Shows/
      Movies galleries (`ShowsPage.tsx`/`MoviesPage.tsx`), which have all
      three: a text filter (`filter`/`setFilter`), a collapsible
      `FiltersPanel.tsx` (genre, release year, rating, dropped, one
      `*FilterPanel.tsx` component per facet), and `useSortCookie.ts`-
      backed sort options remembered per-page. James, 2026-09-03: wants
      the same treatment here, scaled to what a user list actually has to
      filter/sort by, not a literal copy of the show/movie facets:

      - search by display name or email
      - filter by role (admin/user), MFA on/off, email verified/
        unverified
      - sort by name, role, last login, created

      Low priority while instances only have a handful of users
      (self-hosted, no pagination on `GET /admin/users` either), but
      would matter for a larger shared instance. Fine to build against
      the existing flat `GET /admin/users` response client-side (filter/
      sort in the browser, same as the gallery pages do) rather than
      pushing query params to the API, unless the list grows large enough
      that pagination becomes its own separate TODO.

      `UsersPanel.tsx`'s rows are summary-only now (2026-09-03, see
      `TODO_ARCHIVE.md`'s "Split the admin Users list..." entry) rather
      than expanding inline, which is what makes this and the bulk-select
      TODO below buildable without fighting each other in the first
      place.

- [ ] **Bulk select/actions on the admin Users list** (2026-09-03 11:26 added)

      Every action on `/admin` used to be per-row only, inline
      (`UserRow.tsx`, expand-then-act); as of 2026-09-03 (see
      `TODO_ARCHIVE.md`'s "Split the admin Users list..." entry) they live
      on each user's own `/admin/users/{id}/{slug}` page instead, and
      `UsersPanel.tsx`'s rows are already the summary-only, uniform shape
      a bulk-select mode needs. James, 2026-09-03: wants a bulk-select
      mode like the Activity/History page's (`HistoryPage.tsx`: a
      `Set<string>` of selected ids, a "N selected" action bar that
      appears once anything's checked, `api.activity.removeMany(...)` for
      the bulk call) or the per-show watch tables' simpler
      row-checkbox-plus-confirm-dialog version (`WatchHistoryTable.tsx`),
      whichever fits better once this is actually designed. Wants mass
      delete, mass password reset, and mass session revoke at minimum;
      possibly mass promote/demote too.

      The single-item routes already exist (`routes/admin-users.ts`) and
      a bulk action can start as a client-side loop over them (no new API
      route needed for a first pass), but a few things need deciding
      before building:

      - **Partial failure.** A bulk delete/demote can include an account
        that individually 400s (the last-admin invariant,
        `lib/admins.ts#assertNotLastAdmin`) or a delete that 400s because
        it's the acting admin's own row. The UI needs to report "3 of 4
        succeeded, 1 refused: X" rather than silently stopping or
        swallowing the failure.
      - **Self-exclusion.** `AdminUserPage.tsx` already hides the delete
        button on the acting admin's own page; a bulk selection on the
        list needs the same rule; either exclude self from "select all"
        or disable that one checkbox.
      - Mass password reset already fails closed today when SMTP isn't
        configured (`requireEmailConfigured`); the bulk UI just needs to
        surface that the same way the single-item version does, not
        silently no-op for the whole batch.

## Watchlists

- [ ] **`/watchlists/{id}` puts a raw UUID in the URL** (2026-09-03 13:44 added)

      James, 2026-09-03, on being shown this route as precedent while
      designing `/admin/users/{id}`'s URL: "I would regard that as a
      defect and not a pattern to be replicated." A bare
      `/watchlists/8f2c1b7e-...` is unreadable, unmemorable, and tells
      the person looking at their own address bar nothing.

      The cheap fix is the one `/admin/users/{id}/{slug}` just shipped
      with (see `TODO_ARCHIVE.md`'s "Split the admin Users list..."
      entry): append a cosmetic slug segment built from the watchlist
      name, keep resolving the page by the id alone, and let a stale slug
      after a rename keep working. Nothing to migrate, no new column.

      A real `/watchlists/{slug}` is the more ambitious version and is
      plausible here in a way it wasn't for users: watchlist names are
      already unique per user (`watchlists_user_name_idx` on
      `userId, name`), and a list is only ever browsed by its owner, so
      the name is a genuine key within the scope that matters. It would
      still need a stored slug column with collision suffixing, though,
      since unique names don't imply unique slugs ("Sci-Fi!" and "Sci Fi"
      both slugify to `sci-fi`) and a name could be emoji or punctuation
      only, slugifying to nothing at all. Renames would also need a
      decision: repoint the slug and break old links, or keep the
      original the way `generateUniqueShowSlug` deliberately does.

      Worth grepping for other raw-UUID routes at the same time rather
      than fixing this one in isolation.

## Metadata & matching

- [ ] **IMDb ratings on Movies (and maybe TV Shows)** (2026-09-01 13:35 added, shelved 2026-09-01, not on any milestone)

      Would show a rating badge next to the existing plain-text "IMDb"
      link on the detail pages (`MovieDetailPage.tsx`, around line 276;
      that link's own comment currently says "this app holds no IMDb
      rating"). Link groundwork (`imdbId` already resolved for most
      movies/shows) exists; only the rating value itself is missing.
      IMDb has no public ratings API of its own, so this always meant a
      third-party integration, cached rather than fetched live: a new
      `imdbRating` + `imdbRatingCheckedAt` column pair (mirrors
      `episodes.imdbCheckedAt`'s negative-cache pattern), lazy-populated
      on page view with a ~30-day expiry, confirmed as the right shape
      with James before any legal concerns came up.

      **Shelved on legal grounds, not a technical one.** Two routes were
      explored, both blocked:

      **OMDb (omdbapi.com)**, the obvious choice (a thin wrapper API
      other apps use for this). Blocked on a real ToS conflict: their
      general Terms of Use forbid "archiving/distributing Contributions"
      and using them "in connection with any commercial endeavors," while
      their API page separately claims CC BY-NC 4.0 licensing (which
      would permit exactly this). Compounded by real project-health red
      flags: their Change Log hasn't updated since 2019, and their GitHub
      issue tracker has 230 open issues dating back to 2017 with basic
      questions unanswered (confirmed live via `gh api`).

      **IMDb's own official non-commercial datasets**
      (datasets.imdbws.com): a daily-refreshed bulk TSV download,
      keyed by the same `tt...` id already stored, no per-request quota.
      Looked structurally better, but IMDb's own terms bar using the data
      to "create any kind of online/offline database of movie
      information" beyond individual personal use, and their separate
      "Content licensing" page explicitly routes "software developers" to
      paid commercial licensing. A real-world data point backs this up:
      Casey Liss (Callsheet, a well-regarded indie IMDb-alternative app)
      looked into IMDb's own commercial API and called the pricing
      "hilarious," i.e. not viable for an indie/hobby project.

      James, 2026-09-01: not worth building on uncertain legal footing;
      revisit if either provider's terms clarify, a healthier alternative
      turns up, or IMDb gives a direct answer on whether self-hosted OSS
      counts as personal use. Movies-only vs. Movies+TV Shows was never
      decided either, moot until this unblocks.

## Roadmap

Every open item from [ROADMAP.md](ROADMAP.md) that doesn't already have a
more specific TODO elsewhere in this file. Kept brief: ROADMAP.md is the
source of truth for scope; this is just so a TODO listing is complete.

- [ ] **Tautulli/Jellyfin/Emby/Kodi webhook ingestion** (2026-08-24 16:25 added, un-M2'd 2026-08-24, M4'd 2026-08-28; M4)

      Plex's own webhook shipped 2026-08-24 (see `docs/TODO_ARCHIVE.md`):
      the entity-resolution/auth core it's built on
      (`apps/api/src/lib/external-match.ts`,
      `apps/api/src/lib/api-tokens.ts`) is deliberately source-agnostic,
      so each of these is "write one payload parser + one route," not a
      rework. Tautulli's webhook body is fully user-templated (no fixed
      shape, needs its own JSON template + setup docs, unlike Plex's
      fixed format), which is why it wasn't bundled into the same pass.

      James, 2026-08-24: not needed to close out M2. ROADMAP.md's own M2
      "Plex webhook ingestion" bullet only ever mentioned these in
      passing as future work, not as a separate required checkbox, so
      this was over-tagged M2 when first added. Left unmilestoned rather
      than reassigned to M3; no strong reason it belongs there either.

- [ ] **Stats and insights** (2026-08-23 15:32 added, un-M3'd 2026-08-26; Not yet scheduled)

      The reason to log anything in the first place, but not essential to
      the core logging loop M3 was narrowed to (2026-08-26, see
      ROADMAP.md's M3 framing).

- [ ] **Calendar of upcoming episodes** (2026-08-23 15:33 added, un-M3'd 2026-08-26, M4'd 2026-08-28; M4)

      A view of what's airing next across the shows you're following.

- [ ] **OIDC login** (2026-08-23 15:34 added, un-M3'd 2026-08-26; Not yet scheduled)

      The `user_credentials` schema was designed for this from M1; see
      [ADR 0003](adr/0003-auth-model.md).

- [ ] **Additional locales beyond English** (2026-08-26 added; Not yet scheduled)

      en-GB/en-US both ship today; more locales is pure expansion, not
      something the core logging loop needs.

- [ ] **Mobile-friendly PWA installability** (2026-08-23 15:37 added; Not yet scheduled)

      Installable/add-to-home-screen support.

- [ ] **Public/shareable profile pages** (2026-08-23 15:38 added; Not yet scheduled)

      A public view of a user's watch history/stats.
