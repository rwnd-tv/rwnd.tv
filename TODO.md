# TODO

Smaller, non-milestone work — things to do, watch, or decide. For the
feature roadmap see [docs/ROADMAP.md](docs/ROADMAP.md); for why past
decisions were made see [docs/adr/](docs/adr/).

## Repo hygiene

- [ ] Review and merge the open Dependabot PRs (currently 8 open, incl.
      `node` 22→26-alpine again — that exact bump broke the Docker image
      build silently last time (`corepack: not found`); confirm the
      `docker build .` CI step actually catches it before merging).
- [ ] `typescript-eslint` doesn't support TS 7 yet — leave any TS 7.0
      Dependabot bump open until it does.

## Open questions / not yet decided

- [ ] Decide whether the local dev-loop (dedicated dev Postgres +
      `pnpm dev:api`/`dev:web`) is worth restanding, or whether testing
      against `dev.rwnd.tv` stays the default.
