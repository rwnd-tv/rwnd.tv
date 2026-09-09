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

- [ ] **Hold TS 7 bump** (2026-08-09 20:40 added, ignore rule added 2026-08-30, rationale revised 2026-09-09)

      `typescript-eslint` doesn't support TS 7 yet. A Dependabot PR
      (`dev-dependencies` group) bundled a `typescript` 5.9.3→7.0.2 bump in
      with 13 unrelated safe updates, failing CI (lint) for the whole
      group. Added a `typescript` major-version `ignore` rule to
      `.github/dependabot.yml` so Dependabot stops proposing it; remove
      that ignore once `typescript-eslint` supports TS 7.

      The bundling half of that reasoning no longer applies. Since
      2026-09-09 the `dev-dependencies` group carries
      `update-types: ['minor', 'patch']`, so a major never joins the
      group at all: a TS 7 bump would now arrive as its own PR and fail on
      its own, taking nothing else down with it.

      The ignore rule is still worth keeping, on the narrower grounds that
      it stops Dependabot reopening a PR that can only be closed again
      until `typescript-eslint` catches up. Both mechanisms now guard the
      same thing from different angles; removing the ignore once TS 7 is
      supported stays the exit condition either way.

## UI polish

- [ ] **Inset the dropdown arrow on `<select>` controls** (2026-09-06 added)

      The native browser dropdown arrow on every `<select>` sits flush
      against the right edge, tighter than the horizontal margin other
      controls use (the shared `Select.tsx`'s own `px-3` text padding, for
      instance). Move it slightly left/inward so its margin matches.

      Native `<select>` styling can't reposition the built-in arrow
      directly; this needs `appearance-none` plus a custom
      background-image arrow (or an inline SVG) with its own
      `background-position` offset, on both call sites: the shared
      `Select.tsx` (used throughout the site, e.g. `LibraryControls.tsx`'s
      Sort dropdown) and the one-off `<select>` in
      `PreferencesCard.tsx` (locale picker), which doesn't go through
      `Select.tsx`. Worth folding the latter into `Select.tsx` while
      touching this, unless there's a reason it was kept separate.

- [ ] **Only show the tick on "Watched" buttons once the item is watched** (2026-09-06 added)

      The labeled Watched buttons all render their `CheckIcon` unconditionally,
      next to the label, regardless of watched state; only the button's
      variant (primary vs. secondary) currently reflects whether the item
      is watched. Four separate copies of this pattern (each with its own
      duplicated `CheckIcon`, per this codebase's existing one-icon-per-file
      precedent): `MovieDetailPage.tsx`, `ShowDetailPage.tsx`,
      `SeasonDetailPage.tsx`, `EpisodeDetailPage.tsx`.

      `EpisodeCard.tsx`'s circular per-episode toggle button also renders a
      `CheckIcon` (or the watch count, if watched more than once)
      unconditionally, but there it's the button's only content when
      unwatched, not an icon next to a label; hiding it there would leave
      an empty circle. Confirm with James whether that one should change
      too, or only the four labeled buttons above.

- [ ] **Clear the calendar's selected-day panel when that day scrolls out of view** (2026-09-06 13:37 added)

      `CalendarPage.tsx`'s `selectedDay` (set by clicking a day number or a
      cell's "+N more" overflow control in `CalendarMonthGrid.tsx`) isn't
      reset when `monthAnchor` changes. Navigating months (prev/next/
      Today) leaves the old `selectedDay` in place even though it's no
      longer one of the currently rendered grid cells (none of which show
      as selected any more, since `isSelected` compares against the new
      month's days), so the panel below the grid keeps showing a day that
      isn't visible above it, and its event list, freshly looked up against
      the new query window, comes back empty even when that day actually
      has events.

      Clear `selectedDay` (or re-derive it against the currently visible
      day range) whenever `monthAnchor` changes, so the panel never
      outlives the day it belongs to.

## Mobile / responsive

- [ ] **Quality pass on the whole interface at phone width** (2026-09-06 added)

      James, 2026-09-06: most users interact with this through their
      phones, and it's had very little real testing at that scaling so
      far. Needs a proper pass across the whole app: every route, at
      actual phone viewport widths (both real devices and browser
      devtools emulation), looking for cramped/overflowing layouts, touch
      targets too small or too close together, dialogs/panels that don't
      fit, and anything that only works because it was built and tested
      at desktop width.

      Current state going in: only 8 `.tsx` files in `apps/web/src` use
      any Tailwind responsive breakpoint (`sm:`/`md:`/`lg:`/`xl:`) at all
      (`Sidebar.tsx`, `UserRow.tsx`, `DatabasePanel.tsx`,
      `EpisodeDetailPage.tsx`, `LandingPage.tsx`, `MovieDetailPage.tsx`,
      `SeasonDetailPage.tsx`, `ShowDetailPage.tsx`) out of the whole
      route/component tree, so most of the app has had no explicit mobile
      treatment at all rather than a few rough edges to touch up.

      Broad and open-ended by nature: expect this to surface a long tail
      of individual, page-specific fixes rather than one shared root
      cause, so treat it as its own audit/planning pass (probably worth
      going page by page and logging findings) rather than something to
      fix inline in one sitting. Distinct from the already-tracked
      "Mobile-friendly PWA installability" roadmap item below, which is
      about add-to-home-screen support, not layout quality.

## TV Shows / Movies gallery follow-ups

- [ ] **Sticky filter/sort bar on TV Shows** (2026-09-06 added)

      "Filter by title", "Filters", and "Sort" (`LibraryControls.tsx`,
      shared with MoviesPage) should stay pinned at the top of the TV Shows
      page while the gallery grid scrolls beneath it, instead of scrolling
      out of view with the rest of the page.

      Requested for `ShowsPage.tsx` specifically; worth considering for
      `MoviesPage.tsx` too since it uses the same control bar, but confirm
      with James before extending scope there.

- [ ] **Sticky filter/sort bar on History** (2026-09-06 added)

      Same as the TV Shows item above: `HistoryPage.tsx`'s "Filter by
      title", "Filters" (`FiltersPanel.tsx`, holding
      `ActivityKindFilterPanel`/`DateRangeFilterPanel`), and "Sort" row,
      built from the same shared `LibraryControls.tsx`, should stay pinned
      at the top while the history list scrolls beneath it.

