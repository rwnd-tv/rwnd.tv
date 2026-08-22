# TODO Archive

Completed items moved out of [TODO.md](TODO.md), same format and
grouping, sorted oldest to newest.

## Repo hygiene

- [x] **Review Dependabot PRs** (2026-08-09 20:40)\
      8 open, incl. `node` 22→26-alpine again — that exact bump broke
      the Docker image build silently last time
      (`corepack: not found`); confirm the `docker build .` CI step
      actually catches it before merging. Done: fixed the Dockerfile
      (corepack is no longer bundled with Node ≥25, install it
      explicitly) and merged 8 PRs; #7 stays open, blocked on TS 7.

## Open questions / not yet decided

- [x] **Local dev-loop** (2026-08-09 20:40)\
      Decide whether to restand a dedicated dev Postgres +
      `pnpm dev:api`/`dev:web`, or keep testing against `dev.rwnd.tv`
      as the default. Done: installed Docker Engine in WSL2 (Ubuntu, no
      Docker Desktop), enabled mirrored networking + `vmIdleTimeout=-1`
      in `.wslconfig`, and a dev-only Postgres container
      (`network_mode: host` — Docker's port-publishing NAT doesn't work
      reliably under mirrored networking, host mode sidesteps it; the
      compose file itself is kept local at `~/rwnd-tv-dev/` inside WSL,
      not in the repo). Confirmed working end to end with a real login.

## TV Shows / Movies gallery follow-ups

- [x] **Gallery nav overflow on narrow viewports** (2026-08-19 15:25)\
      Adding TV Shows/Movies brought the header nav to 7 items, wrapping
      on narrow viewports. Done (2026-08-20): replaced the horizontal nav
      entirely with a collapsible sidebar (`Sidebar.tsx`) under a
      full-width top bar — no wrapping regardless of item count.

- [x] **Status filter section on the Shows gallery** (2026-08-21 01:15)\
      A new filter section for `shows.status` (TMDB's raw string —
      "Returning Series", "Ended", "Canceled", etc., see
      `apps/api/src/metadata/refresh.ts`), same shape as the existing
      Genre/Released/Watched sections in `WatchedYearFilterPanel.tsx` /
      `ReleaseYearFilterPanel.tsx` / `GenreFilterPanel.tsx`. Done
      (2026-08-21): added `status` to `libraryShowSchema`/`GET
/library/shows`, `filterByStatus`/`collectStatuses` in
      `library-filter.ts`, and `StatusFilterPanel.tsx` (mirrors
      `GenreFilterPanel.tsx`'s include/exclude icon-button UI, applied to
      a single-valued field instead of an array). TMDB doesn't localize
      `status`, so it's translated client-side via
      `shows.filtersPanel.statusValues.*` (en-GB/fr-FR), with a raw-string
      fallback for any status value not yet in that map.

