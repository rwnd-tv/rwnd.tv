# Contributing to rwnd.tv

Thanks for considering contributing! This project is young and built in the
open. See [docs/vision.md](docs/vision.md) for the intent behind it, and
[docs/adr/](docs/adr/) for why the codebase looks the way it does.

## Getting started

```sh
pnpm install
cp .env.example apps/api/.env   # then edit — see below
pnpm db:migrate
pnpm dev:api    # http://localhost:3000
pnpm dev:web    # http://localhost:5173, proxies /api to the API above
```

Requirements: Node.js ≥ 22 (`.nvmrc` pins the exact version this repo
develops against; the shipped image runs Node 26 (see `Dockerfile`)
but nothing is tested against 26 outside the Docker build), pnpm
`11.20.0` (`corepack enable` picks this up from `packageManager` in
`package.json`), and a PostgreSQL instance to point `DATABASE_URL` at.

`.env.example` is written for `docker-compose`: its `DATABASE_URL`
hostname (`db`) only resolves inside that network, and it carries
`POSTGRES_*` vars the API doesn't read. For local dev, point
`DATABASE_URL` at your own Postgres instead, fill in `TMDB_API_KEY`
and/or `TVDB_API_KEY`, and add `CORS_ORIGINS=http://localhost:5173` so
the Vite dev server (5173) can call the API (3000) across origins; see
`apps/api/src/env.ts`.

`pnpm db:reset-dev` truncates every table for a clean slate (e.g. to get
back to the first-run setup wizard); never run it against anything but a
disposable dev database. `pnpm db:seed` is the idempotent seed the
container's entrypoint runs on every boot (ensures `instance_settings`
exists); you generally don't need to run it by hand after `db:migrate`.

## Before opening a PR

```sh
pnpm lint
pnpm knip
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

CI (`.github/workflows/ci.yml`) runs all of the above, on both amd64 and
arm64, plus a few things not worth running on every save locally:
`pnpm audit --prod --audit-level=high` (blocking), a real `pnpm db:migrate`
against a Postgres service container, a Docker build, and a Trivy
HIGH/CRITICAL scan of the built image. `pnpm knip` in particular has no
config (`knip.json` is empty) and is easy to trip with an unused export or
file; run it locally rather than finding out from CI.

The test suite needs a live Postgres: it truncates tables between tests
(`vitest.config.ts`), and these env vars set (see `ci.yml` for the exact
values CI uses, none of them real secrets): `DATABASE_URL`, `TMDB_API_KEY`,
`TRAKT_CLIENT_ID`, `TRAKT_CLIENT_SECRET`, `ENCRYPTION_KEY`, `SMTP_HOST`,
`SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `APP_URL`. Simplest local setup:
copy `apps/api/.env` (already has real values for the first few) and add
placeholder values for the rest; none of the email/Trakt ones need to
actually work, the tests never make a real network call.

## Code style

- Prettier and ESLint are enforced in CI; run `pnpm format` to auto-fix.
- Match the idiom of the surrounding code (naming, comment density) rather
  than introducing a new pattern for the same problem.
- Prefer extending an existing shared schema/type in `packages/shared` over
  duplicating a shape.

## Commit messages / PRs

- Keep PRs focused: one logical change per PR is easier to review than a
  large mixed one.
- Explain _why_ in the PR description, not just what changed; the diff
  already shows what changed.
- Link the issue a PR addresses, if there is one.

## Database changes

Schema lives in `packages/db/src/schema.ts` (Drizzle). After changing it:

```sh
pnpm db:generate   # writes a new migration under packages/db/drizzle/
```

Check the generated SQL before committing: Drizzle doesn't manage Postgres
extensions (see the `citext` extension line manually added to the first
migration), so a new migration needing one will need the same treatment.

## Adding a metadata provider

Metadata sourcing goes through the `MetadataProvider` interface
(`apps/api/src/providers/types.ts`); see
[ADR 0002](docs/adr/0002-metadata-provider.md) and
[ADR 0006](docs/adr/0006-multi-provider-metadata.md) for why. A new provider
is a new class implementing that interface (including `getSeason()` and
`findByExternalId()`; see `apps/api/src/providers/tvdb.ts` for a worked
example) plus a case in `apps/api/src/providers/index.ts`; it shouldn't
require touching routes or the database schema. Provider _availability_ is
credential-derived (whichever API keys are set), and priority order is
admin-configurable at runtime (Settings → Instance) rather than a
`METADATA_PROVIDER` env var; there's nothing to register beyond the
provider class itself.

## Translations

UI strings live in `apps/web/src/i18n/locales/<locale>/common.json`. Adding a
language means:

1. Add the locale to `SUPPORTED_LOCALES` in `packages/shared/src/schemas/common.ts`.
2. Copy `en-GB/common.json` to the new locale directory and translate it.
3. Register it in `apps/web/src/i18n/index.ts`.

## Tracking work

Day-to-day work lives in [docs/TODO.md](docs/TODO.md) (small items) and
[docs/ROADMAP.md](docs/ROADMAP.md) (milestones); a completed item moves to
[docs/TODO_ARCHIVE.md](docs/TODO_ARCHIVE.md) rather than staying checked off
in TODO.md. A significant design decision gets an ADR under
[docs/adr/](docs/adr/); see any existing one for the shape.

## Testing components

`apps/web` has component-testing infrastructure (Vitest + Testing Library)
with a couple of exemplar tests to follow the pattern of; see
`apps/web/vitest.config.ts` and any existing `*.test.tsx` file alongside a
component.

## Reporting bugs / requesting features

Please use the issue templates: they ask for the information needed to
act on a report without a round trip.

## Code of Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
