# TODO Archive

Completed items moved out of [TODO.md](TODO.md), same format and
grouping, sorted oldest to newest.

## Repo hygiene

- [x] **Review Dependabot PRs** (2026-08-09 20:40)\
      8 open, incl. `node` 22→26-alpine again — that exact bump broke
      the Docker image build silently last time
      (`corepack: not found`); confirm the `docker build .` CI step
      actually catches it before merging. Done: fixed the Dockerfile
      (corepack is no longer bundled with Node ≥25, install it
      explicitly) and merged 8 PRs; #7 stays open, blocked on TS 7.

## Open questions / not yet decided

- [x] **Local dev-loop** (2026-08-09 20:40)\
      Decide whether to restand a dedicated dev Postgres +
      `pnpm dev:api`/`dev:web`, or keep testing against `dev.rwnd.tv`
      as the default. Done: installed Docker Engine in WSL2 (Ubuntu, no
      Docker Desktop), enabled mirrored networking + `vmIdleTimeout=-1`
      in `.wslconfig`, and a dev-only Postgres container
      (`network_mode: host` — Docker's port-publishing NAT doesn't work
      reliably under mirrored networking, host mode sidesteps it; the
      compose file itself is kept local at `~/rwnd-tv-dev/` inside WSL,
      not in the repo). Confirmed working end to end with a real login.

## TV Shows / Movies gallery follow-ups

- [x] **Gallery nav overflow on narrow viewports** (2026-08-19 15:25)\
      Adding TV Shows/Movies brought the header nav to 7 items, wrapping
      on narrow viewports. Done (2026-08-20): replaced the horizontal nav
      entirely with a collapsible sidebar (`Sidebar.tsx`) under a
      full-width top bar — no wrapping regardless of item count.
