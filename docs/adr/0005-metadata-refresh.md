# 0005: Cached season metadata, with a scheduled refresher

## Status

Accepted

## Context

The TV Shows / Movies gallery pages (a Plex-style poster grid; see [vision.md](../vision.md)'s "explore that data" aim) need a real watched-progress fraction per show, e.g. "154 of 212 episodes". rwnd.tv doesn't have that number anywhere: `episodes` rows are only ever created for episodes a user has actually watched (`resolveEpisode`, `apps/api/src/lib/media.ts`), because that's all the app has ever needed. There's no local record of a show's true total episode count.

Getting one means either fetching it from TMDB on every gallery page view, or caching it, and caching it collides with a compliance obligation from [ADR 0002](0002-metadata-provider.md) that was flagged but never built: TMDB forbids caching their data longer than 6 months, and `movies.metadata_refreshed_at` / `shows.metadata_refreshed_at` were added at launch specifically so a refresh job could enforce that, with a note that "the refresh job itself is not yet built". This ADR is that job, arriving because the gallery needed it rather than because the 6-month clock was independently urgent.

Two more things had to be decided beyond "cache the totals":

- **How much detail to cache.** A flat `total_episodes` column on `shows` would answer the progress-bar question alone. A season doesn't air all at once, though, and a per-season breakdown is what a future show detail page needs: caching only a flat total now would mean a second migration and a second backfill later for the same underlying TMDB response.
- **What "specials excluded" actually means at the data layer.** TMDB's own `number_of_episodes` field on a show doesn't consistently document whether it counts season 0, and season 0 itself mixes real specials with recaps/making-ofs. Getting this wrong silently produces progress bars over 100%.

## Decision

- **A `seasons` table** (`packages/db/src/schema.ts`), one row per `(show_id, season_number)`, storing `episode_count` (plus `name`/`air_date`/`poster_path`), not a flat total on `shows`. The gallery's total is `SUM(episode_count) WHERE season_number > 0`; a future season breakdown reads the same rows. Specials are handled by filtering `season_number > 0` at query time, never by trusting TMDB's own aggregate field: sidesteps the ambiguity entirely rather than resolving it.
- **`shows` gains a `status` column** (TMDB's raw string: `'Returning Series'`, `'Ended'`, `'Canceled'`, etc.), driving how often a show gets rechecked.
- **`MetadataProvider.getShow()` is widened**, not given a new method: TMDB's `/tv/{id}` response already carries `status` and a `seasons[]` array with per-season counts, the same call `getShow` has always made, so surfacing them costs zero extra requests. `resolveShow` (`apps/api/src/lib/media.ts`) stores this immediately when a show is first resolved, so a show created via search or a Trakt import is correct from the moment it exists; the refresher below only has to backfill shows that predate this column and keep existing ones current.
- **One refresh job covers backfill, ongoing airing shows, and the 6-month compliance sweep** (`apps/api/src/metadata/refresh.ts`), rather than three separate mechanisms:
  - a show with no cached `seasons` rows is always refetched (the backfill case: mainly the ~480 shows that existed before this migration);
  - an airing show (`status` in an explicit allow-list of TMDB's non-finished statuses) is refetched once its cached data is more than ~7 days old;
  - anything else, movies included, is refetched once older than ~5 months, ahead of TMDB's 6-month limit.

  The airing check uses an inclusion list rather than `status NOT IN ('Ended', 'Canceled')`: a `NULL` status would make a `NOT IN` predicate evaluate to `NULL` (i.e. false) in SQL, silently exempting that show from ever refreshing on the airing clock. With an inclusion list a `NULL` status just never matches: falling through to the compliance sweep instead, never falling through the cracks.

- **Ended/cancelled shows are not silently rewritten day to day.** This is the same "no silent background updates" preference already recorded in `docs/TODO.md` for multi-provider metadata: the refresher's ~5-month compliance sweep is a licensing floor, not a freshness feature, and is the only thing that ever touches a finished show without a person asking for it. A manual per-show refresh (a later addition, not built in this pass) remains the way to fix a show TMDB itself has wrong.
- **Started at boot, outside `createApp()`** (`apps/api/src/index.ts`), the same way `resumeInterruptedImports` already is: `createApp()` runs inside every API test via `testApp()`, and unattended TMDB traffic must never fire there. Runs once immediately (covering both a fresh backfill and anything that went stale while the process was down), then on a 24h interval.
- **Requests are staggered, and the TMDB client got real 429 handling.** `TmdbProvider.request()` previously threw on any non-OK status including 429, with no retry: fine for a user-initiated search, not for a background job capable of bursting hundreds of calls unattended. It now mirrors the Trakt client's existing retry-once-honouring-`Retry-After` shape (`apps/api/src/trakt/client.ts`). TMDB's documented ceiling is roughly 50 req/s / 20 connections per IP with no daily cap, so the refresher's fixed inter-request delay is deliberately conservative rather than tuned to the limit.
- **The gallery endpoint never calls TMDB.** `GET /library/shows` (`apps/api/src/routes/library.ts`) reads only cached columns; a show with no cached seasons yet reports `totalEpisodes: null` (not `0`) so the UI can show a plain watched count instead of an implied-but-wrong 0% bar.

## Consequences

- A show's progress bar can lag reality by up to ~7 days for an airing show, or show no bar at all until the first backfill sweep reaches it. Preferred over fetching on every page view, which would make the gallery's response time depend on TMDB's.
- TMDB re-cutting a season (fewer episodes than a user has already watched) can make `watchedEpisodes` exceed `totalEpisodes`; the progress bar clamps at 100% rather than overflowing, and the two numbers next to it stay truthful either way.
- Multiple API instances each running their own refresher would duplicate TMDB calls and race harmlessly (every write is an upsert or a scoped `UPDATE`, never a delete); acceptable for a self-hosted, single-container app, but not safe to assume for a future multi-instance deployment without adding real coordination (e.g. a `pg_try_advisory_lock` guard).
- This overlaps the not-yet-built multi-provider metadata item in `docs/TODO.md`: season/status caching here is TMDB-specific, and provider-priority work will likely need to revisit where that data comes from.
- Partially superseded by `[ADR 0006](0006-multi-provider-metadata.md)`: the refresher no longer hardcodes `source = 'tmdb'` when picking which external id to refetch against (it walks the admin-configured priority order instead), but `AIRING_STATUSES` above is still TMDB's own status vocabulary verbatim; a second provider will need it mapped, not just read more flexibly.

## Update (2026-08-30)

Two things this ADR describes as future work have since shipped, in M3:
a manual per-show "refresh metadata now" action exists (the button on the
show/movie page), and `routes/library.ts` was split into
`apps/api/src/routes/library/{index,movies,queue,ratings,seasons,shared,shows}.ts`
during the M3 code-review pass; the gallery endpoint this ADR describes is
now `shows.ts`/`movies.ts` in that directory, not a single file.

## Update (2026-09-01)

The refresh sweep gained a second, bounded job alongside the existing
show/movie refresh: `backfillEpisodeImdbIds` (`apps/api/src/metadata/
refresh.ts`), draining episodes that predate an IMDb id ever being fetched
for them (see `docs/adr/0006-multi-provider-metadata.md`'s own update).
Same "one job, run from the same scheduled entrypoint" precedent as the
rest of this ADR, but deliberately shaped differently from the
show/movie refresh it sits next to:

- **Self-terminating by construction, not by a `findStale*` clause.**
  Every episode a pass touches gets `episodes.imdb_checked_at` set
  regardless of outcome (`apps/api/src/lib/episode-imdb.ts`), so the
  candidate set (`imdb_checked_at IS NULL`) strictly shrinks pass over
  pass, capped at `EPISODE_IMDB_BACKFILL_PER_PASS` per run. This is a
  one-off historical drain, not an ongoing freshness check the way the
  show/movie compliance sweep is: an episode's IMDb id, once known,
  doesn't go stale the way cached title/overview fields do.
- **Deliberately no "never populated" clause added to `findStaleShows`/
  `findStaleMovies`** for a show/movie's own missing `imdb` id, unlike
  every other cached field this ADR's `findStaleShows` comment says needs
  one. At the time this was added, 483/494 shows and 563/580 movies on the
  reference instance already had an `imdb` id (from past Trakt imports),
  unlike `genres`, where the "never populated" set genuinely shrank to
  zero after one sweep; the small residual here mostly lacks an id because
  TMDB itself has none, or the show resolved via TVDB only. A recurring
  clause would match that same handful of rows forever, not just once.
  They self-heal within the existing ~5-month compliance window, or
  immediately via the existing manual refresh button, accepted for a
  supplementary deep link on a small fraction of the library. See
  `findStaleShows`'/`findStaleMovies`' own comments in `refresh.ts`.
- **`refreshOneShow`/`refreshOneMovie` now also correct a show/movie's own
  `imdb` id** (`upsertExternalId(..., { correct: true })`,
  `apps/api/src/lib/media.ts`), unlike the create paths in `resolveShow`/
  `resolveMovie`, which only ever fill a missing id
  (`{ correct: false }`), since most existing `imdb` rows came from
  Trakt/Plex, a source TMDB can now actively correct.
