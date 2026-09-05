# 0006: Multi-provider metadata plumbing

## Status

Accepted

## Context

Every metadata lookup in rwnd.tv assumed exactly one provider, TMDB, hardcoded by string literal rather than read from context: `MetadataProvider.source` was typed as the literal `'tmdb'`, the Trakt import matcher and the metadata refresher both queried `external_ids` with `source = 'tmdb'` baked into the SQL, and the `METADATA_PROVIDER` env var only ever had one legal value. `docs/TODO.md` tracked this as "fairly fundamental": the plumbing needed before a second provider (Wikidata/TVDB, a separate "not yet scheduled" item) could exist at all, without requiring one to exist yet.

The concrete motivation was a live Trakt import failure: a title (Formula 1) had no `tmdb` id in Trakt's payload and couldn't be resolved even though Trakt had handed over `imdb`/`tvdb` ids nobody read. `[ADR 0002](0002-metadata-provider.md)` had already anticipated this: `external_ids`' `(entity_type, source, external_id)` shape and the plain-`uuid` internal ids on `shows`/`movies` were deliberately built to let a second provider's ids coexist without a migration. What was missing was the code actually using that flexibility: a real reverse-lookup fallback, an admin-facing notion of provider priority, and a way to show which provider a given row's cached fields actually came from.

## Decision

- **No new internal id.** `shows.id`/`movies.id` were already provider-independent `uuid`s, and `external_ids` already supported multiple providers per entity. This ADR is about removing the code's hardcoded `'tmdb'` assumptions, not introducing a new identifier scheme.
- **`MetadataProviderSource` (`packages/shared/src/schemas/common.ts`) is a 2-of-4 subset of `external_id_source`**: `'tmdb' | 'tvdb'`, excluding `imdb`/`trakt`. Those two are id namespaces things get looked up _by_ (Trakt hands them out, TMDB can resolve them via `/find`), never systems metadata is fetched _from_; typing them as providers would be a lie the compiler couldn't catch.
- **Widened where the value is genuinely provider-neutral, left narrow where it isn't.** `searchResultSchema.source` and `resolveMediaRequestSchema.source` widened (both are server-produced/round-tripped, and the resolve handlers already ignore the field). `createPlayRequestSchema`'s `source` stayed `z.literal('tmdb')`: it's client-authored from a hardcoded `tmdbId` field and the handler ignores it entirely, so widening it now would let a request claim a source it doesn't actually use.
- **`findByExternalId` on `MetadataProvider`**, implemented via TMDB's `/find/{external_id}?external_source=imdb_id|tvdb_id`. `matchMovie`/`matchShow` (`apps/api/src/import/match.ts`) now try Trakt's `tmdb` id first, then fall through to this reverse lookup on `imdb`/`tvdb`, including when the `tmdb` id is present but rejected by the provider (merged/deleted/wrong id). A pre-existing caching gap came with it: `matchShow` only cached a thrown `resolveShow` failure, not "no `tmdb` id and nothing found," so a show with no findable id and N watched episodes made N redundant lookups instead of one; fixed by caching both failure shapes identically.
- **`METADATA_PROVIDER` is gone.** Which providers exist is now derived from which credentials are actually set (`createMetadataProviders`, `apps/api/src/providers/index.ts`): `parseEnv` just requires at least one (today: `TMDB_API_KEY`) rather than gating on an explicit enum choice. A self-hoster adding a second provider's key later doesn't need to flip a separate switch to have it picked up.
- **Priority is an admin-editable instance setting, not env**: `instance_settings.metadata_provider_priority` (`text[]`, migration `0011`), following `default_locale`'s existing precedent (app-validated free text, not a Postgres enum, since an ordered list doesn't fit an enum's model). `orderedProviders` (`apps/api/src/providers/priority.ts`) drops any stored entry this instance no longer has credentials for, and appends any configured-but-unlisted provider at the end rather than hiding it: a provider a deployment gains credentials for is visible immediately, not invisible until someone remembers to edit the setting.
- **The priority-order UI ships read-only.** `InstanceSettingsPanel.tsx` shows "Metadata providers: 1. TMDB" as plain text. With only one provider ever configured today, reorder controls (up/down buttons, not drag-and-drop; a realistic list is 2-3 entries) would ship untestable and unexercisable; the backend already supports patching a full ordered list, so adding the controls later is additive UI work, not a schema or API change.
- **Provenance is stored at write time, not derived at read time.** New `shows.metadata_source`/`movies.metadata_source` columns (migration `0012`, backfilled from existing `tmdb` external ids) record which provider actually wrote a row's cached fields. The rejected alternative, deriving it as "the highest-priority provider that currently has an id for this row," silently reinterprets history the moment the priority order changes: a row genuinely fetched from provider A would start claiming provider B's name the day an admin reorders the list, even though nothing about the cached data changed.
- **Priority is only consulted where fallback semantics already existed**: the metadata refresher (`pickRefreshTarget`/`pickRefreshTargets`, `apps/api/src/metadata/refresh.ts`) and the manual "refresh metadata" routes. Search, resolve, and episode/season fetches still run against the single primary provider from `AppEnv` (`metadataProvider`, distinct from the new `metadataProviders` array), a deliberate, named seam, not an oversight: `resolveSeason`/`resolveShowEpisodes`/`findNextUnwatchedEpisode` (`apps/api/src/lib/media.ts`) take a bare `showExternalId: string` with no source tag, which is safe with one active provider and will need source-tagging before a second one can genuinely compete for these paths.
- **No cross-provider reconciliation.** If two providers' ids ever pointed at "the same" real-world title, they'd produce two unrelated local rows: `external_ids`' `(entity_type, source, external_id)` uniqueness has nothing that would catch or merge that. Not solved here, and not needed until a second provider exists to create the situation.
- **Backups are deliberately unchanged.** `backupMovieSchema`/`backupShowSchema` still key an entity by a bare `tmdbId` string, and `formatVersion` is a hard equality check on restore: changing the key shape means either a version bump plus a dual-read path, or every existing backup file becomes unrestorable. Nothing this work introduces creates an entity without a TMDB id (the `findByExternalId` fallback resolves _to_ a TMDB id when it succeeds), so there's no forcing function yet. The future shape, when one exists: bump to `formatVersion: 2`, replace `tmdbId: string` with `externalIds: Array<{ source, externalId }>`, and read a v1 file's `tmdbId` as `[{ source: 'tmdb', externalId }]` on restore.

