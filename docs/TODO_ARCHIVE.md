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
