# TODO

Smaller, non-milestone work — things to do, watch, or decide. For the
feature roadmap see [docs/ROADMAP.md](docs/ROADMAP.md); for why past
decisions were made see [docs/adr/](docs/adr/).

Format:

- `- [ ] **Title** (YYYY-MM-DD HH:MM added)\`, then details on the next line (trailing `\` forces the line break).
- Blank line between each item.
- Lists sorted oldest to newest.

## Repo hygiene

- [ ] **Review Dependabot PRs** (2026-08-09 20:40)\
      8 open, incl. `node` 22→26-alpine again — that exact bump broke
      the Docker image build silently last time
      (`corepack: not found`); confirm the `docker build .` CI step
      actually catches it before merging.

- [ ] **Hold TS 7 bump** (2026-08-09 20:40)\
      `typescript-eslint` doesn't support TS 7 yet; leave any TS 7.0
      Dependabot bump open until it does.

## Open questions / not yet decided

- [ ] **Local dev-loop** (2026-08-09 20:40)\
      Decide whether to restand a dedicated dev Postgres +
      `pnpm dev:api`/`dev:web`, or keep testing against `dev.rwnd.tv`
      as the default.
