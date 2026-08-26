# Roadmap

This is a living document — milestones will shift as the project grows. See [docs/vision.md](vision.md) for the intent behind the project, and [docs/adr/](adr/) for why specific technical choices were made.

## M1 — Foundation & vertical slice ✅ done

Prove every layer works end to end, running as a real self-hosted deployment.

- [x] Local accounts (Argon2id), sessions, per-user API tokens, admin-configurable registration policy
- [x] Search movies and TV episodes via TMDB, log a watch, browse history
- [x] Docker image + `docker-compose.yml` for self-hosters; CI and a GHCR release pipeline
- [x] Deployed live at [rwnd.tv](https://rwnd.tv) (public) and dev.rwnd.tv (private, LAN-restricted) — proving the same image serves both a production and a development instance side by side
- [x] Light/dark/system theming, i18n-ready UI (English shipped; a French translation was added speculatively and dropped 2026-08-23 — see [TODO.md](TODO.md))
- [x] ADRs and a self-hosting guide

## M2 — Get your data in ✅ done

- [x] **Trakt import**: history, ratings, and watchlist, matched against existing local records via `external_ids` (see [ADR 0002](adr/0002-metadata-provider.md) and [ADR 0004](adr/0004-trakt-import.md))
- [x] **TV Shows / Movies gallery pages**: a Plex-style poster wall of everything you've watched, with per-show watch progress backed by a cached (not live-fetched) episode-count refresher — see [ADR 0005](adr/0005-metadata-refresh.md). The Shows gallery also has a filter panel (genre include/exclude, a release-year range) and seven sort orders. Pulled forward the same way M2's `ratings`/`watchlist_items` tables were, since the import work made "now go look at what you've watched" the obvious next step.
- [x] **Plex webhook ingestion**: watches log themselves as you watch, authenticated via the per-user API tokens built in M1 for exactly this. Built on a source-agnostic core (entity resolution, token auth) so Tautulli/Jellyfin/Emby/Kodi — still open, see TODO.md — are each "one payload parser + one route," not a rework. Multi-user Plex servers are a first-class case, not an afterthought: each distinct Plex account seen on one webhook URL is claimed to its own rwnd.tv user in Settings (no unreliable "account id 1 is the owner" guess — see TODO_ARCHIVE.md), and any watch that arrived while an account was still unclaimed is retroactively logged the moment it's claimed.
- [x] **Full data export**: a CSV per category (history/ratings/watchlist/dropped shows), zipped and downloadable from Settings > Database — an open format you can open in a spreadsheet or take to another tool, one of the project's stated aims from day one
- [x] **Trakt ZIP-upload import**: a second Trakt import path from the ZIP "Export now" gives on trakt.tv, alongside the existing OAuth-based import — sidesteps Trakt's 2026 "Community App" policy, which caps free accounts at one connected third-party OAuth app at a time
- [x] **Profile pictures**: an uploaded avatar, or a generated initials/colour fallback, shown in the sidebar and Settings, so switching between accounts on a shared browser doesn't lose track of which one is active (see TODO_ARCHIVE.md)
- [x] **"Forgot password" / account recovery, and email verification**: outbound email (SMTP, self-hosters bring their own relay) plus a reset-token flow for local accounts, and — added to the same task once the email groundwork existed — a verification link sent on registration, shown on the Profile page (see TODO_ARCHIVE.md)
- [x] **Multi-provider metadata matching**: `MetadataProviderSource` widened off the old TMDB-only literal, a real reverse-lookup fallback (Trakt's `imdb`/`tvdb` ids via TMDB's `/find`) for the common case a `tmdb` id is missing or stale, `METADATA_PROVIDER` env var replaced by credential-derived + admin-configurable priority, and a "Metadata: TMDB" provenance indicator on show/movie pages — see [ADR 0006](adr/0006-multi-provider-metadata.md)
- [x] **TheTVDB as a real second metadata provider**: a full `TvdbProvider` against TheTVDB v4 API, cross-provider fallback for Trakt import matching (so a title TMDB has no entry for under any id, like Formula 1, can still resolve), and TVDB deep links/attribution logos on show/movie/season/episode pages

## M3 — Make it worth using day to day

- [ ] Stats and insights (the reason to log anything in the first place)
- [ ] Watchlist and custom lists
- [ ] Ratings
- [ ] Calendar of upcoming episodes
- [ ] OIDC login (the `user_credentials` schema was designed for this from M1 — see [ADR 0003](adr/0003-auth-model.md))
- [ ] Additional locales beyond English

## Not yet scheduled

Ideas that are in scope for the project eventually but don't have a milestone yet: mobile-friendly PWA installability, public/shareable profile pages.