- [x] **Three-state "Unknown" toggle in the Watched filter section** (2026-08-21 01:20)\
      `WatchedYearFilterPanel.tsx`'s "Unknown" checkbox is binary today
      (include/exclude unknown-dated shows alongside the After/Before
      range). Want a third state — _only_ unknown-dated shows, hiding
      everything else regardless of the range — using the same
      plus/minus include/exclude button UI as `GenreFilterPanel.tsx`
      rather than a plain checkbox. Semantics differ slightly from
      genre's per-item include/exclude (this is one boolean condition,
      not a set of named items): neutral = show both known (in-range)
      and unknown (today's default), exclude = hide unknown entirely
      (today's unchecked state), include = show _only_ unknown, ignoring
      the range sliders. Done (2026-08-21): `UnknownWatchedMode` (`'neutral'
| 'exclude' | 'include'`) replaces the old boolean in
      `filterByWatchedYear`/`WatchedYearFilterPanel.tsx`, backed by
      `useSortCookie` (already generic over any fixed string union, so no
      new hook needed) under a new cookie name
      (`rwnd_shows_watched_unknown_mode`) rather than repurposing the old
      boolean one. `useBooleanCookie` had no other callers once this
      switched, so it was deleted rather than left unused.

- [x] **TMDB rating on the per-show page, plus a rating filter + sort** (2026-08-21 01:15)\
      Show the TMDB rating on `ShowDetailPage.tsx` (not cached in `shows`
      yet — needs a new column, populated the same way `status`/`genres`
      are via `resolveShow()`/the metadata refresher). Then a rating
      filter section on the Shows gallery (range slider, same pattern as
      Released/Watched) and a couple of new sort options
      ("Rating (Descending)"/"(Ascending)"). Done (2026-08-21): new
      `shows.vote_average` column (migration `0005_busy_havok.sql`),
      `ProviderShow.voteAverage` (TMDB's `vote_average`, treated as null
      when `vote_count` is 0 rather than showing a bogus 0/10), wired
      through `resolveShow()` and the metadata refresher (with its own
      "never populated" backfill clause, same reasoning as the `genres`
      one). `RatingFilterPanel.tsx` (Min/Max range sliders, 0.1 step,
      one-decimal display) plus `ratingRange`/`filterByRating`/
      `ratingComparatorAsc`/`ratingComparatorDesc` in `library-filter.ts`.
      Shown on `ShowDetailPage.tsx`'s header line, originally as a plain
      "★ 8.3". Swapped the star for TMDB's own logo per James's request
      (2026-08-21, matching the source-attributed rating chip style Trakt
      uses for IMDb/RT/Metacritic) — linked directly from TMDB's CDN
      (`themoviedb.org/assets/2/v4/logos/v2/blue_short-...svg`, the same
      "short" mark README.md already uses for the required attribution
      footer) rather than a bundled/cropped copy, since TMDB's attribution
      terms require their logo used unmodified. Their brand page
      (`themoviedb.org/about/logos-attribution`) doesn't offer a bare
      icon-only mark, only full wordmark/lockup variants — the compact
      "short" one was the closest fit to an inline badge. Then made that
      logo a link to the show's own TMDB page (James, 2026-08-21) —
      `/library/shows/{slug}` now also looks up the show's `tmdb` row in
      `external_ids` and returns it as `tmdbId`
      (`showDetailSchema`/`libraryShowSchema`), linking to
      `themoviedb.org/tv/{tmdbId}` when present.

- [x] **TV Show Season pages** (James, 2026-08-21)\
      Season cards on `ShowDetailPage.tsx` were plain, non-clickable —
      James wanted a season detail page styled after Plex's own season
      view (screenshot shared): a header (poster, title, progress) above a
      grid of episode thumbnail cards, each with a still image and a
      checkmark toggle to mark watched/unwatched directly from the grid.
      New `GET /library/shows/{slug}/seasons/{seasonNumber}` fetches the
      episode list live from the provider every request (unlike the show
      itself, there's no local table of every episode — only ones actually
      logged, via `resolveEpisode`) and merges in the current user's watch
      status; widened `ProviderEpisode`/TMDB's `getSeason()`/`getEpisode()`
      to also carry `overview`/`stillPath`, fetched for free on the same
      call but not kept before. New `SeasonDetailPage.tsx`
      (`/shows/{slug}/season/{seasonNumber}`) reuses `PosterGrid` with
      `aspect-video` stills instead of posters; each episode is its own
      component so it owns its own watched-toggle mutation independently
      (same shape `SearchResultCard.tsx` already uses). Marking watched
      reuses `POST /plays` unchanged (no new endpoint); unwatching is a new
      `DELETE .../episodes/{episodeNumber}/plays` that clears **every**
      logged play for that episode, not just the latest — matches Plex's
      own boolean watched/unwatched toggle (what's being mirrored here)
      rather than a "which of N rewatches" picker; the rewatch count still
      shows next to the toggle so it isn't silently lost.\
      Caught a real, pre-existing bug while testing 404s in the browser
      (not just the mocked test suite): both this new page and the
      existing `ShowDetailPage.tsx` rendered completely blank — no
      spinner, no error message — for a show/season that doesn't exist.
      Root cause: `query-client.ts`'s global retry policy only bailed out
      on 401/403, so a 404 got retried twice before settling; something in
      that retry-then-settle sequence left the query in a state where
      `isLoading`, `error`, and `data` were all falsy at once, so neither
      branch of the loading/error/content chain matched and the component
      fell through to `return null`. Fixed at the source rather than
      patched around: the retry predicate now bails out on any 4xx (not
      just 401/403), since a client error is never worth retrying anyway.
      Verified by reproducing the blank page live on dev.rwnd.tv first,
      then confirming both pages show their proper "not found" message
      once the retry fix was in.

- [x] **Follow-up same day: bigger episode tiles, season blurb** (James, 2026-08-21)\
      `PosterGrid.tsx` gained an optional `minTileWidth` prop (default
      `10rem`, unchanged everywhere else) so the season page's episode
      grid could pass a wider `16rem` without affecting the poster grids
      that share the component. The season's own TMDB synopsis is shown
      too — `MetadataProvider.getSeason()` already fetches the season
      response that carries it, just discarded before; now returns
      `{ overview, episodes }` instead of a bare episode array (the one
      other caller, the Trakt importer's `import/match.ts`, only needed a
      one-line destructure to adapt).

- [x] **Watch-date dialog for marking an episode watched** (James, 2026-08-21)\
      The season page's checkmark toggle always logged "now" — James
      wanted a choice: "Now watching" (now + episode runtime), "Just
      finished" (now), "Release date", "Other date" (calendar + clock +
      a synced free-text field in the user's locale format), or "Unknown"
      (the same 1900-01-01 sentinel already used everywhere else for "I
      don't remember when" — see `HistoryPage.tsx`). No backend change at
      all — `POST /plays`'s `watchedAt` was already an arbitrary optional
      ISO datetime. Built two new reusable primitives rather than pulling
      in a dependency (none existed for either): `components/ui/Dialog.tsx`
      wraps the native `<dialog>` element (`showModal()`/`close()` give
      focus-trapping, Escape-to-close, and backdrop rendering for free —
      had to explicitly re-center it with Tailwind positioning classes
      though, since Tailwind's preflight resets the `margin: 0` the UA
      stylesheet relies on for centering, discovered live on dev.rwnd.tv,
      not in review), and `lib/date.ts` (`formatDateTimeInput`/
      `parseDateTimeInput`, built on `Intl.DateTimeFormat`'s own
      `formatToParts` rather than hardcoding field order, so the free-text
      field parses whatever separators the user types). Verified live:
      logging a custom "Other date" through the dialog in the browser
      round-tripped correctly through local-time entry → UTC storage →
      back out again (typed `17/04/2011, 09:30` in BST, landed in Postgres
      as `2011-04-17 08:30:00+00` — correct, BST is UTC+1).
      `WatchDateDialog.tsx` takes plain episode fields rather than a
      `SeasonEpisode`, so it's reusable for `SearchResultCard.tsx`'s manual
      log-watch flow later — not wired there yet, only asked about for the
      season page this time.

- [x] **Follow-up same day: dialog radios showed no selected state** (James, 2026-08-21)\
      James caught this live: none of the five options ever appeared
      selected, and clicking one didn't visibly move the selection either.
      Root cause: `WatchDateDialog.tsx` renders once per episode card, and
      every card stays mounted (just visually hidden) even when its own
      dialog is closed — all ~24 instances on a season page were giving
      their radios the same literal `name="watchedAtMode"`. Native radios
      are grouped by `name` across the _whole document_, not scoped to
      wherever they're rendered, so every hidden episode's radios were
      silently fighting the visible dialog's radios over one page-wide
      group. Fixed with `useId()` to scope each dialog's group to itself.
      Verified by reopening the dialog on dev.rwnd.tv and confirming a
      clicked option now stays visibly selected.

- [x] **Second follow-up same day: always-visible date/time preview, reordered options** (James, 2026-08-21)\
      Two requests: the date/time text field should stay visible above
      Cancel/Log watch for every mode, not just "Other date" — read-only
      for the other four — and "Unknown" should sit above "Other date" in
      the list. The read-only field now previews exactly what each mode
      would log if confirmed right now (computed once when that mode is
      selected, not a live-ticking clock, so "Now watching"/"Just
      finished" don't drift while the dialog just sits open); "Unknown"
      shows the localized word itself rather than the fabricated
      1900-01-01 date, since displaying that as if it were a real
      timestamp would be misleading. `otherDate`/`otherText` state was
      renamed `previewDate`/`previewText` to reflect that it now backs
      every mode's preview, not just "Other date"'s editable value — and
      `handleConfirm` collapsed to two branches (`unknown` → the sentinel,
      everything else → `previewDate.toISOString()`) now that the other
      three computed modes feed the same state instead of being
      recalculated separately at confirm time.

- [x] **Third follow-up same day: reordered options, hid the obvious field labels** (James, 2026-08-21)\
      "Just finished" moved above "Now watching" (stays the default
      selection — it already was). Confirmed with James that TMDB doesn't
      expose an air _time_, only an air date, so "Release date" staying
      midnight-UTC-only is correct, not a gap to fill. The three Date/
      Time/Date-and-time field labels were removed from view — James found
      them self-explanatory — via `Field.tsx`'s existing `hideLabel` prop
      (already built for exactly this: keeps the label in the
      accessibility tree for screen readers, just hides it visually),
      rather than dropping the labels from the markup entirely.

- [x] **Fourth follow-up same day: bound "Other date" to a sane range** (James, 2026-08-21)\
      Nothing stopped "Other date" from logging a watch before the episode
      aired or in the future. New `clampDate(date, min, max)` in
      `lib/date.ts` — `min` is the episode's air date (`null`, i.e.
      unbounded, when it isn't known), `max` is "now" plus the episode's
      runtime (the same value "Now watching" computes), both recomputed
      fresh on every render rather than cached in state so `max` doesn't
      go stale while the dialog sits open. Applied at every point a value
      can enter `previewDate`: the calendar/clock inputs (which also get
      `min`/`max` HTML attributes so the native date picker greys out
      invalid days), a successful free-text parse, and defensively again
      at confirm. The free-text field itself is deliberately **not**
      overwritten when a typed value gets clamped — same "never fights the
      user mid-keystroke" reasoning as the existing parse-failure
      handling, so what's on screen always matches what was typed even
      though the value actually submitted is the clamped one. Verified on
      dev.rwnd.tv against real Postgres rows: typing a 2005 date for an
      episode that aired in 2010 landed as the exact air-date timestamp;
      typing a 2030 date landed as the exact "now" timestamp.

- [x] **Fifth follow-up same day: confirm before clearing an episode's watch history** (James, 2026-08-21)\
      Clicking the checkmark on an already-watched episode un-watches it
      immediately — and since that clears _every_ logged play for the
      episode at once (see the original Season pages entry above), a
      misclick on a rewatched episode silently lost real history with no
      way back. New `UnwatchConfirmDialog.tsx`, reusing the `Dialog`
      primitive, gates it behind a confirmation: "Are you sure you want to
      remove this watch?" plus the one date/time when there's a single
      play, "...remove all these watches?" plus one line per date
      (newest first) when there's more than one — exact copy and layout
      James specified. Needed a new backend endpoint,
      `GET .../episodes/{episodeNumber}/plays`, since the season list
      response only ever carried `watchedCount`/`lastWatchedAt`, not every
      individual timestamp; fetched lazily (`enabled: unwatchConfirmOpen`
      in the frontend query) only while the dialog is actually open, since
      most episodes have at most one play and listing every episode's full
      watch history on every season page load would be wasted work. The
      dialog's title/button copy ("Remove" vs "Remove all watches")
      switches on `episode.watchedCount` alone, already known instantly
      from the season data — only the date list itself waits on the
      fetch, with a spinner in the meantime. Verified live on dev.rwnd.tv:
      seeded three plays on one episode directly in Postgres, confirmed
      the dialog listed all three dates correctly, and confirmed "Remove
      all watches" cleared all three (episode back to unwatched, not just
      down to two).

- [x] **Sixth follow-up same day: unwatch dialog title could disagree with its own date list** (James, 2026-08-21)\
      James caught the confirmation title showing "remove this watch"
      (singular) while the dialog's own list below it showed three dates.
      Root cause: the title's singular/plural decision used
      `episode.watchedCount` from the season list's cached query, while
      the date list itself came from a separate live fetch
      (`api.library.episodeWatches`) — the two could disagree whenever the
      cached count hadn't caught up with reality yet. Fixed by having the
      title trust the live-fetched list's actual length once it's loaded,
      falling back to the (possibly stale) cached count only for the
      instant it takes that fetch to resolve — `UnwatchConfirmDialog`'s
      prop renamed `watchedCount` → `watchedCountHint` to make that
      "best-effort guess, not the source of truth" role explicit.

- [x] **"Clear database" panel on Settings** (James, 2026-08-21)\
      A new "Database" card on the Settings page — checkboxes for Watch
      history/Ratings/Watchlists/Dropped shows, a red "Clear database"
      button, and a confirmation dialog listing exactly the categories
      checked before anything is deleted. Scoped to the current user's
      own data only, not an instance-wide admin action: every one of the
      four tables (`plays`/`ratings`/`watchlist_items`/`dropped_shows`)
      already has its own `user_id` column, so `POST /account/clear-data`
      (new `apps/api/src/routes/account.ts`, deliberately separate from
      `auth.ts`'s identity/session routes and `settings.ts`'s
      instance-admin-only ones) just needs `requireAuth`, not
      `requireAdmin` — same tier as the existing Profile/API-tokens
      panels, unlike the admin-gated Instance settings panel below it.
      Wrapped in a single `db.transaction()` so a multi-category clear
      can't partially apply. Confirmation dialog reuses the `Dialog`
      primitive and `UnwatchConfirmDialog.tsx`'s exact shape (title, a
      list of only what's actually being removed, Cancel/destructive
      footer). Verified for real on dev.rwnd.tv rather than just in
      review, given how irreversible this is — checked with James first,
      then cleared just "Dropped shows" (cheapest to re-import
      afterward): confirmed `dropped_shows` went to 0 rows in Postgres
      and a previously-dropped show's page correctly flipped back to
      showing "Drop" instead of "Dropped"/"Undrop".

- [x] **Seventh follow-up same day: item counts next to Database checkboxes** (James, 2026-08-21)\
      Each checkbox in the new Database panel now shows its category's row
      count, e.g. "Watch history (10878)". New `GET /account/data-counts`
      (same `apps/api/src/routes/account.ts`, `requireAuth`-only like
      `clear-data`) runs a `count(*)` per table via the established
      `sql<number>\`count(*)\`.mapWith(Number)`pattern from`library.ts`.
`droppedShows`'s count matches exactly what a clear would delete —
every row ever touched by a manual toggle or Trakt import, not just
currently-dropped shows, since a row can have both
`traktDropped`/`manualDropped` null after reconciliation and still
      exist. Counts also appear in the confirmation dialog's list, next to
      each checked category. Verified live on dev.rwnd.tv against James's
      real dev-account data (Watch history 10878, Ratings 0, Watchlists 1,
      Dropped shows 0) and confirmed the dialog shows the matching count
      when a category is checked — cancelled rather than confirming, since
      no fresh go-ahead was given for another real deletion this round.

- [x] **Per-user database backup/restore** (James, 2026-08-21)\
      A "Backups" section added to the Database panel — a "Backup database"
      button prompting for a description, a list of backups with
      date/description/counts, and Restore/Delete per backup. Per-user
      scope only (watch history/ratings/watchlist/dropped shows), same as
      Clear database beside it. Design settled through several rounds of
      back-and-forth: backups are files, not table rows, so a copy can
      leave the server; entries are identified by TMDB id (plus
      season/episode number) rather than rwnd.tv's own row UUIDs, since
      those only exist on the database that generated them; the file
      carries its own show/movie/season/episode metadata alongside, so
      restoring onto a database that's lost that metadata (a rebuilt
      server, or a user who never imported from Trakt) still works —
      `resolveShow()`/`resolveEpisode()` (`apps/api/src/lib/media.ts`)
      already only hit TMDB on an `external_ids` miss, so restore reuses
      that same "create from what's given" path instead of ever calling
      the provider. New `apps/api/src/backup/{build,restore,paths}.ts` +
      thin HTTP layer in `routes/backups.ts` (`GET/POST /backups`,
      `POST /backups/{id}/restore`, `DELETE /backups/{id}`, all
      `requireAuth`); restore runs in one `db.transaction()`, wiping and
      rewriting the four tables with no merge, matching Clear database's
      own semantics exactly. Gated behind a new optional `BACKUP_DIR` env
      var (`instanceSettingsSchema.backupsConfigured`, same pattern as
      `traktConfigured`) — commented out by default in `docker-compose.yml`
      so existing deployments are unaffected until a self-hoster opts in
      (see `docs/self-hosting.md`'s expanded Backups section). 5 new tests
      in `apps/api/src/test/backups.test.ts` (round-trip through clear,
      restore after deleting the metadata rows entirely, path-traversal
      rejection on `{id}`, cross-user isolation) — full 69-test suite run
      locally against a throwaway Postgres (matching CI's setup, kept
      strictly separate from James's real dev database) before deploying.
      Also fixed `resetDb`'s `TABLES` list in `test/helpers.ts`, missing
      `dropped_shows` (harmless in practice — cascades via `shows` — but
      now explicit). Deployed to dev.rwnd.tv: added `BACKUP_DIR` +
      a bind-mounted `./rwnd-tv-dev/backups` volume to the server's
      `rwnd-tv-dev` service (backed up `docker-compose.yaml` first,
      `docker compose config --quiet` validated, host directory chowned
      to the container's `rwnd` uid/gid via a throwaway root container
      since the SSH user has no passwordless sudo). Verified for real:
      backed up James's actual dev account (10,878 plays, 562 movies, 477
      shows, ~3.1 MB, 0 skipped), confirmed the file's structure and
      on-disk size, then ran one real restore — Postgres row counts
      identical before/after, a show's page (A Certain Magical Index)
      still showed all 74/74 episodes and the correct per-season progress
      afterward — and confirmed Delete removes the file from disk.

- [x] **Follow-up: human-readable backup directory names** (James, 2026-08-21)\
      Backup files were being written under `${BACKUP_DIR}/<userId>/`, a
      raw UUID with no way to tell whose backups you're looking at from
      the filesystem. James asked to use "the username" instead, noting
      it's unique by definition — there's no separate username field
      (`packages/db/src/schema.ts`'s `users` table has only `email`,
      unique, and `displayName`, not unique and user-editable), so
      `email` is the identifier that actually fits: unique, and — checked
      before relying on it — not editable anywhere in the app today
      (`updateProfileRequestSchema` only covers displayName/locale/
      timezone/theme). New `sanitizeEmailForPath()` in
      `apps/api/src/backup/paths.ts` percent-escapes anything outside
      `[A-Za-z0-9@._+-]`, so an ordinary email passes through unchanged
      as the directory name, but stays injective (no two emails can ever
      collide on the same escaped path, preserving the per-user isolation
      guarantee) against the one real edge case: Zod's `.email()` doesn't
      rule out RFC 5322's unquoted local-part allowing a literal `/`.
      `backupUserDir`/`backupFilePath` and all four routes in
      `routes/backups.ts` switched from `user.id` to `user.email` for
      path purposes only — `userId` is unchanged everywhere it's used to
      scope an actual database row. Full 69-test suite re-run against a
      throwaway Postgres to confirm cross-user isolation still holds.
      Redeployed to dev.rwnd.tv; found two backups already sitting under
      the old UUID directory that James had apparently made independently
      while trying out the feature ("Test", "Test 2") — migrated them
      into the new `james.bulman@rwnd.tv` directory (`chown`ed back to
      the container's uid/gid) rather than discarding them, confirmed
      both still list correctly in the panel afterward.

- [x] **Follow-up: backup filenames include the description** (James, 2026-08-21)\
      Individual backup files were named just `<timestamp>-<hex>.json` —
      unique, but unrecognisable in a directory listing. `slugify()`
      (`apps/api/src/lib/slug.ts`, previously only used for show URLs)
      exported and reused for an optional `--<slug>` suffix on the id,
      e.g. `20260821T204512Z-cfa968da--before-trakt-reimport.json`. The
      slug is capped at 50 characters and dropped entirely (no dangling
      `--`) when the description has nothing sluggable, e.g. all
      emoji/punctuation. `BACKUP_ID_RE`
      (`apps/api/src/backup/paths.ts`) and its duplicate,
      `backupIdSchema` (`packages/shared/src/schemas/backups.ts`), both
      widened to accept the suffix, still bounded to `[a-z0-9-]{1,50}` —
      the same strict-allow-list defence against a path-traversal-shaped
      `{id}` route param as before, just wider. Two new tests: the
      round-trip test now asserts the slug appears in the returned id;
      a new test confirms the no-sluggable-content fallback and that a
      200-character description truncates to ≤50. Fixed a real test-hygiene
      gap surfaced while re-running the suite: `apps/api/vitest.config.ts`'s
      shared `BACKUP_DIR` used to be safe to leave dirty between runs only
      because directories were keyed by a fresh random `userId` every
      time — now they're keyed by a handful of literal test emails
      (`owner@example.com` etc.), so a second run in the same session
      found 2 backups where a test expected 1. Fixed in
      `test/backups.test.ts`'s `beforeEach` by `rm -rf`-ing `BACKUP_DIR`
      itself alongside `resetDb()`, not by trying to track which emails
      happen to be in use. Verified twice in a row locally (confirming
      the collision is actually gone, not just not-hit-this-time) before
      redeploying. Live-tested on dev.rwnd.tv with a deliberately hostile
      description (`café/mötley crüe! 🎉` — accents, an emoji, and a
      literal `/`): the panel showed it unchanged, and the file landed as
      `...--filename-slug-check-caf-m-tley-cr-e.json` — no stray
      subdirectory, no crash.

- [x] **Single two-handle range slider for Watched/Rating/Released filters** (2026-08-21 23:00 added)\
      `WatchedYearFilterPanel.tsx`, `RatingFilterPanel.tsx`, and
      `ReleaseYearFilterPanel.tsx` each use two independent sliders
      (After/Before, Min/Max) that can currently be dragged past each
      other. Preferred fix: a single range slider with two handles.
      Fallback if that's not practical: keep two sliders, but instead of
      blocking a drag that would cross the other handle, push that other
      handle out of the way so After can never end up past Before (and
      vice versa) without a stuck-at-the-boundary interaction. Done
      (2026-08-22): built `DualRangeSlider.tsx`
      (`apps/web/src/components/ui/`), one shared component used by all
      three panels (also removing the identical clamp-logic duplication
      they had). Rather than fully custom pointer/keyboard handling, it
      overlaps two native `<input type="range">` elements on one visible
      track — CSS in `index.css` (`.dual-range-input`) hides each input's
      own track and sets `pointer-events: none` on everything but the
      thumb (`::-webkit-slider-thumb`/`::-moz-range-thumb`), so native
      keyboard/touch/screen-reader slider semantics keep working for both
      handles despite the shared track. `z-index` swaps between the two
      inputs based on which value is further from the midpoint, so
      whichever handle still has room to move stays grabbable when they
      meet or overlap. Trade-off: clicking empty track no longer jumps a
      handle there (neither input's track owns that click), only
      dragging/keyboard does. Verified live on `dev.rwnd.tv`: dragging
      each handle, the clamp/push-together behavior at the boundary, the
      z-index handoff when handles overlap, keyboard arrow-key control
      with a visible focus ring on the thumb, and that filtering itself
      still updates the gallery correctly.\
      One real bug caught by James in that live testing: on the Rating
      panel (`min={2.8}`, `step={0.1}`), dragging or arrow-keying the Max
      handle could never actually reach `9.5` — it snapped one step short
      at `9.4`, even though Reset correctly set it to `9.5`. Root cause is
      a floating-point quirk in native `<input type="range">`: the browser
      snaps values by stepping `step` from `min`, and `9.5 - 2.8` isn't an
      exact multiple of `0.1` in floating point, so its own snapping
      arithmetic clamped one step short of the true max instead of
      reaching it — reproducible with a bare native range input, nothing
      to do with the dual-handle overlay itself. Fixed by moving the two
      native inputs onto an integer index space (`min={0}`,
      `max={totalSteps}`, `step={1}`, `totalSteps = round((max-min)/step)`)
      with `toIndex`/`fromIndex` conversions at the boundary — integer
      stepping is always exact, so the true max/min are always reachable
      by drag or keyboard, not just by the initial/reset value.
      `aria-valuemin`/`aria-valuemax`/`aria-valuenow`/`aria-valuetext`
      overrides keep screen readers announcing the real value rather than
      its index. **Lesson: a non-zero, non-`step`-aligned `min` combined
      with a fractional `step` is enough to make native range inputs
      silently drop the last step — worth checking for on any future
      range slider whose domain doesn't start at a round number.**
      Re-verified live after the fix: dragging Max fully right now reaches
      `9.5` both by overshooting past the track edge and by landing
      exactly on it.

## Mobile / responsive

- [x] **Sidebar bottom items hidden behind the mobile address bar** (2026-08-21)\
      James on Android Chrome: with the sidebar open, Import/Settings/Log
      out were cut off behind the browser's address bar, only becoming
      visible once the bar auto-hid on scroll. Root cause:
      `Sidebar.tsx`'s nav was sized with `h-[calc(100vh-4rem)]` — on mobile
      `100vh` is the _largest_ possible viewport (as if the bar were
      already hidden), so the nav always rendered taller than what was
      actually on screen while the bar was showing. Tried `dvh` (tracks the
      real visible viewport) first, but that recalculates continuously as
      the bar animates during a scroll gesture, causing the bottom items to
      visibly resize mid-scroll rather than settle once — a second live
      report from James of the icons "moving up" as a scroll starts, "down"
      once it stops. Tried `svh` (pinned to the smallest viewport) next —
      no mid-scroll movement, but _permanently_ short by the bar's height
      once it auto-hides, so the bottom items sit above a dead gap the rest
      of the time. James preferred `dvh`'s momentary jank during the
      animation over `svh`'s permanently-wrong resting state, so it's back
      to `dvh` — see `Sidebar.tsx`'s doc comment for the full tradeoff.
- [x] **Sidebar icon rail ate too much width on narrow phones** (2026-08-21)\
      With the sidebar "collapsed" (the desktop icon rail), a phone screen
      only had room for a single gallery column — `PosterGrid.tsx`'s
      `auto-fill` grid is meant to fit 2 there. James: below the point
      where an icon rail stops being worth the space, collapsed/expanded
      should mean entirely-hidden/fully-open instead. Below Tailwind's
      `sm` breakpoint (640px), collapsed now renders nothing at all
      (`hidden`, zero layout width) and expanded switches from an in-flow
      column to a `fixed` overlay spanning the same width, floating over
      the content rather than squeezing it. A `Sidebar` `onNavigate` prop
      (wired to Layout's `closeSidebarIfMobile`, which checks the same
      breakpoint via `matchMedia` at click time) closes that overlay after
      a nav link or the logout button is used, so it doesn't stay open
      over whatever page it just navigated to — desktop's expanded rail is
      unaffected and stays open across navigation same as always.

## Per-user show state

- [x] **"Dropped" property on watched shows** (James, 2026-08-21)\
      Mirrors Trakt's own "Dropped" feature — a show partially watched but
      no longer being continued. New `dropped_shows` table (real FK to
      `shows.id`, not polymorphic like `ratings`/`watchlist_items` — Trakt's
      drop concept is shows-only). Two ways to set it, both shipped
      together: a manual Drop/Undrop button on `ShowDetailPage.tsx` (the
      first piece of per-user state settable directly in rwnd.tv — ratings
      and watchlist are still Trakt-import-only), and a 4th Trakt import
      phase (`GET /users/hidden/dropped`, same `history`/`ratings`/
      `watchlist` pipeline shape in `apps/api/src/import/trakt.ts`, reusing
      `matchTraktMediaItem` unchanged since a dropped item is structurally
      just a `type: 'show'` entry). Hidden from the Shows gallery by
      default (`DroppedFilterPanel.tsx`, a tri-state include/exclude/only
      toggle seeded at `'exclude'` rather than `WatchedYearFilterPanel`'s
      `'neutral'` default), with a small red "Dropped" badge on the gallery
      card and a "Dropped" fact + Drop/Undrop button on the show page
      (moved to sit right after the progress bar, per James, rather than
      above the overview).

- [x] **Follow-up same day: manual drop/undrop must survive a re-import** (James, 2026-08-21)\
      James anticipated running more Trakt imports and didn't want them
      silently reverting a manual drop/undrop — the import's original
      `onConflictDoUpdate` blindly overwrote any existing row with
      whatever Trakt currently said. Fixed by adding `dropped` (now a
      real boolean column, not inferred from row presence — an undrop
      updates it to false rather than deleting the row, so "this was
      undone on purpose" survives) and `source` (manual or trakt) to
      `dropped_shows`. The manual routes always set source to manual
      (upgrading a trakt-sourced row if needed); the import's upsert
      gained a Drizzle conditional-update clause on that column, so
      `ON CONFLICT ... DO UPDATE` only fires against rows still sourced
      from Trakt — a manually-touched row is left alone in either
      direction until changed again in rwnd.tv itself. Verified against
      James's real Trakt account on dev.rwnd.tv, not just the mocked
      test suite: seeded a trakt-sourced dropped row for Arcane,
      undropped it manually, ran a real dropped-only re-import (Trakt
      still lists Arcane as dropped) — the row stayed manually-undropped
      while the other 26 shows on the real dropped list still updated
      normally as trakt-sourced. Since none of this had shipped past dev
      yet, the original migration (uncommitted) was regenerated in place
      with the final `dropped_shows` shape rather than layered under a
      second migration — dev's actual table was manually dropped and
      recreated to match (James: fine to lose the dev-only test data for
      a clean start).

- [x] **Second follow-up same day: the manual override never let go** (James, 2026-08-21)\
      James: manually drop-then-undropping a show (or the reverse) didn't
      return it to Trakt's own state, it got permanently stuck as a manual
      override. Root cause: `source` was one flag shared by two different
      questions — "who touched this last" and "should this stay pinned" —
      so once `source` became `'manual'` nothing could ever set it back to
      `'trakt'` short of another Trakt re-import. Fixed by replacing
      `dropped`/`source` with two independently nullable pairs,
      `traktDropped`/`traktDroppedAt` and `manualDropped`/
      `manualDroppedAt` — `manualDropped` is `null` unless the user has an
      active disagreement with `traktDropped`'s current value, and it
      auto-clears back to `null` the moment it stops disagreeing, checked
      both on a manual toggle (`POST`/`DELETE /library/shows/{slug}/dropped`
      in `apps/api/src/routes/library.ts`) and on a Trakt re-import
      (`processDroppedItem` in `apps/api/src/import/trakt.ts`), both via a
      Postgres `CASE` clause referencing the row's other column rather than
      a value read back beforehand. Verified live on dev.rwnd.tv: seeded a
      trakt-dropped row directly in Postgres (no real Trakt account
      involved this time), then drove the real Drop/Undrop button —
      undrop set `manualDropped: false` (an active override, since Trakt
      still disagreed), and dropping it again cleared `manualDropped` back
      to `null` rather than pinning it to `true`. Caught and fixed two bugs
      along the way that only showed up against real Postgres, not the
      mocked unit tests: interpolating a raw `Date` into a `sql` template
      needs `.toISOString()` first (drizzle only converts `Date` → text
      automatically for typed `.values()`/`.set()`, not raw `sql` calls),
      and that string then needs an explicit `::timestamptz` cast inside a
      `CASE` expression, or Postgres refuses the column assignment with a
      type-mismatch error. Since this table still hadn't shipped past dev,
      the migration was regenerated in place again rather than layered,
      same as the fix above.

## Terminology

- [x] **"TV Show" vs "Show" consistency pass** (2026-08-21 23:00 added)\
      Site-wide audit — James wants the full "TV Show" used consistently
      rather than "Show" wherever it currently appears (nav label,
      headings, filter panel copy, etc.), in both en-GB and fr-FR. Done
      (2026-08-22): a full grep of `apps/web/src` for user-facing text
      confirmed every string lives in the two locale JSONs
      (`i18n/locales/en-GB` / `fr-FR`) — no hardcoded copy in components —
      so the pass was scoped to those. The en-GB nav label and page
      heading were already "TV Shows"; the inconsistency was in the rest
      of the copy, still bare "show"/"shows": `shows.filterLabel`
      (a screen-reader-only label via `Field`'s `hideLabel`, not visible
      text, but still in scope), `shows.empty`/`noMatches`/
      `noFilterMatches`, `showDetail.notFound`, `search.placeholder`, and
      three "Dropped shows" strings in `import.start.dropped`/
      `settings.database.droppedShows`/`.backup.description`/
      `.backup.confirmRestoreBody` — 9 keys total, all now "TV show(s)".
      fr-FR was deliberately left untouched (confirmed with James first):
      it already uses "série(s)" consistently everywhere a show is
      mentioned, and unlike English "show" (ambiguous with game
      shows/talk shows/etc., hence needing the "TV" qualifier), "série" is
      already unambiguously a TV series in French — inserting a literal
      "TV" there would just read as redundant. Verified live on
      `dev.rwnd.tv`: the dashboard search placeholder, a 404'd show page,
      an empty-filter-results state, and the Settings > Database panel
      (including the "Dropped TV shows (99)" count) all render the new
      copy in en-GB; switching the account's language to fr-FR and back
      confirmed French renders unchanged throughout.

## Settings page

- [x] **Horizontal rule under each panel's title** (2026-08-21 23:00 added)\
      Every panel on `SettingsPage.tsx` (Profile, API tokens, Database,
      Instance settings) — add a horizontal line under the `<h2>` title,
      before the panel's body content. Done (2026-08-22): a
      `border-t border-[var(--color-border)]` div under each panel's
      `<h2>` in `ProfileForm.tsx`/`TokensPanel.tsx`/`DatabasePanel.tsx`/
      `InstanceSettingsPanel.tsx` — a div rather than a literal `<hr>`, to
      match the border-div pattern `DatabasePanel.tsx`'s own Backups
      section already used for its internal separator. Verified live on
      `dev.rwnd.tv`: all four panels render the rule under their title.

- [x] **Backups section above Clear database** (2026-08-21 23:00 added)\
      In `DatabasePanel.tsx`, reorder so the Backups section renders
      before the Clear database checkboxes/button, not after. Done
      (2026-08-22): swapped the two blocks and moved the
      `mt-8 border-t border-[var(--color-border)] pt-6` top-separator
      styling from Backups (which had it as the second block) onto the
      Clear-database block (now second) — only applied when
      `backupsConfigured` is true, so a self-hoster without backups
      configured still sees Clear database with no stray top border, same
      as before. The panel's own description paragraph ("Permanently
      delete your own tracked data...") moved down with the
      checkboxes/button it actually describes, rather than staying
      pinned under the panel title. Verified live on `dev.rwnd.tv`:
      Backups (with its create button and existing backup list) now
      renders first, Clear database second with a clean separator between
      them.

- [x] **Confirmation dialog on Delete backup** (2026-08-21 23:00 added)\
      Delete currently fires immediately (matches `TokensPanel.tsx`'s
      Revoke button precedent) — James wants a confirm dialog before it
      actually deletes the file, same shape as Restore's existing
      confirmation. Done (2026-08-22): a `deleteTarget` state mirrors
      `restoreTarget`'s existing pattern exactly — the list row's Delete
      button now opens a confirm `Dialog` instead of calling
      `deleteBackup.mutate()` directly, with new `confirmDeleteTitle`/
      `confirmDeleteBody` keys in both locales (fr-FR included, unlike
      the terminology-pass item above — this is app behavior/copy
      parity, not the English-specific "TV Show" wording question).
      Verified live on `dev.rwnd.tv` with a real throwaway backup: Delete
      opens the dialog without deleting, Cancel closes it leaving the
      backup in the list untouched, and confirming actually deletes it
      and refreshes the list.

## TV Show pages

- [x] **Previous/next season navigation on the season page** (2026-08-21 23:00 added)\
      `SeasonDetailPage.tsx` — add `<`/`>` buttons to jump to the
      previous/next season without going back through the show page.
      Done (2026-08-22): chevron `Button`s, disabled at either end of
      `show.seasons` — already ordered by `seasonNumber` ascending
      server-side (see `apps/api/src/routes/library.ts`), specials (`0`)
      included, so adjacent array entries are exactly the previous/next
      season with no extra sorting needed. Navigates via `useNavigate()`
      rather than a `Link`, since the target season number is only known
      once `show.seasons` has loaded. Verified live on `dev.rwnd.tv`
      against True Blood (Specials + 7 real seasons): clicking through
      updates the poster/title/overview/episode grid correctly, `‹` is
      disabled on Specials and `›` is disabled on Season 7, and a direct
      URL landing on either boundary (not just navigating there from the
      show page) renders the same disabled state.\
      Follow-up (James, same day): moved from flanking the `<h1>` to the
      top-right corner of the page (their own row, `justify-between`
      against the "← {show}" back-link so both stay pinned to their
      corners regardless of whether `show` has loaded yet), and switched
      from the `ghost` Button variant to `secondary` for a visible
      border/background — `ghost` read as too subtle for a persistent
      nav control. Checked for horizontal overflow at a ~500px viewport
      via `document.documentElement.scrollWidth` vs. `window.innerWidth`
      after the reflow, since the button row's `shrink-0` group sits
      opposite a `w-fit` link with no explicit wrap handling — confirmed
      no overflow.

- [x] **"Watched" button must not log or count unaired episodes** (2026-08-22 13:00 added)\
      Two related bugs in the "Watched" button on both
      `ShowDetailPage.tsx` and `SeasonDetailPage.tsx`, for a currently-
      airing show. Done (2026-08-22): 1. `logMissingWatches`
      (`apps/api/src/routes/library.ts`) now excludes any episode with
      no or future `firstAired` before logging plays, in both the
      user-picked-date and `useReleaseDate` modes, for both the show-
      and season-level "mark watched" routes. 2. The purple/"fully
      watched" button state now compares watched count against what's
      actually aired, not the eventual total. Season page
      (`SeasonDetailPage.tsx`): a client-side filter over the episode
      list's existing `firstAired` field, since that page already
      fetches live per-episode air dates. Show page
      (`ShowDetailPage.tsx`): needed real data first, since the cached
      `seasons.episodeCount` is TMDB's eventual/planned total with no
      per-episode air dates behind it — added a new `airedEpisodeCount`
      column on `seasons`, computed by the metadata refresher
      (`apps/api/src/metadata/refresh.ts`): a past season, or any
      season once the show itself has finished, is assumed fully aired
      (no extra fetch); only a still-airing show's _current_ season
      gets one extra `getSeason()` call per refresh to count real
      aired episodes. Surfaced as a new `airedEpisodes` aggregate on
      `showDetailSchema`, deliberately separate from `totalEpisodes` —
      the progress bar still shows the eventual total, only the
      button's purple state changed, per the original note that these
      were separate questions. Backfilled via a new "never had an
      aired-count computed" refresher clause (same pattern as the
      existing genres/voteAverage backfill clauses), so existing shows
      pick it up on their next pass rather than staying null forever.

## Season pages

- [x] **Subheading with year, TMDB score, and TMDB link** (2026-08-22 12:00 added)\
      `SeasonDetailPage.tsx` should get the same subheading treatment
      `ShowDetailPage.tsx` already has: the year the season's first
      episode aired, the TMDB review score badge, and a link out to
      the TMDB _season_ page specifically. Done (2026-08-22): year
      derived client-side from the season's existing `airDate`; the
      TMDB score needed a new `voteAverage` field threaded through
      `ProviderSeason`/`TmdbProvider.getSeason()` (TMDB's season
      response carries its own `vote_average`, separate from the
      show's) and `seasonDetailSchema`, with a `season.seasonNumber`
      appended to the show's TMDB URL for the link
      (`themoviedb.org/tv/{tmdbId}/season/{seasonNumber}`). A season
      `vote_average` of exactly 0 is treated as unrated rather than a
      real zero score, same reasoning as the show-level field but
      more important here since TMDB's season response carries no
      `vote_count` to disambiguate a genuine 0 from "no votes yet."
      Verified live on `dev.rwnd.tv`: Ahsoka Season 1 shows "2023 ·
      TMDB 6.8" linking to `themoviedb.org/tv/114461/season/1`, and
      its Specials season (TMDB has no votes for it) shows just
      "2024" with no rating badge or stray separator.\
      Follow-up (James, same day): asked why a single-season show's
      season score differs from its show score
      (`themoviedb.org/tv/296286`) — not a bug. TMDB tracks the show
      and each season as separate rated entities with independent
      vote pools, confirmed live (that show's `voteAverage` was 8.96
      for the show vs. 8.1 for Season 1). Also found TMDB's own
      website no longer shows the classic `vote_average` at all — it
      now shows a newer "Content Score"/"Vibes" percentage (94% show
      vs. 81% Season 1 for that same title), a different metric
      entirely from the API field this app reads, so the numbers
      shown on TMDB's site were never going to match rwnd.tv's either
      way.
