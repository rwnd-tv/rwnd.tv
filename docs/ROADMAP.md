# Roadmap

This is a living document — milestones will shift as the project grows. See [docs/vision.md](vision.md) for the intent behind the project, and [docs/adr/](adr/) for why specific technical choices were made.

## M1 — Foundation & vertical slice ✅ done

Prove every layer works end to end, running as a real self-hosted deployment.

- Local accounts (Argon2id), sessions, per-user API tokens, admin-configurable registration policy
- Search movies and TV episodes via TMDB, log a watch, browse history
- Docker image + `docker-compose.yml` for self-hosters; CI and a GHCR release pipeline
- Deployed live at [rwnd.tv](https://rwnd.tv) (public) and dev.rwnd.tv (private, LAN-restricted) — proving the same image serves both a production and a development instance side by side
- Light/dark/system theming, English and French UI
- ADRs and a self-hosting guide

## M2 — Get your data in

- **Trakt import**: history, ratings, and watchlist, matched against existing local records via `external_ids` (see [ADR 0002](adr/0002-metadata-provider.md))
- **Plex/Tautulli webhook ingestion**: watches log themselves as you watch, authenticated via per-user API tokens (already built in M1 for exactly this)
- **Full data export** in an open format — one of the project's stated aims from day one

## M3 — Make it worth using day to day

- Stats and insights (the reason to log anything in the first place)
- Watchlist and custom lists
- Ratings
- Calendar of upcoming episodes
- OIDC login (the `user_credentials` schema was designed for this from M1 — see [ADR 0003](adr/0003-auth-model.md))
- Additional locales beyond English/French

## Not yet scheduled

Ideas that are in scope for the project eventually but don't have a milestone yet: a Wikidata/TVDB metadata provider alongside TMDB, mobile-friendly PWA installability, public/shareable profile pages.
