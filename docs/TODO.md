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

- [ ] **Hold TS 7 bump** (2026-08-09 20:40 added, ignore rule added 2026-08-30, rationale revised 2026-09-09, exit condition corrected 2026-09-22)

      `typescript-eslint` doesn't support TS 7. A Dependabot PR
      (`dev-dependencies` group) bundled a `typescript` 5.9.3→7.0.2 bump in
      with 13 unrelated safe updates, failing CI (lint) for the whole
      group. Added a `typescript` major-version `ignore` rule to
      `.github/dependabot.yml` so Dependabot stops proposing it.

      The bundling half of that reasoning no longer applies. Since
      2026-09-09 the `dev-dependencies` group carries
      `update-types: ['minor', 'patch']`, so a major never joins the
      group at all: a TS 7 bump would now arrive as its own PR and fail on
      its own, taking nothing else down with it.

      The ignore rule is still worth keeping, on the narrower grounds that
      it stops Dependabot reopening a PR that can only be closed again
      until `typescript-eslint` catches up.

      Correction 2026-09-22: `typescript-eslint` has closed the TS 7
      support request as "not planned", not just "not yet" - TS 7 ships
      without a stable programmatic API, which their type-aware rules
      depend on structurally. "Remove the ignore once `typescript-eslint`
      supports TS 7" may therefore never trigger as worded. Revisit if
      `typescript-eslint` reverses that position, or consider whether a
      TS 7 bump is ever wanted enough to work around the incompatibility
      some other way (e.g. installing it alongside TS 6 rather than
      replacing it).

