# Roadmap

This is a living document — milestones will shift as the project grows. See [docs/vision.md](vision.md) for the intent behind the project, and [docs/adr/](adr/) for why specific technical choices were made.

## M1 — Foundation & vertical slice ✅ done

Prove every layer works end to end, running as a real self-hosted deployment.

- [x] Local accounts (Argon2id), sessions, per-user API tokens, admin-configurable registration policy
- [x] Search movies and TV episodes via TMDB, log a watch, browse history
- [x] Docker image + `docker-compose.yml` for self-hosters; CI and a GHCR release pipeline
- [x] Deployed live at [rwnd.tv](https://rwnd.tv) (public) and dev.rwnd.tv (private, LAN-restricted) — proving the same image serves both a production and a development instance side by side
- [x] Light/dark/system theming, English and French UI
- [x] ADRs and a self-hosting guide

## M2 — Get your data in

- [x] **Trakt import**: history, ratings, and watchlist, matched against existing local records via `external_ids` (see [ADR 0002](adr/0002-metadata-provider.md) and [ADR 0004](adr/0004-trakt-import.md))
- [x] **TV Shows / Movies gallery pages**: a Plex-style poster wall of everything you've watched, with per-show watch progress backed by a cached (not live-fetched) episode-count refresher — see [ADR 0005](adr/0005-metadata-refresh.md). The Shows gallery also has a filter panel (genre include/exclude, a release-year range) and seven sort orders. Pulled forward the same way M2's `ratings`/`watchlist_items` tables were, since the import work made "now go look at what you've watched" the obvious next step.
- [ ] **Plex/Tautulli webhook ingestion**: watches log themselves as you watch, authenticated via per-user API tokens (already built in M1 for exactly this)
- [ ] **Full data export** in an open format — one of the project's stated aims from day one
- [ ] **Multi-provider metadata matching**: an internal id independent of any single provider (tmdb/imdb/tvdb), admin-configurable provider priority, and a manual per-title metadata refresh instead of silent background updates (see [TODO.md](TODO.md)) — note this overlaps the TMDB-specific season/status caching [ADR 0005](adr/0005-metadata-refresh.md) already added; provider-priority work will need to revisit it

## M3 — Make it worth using day to day

- [ ] Stats and insights (the reason to log anything in the first place)
- [ ] Watchlist and custom lists
- [ ] Ratings
- [ ] Calendar of upcoming episodes
- [ ] OIDC login (the `user_credentials` schema was designed for this from M1 — see [ADR 0003](adr/0003-auth-model.md))
- [ ] Additional locales beyond English/French

## Not yet scheduled

Ideas that are in scope for the project eventually but don't have a milestone yet: a Wikidata/TVDB metadata provider alongside TMDB, mobile-friendly PWA installability, public/shareable profile pages.
