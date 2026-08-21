# TODO

Smaller, non-milestone work — things to do, watch, or decide. For the
feature roadmap see [ROADMAP.md](ROADMAP.md); for why past decisions
were made see [adr/](adr/).

Format:

- `- [ ] **Title** (YYYY-MM-DD HH:MM added)\`, then details on the next line (trailing `\` forces the line break).
- Blank line between each item.
- Lists sorted oldest to newest.
- Completed items move to [TODO_ARCHIVE.md](TODO_ARCHIVE.md) rather than staying checked off here.

## Repo hygiene

- [ ] **Hold TS 7 bump** (2026-08-09 20:40)\
      `typescript-eslint` doesn't support TS 7 yet; leave any TS 7.0
      Dependabot bump open until it does.

## TV Shows / Movies gallery follow-ups

- [ ] **Manual "refresh metadata" button** (2026-08-19 15:25)\
      The gallery's metadata refresher (see [ADR 0005](adr/0005-metadata-refresh.md))
      auto-refreshes airing shows and sweeps everything every ~5 months for
      TMDB compliance, but there's no per-show manual trigger yet for the
      case TMDB itself has something wrong. Needs a button plus a small
      `POST /library/shows/{id}/refresh`-style endpoint.
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
- [ ] **Status filter section on the Shows gallery** (2026-08-21 01:15)\
      A new filter section for `shows.status` (TMDB's raw string —
      "Returning Series", "Ended", "Canceled", etc., see
      `apps/api/src/metadata/refresh.ts`), same shape as the existing
      Genre/Released/Watched sections in `WatchedYearFilterPanel.tsx` /
      `ReleaseYearFilterPanel.tsx` / `GenreFilterPanel.tsx`.
- [ ] **TMDB rating on the per-show page, plus a rating filter + sort** (2026-08-21 01:15)\
      Show the TMDB rating on `ShowDetailPage.tsx` (not cached in `shows`
      yet — needs a new column, populated the same way `status`/`genres`
      are via `resolveShow()`/the metadata refresher). Then a rating
      filter section on the Shows gallery (range slider, same pattern as
      Released/Watched) and a couple of new sort options
      ("Rating (Descending)"/"(Ascending)").
- [ ] **Three-state "Unknown" toggle in the Watched filter section** (2026-08-21 01:20)\
      `WatchedYearFilterPanel.tsx`'s "Unknown" checkbox is binary today
      (include/exclude unknown-dated shows alongside the After/Before
      range). Want a third state — *only* unknown-dated shows, hiding
      everything else regardless of the range — using the same
      plus/minus include/exclude button UI as `GenreFilterPanel.tsx`
      rather than a plain checkbox. Semantics differ slightly from
      genre's per-item include/exclude (this is one boolean condition,
      not a set of named items): neutral = show both known (in-range)
      and unknown (today's default), exclude = hide unknown entirely
      (today's unchecked state), include = show *only* unknown, ignoring
      the range sliders.

## Metadata & matching

- [ ] **Multi-provider metadata (tmdb/imdb/tvdb)** (2026-08-11 22:20)\
      Right now tmdb id is the only key — a title with no tmdb id
      can't be imported even if it has imdb/tvdb ids (hit this live
      importing Formula 1 via Trakt; TMDB doesn't carry it). Idea: a
      new internal id independent of any single provider, an
      admin-configurable provider priority order, and a manual
      per-title "refresh metadata" action rather than silent
      background updates (explicit preference — don't want metadata
      changing behind anyone's back). Also want a UI indicator on
      show/movie pages showing which provider the current metadata
      came from. Also added to [ROADMAP.md](ROADMAP.md) M2 — fairly
      fundamental, not deferred to "not yet scheduled".
