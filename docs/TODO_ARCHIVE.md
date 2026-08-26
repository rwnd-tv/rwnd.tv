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

- [x] **Manual "refresh metadata" button** (2026-08-19 15:25, done 2026-08-23)\
      Done: a small icon-only button (circular-arrow icon, next to Drop)
      on `ShowDetailPage.tsx`, calling a new
      `POST /library/shows/{slug}/refresh`. Reuses
      `apps/api/src/metadata/refresh.ts`'s existing `refreshOneShow()`
      (exported for this, previously module-private) rather than writing
      a second fetch-and-upsert path — a manual refresh gets exactly the
      same result the background sweep would eventually give it, not a
      lesser/different one. Disabled (with an explanatory tooltip) when
      the show has no TMDB id, same condition the Watched/+ buttons
      already check; on success, invalidates the show-detail and gallery
      queries (a refresh can touch almost any cached field — title,
      poster, genres, season counts — so a real refetch is simpler than
      trying to patch in just what changed) and shows a brief
      "Refreshed." confirmation, since a refresh that finds nothing
      different would otherwise look like it silently did nothing.
      Verified live on dev.rwnd.tv: clicking it against a real show
      returned 204, the confirmation appeared, and the page's cached data
      re-fetched without errors in the server log.

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

- [x] **Profile pictures** (2026-08-24 21:15 added, done 2026-08-25) — M2\
      James's ask, from real multi-account use (switching between his own
      "James Bulman" account and the managed-user "Carol Bulman" account
      while testing Plex webhook attribution): easy to lose track of
      which account you're currently on with nothing but a display name
      in the sidebar/settings to go on.\
      Design pass, James's picks: upload (not generated-only), stored as
      raw bytes directly in `users.avatar_image`/`avatar_mime_type`/
      `avatar_updated_at` (new nullable `bytea`/`text`/`timestamptz`
      columns) rather than a new `BACKUP_DIR`-style volume-mounted
      directory — no new env var, no new bind mount, nothing to configure
      for a self-hoster. 2MB/JPEG-PNG-WebP cap decided unilaterally (no
      image-processing dependency in this codebase to resize/compress
      instead), stated plainly rather than asked about.\
      Three new plain (non-`.openapi()`) routes on `auth.ts`, same
      reasoning as `webhooks.ts`'s existing Plex route: `PUT /auth/me/avatar`
      (multipart, `c.req.parseBody()`), `DELETE /auth/me/avatar`, and
      `GET /auth/me/avatar` (streams the bytes with the stored
      Content-Type, `Cache-Control: immutable` — safe since the frontend
      always requests it through a `?v=avatarUpdatedAt`-suffixed URL, so a
      new upload is a new URL rather than a stale cache hit). `userSchema`
      only ever carries `avatarUpdatedAt`, never the bytes/mimetype
      themselves — it's both the "has an avatar?" flag and the cache-bust
      key.\
      New `Avatar.tsx` (Sidebar.tsx + ProfileForm.tsx) renders the
      uploaded image when set, otherwise a generated fallback — same "no
      image → fall back to something derived from the title/name" shape
      as `PosterTile.tsx`'s poster fallback, but circular (not
      `PosterTile`'s fixed 2:3) and with a colour drawn from a small
      curated palette (hashed from the user's id) rather than
      `PosterTile`'s always-the-same grey, since the colour is itself part
      of what makes two accounts distinguishable at a glance. Sidebar.tsx
      had no user-identity element at all before this — added a new row
      (avatar + display name, linking to Settings — later Profile, see
      below), collapsing to just the avatar circle when the sidebar's
      collapsed to its icon rail. Placed below Log out, at the very bottom
      of the nav, not above the main nav list where it first shipped
      (James, 2026-08-25 — refers to it as "the Profile item").\
      Verified live on `dev.rwnd.tv`: uploaded a real image, saw it appear
      immediately in both Settings and the Sidebar (including the
      collapsed icon-rail state) once the query invalidated, removed it
      and confirmed both fell back cleanly to the initials avatar; the
      later reposition below Log out verified live too.

- [x] **Split Settings into a Profile page and a Settings page** (2026-08-25 added and done)\
      James's ask, immediately after "the Profile item" landed at the
      bottom of the sidebar (previous entry): rather than that row linking
      into the same page as API tokens/Database/Instance settings, give it
      its own Profile page, and move Log out onto it too.\
      New `ProfilePage.tsx` (`/profile`) renders `ProfileForm.tsx` (moved
      from `components/settings/` to a new `components/profile/`, since
      it's no longer shared with Settings) plus a new `LogoutCard.tsx` —
      the query-invalidation logic straight out of Sidebar.tsx's old
      `handleLogout` (the hard-won `removeQueries` + `invalidateQueries`
      fix from 2026-08-24, unchanged). `SettingsPage.tsx` now only renders
      `TokensPanel`/`DatabasePanel`/`InstanceSettingsPanel`. Sidebar.tsx's
      standalone Log out button was removed outright rather than kept
      alongside the new one — James's pick between the two options this
      was asked as: once the Profile item links straight to a page with
      its own Log out, a second copy in the sidebar was redundant, not
      worth keeping for quicker access.\
      i18n: `settings.profile.*` moved to a new top-level `profile.*`
      namespace in both locales (`profile.title` etc.), matching the
      existing convention every other top-level page follows (its own
      namespace, not nested under another page's); added `nav.profile`
      for the sidebar/breadcrumb label, reusing the existing `nav.logout`
      value for the new page's button text rather than adding a duplicate
      key. `ProfileForm.tsx`'s own `<h2>Profile</h2>` card heading was
      dropped — redundant now that the page's own `<h1>` says the same
      thing, the same "page h1, Card sections keep their own differently-
      worded h2" shape `ImportPage.tsx` already uses. `PageTitleEffect.tsx`
      picked up `/profile` in its breadcrumb map alongside the existing
      static sections.\
      Verified live on `dev.rwnd.tv`: `/profile` shows the profile form
      and a Log out button, `/settings` no longer shows the profile form,
      the sidebar's Profile item links to `/profile` not `/settings`, and
      clicking Log out there actually logs out (redirects to `/login`).

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

- [x] **Episode pages** (2026-08-21 23:00 added, scoped 2026-08-22)\
      No dedicated page per episode yet — only the season grid
      (`SeasonDetailPage.tsx`) and its inline watch toggle. Needed
      scoping: what an episode page shows beyond what the season grid
      already does. Scoped with James: full-size still image, full
      overview text, air date, runtime, the watched-toggle/log-
      additional-watch actions, plus this episode's own watch-history
      list; reachable by clicking an episode tile's thumbnail or title
      on the season grid. Done (2026-08-22): new
      `EpisodeDetailPage.tsx` at
      `/shows/:slug/season/:seasonNumber/episode/:episodeNumber`,
      sourced entirely from data the season query already returns
      (`seasonEpisodeSchema`) plus the existing on-demand
      `episodeWatches` endpoint (previously only fetched for the
      unwatch-confirmation dialog, here shown unconditionally as a
      read-only list) — no new backend endpoint needed. The
      watch-toggle/additional-watch/unwatch mutation logic that
      `EpisodeCard` (`SeasonDetailPage.tsx`) already had was pulled
      into a shared hook (`use-episode-watch-actions.ts`) rather than
      duplicated, since it's now used by two real call sites and the
      aired/unknown-watch guard rules need to stay identical between
      them. `EpisodeCard`'s thumbnail and title became a `<Link>` to
      the new page; the overlaid watched-toggle/"+" buttons keep
      working independently since they paint after (and on top of) the
      link within the same relative container. Verified live on
      `dev.rwnd.tv`: navigated in via both the thumbnail and title,
      logged then selectively removed an additional watch (reverting
      to the original single watch), confirmed the unwatched-episode
      state (no "+" button, "Not watched yet." history) and that the
      overlaid grid buttons still open their dialogs rather than
      navigating.\
      Follow-up (James, same day): full width (was the narrower reading
      column) and previous/next episode chevron buttons matching the
      season page's own previous/next season nav — same top-right
      corner, `secondary` variant, disabled at either end of the
      current season's episode list (doesn't cross into an adjacent
      season, same scope as the season page's own nav not crossing
      shows). Verified live: full-width layout renders correctly,
      clicking through updates the page, and both chevrons disable
      correctly at the season's first/last episode.

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

- [x] **Episode tile watched badge should show watch count** (2026-08-22 12:30 added)\
      The round watched-toggle badge on each episode tile
      (`SeasonDetailPage.tsx`, top-right of the thumbnail) always
      showed `CheckIcon` when watched. Done (2026-08-22): when
      `episode.watchedCount > 1`, the badge now shows the count (e.g.
      "3") instead of the tick — same threshold already used for the
      "watched Nx" text line below the title. Verified live on
      `dev.rwnd.tv`: episode 24 of _A Certain Scientific Railgun S_
      (watched 3 times) shows a "3" badge, every other watched episode
      on that season still shows the tick.

- [x] **Selective removal in the per-episode unwatch dialog** (2026-08-22 12:45 added)\
      `UnwatchConfirmDialog.tsx` listed every logged watch but removing
      always cleared all of them via one `onConfirm`. Done (2026-08-22):
      a tick box per watch, ticked by default; title/button copy switches
      to new `titleSelected`/`removeSelected` keys once at least one
      watch is unticked, back to `titleMultiple`/`removeAll` once every
      watch is ticked again; remove button disabled at zero ticked. The
      per-episode DELETE route (`apps/api/src/routes/library.ts`) now
      takes a `{ ids }` body (`removeEpisodeWatchesRequestSchema`) scoped
      to the episode/user regardless of what's sent, rather than always
      clearing everything; the GET route now returns each watch's own
      `id` alongside `watchedAt` (`episodeWatchesSchema`) so the ids
      exist to select by.\
      Regression found during verification (James, same day): two
      watches sharing an identical timestamp — realistic here because of
      Trakt's `1900-01-01` "unknown date" sentinel, which several
      rewatches can genuinely share — were seen both getting removed
      when only one was ticked, not reproducible on demand. Root cause
      was two compounding bugs: (1) `ORDER BY watchedAt DESC` alone gives
      Postgres no guarantee of a stable order between tied rows across
      separate queries, and (2) the dialog's "tick everything" reset
      effect re-ran on any change to the fetched watch list, not just on
      open — so a background refetch returning the tied pair in a
      different order looked like "new data" and silently wiped the
      user's unticking back to "everything selected." Fixed by
      tie-breaking both `ORDER BY` clauses on `id` (deterministic
      regardless of ties) and by only applying the reset once per open
      (a ref guard) rather than on every `watches` reference change.
      Verified live by deliberately creating two `1900-01-01` watches on
      one real episode: three repeated fetches returned the identical
      order, and unticking one of the two identical-looking rows removed
      precisely that one by id, leaving its twin. Added two regression
      tests for the tie case specifically (order stability across
      repeated fetches, and selective removal of one of two
      identical-timestamp watches).\
      Follow-up (James, same day): the dialog listed an unknown-date
      watch as the literal "01/01/1900, 00:00" instead of reading like
      one. Done: reused the existing `UNKNOWN_WATCHED_AT` sentinel
      constant and `history.unknownDate` ("Unknown date") copy — same
      convention `HistoryPage.tsx` already uses for grouping these —
      rather than inventing new wording.

## General

- [x] **A way to log an additional watch without going through History** (2026-08-21 23:00 added, detailed 2026-08-22 12:15)\
      Right now logging a rewatch of something already fully watched
      means going to the History page. Done (2026-08-22): a square,
      icon-only (plus icon) secondary button next to the existing
      "Watched" button on both `ShowDetailPage.tsx` and
      `SeasonDetailPage.tsx`, shown only once some watches already
      exist (`show.firstWatchedAt`/`watchedEpisodes > 0`
      respectively). Unlike "Watched", clicking it always logs a new
      watch for every episode in scope regardless of current watched
      state — opens the same `WatchDateDialog` used for the initial
      "Watched" click. Backed by a new `additional: true` flag on
      `markShowWatchedRequestSchema`: `logMissingWatches`
      (`apps/api/src/routes/library.ts`) skips its "already watched"
      filter when set, but still excludes unaired episodes exactly as
      before. Verified live end-to-end (logged an additional watch for
      a whole season including previously-unwatched aired episodes,
      confirmed unaired ones stayed untouched, then reverted).\
      Follow-up (James, same day): also wanted the same thing
      per-episode — a hover-revealed plus button to the left of the
      watched-toggle badge on each episode tile in the season grid,
      opening the same per-episode watch-date dialog. Done: no backend
      change needed here, since `POST /plays` (already used for the
      first-watch flow) has no "already watched" dedup to begin with —
      it was just a matter of exposing a second entry point to the
      same `markWatched` mutation already in `EpisodeCard`. Verified
      live: hovering an already-watched tile reveals the button
      (confirmed via computed styles and a zoomed screenshot), logging
      a watch through it incremented that one episode's count without
      touching its existing watch, then reverted.

## Spoiler protection

- [x] **Blur/hide spoiler content for unwatched episodes** (2026-08-22 10:45 added, done 2026-08-23)\
      Done: a new per-user `spoilerProtectionEnabled` column (on by
      default, toggle in `ProfileForm.tsx`'s Profile panel) gates a new
      `SpoilerGuard.tsx` component — blurs a spoiler-ish block behind a
      click-to-reveal overlay, never persisting the reveal (new state
      each mount, so navigating away and back re-hides everything).
      Scope ended up wider than the original title: episode stills,
      titles, and overviews on both `SeasonDetailPage.tsx`'s season grid
      and `EpisodeDetailPage.tsx`, _and_ (added at James's request) the
      TV show and season description paragraphs on `ShowDetailPage.tsx`/
      `SeasonDetailPage.tsx`, blurred until fully watched (reusing each
      page's existing `fullyWatched` value). Episode titles are swapped
      for the generic "Episode N" label rather than blurred, but share the
      same reveal condition as the still/overview rather than being
      independent — clicking reveal shows the real title too (James:
      titles were originally watched-only, tied to nothing you clicked,
      but that meant revealing the still still left a generic title next
      to it, which read as broken). The season grid's still image doesn't
      use `SpoilerGuard` directly — its reveal button would nest inside
      the tile's existing `<Link>`, invalid HTML — so it hand-rolls the
      same blur/button pattern as a Link sibling instead, matching the
      existing plus/toggle-button precedent in that file. That reveal
      button started as a full-cover overlay (blocking the Link
      underneath), but James found that meant two clicks to open an
      unwatched episode's page — one to reveal, one to actually navigate
      — so it's now a small top-left corner icon instead (same size/style
      as the toggle/plus buttons it shares the tile with), leaving the
      rest of the tile free to navigate in one click without revealing
      anything. On `EpisodeDetailPage.tsx`, the still, title, and overview
      all share one reveal action (revealing any un-blurs/un-swaps all
      three) since they're presented as one episode-content block.
      Decided with James up
      front via a quick round of questions: on by default; still, title,
      and overview all count as spoiler-ish (air date doesn't); a reveal
      only lasts for that page view; and (to avoid overclaiming — the
      Dashboard On Deck/Up Next rows don't exist yet) the show/season
      description blur only describes what it does today, not
      not-yet-built Dashboard behaviour. Verified live on dev.rwnd.tv:
      blur + reveal on an unwatched season/episode, the setting toggle
      turning all of it off/on immediately, and watched episodes/fully-
      watched show+season never blurred in the first place.

## Dashboard

- [x] **"On Deck" row** (2026-08-21 23:00 added, done 2026-08-23)\
      Done: a new `GET /library/on-deck` route and a matching
      `OnDeckRow.tsx` component above the Dashboard's search box — one
      card per show with a real-dated play in the last 30 days (the
      1900 "unknown date" sentinel doesn't count) that isn't dropped and
      has an aired-but-unwatched episode next, each card linking straight
      to that episode's own page rather than the show page, so clicking
      it doubles as "continue". Decided with James up front: horizontal
      scroll rather than a hard cap when more shows qualify than fit (a
      Netflix-style row, and what makes the "mobile-specific treatment"
      the original TODO worried about unnecessary — the row just scrolls
      sideways instead of needing a separate narrow layout); poster +
      "S{{season}} E{{episode}}" caption, reusing `PosterTile.tsx` rather
      than a bespoke card (needed a new optional `className` prop on it
      so the row's fixed-width flex tiles could override the grid-sized
      default).\
      "Next episode" can't be computed in SQL — an unwatched episode has
      no local row at all until something resolves it (see
      `resolveEpisode`'s doc comment in `apps/api/src/lib/media.ts`), so
      the route runs one query to find recently-watched/non-dropped
      candidates plus each one's furthest-watched season (specials
      excluded), then a new `findNextUnwatchedEpisode()` walks forward
      season-by-season from _that_ season (not season 1) calling the
      provider until it finds an aired-and-unwatched episode or runs out
      of seasons — starting from actual progress rather than the
      beginning is what keeps a many-season show cheap to check. Widened
      the existing `ResolvedEpisode`/`resolveSeason` (exported, was
      module-private) to carry `episodeNumber` rather than duplicating
      that query shape.\
      Hit the same "bare `Date` into a drizzle `sql`-derived column"
      gotcha documented elsewhere in this file (per-user show state
      section) — comparing a CTE column built from a raw `sql` aggregate
      against a plain `Date` via `gt()` threw `ERR_INVALID_ARG_TYPE` at
      runtime (passed typecheck fine, only failed against real Postgres);
      fixed with `.toISOString()` plus an explicit `::timestamptz` cast
      in a raw `sql` comparison instead of the query-builder helper.
      Verified live on dev.rwnd.tv: correct next-episode numbers against
      a live season's actual watched/aired state, the card linking
      straight to that exact episode, and the row scrolling (not
      wrapping or breaking) at a 390px-wide viewport.

- [x] **"Up Next" row** (2026-08-21 23:00 added, done 2026-08-23)\
      Done: a new `GET /library/up-next` route and `UpNextRow.tsx`,
      mirroring On Deck above but for the next _upcoming_ (unaired)
      episode instead of the next unwatched-but-aired one — same
      candidate shows (recently-watched, non-dropped), same
      horizontal-scroll row, same `PosterTile.tsx` card, linking to that
      episode's own page. Factored the two routes' shared "which shows
      qualify" query out into `getRecentlyWatchedCandidates()` rather
      than duplicating it, since On Deck and Up Next start from exactly
      the same set. Added `findNextAiringEpisode()` alongside
      `findNextUnwatchedEpisode()` in `media.ts` — same forward
      season-by-season scan from the viewer's furthest-watched season,
      just hunting for the first `firstAired > now` instead of the first
      aired-and-unwatched one; no watched-status check needed there,
      since an unaired episode can't have a logged watch (`POST /plays`
      already rejects that).\
      Settled three things with James up front rather than guessing: same
      30-day recency window as On Deck (not "any watch ever", simpler and
      consistent); the two rows are fully independent, so a show can
      appear in both at once (behind on aired episodes _and_ have
      something upcoming) rather than Up Next hiding shows On Deck
      already covers; and the card caption shows the air date too
      ("S2 E5 · 3 Sep"), unlike On Deck's plain "S2 E5", since knowing
      _when_ is the whole point of this row. Widened the shared
      `NextEpisode` return type with `firstAired` for this (On Deck
      doesn't use it, but both functions return the same shape).
      Up Next's heading is an `<h2>`, not On Deck's `<h1>` — see
      OnDeckRow.tsx's own doc comment on why promoting whichever row
      happens to be non-empty isn't worth the coupling.\
      Verified live on dev.rwnd.tv: correct next-airing episode/date
      against a live season, the card linking straight to that episode
      (shown correctly as not-yet-aired, "Mark watched" disabled), and a
      show appearing in both rows at once with different episode numbers
      in each, confirming they really are independent.

- [x] **Loading-order layout shift on Dashboard** (2026-08-24 22:35 added, done 2026-08-25)\
      James's observation, live: History appeared at the top of the page
      first, then got shoved down a moment later once Continue Watching
      and Upcoming popped in above it — root cause was `OnDeckRow.tsx`/
      `UpNextRow.tsx` returning `null` while loading (per-show
      next-episode resolution is slow) while History's plain `GET /plays`
      query resolved fast and rendered alone at the top, despite being
      last in `DashboardPage.tsx`'s JSX.\
      Done, James's pick between the two options this TODO left open:
      skeleton placeholders (`RowSkeleton.tsx`) reserving each row's final
      position from first paint, rather than holding the whole group's
      render until every query settles. First pass under-reserved height
      — one placeholder line below the poster box instead of two — since
      `PosterTile.tsx` always renders both its own title `<h2>` and
      whatever's passed as `children` (the caption every Dashboard row
      uses), each separated by `PosterTile`'s own `gap-2`; James caught
      the residual jump from a real before/after screenshot comparison on
      dev.rwnd.tv, fixed by giving the skeleton two placeholder lines
      matching that exact structure. Verified live on dev.rwnd.tv after
      the fix: all three rows occupy their final position from first
      paint, nothing moves as each resolves into real content.

- [x] **Upcoming row excluded today's episodes, and human-friendly relative dates** (2026-08-25 added and done)\
      James noticed Upcoming looked like it only ever showed episodes from
      tomorrow onward, never today's — correct: `findNextAiringEpisode`
      (`apps/api/src/lib/media.ts`) compared an episode's date-only
      `firstAired` (see `schema.ts` — no time-of-day) against the current
      _instant_, so "today" parsed as midnight today, which is never
      later than "now" once any time has passed. Fixed by comparing
      against the start of today instead. That alone would have let an
      already-watched today's episode keep showing as "upcoming" though
      — unlike a strictly-future episode, today's can already have a
      logged watch (`POST /plays`/`findNextUnwatchedEpisode` both already
      treat "today" as watchable) — so `findNextAiringEpisode` picked up
      the same watched-status exclusion `findNextUnwatchedEpisode` already
      had, which needed threading `userId` through to it from
      `GET /library/up-next`.\
      Same session, James's follow-up idea: replace the bare "24 Aug"-
      style date on the Dashboard's Continue Watching/Upcoming/History
      tiles with "Yesterday"/"Today"/"Tomorrow" where applicable, and,
      just for Upcoming, a weekday name ("Wednesday") for a date more
      than a day out but still within the coming week, falling back to
      the existing day/month format beyond that. New
      `formatDashboardDate()` (`apps/web/src/lib/date.ts`) — a day-diff
      against local midnight, `Today`/`Yesterday`/`Tomorrow` from new
      `common.today`/`yesterday`/`tomorrow` i18n keys, an optional
      `weekdayWithinDays` window (0 for History/Continue Watching, which
      never show a future date; 7 for Upcoming) for the weekday case —
      used by all three row components (`HistoryRow.tsx`, `OnDeckRow.tsx`,
      `UpNextRow.tsx`) in place of their previously-duplicated inline
      `toLocaleDateString` call.\
      Verified live on dev.rwnd.tv, both pieces together: Upcoming now
      shows two shows' next episodes dated "Today", one "Tomorrow", one
      two days out correctly as "Thursday", and one ten days out correctly
      still as "4 Sept" (past the 7-day window); History correctly shows
      "Today"/"Yesterday" for today's and yesterday's plays and falls back
      to "24 Aug"-style dates further back; Continue Watching, unaffected
      by the weekday window, still falls back to the day/month format for
      its (always past, often more-than-a-day-old) dates.

## Movies

- [x] **Bring Movies up to parity with TV Shows, where appropriate — Phase 1** (2026-08-23 15:05 added, done 2026-08-23)\
      Done: a per-movie page (`/movies/:slug`), gallery tiles now link
      to it, Watched/"+"/refresh-metadata actions, a TMDB rating badge +
      link, and Dashboard search + History linking to it instead of
      logging a watch inline. Design pass settled up front: no Drop
      action (`dropped_shows` stays a non-polymorphic FK to `shows.id`
      — Trakt's own drop concept is shows-only) and no spoiler
      protection/On Deck/Up Next (no episodes to spoil or step
      through). The Watched/unwatch UI deliberately mirrors
      `EpisodeCard.tsx`, not the show page's bulk actions — a movie is
      one thing with N plays, same as an episode, not a
      show/season/episode tree — so removing a watch opens the existing
      `UnwatchConfirmDialog` (tick individual plays) rather than a
      blunt "remove all watches" confirm.\
      Schema: `movies` gained `slug`/`genres`/`vote_average` (migration
      `0009`, same four-step backfill shape as the shows slug migration
      `0004`), landed now rather than deferred to the gallery-filters
      phase because the detail page itself needed genres/rating for its
      facts line and TMDB badge. `findStaleMovies` (metadata refresher)
      got the same "never populated" backfill clauses `findStaleShows`
      already had, so existing movies didn't sit with empty genres for
      up to ~5 months waiting on the compliance clock — the exact gap
      class the shows version was caught having on 2026-08-19.\
      API: new `POST /library/movies/resolve`, `GET`/`POST refresh`,
      and `GET`/`DELETE .../plays` routes, modelled directly on their
      show/episode equivalents. Renamed four schemas that were really
      media-agnostic already (`episodeWatchesSchema` →
      `watchesSchema`, etc.) rather than duplicating them, since
      `UnwatchConfirmDialog` is now genuinely shared between the season
      and movie pages.\
      Verified live on dev.rwnd.tv: migration ran clean against the
      real ~560-movie library with unique backfilled slugs, the
      backfill clauses picked up genres/ratings via the automatic
      startup sweep, and every UI flow (watch/rewatch/partial-
      unwatch/refresh/search/history) checked out against real data.\
      Gallery filter/sort parity (genre, release-year, rating,
      watched-year) is deliberately Phase 2, tracked separately in
      `docs/TODO.md` — pure frontend now, since this phase's migration
      already added the columns it needs.

- [x] **Movies gallery filter/sort parity — Phase 2** (2026-08-23 22:15 added, done 2026-08-23)\
      Done: the Movies gallery now has the same filter panel and
      directional sort options the Shows gallery already had — genre
      include/exclude, a release-year range, a TMDB rating range +
      rating sorts, and a watched-year range + Unknown toggle. Pure
      frontend plus a small `GET /library/movies` response widening
      (`genres`/`voteAverage`, mirroring `slug`'s addition in Phase 1) —
      `library-filter.ts`'s helpers were already generic over both
      media types via structural typing, confirmed by reading the file
      in full before starting. No Status filter (movies have no status
      column — that's a series concept) and no Dropped filter (Phase 1
      gave movies no Drop action at all, so nothing to filter by).\
      Converted all four existing sorts (`lastWatched`/`title`/`year`/
      `timesWatched`) to directional pairs to match Shows' convention
      and added a Rating sort, landing on Shows' same ten-option shape
      (progress swapped for times-watched, since a movie has no
      episode-progress fraction). Incidentally fixed the sort-label
      casing inconsistency between `shows.*` and `movies.*` an earlier
      locale audit flagged — `movies.*` now copies Shows' Title Case +
      parenthetical wording instead of its own sentence-case one.\
      Verified live on dev.rwnd.tv: every filter section renders with
      real data (17 genres, a 1941-2026 release range, a 3.8-10.0
      rating range, a 2014-2026 watched range), a genre include
      narrowed the grid to exactly the matching titles, and the new
      rating sort ordered highly-rated titles (The Godfather, Spirited
      Away, The Dark Knight) first.

## Landing page & branding

- [x] **Link the header mark/wordmark to the site's base URL** (2026-08-23 14:40 added, done 2026-08-23)\
      Done: `Layout.tsx`'s mark + wordmark are now wrapped in a React
      Router `Link to="/"` rather than plain elements. Settled the open
      question in the original TODO in favour of an in-app route, not a
      real anchor to the instance origin — `Layout` only renders behind
      `ProtectedRoute`, so a logged-in viewer clicking it always wants
      `/`, which `App.tsx` already redirects to `/dashboard`; no need to
      hardcode `https://rwnd.tv`/`https://dev.rwnd.tv` per environment.
      Verified live on dev.rwnd.tv: clicking the mark/wordmark from
      another page (History) lands on the Dashboard, header layout
      otherwise unchanged.

## Localization

- [x] **Drop fr-FR** (2026-08-23 done)\
      Done: removed the `fr-FR` locale entirely — `SUPPORTED_LOCALES`,
      `i18n/index.ts`'s registered resources, and the
      `apps/web/src/i18n/locales/fr-FR/` directory. Traced its origin
      first: no ADR, no `docs/vision.md` rationale, nothing in the M1
      commit message either — a past session added it unilaterally,
      almost certainly just to prove the i18n plumbing worked with more
      than one locale, not because anyone asked for it or could check
      it. James confirmed he didn't choose it, and it had never been
      verified by a French speaker. Rather than carry an unverified
      translation indefinitely, dropped it until there's someone who
      can actually check a French locale. No DB migration needed — dev's
      only user/instance-settings row was already `en-GB`, and the
      `locale` column has no DB-level enum constraint. Reworded two
      comments that had cited `fr-FR` as their reasoning rather than
      removing the behaviour they described: `foldForSearch`'s
      accent-insensitivity is still useful for any title with
      diacritics regardless of UI locale, and `parseDateTimeInput`'s
      day-month-year assumption still holds for `en-GB` alone.
      Verified live on dev.rwnd.tv: Settings' language picker showed
      only `en-GB`, no console errors, everything still rendered
      correctly.

- [x] **Add en-US locale, rewrite en-GB's Movie → Film wording** (2026-08-23 23:10 added, done 2026-08-23)\
      Done: `en-US` shipped alongside a rewrite of `en-GB`'s Movie
      wording to Film. Came out of the movies-parity work — a casual
      "Film" vs "Movie" question turned into a full audit of
      `en-GB/common.json`, which surfaced that the file was already
      written in near-total American vocabulary throughout, so a naive
      `en-US` copy would barely have differed. Confirmed the actual
      word choices with James (a native British English speaker) word
      by word, rather than assuming from a generic UK/US style guide —
      that guide had already gotten one word wrong (see below).
      Verdict: **Season** stays "Season" (modern globally-released
      shows are called that in British usage too — only older
      British-produced shows like _Blackadder_ commonly say "Series"),
      **TV Show** stays "TV Show" ("TV Programme" is understood but
      old-fashioned), and **Movie → Film** was the one real change
      ("Film" is the preferred word, though "Movie" is fine
      informally) — ~15 keys (`nav.movies`, `search.placeholder`, the
      `movies.*`/`movieDetail.*` blocks), not the ~48 originally
      estimated.\
      `en-GB` and `en-US` landed in the same commit rather than staged
      — no benefit to sequencing once both are written correctly, and
      staging would have left a window where the only English locale
      said "Film" with no American option. `en-US` is a near-copy of
      `en-GB` as it read before this rewrite (Movie/Movies throughout)
      plus the 4 genuine spelling words (`Cancelled`→`Canceled`,
      `labelled`→`labeled`, `authorise`→`authorize`), wired into
      `SUPPORTED_LOCALES` (`packages/shared/src/schemas/common.ts`),
      `i18n/index.ts`, and the Settings language picker (already
      generic over `SUPPORTED_LOCALES`, no changes needed there).\
      Also fixed `parseDateTimeInput`'s 12-hour-clock bug before
      shipping a 12-hour locale: it had no `dayPeriod` handling, so a
      typed "5:30 PM" silently parsed as 05:30 with no error. Now
      derives the locale's own AM/PM strings via two reference times
      (not hardcoded English text) and resolves the typed hour against
      whichever marker appears in the text — returns null (rather than
      guessing) if neither is found. Verified with a standalone script
      that the fix round-trips correctly across all 24 hours for both
      `en-GB` and `en-US`, and correctly rejects ambiguous input.\
      Verified live on dev.rwnd.tv: switching the account language
      between `en-GB` and `en-US` actually re-renders the UI (Films ↔
      Movies, sidebar and page heading both), no console errors either
      way. Along the way, confirmed a form-automation gotcha isn't an
      app bug: setting a `<select>`'s value via a testing tool's direct
      DOM write doesn't fire the event React's controlled input relies
      on, so the change silently doesn't persist — a genuine
      keyboard-driven interaction works correctly. Not a rwnd.tv issue,
      but worth remembering next time a Settings toggle "doesn't save"
      under automation.\
      Remaining, split into its own TODO: seeding a new account's
      locale from the browser's detected language instead of always
      `en-GB` — see `docs/TODO.md`.

- [x] **Seed a new account's locale from the browser, not always en-GB** (2026-08-23 23:10 added, done 2026-08-24)\
      Done: `RegisterPage.tsx`/`SetupPage.tsx` now send `i18n.language`
      (already exact-matched against `SUPPORTED_LOCALES` by
      `i18next-browser-languagedetector`, falling back otherwise) as an
      optional `locale` field on `POST /register`/`POST /setup`
      (`registerRequestSchema`/`setupRequestSchema`), which the routes
      write onto the new `users` row when present. James also asked to
      change the fallback itself from `en-GB` to `en-US` while doing
      this — applied consistently everywhere a locale "default" existed:
      the `users.locale` and `instance_settings.default_locale` column
      defaults (migration `0010_even_nick_fury.sql`, column defaults
      only — doesn't touch existing rows/instances), `i18next`'s
      `fallbackLng`, `settings.ts`'s `DEFAULT_SETTINGS.defaultLocale`,
      and `refresh.ts`'s in-code fallback. Deliberately did _not_ touch
      the many per-component `user?.locale ?? 'en-GB'` date-formatting
      fallbacks scattered across detail pages — those only matter while
      `useAuth()`'s user is still loading, not a real "default," and
      touching a dozen unrelated files wasn't part of what was asked.\
      Verified live on dev.rwnd.tv: temporarily opened registration,
      registered a throwaway account, and confirmed it correctly seeded
      `en-GB` (this machine's actual browser language, a supported
      locale) rather than the new `en-US` default — proving detection
      is still preferred over the default when there's a real match.
      Confirmed the default itself separately via `psql` against the
      dev DB (`users.locale`/`instance_settings.default_locale` both
      show `'en-US'::text`), since a browser already reporting a
      supported locale can never exercise the fallback path itself.
      Cleaned up afterward: deleted the throwaway account and restored
      registration to `Closed`.

## Metadata & matching

- [x] **Multi-provider metadata (tmdb/imdb/tvdb)** (2026-08-11 22:20 added, done 2026-08-24) — M2\
      Done, as six sequential PRs — see `[ADR 0006](adr/0006-multi-provider-metadata.md)`
      for the full design and reasoning, only summarised here. `MetadataProvider.source`
      and every hardcoded `source: 'tmdb'` query (routes, the Trakt import
      matcher, the metadata refresher) widened to a real
      `MetadataProviderSource` type (`'tmdb' | 'tvdb'`, excluding the
      id-only `imdb`/`trakt` namespaces). The real bug behind the Formula 1
      anecdote — a Trakt item with no `tmdb` id gave up immediately even
      when Trakt had handed over a usable `imdb`/`tvdb` id — is fixed via a
      new `MetadataProvider.findByExternalId` (TMDB's `/find` endpoint);
      **does not fix Formula 1 itself**, which TMDB has no entry for under
      any id — the fallback fixes the general stale/missing-id case, not
      that specific title. `METADATA_PROVIDER` env var removed —
      which providers exist is now derived from which credentials are
      configured. New instance-settings `metadataProviderPriority`
      (admin-configurable, read-only UI for now — only one provider has
      ever existed to order) governs fallback order for the background
      refresher and the manual "refresh metadata" buttons (already built
      before this work, just made provider-aware rather than TMDB-only).
      New `shows.metadataSource`/`movies.metadataSource` columns record
      which provider actually wrote a row's cached fields, surfaced as a
      "Metadata: TMDB" indicator on both detail pages next to (not
      replacing) the existing TMDB rating badge. Backups deliberately left
      untouched — still keyed by a bare `tmdbId`, with the future
      `formatVersion: 2` shape recorded in the ADR rather than built now,
      since nothing this work introduces creates an entity backups can't
      already represent.\
      Verified live on dev.rwnd.tv at every stage: a real Trakt
      re-import's unmatched-item count and composition held identical
      before/after the import-matching fix (372 items, same reasons),
      NASA's failure message changed to confirm the new fallback path
      actually ran (`"tried tmdb, imdb and tvdb ids"`), the app booted
      cleanly with `METADATA_PROVIDER` gone, the priority migration
      backfilled the existing instance to `{tmdb}`, the metadata-source
      migration backfilled all 481 shows and 563 movies to `'tmdb'` with
      nothing left null, and the indicator + re-gated refresh buttons both
      render and work correctly on real show/movie pages.\
      Not done: the second provider itself (Wikidata/TVDB) — separate,
      still "not yet scheduled" — and the backup format's `tmdbId` ->
      `externalIds[]` migration, deferred until an entity actually exists
      that needs it.

- [x] **Wikidata/TVDB metadata provider alongside TMDB** (2026-08-23 15:36 added, done 2026-08-24)\
      The second provider itself, on top of the plumbing above. A real
      `TvdbProvider` against TheTVDB v4 API (`apps/api/src/providers/tvdb.ts`)
      — JWT auth via `/login`, `/search`, `/movies/{id}/extended`,
      `/series/{id}/extended`, `/series/{id}/episodes/default`,
      `/search/remoteid/{id}` for reverse lookups. Found and fixed a real
      bug along the way: season "aired order" grouping is identified by
      `show.defaultSeasonType` (an id), not the literal string `'default'`
      TVDB's docs suggest — that string is only ever a path-segment alias.
      TVDB deep links + theme-aware attribution logos added to Show/Movie/
      Season/Episode pages, matching TMDB's existing UI conventions; no
      rating shown next to TVDB's link, since TVDB has no metric
      comparable to TMDB's vote average (`score` is a popularity metric,
      not a rating). Settings' provider-priority list gained working
      reorder controls now that there's a second provider to reorder.\
      Wikidata itself not built — TVDB alone covers what the anecdote
      (Formula 1) needed; Wikidata stays a possible future third provider,
      not scheduled.\
      Verified live on dev.rwnd.tv: real TVDB search/detail/season data
      renders correctly on show, movie, season, and episode pages; the
      attribution logo switches correctly with the theme toggle.

- [x] **Cross-provider fallback for Trakt import matching** (2026-08-24 12:15 added, done 2026-08-24)\
      `matchMovie`/`matchShow` (`apps/api/src/import/match.ts`) only ever
      resolved a title against TMDB — even the existing imdb/tvdb
      reverse-lookup fallback (`findByExternalId`) looked _into TMDB_, not
      into TVDB itself. Done: `resolveViaProvider` now walks every
      configured provider in priority order, trying each one's own Trakt
      id first (`ids.tmdb` for TMDB, `ids.tvdb` for TVDB) then its
      imdb/other-provider reverse lookup, before moving to the next
      provider — `findViaAlternateIds` also skips reverse-looking-up a
      provider against its own id source now (asking TVDB to resolve a
      tvdb id was a pointless self-referential call once TVDB could
      actually appear in the loop). `ShowMatch` carries the _winning_
      provider instance alongside its id, reusing `pickRefreshTarget`
      (`apps/api/src/metadata/refresh.ts`) for the already-resolved-
      locally fast path, so `matchEpisode`'s season/episode lookups land
      on whichever provider actually knows the show, not always the
      primary one. `runTraktImport` resolves `orderedProviders()` once
      per job (same convention as the metadata refresher's sweep) and
      threads the array through instead of a single provider.\
      Found and fixed a real bug along the way while live-verifying (not
      part of this TODO item, but caught by the same live re-import used
      to verify it): `TvdbProvider`'s season-type matching filtered on a
      literal type string (`'default'`) that doesn't exist in TVDB's
      actual data — the real "aired order" grouping is identified by
      _id_ (`show.defaultSeasonType`), not that string, which is only
      ever a path-segment alias on the episodes endpoint. This was
      silently leaving a TVDB-refreshed show's season list unwritten.\
      Verified live on dev.rwnd.tv: re-running a full Trakt re-import
      (11,279 items) dropped unmatched items from 372 to 5 — every
      remaining failure is a narrow per-episode numbering mismatch
      (mostly season-0 specials, one two-parter finale) inside an
      already-resolved show, not a show/movie the importer couldn't find
      at all.

- [x] **`seasons.airedEpisodeCount` can be wrong for the currently-airing season** (2026-08-25 15:39 added, done 2026-08-26)\
      Found live: Silo's Season 3 row had `aired_episode_count = 10`
      (i.e. "fully aired") while Episode 10 itself actually airs
      2026-09-03 — still in the future. Confirmed directly against TMDB
      (`GET /tv/125988`): Season 4 is an announced-but-empty placeholder
      (`episode_count: 0`, `air_date: null`), which `refreshOneShow`
      (`apps/api/src/metadata/refresh.ts`) picked as `latestSeasonNumber`
      via `Math.max` over season numbers — Season 3 (the season actually
      still airing, confirmed via `GET /tv/125988/season/3` showing
      episode 9 airing 2026-08-27 and episode 10 airing 2026-09-03, both
      still in the future as of 2026-08-26) then fell into the "must be
      fully aired" branch instead. Fix: `latestSeasonNumber` is now
      computed only over seasons with `episodeCount > 0`, so an
      unpopulated future placeholder season can no longer be mistaken
      for the real latest one. Added a regression test reproducing the
      exact shape (a real season plus an empty placeholder one season
      number higher) to `apps/api/src/test/metadata-refresh.test.ts`.

- [x] **Per-episode data is never resolved proactively — only as a side effect of specific actions** (2026-08-25 15:42 added, done 2026-08-26)\
      Fix: `refreshOneShow`'s (`apps/api/src/metadata/refresh.ts`)
      extra per-episode fetch for a still-airing show's latest season
      now goes through `resolveSeason()` (`apps/api/src/lib/media.ts`)
      instead of calling `provider.getSeason()` directly — the same
      change the `airedEpisodeCount` fix above already suggested. The
      `airedEpisodeCount` count itself is computed from
      `resolveSeason`'s return value (the same rows just persisted into
      `episodes`), rather than from the raw provider response, so the
      one extra fetch the sweep already made now does double duty.\
      Scope kept deliberately narrow, per the item's own "needs a design
      pass" caveat: only the currently-airing season of an airing show
      gets resolved this way, on the sweep's existing cadence — no
      change to older/finished seasons, which stay lazy (resolved only
      on a "Mark watched" action, Continue Watching/Upcoming lookup, or
      Trakt import, as before).\
      Added a regression test asserting real `episodes` rows land in
      the database after a sweep, not just a season-level count
      (`apps/api/src/test/metadata-refresh.test.ts`); also fixed a
      latent bug in that file's `tmdbSeasonResponse` test helper, which
      hardcoded `season_number: 1` in every episode regardless of which
      season was actually requested — harmless before this change (the
      season-number field was never read), but silently broke two
      existing tests once the aired-count computation started depending
      on episodes actually landing in the right season.

## Webhooks & scrobbling

- [x] **Plex webhook ingestion** (2026-08-23 15:30 added, done 2026-08-24) — M2\
      Watches now log themselves as you watch, via Plex's own native
      webhook feature (Plex Pass required) — the per-user API tokens
      built in M1 were exactly for this. Built as a source-agnostic core + a thin Plex-specific parser, deliberately, since Tautulli/
      Jellyfin/Emby/Kodi support is wanted next (own TODO item above):
      `apps/api/src/lib/api-tokens.ts`'s `resolveApiToken` authenticates
      via a token in the URL path (Plex's fixed `multipart/form-data`
      POST has no way to attach custom headers — every future source
      uses the same URL-token shape so setup instructions stay
      identical); `apps/api/src/lib/external-match.ts` resolves _any_ of
      a webhook event's external ids (tmdb/tvdb/imdb, whichever it
      handed over) to a local movie/show, checking `external_ids` across
      all of them before falling back to a live cross-provider lookup —
      extracted from `apps/api/src/import/match.ts`'s own
      `resolveViaProvider`/`findViaAlternateIds` (already generic in
      everything but its Trakt-typed `ids` parameter, now shared by
      both); `apps/api/src/webhooks/plex.ts` parses Plex's own payload
      shape (`media.scrobble` events only — Plex's own definition of
      "counts as watched," not something rwnd.tv second-guesses) into
      that source-agnostic shape. Idempotency reuses `plays.sourceRef`'s
      existing partial unique index (ADR 0004 already named this as "the
      dedup key for Plex/Tautulli, no migration needed") — a
      `${ratingKey}:${today's date}` composite key, a deliberate
      imperfect compromise since Plex hands over no stable per-delivery
      event id: collapses same-day retries (the real risk) while still
      allowing a genuine rewatch the next day.\
      New Settings > API tokens UI: once a token exists, the constructed
      webhook URL (built client-side from `window.location.origin`, no
      new backend config) with a copy button and a one-line Plex-Pass
      note.\
      A gap flagged rather than glossed over: exact Plex payload field
      placement (particularly for episodes) couldn't be fully confirmed
      from Plex's own docs alone, which are thin on this — the parser's
      assumptions are covered by unit tests against constructed fixture
      payloads, but real confidence needs a real Plex webhook delivery,
      which only James can trigger.\
      Live-verified on dev.rwnd.tv: the route rejects an invalid token
      (401) and the new Settings UI renders/creates/copies correctly
      against a real token.

- [x] **Multi-user Plex attribution** (2026-08-24 17:10 added, done 2026-08-24) — M2\
      James's ask, from real need: "I have two users on my Plex server,
      myself - the Plex account holder, and another managed user. I want
      only my own watches going into my rwnd.tv data, and I want to
      setup a new rwnd.tv account for the managed user." One webhook URL
      per Plex server now serves every account on it: a new
      `webhook_account_links` table maps `(tokenId, source,
externalAccountId) → userId`, discovered lazily as accounts are
      seen and requiring an explicit claim in Settings > API tokens >
      Linked accounts (assignable to _any_ instance user, not just the
      token's owner). The obvious shortcut — auto-link whichever account
      has Plex's own `id: 1`, which Plex's docs claim is always the
      server owner — was built, then live-tested and found to be simply
      false: James's real account came back as id `274494`, a global
      Plex.tv account id, not a small per-server placeholder. Removed
      entirely rather than patched around; every account, owner
      included, is unclaimed until explicitly linked, no exceptions
      (`apps/api/src/lib/webhook-accounts.ts`'s `resolveWebhookAccount`,
      and the schema doc comment on `webhook_account_links` recording
      why). `apps/api/src/lib/api-tokens.ts`'s `resolveApiToken`
      deliberately stops resolving the token's _owner_ as part of this —
      a webhook request doesn't necessarily belong to them at all.\
      Live-verified end to end on dev.rwnd.tv with a real second Plex
      user and a real second rwnd.tv account ("Carol Bulman"): the
      managed profile's play showed up as an unclaimed account, was
      claimed to the new account in Settings, and the watch appeared in
      that account's own History — never James's.

- [x] **Retroactive replay of watches logged while unclaimed** (2026-08-24 17:20 added, done 2026-08-24) — M2\
      Follow-on to multi-user attribution, James's ask: "when we assign
      the Plex account to the rwnd.tv account, we should retroactively
      add the watches as well" — the account-discovery live test had
      just shown the triggering watch itself getting silently dropped
      (only `console.error`d) rather than recovered once claimed. New
      `pending_webhook_events` table stores the full parsed event
      (typed jsonb — ids, ratingKey, movie/episode shape) whenever an
      account resolves unclaimed, keyed the same way
      `webhook_account_links` is; claiming a link
      (`PATCH /tokens/{id}/webhook-links/{linkId}`) replays every
      pending event for that exact tuple through the same
      `logWebhookPlay` function a live delivery uses
      (`apps/api/src/lib/webhook-plays.ts`, extracted so the two paths
      can never drift apart), then deletes them regardless of
      individual outcome — a one-shot replay, matching how a live
      delivery only ever gets one attempt too. The idempotency key
      (`${ratingKey}:${date}`) is computed from the event's own
      `watchedAt`, not replay time, so a claim happening days later
      doesn't produce a different key than immediate processing would
      have.\
      A genuinely unrecoverable edge case, accepted rather than solved:
      a pending event's _own_ first replay attempt is its only one — if
      the title fails to resolve at that moment (see the two provider
      bugs below, both found via exactly this path), the watch is gone
      for good once the pending row is deleted. Confirmed live twice
      (Blue Planet II, then a Formula 1 session) and accepted as a
      known limitation of "one shot," not treated as a bug in the
      replay mechanism itself.

- [x] **Fixed: episode-vs-show id confusion in TMDB/TVDB provider lookups** (2026-08-24 18:00 added, done 2026-08-24) — M2\
      Found live, twice, via the retroactive-replay path above — both
      times a real watch that should have resolved instead got silently
      dropped. Root cause: some content's external ids identify one of
      its _episodes_, not its show, even where a show-level id is
      expected — confirmed for both TMDB and TVDB, reachable via two
      different code paths.\
      First instance (Blue Planet II, via a _cross-provider_ id lookup):
      Plex's `Guid` array carried an episode-level tmdb/tvdb/imdb id
      where a show-level one was expected. Both
      `TmdbProvider.findByExternalId` and `TvdbProvider.findByExternalId`
      only checked their show/movie-level result fields
      (`tv_results`/`series`), silently discarding a hit that came back
      as an episode instead (`tv_episode_results`/`episode`). Fixed by
      falling back to the episode hit's own show/series id
      (`apps/api/src/providers/tmdb.ts`, `apps/api/src/providers/tvdb.ts`).\
      Second instance (a live F1 qualifying session, via TVDB's _own
      native_ id): the same confusion, but for an id TVDB itself
      issued, hit via `getShow()`'s direct `/series/{id}` fetch rather
      than a cross-provider lookup — the first fix didn't cover this
      path at all. TVDB's id space is global across entity types, so a
      plain series 404 means the id isn't a series id at all; fixed by
      falling back to `/episodes/{id}` for its `seriesId` before giving
      up (`TvdbProvider.getSeriesRecord`). This surfaced a second,
      deeper bug: `resolveShow` (`apps/api/src/lib/media.ts`) was
      storing and returning the _input_ external id rather than the
      provider's own corrected one, so every downstream episode/season
      lookup (and the `external_ids` row itself) kept using the wrong
      id even after `getShow` had already redirected internally. Fixed
      by threading the provider's real `externalId` through
      `resolveShow`'s return value and every caller
      (`resolveShowEpisodes`, `resolveSeasonEpisodes`, `resolveEpisode`,
      `resolveShowFromExternalIds`, and Trakt import's `match.ts`,
      which shared the same bug).\
      Live-verified: re-tested Carol's Plex account against "Formula 1"
      after deploying both fixes — the watch resolved and appeared
      correctly in her History.

- [x] **Fixed: a failed pending-event replay could wedge every other pending event behind it** (2026-08-24 19:20 added, done 2026-08-24) — M2\
      The webhook-link claim route's replay loop
      (`apps/api/src/routes/tokens.ts`) called `logWebhookPlay` for each
      pending event with no per-event error handling — an unexpected
      failure (as opposed to `logWebhookPlay`'s own ordinary "no
      configured provider recognizes this title" case, which already
      returns normally) threw out of the loop entirely, skipping every
      later event in the same batch and skipping the unconditional
      delete afterward too — directly contradicting the route's own
      "whatever happens, the pending rows are gone afterward" design.
      Found live during the Formula 1 investigation above (a TVDB 404
      mid-replay left the pending row stuck, which is what made a clean
      re-test possible once the provider bug was fixed). Fixed by
      wrapping each replay attempt in its own try/catch, logged
      server-side on failure, matching the same "log and move on"
      convention `logWebhookPlay` already uses for a soft no-match.

- [x] **Fixed: cross-source duplicate watches (Trakt import vs. direct Plex webhook)** (2026-08-24 19:45 added, done 2026-08-24) — M2\
      Found live: James runs both Trakt's own Plex scrobbling integration
      and rwnd.tv's new Plex webhook against the same Plex server, so the
      same real watch could land in Trakt's history _and_ rwnd.tv's own
      webhook independently — a later Trakt import inserted a second
      `plays` row for a watch the webhook had already logged directly,
      since the two pipelines' `sourceRef`s differ and
      `plays_user_source_ref_idx`'s uniqueness is scoped per-source.
      Confirmed and manually cleaned up for Blue Planet II S1E3-5 on
      James's account before the fix.\
      New `apps/api/src/lib/plays.ts`'s `hasCrossSourceDuplicate`, called
      before every `import`/`plex` `plays` insert
      (`apps/api/src/import/trakt.ts`'s `processHistoryItem`,
      `apps/api/src/lib/webhook-plays.ts`'s `logWebhookPlay`): skips the
      insert if a play already exists for the same user/entity/calendar
      day (UTC) from the _other_ automated source. Deliberately scoped to
      `import`/`plex` only — a `manual` watch is the user's own explicit
      action, not a scrobble, and can legitimately coexist with (or
      precede) an automated one the same day without being a duplicate.
      "Same calendar day, different automated source" is an accepted,
      imperfect heuristic, not a full merge/reconciliation: first writer
      wins outright (the later one is simply dropped, nothing is
      updated), and a genuine same-day rewatch caught once by each
      pipeline — rare but possible — would be silently treated as a
      duplicate too. Judged an acceptable tradeoff against the
      alternative (every dual-pipeline watch double-counted), and not
      worth the added complexity of picking a "winner" between sources
      that disagree, which the original TODO had flagged as unresolved.

- [x] **Fixed: Trakt import's itemsImported count was noise, not a real number** (2026-08-24 20:00 added, done 2026-08-24) — M2\
      James's ask, live: re-running an import against an already-up-to-
      date Trakt account reported dozens of "items imported" with nothing
      actually new anywhere — confusing, and the opposite of what a user
      needs to trust the number. Root cause: `processRatingItem`/
      `processWatchlistItem`/`processDroppedItem` (`apps/api/src/import/
trakt.ts`) always returned `'imported'` on a successful match,
      regardless of whether the `onConflictDoUpdate` upsert actually
      changed anything — re-confirming identical Trakt data every run
      counted as "imported" every single time. Fixed with drizzle's
      `setWhere` on each upsert (comparing the incoming values against
      what's already stored), so `RETURNING` — and therefore the
      `'imported'`/`'skipped'` outcome — only fires on a genuine insert or
      an actual data change.\
      Surfaced a real, separate bug while fixing this: a raw `Date`
      interpolated directly into a `sql`-tagged template (the
      `dropped_shows` `setWhere` condition) doesn't get the same value
      serialization `values()`/`set()` apply — it stringifies via
      `Date.prototype.toString()` instead of an ISO string, an invalid
      timestamptz literal that silently failed every dropped-show
      write (caught by the per-item error handler, so the job still
      "completed," just having quietly done nothing). Fixed by passing
      an explicit `.toISOString()` + `::timestamptz` cast instead.\
      Live-verified against James's real ~11,300-item Trakt account: a
      re-import now reports 0 imported / 11286 processed / 5 unmatched,
      accurately reflecting that nothing had actually changed.

- [x] **Self-hosted the TMDB/TVDB attribution logos instead of hotlinking them** (2026-08-24 20:20 added, done 2026-08-24) — M2\
      James spotted the show/season/episode pages' TMDB rating badge
      directly hotlinking `themoviedb.org/assets/...svg` — the likely real
      cause of the "TMDB icon seems broken" report investigated earlier
      today (that investigation confirmed the asset loaded fine _in that
      moment_, but never ruled out TMDB's CDN being unreliable at other
      times, which is exactly the failure mode a hotlink risks and a
      self-hosted copy doesn't). Same pattern existed for both of TheTVDB's
      attribution logo variants.\
      Checked TMDB's and TheTVDB's own attribution pages and API terms of
      use before changing anything (`docs/TODO_ARCHIVE.md`'s TVDB
      licensing entry already covers verifying compliance rather than
      assuming it): neither requires serving the logo live from the
      provider's own domain. TMDB's terms only require the logo be used
      unmodified and less prominently than this app's own branding, and
      their attribution page itself offers the SVG as a direct download.
      TheTVDB's api-information page requires a direct _link_ to
      TheTVDB.com (already handled by `tvdbSeriesUrl`/`tvdbSeasonUrl`/etc.
      in `apps/web/src/lib/tvdb.ts`) but says nothing about the logo
      image's own hosting.\
      All three logos (`apps/web/src/lib/tmdb.ts`'s TMDB_LOGO_URL,
      `apps/web/src/lib/tvdb.ts`'s TVDB_LOGO_LIGHT_BG_URL/
      TVDB_LOGO_DARK_BG_URL) downloaded byte-for-byte and committed to
      `apps/web/public/attribution/` — served as static files (not run
      through Vite's hashed-asset pipeline, so the URL stays stable)
      rather than fetched live from themoviedb.org/thetvdb.com. Also
      updated `EpisodeDetailPage.tsx`/`SeasonDetailPage.tsx`'s own
      duplicated TMDB_LOGO_URL constants (same per-file icon precedent as
      before — see their own doc comments) and README.md's attribution
      footer (now a repo-relative path GitHub resolves from the repo
      itself, not TMDB's CDN). Explicitly accepted tradeoff, matching
      `lib/tmdb.ts`'s own prior doc comment on why hotlinking was tried
      first: a self-hosted copy needs a manual re-download if TMDB/TVDB
      ever redesign their logo, in exchange for no longer depending on
      their CDN's uptime for something as basic as an attribution icon
      rendering correctly.\
      Live-verified on dev.rwnd.tv: all three logos render correctly and
      `img.src` for each now resolves to `dev.rwnd.tv/attribution/...`,
      not the original third-party domain.

- [x] **Fixed: resolveShow created a duplicate show when a redirected id was already known under its own** (2026-08-24 21:45 added, done 2026-08-24) — M2\
      Fallout from the earlier TVDB native-id fix: when `TvdbProvider.getShow`
      redirects an episode-shaped input id to a show's real id (see the
      "TVDB id-space collision" entry above), `resolveShow`
      (`apps/api/src/lib/media.ts`) never re-checked whether _that_
      corrected id already mapped to a show it already knew about. It
      created a genuine duplicate `shows` row instead — the duplicate's
      own `external_ids` insert then silently no-ops against the
      original's existing row (unique on `(entityType, source,
externalId)` alone), but nothing then stopped
      `backfillExternalIdBundle` (`apps/api/src/lib/external-match.ts`)
      from giving the duplicate a _wrong_ external_ids row of its own —
      the raw, uncorrected id, since `entityId` differs so no unique
      index caught it. Found live: Carol's Plex account produced four
      separate "Formula 1" shows on dev over the course of testing (the
      real one with James's 343-play history, plus three junk
      duplicates holding one or two of Carol's plays each), which broke
      the Dashboard's On Deck/Up Next rows outright (500s) once one of
      the duplicates' broken external id got queried directly.\
      Fixed by re-checking `lookupShowByExternalId` against the
      _canonical_ (corrected) id before creating a new show, reusing the
      existing one if found. Manually repaired the already-corrupted
      data on both dev (3 duplicate shows, 2 misplaced plays) and prod
      (1 duplicate, 1 misplaced play) by repointing the misplaced plays
      to the correct show's matching episodes and deleting the orphaned
      duplicate show rows — a one-off data fix, not something the code
      change itself could retroactively undo.

- [x] **Fixed: switching accounts needed a hard refresh, and a first attempted fix broke login/logout outright** (2026-08-24 21:15 added, done 2026-08-24) — M2\
      James's ask, from real multi-account use: switching between "James
      Bulman" and "Carol Bulman" on a shared browser needed an F5/Ctrl-F5
      to see accurate content — login/logout only ever invalidated the
      `['auth','me']` query, leaving every other cached query (library,
      history, on-deck, show/episode pages, ...) holding the _previous_
      account's data, compounded by a 30-second default `staleTime` that
      meant React Query wouldn't even attempt a background refetch in
      that window.\
      First attempt — `queryClient.clear()` plus an explicit
      `refetchQueries(['auth','me'])` on both login and logout — made
      things _worse_, not better: clicking Log in or Log out visibly did
      nothing until a hard refresh, live-verified repeatedly on dev.
      Chased several wrong leads before finding the real cause (a 503
      that turned out to be a real but unrelated intermittent glitch,
      ruled-out browser extensions, ruled-out nginx-pm config — dev has
      an IP-allowlist prod doesn't, but it wasn't the cause either).\
      The decisive test, at James's suggestion to compare _code_ rather
      than infra: temporarily reverted dev's `Sidebar.tsx`/`LoginPage.tsx`
      to byte-identical copies of what prod was still running (the
      original plain-`invalidateQueries` version, since prod hadn't been
      promoted past commit `e297c92` yet) — dev worked perfectly with
      that code, conclusively proving the `clear()`+`refetchQueries`
      change itself was the bug, not environment. Root cause:
      `queryClient.clear()` destroys the `['auth','me']` query object
      entirely; calling `refetchQueries` on that same key immediately
      afterward races against React re-subscribing `AuthProvider`'s
      already-mounted observer to a freshly-recreated query — the
      refetch call can find nothing to refetch yet and silently no-ops,
      leaving `user` stuck until something forces a remount (a hard
      refresh).\
      Real fix: `queryClient.removeQueries({ predicate: (query) =>
query.queryKey[0] !== 'auth' })` — drops every _other_ cached query
      but leaves `auth/me`'s own query object, and therefore
      AuthProvider's live observer, untouched — followed by a plain
      `invalidateQueries(['auth','me'])`, the same call that already
      worked reliably before any of this. Live-verified on dev: login and
      logout both update immediately, and switching between James's and
      Carol's accounts no longer needs a refresh to show correct content.

## Auth & accounts

- [x] **"Forgot password" / account recovery, and email verification** (2026-08-23 15:46 added, done 2026-08-25) — M2\
      No password-reset flow existed for local accounts — a locked-out
      user had no self-service way back in. James, mid-build: fold in
      email verification too, since it needs the exact same outbound-email
      groundwork.\
      **Design pass before building** — the real decision was email
      transport. Considered SMTP vs. a transactional-email API (Resend,
      Postmark, etc.); went with plain SMTP deliberately, matching this
      project's existing "bring your own credentials" pattern (TMDB/TVDB/
      Trakt) rather than taking a dependency on one vendor's SDK — any
      self-hoster's own mail relay works (Gmail with an App Password, a
      transactional provider's own SMTP endpoint, a self-run server).
      James is running it against Gmail SMTP with a dedicated App Password
      for `james.bulman@rwnd.tv`.\
      **Schema**: `users.emailVerifiedAt` (nullable timestamp) plus two new
      single-use hashed-opaque-token tables, `password_reset_tokens` and
      `email_verification_tokens` — same `generateSecret`/`hashSecret`
      pair sessions/API tokens already use, deleted on redemption whether
      valid or not (no `usedBy` accountability need like `invites` has).
      Migration 0017 backfills `emailVerifiedAt = createdAt` for every
      account that existed before this shipped — already-in-use accounts
      aren't retroactively asked to reverify an address that was working
      fine; only accounts registered from here on start out unverified.
      The first-run admin account (`POST /setup`) is pre-verified too,
      not sent an email — that's the person deploying the instance, not
      someone whose address needs confirming.\
      **New env vars** (`apps/api/src/env.ts`): `SMTP_HOST`/`PORT`/`USER`/
      `PASS`/`FROM` + `APP_URL` (needed to build the actual links a sent
      email points at — no reliable way to derive a public URL from a
      request's own Host header behind an arbitrary reverse-proxy setup).
      All required together once `SMTP_HOST` is set, same "optional
      group, feature hides itself when unset" pattern as `TRAKT_CLIENT_ID`/
      `BACKUP_DIR`. New `instanceSettingsSchema.emailConfigured` flag
      (`GET /settings`) gates LoginPage's "Forgot password?" link and
      ProfilePage's resend-verification action — redeeming a token you
      already have (`POST /auth/reset-password`, `POST /auth/verify-email`)
      isn't gated the same way, since that only needs the token to still
      be valid, not SMTP to be configured right now.\
      **New routes** (`apps/api/src/routes/auth.ts`): `POST
/auth/forgot-password` (always 204 regardless of whether the email
      matched an account — anti-enumeration, same reasoning as login's
      generic "invalid email or password"), `POST /auth/reset-password`
      (redeems the token, updates the `local` credential, then
      `revokeAllSessions` — new session.ts helper — the standard
      "changing your password logs out everyone else" practice), `POST
/auth/verify-email`, `POST /auth/resend-verification` (drops any
      previously-issued token for the user first). Registration
      (`POST /auth/register`) now also sends a verification email,
      best-effort — a broken SMTP relay logs server-side but doesn't fail
      the registration itself, since the account was already created.\
      **New frontend pages**: `ForgotPasswordPage.tsx`, `ResetPasswordPage.tsx`,
      `VerifyEmailPage.tsx` (public routes, same shape as LoginPage/
      RegisterPage). `VerifyEmailPage.tsx` fires its `POST` via `useQuery`
      on mount rather than an imperative `useMutation` in a `useEffect` —
      React Query dedupes an identical in-flight query across a
      StrictMode double-mount, so the single-use token only actually gets
      redeemed once; the equivalent effect+mutation would consume it
      twice in dev.\
      **Found live while testing, built the same session**: no way to
      change a password while already logged in — the reset flow was the
      _only_ path to a new password, even for someone who already knew
      their current one. Added `POST /auth/me/password` (current-password
      check via `verifyPassword`, then the same credential-update code
      reset-password uses) plus a new `revokeOtherSessions` session.ts
      helper — deliberately keeps the session making the request alive
      (unlike reset's `revokeAllSessions`), since proving you know both
      the current and new password isn't the same situation as an
      anonymous reset.\
      **Profile → Account, same day, then two quick follow-up tweaks**:
      James asked for the page (still `/profile` at the time) to be
      renamed "Account" and laid out as named sections. Final shape,
      after two more small asks the same session: page title "Account"
      with Log out inline on the same row, top-right (started as its own
      bottom-of-page section, moved here since James wanted it reachable
      without scrolling past everything else); then Profile (photo,
      display name — moved to lead the page after first landing lower
      down); then Email + Change Password with no section heading of
      their own (the page's own "Account" title already says what they
      are); then Preferences (language, theme); then Advanced Preferences
      (spoiler protection, on-deck fill-gaps — collapsed by default, a
      native `<details>` rather than bespoke show/hide state, for free
      keyboard support). Route moved `/profile` → `/account`;
      `ProfilePage.tsx`/`ProfileForm.tsx`/`components/profile/` all
      renamed/split into `AccountPage.tsx` and `components/account/`'s
      `EmailCard.tsx`/`ChangePasswordCard.tsx`/`ProfileCard.tsx`/
      `PreferencesCard.tsx`/`AdvancedPreferencesCard.tsx`/
      `LogoutButton.tsx` (a plain button once it stopped being its own
      section, no `Card` wrapper) — Profile/Preferences/Advanced
      Preferences each save independently (`updateProfileRequestSchema`'s
      fields are already all optional, so each card's mutation just
      sends its own subset) rather than one cross-card form, matching
      the section split visually. `profile.*` i18n namespace renamed to
      `account.*` in both locales, plus three new section-title keys;
      `nav.profile` → `nav.account`.\
      **A real incident during testing, not just a design note**: asked
      James to test SMTP delivery against his own real account early on;
      he confirmed the email arrived but I never redeemed that link.
      Later, testing the _separate_ throwaway test account's reset flow,
      he pasted that older real-account email's link by mistake (both
      emails share the identical subject line) — I redeemed it without
      realizing, which actually changed his real account's password and
      revoked its sessions. Caught immediately via direct DB verification
      (argon2 `verify()` against the stored hash, run inside the
      container) once the throwaway account's own login unexpectedly
      failed with the "right" password. Told James immediately with the
      actual temporary password so he could get back in, rather than
      quietly investigating first — he confirmed logging back in worked.
      Net result was a real (if unintended) live confirmation that
      redemption, credential update, and session revocation all work
      correctly end to end.\
      **Verified live on `dev.rwnd.tv`**, throughout, including some
      unintentionally: SMTP-unconfigured default state (no login link, a
      clean "Email is not configured" error rather than a bad failure);
      real Gmail SMTP delivery for both verification and reset emails
      (with a real From-header gotcha found and fixed along the way —
      Gmail's SMTP silently rewrites an unverified From address to the
      authenticated account's own, since `SMTP_FROM` wasn't yet a
      verified "Send mail as" alias); verification click-through and its
      single-use enforcement (replaying the same link correctly shows
      "invalid or has expired"); full reset-password completion including
      session revocation (proven, if by accident, against a real
      account); change-password's wrong-password rejection, the updated
      password taking effect, and the initiating session staying alive
      while the old password stopped working; and, after the Account
      rename, the final page layout itself — every section in the right
      place, Advanced Preferences collapsed by default and expanding on
      click.

- [x] **Change email address (with verification before it takes effect)** (2026-08-25 added and done)\
      James, naming this and Delete account (see TODO.md) the remaining
      holes in account management once the rest of Account had shipped.
      Explicit requirement: the new address has to be verified _before_
      the change is allowed, not after — so `users.email` isn't touched
      at all until a confirmation link sent to the _new_ address is
      actually clicked.\
      New `email_change_tokens` table (migration 0018) — same hashed-
      opaque-token/deleted-on-redemption shape as `password_reset_tokens`/
      `email_verification_tokens`, but also carries the candidate
      `newEmail` itself (as `citext`, matching `users.email`'s case-
      insensitive uniqueness), since nothing on the user row changes
      until redemption. Deliberately a separate table rather than
      reusing `email_verification_tokens` with an implicit "does this
      user have a pending address?" branch — see its doc comment in
      schema.ts.\
      `POST /auth/me/email` (requireAuth + requireEmailConfigured —
      pointless without SMTP to deliver the confirmation) re-proves the
      current password first (same reasoning as `POST /auth/me/password`:
      a stolen session cookie alone shouldn't be able to redirect where
      account-recovery mail goes), rejects an unchanged address and one
      already claimed by another account, then creates the token and
      emails the _new_ address via a new `sendEmailChangeVerification`
      (never the current address — confirming ownership of the new one
      is the whole point). `POST /auth/confirm-email-change` (public, no
      auth — same reasoning as `/auth/verify-email`/`/auth/reset-password`:
      redeeming a token you already have doesn't need you logged in as
      anyone) redeems the token, re-checks the address is still free
      (someone else could have claimed it since the token was issued),
      then writes `users.email`/`emailVerifiedAt` together — the
      confirmation click itself is what proves ownership, so the new
      address is already verified the instant it's set, same as a
      fresh registration link.\
      `EmailCard.tsx` grew a "Change email" toggle (gated on
      `emailConfigured`, same as the resend-verification action) that
      reveals a small new-email/current-password form; new
      `ConfirmEmailChangePage.tsx` (`/confirm-email-change`) mirrors
      `VerifyEmailPage.tsx`'s `useQuery`-on-mount shape for the same
      StrictMode-double-mount reason.\
      **Verified live on `dev.rwnd.tv`** against the throwaway test
      account (not James's real one, learning from the earlier reset-
      link mix-up): wrong-current-password rejected, changing to an
      address already in use (James's real account) rejected, a real
      Gmail-delivered confirmation email (once located — Gmail was
      silently applying a filter that skipped the inbox and marked it
      read, unrelated to delivery itself, which still succeeded every
      time), confirming actually swaps the email and marks it verified,
      logging in with the old address stops working while the new one
      works immediately, replaying the same confirmation link correctly
      shows "invalid or expired", and the "Change email"/Cancel toggle
      in the UI itself.

- [x] **Delete account** (2026-08-25 added and done)\
      James, naming this and change-email (done, above) as the remaining
      holes in account management. Specific asks: bottom of the Account
      page, a warning plus a red button (not just the button), and a
      confirmation dialog requiring the account's email and current
      password re-entered.\
      `DELETE /auth/me` (requireAuth): re-verifies the current password
      first (same "prove you know it" reasoning as change-password/
      change-email), then checks the typed email matches the account's
      actual one — that check isn't itself a security gate (the password
      is), just a deliberate extra step against an accidental click, the
      same "type the repo name to confirm" pattern GitHub uses. No new
      migration needed — every table referencing `users` already
      cascade-deletes on the FK (`plays`, `ratings`, `watchlist_items`,
      `dropped_shows`, `sessions`, `api_tokens` and in turn its own
      `webhook_account_links`/`pending_webhook_events`,
      `user_credentials`, `trakt_connections`, `import_jobs`, and the
      three account-token tables), so `DELETE FROM users` alone does the
      whole job.\
      First cut, unilaterally rather than asked about: an admin who's the
      instance's _only_ admin can't delete their own account — no route
      exists yet to promote another user to admin, so blocking felt like
      the safer failure mode versus an instance permanently losing access
      to Settings > Instance for everyone. James, same session, wanted
      something simpler as a first step instead while he thinks through
      what "more sophisticated" should actually look like: **no admin
      account can delete itself at all**, full stop, not just a sole
      admin — both server-side (`DELETE /auth/me` 403s any admin,
      checked first, before even looking at the password/email fields)
      and in the UI (`DeleteAccountCard.tsx`'s button disabled with an
      explanatory note, rather than the whole card hidden — same "still
      visible, just not usable, with a stated reason" shape as Clear
      database's own disabled state in DatabasePanel.tsx). The server
      check is what actually matters; the disabled button is only ever a
      UX convenience layered on top.\
      New `DeleteAccountCard.tsx`, last on AccountPage.tsx, deliberately
      — the most destructive action on the page shouldn't compete for
      attention with everything above it. Red `<h2>` title (not just the
      button), a warning paragraph, then the dialog (built on the
      existing `Dialog.tsx`, same component DatabasePanel.tsx's own
      destructive-action confirmations already use) with email +
      password fields and a red submit button.\
      **Verified live on `dev.rwnd.tv`**, in two passes. Against the
      throwaway test account (conveniently retiring it at the same time
      — the one thing still outstanding from earlier in the session):
      wrong-password and mismatched-email both correctly rejected;
      temporarily promoting the test account to a second admin and
      deleting it still succeeded at the time (the original sole-admin-
      only rule, before the same-session revision above) without being
      blocked; the account, and everything under it, fully gone from the
      database afterward with no orphaned rows or FK errors, and its old
      credentials immediately stopped working for login. After the
      revision to a blanket admin block: called `DELETE /auth/me`
      directly against James's real (admin) session with deliberately
      wrong email/password, confirmed a 403 "Admin accounts can't be
      deleted" came back before either confirmation field was even
      checked, and confirmed his account was completely untouched
      afterward (`GET /auth/me` unchanged) — proving the block runs
      first and is unconditional, not something a self-hoster could
      route around by knowing the right password. Disabled-button UI
      state (faded button + "Admin accounts can't be deleted yet." note)
      confirmed visually against James's real account too.

- [x] **Require SMTP before registration/setup can be open, and validate the account-management pathways end to end** (2026-08-25 added and done)\
      James: SMTP being configured should be a hard prerequisite for
      opening account creation at all — including `/setup`'s first-admin
      creation, not just ordinary `/register` — since the first admin's
      address needs the same verification machinery as everyone else's.
      When it isn't configured, the landing/setup/register page should
      show a bold warning rather than offering a form that can't actually
      work.\
      `POST /setup` and `POST /auth/register` both now 403 with
      `isEmailConfigured()` checked first — for register, ahead of the
      existing `registrationMode` check, so it blocks even when an admin
      has explicitly set registration to "open". `SetupPage.tsx` replaces
      its form entirely with a bold red warning card
      (`setup.emailRequiredTitle`/`emailRequiredBody`) when
      `usePublicSettings().emailConfigured` is false and setup is still
      required; `RegisterPage.tsx` gets an equivalent blocked card
      (`register.emailNotConfigured`) alongside its existing
      registration-closed one; `LoginPage.tsx`'s "Register" prompt now
      also checks `emailConfigured`, on top of the existing
      `registrationMode` check, so it doesn't link somewhere that would
      just bounce. Login itself is untouched by any of this — an
      instance with existing accounts keeps working normally even if
      SMTP later goes away; only _creating_ an account needs it.\
      **Verified live**, on a genuinely separate throwaway instance
      rather than `dev.rwnd.tv` (registration completing/deleting
      accounts there would be indistinguishable from real usage): a
      sibling Postgres database on `rwnd-tv-dev-postgres`
      (`rwnd_setup_test`, later a second one, `rwnd_setup_test2`, for the
      no-admin-yet case), and a throwaway container from the same
      already-built `rwnd-tv-dev:local` image, `--env-file` pointing at a
      copy of the real dev env with only `DATABASE_URL`/`SMTP_HOST`
      overridden (generated with `sed` entirely server-side so no
      credential ever appeared in a command or its output), on the same
      `docker_default` network so it could reach Postgres by container
      name. Both fully removed afterward (`docker rm -f`, `DROP
DATABASE` ×2) — zero residue.\
      Covered, across three container runs on that instance: (1) SMTP
      configured, no admin yet — `/setup`'s real form renders and
      completing it works exactly as before, admin created
      pre-verified; (2) same database (admin now exists), SMTP stripped
      — `/register` returns the new blocked message via the API even
      with `registrationMode` explicitly set to `open`, the "Register"
      link disappears from `/login`, and logging in as the existing
      admin still succeeds normally; (3) a brand-new empty database,
      SMTP stripped from the start — `/setup` shows the bold warning
      card with no form, and `POST /setup` called directly (bypassing
      the UI entirely) still 403s, proving the block is real
      server-side enforcement and not just a hidden form.\
      Also covered, against that same instance's admin/second-user
      accounts, the four other pathways James asked to have validated
      rather than just reasoned about: submitting your own current
      address to `POST /auth/me/email` is rejected with "That's already
      your email address" (a genuinely different address still
      succeeds, 204); changing your password from one logged-in session
      revokes a second, separate session for the same account (401 on
      its next request) while the session that made the change stays
      alive (200); and deleting an account that actually has data
      attached — a movie play, an episode play, a rating, a watchlist
      entry, and a dropped show, seeded directly via SQL rather than a
      real TMDB lookup, since only the FK cascade was under test —
      removes the user row and every one of those rows cleanly (0 left
      in each table afterward) while leaving the shared `movies`/`shows`
      rows themselves untouched, confirming the cascade is scoped to the
      user and doesn't reach into shared library data.

## Import

- [x] **Build ZIP-upload import from Trakt's own "Export now" file** (2026-08-24 22:50 added, investigated 2026-08-24, done 2026-08-25) — M2\
      James's idea, from researching Trakt's free-vs-VIP situation:
      Settings > Data > "Export now" on trakt.tv gives any account
      (free or VIP) a ZIP of separate JSON files, no API/OAuth connection
      needed. Real motivation, not just convenience: Trakt's 2026
      "Community App" policy caps free accounts at _one_ connected
      third-party OAuth app at a time — a free user who already has a
      different Trakt-connected app (a Plex scrobbler, Kodi plugin, etc.)
      can't also OAuth-connect rwnd.tv's importer without disconnecting it
      first or paying for VIP. A file-upload import sidesteps that
      entirely.\
      **Scoped deliberately in two passes** rather than guessing at
      unverified shapes: the first investigation (James's own export,
      11,261 history items) found the per-type ratings files and the
      watchlist file empty (James hadn't used either Trakt feature), so
      the first build shipped history + dropped shows only, verified
      against that real data, with ratings/watchlist explicitly deferred
      rather than built against a guessed shape. James then added real
      ratings and watchlist entries on trakt.tv and re-exported; that
      second export confirmed the ratings/watchlist files match
      `TraktRatingItem`/`TraktWatchlistItem` field-for-field (plus a few
      harmless extra fields — `rank`, `id`, `notes`, `my_rating` on
      watchlist entries — already ignored, same convention as history's
      extra `plex`/`aired_episodes` fields), so ratings/watchlist support
      was added the same session.\
      **Architecture**: refactored the OAuth importer
      (`apps/api/src/import/trakt.ts`) so its paging/matching engine
      (`runImportJob`) is shared between both entry points rather than
      duplicated — `runTraktImport` (OAuth) and the new
      `runTraktZipImport` each only supply a `PageFetcher` (Trakt API
      pages vs. slices of an already-parsed export), while dedup,
      backfill, and failure tracking are identical either way. New
      `apps/api/src/import/trakt-zip-parse.ts` unzips the export (via
      `fflate`) and concatenates the numbered `watched-history-*.json`
      shards plus the four ratings files. New plain (non-`.openapi()`)
      route `POST /import/trakt/zip` (multipart upload, same convention as
      `PUT /auth/me/avatar`) — deliberately not gated behind
      `requireTraktConfigured`, since the whole point is working without
      an OAuth app configured on the instance at all. `import_jobs.source`
      gained a `trakt_zip` enum value (migration 0019) so
      `apps/api/src/index.ts`'s server-restart job recovery can tell the
      two apart: an OAuth job resumes from its Trakt-side cursor as
      before, but a ZIP job caught `running` mid-flight is marked
      `failed` (asking the user to re-upload) rather than resumed, since
      the parsed export only ever lived in that one request's memory, not
      persisted anywhere.\
      **UI**: `TraktZipImportCard.tsx` added alongside the existing
      `TraktConnectCard.tsx` on `ImportPage.tsx`, shown even when
      `!traktConfigured`. James asked for the two cards to read as
      consistent, parallel options rather than differently-shaped UI —
      final shape: each card leads with a description, then an unlabeled
      "set up the source" step (Connect account / Choose file), then a
      divider, then a "Start an import" step with matching phrasing
      ("Choose what to bring in from Trakt"/"...from the file. Re-running
      an import is safe — it won't create duplicates.") and the same four
      checkboxes where applicable. The file card's "Start an import" step
      stays hidden until a file is actually chosen, matching the OAuth
      card's own "hidden until connected" behaviour.\
      **Verified against real data, twice**, via a throwaway account on
      `dev.rwnd.tv` each time (never against James's own real account
      data) — first pass: 11,410 real items (11,261 history + 149
      dropped), 11,392 imported, 16 genuine failures, ~3m15s; second pass
      (ratings/watchlist added): 11,426 items, all 7 real episode ratings
      and all 5 real watchlist entries landed correctly (checked directly
      via `psql`). Full 255-test API suite passing throughout, including
      8 new ZIP-specific tests (success, malformed/missing file, size
      cap, 409-on-concurrent-job, idempotent re-upload, include toggles,
      cross-user access). Each throwaway test account was deleted by
      James afterward, since importing his real data into a scratch
      account for testing purposes isn't something to leave lying
      around.\
      **Found along the way, both now documented rather than fixed**:
      (1) Trakt's dropped-shows data can be _season-level_, not just
      whole-show (e.g. hiding just one season of "Doctor Who" separately
      from another) — `droppedShows`'s schema has no per-season concept,
      so these report cleanly as "Season-level entries are not yet
      supported" failures rather than crashing or misapplying; fixing the
      misleading old wording ("...ratings/watchlist entries...", from
      when `matchTraktMediaItem` only served those two phases) was a
      quick follow-up once the dropped phase started hitting the same
      code path. (2) Comparing the same real Trakt account's dropped-show
      count between the OAuth path (99 shows) and the ZIP path (138
      shows, on a fresh account, re-confirmed with a second live OAuth
      re-import an hour later — still 99, ruling out a timing artifact)
      surfaced that the live `GET /users/hidden/dropped` endpoint silently
      omits a large, stable set of genuinely-still-dropped shows. A web
      search turned up a Trakt forum thread reporting the exact same
      behaviour (reproduced live by another user, staff-acknowledged,
      still unresolved as of its last reply) — confirmed as an external,
      unfixed Trakt API bug rather than anything on rwnd.tv's side, so
      left as a documented limitation rather than something to work
      around.