- [ ] **Sticky filter/sort bar on a Watchlist's detail page** (2026-09-06 added)

      Same as the two items above: `WatchlistDetailPage.tsx`'s "Filter by
      title" and "Sort" row (`LibraryControls.tsx`; no `FiltersPanel` here,
      unlike History/TV Shows) should stay pinned at the top while the
      watchlist's items scroll beneath it.

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

## Sensible defaults

- [ ] **Default History's Filters > Type to "Watched" only** (2026-09-06 added)

      `HistoryPage.tsx`'s Filters panel currently defaults to all four
      activity kinds shown (`ACTIVITY_KINDS`: watch/rating/watchlist/
      dropped) when no filter cookie is set yet, via
      `useActivityKindFilterCookie`'s `new Set(ACTIVITY_KINDS)` fallback
      (`use-activity-kind-filter-cookie.ts`). Change that fallback to just
      `watch` so a first-time (or cookie-cleared) visit to History shows
      watched activity only, matching what most people actually want from
      a watch history page; the other three kinds stay one click away in
      the Filters panel same as today.

- [ ] **Default the Admin page's Users panel to expanded** (2026-09-06 added)

      `UsersPanel.tsx` (`AdminPage.tsx`'s only panel) is a `<details>` +
      `usePanelOpen('panelAdminUsers')`, which defaults to collapsed
      (`defaultOpen` unset, so `use-panel-open.ts`'s `false`). Change the
      call to `usePanelOpen('panelAdminUsers', true)` so a first-time (or
      cookie-cleared) visit shows the user list immediately rather than
      needing a click to reveal it.

      Note this reverses an explicit prior decision, not an oversight:
      `UsersPanel.tsx`'s own doc comment records James asking on
      2026-09-03 for this panel to match the rest of the app's collapsed-
      by-default panels rather than always rendering open. Worth a quick
      "still want this changed?" gut-check given that history, though the
      Admin page's own panel (nothing else on the page competing for
      space, unlike Account/Settings/Import's several stacked panels) is
      a reasonable place for a "sensible defaults" pass to land
      differently.

- [ ] **Default the TV Shows calendar feed to "Include every show I've ever watched" only** (2026-09-06 added)

      `ShowsSettingsForm` (`CalendarFeedsPanel.tsx`) has three checkboxes
      for a newly-created 'shows' feed, all sourced from the
      `calendar_feeds` row's column defaults (`packages/db/src/schema.ts`;
      the create route omits these fields on insert and relies on the
      column defaults, in `apps/api/src/routes/calendar.ts`'s POST
      handler): `includeDropped` false (already unticked, matches),
      `futureOnly` true ("Only upcoming episodes", needs to become
      unticked), `includeAllWatched` false ("Include every show I've ever
      watched", needs to become ticked).

      `futureOnly` and `includeAllWatched` are shared columns on the same
      `calendar_feeds` table, reused by the Movies feed
      (`MoviesSettingsForm`); see the matching Movies/Films item below,
      which wants the same two values changed the same way. With both
      requested, the column-level defaults in `schema.ts` can just be
      flipped directly (`futureOnly` to `false`, `includeAllWatched` to
      `true`) rather than branching per `feedType` in the POST handler;
      only revisit that if the two items end up diverging before either
      ships. `includeDropped` has no Movies equivalent (dropping is a
      shows-only concept), so it's untouched either way.

- [ ] **Default the Films calendar feed to "Include every film I've ever watched" only** (2026-09-06 added)

      Same as the TV Shows item above, for `MoviesSettingsForm`
      (`CalendarFeedsPanel.tsx`, Settings > Calendar feeds > Films): its
      two checkboxes, `futureOnly` ("Only upcoming films", currently true/
      ticked) and `includeAllWatched` ("Include every film I've ever
      watched", currently false/unticked), should default the other way
      round, so only the "ever watched" checkbox starts ticked.

      Same shared `calendar_feeds` columns as the Shows item above; with
      both wanted, flip the two column defaults in `schema.ts` once
      rather than doing it twice.

## Backups

- [ ] **Admin interface for the instance's automatic database backups** (2026-09-09 added)

      The scheduled whole-database backup shipped with no user-facing surface
      at all: no route, no settings flag, no UI. Its entire surface is the
      `DATABASE_BACKUP_DIR` env var and one call in `apps/api/src/index.ts`.
      Everything else is hardcoded in `apps/api/src/lib/database-backup.ts`:
      a 24-hour interval, one immediate pass at startup, and retention of the
      newest 7. The only way to observe it is `docker compose logs app`, which
      prints one line per run.

      That means an admin with no shell access cannot tell whether backups are
      running at all, when the last one succeeded, or how big they are, and
      cannot trigger one before doing something risky. For a self-hoster that
      is the difference between trusting the feature and hoping.

      James, 2026-09-09: no new version gets cut until this exists.

      Smallest useful version is read-only, following the existing
      `*Configured` pattern (`backupsConfigured` in
      `apps/api/src/routes/settings.ts`, consumed by the Database panel):
      a `databaseBackupsConfigured` flag plus last-run timestamp, file size
      and count, surfaced on the Admin page. Deliberately not mirrored when
      the feature was built, on the grounds that it is an instance-level ops
      concern rather than a per-user one; see `env.ts`'s comment on the
      variable and [ADR 0008](adr/0008-database-backups.md).

      A manual "back up now" button is a bigger step and worth deciding
      separately: it needs a route that spawns a process on request rather
      than on a timer, which is a different security shape from a scheduled
      job and would want its own rate limiting.

      Whether the interval and retention should become editable (they are
      module constants today, matching how every other interval in this
      codebase works) is also open, and probably wants deciding alongside
      the read-only view rather than before it.

- [ ] **Show what actually changed in the backup Diff dialog** (2026-09-06 added)

      Settings > Database panel > Backups > the Diff button
      (`DatabasePanel.tsx`, the `diffTarget` dialog around line 417)
      currently only shows a per-category added/removed count (e.g.
      "3 added, 1 removed") via `settings.database.backup.diffLine`. Add
      an expandable section below the category list and above the Close
      button, shown only when at least one category actually has a
      nonzero added/removed count, that lists the specific items added
      and/or removed.

      This needs API work first, not just a UI change: `computeBackupDiff`
      (`apps/api/src/backup/diff.ts`) currently reduces each category to a
      `{ added, removed }` count via `multisetDiff`, comparing entries as
      opaque `JSON.stringify`'d strings and discarding which specific
      entries they were. Its own doc comment notes this was a deliberate
      choice ("not a third 'changed' bucket the UI doesn't ask for") back
      when the UI only needed counts; showing the actual list of
      added/removed items means `BackupDiff`
      (`packages/shared/src/schemas/backups.ts`) needs to carry enough
      per-entry identifying detail (title, and whatever disambiguates
      duplicates, e.g. watched date for `watchHistory`) alongside the
      counts, and `computeBackupDiff` needs to keep the unmatched entries
      themselves rather than only tallying them.

      A changed rating/note still reads as "old entry removed, new one
      added" under this model, same as today, not a separate "changed"
      case, so both entries would show up in their respective added/
      removed lists rather than paired together; worth confirming that's
      clear enough in the UI once real entries (not just counts) are on
      screen.

## Ratings

- [ ] **Don't allow rating anything that hasn't aired/released yet** (2026-09-06 added)

      The 5-star `RatingPicker` currently renders and works regardless of
      air/release date. Hide it on the frontend for an episode
      (`EpisodeDetailPage.tsx`, `EpisodeCard.tsx`) with no `firstAired`
      date, or one in the future, and for a movie
      (`MovieDetailPage.tsx`) with no `releaseDate`, or one in the future.

      Also enforce it server-side, not just hide the widget client-side:
      the three PUT rating routes in `apps/api/src/routes/library/ratings.ts`
      (episode, show, movie) currently accept a rating unconditionally.
      Reject a PUT for an unaired episode or unreleased movie (a 4xx, not a
      silent no-op).

      `useEpisodeRatingActions` (`apps/web/src/lib/use-episode-rating-actions.ts`)
      currently has a comment noting ratings are deliberately independent
      of watched status with "no aired-date guard"; that was about
      decoupling rating from the watched toggle, not a decision that
      unaired content should be ratable; this TODO doesn't reverse that,
      it adds the missing aired-date check on top.

      The show-level rating (`ShowDetailPage.tsx`) rates the whole show,
      not a single air date, so this doesn't cleanly apply the same way:
      an ongoing show has aired episodes even if unaired ones remain.
      Confirm with James whether a show with zero aired episodes yet
      (announced/upcoming) should also be blocked, or whether show-level
      rating is out of scope for this one.

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

