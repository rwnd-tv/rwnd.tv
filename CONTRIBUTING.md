# Contributing to rwnd.tv

Thanks for considering contributing! This project is young and built in the
open — see [docs/vision.md](docs/vision.md) for the intent behind it, and
[docs/adr/](docs/adr/) for why the codebase looks the way it does.

## Getting started

```sh
pnpm install
cp .env.example apps/api/.env   # DATABASE_URL + TMDB_API_KEY
pnpm db:migrate
pnpm dev:api
pnpm dev:web
```

Requirements: Node.js ≥ 22, pnpm (`corepack enable`), and a PostgreSQL
instance to point `DATABASE_URL` at.

`pnpm db:reset-dev` truncates every table for a clean slate (e.g. to get
back to the first-run setup wizard) — never run it against anything but a
disposable dev database.

## Before opening a PR

```sh
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

CI runs all of the above; running them locally first saves a round trip.

## Code style

- Prettier and ESLint are enforced in CI — run `pnpm format` to auto-fix.
- Match the idiom of the surrounding code (naming, comment density) rather
  than introducing a new pattern for the same problem.
- Prefer extending an existing shared schema/type in `packages/shared` over
  duplicating a shape.

## Commit messages / PRs

- Keep PRs focused — one logical change per PR is easier to review than a
  large mixed one.
- Explain _why_ in the PR description, not just what changed; the diff
  already shows what changed.
- Link the issue a PR addresses, if there is one.

## Database changes

Schema lives in `packages/db/src/schema.ts` (Drizzle). After changing it:

```sh
pnpm db:generate   # writes a new migration under packages/db/drizzle/
```

Check the generated SQL before committing — Drizzle doesn't manage Postgres
extensions (see the `citext` extension line manually added to the first
migration), so a new migration needing one will need the same treatment.

## Adding a metadata provider

Metadata sourcing goes through the `MetadataProvider` interface
(`apps/api/src/providers/types.ts`) — see
[ADR 0002](docs/adr/0002-metadata-provider.md) for why. A new provider is a
new class implementing that interface plus a case in
`apps/api/src/providers/index.ts`; it shouldn't require touching routes or
the database schema.

## Translations

UI strings live in `apps/web/src/i18n/locales/<locale>/common.json`. Adding a
language means:

1. Add the locale to `SUPPORTED_LOCALES` in `packages/shared/src/schemas/common.ts`.
2. Copy `en-GB/common.json` to the new locale directory and translate it.
3. Register it in `apps/web/src/i18n/index.ts`.

## Reporting bugs / requesting features

Please use the issue templates — they ask for the information needed to
act on a report without a round trip.

## Code of Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