- [x] **Em-dashes in `docs/TODO.md` and `docs/adr/0007-security-posture.md` violate CLAUDE.md's prose-style rule** (2026-09-21 added, M5 review, fixed 2026-09-21; M5)

      CLAUDE.md's "Prose style in docs" section is explicit that
      `docs/TODO.md` is not exempt ("it's actively read, so it follows the
      same rule as everything else above"), and `docs/adr/` isn't exempt
      either (only `docs/TODO_ARCHIVE.md` is). Found, via `grep -c
      "—"`, 25 instances in `docs/TODO.md` and 14 in `docs/adr/
      0007-security-posture.md`, added across several earlier M5 commits
      (the security-hardening follow-ups and the M4-review write-up).

      Fixed with a real read-through per instance rather than a mechanical
      find-and-replace, picking whichever of colon, semicolon, comma,
      parentheses, or a separate sentence read best for that sentence. One
      instance intentionally remains in `docs/TODO.md`: the literal glyph
      quoted above.

## UI polish

- [ ] **Fold the five other `PlusIcon` copies into the shared one** (2026-09-21 added, count corrected 2026-09-22; Not yet scheduled)

      The mobile-pass touch-target fix (M5) moved `PlusIcon`/`MinusIcon`
      into `components/icons.tsx` and reused them from the new
      `IncludeExcludeToggle`, but deliberately left five more `PlusIcon`
      copies alone: `EpisodeDetailPage.tsx`, `MovieDetailPage.tsx`,
      `SeasonDetailPage.tsx`, `ShowDetailPage.tsx`, and `EpisodeCard.tsx`
      (originally miscounted as "six" when this item was added; confirmed
      2026-09-22 there are five, no `MinusIcon` duplicates anywhere).
      Those use `strokeWidth={3}` with a linejoin rather than the filter
      panels' `strokeWidth={2.5}` with none, so folding them into the
      shared icon as-is would be a visual change to five action buttons,
      not a pure dedup. Worth doing once `icons.tsx`'s shared `Icon`
      wrapper (or a similar one for this pair) exposes a stroke-weight
      contract that can represent both without a caller-side override.

## TV Shows / Movies gallery follow-ups

- [ ] **Virtualize the gallery grid if libraries grow** (2026-08-19 15:25)

      Shipped without `content-visibility`/windowing: real libraries are
      ~500 shows/movies, comfortably fine for the DOM. Revisit if a
      self-hoster's library gets meaningfully larger and scroll performance
      suffers.

## Watchlists

- [ ] **Sort and filter the Watchlist detail page by status, release year,
      and TMDB rating** (2026-09-21 added, narrowed 2026-09-21, rating
      sort added 2026-09-21, filters by status/year/rating added
      2026-09-21)

      James, 2026-09-21, across one session: wants to sort the watchlist
      by release year, then asked for a TMDB rating sort too, then asked
      to also filter by status, release year, and rating. Landed scope:
      sort by year and rating; filter by status, year, and rating. Not
      genre, and not the watch-progress-dependent dimensions (my rating,
      watched year, dropped, progress) - those still don't apply to a
      possibly-never-watched watchlist item, per the reasoning in
      `WatchlistDetailPage.tsx`'s own doc comment (lines 80-87) that
      originally scoped this page down to title-filter-only.

      Turns out "status" isn't watch-progress at all: `LibraryShow`/
      `LibraryMovie`'s `status` field (`packages/shared/src/schemas/
      library.ts`) is TMDB's own raw status string (e.g. "Returning
      Series", "Ended" for shows; TMDB's release status for movies), a
      property of the underlying title, not of whether/how the user has
      watched it - same category as genre/year/rating, all fair game for
      a "what should I watch next" list.

      Three different implementation costs:

      **Release year** - self-contained UI change, no schema/API work:
      `WatchlistItemMedia` (`packages/shared/src/schemas/watchlists.ts`)
      already carries `year`, and both `yearComparatorAsc`/
      `yearComparatorDesc` and `filterByReleaseYear`
      (`apps/web/src/lib/library-filter.ts`) are already generic over any
      `{ year: number | null }` - the same shape `ShowsPage.tsx` uses
      them against, so `ReleaseYearFilterPanel.tsx` drops in as-is too.

      **TMDB rating** needs the same schema/API change as status below
      (`WatchlistItemMedia` has no `voteAverage` field today;
      `apps/api/src/routes/watchlists.ts`'s two item queries around lines
      363 and 375 would need it added alongside `year`/`posterPath`, and
      the shaping step around line 397 would need it carried through).
      Once that field exists, `filterByRating`/`ratingComparatorAsc`/
      `ratingComparatorDesc` (`lib/library-filter.ts`) are already generic
      over `{ voteAverage: number | null }`, so `RatingFilterPanel.tsx`
      drops in as-is, same as `ReleaseYearFilterPanel.tsx`.

      **Status** needs the same schema/API addition (no `status` field on
      `WatchlistItemMedia` either) plus a genuine design decision James
      flagged 2026-09-21, still open: the generic
      `components/ui/KeyedFilterPanel.tsx` (renamed from the
      single-purpose `StatusFilterPanel.tsx` during the M5 filter-panel
      consolidation, see `docs/TODO_ARCHIVE.md`), which `ShowsPage.tsx`
      now uses (`keys={availableStatuses}`) for status filtering, has only
      ever been used on `ShowsPage.tsx` for shows alone - `MoviesPage.tsx`
      has no status filter at all today, confirmed by grep. Shows and
      movies use completely different TMDB status value sets ("Returning
      Series"/"Ended"/"Canceled"/"Pilot" for shows vs "Released"/"Post
      Production"/"Planned" for movies), and `WatchlistDetailPage.tsx`
      mixes both types in one list. `filterByStatus`'s include-mode logic
      excludes any item whose status isn't in the include list, so
      picking a show-only status (e.g. "Ended") on a mixed watchlist would
      silently hide every movie in the list, and vice versa for a
      movie-only status - not obviously a bug at a glance, but likely to
      look like one. Needs a decision before building, not just a drop-in
      reuse of the existing single-type panel/logic: options discussed
      2026-09-21 were (a) one merged status list across both types, accepting
      that cross-type hiding effect, or (b) type-aware filtering where a
      show-only status leaves movies unaffected (and vice versa), which
      would need new filter logic rather than reusing `filterByStatus` as
      written. James, 2026-09-21: leave the decision open for now rather
      than picking one.

      For all three: extend `WatchlistDetailPage.tsx`'s local `SortKey`
      union and `sortItems` switch (lines 24-38) with `yearDesc`/
      `yearAsc`/`ratingDesc`/`ratingAsc`, wrap the page's `<FiltersPanel>`
      around the three filter panel components (same pattern as
      `ShowsPage.tsx`, minus its genre/dropped/my-rating/watched-year
      panels), add matching sort entries to `LibraryControls`'
      `sortOptions`, and add the new `watchlists.sort*`/filter-panel i18n
      strings in both `en-US` and `en-GB` `common.json`.

- [ ] **Rethink the "add to watchlist" UI on the show/movie detail pages**
      (2026-09-21 added)

      James, 2026-09-21: has been adding shows to a custom watchlist and
      isn't happy with the current UI for it. Two problems: (1) no visual
      indicator on the page for "this title is on one of my custom
      lists", unlike the default list, which does get one; (2) it
      "generally feels clunky" - floated maybe merging the default-list
      button with the custom-list button as one path worth exploring, but
      wants real thought put into this rather than a quick patch.

      Current shape, `WatchlistButton.tsx` (shared by both
      `ShowDetailPage.tsx` and `MovieDetailPage.tsx` - this affects
      movies too, not just shows, since it's one component): a primary
      bookmark-icon button that one-click toggles membership in the
      Default list only (filled/`variant="primary"` when `onDefault` is
      true, otherwise `secondary`), plus a separate icon-only "manage
      lists" button that always renders `variant="secondary"` regardless
      of `myWatchlistIds`, opening a dialog with one checkbox per custom
      list. That second button is where the missing indicator lives: it
      never reflects "already on N custom lists" the way the primary
      button reflects default-list membership.

      This split was itself a deliberate call, not an oversight -
      `WatchlistButton.tsx`'s own doc comment: "James, 2026-08-27: wanted
      single-click for the common case, happy for the rest to need more
      UI." Worth reading before redesigning, since whatever replaces it
      should account for why single-click-for-Default mattered in the
      first place, not just fix the missing indicator in isolation.

      James, 2026-09-21, confirmed explicitly: think about the Movie
      detail page's own UI for this too, not just Show. One shared
      component today, but the two pages don't offer it the same amount
      of surrounding room: `ShowDetailPage.tsx`'s action row carries
      Watched, `+`, Drop, and Watchlist (which itself renders two buttons,
      the bookmark toggle and the manage-lists button), plus Refresh - six
      buttons from five named controls, no separate sort-order control
      (corrected 2026-09-22; none exists on this page) - while
      `MovieDetailPage.tsx`'s has Watched, `+`, Watchlist, and Refresh
      (four named controls, five buttons - no Drop, per the phone-width
      audit TODO above), so a redesign that reads fine in Movie's more
      spacious row could still feel cramped in Show's, or vice versa.
      Check the fix against both pages' actual layouts before calling it
      done, not just against whichever page it was designed against
      first.

      Genuinely open on the shape of a fix - no direction picked yet.
      Possible angles worth considering when this gets picked up: a badge/
      dot on the manage-lists button when `myWatchlistIds` has any
      non-default entries; folding Default into the same
      checkbox-per-list dialog instead of a separate one-click button
      (trading away the single-click precedent above); or a single
      combined control that shows current membership count/state at a
      glance and opens straight into management. Decide with James before
      building, same as the watchlist status-filter question above.

## Auth & accounts

- [ ] **Explain invite-only mode on the Create an account screen** (2026-09-16 added)

      `RegisterPage.tsx` renders the invite code `Field` whenever
      `settings?.registrationMode === 'invite'` (around line 118), but
      nothing on the page says why that field is there or that the
      instance is invite-only at all: the field is just labeled
      `register.inviteCode` ("Invite code") with no surrounding copy.
      Someone landing on the page with no code in hand has no way to tell
      whether it's optional, what it's for, or where to get one.

      `register.closed` and `register.emailNotConfigured`
      (`i18n/locales/*/common.json`) already show this pattern for the
      other two gated states on this same page (registration fully closed,
      SMTP not configured); add a matching string, e.g.
      "This instance is invite-only. You'll need an invite code from an
      admin to create an account," shown above or alongside the invite
      code field only when `registrationMode === 'invite'`.

      James, 2026-09-16: the screen is a bit opaque right now, wants some
      explanatory text added for this case.

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

- [ ] **`resolveSeason`'s runtime upsert only ever fills a null, never corrects a stale one** (2026-09-17 added, not on any milestone)

      Found while fixing the season/episode drift item above (see
      TODO_ARCHIVE.md): `resolveSeason`'s upsert (`apps/api/src/lib/
      media.ts`) writes `runtimeMinutes: coalesce(existing, excluded)` -
      deliberately fill-only, to protect a cross-provider-backfilled value
      from being clobbered by a primary provider that still returns null.
      That reasoning only covers "live value is null"; it doesn't cover
      "live value is non-null but disagrees with what's stored" (a
      provider correcting its own data after the fact), which is exactly
      the case the season route's own new reconciliation step (this
      session) now handles by overwriting only when the live value is
      non-null and different. `resolveSeason`'s callers (the season/show
      "Watched" buttons, Trakt import, `refreshOneShow`'s current/upcoming
      season refresh) could plausibly want the same treatment, but that's
      a separate call site and a separate judgment call from what the
      season-route fix asked for - not changed as part of it.

- [ ] **IMDb ratings on Movies (and maybe TV Shows)** (2026-09-01 13:35 added, shelved 2026-09-01, not on any milestone)

      Would show a rating badge next to the existing plain-text "IMDb"
      link on the detail pages (`MovieDetailPage.tsx`, around line 287 as
      of 2026-09-22, drifted from 276 when this item was first logged;
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

## Backups

- [ ] **Restore automation for the automatic database backup** (2026-09-09 added, narrowed 2026-09-10 x2, split from the "back up now" button 2026-09-16; Not yet scheduled)

      [ADR 0008](adr/0008-database-backups.md) decided restore stays a
      manual shell procedure, on the grounds that it's destructive, rare,
      and deliberate enough that automating it adds risk without adding
      value. James, 2026-09-10: doesn't fully agree with that call
      (recorded in the ADR rather than overridden). The admin panel
      (`DatabaseBackupsPanel.tsx`, shipped 2026-09-10) links out to the
      documented procedure for now; whether to build an actual in-app
      restore path is still open and wants its own decision, not a quick
      follow-on to the manual "back up now" button (shipped 2026-09-17,
      see `docs/TODO_ARCHIVE.md`).

## Security

- [x] **Full structured request logging** (2026-08-29 added, re-homed here 2026-09-14, fixed 2026-09-16; M5)

      The M3 ASVS review (`docs/adr/0007-security-posture.md`,
      `docs/security/asvs-l1.md`) only ever added minimal
      `[security]`-prefixed event logging (`apps/api/src/lib/security-log.ts`),
      not a general request-logging pipeline. Left as a genuine, deliberately
      unclosed gap at the time, but the old Security section this item lived
      in got fully closed out and archived to `docs/TODO_ARCHIVE.md` without
      this one item being carried forward, leaving `asvs-l1.md`'s "Deferred
      items" section pointing at a section that no longer existed. Re-homed
      here 2026-09-14 while scoping the M4 milestone review, so the pointer
      resolves again.

      Fixed 2026-09-16: a new `apps/api/src/middleware/request-log.ts`
      logs one structured line per request (method, redacted path, status,
      duration, user id, ip), hand-rolled rather than `hono/logger` (no
      hook to redact the path before it's formatted). A new
      `lib/redact-path.ts` scrubs webhook/calendar-feed tokens out of the
      path before anything is logged, since those live as URL path
      segments, not headers; see
      [ADR 0007](adr/0007-security-posture.md)'s 2026-09-16 update for why
      that's the load-bearing design constraint. `LOG_FORMAT` env var
      (`json`/`pretty`/`silent`) controls output shape.
      `docs/security/asvs-l1.md` gained V7.1.2-V7.1.4 and V7.2.1-V7.2.2
      rows for this. `lib/security-log.ts` stays a deliberately separate
      stream; see its own updated doc comment.

- [ ] **Add a request/correlation id to the structured request log** (2026-09-16 added; Not yet scheduled)

      Deliberately deferred while building full structured request logging
      (above): `hono/request-id` and `hono/context-storage` are both
      already bundled with the installed Hono version (zero new
      dependency), but nothing in this codebase consumes a correlation id
      today: single container, single process, no trace aggregation. A
      new field is purely additive later (breaks no existing log
      consumer), so there was no reason to build the plumbing ahead of an
      actual need.

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
            consent-based attribution rework). 2026-09-14: fixed a real
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
      - [x] Stage 2: admin & owner-role privilege model. 2026-09-14: no
            findings. Verified `assertNotLastAdmin`'s row-lock genuinely
            closes the concurrent-demotion race (same transaction as the
            write, at every call site), bulk actions re-enforce every
            invariant server-side per item (no separate weaker bulk route),
            `transfer-ownership` re-proves the password and locks the owner
            row before swapping, `GET /admin/users` exposes nothing beyond
            ADR 0007's already-accepted scope, and the password-reset
            trigger never lets an admin see/set another user's password.
            ASVS rows for Stage 7: V4.1.1, V4.1.2, V4.1.3, V4.2.1, V2.5.x,
            all pass.
      - [x] Stage 3: scheduled database backups (verify against ADR 0008).
            2026-09-14: 6 of 7 ADR 0008 claims held exactly; one had
            drifted: the stale-`.partial` cleanup matched any
            `*.partial` file, not just this job's own `rwnd-<ISO>.sql.gz.partial`
            shape, so a human-placed `.partial` file sitting in the bind
            mount for 6h+ would get silently deleted, contradicting the
            ADR's own "can't delete anything it didn't write" claim. Fixed
            with a matching regex, regression test added. Also found and
            logged a new (not ADR-covered) cross-process concurrent-run
            risk; see the item above. Verified container hardening
            (read_only/cap_drop/no-new-privileges) directly against
            docker-compose.yml. ASVS rows for Stage 7: V8.3.x, V12.1.1,
            V14.4.x, pass (V12.1.1 pass only after the fix).
      - [x] Stage 4: calendar feeds & in-app calendar. 2026-09-14: found and
            fixed a real spoiler-protection gap: the .ics feed's SUMMARY
            field always embedded the real episode title regardless of
            spoilerProtectionEnabled, the one field on a calendar event an
            .ics subscriber can't avoid seeing (DESCRIPTION was already
            correctly omitted for the same reason). Fixed by reusing
            episodeSummary()'s existing null-title branch; regression test
            added. Verified the token-in-URL rate limit, `Cache-Control:
            no-store`, no token logging anywhere, and the `ENCRYPTION_KEY`
            503 gate are all genuine, not just documented. ASVS rows for
            Stage 7: V2/V3 (token pattern), V9.1.x (no-store), pass;
            V8.2.x/V8.3.x and new V11 (spoiler invariant across every
            surface, not just ones with a client to blur with), pass, but
            only after today's fix.
      - [x] Stage 5: Webhooks panel redesign & token-encryption posture
            change. 2026-09-14: found and fixed two real gaps. First,
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
            (Stored Cryptography), pass, grounded in this stage's crypto
            review; V4.1.x (cross-user access), pass.
      - [x] Stage 6: supply-chain, CI & dependency hygiene. 2026-09-15: no
            code findings. `.github/workflows/{ci,codeql,release}.yml`,
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
            code scanning) and deliberately left it off, since that's more
            process than a solo-maintainer direct-push repo needs. Confirmed
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
            (Malicious Code), pass, grounded in this stage's review
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

- [x] **URL-encode external ids interpolated into TMDB/TVDB request paths** (2026-09-14 added, Stage 1 of the M4 review, fixed 2026-09-16; M5)

      `providers/tmdb.ts` and `providers/tvdb.ts` build request paths like
      `` `/tv/${externalId}` `` and `` `/series/${externalId}/extended` ``
      with no `encodeURIComponent`, for every provider client call, not
      just the webhook-driven ones. `externalId` for a webhook-triggered
      lookup ultimately traces back to attacker-controlled webhook payload
      content (Plex's `Metadata.Guid[].id`, Tautulli's templated fields,
      etc.; anyone holding a valid webhook token controls the full body,
      not just legitimate media-server data), so a crafted id containing
      `/` or `..` could redirect the request to a different TMDB/TVDB API
      path than intended. Narrow in practice: same fixed host, this
      server's own API key, no cross-host redirection possible, and
      `/security-review`'s own scope explicitly excludes path-only SSRF,
      but cheap to close with `encodeURIComponent(externalId)` at each call
      site. Touches the shared provider-client layer (also used by
      ordinary search/browse, not just webhooks), so it's its own
      follow-up rather than a Stage 1 inline fix.

      Fixed 2026-09-16: a new `apps/api/src/providers/api-path.ts` tagged
      template (`` apiPath`/tv/${externalId}` ``) encodes every
      interpolated value while leaving the template's own `/` separators
      alone, applied uniformly at all 16 interpolation sites across both
      provider files (including two already-provider-trusted numeric ids,
      for consistency rather than a per-site judgement call).

- [x] **`serializeCalendarFeed` still 500s on a since-rotated `ENCRYPTION_KEY`** (2026-09-14 added, Stage 5 of the M4 review, fixed 2026-09-16; M5)

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

      Fixed 2026-09-16: chose the nullable-wire-type fork, not the
      operational stance. Rotating `ENCRYPTION_KEY` doesn't affect
      `tokenHash`, so every already-subscribed calendar app keeps working
      regardless; only re-display breaks, and the existing Regenerate
      button already recovers that. `CalendarFeed.token` is now
      `z.string().nullable()`, `serializeCalendarFeed` and `serializeToken`
      both now go through a new shared `tryDecryptSecret` (lib/crypto.ts),
      and `FeedRow` (`CalendarFeedsPanel.tsx`) shows a "regenerate to get a
      new URL" message in place of the URL/Copy/Subscribe block when
      `token` is null, mirroring `WebhookCard.tsx`'s existing precedent.

- [x] **`trakt.ts`'s `ensureFreshAccessToken` gives a cryptic error on a rotated `ENCRYPTION_KEY`** (2026-09-15 added, M4 review's milestone-wide `/code-review high` pass, fixed 2026-09-16; M5)

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

      Fixed 2026-09-16: did both. A new `TraktReconnectRequiredError`
      wraps the two unguarded decrypts, caught in `runImportJob`'s
      existing catch to store a friendly reconnect message on the job
      **and** delete the `traktConnections` row, so the Import page's
      connect card flips back to "connect your account" on its next poll
      with no new endpoint needed. A genuine Trakt API error during
      refresh still surfaces as itself, unaffected.

## Roadmap

Every open item from [ROADMAP.md](ROADMAP.md) that doesn't already have a
more specific TODO elsewhere in this file. Kept brief: ROADMAP.md is the
source of truth for scope; this is just so a TODO listing is complete.

- [ ] **Kodi webhook ingestion** (2026-08-24 16:25 added, un-M2'd 2026-08-24, M4'd 2026-08-28, scoped down 2026-09-11, Tautulli split off 2026-09-14, un-M4'd 2026-09-16; Not yet scheduled)

      Tautulli shipped 2026-09-14 (see `docs/TODO_ARCHIVE.md`), leaving
      Kodi as the only source left on what was originally "Tautulli/Kodi
      webhook ingestion." Kodi has no native webhook support at all, so
      it needs an addon-based approach rather than a plain payload
      parser, most likely a small service addon shipped and distributed
      from this repo rather than a config paste.

      M4 closed `✅ done` 2026-09-15 without this item; the `M4` tag went
      stale at that point and is corrected here rather than left pointing
      at a closed milestone. Worth a deliberate call during M5 scoping on
      whether Kodi belongs in M5 or stays unmilestoned again.

      James, 2026-08-24: not needed to close out M2. ROADMAP.md's own M2
      "Plex webhook ingestion" bullet only ever mentioned these in
      passing as future work, not as a separate required checkbox, so
      this was over-tagged M2 when first added. Left unmilestoned rather
      than reassigned to M3; no strong reason it belongs there either.

- [ ] **Stats and insights** (2026-08-23 15:32 added, un-M3'd 2026-08-26, M6'd 2026-09-16; M6, tentative)

      The reason to log anything in the first place, but not essential to
      the core logging loop M3 was narrowed to (2026-08-26, see
      ROADMAP.md's M3 framing).

      James, 2026-09-16: pencilled in as M6 while scoping M5, but not set
      in stone, just how the milestones are shaping up in his head right
      now.

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

- [ ] **Configurable or optional landing page for self-hosted instances** (2026-09-17 added, status strip count corrected 2026-09-22; Not yet scheduled)

      `LandingPage.tsx` (route `/`) is deliberately rwnd.tv's own marketing
      page: the self-host CTA, GitHub/vision.md links, the M1-M5 status
      strip (M1-M4 as of when this item was added; M5 shipped since), the
      "Built with Claude Code" note, all specific to this
      project's own identity and positioning (see CLAUDE.md's "Public-
      facing design surfaces" section). James, 2026-09-17: that's right
      for rwnd.tv itself, but a self-hoster running their own instance
      (e.g. for family/friends) might want something else entirely, or
      nothing at all - just landing straight on Sign In / Create an
      account, skipping the marketing content altogether.

      Genuinely open on the shape of a fix, worth exploring rather than
      just picking one: an admin-editable instance setting (same pattern
      as `instanceName`/`registrationMode`) that swaps `/` for a minimal
      auth-only screen; a setting that lets an admin write their own
      hero/features copy in place of rwnd.tv's; or something else. Any of
      these needs a decision on how much stays fixed (layout, self-host
      messaging that assumes this is *the* rwnd.tv project) versus
      genuinely swappable per instance.

- [ ] **Consider federation (ActivityPub/AT Protocol) for cross-instance social features** (2026-09-20 added; Not yet scheduled)

      Surfaced from an r/TraktRejects thread ("Self-hosted federated
      alternatives?",
      reddit.com/r/TraktRejects/comments/1wldavj/selfhosted_federated_alternatives)
      asking whether any self-hosted Trakt alternative also federates, so
      reviews/ratings/lists could be shared across independently-run
      instances rather than staying siloed to each instance's own users.
      rwnd.tv already covers the per-instance social basics (lists,
      ratings) but has no cross-instance story, the same gap the OP called
      out in every self-hosted option they'd tried.

      Two projects came up in the thread as prior art, both built on the
      AT Protocol (the protocol behind Bluesky) rather than ActivityPub:
      Popfeed.social and Opnshelf.xyz, both described by a commenter (who
      is themselves building on the same protocol) as MVP-stage. A
      separate commenter mentioned building their own scrobbling-focused
      alternative, "Scrob." The OP specifically noted neither Popfeed nor
      Opnshelf mentions scrobbling through media servers, which is exactly
      rwnd.tv's core strength already shipped (the multi-user-aware
      Plex/Jellyfin/Emby/Tautulli webhook ingestion work, see
      `docs/TODO_ARCHIVE.md`).

      No decision made here, just capturing the idea and the competitive
      landscape context: worth a deliberate look at ActivityPub vs. AT
      Protocol tradeoffs if/when federation is seriously considered, and
      worth keeping an eye on how Popfeed/Opnshelf/Scrob develop given the
      overlap.

