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

- [ ] **Six reuse/simplification cleanups from the M4 review's milestone-wide `/code-review high` pass** (2026-09-15 19:53 added)

      Each independently confirmed, none urgent (maintainability only, no
      behavior change needed):

      - `apps/web/src/routes/ShowDetailPage.tsx` and `SeasonDetailPage.tsx`
        both add `sm:items-start` to fix the same poster/text
        layout-shift bug independently applied earlier to
        `MovieDetailPage.tsx`/`EpisodeDetailPage.tsx`. No shared
        poster+text layout component exists, so the next new detail-style
        page will silently reintroduce the bug. Worth factoring into one
        shared component.

      - A clipboard "copied" feedback state machine (`writeText` +
        `useState` flag + 2s `setTimeout` reset) is hand-rolled
        identically in five files (`InvitesPanel.tsx`,
        `TokenWebhookLinks.tsx`, `WebhookCard.tsx`, `WebhooksPanel.tsx`,
        `CalendarFeedsPanel.tsx`). A `useCopyFeedback()` hook would fix all
        five at once and keep future changes (e.g. an unavailable-clipboard
        error state) in sync.

      - `apps/web/src/components/calendar/calendar-shared.ts`'s
        `parseLocalDay` reimplements the `split('-').map(Number) -> new
        Date(year, month-1, day)` local-date-parsing idiom that already
        exists three times in `lib/date.ts` (`localDayStartISO`,
        `localDayEndISO`, `formatReleaseDate`) plus once more in
        `WatchDateDialog.tsx` — five copies of a pattern that exists
        specifically to avoid a UTC-midnight off-by-one-day bug, with
        nothing enforcing they stay in sync.

      - `HistorySettingsForm`, `ShowsSettingsForm`, and
        `MoviesSettingsForm` in `CalendarFeedsPanel.tsx` are three
        near-identical ~150-line components (one `useState` per checkbox,
        a hand-computed dirty boolean, an identical mutation/`onSuccess`
        shape). Adding a 4th feed type means copy-pasting a whole new
        component instead of adding one config entry to a shared,
        config-driven one.

      - A 6-line collapsible-panel-header block (`Card` +
        `details`/`summary` + `ChevronDownIcon` + divider, paired with
        `usePanelOpen`) is duplicated by hand across 23 files
        (`UsersPanel.tsx`, `DatabasePanel.tsx`, `CalendarFeedsPanel.tsx`,
        `AdminUserPage.tsx`, `InstanceSettingsPanel.tsx`, and 18 more). A
        shared `CollapsiblePanel` component would turn every future visual
        tweak (e.g. the chevron transition) from 23 edits into one.

      - `InstanceSettingsPanel.tsx` has four independent `useState` fields
        (`instanceName`, `registrationMode`, `adminEmail`,
        `priorityOrder`) plus a fifth sentinel state purely to re-seed the
        form when query data changes, synced by a manual `if (data && data
        !== loadedSettings)` block calling four setters. One form-state
        object would need a single seed line instead.

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

- [ ] **Remove the calendar month grid's selected-day panel** (2026-09-06 13:37 added, redirected to removal 2026-09-10)

      James, 2026-09-10: doesn't serve a purpose any more, remove it
      rather than fix it. Originally tracked a bug where `selectedDay`
      (set by clicking a day number, or the old "+N more" overflow control
      that no longer exists now row height is dynamic) went stale after
      navigating months via prev/next/Today, showing a panel for a day no
      longer in the visible grid with an event list that came back empty.

      A calendar doesn't need spoiler-reveal or poster art inline: that's
      one click away via the episode/movie page already, so the panel
      isn't replacing lost functionality, just a redundant extra stop on
      the way there.

      Remove `selectedDay`/`onSelectDay` and the day-number button's click
      handler from `CalendarMonthGrid.tsx`, plus the `<section>` panel
      below the grid (the `CalendarEventTile`/`PosterGrid` usage). Remove
      the matching `selectedDay` state and prop wiring from
      `CalendarPage.tsx`. `CalendarMonthCellEntry`'s own comment currently
      points to "the selected-day panel below" for the full reveal and
      will need updating too, along with whatever `CalendarMonthGrid.test.tsx`
      coverage exercises the removed behaviour.

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