## Consequences

- **Formula 1 is still not importable.** The `findByExternalId` fallback fixes the general case (a stale or missing Trakt `tmdb` id where TMDB does hold a matching entry), not the specific anecdote that motivated it. TMDB has no entry for Formula 1 under any id, so no lookup, by any means, finds one. Verified live: re-running a real Trakt import left the same 372 unmatched items, same composition, before and after this work landed.
- **`AIRING_STATUSES` (`apps/api/src/metadata/refresh.ts`) remains TMDB's own status vocabulary verbatim.** A second provider with a different status model will need this mapped, not just widened; deferred along with the provider itself.
- **The priority-order UI is read-only until there's a second entry to order.** Tracked above as a deliberate scope cut, not forgotten.
- **`METADATA_PROVIDER` disappearing is a config-surface change**, not just an internal refactor: existing deployments carrying it in their env file are unaffected (an unrecognised env var is silently ignored), but it's no longer read for anything.
- Supersedes part of `[ADR 0002](0002-metadata-provider.md)`'s "selected via `METADATA_PROVIDER=tmdb`" framing (selection is now credential-driven) and partially closes the gap `[ADR 0005](0005-metadata-refresh.md)` flagged in its own Consequences: the refresher no longer hardcodes `source = 'tmdb'`, though its season/status caching itself is still TMDB-shaped, per the `AIRING_STATUSES` point above.

## Update (2026-08-30)

The "priority-order UI ships read-only" decision above no longer holds:
`InstanceSettingsPanel.tsx` now has real reorder controls (up/down buttons,
as anticipated) now that TheTVDB is a second configured provider on real
instances and there's an actual order worth changing. The backend needed no
changes; this was always additive UI work on top of the existing
patch-a-full-ordered-list API, exactly as predicted.

## Update (2026-09-01)

Two things shift for the `imdb` id namespace with the "View on IMDb" deep
link (`docs/TODO_ARCHIVE.md`), though the core invariant from this ADR's
Decision above holds unchanged: `imdb` is still not a
`MetadataProviderSource`, and still never a system metadata is fetched
_from_.

