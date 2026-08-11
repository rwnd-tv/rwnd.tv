# 0004: Trakt import via OAuth device flow, with reversible token encryption

## Status

Accepted

## Context

M2's first item is Trakt import: history, ratings, and watchlist, matched against existing local records via `external_ids` (see [ADR 0002](0002-metadata-provider.md)). Three things had to be decided beyond "call the Trakt API":

- **How the user authenticates rwnd.tv against their Trakt account.** Trakt supports an authorization-code redirect flow (needs a public callback URL, awkward for a self-hosted instance that may not have one) and a device flow (the user enters a short code on trakt.tv; no callback needed). Trakt's own [device authentication docs](https://docs.trakt.tv/reference/auth) are written for exactly this kind of app.
- **Whether ratings and watchlist need their own tables now.** The roadmap line names all three, but only `plays` existed going into M2 — ratings and watchlist browsing/editing is an M3 item. Importing them without a place to put them would mean re-importing later.
- **Resolving episode metadata at import scale.** `resolveEpisode()` (`apps/api/src/lib/media.ts`) fetches one episode at a time from TMDB — fine for logging a single watch, not for a history that can contain thousands of episodes across a handful of shows.

## Decision

- **Device flow**, self-hosted the same way TMDB is (ADR 0002): each instance registers its own free Trakt app and sets `TRAKT_CLIENT_ID`/`TRAKT_CLIENT_SECRET`. No bundled or shared credentials ship with rwnd.tv.
- **`ratings` and `watchlist_items` tables land now** (`packages/db/src/schema.ts`), using the same polymorphic `(entityType, entityId)` pattern as `external_ids` — no FK across tables, integrity enforced in application code, documented inline the same way. M3 builds browsing/editing UI over data that already exists rather than requiring a second import pass.
- **`MetadataProvider` gains `getSeason()`** (`apps/api/src/providers/types.ts`), returning every episode of a season in one call. The importer (`apps/api/src/import/match.ts`) uses this instead of per-episode fetches, caching per job so a show with many watched episodes only triggers one call per season. This widens the provider interface: a future Wikidata/TVDB adapter (ADR 0002) needs to implement `getSeason` too, not just `getMovie`/`getShow`/`getEpisode`.
- **OAuth tokens are encrypted, not hashed.** Every other secret at rest (`lib/tokens.ts`) is a one-way hash, because sessions and API tokens only ever need comparison. Trakt access/refresh tokens have to be replayed to Trakt on every request and refreshed before their 7-day expiry, so they're AES-256-GCM encrypted (`apps/api/src/lib/crypto.ts`) with a new `ENCRYPTION_KEY` env var, required whenever `TRAKT_CLIENT_ID` is set.
- **Import runs as a resumable background job** (`import_jobs` table, `apps/api/src/import/trakt.ts`), not inside the request. Trakt's own history cap is 100K items; resolving that much metadata takes minutes to hours. Progress (counters plus a `{phase, page}` cursor) is persisted after every page, which is both what drives the UI's progress bar and what lets `apps/api/src/index.ts` resume a job that was mid-flight when the process last restarted.
- **Idempotent by construction, not by dedup logic.** `plays` gained a `sourceRef` column plus a partial unique index on `(userId, source, sourceRef)`; a Trakt history item's own id becomes the `sourceRef`, so re-running an import is a plain `onConflictDoNothing()`. This is also exactly the dedup key M2's Plex/Tautulli webhook ingestion needs, so it didn't need its own migration.
- **Unmatched items are reported, not dropped.** Anything without a resolvable TMDB id, or a Trakt item type rwnd.tv has no local entity for (`season`-level ratings/watchlist entries — `metadata_entity_type` has no `season` value), is recorded in the job's `failures` array (capped at 200 entries) rather than silently skipped or failing the whole job.
- **Device pairing state is in-memory, not persisted.** Unlike the import job itself, a pairing in progress doesn't survive a restart — it's short-lived (Trakt's own `expires_in` is on the order of minutes) and the user just starts pairing again. Only a _completed_ connection (the `trakt_connections` row) is durable.

## Consequences

- Self-hosters who want Trakt import register a free app at trakt.tv and set three more env vars (`TRAKT_CLIENT_ID`, `TRAKT_CLIENT_SECRET`, `ENCRYPTION_KEY`); leaving them unset hides the `/import` page entirely (`InstanceSettings.traktConfigured`) rather than exposing a feature that can't function.
- Losing `ENCRYPTION_KEY` makes existing `trakt_connections` rows undecryptable — this is a re-pair, not a data-loss event, since only the OAuth tokens are encrypted, not any imported history/ratings/watchlist data.
- A second Trakt-like source (e.g. a future Letterboxd import) would follow the same shape: its own OAuth/API client under a new top-level directory, and `import/match.ts`'s matching logic reused as-is, since it already keys off `external_ids` rather than anything Trakt-specific.
