# rwnd.tv

[![CI](https://github.com/rwnd-tv/rwnd.tv/actions/workflows/ci.yml/badge.svg)](https://github.com/rwnd-tv/rwnd.tv/actions/workflows/ci.yml)
[![Release](https://github.com/rwnd-tv/rwnd.tv/actions/workflows/release.yml/badge.svg)](https://github.com/rwnd-tv/rwnd.tv/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

rwnd.tv (rewind dot tv) is an open source, self-hosted app for tracking the TV shows and movies you watch — a replacement for [trakt.tv](https://trakt.tv) that you run yourself.

> **Built with Claude Code.** This project's author isn't a web developer and is building rwnd.tv with Claude Code, in the open, from the start. See [docs/vision.md](docs/vision.md) for the full story and intent.

## Status

Early days — milestone 1 (a working vertical slice: sign in, search for something, log that you watched it, see your history) is done and running live at [rwnd.tv](https://rwnd.tv). Trakt import and Plex/Tautulli webhook ingestion are next. See [docs/ROADMAP.md](docs/ROADMAP.md) for the full roadmap.

## Features (this milestone)

- Local accounts, admin-configurable registration (open / invite / closed)
- Search movies and TV episodes via [TMDB](https://www.themoviedb.org/)
- Log watches manually and browse your history
- Per-user API tokens (for the webhook ingestion landing in the next milestone)
- Light/dark/system theming, English and French UI

## Quick start

```sh
curl -O https://raw.githubusercontent.com/rwnd-tv/rwnd.tv/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/rwnd-tv/rwnd.tv/main/.env.example
mv .env.example .env
# edit .env — see docs/self-hosting.md
docker compose up -d
```

Full instructions, configuration reference, and backup/upgrade notes: [docs/self-hosting.md](docs/self-hosting.md).

## Development

Requirements: Node.js ≥ 22, pnpm (`corepack enable`), and a PostgreSQL database to point at.

```sh
pnpm install
cp .env.example apps/api/.env   # fill in DATABASE_URL and TMDB_API_KEY
pnpm db:migrate
pnpm dev:api    # http://localhost:3000
pnpm dev:web    # http://localhost:5173, proxies /api to the API above
```

Other useful scripts: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

The project is a pnpm workspace:

| Path              | What                                                                   |
| ----------------- | ---------------------------------------------------------------------- |
| `apps/api`        | Hono JSON API — auth, search, plays, OpenAPI spec at `/api/docs`       |
| `apps/web`        | React (Vite) single-page app                                           |
| `packages/db`     | Drizzle schema and migrations                                          |
| `packages/shared` | Zod schemas and types shared by the API and web app                    |
| `docs/`           | Vision doc, roadmap, architecture decision records, self-hosting guide |

## Architecture decisions

Significant design choices and their reasoning are recorded in [docs/adr/](docs/adr/) — start with [0001](docs/adr/0001-stack.md) (stack), [0002](docs/adr/0002-metadata-provider.md) (metadata), [0003](docs/adr/0003-auth-model.md) (auth).

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Please also read the [Code of Conduct](CODE_OF_CONDUCT.md).

## Metadata attribution

<img src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg" alt="" height="24"> This product uses the TMDB API but is not endorsed or certified by TMDB.

## License

[MIT](LICENSE)