- [ ] **Season/episode pages can drift from the runtime (and other fields) a play was actually logged against** (2026-09-11 23:50 added)

      `routes/library/seasons.ts` fetches episode metadata (title, overview,
      still image, runtime, air date) live from the provider on every
      request rather than from the local `episodes` table, by design: there
      is no local row for an episode until a user actually logs a play
      against it (`apps/api/src/lib/media.ts`'s `resolveEpisode`), so for an
      unwatched episode there is nothing local to serve instead. But for an
      episode that has already been watched, a local row does exist, and
      this route never reconciles it against the live value it just
      fetched, so the two can silently drift apart over time as a provider
      corrects its own data.

      Found live 2026-09-11: TMDB's runtime for Severance S1E1 had changed
      to 59 minutes, correctly reflected on the season/episode pages, while
      the local `episodes.runtime_minutes` row still held 57 (set once on
      2026-08-11, `runtime_checked_at` never populated since). This
      surfaced through the new "now watching" runtime-aware `watchedAt`
      bound (`apps/api/src/routes/plays.ts`'s `maxWatchedAt`, added the
      same day): the dialog computed its preview from the live 59-minute
      value shown on the page, but the backend validated it against
      `resolveEpisode`'s locally stored 57-minute value, rejecting an
      otherwise-legitimate submission by about two minutes. The
      runtime-aware bound itself is correct; this is a separate, pre-
      existing data-freshness gap it happened to expose.

      James, 2026-09-11: the app shouldn't shortcut by pulling live
      provider data into a page and leaving the server's own stored copy
      stale, don't be strict on "server-driven" while letting a display
      request quietly diverge from what a stored row still says elsewhere
      in the app. If the stored data needs updating, update it properly,
      rather than bypassing it. Likely direction: when this route fetches
      live data for an episode that already has a local row, write the
      fresh values back into that row (using `runtime_checked_at`, which
      looks like it was meant for exactly this) instead of only using them
      for display, so every code path reading that episode's data agrees.

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

- [ ] **Manual "back up now" button, and restore automation, for the automatic database backup** (2026-09-09 added, narrowed 2026-09-10, narrowed again 2026-09-10)

      The admin status/retention view for the automatic whole-database backup
      job shipped 2026-09-10 (`docs/TODO_ARCHIVE.md`, `DatabaseBackupsPanel.tsx`,
      `GET`/`PATCH /admin/database-backups`): last backup time and size, the
      currently retained dumps, an editable daily/weekly/monthly retention
      policy (James asked for this to be genuinely configurable, including a
      tier set to 0 to skip it entirely, e.g. "daily backups kept for a year,
      nothing else"), last-run outcome, and a link to the Restoring section
      of `docs/self-hosting.md`.

      Two things stay deliberately out of scope:

      A manual "back up now" button is a bigger step: it needs a route that
      spawns a process on request rather than on a timer, which is a
      different security shape from a scheduled job (a concurrent-run guard,
      its own rate limiting) and wants its own decision.

      Restore automation. [ADR 0008](adr/0008-database-backups.md) decided
      restore stays a manual shell procedure, on the grounds that it's
      destructive, rare, and deliberate enough that automating it adds risk
      without adding value. James, 2026-09-10: doesn't fully agree with that
      call (recorded in the ADR rather than overridden). The panel links out
      to the documented procedure for now; whether to build an actual
      in-app restore path is still open and wants its own decision, not a
      quick follow-on to the button above.

      The backup cadence itself (24h) stayed a fixed constant, not editable,
      even once retention became admin-editable: the tiers only make sense
      against a steady daily cadence, so there was nothing to open up there.

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

- [ ] **No cross-process concurrent-run guard on the scheduled database backup** (2026-09-14 added, M4 review Stage 3)

      `scheduleDatabaseBackup` (`apps/api/src/lib/database-backup.ts`) has
      no protection against two `runDatabaseBackup()` calls overlapping
      across processes — e.g. a botched deploy briefly running two
      containers against the same `DATABASE_BACKUP_DIR`, or a tight
      restart loop. Within one process this is effectively impossible
      (`setInterval` only fires again after 24h regardless of how long the
      previous run took, and a dump never takes anywhere near that long),
      so no fix was applied there.

      The real risk is narrow but not nothing: two runs starting in the
      same second compute the identical `rwnd-<timestamp>.sql.gz.partial`
      name (`timestampName`'s resolution is per-second) and both open a
      write stream to it. `createWriteStream`'s default truncating `'w'`
      flag means the second opener can truncate the file out from under
      the first mid-write, producing an interleaved/corrupt dump that
      still renames successfully and looks like a valid backup — exactly
      the failure class the `.partial` + atomic-rename design
      ([ADR 0008](adr/0008-database-backups.md)) exists to prevent, just
      not for this particular collision.

      Same shape as the concurrent-run guard already named as needed for
      the manual "back up now" button above, but applies to the scheduled
      job today, independent of whether that button ever gets built. A
      real fix needs cross-process coordination (a lock file via exclusive
      `open()`, or including a random suffix in the partial filename so
      two concurrent runs can never collide on one path) - worth deciding
      once, covering both the scheduled job and any future manual-trigger
      route, rather than solving it twice.

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

## Security

- [ ] **Full structured request logging** (2026-08-29 added, re-homed here 2026-09-14)

      The M3 ASVS review (`docs/adr/0007-security-posture.md`,
      `docs/security/asvs-l1.md`) only ever added minimal
      `[security]`-prefixed event logging (`apps/api/src/lib/security-log.ts`),
      not a general request-logging pipeline. Left as a genuine, deliberately
      unclosed gap at the time — but the old Security section this item lived
      in got fully closed out and archived to `docs/TODO_ARCHIVE.md` without
      this one item being carried forward, leaving `asvs-l1.md`'s "Deferred
      items" section pointing at a section that no longer existed. Re-homed
      here 2026-09-14 while scoping the M4 milestone review, so the pointer
      resolves again.

- [x] **M4 milestone code + security review** (2026-09-14 21:02 added, all 7 stages + milestone-wide pass completed 2026-09-15; M4)

      Per `CLAUDE.md`'s "Closing out a milestone" rule: before marking M4
      `✅ done` in `ROADMAP.md`, run both a code review and a security review
      over everything that shipped for it (122 commits since `v1.0.0`, M3's
      close), not just the latest diff. Matching M3's own method
      (`docs/adr/0007-security-posture.md`, a structured ASVS 4.0.3 Level 1
      pass) rather than a single `/security-review` run, since that skill has
      no scope argument and excludes several categories this milestone needs
      (dependency findings, secrets-at-rest nuance, hardening/audit-log gaps).
      Spans multiple sessions; full plan at
      `C:\Users\James\.claude\plans\joyful-discovering-peach.md`. Progress:

      - [x] Stage 1: webhook ingestion core & trust model (Jellyfin/Emby/Tautulli,
            source-agnostic dispatch, play-dedup/advisory-lock rework,
            consent-based attribution rework) — 2026-09-14. Fixed a real
            TOCTOU race in `resolveWebhookAccount` (concurrent first-sighting
            deliveries for the same account could 500 on a unique-index
            collision; `apps/api/src/lib/webhook-accounts.ts`), with a
            regression test. Logged the TMDB/TVDB path-encoding item below
            as a follow-up. Everything else (rate limiting, log hygiene,
            token-in-URL auth, consent/attribution flow, `f930234`'s cascade
            fixes) checked against ADR 0007 and found already covered or
            out of `/security-review`'s own scope. ASVS rows for Stage 7:
            V4.2.1 pass, new V11 section (business-logic/workflow-bypass)
            needed - pass, no bypass found.
      - [x] Stage 2: admin & owner-role privilege model — 2026-09-14. No
            findings. Verified `assertNotLastAdmin`'s row-lock genuinely
            closes the concurrent-demotion race (same transaction as the
            write, at every call site), bulk actions re-enforce every
            invariant server-side per item (no separate weaker bulk route),
            `transfer-ownership` re-proves the password and locks the owner
            row before swapping, `GET /admin/users` exposes nothing beyond
            ADR 0007's already-accepted scope, and the password-reset
            trigger never lets an admin see/set another user's password.
            ASVS rows for Stage 7: V4.1.1, V4.1.2, V4.1.3, V4.2.1, V2.5.x —
            all pass.
      - [x] Stage 3: scheduled database backups (verify against ADR 0008) —
            2026-09-14. 6 of 7 ADR 0008 claims held exactly; one had
            drifted: the stale-`.partial` cleanup matched any
            `*.partial` file, not just this job's own `rwnd-<ISO>.sql.gz.partial`
            shape, so a human-placed `.partial` file sitting in the bind
            mount for 6h+ would get silently deleted — contradicted the
            ADR's own "can't delete anything it didn't write" claim. Fixed
            with a matching regex, regression test added. Also found and
            logged a new (not ADR-covered) cross-process concurrent-run
            risk — see the item above. Verified container hardening
            (read_only/cap_drop/no-new-privileges) directly against
            docker-compose.yml. ASVS rows for Stage 7: V8.3.x, V12.1.1,
            V14.4.x — pass (V12.1.1 pass only after the fix).
      - [x] Stage 4: calendar feeds & in-app calendar — 2026-09-14. Found and
            fixed a real spoiler-protection gap: the .ics feed's SUMMARY
            field always embedded the real episode title regardless of
            spoilerProtectionEnabled, the one field on a calendar event an
            .ics subscriber can't avoid seeing (DESCRIPTION was already
            correctly omitted for the same reason). Fixed by reusing
            episodeSummary()'s existing null-title branch; regression test
            added. Verified the token-in-URL rate limit, `Cache-Control:
            no-store`, no token logging anywhere, and the `ENCRYPTION_KEY`
            503 gate are all genuine, not just documented. ASVS rows for
            Stage 7: V2/V3 (token pattern), V9.1.x (no-store) — pass;
            V8.2.x/V8.3.x and new V11 (spoiler invariant across every
            surface, not just ones with a client to blur with) — pass, but
            only after today's fix.
      - [x] Stage 5: Webhooks panel redesign & token-encryption posture
            change — 2026-09-14. Found and fixed two real gaps. First,
            `serializeToken` called `decryptSecret` bare, so a single row
            encrypted under a since-rotated `ENCRYPTION_KEY` would 500 the
            whole `GET /tokens` list instead of just falling back to
            `token: null` for that row (GCM's auth-tag check fails on any
            key mismatch); wrapped in try/catch, regression test added.
            The same gap exists in `calendar-feeds.ts`'s
            `serializeCalendarFeed` but needs a different fix shape (its
            wire type is non-nullable); logged separately above rather
            than folded in here. Second, `PATCH /tokens/{id}` was
            documented ("only settable field, and only once null") but
            the `UPDATE` had no `source IS NULL` guard, so a token owner
            could silently overwrite `source` repeatedly via a direct API
            call, contradicting its own contract; added the missing
            `isNull` guard plus a 409 response and regression test
            (cosmetic only: confirmed via grep that `source` is never an
            ingestion constraint in `routes/webhooks.ts`). Verified
            AES-256-GCM's fresh-IV-per-call and auth-tag handling in
            `lib/crypto.ts`, that regenerate atomically invalidates the
            old token, that every PATCH/regenerate/link mutation scopes
            its `WHERE` to the caller's own `userId` (no cross-user
            access), that no webhook secret/URL ever reaches a log call,
            and the four downloaded attribution icon files for embedded
            metadata (all clean). Full suite green (1041 passed, 7
            skipped, 0 failed) after clearing a corrupted local Vite
            dependency cache that had produced spurious failures against
            stale compiled output. ASVS rows for Stage 7: new V6 section
            (Stored Cryptography) — pass, grounded in this stage's crypto
            review; V4.1.x (cross-user access) — pass.
      - [x] Stage 6: supply-chain, CI & dependency hygiene — 2026-09-15. No
            code findings: `.github/workflows/{ci,codeql,release}.yml`,
            `Dockerfile`, `docker-entrypoint.sh`, `pnpm-workspace.yaml`, and
            `.github/dependabot.yml` are all already hardened (every action
            pinned by SHA, the published image pinned by digest and
            cosign-signed, Trivy gating both the source lockfile and the
            built image on every CI run and release, a non-root runtime
            user with `npm`/`npx` stripped, and the `hashSecret()` CodeQL
            false positive suppressed with a correctly-placed inline
            `codeql[js/insufficient-password-hash]` comment). Verified live
            against the GitHub API rather than trusting the docs' claims:
            dependency graph and Dependabot security updates both actually
            enabled, zero open Dependabot or CodeQL alerts, branch
            protection matches the documented direct-push-with-admin-bypass
            posture, secret scanning + push protection both on. Enabled
            **Dependabot malware alerts** (free, no license needed, was
            off). Checked "Prevent direct alert dismissals" (Dependabot and
            code scanning) and deliberately left it off — more process than
            a solo-maintainer direct-push repo needs. Confirmed
            `secret_scanning_non_provider_patterns` and
            `secret_scanning_validity_checks` are genuinely unavailable, not
            misconfigured: no toggle in Settings → Advanced Security or via
            the repo API, because the `rwnd-tv` org has zero GitHub Advanced
            Security seats. The planned mechanical `/code-review max
            v1.0.0` pass fanned out into ~20 parallel subagents and, after
            30+ minutes, the session hit its rate limit before compiling a
            report; killed rather than repeated this session. Not
            re-attempted, since this stage's files are static
            config/infra rather than application logic and the manual
            read-through above already covers them; worth a `/code-review
            high` (less fan-out) if a mechanical pass over these same files
            is ever wanted later. ASVS rows for Stage 7: new V10 section
            (Malicious Code) — pass, grounded in this stage's review
            (pinned actions/image, signed+digest-pinned release, Trivy gate
            on every CI run and release, Dependabot alerts + malware
            alerts, CodeQL).
      - [x] Milestone-wide mechanical code review (`/code-review high
            v1.0.0`), 2026-09-15, commit `0050bc3`. Not tied to one stage:
            CLAUDE.md's revised "Closing out a milestone" rule now runs
            this pass once per milestone rather than once per stage (the
            earlier `max`-level attempt during Stage 6 over-fanned-out and
            burned a session's usage limit for no output). Found and fixed
            two real bugs: the same rotated-`ENCRYPTION_KEY` gap Stage 5
            fixed in `serializeToken` was unguarded at 4 more
            `decryptSecret` call sites (MFA login, disable/regenerate,
            enrollment confirm), locking out any MFA-enabled user after a
            key rotation instead of a clean "wrong code"; fixed with a
            shared `verifyEncryptedTotp()` helper (`lib/totp.ts`) that
            fails closed. Also a webhook self-link TOCTOU race letting a
            user link two accounts of the same source at once; fixed with
            `lockUserSource()`, a Postgres advisory lock matching
            `lib/plays.ts`'s existing pattern for a related race. Plus two
            trivial `Promise.all` efficiency fixes and 7 smaller findings
            logged above/below as follow-ups. Verified via two clean full
            local suite runs (1043/1043) and end-to-end against a live
            dev.rwnd.tv deploy (MFA enroll/login round-trip; a synthetic
            webhook self-linked via the UI) after an earlier run's 47
            failures turned out to be a one-off transient environment blip,
            confirmed via a clean-baseline comparison against unmodified
            code. ASVS rows for Stage 7: new V11 section (Business Logic),
            pass, grounded in the webhook-linking invariant this pass
            fixed plus the other invariants Stages 1/4/5 already verified.
      - [x] Stage 7: close-out, 2026-09-15. Added V6 (Stored Cryptography),
            V10 (Malicious Code), and V11 (Business Logic) sections to
            `docs/security/asvs-l1.md`, each verified against the real
            ASVS 4.0.3 requirement text (fetched live, not from memory),
            worth noting since V6 and V10 turn out to have only one and
            three Level 1 requirements respectively, not full chapters of
            them, so those sections lean on this file's existing "named L2
            items" allowance rather than a full L1 table. Added a dated
            "M4 milestone review close-out" update to
            [ADR 0007](adr/0007-security-posture.md) summarizing all 7
            stages plus the milestone-wide pass. Deliberately did **not**
            flip M4 to `✅ done` in `ROADMAP.md`, James's explicit call
            this session: that stays a separate, later decision, not
            automatic just because the review is complete.

      `docs/security/asvs-l1.md` stays the durable record, updated in place
      per stage rather than replaced.

- [ ] **URL-encode external ids interpolated into TMDB/TVDB request paths** (2026-09-14 added, Stage 1 of the M4 review)

      `providers/tmdb.ts` and `providers/tvdb.ts` build request paths like
      `` `/tv/${externalId}` `` and `` `/series/${externalId}/extended` ``
      with no `encodeURIComponent`, for every provider client call — not
      just the webhook-driven ones. `externalId` for a webhook-triggered
      lookup ultimately traces back to attacker-controlled webhook payload
      content (Plex's `Metadata.Guid[].id`, Tautulli's templated fields,
      etc. — anyone holding a valid webhook token controls the full body,
      not just legitimate media-server data), so a crafted id containing
      `/` or `..` could redirect the request to a different TMDB/TVDB API
      path than intended. Narrow in practice — same fixed host, this
      server's own API key, no cross-host redirection possible, and
      `/security-review`'s own scope explicitly excludes path-only SSRF —
      but cheap to close with `encodeURIComponent(externalId)` at each call
      site. Touches the shared provider-client layer (also used by
      ordinary search/browse, not just webhooks), so it's its own
      follow-up rather than a Stage 1 inline fix.

- [ ] **`serializeCalendarFeed` still 500s on a since-rotated `ENCRYPTION_KEY`** (2026-09-14 added, Stage 5 of the M4 review)

      `apps/api/src/routes/tokens.ts`'s `serializeToken` and
      `apps/api/src/lib/calendar-feeds.ts`'s `serializeCalendarFeed` both
      call `decryptSecret` on a row's encrypted secret to redisplay it,
      and both would throw uncaught if `ENCRYPTION_KEY` has changed since
      that row was encrypted (a real scenario, not just theoretical, since
      rotating the key is itself a legitimate response to a suspected
      compromise): GCM's auth-tag check fails and `decipher.final()`
      throws, so one undecryptable row would 500 the whole list response
      instead of failing gracefully just for that row. Stage 5 fixed
      `serializeToken` (try/catch around the decrypt, falling back to
      `token: null` the same way a never-encrypted row already does, with
      a regression test in `apps/api/src/test/tokens.test.ts`), but
      `serializeCalendarFeed` needs a different fix shape: its wire type
      (`CalendarFeed.token`) is non-nullable, since
      `calendarFeeds.tokenEncrypted` itself is `.notNull()` (every
      calendar feed requires `ENCRYPTION_KEY` to be configured at
      creation, unlike webhook tokens, which degrade gracefully with no
      key at all). Fixing it properly likely means either making the wire
      type nullable too (a small API-shape change other call sites need
      updating for) or a documented operational stance, e.g. "rotating
      `ENCRYPTION_KEY` invalidates existing calendar-feed subscriptions;
      resubscribe from Settings," worth deciding deliberately rather than
      folding into Stage 5's scope, which only covers the webhooks panel
      work.

- [ ] **`trakt.ts`'s `ensureFreshAccessToken` gives a cryptic error on a rotated `ENCRYPTION_KEY`** (2026-09-15 added, M4 review's milestone-wide `/code-review high` pass)

      Same unguarded-`decryptSecret` shape as the item above and the one
      the milestone-wide pass fixed elsewhere (`lib/totp.ts`'s
      `verifyEncryptedTotp`, covering MFA login/disable/regenerate/confirm),
      but lower priority here: `apps/api/src/import/trakt.ts`'s
      `ensureFreshAccessToken` is already inside the job runner's own
      try/catch (`runTraktImport` → `runImportJob`, `trakt.ts` around line
      431), so a decrypt failure after a key rotation fails the import job
      gracefully (`status: 'failed'`) rather than crashing or 500ing a
      live request. The gap is purely UX: the stored `error` message is
      GCM's raw auth-tag-mismatch text, not something that tells the user
      to reconnect their Trakt account. Worth a friendlier error message
      (and maybe clearing the connection so the UI prompts to reconnect)
      but not a correctness bug.

## Roadmap

Every open item from [ROADMAP.md](ROADMAP.md) that doesn't already have a
more specific TODO elsewhere in this file. Kept brief: ROADMAP.md is the
source of truth for scope; this is just so a TODO listing is complete.

- [ ] **Kodi webhook ingestion** (2026-08-24 16:25 added, un-M2'd 2026-08-24, M4'd 2026-08-28, scoped down 2026-09-11, Tautulli split off 2026-09-14; M4)

      Tautulli shipped 2026-09-14 (see `docs/TODO_ARCHIVE.md`), leaving
      Kodi as the only source left on what was originally "Tautulli/Kodi
      webhook ingestion." Kodi has no native webhook support at all, so
      it needs an addon-based approach rather than a plain payload
      parser, most likely a small service addon shipped and distributed
      from this repo rather than a config paste.

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

