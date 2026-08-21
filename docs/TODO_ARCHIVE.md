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