- **`imdb` ids are now fetched, not just received.** Previously an `imdb`
  `external_ids` row only ever arrived via Trakt import
  (`apps/api/src/import/match.ts`'s `backfillExternalIds`) or a webhook/CSV
  match (`apps/api/src/lib/external-match.ts`'s `backfillExternalIdBundle`).
  `TmdbProvider`'s
  `getMovie`/`getShow`/`getEpisode` (`apps/api/src/providers/tmdb.ts`) now
  also read an `imdb_id` straight out of the same TMDB response
  `resolveMovie`/`resolveShow`/`resolveEpisode` already fetch (free for
  movies, one extra `append_to_response=external_ids` for shows/episodes)
  and write it as a second `external_ids` row (`apps/api/src/lib/media.ts`'s
  `upsertExternalId`). Still not a reverse-lookup _source_ the way
  `findByExternalId` treats `imdb`/`tvdb`: this is TMDB handing over a
  value it already holds, not TMDB being asked to resolve an `imdb` id into
  anything.
- **The namespace now has an outbound use, not just inbound matching.**
  Until now every `imdb` id existed purely to help _find_ a local row
  (`findByExternalId`, `findViaAlternateIds`). The new `imdbId` field
  (`showDetailSchema`/`movieDetailSchema`/`episodeImdbSchema` in
  `packages/shared/src/schemas`) is the first read of it for something a
  user actually sees: a plain text "IMDb" link on the show/movie/episode
  detail pages (`apps/web/src/lib/imdb.ts`). Deliberately a plain text
  link, not a logo, the inverse of TMDB's/TVDB's own terms, which
  _require_ their logos: IMDb's conditions of use forbid using their
  trademark as a link's clickable
  element without written permission.

## Update (2026-09-05)

This ADR's Decision above named `resolveSeason`/`resolveShowEpisodes`/
`findNextUnwatchedEpisode` as "a deliberate, named seam" that would "need
source-tagging before a second one can genuinely compete for these
paths" — that seam is now partly crossed, for one specific field.

Investigating `docs/TODO.md`'s History calendar feed timed-events item
found that episode `runtimeMinutes` was missing for 38 real watched
episodes (8 shows, always as whole-season gaps), and that the manual
"refresh metadata" button silently failed to fix it: `resolveSeason`
still calls only the primary provider, and its `onConflictDoUpdate` only
ever wrote `overview`/`overviewCheckedAt`, treating `runtimeMinutes` as
write-once. All 31 affected shows had `metadata_source = 'tmdb'`, and 29
of them already carried a usable `tvdb` id.

Rather than widening `resolveSeason` itself (it sits on hot paths — the
Dashboard's Up Next scan, both "Watched" buttons, webhook ingest, CSV
import — where asking a second provider on every call would double
external traffic for the ~99% of seasons that don't need it), this added
a **field-scoped fallback** instead of a general one:

- `resolveSeason`'s conflict handling now coalesces a still-null
  `runtimeMinutes` from the _same_ provider on a later resolve
  (`apps/api/src/lib/media.ts`), monotone and same-provider so it carries
  none of the risk below.
- A new targeted backfill (`apps/api/src/metadata/refresh.ts`,
  `fillSeasonRuntimesFromFallback`/`backfillEpisodeRuntimes`/
  `backfillShowEpisodeRuntimes`) tries every _other_ configured provider,
  in priority order, for episodes still missing a runtime — run both from
  the background sweep and from the manual refresh button, guarded
  against TMDB/TVDB episode-numbering disagreements (a season-episode-
  count check, plus a per-episode air-date cross-check where both sides
  have one) rather than trusting `(seasonNumber, episodeNumber)` alone.
  New `episodes.runtime_checked_at` column, same "we asked, not we found"
  convention as `overview_checked_at`/`imdb_checked_at`.

This is deliberately narrow, not a general precedent for cross-provider
merging of every field: `firstAired` is the very cross-check the guard
above relies on, and `title` risks mixing a differently-localized name
into an otherwise single-provider episode list. The general seam this
ADR originally flagged — a second provider genuinely competing to be the
_primary_ source for search/resolve/season fetches — is still open.

A reverse `findByExternalId` lookup for the 2 shows with no stored `tvdb`
id was considered and left out: those are skipped without being marked
checked, same tradeoff `backfillEpisodeImdbIds` already makes for a show
with no id on any configured provider.

**Follow-up, 2026-09-05**: reversed. Two things changed since the original
call above. First, the "skipped without being marked checked" tradeoff
turned out to be a real bug, not just a missed optimization: nothing else
ever marks those episodes checked either, so they're re-selected by
`findSeasonsNeedingRuntimeBackfill`'s `ORDER BY show_id, season_number LIMIT
50` every single pass, forever — with enough such shows (not the case
today, but structurally possible) this would starve the drain for every
other show, since stuck seasons always sort first and always refill the
same candidate slots. Second, Blade Runner 2099 turned this from a
hypothetical into a live, confirmed case on the reference instance.
`reverseLookupFallbackTarget` (`apps/api/src/metadata/refresh.ts`) tries the
show's stored `imdb` id against each remaining configured provider — the
one id namespace every provider's `findByExternalId` can search by — and
persists a hit immediately so the cost is one-time, not recurring. A show
still found by neither its own id nor the reverse lookup now gets its
episodes marked checked, closing the original bug regardless of whether the
lookup itself ever helps.

**Follow-up, same day**: deployed to dev.rwnd.tv and verified live against
the real (production-mirrored) library — 13 seasons filled on the first
pass, 0 errors. James separately confirmed the fallback matched the
correct TVDB entry for one anime: TheTVDB lists two unrelated series
under the same English title, `keep-your-hands-off-eizouken` (the 12-
episode 2020 anime, Jan-Mar air dates, matches locally) and
`379607-keep-your-hands-off-eizouken` (a 6-episode 2020 live-action drama
adaptation, Apr-May air dates, different cast) — the fallback resolved to
the former, and Gate A's episode-count check would have caught a
wrong match to the latter regardless (6 vs. the locally cached 12).

That same show did surface a genuine Gate B false-negative: TVDB and IMDb
agree on 2020-01-06 for its episode 1, TMDB alone recorded 2020-01-05,
most likely a JST-midnight rounding quirk in TMDB's own data, not a real
per-episode disagreement. Confirmed live via TVDB's own API before
concluding it was a data quirk rather than a code bug. Gate B now
tolerates up to a 1-day difference (`AIR_DATE_TOLERANCE_DAYS`,
`apps/api/src/metadata/refresh.ts`) rather than requiring an exact match —
loose enough to absorb this class of rounding quirk, tight enough that a
real mismatch (a different season, a different show) still reads as
weeks or months apart, not one day.
