# syntax=docker/dockerfile:1.7

FROM node:26-alpine AS base
RUN npm install -g corepack@latest && corepack enable
WORKDIR /app

# --- deps: install once, cached as long as package.json files don't change ---
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# --- build: compile the SPA and bundle the API, then extract deployable subsets ---
FROM deps AS build
COPY . .
RUN pnpm --filter @rwnd/web build
RUN pnpm --filter @rwnd/api build
RUN pnpm --filter @rwnd/api deploy --prod --legacy /out/api
RUN pnpm --filter @rwnd/db deploy --prod --legacy /out/db

# --- runtime: just the two deployable subsets, the built SPA, and Node ---
FROM node:26-alpine AS runtime
RUN addgroup -S rwnd && adduser -S rwnd -G rwnd
WORKDIR /app

COPY --from=build /out/api ./api
COPY --from=build /out/db ./db
COPY --from=build /app/apps/web/dist ./api/public
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh && chown -R rwnd:rwnd /app

USER rwnd
WORKDIR /app/api
ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=5 \
    CMD node -e "fetch('http://localhost:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
