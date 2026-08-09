# 0001: TypeScript end-to-end, Hono API + React SPA, Postgres

## Status

Accepted

## Context

rwnd.tv needs a stack that is maintainable by a non-web-developer working with Claude Code, approachable to outside contributors, and a good fit for a self-hosted Docker deployment. The main choices were:

- **Language**: one language end-to-end (TypeScript) vs. a faster backend language (Go, Rust) paired with a TypeScript frontend.
- **API framework**: a full-stack framework (Next.js) vs. a plain JSON API (Hono/Fastify) with a separate SPA.
- **Database**: SQLite (zero-config, single file) vs. PostgreSQL (proper multi-user concurrency, full-text search).

## Decision

- **TypeScript everywhere.** One language to learn, one toolchain, and the largest realistic pool of outside contributors for a project hoping to be adopted by the community.
- **Hono API + React (Vite) SPA**, shipped as a single Docker image (the API serves the built SPA's static files). API-first suits webhooks, Plex/Tautulli ingestion (M2), and third-party clients — an OpenAPI spec falls out of the same Zod schemas used for request validation (see `apps/api/src/app.ts`).
- **PostgreSQL via Drizzle ORM.** Multi-user support and full-text search (for the browse/explore aims) are core requirements, not later add-ons. This costs self-hosters a second container, which is a trivial addition to a Docker stack that already runs one.
- **pnpm workspaces monorepo**: `apps/api`, `apps/web`, `packages/db` (schema + migrations), `packages/shared` (Zod schemas + types consumed by both apps).

## Consequences

- Self-hosting requires two containers (app + Postgres) rather than one, reflected in the repo's `docker-compose.yml`.
- `packages/db` and `packages/shared` ship TypeScript source directly (no build step) — Vite and `tsx` transpile it on the fly during dev. The production Docker image bundles both into the API via `tsup` (see `apps/api/tsup.config.ts`) so the runtime container never needs a TypeScript toolchain.
- A future SQLite adapter (for the lowest-possible-barrier self-hosting case) is possible but not designed for yet; it would need a second Drizzle dialect and portable-SQL discipline across every query.
