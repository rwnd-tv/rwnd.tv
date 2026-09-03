# Roadmap

This is a living document; milestones will shift as the project grows. See [docs/vision.md](vision.md) for the intent behind the project, and [docs/adr/](adr/) for why specific technical choices were made.

## M1: Foundation & vertical slice ✅ done

Prove every layer works end to end, running as a real self-hosted deployment.

- [x] Local accounts (Argon2id), sessions, per-user API tokens, admin-configurable registration policy
- [x] Search movies and TV episodes via TMDB, log a watch, browse history
- [x] Docker image + `docker-compose.yml` for self-hosters; CI and a GHCR release pipeline
- [x] Deployed live at [rwnd.tv](https://rwnd.tv) (public) and dev.rwnd.tv (private, LAN-restricted), proving the same image serves both a production and a development instance side by side
- [x] Light/dark/system theming, i18n-ready UI (English shipped; a French translation was added speculatively and dropped 2026-08-23, see [TODO.md](TODO.md))
- [x] ADRs and a self-hosting guide

## M2: Get your data in ✅ done

- [x] **Trakt import**: history, ratings, and watchlist, matched against existing local records via `external_ids` (see [ADR 0002](adr/0002-metadata-provider.md) and [ADR 0004](adr/0004-trakt-import.md))
- [x] **TV Shows / Movies gallery pages**: a Plex-style poster wall of everything you've watched, with per-show watch progress backed by a cached (not live-fetched) episode-count refresher, see [ADR 0005](adr/0005-metadata-refresh.md). The Shows gallery also has a filter panel (genre include/exclude, a release-year range) and twelve sort orders (six fields × ascending/descending). Pulled forward the same way M2's `ratings`/`watchlist_items` tables were, since the import work made "now go look at what you've watched" the obvious next step.
- [x] **Plex webhook ingestion**: watches log themselves as you watch, authenticated via the per-user API tokens built in M1 for exactly this. Built on a source-agnostic core (entity resolution, token auth) so Tautulli/Jellyfin/Emby/Kodi (still open, see TODO.md) are each "one payload parser + one route," not a rework. Multi-user Plex servers are a first-class case, not an afterthought: each distinct Plex account seen on one webhook URL is linked to its own rwnd.tv user in Settings (no unreliable "account id 1 is the owner" guess, see TODO_ARCHIVE.md), and any watch that arrived while an account was still unlinked is retroactively logged the moment it's linked.
- [x] **Full data export**: a CSV per category (history/ratings/watchlist/dropped shows), zipped and downloadable from Settings > Database, an open format you can open in a spreadsheet or take to another tool, one of the project's stated aims from day one
- [x] **Trakt ZIP-upload import**: a second Trakt import path from the ZIP "Export now" gives on trakt.tv, alongside the existing OAuth-based import. Sidesteps Trakt's 2026 "Community App" policy, which caps free accounts at one connected third-party OAuth app at a time
- [x] **Profile pictures**: an uploaded avatar, or a generated initials/colour fallback, shown in the sidebar and Settings, so switching between accounts on a shared browser doesn't lose track of which one is active (see TODO_ARCHIVE.md)
- [x] **"Forgot password" / account recovery, and email verification**: outbound email (SMTP, self-hosters bring their own relay) plus a reset-token flow for local accounts, and (added to the same task once the email groundwork existed) a verification link sent on registration, shown on the Profile page (see TODO_ARCHIVE.md)
- [x] **Multi-provider metadata matching**: `MetadataProviderSource` widened off the old TMDB-only literal, a real reverse-lookup fallback (Trakt's `imdb`/`tvdb` ids via TMDB's `/find`) for the common case a `tmdb` id is missing or stale, `METADATA_PROVIDER` env var replaced by credential-derived + admin-configurable priority, and a "Metadata: TMDB" provenance indicator on show/movie pages, see [ADR 0006](adr/0006-multi-provider-metadata.md)
- [x] **TheTVDB as a real second metadata provider**: a full `TvdbProvider` against TheTVDB v4 API, cross-provider fallback for Trakt import matching (so a title TMDB has no entry for under any id, like Formula 1, can still resolve), and TVDB deep links/attribution logos on show/movie/season/episode pages

## M3: Ready for real use ✅ done

Core watch-logging is already solid (M1/M2 shipped local accounts, search,
manual logging, Trakt/CSV import, and Plex webhooks). M3 isn't about adding
every possible feature; it's closing the gap between "works" and "ready
for real users to actually adopt": the ratings/watchlist data import
already brings in becomes visible and usable, per-episode data is kept
accurate for real usage (not just as a side effect of specific actions),
the repo and self-hosting path read as current and actually work end to
end, and a security review + first tagged release mark the project as
genuinely production-ready.

- [x] **Watchlist and custom lists**: any number of named watchlists per user, plus the always-present, never-renameable/deletable Default list a one-click toggle on the show/movie page writes to. A title can sit on several lists at once; a custom-lists dialog manages the rest. A `/watchlists` page shows every list as a tile (cover art: the most recently added item, or a user-pinned one), each drilling into `/watchlists/{id}`'s gallery of that list's shows/movies. Watchlisted shows also feed the Dashboard's Upcoming row, even with no watch history. See TODO_ARCHIVE.md for the full design rationale.
- [x] **Ratings**: a 5-star picker for shows, movies and episodes, independent of watched status
- [x] **Proactive per-episode data resolution**, not just as a side effect of specific actions; shipped 2026-08-26, see TODO_ARCHIVE.md
- [x] **Fix known metadata accuracy bugs affecting real usage**: `airedEpisodeCount` for a currently-airing season, fixed 2026-08-26, see TODO_ARCHIVE.md
- [x] **Landing page**: a real explainer page for logged-out visitors at `/`: hero, features, self-host quick start, screenshot gallery, milestone status and FAQ, with sign-in/create-account and the FAQ's public-instance answer both gated on the instance's actual registration state (see TODO_ARCHIVE.md)
- [x] **Code review & tidy-up pass**: a tooling-floor hardening pass (type-checked lint, stricter tsconfig, `knip`, all wired into CI), splitting the 2,847-line `routes/library.ts` into `routes/library/{index,movies,queue,ratings,seasons,shared,shows}.ts`, a per-area review that found and fixed 37 duplicated lookup call sites plus a real schema-validation gap, and `apps/web`'s first component-testing infrastructure with exemplar tests. See TODO_ARCHIVE.md for the full breakdown and TODO.md's "Code review follow-ups" for what got logged rather than fixed inline.
- [x] **Full security review**: OWASP ASVS 4.0.3 Level 1 pass, ten staged commits. See [ADR 0007](adr/0007-security-posture.md) for the trust model and `docs/security/asvs-l1.md` for the full record. The one finding left open at the time (the live proxy's HTTP→HTTPS redirect, outside this repo) was closed 2026-08-30, see [ADR 0007](adr/0007-security-posture.md).
- [x] **Documentation & self-hosting readiness pass**: README/self-hosting.md/CONTRIBUTING/ADRs refreshed to reflect where the project actually is, a `tools/screenshots/` capture tool for both the README and landing page images, and the promotion procedure `docs/self-hosting.md#verifying-the-image` documents was exercised for real across v1.0.1–v1.0.3 (pull, revision-label check, cosign verify, deploy) on both dev and prod. See TODO_ARCHIVE.md.
- [x] Cut the first tagged release (`v1.0.0`), moving `:latest` off tracking `:edge`
- [x] **Redesign the History page as a full-width grid**, matching the Shows/Movies gallery treatment; shipped 2026-08-26 as the Activity page (merges watches, ratings, watchlist adds and drops into one feed)

## M4: Broader ingestion & upcoming episodes

- [ ] **Tautulli/Jellyfin/Emby/Kodi webhook ingestion**: built on the same source-agnostic core (entity resolution, per-user API token auth) Plex's webhook (M2) already runs on, so each of these is "one payload parser + one route," not a rework. Tautulli's webhook body is fully user-templated (no fixed shape, needs its own JSON template + setup docs), unlike the others' fixed formats (see TODO.md).
- [ ] **Calendar of upcoming episodes**: a view of what's airing next across the shows you're following (see TODO.md).
- [x] **Admin UI for managing user accounts**: a new `/admin` page lists every user (role, last login, email-verified and MFA status), and lets an admin promote/demote, view and revoke a user's sessions, trigger a password-reset email (never set a password directly), or delete an account. A new `users.last_login_at` column backs "last login" (not derived from `sessions`, which loses that history on logout/expiry). The old blanket "admins can't delete themselves" rule (`DELETE /auth/me`) was replaced by a real invariant, `lib/admins.ts#assertNotLastAdmin`: an instance can never reach zero admins, enforced transactionally on both the self-service and admin-triggered paths. See TODO_ARCHIVE.md.
- [ ] **An "owner" role, immune to demotion/removal by other admins**: the admin UI above stops an instance reaching zero admins, but not a rogue or compromised admin demoting every _other_ admin down to `user` one at a time and ending up sole admin, fully within the rules as they stand. A third `userRoleEnum` value, exactly one at a time, only transferable by the current owner themselves (see TODO.md).
- [x] **IMDb deep link on show/movie/episode pages**: a plain text "IMDb" link (not a logo, IMDb's terms forbid that without written permission, unlike TMDB/TVDB), no rating badge. Extended to episode pages during scoping, not just show/movie as originally scoped; see TODO_ARCHIVE.md.

## Not yet scheduled

Ideas that are in scope for the project eventually but don't have a milestone yet: stats and insights, OIDC login (the `user_credentials` schema was designed for this from M1, see [ADR 0003](adr/0003-auth-model.md)), additional locales beyond English, mobile-friendly PWA installability, public/shareable profile pages.
