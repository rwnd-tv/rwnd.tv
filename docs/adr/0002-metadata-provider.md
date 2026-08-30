# 0002: Pluggable metadata provider, TMDB first

## Status

Accepted

## Context

rwnd.tv needs show/movie/episode metadata and artwork to be usable at all, but the project's stated aim is to "use open data and not infringe upon the IP of others." In practice:

- **Wikidata / Wikimedia Commons** is genuinely open (CC0/CC-BY-SA) but has patchy-to-absent episode-level coverage and essentially no poster/backdrop artwork. An app built on it alone would not be usable for its core purpose today.
- **TMDB** has the coverage, artwork, and localisation (40+ languages) this app needs, and is what Trakt itself is built on. It is free for non-commercial use with attribution, but is not "open data": it forbids caching results longer than 6 months, requires attribution and the TMDB logo, and forbids AI/ML use of the API.
- **TheTVDB** is a plausible alternative/supplement, closer to TMDB in coverage but with its own licensing terms.

## Decision

Define a `MetadataProvider` interface (`apps/api/src/providers/types.ts`) that the rest of the API depends on, never a specific provider. Ship one implementation — `TmdbProvider` — for M1, selected via `METADATA_PROVIDER=tmdb` and a self-hosted API key.

Two TMDB compliance requirements are enforced structurally rather than by convention:

- `movies.metadata_refreshed_at` / `shows.metadata_refreshed_at` columns exist so cached metadata can be identified and refreshed before it exceeds the 6-month limit (the refresh job itself is not yet built — tracked for a later milestone).
- TMDB attribution and logo appear in the UI footer and README.

## Consequences

- A Wikidata, TVDB, or hybrid provider can be added later as a second class implementing `MetadataProvider`, without changing routes, the database schema, or the frontend — only `apps/api/src/providers/index.ts`'s factory needs a new case.
- Every self-hosted instance needs its own free TMDB API key (documented in `.env.example` and the self-hosting guide). rwnd.tv ships no bundled or shared key.
- `external_ids` (`packages/db/src/schema.ts`) stores `(entity_type, source, external_id)` rather than a single `tmdb_id` column on each table, so a second provider's IDs can coexist with TMDB's on the same local record instead of requiring a migration.
- Superseded in part by `[ADR 0006](0006-multi-provider-metadata.md)`: `METADATA_PROVIDER` (the "selected via" mechanism above) is gone — which providers exist is now derived from which credentials are configured, not a separate explicit choice.

## Update (2026-08-30)

"Ship one implementation — `TmdbProvider` — for M1" above describes M1 only.
TheTVDB shipped as a second real `MetadataProvider` implementation in M2
(`apps/api/src/providers/tvdb.ts`) — the interface this ADR defined was
exercised by a genuine second provider, not just designed to allow one.
